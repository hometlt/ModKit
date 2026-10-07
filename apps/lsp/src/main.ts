#!/usr/bin/env node

import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { compareUtf8 } from '@modkit/core'
import type { AnyDescriptor } from '@modkit/sdk'
import { composeLanguageDocumentSources, resolveContentLanguageSources } from '@modkit/host'
import {
  createLanguageModContexts,
  createLanguageWorkspace,
  languageProviderRoutes,
  languageWorkspaceContextToken,
  type LanguageModContexts,
} from '@modkit/host/language'
import {
  createModkit,
  loadContentSources,
  workerBackendPolicy,
  type ModkitOpened,
} from '@modkit/host/node'
import { ConfigurationError, modkitLspUsage, parseModkitLspConfiguration } from './config.js'
import { createFilesystemLanguageDocumentSource } from '@modkit/host/node'
import { createModkitLanguageServer } from './server.js'

const LANGUAGE_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 250_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 120_000,
})

const errorLine = (code: string, message: string): string =>
  `${JSON.stringify({ code, message: message.slice(0, 1_024) })}\n`

export async function runModkitLsp(argv: readonly string[]) {
  const configuration = parseModkitLspConfiguration(argv)
  const [roots, extensions] = await Promise.all([
    Promise.all(configuration.roots.map(root => realpath(root))),
    Promise.all(configuration.extensions.map(extension => realpath(extension))),
  ])
  const modkit = await createModkit({
    extensions: [],
    ...(configuration.trustExtensions
      ? { trustedExtensions: extensions }
      : { userExtensions: extensions }),
    roots,
    intent: 'inspect',
    policy: workerBackendPolicy({ outputCapBytes: 4_194_304 }),
    onDiagnostic: diagnostic =>
      process.stderr.write(errorLine(diagnostic.code, diagnostic.message)),
  })
  if (modkit.extensionFailures.length > 0) {
    await modkit.close()
    throw new ConfigurationError(
      `${modkit.extensionFailures.length} configured extension root(s) failed to load`,
    )
  }
  const routes = languageProviderRoutes(modkit.services.inventory)
  if (routes.length === 0) {
    await modkit.close()
    throw new ConfigurationError('configured extensions advertise no language contributions')
  }
  /*
   * Packed dependencies, the way MCP language sessions load them: the configured content provider
   * opens every root inside its mods (`openModContext`) — a package over what it declares, any
   * other folder over the base mods (`--base-mod`, else the game's default) — and the layers'
   * documents join the snapshot read-only after the loose files.
   */
  const contentSources =
    configuration.contentSourceConfig === undefined ||
    configuration.contentSourceStorage === undefined
      ? undefined
      : await loadContentSources(
          configuration.contentSourceConfig,
          configuration.contentSourceStorage,
        ).catch(async (error: unknown) => {
          await modkit.close()
          throw error
        })
  const openedRoots: ModkitOpened[] = []
  let openedSubjectDescriptors: AnyDescriptor[] = []
  const dependencySources = []
  /** The roots' mod contexts, kept open as the loaded mods' servers (owner decision 07.10). */
  let modContexts: LanguageModContexts | undefined
  if (contentSources !== undefined) {
    // A root that opens as no subject (a folder of scripts) still opens inside its base mods.
    const looseRoots: string[] = []
    for (const root of roots) {
      const opened = await modkit.open(root)
      if (opened.session === undefined) {
        looseRoots.push(root)
        continue
      }
      openedRoots.push(opened)
    }
    const openedRootSessions = openedRoots.map(opened => {
      if (opened.session === undefined) throw new Error('opened root lost its subject session')
      return opened.session
    })
    openedSubjectDescriptors = await Promise.all(
      openedRootSessions.map(session => session.descriptor()),
    )
    const projected = await resolveContentLanguageSources({
      contentSources,
      routes,
      limits: {
        maxDocumentBytes: configuration.maxDocumentBytes,
        maxWorkspaceBytes: configuration.maxWorkspaceBytes,
        maxEntries: 65_536,
      },
      subjects: [
        ...openedRootSessions.map((_session, index) => {
          const descriptor = openedSubjectDescriptors[index]
          if (descriptor === undefined) throw new Error('opened root descriptor is missing')
          return { descriptor }
        }),
        ...looseRoots.map(root => ({ descriptor: { subjectUri: pathToFileURL(root).href } })),
      ],
      ...(configuration.baseMods.length === 0 ? {} : { baseMods: { '*': configuration.baseMods } }),
      keepContexts: true,
    })
    modContexts = createLanguageModContexts({
      contexts: projected.contexts ?? [],
      uriOf: target => (typeof target === 'string' ? pathToFileURL(target).href : undefined),
      maxDocumentBytes: configuration.maxDocumentBytes,
    })
    // The servers build their Data while the client starts up; the first request finds it ready.
    void modContexts.prepare()
    for (const item of projected.diagnostics)
      process.stderr.write(errorLine(item.code, item.message))
    dependencySources.push(...projected.sources)
  }
  const filesystemSource = createFilesystemLanguageDocumentSource({
    roots,
    routes,
    maxDocumentBytes: configuration.maxDocumentBytes,
    maxWorkspaceBytes: configuration.maxWorkspaceBytes,
  })
  const documentSource = composeLanguageDocumentSources([...dependencySources, filesystemSource])
  const workspace = createLanguageWorkspace({
    services: modkit.services,
    grant: { id: 'modkit.app.lsp/language', classes: ['read-source'] },
    budgets: LANGUAGE_BUDGET,
    workspaceBudgets: {
      ...LANGUAGE_BUDGET,
      maxInputBytes: BigInt(configuration.maxWorkspaceBytes),
    },
    ...(documentSource === undefined ? {} : { documentSource }),
    ...(modContexts === undefined ? {} : { modContexts }),
    semanticInputs: Object.freeze([
      Object.freeze({
        kind: 'locale-set',
        id: `selected-game-locales:${configuration.locales.join(',')}`,
        revision: languageWorkspaceContextToken(configuration.locales),
        payload: Object.freeze({ locales: [...configuration.locales] }),
      }),
      ...(openedSubjectDescriptors.length === 0
        ? []
        : [
            Object.freeze({
              kind: 'subject-set',
              id: languageWorkspaceContextToken(
                openedSubjectDescriptors.map(item => item.subjectUri).sort(compareUtf8),
              ),
              revision: languageWorkspaceContextToken(
                openedSubjectDescriptors
                  .map(item => ({ subjectUri: item.subjectUri, revision: item.revision }))
                  .sort((left, right) => compareUtf8(left.subjectUri, right.subjectUri)),
              ),
            }),
          ]),
    ]),
    documentOrigin: document => filesystemSource.origin(document),
  })
  await workspace.initialize()
  const server = createModkitLanguageServer({
    workspace,
    routes,
    roots,
    maxDocuments: configuration.maxDocuments,
    maxDocumentBytes: configuration.maxDocumentBytes,
    maxWorkspaceBytes: configuration.maxWorkspaceBytes,
    ...(modContexts === undefined ? {} : { filesChanged: () => modContexts!.invalidate() }),
  })
  server.listen()
  let closed: Promise<void> | undefined
  return Object.freeze({
    routes,
    close(): Promise<void> {
      closed ??= (async () => {
        await server.close()
        for (const opened of openedRoots) await opened.close()
        await modContexts?.dispose()
        await contentSources?.dispose()
        await modkit.close()
      })()
      return closed
    },
  })
}

async function main(): Promise<void> {
  try {
    const running = await runModkitLsp(process.argv.slice(2))
    const close = (): void => {
      void running.close().catch(() => {
        process.exitCode = 1
      })
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    process.stdin.once('end', close)
  } catch (error) {
    const configuration = error instanceof ConfigurationError
    process.stderr.write(
      errorLine(
        configuration ? 'x3.lsp/configuration-error' : 'x3.lsp/startup-failed',
        error instanceof Error ? error.message : String(error),
      ),
    )
    if (configuration) process.stderr.write(modkitLspUsage())
    process.exitCode =
      error instanceof ConfigurationError && error.message === 'help requested'
        ? 0
        : configuration
          ? 2
          : 1
  }
}

const invoked = process.argv[1]
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) await main()
