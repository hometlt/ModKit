/**
 * The shared mod server (owner decision 07.10, 6Б): one process per user and set of extension
 * roots holds the loaded mods' servers — the loader's `ModContext`s, each with its chain's Data
 * session — for every client on the machine: VS Code, the standalone LSP and MCP sessions open the
 * same chain once instead of once each.
 *
 * - `serveModServer` (the daemon side) answers `openModContext` from its own `ContentSources` and
 *   hands each client a lease of the context; the context's whole contract crosses: layers, files,
 *   read, locate, query, overlay, invalidate, prepare and the server's revision. What a client laid
 *   over files (its unsaved buffers) is taken away again when it goes, so a closed editor leaves no
 *   text of its own behind in a chain another client reads.
 * - `connectModServer` (the client side) gives the same `ModContext` contract over the connection.
 * - `withSharedModContexts` puts a client's mod contexts on the shared server, starting the daemon
 *   when none listens, and opens them in the client's own process when the server cannot be
 *   reached: the same code either way, only the transport differs.
 *
 * Transport: the host's capability-RPC endpoint (frames, limits, leases) as JSON lines over a named
 * pipe (Windows) or a Unix socket in a per-user directory; no new RPC. A client proves it is the
 * same user by a random token the daemon writes to a file only that user can read (Windows profile
 * directory, `0600` elsewhere). The daemon leaves when no client has been connected for a while.
 * The address and token depend on the extension roots, storage and options, so clients with
 * another set of extensions get another daemon.
 *
 * Limits: one call may run 10 minutes (opening a cold chain, its first Data question); a line is
 * bounded by the protocol's frame size. Credentials and network sources stay with the client: the
 * daemon's content sources get none, and a client asks the daemon only for mod contexts.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModkitError } from '@modkit/core'
import type { IndexCacheSwitches } from '@modkit/sdk'
import type {
  ContentSources,
  ModContext,
  ModContextOverlay,
  ModContextRequest,
} from '@modkit/vfs/content-sources'
import { createEndpoint, type Endpoint, type RemoteCapability } from '../execution/endpoint.js'
import { framePortFromJsonPort } from '../execution/frame-json.js'
import { protocolLimits } from '../execution/protocol.js'
import { createSurfaceRegistry, type CapabilitySurface } from '../execution/surface.js'

/** Protocol of the handshake line; frames follow the endpoint's own version. */
export const MOD_SERVER_PROTOCOL = 1
export const ABI_MOD_SERVER = { contract: 'x3.abi/mod-server', major: 1 } as const
export const ABI_SERVED_MOD_CONTEXT = { contract: 'x3.abi/mod-context', major: 1 } as const

const MOD_SERVER_MODULE = 'modkit:mod-server'
const CALL_DEADLINE_MS = 10 * 60 * 1_000
const MAX_LINE_CHARACTERS = 96 * 1024 * 1024
const sig = { signal: 'last' } as const

const servedContextSurface: CapabilitySurface = {
  ...ABI_SERVED_MOD_CONTEXT,
  fields: ['schemaVersion', 'gameId', 'contextId', 'layers', 'unresolved', 'diagnostics', 'revision'],
  methods: {
    files: { kind: 'value', arity: 2 },
    read: { kind: 'value', arity: 3 },
    locate: { kind: 'value', arity: 1 },
    query: { kind: 'value', arity: 1, ...sig },
    overlay: { kind: 'value', arity: 1 },
    invalidate: { kind: 'value', arity: 0 },
    prepare: { kind: 'value', arity: 0, ...sig },
  },
}

const modServerSurface: CapabilitySurface = {
  ...ABI_MOD_SERVER,
  methods: {
    openModContext: { kind: 'lease', result: ABI_SERVED_MOD_CONTEXT, wrapper: 'lease', arity: 1, ...sig },
  },
}

const surfaces = () => createSurfaceRegistry([modServerSurface, servedContextSurface])
const limits = () => protocolLimits({ defaultCallDeadlineMs: CALL_DEADLINE_MS })

/** Where the daemon of one extension set listens, and where its token is kept. */
export interface ModServerAddress {
  readonly digest: string
  readonly pipe: string
  readonly tokenFile: string
}

/** What a daemon's content sources are made of: the client's, without credentials. */
export interface ModServerSourcesOptions {
  readonly extensionRoots: readonly string[]
  readonly storage: string
  readonly configPath?: string
  /** Host options per extension (`publisher/id`), as the client resolved them. */
  readonly moduleOptions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly indexCacheDirectory?: string
  /** The user's index cache switches per product. */
  readonly indexCaches?: IndexCacheSwitches
}

/** The address of the daemon for one set of content source options. */
export function modServerAddress(options: ModServerSourcesOptions, directory = modServerDirectory()): ModServerAddress {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      MOD_SERVER_PROTOCOL,
      [...options.extensionRoots].map(root => root.replaceAll('\\', '/').toLowerCase()).sort(),
      options.storage.replaceAll('\\', '/').toLowerCase(),
      options.configPath ?? null,
      options.moduleOptions ?? null,
      options.indexCacheDirectory ?? null,
      options.indexCaches ?? null,
    ]))
    .digest('hex')
    .slice(0, 24)
  const user = safeName(userInfo().username)
  return Object.freeze({
    digest,
    pipe: process.platform === 'win32'
      ? `\\\\.\\pipe\\modkit-mod-server-${user}-${digest}`
      : join(directory, `mod-server-${digest}.sock`),
    tokenFile: join(directory, `mod-server-${digest}.token`),
  })
}

/** A directory only this user reads: the profile's local application data, or a 0700 folder. */
export function modServerDirectory(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Modkit', 'mod-server')
  }
  return join(process.env['XDG_RUNTIME_DIR'] ?? join(homedir(), '.modkit'), 'mod-server')
}

const safeName = (value: string): string => value.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 64) || 'user'

/** JSON lines over a socket, one frame per line, bounded. */
function lineChannel(socket: Socket) {
  const handlers = new Set<(text: string) => void>()
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE_CHARACTERS) {
      socket.destroy(new Error('a mod server line exceeds its bound'))
      return
    }
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      for (const handler of handlers) handler(line)
    }
  })
  return {
    send(text: string): void {
      if (!socket.destroyed) socket.write(`${text}\n`)
    },
    onMessage(handler: (text: string) => void): () => void {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

/** The first line of a connection, before any frame. */
function readLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => finish(new Error('no handshake from the mod server')), timeoutMs)
    timer.unref?.()
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const at = buffer.indexOf('\n')
      if (at >= 0) {
        // What follows the line belongs to the frames: hand it back to the socket.
        const rest = buffer.slice(at + 1)
        finish(undefined, buffer.slice(0, at))
        if (rest !== '') socket.unshift(Buffer.from(rest, 'utf8'))
      } else if (buffer.length > 4096) finish(new Error('a mod server handshake is too long'))
    }
    const onEnd = () => finish(new Error('the mod server closed the connection'))
    const finish = (error?: Error, line?: string) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('error', onEnd)
      if (error !== undefined) reject(error)
      else resolve(line!)
    }
    socket.on('data', onData)
    socket.on('end', onEnd)
    socket.on('error', onEnd)
  })
}

const sameToken = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** A validated `openModContext` request: what the loader accepts, nothing else. */
function modContextRequest(value: unknown): ModContextRequest {
  const record = value as Record<string, unknown> | null
  const target = record?.['target'] as unknown
  const targetOk = (typeof target === 'string' && target.length > 0 && target.length <= 4096) ||
    (typeof target === 'object' && target !== null &&
      typeof (target as Record<string, unknown>)['sourceId'] === 'string' &&
      typeof (target as Record<string, unknown>)['path'] === 'string')
  const list = (item: unknown) => item === undefined ||
    (Array.isArray(item) && item.length <= 64 && item.every(entry => typeof entry === 'string' && entry.length <= 256))
  if (record === null || typeof record !== 'object' || record['schemaVersion'] !== 1 || !targetOk ||
      !list(record['baseMods']) || !list(record['locales'])) {
    throw new TypeError('openModContext needs { schemaVersion: 1, target, baseMods?, locales? }')
  }
  return record as unknown as ModContextRequest
}

/**
 * The daemon's service for one connection: contexts it opened and the overlays it laid, so both
 * go when the connection does.
 */
function connectionService(sources: Pick<ContentSources, 'openModContext'>) {
  const opened = new Set<ModContext>()
  /** What this connection laid over each context's files: by layer and path. */
  const laid = new Map<ModContext, Map<string, ModContextOverlay>>()
  const served = (context: ModContext) => ({
    schemaVersion: context.schemaVersion,
    gameId: context.gameId,
    contextId: context.contextId,
    layers: context.layers,
    unresolved: context.unresolved,
    diagnostics: context.diagnostics,
    revision: context.revision ?? '0',
    files: (layerId: string, page: Parameters<ModContext['files']>[1]) => context.files(layerId, page),
    read: (layerId: string, path: string, maxBytes: number) => context.read(layerId, path, maxBytes),
    locate: (path: string) => context.locate(path),
    async query(request: unknown, signal?: AbortSignal) {
      if (context.query === undefined) throw new TypeError('this mod context answers no questions')
      return context.query(request, signal)
    },
    async overlay(changes: readonly ModContextOverlay[]) {
      if (context.overlay === undefined) throw new TypeError('this mod context takes no overlays')
      const result = await context.overlay(changes)
      const mine = laid.get(context) ?? new Map<string, ModContextOverlay>()
      for (const change of changes) {
        const layer = context.layers.find(item => item.id === change.layerId)
        const pathKey = layer?.caseSensitive === true ? change.path : change.path.toLowerCase()
        const key = JSON.stringify([change.layerId, pathKey])
        if (change.text === undefined) mine.delete(key)
        else mine.set(key, Object.freeze({ layerId: change.layerId, path: change.path }))
      }
      laid.set(context, mine)
      return result
    },
    async invalidate() {
      return context.invalidate?.() ?? { revision: context.revision ?? '0' }
    },
    async prepare(signal?: AbortSignal) {
      await context.prepare?.(signal)
    },
  })
  const service = {
    async openModContext(request: unknown, signal?: AbortSignal) {
      if (sources.openModContext === undefined) throw new TypeError('the mod server opens no mod contexts')
      const context = await sources.openModContext(modContextRequest(request))
      if (signal?.aborted === true) {
        await context.dispose()
        signal.throwIfAborted()
      }
      opened.add(context)
      return {
        value: served(context),
        release: async () => {
          await takeBack(context)
          opened.delete(context)
          await context.dispose()
        },
      }
    },
  }
  /** Take away what this connection laid over one context's files. */
  const takeBack = async (context: ModContext) => {
    const mine = laid.get(context)
    laid.delete(context)
    if (mine === undefined || mine.size === 0 || context.overlay === undefined) return
    await context.overlay([...mine.values()]).catch(() => undefined)
  }
  return {
    service,
    async close() {
      for (const context of [...opened]) {
        await takeBack(context)
        await context.dispose().catch(() => undefined)
      }
      opened.clear()
    },
  }
}

export interface ServeModServerOptions {
  readonly sources: Pick<ContentSources, 'openModContext'>
  readonly address: Pick<ModServerAddress, 'pipe' | 'tokenFile'>
  /** Leave when no client has been connected this long (default 10 minutes). */
  readonly idleMs?: number
  readonly onIdle?: () => void
}

export interface ServedModServer {
  readonly connections: number
  close(): Promise<void>
}

/** Listen for clients of one extension set; resolves once listening with the token written. */
export async function serveModServer(options: ServeModServerOptions): Promise<ServedModServer> {
  const token = randomBytes(32).toString('hex')
  const idleMs = options.idleMs ?? 10 * 60 * 1_000
  const live = new Set<{ readonly socket: Socket; readonly close: () => Promise<void> }>()
  let idle: ReturnType<typeof setTimeout> | undefined
  const armIdle = () => {
    if (idle !== undefined) clearTimeout(idle)
    idle = live.size > 0 ? undefined : setTimeout(() => options.onIdle?.(), idleMs)
    idle?.unref?.()
  }
  let sessions = 0
  const server: Server = createServer(socket => {
    void (async () => {
      let line: string
      try {
        line = await readLine(socket, 10_000)
      } catch {
        socket.destroy()
        return
      }
      let hello: { readonly modServer?: unknown; readonly token?: unknown }
      try {
        hello = JSON.parse(line) as typeof hello
      } catch {
        hello = {}
      }
      if (hello.modServer !== MOD_SERVER_PROTOCOL || typeof hello.token !== 'string' || !sameToken(hello.token, token)) {
        socket.end(`${JSON.stringify({ modServer: MOD_SERVER_PROTOCOL, ok: false })}\n`)
        return
      }
      const connection = connectionService(options.sources)
      const channel = lineChannel(socket)
      // Both endpoints of a connection name one session; the client hears it in the answer.
      const session = `mod-server-${(sessions += 1)}-${randomBytes(6).toString('hex')}`
      const endpoint: Endpoint = createEndpoint({
        role: 'worker',
        port: framePortFromJsonPort(channel),
        session,
        generation: 1,
        surfaces: surfaces(),
        limits: limits(),
        loader: async request => {
          if (request.moduleUrl !== MOD_SERVER_MODULE) throw new TypeError('the mod server loads only itself')
          return { module: connection.service, surface: ABI_MOD_SERVER }
        },
        onFailure: () => socket.destroy(),
      })
      const entry = { socket, close: connection.close }
      live.add(entry)
      armIdle()
      socket.on('close', () => {
        live.delete(entry)
        void endpoint.peerClosed('the client went away')
        void connection.close().finally(armIdle)
      })
      socket.write(`${JSON.stringify({ modServer: MOD_SERVER_PROTOCOL, ok: true, session })}\n`)
    })()
  })
  if (process.platform !== 'win32') await rm(options.address.pipe, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.address.pipe, () => {
      server.off('error', reject)
      resolve()
    })
  })
  await mkdir(join(options.address.tokenFile, '..'), { recursive: true, mode: 0o700 })
  await writeFile(options.address.tokenFile, token, { mode: 0o600 })
  armIdle()
  return {
    get connections() {
      return live.size
    },
    async close() {
      if (idle !== undefined) clearTimeout(idle)
      await new Promise<void>(resolve => server.close(() => resolve()))
      for (const entry of [...live]) {
        entry.socket.destroy()
        await entry.close().catch(() => undefined)
      }
      live.clear()
      await rm(options.address.tokenFile, { force: true }).catch(() => undefined)
    },
  }
}

/** A client's connection: mod contexts on the shared server. */
export interface ModServerConnection {
  openModContext(request: ModContextRequest, signal?: AbortSignal): Promise<ModContext>
  readonly closed: boolean
  close(): Promise<void>
}

/** A served context as a `ModContext`: the revision follows every answer that names one. */
function remoteContext(remote: RemoteCapability): ModContext {
  const data = remote.data as Readonly<Record<string, unknown>>
  let revision = typeof data['revision'] === 'string' ? data['revision'] : '0'
  const call = async (method: string, args: readonly unknown[], signal?: AbortSignal): Promise<unknown> => {
    const outcome = await remote.call(method, args, {
      ...(signal === undefined ? {} : { signal }),
      deadlineMs: CALL_DEADLINE_MS,
    })
    if (outcome.kind !== 'value') throw new TypeError(`mod server ${method} answered a ${outcome.kind}`)
    return outcome.value
  }
  const noted = (value: unknown): unknown => {
    const next = (value as { readonly revision?: unknown } | null)?.revision
    if (typeof next === 'string') revision = next
    return value
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    gameId: String(data['gameId']),
    contextId: String(data['contextId']),
    layers: (data['layers'] ?? []) as ModContext['layers'],
    unresolved: (data['unresolved'] ?? []) as ModContext['unresolved'],
    diagnostics: (data['diagnostics'] ?? []) as ModContext['diagnostics'],
    get revision() {
      return revision
    },
    files: async (layerId: string, page: Parameters<ModContext['files']>[1]) =>
      (await call('files', [layerId, page])) as Awaited<ReturnType<ModContext['files']>>,
    read: async (layerId: string, path: string, maxBytes: number) =>
      (await call('read', [layerId, path, maxBytes])) as Uint8Array,
    locate: async (path: string) => (await call('locate', [path])) as Awaited<ReturnType<ModContext['locate']>>,
    query: async (request: unknown, signal?: AbortSignal) => noted(await call('query', [request], signal)),
    overlay: async (changes: readonly ModContextOverlay[]) =>
      noted(await call('overlay', [changes])) as { readonly revision: string },
    invalidate: async () => noted(await call('invalidate', [])) as { readonly revision: string },
    prepare: async (signal?: AbortSignal) => {
      await call('prepare', [], signal)
    },
    dispose: () => remote.release(),
  })
}

/** Connect to the daemon at `address`, proving the user by its token. */
export async function connectModServer(address: Pick<ModServerAddress, 'pipe' | 'tokenFile'>): Promise<ModServerConnection> {
  const token = (await readFile(address.tokenFile, 'utf8')).trim()
  const socket = await new Promise<Socket>((resolve, reject) => {
    const opened = connect(address.pipe)
    opened.once('connect', () => {
      opened.off('error', reject)
      resolve(opened)
    })
    opened.once('error', reject)
  })
  socket.write(`${JSON.stringify({ modServer: MOD_SERVER_PROTOCOL, token })}\n`)
  let answer: { readonly ok?: unknown; readonly session?: unknown }
  try {
    answer = JSON.parse(await readLine(socket, 10_000)) as typeof answer
  } catch (error) {
    socket.destroy()
    throw error
  }
  if (answer.ok !== true || typeof answer.session !== 'string' || answer.session.length > 128) {
    socket.destroy()
    throw new ModkitError({ code: 'x3.host/mod-server-refused', message: 'the mod server refused this client' })
  }
  let closed = false
  const endpoint = createEndpoint({
    role: 'host',
    port: framePortFromJsonPort(lineChannel(socket)),
    session: answer.session,
    generation: 1,
    surfaces: surfaces(),
    limits: limits(),
    onFailure: () => socket.destroy(),
  })
  socket.on('close', () => {
    closed = true
    void endpoint.peerClosed('the mod server went away')
  })
  const { root } = await endpoint.load({
    moduleUrl: MOD_SERVER_MODULE,
    contributionId: 'modkit/mod-server',
    variantId: 'daemon',
    artifactDigest: 'sha256:mod-server',
  })
  return {
    get closed() {
      return closed
    },
    async openModContext(request, signal) {
      const outcome = await root.call('openModContext', [request], {
        ...(signal === undefined ? {} : { signal }),
        deadlineMs: CALL_DEADLINE_MS,
      })
      if (outcome.kind !== 'lease') throw new TypeError('the mod server answered openModContext without a lease')
      return remoteContext(outcome.remote)
    },
    async close() {
      if (closed) return
      closed = true
      await endpoint.close('client closed').catch(() => undefined)
      socket.destroy()
    },
  }
}

export interface SharedModContextsOptions extends ModServerSourcesOptions {
  /** The daemon's entry script (`mod-server-daemon.js`); by default the one beside this module. */
  readonly daemonScript?: string
  /** The Node executable to start it with; by default this process's (`ELECTRON_RUN_AS_NODE` set). */
  readonly nodePath?: string
  /** How long to wait for a daemon this client started (default 30 s). */
  readonly startMs?: number
  readonly directory?: string
  /** A failure to reach the shared server, before the client opens contexts itself. */
  readonly onFallback?: (error: unknown) => void
}

/** The daemon script beside this module, for a host that did not name one (ESM only). */
function defaultDaemonScript(): string {
  const base: string | undefined = import.meta.url
  if (base === undefined || base === '') {
    throw new ModkitError({
      code: 'x3.host/mod-server-daemon-unresolved',
      message: 'this host must pass daemonScript: import.meta.url is unavailable (a CommonJS bundle)',
    })
  }
  return fileURLToPath(new URL('./mod-server-daemon.js', base))
}

/**
 * A client's content sources with their mod contexts on the shared server: `openModContext` asks
 * the daemon (started when none listens), every other call stays with the client's own sources.
 * When the server cannot be reached, the client's own sources open the context — the same code.
 */
export function withSharedModContexts(sources: ContentSources, options: SharedModContextsOptions): ContentSources & {
  readonly shared: () => Promise<ModServerConnection | undefined>
} {
  const address = modServerAddress(options, options.directory)
  let connection: Promise<ModServerConnection | undefined> | undefined
  const reach = async (): Promise<ModServerConnection | undefined> => {
    try {
      return await connectModServer(address)
    } catch {
      // No daemon yet: start one, and wait until it listens.
      const script = options.daemonScript ?? defaultDaemonScript()
      const child = spawn(options.nodePath ?? process.execPath, [script, JSON.stringify({
        address: { pipe: address.pipe, tokenFile: address.tokenFile },
        sources: {
          extensionRoots: options.extensionRoots,
          storage: options.storage,
          ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
          ...(options.moduleOptions === undefined ? {} : { moduleOptions: options.moduleOptions }),
          ...(options.indexCacheDirectory === undefined ? {} : { indexCacheDirectory: options.indexCacheDirectory }),
          ...(options.indexCaches === undefined ? {} : { indexCaches: options.indexCaches }),
        },
      })], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      // A daemon that fails before it listens (no script, a broken installation) ends the wait. One
      // that found another daemon listening leaves with code 0, and the next connect finds that one.
      let exited: { readonly code: number | null; readonly error?: unknown } | undefined
      child.once('error', error => {
        exited = { code: null, error }
      })
      child.once('exit', code => {
        exited ??= { code }
      })
      child.unref()
      const deadline = Date.now() + (options.startMs ?? 30_000)
      let last: unknown
      while (Date.now() < deadline) {
        try {
          return await connectModServer(address)
        } catch (error) {
          last = error
          if (exited !== undefined && exited.code !== 0) {
            last = exited.error ?? new ModkitError({
              code: 'x3.host/mod-server-daemon-exited',
              message: `the mod server daemon exited (code ${String(exited.code)}) before it listened`,
            })
            break
          }
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }
      options.onFallback?.(last)
      return undefined
    }
  }
  const shared = (): Promise<ModServerConnection | undefined> => {
    connection ??= reach().then(found => {
      if (found === undefined) connection = undefined
      return found
    }, error => {
      connection = undefined
      options.onFallback?.(error)
      return undefined
    })
    return connection.then((found): Promise<ModServerConnection | undefined> | ModServerConnection | undefined => {
      if (found?.closed === true) {
        connection = undefined
        return shared()
      }
      return found
    })
  }
  const local = sources.openModContext?.bind(sources)
  return new Proxy(sources, {
    get(target, key, receiver) {
      if (key === 'shared') return shared
      if (key === 'openModContext') {
        return async (request: ModContextRequest) => {
          const server = await shared()
          if (server !== undefined) {
            try {
              return await server.openModContext(request)
            } catch (error) {
              // The server's own refusal (no such package) is the answer; only a lost connection
              // sends the request to this process's sources.
              if (!server.closed || local === undefined) throw error
              options.onFallback?.(error)
            }
          }
          if (local === undefined) throw new TypeError('these content sources open no mod contexts')
          return local(request)
        }
      }
      if (key === 'dispose') {
        return async () => {
          const server = await connection?.catch(() => undefined)
          await server?.close()
          await target.dispose()
        }
      }
      const value: unknown = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  }) as ContentSources & { readonly shared: () => Promise<ModServerConnection | undefined> }
}
