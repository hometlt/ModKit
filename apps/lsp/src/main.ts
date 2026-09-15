#!/usr/bin/env node

import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createLanguageWorkspace, languageProviderRoutes } from '@modkit/host/language'
import { createModkit, workerBackendPolicy } from '@modkit/host/node'
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
    policy: workerBackendPolicy({
      loadDeadlineMs: 120_000,
      defaultCallDeadlineMs: 120_000,
      graceMs: 5_000,
      outputCapBytes: 4_194_304,
    }),
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
  const workspace = createLanguageWorkspace({
    services: modkit.services,
    grant: { id: 'modkit.app.lsp/language', classes: ['read-source'] },
    budgets: LANGUAGE_BUDGET,
    documentSource: createFilesystemLanguageDocumentSource({
      roots,
      routes,
      maxDocumentBytes: configuration.maxDocumentBytes,
      maxWorkspaceBytes: configuration.maxWorkspaceBytes,
    }),
  })
  await workspace.initialize()
  const server = createModkitLanguageServer({
    workspace,
    roots,
    maxDocuments: configuration.maxDocuments,
  })
  server.listen()
  let closed: Promise<void> | undefined
  return Object.freeze({
    routes,
    close(): Promise<void> {
      closed ??= (async () => {
        await server.close()
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
