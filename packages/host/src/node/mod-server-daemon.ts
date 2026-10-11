/**
 * The shared mod server's process (`mod-server.ts`): started detached by the first client of an
 * extension set, it listens at the set's address and opens its content sources on the first request
 * — without credentials, which stay with clients. It leaves after a while without connected clients.
 * A second daemon of the same set finds the address taken and leaves at once.
 *
 * Argument: one JSON object `{ address: { pipe, tokenFile }, sources?: ModServerSourcesOptions,
 * sourcesFile?, idleMs? }`; `withSharedModContexts` writes the sources to `sourcesFile`.
 */
import { readFileSync } from 'node:fs'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { serveModServer, type ModServerAddress, type ModServerSourcesOptions } from './mod-server.js'

interface DaemonOptions {
  readonly address: Pick<ModServerAddress, 'pipe' | 'tokenFile'>
  readonly sources: ModServerSourcesOptions
  readonly idleMs?: number
}

async function main(): Promise<void> {
  const argument = JSON.parse(process.argv[2] ?? '{}') as Omit<DaemonOptions, 'sources'> & {
    readonly sources?: ModServerSourcesOptions
    readonly sourcesFile?: string
  }
  const options = {
    ...argument,
    sources: argument.sources ??
      (typeof argument.sourcesFile === 'string'
        ? JSON.parse(readFileSync(argument.sourcesFile, 'utf8')) as ModServerSourcesOptions
        : undefined),
  } as DaemonOptions
  if (typeof options.address?.pipe !== 'string' || typeof options.address.tokenFile !== 'string' ||
      !Array.isArray(options.sources?.extensionRoots) || typeof options.sources.storage !== 'string') {
    process.exitCode = 2
    return
  }
  const moduleOptions = options.sources.moduleOptions
  // Publish the authenticated endpoint before importing game sources. Otherwise a slow source
  // initialization makes clients time out and initialize the same sources in their own process.
  let sources: Promise<ContentSources | undefined> | undefined
  const loadSources = () =>
    (sources ??= import('./content-sources.js').then(({ resolveContentSources }) =>
      resolveContentSources({
        extensionRoots: options.sources.extensionRoots,
        storage: options.sources.storage,
        ...(options.sources.configPath === undefined ? {} : { configPath: options.sources.configPath }),
        ...(moduleOptions === undefined
          ? {}
          : { moduleOptions: (extension: string) => moduleOptions[extension] }),
        ...(options.sources.indexCacheDirectory === undefined
          ? {}
          : { indexCacheDirectory: options.sources.indexCacheDirectory }),
        ...(options.sources.indexCaches === undefined ? {} : { indexCaches: options.sources.indexCaches }),
        ...(options.sources.languageRoutes === undefined ? {} : { languageRoutes: options.sources.languageRoutes }),
      }),
    ))
  let leaving = false
  const leave = async (server?: { close(): Promise<void> }) => {
    if (leaving) return
    leaving = true
    await server?.close().catch(() => undefined)
    const loaded = await sources?.catch(() => undefined)
    await Promise.resolve(loaded?.dispose()).catch(() => undefined)
    process.exit(0)
  }
  try {
    const server = await serveModServer({
      sources: {
        async openModContext(request) {
          // A failed bootstrap still ends the daemon, so clients use their existing local fallback.
          // A refusal from an initialized source remains an ordinary RPC error, not a fallback.
          const loaded = await loadSources().catch(() => process.exit(1))
          if (loaded === undefined) process.exit(3)
          if (loaded.openModContext === undefined) throw new TypeError('the mod server opens no mod contexts')
          return loaded.openModContext(request)
        },
      },
      address: options.address,
      ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
      onIdle: () => void leave(server),
    })
    process.once('SIGTERM', () => void leave(server))
    process.once('SIGINT', () => void leave(server))
  } catch (error) {
    // Another daemon of this set already listens: it serves the clients.
    if ((error as { readonly code?: unknown }).code === 'EADDRINUSE') await leave()
    throw error
  }
}

void main().catch(() => {
  process.exitCode = 1
})
