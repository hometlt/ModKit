#!/usr/bin/env node

import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { composeLanguageDocumentSources, resolveContentLanguageSources } from '@modkit/host'
import { createLanguageWorkspace, languageProviderRoutes } from '@modkit/host/language'
import {
  createModkit,
  loadContentSources,
  workerBackendPolicy,
  type ModkitOpened,
} from '@modkit/host/node'
import { ConfigurationError, modkitLspUsage, parseModkitLspConfiguration } from './config.js'
import { createFilesystemLanguageDocumentSource } from './filesystem-source.js'
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
   * Packed dependencies, the way MCP language sessions load them: every root that opens as a
   * subject names its dependency closure (`content.resolve-dependencies`), the configured content
   * provider resolves it, and its documents join the snapshot read-only after the loose files.
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
  const dependencySources = []
  if (contentSources !== undefined) {
    for (const root of roots) {
      const opened = await modkit.open(root)
      if (opened.session === undefined) continue
      openedRoots.push(opened)
    }
    const projected = await resolveContentLanguageSources({
      contentSources,
      routes,
      limits: {
        maxDocumentBytes: configuration.maxDocumentBytes,
        maxWorkspaceBytes: configuration.maxWorkspaceBytes,
        maxEntries: 65_536,
      },
      subjects: await Promise.all(
        openedRoots.map(async opened => ({
          descriptor: await opened.session!.descriptor(),
          operations: opened.session!.operations(),
        })),
      ),
      standingMounts: true,
    })
    for (const item of projected.diagnostics)
      process.stderr.write(errorLine(item.code, item.message))
    dependencySources.push(...projected.sources)
  }
  const documentSource = composeLanguageDocumentSources([
    createFilesystemLanguageDocumentSource({
      roots,
      routes,
      maxDocumentBytes: configuration.maxDocumentBytes,
      maxWorkspaceBytes: configuration.maxWorkspaceBytes,
    }),
    ...dependencySources,
  ])
  const workspace = createLanguageWorkspace({
    services: modkit.services,
    grant: { id: 'modkit.app.lsp/language', classes: ['read-source'] },
    budgets: LANGUAGE_BUDGET,
    ...(documentSource === undefined ? {} : { documentSource }),
  })
  await workspace.initialize()
  const server = createModkitLanguageServer({
    workspace,
    roots,
    maxDocuments: configuration.maxDocuments,
    maxDocumentBytes: configuration.maxDocumentBytes,
    maxWorkspaceBytes: configuration.maxWorkspaceBytes,
  })
  server.listen()
  let closed: Promise<void> | undefined
  return Object.freeze({
    routes,
    close(): Promise<void> {
      closed ??= (async () => {
        await server.close()
        for (const opened of openedRoots) await opened.close()
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
