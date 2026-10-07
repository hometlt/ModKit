/**
 * The shared mod server's process (`mod-server.ts`): started detached by the first client of an
 * extension set, it opens that set's content sources — without credentials, which stay with the
 * clients — listens at the set's address and leaves when no client has been connected for a while.
 * A second daemon of the same set finds the address taken and leaves at once.
 *
 * Argument: one JSON object `{ address: { pipe, tokenFile }, sources: ModServerSourcesOptions,
 * idleMs? }`, as `withSharedModContexts` passes it.
 */
import { resolveContentSources } from './content-sources.js'
import { serveModServer, type ModServerAddress, type ModServerSourcesOptions } from './mod-server.js'

interface DaemonOptions {
  readonly address: Pick<ModServerAddress, 'pipe' | 'tokenFile'>
  readonly sources: ModServerSourcesOptions
  readonly idleMs?: number
}

async function main(): Promise<void> {
  const options = JSON.parse(process.argv[2] ?? '{}') as DaemonOptions
  if (typeof options.address?.pipe !== 'string' || typeof options.address.tokenFile !== 'string' ||
      !Array.isArray(options.sources?.extensionRoots) || typeof options.sources.storage !== 'string') {
    process.exitCode = 2
    return
  }
  const moduleOptions = options.sources.moduleOptions
  const sources = await resolveContentSources({
    extensionRoots: options.sources.extensionRoots,
    storage: options.sources.storage,
    ...(options.sources.configPath === undefined ? {} : { configPath: options.sources.configPath }),
    ...(moduleOptions === undefined ? {} : { moduleOptions: (extension: string) => moduleOptions[extension] }),
    ...(options.sources.indexCacheDirectory === undefined
      ? {}
      : { indexCacheDirectory: options.sources.indexCacheDirectory }),
    ...(options.sources.indexCaches === undefined ? {} : { indexCaches: options.sources.indexCaches }),
  })
  if (sources === undefined) {
    process.exitCode = 3
    return
  }
  let leaving = false
  const leave = async (server?: { close(): Promise<void> }) => {
    if (leaving) return
    leaving = true
    await server?.close().catch(() => undefined)
    await Promise.resolve(sources.dispose()).catch(() => undefined)
    process.exit(0)
  }
  try {
    const server = await serveModServer({
      sources,
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
