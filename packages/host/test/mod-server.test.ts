/**
 * The shared mod server (owner decision 07.10, 6Б): clients on the machine open the same chain's
 * server through one daemon. The whole ModContext contract crosses the named pipe; what one client
 * laid over files stays in that client's session and is taken away when that client goes; a client without
 * the daemon's token is refused; the daemon notices when no client is left. A client that cannot
 * reach a daemon opens its contexts itself.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ContentSources,
  ModContext,
  ModContextOverlay,
  ModContextRequest,
} from '@modkit/vfs/content-sources'
import {
  connectModServer,
  modServerAddress,
  serveModServer,
  withSharedModContexts,
  type ServedModServer,
} from '../src/node/mod-server.js'
import { LoadedModResourceSessions } from '../src/mods/resource-sessions.js'

const encoder = new TextEncoder()
const UNITS = 'Base.SC2Data/GameData/UnitData.xml'

/** One saved chain with isolated views, as an overlay-capable game loader must provide. */
function chainSources() {
  const disk = new Map([[UNITS, '<Catalog/>']])
  const views = new Map<
    string,
    { overlays: Map<string, string>; revision: number; references: number }
  >()
  const removedPaths: string[] = []
  let opened = 0
  let disposed = 0
  const context = (sessionId: string): ModContext => {
    const view = views.get(sessionId) ?? {
      overlays: new Map<string, string>(),
      revision: 0,
      references: 0,
    }
    view.references += 1
    views.set(sessionId, view)
    const overlays = view.overlays
    let closed = false
    return {
      schemaVersion: 1,
      gameId: 'test/game',
      contextId: `chain:${sessionId}`,
      sessionId,
      layers: [
        {
          id: 'layer:0',
          displayName: 'Mine',
          sourceId: 'host',
          sourcePath: 'C:/Mods/Mine.SC2Mod',
          caseSensitive: true,
          role: 'primary',
          provenance: 'opened',
          kind: 'package',
        },
      ],
      unresolved: [],
      diagnostics: [],
      files: async () => ({ items: [...new Set([...disk.keys(), ...overlays.keys()])].sort() }),
      async read(_layerId, path) {
        const text = overlays.get(path) ?? disk.get(path)
        if (text === undefined) throw new Error(`${path} is not a file of this layer`)
        return encoder.encode(text)
      },
      locate: async path =>
        disk.has(path) || overlays.has(path) ? { layerId: 'layer:0', path } : undefined,
      async query(request) {
        return {
          revision: String(view.revision),
          units: overlays.get(UNITS) ?? disk.get(UNITS),
          asked: request as never,
        }
      },
      get revision() {
        return String(view.revision)
      },
      async overlay(changes: readonly ModContextOverlay[]) {
        for (const change of changes) {
          if (change.text === undefined) {
            overlays.delete(change.path)
            removedPaths.push(change.path)
          } else overlays.set(change.path, change.text)
        }
        if (changes.length > 0) view.revision += 1
        return { revision: String(view.revision) }
      },
      async invalidate() {
        for (const current of views.values()) current.revision += 1
        return { revision: String(view.revision) }
      },
      async prepare() {},
      async dispose() {
        if (closed) return
        closed = true
        disposed += 1
        view.references -= 1
        if (view.references === 0) views.delete(sessionId)
      },
    }
  }
  const sources = {
    async openModContext(request: ModContextRequest) {
      opened += 1
      // a path under which nothing exists is an error of the loader, not of the transport
      if (request.target !== 'C:/Mods/Mine.SC2Mod')
        throw new Error(`nothing exists at ${String(request.target)}`)
      return context(request.sessionId ?? 'legacy')
    },
    dispose() {},
  } as unknown as ContentSources
  return {
    sources,
    removedPaths,
    get opened() {
      return opened
    },
    get disposed() {
      return disposed
    },
  }
}

const served: ServedModServer[] = []
const directories: string[] = []
afterEach(async () => {
  for (const server of served.splice(0)) await server.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function daemon(idleMs?: number, onIdle?: () => void) {
  const directory = await mkdtemp(join(tmpdir(), 'modkit-mod-server-'))
  directories.push(directory)
  const options = {
    extensionRoots: [join(directory, 'roots', String(Math.random()))],
    storage: directory,
  }
  const address = modServerAddress(options, directory)
  const chain = chainSources()
  const server = await serveModServer({
    sources: chain.sources,
    address,
    ...(idleMs === undefined ? {} : { idleMs }),
    ...(onIdle === undefined ? {} : { onIdle }),
  })
  served.push(server)
  return { address, chain, server, options, directory }
}

const request = { schemaVersion: 1 as const, target: 'C:/Mods/Mine.SC2Mod' }

describe('the shared mod server', () => {
  it('keeps the client session but replaces its transport generation after reconnecting', async () => {
    const { options, directory } = await daemon()
    const local = chainSources()
    const sources = withSharedModContexts(local.sources, { ...options, directory })
    const resources = new LoadedModResourceSessions(sources)
    try {
      await resources.load(request.target)
      const first = await sources.openModContext!(request)
      const identity = { id: first.contextId, sessionId: first.sessionId, generation: first.generation }
      await first.dispose()
      const connection = await sources.shared()
      await connection!.close()
      const next = await sources.openModContext!(request)
      expect(next.contextId).toBe(identity.id)
      expect(next.sessionId).toBe(identity.sessionId)
      expect(typeof identity.generation).toBe('string')
      expect(next.generation).not.toBe(identity.generation)
      expect(await resources.load(request.target)).toBe(true)
      await next.dispose()
    } finally { await resources.dispose(); await sources.dispose() }
  })
  it('preserves absent optional methods for a readonly loader', async () => {
    const { address, chain } = await daemon()
    const open = chain.sources.openModContext!.bind(chain.sources)
    chain.sources.openModContext = async request => {
      const { sessionId: _session, query: _query, overlay: _overlay,
        invalidate: _invalidate, prepare: _prepare, ...readonly } = await open(request)
      return readonly
    }
    const client = await connectModServer(address)
    try {
      const context = await client.openModContext(request)
      expect([context.query, context.overlay, context.invalidate, context.prepare, context.sessionId]).toEqual([
        undefined, undefined, undefined, undefined, undefined,
      ])
      expect(new TextDecoder().decode(await context.read('layer:0', UNITS, 1024))).toBe('<Catalog/>')
      await context.dispose()
    } finally { await client.close() }
  })
  it('closes live connections and their session views before waiting for the listening server', async () => {
    const { address, chain, server } = await daemon()
    const client = await connectModServer(address)
    const context = await client.openModContext(request)
    await context.overlay!([{ layerId: 'layer:0', path: UNITS, text: '<Closing/>' }])
    try {
      await server.close()
      expect(chain.disposed).toBe(1)
      expect(chain.removedPaths).toEqual([UNITS])
      expect(server.connections).toBe(0)
    } finally {
      await client.close()
    }
  })
  it('keeps separate local client scopes when daemon use is disabled', async () => {
    const chain = chainSources()
    const first = withSharedModContexts(chain.sources, {
      extensionRoots: [],
      storage: 'unused',
      enabled: false,
    })
    const second = withSharedModContexts(chain.sources, {
      extensionRoots: [],
      storage: 'unused',
      enabled: false,
    })
    const a = await first.openModContext!(request)
    const again = await first.openModContext!(request)
    const b = await second.openModContext!(request)
    try {
      expect(await first.shared()).toBeUndefined()
      expect(a.sessionId).toBe(again.sessionId)
      expect(a.sessionId).not.toBe(b.sessionId)
      await a.overlay!([{ layerId: 'layer:0', path: UNITS, text: '<Local/>' }])
      expect(await again.query!({ kind: 'units' })).toMatchObject({ units: '<Local/>' })
      expect(await b.query!({ kind: 'units' })).toMatchObject({ units: '<Catalog/>' })
      const scoped = await first.openModContext!({ ...request, sessionId: 'mcp-workspace' })
      expect(scoped.sessionId).toBe('mcp-workspace')
      expect(await scoped.query!({ kind: 'units' })).toMatchObject({ units: '<Catalog/>' })
      await scoped.dispose()
    } finally {
      await a.dispose()
      await again.dispose()
      await b.dispose()
      await first.dispose()
      await second.dispose()
    }
  })

  it('rejects a writable loader that ignores session isolation instead of silently sharing overlays', async () => {
    const chain = chainSources()
    const open = chain.sources.openModContext!.bind(chain.sources)
    chain.sources.openModContext = async value => {
      const context = await open(value)
      const { sessionId: _sessionId, ...unscoped } = context
      return unscoped
    }
    const local = withSharedModContexts(chain.sources, {
      extensionRoots: [],
      storage: 'unused',
      enabled: false,
    })
    await expect(local.openModContext!(request)).rejects.toMatchObject({
      code: 'x3.host/mod-context-session-unsupported',
    })
    expect(chain.disposed).toBe(1)
    await expect(local.openModContext!({ ...request, sessionId: '' })).rejects.toThrow(/sessionId/u)
    expect(chain.opened).toBe(1)
    await local.dispose()
  })
  it('accepts authenticated clients while the shared source is still loading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-mod-server-readiness-'))
    directories.push(directory)
    const address = modServerAddress({ extensionRoots: [], storage: directory }, directory)
    const chain = chainSources()
    let release!: () => void
    let started!: () => void
    const loading = new Promise<void>(resolve => {
      release = resolve
    })
    const requested = new Promise<void>(resolve => {
      started = resolve
    })
    const server = await serveModServer({
      address,
      sources: {
        async openModContext(value) {
          started()
          await loading
          if (chain.sources.openModContext === undefined)
            throw new Error('fixture has no mod contexts')
          return chain.sources.openModContext(value)
        },
      },
    })
    served.push(server)
    const first = await connectModServer(address)
    const second = await connectModServer(address)
    try {
      expect(chain.opened).toBe(0)
      const opening = first.openModContext(request)
      await requested
      expect(chain.opened).toBe(0)
      expect(first.closed).toBe(false)
      expect(second.closed).toBe(false)
      release()
      const context = await opening
      expect(context.contextId).toBe(`chain:${context.sessionId}`)
      expect(chain.opened).toBe(1)
      await context.dispose()
    } finally {
      release()
      await first.close()
      await second.close()
    }
  })

  it('serves the ModContext contract over its pipe', async () => {
    const { address, chain } = await daemon()
    const client = await connectModServer(address)
    const context = await client.openModContext(request)
    expect(chain.opened).toBe(1)
    expect([context.gameId, context.contextId, context.revision]).toEqual([
      'test/game',
      `chain:${context.sessionId}`,
      '0',
    ])
    expect(context.layers.map(layer => layer.id)).toEqual(['layer:0'])
    expect(context.layers[0]?.caseSensitive).toBe(true)
    expect(await context.files('layer:0', { limit: 10 })).toEqual({ items: [UNITS] })
    expect(new TextDecoder().decode(await context.read('layer:0', UNITS, 1024))).toBe('<Catalog/>')
    expect(await context.locate(UNITS)).toEqual({ layerId: 'layer:0', path: UNITS })
    expect(await context.query!({ kind: 'data.ids' })).toMatchObject({
      revision: '0',
      asked: { kind: 'data.ids' },
    })
    expect(
      await context.overlay!([
        { layerId: 'layer:0', path: UNITS, text: '<Catalog><CUnit id="A"/></Catalog>' },
      ]),
    ).toEqual({ revision: '1' })
    expect(context.revision).toBe('1')
    await context.prepare!()
    expect(await context.invalidate!()).toEqual({ revision: '2' })
    await context.dispose()
    await client.close()
  })

  it('removes both distinct case-sensitive overlays when their client disconnects', async () => {
    const { address, chain } = await daemon()
    const editor = await connectModServer(address)
    const context = await editor.openModContext(request)
    await context.overlay!([
      { layerId: 'layer:0', path: UNITS, text: '<Upper/>' },
      { layerId: 'layer:0', path: UNITS.toLowerCase(), text: '<Lower/>' },
    ])
    expect((await context.files('layer:0', { limit: 10 })).items).toHaveLength(2)
    await editor.close()
    for (let attempt = 0; attempt < 50 && chain.disposed < 1; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(chain.removedPaths.sort()).toEqual([UNITS, UNITS.toLowerCase()].sort())
    const reader = await connectModServer(address)
    try {
      const reopened = await reader.openModContext(request)
      expect(await reopened.files('layer:0', { limit: 10 })).toEqual({ items: [UNITS] })
      expect(await reopened.query!({ kind: 'units' })).toMatchObject({ units: '<Catalog/>' })
      await reopened.dispose()
    } finally {
      await reader.close()
    }
  })

  it('isolates different clients while readers in one client see the same view', async () => {
    const { address, chain } = await daemon()
    const editor = await connectModServer(address)
    const other = await connectModServer(address)
    const edited = await editor.openModContext(request)
    const reading = await other.openModContext(request)
    const sameClient = await editor.openModContext(request)
    expect(edited.sessionId).not.toBe(reading.sessionId)
    expect(edited.contextId).not.toBe(reading.contextId)
    expect(sameClient.contextId).toBe(edited.contextId)
    await edited.overlay!([
      { layerId: 'layer:0', path: UNITS, text: '<Catalog><CUnit id="Unsaved"/></Catalog>' },
    ])
    expect(await sameClient.query!({ kind: 'units' })).toMatchObject({
      units: '<Catalog><CUnit id="Unsaved"/></Catalog>',
    })
    expect(await reading.query!({ kind: 'units' })).toMatchObject({
      units: '<Catalog/>',
      revision: '0',
    })
    await reading.overlay!([{ layerId: 'layer:0', path: UNITS, text: '<Other/>' }])
    await editor.close()
    for (let attempt = 0; attempt < 50 && chain.disposed < 2; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(await reading.query!({ kind: 'units' })).toMatchObject({ units: '<Other/>' })
    expect(await reading.overlay!([])).toEqual({ revision: '1' })
    await other.close()
  })

  it("refuses a client without the daemon's token", async () => {
    const { address, directory } = await daemon()
    const forged = join(directory, 'forged.token')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(forged, 'not the token')
    await expect(connectModServer({ pipe: address.pipe, tokenFile: forged })).rejects.toThrow(
      /refused/u,
    )
  })

  it('says when no client has been connected for a while', async () => {
    let idle = 0
    const { address } = await daemon(100, () => (idle += 1))
    const client = await connectModServer(address)
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(idle).toBe(0)
    await client.close()
    for (let attempt = 0; attempt < 50 && idle === 0; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(idle).toBe(1)
  })

  it('opens mod contexts on the shared server, and in the client when no daemon can be reached', async () => {
    const { options, directory, chain } = await daemon()
    const local = chainSources()
    const shared = withSharedModContexts(local.sources, { ...options, directory })
    const context = await shared.openModContext!(request)
    expect([chain.opened, local.opened]).toEqual([1, 0])
    await context.dispose()
    // The daemon this client starts dies at once (no such script): the client does not wait out
    // the start deadline, it says why and opens the context itself.
    const reasons: unknown[] = []
    const unreachable = withSharedModContexts(local.sources, {
      extensionRoots: [join(directory, 'nothing')],
      storage: directory,
      directory,
      daemonScript: join(directory, 'missing-daemon.js'),
      startMs: 20_000,
      onFallback: reason => reasons.push(reason),
    })
    const started = Date.now()
    const fallback = await unreachable.openModContext!(request)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(local.opened).toBe(1)
    expect(reasons).toHaveLength(1)
    expect(String((reasons[0] as Error).message)).toMatch(/exited \(code 1\) before it listened/u)
    await fallback.dispose()
    await shared.dispose()
  }, 30_000)

  it("answers the server's refusal, without opening the context in the client", async () => {
    const { options, directory, chain } = await daemon()
    const local = chainSources()
    const reasons: unknown[] = []
    const shared = withSharedModContexts(local.sources, {
      ...options,
      directory,
      onFallback: reason => reasons.push(reason),
    })
    await expect(
      shared.openModContext!({ schemaVersion: 1, target: 'C:/Mods/Missing.SC2Mod' }),
    ).rejects.toThrow(/nothing exists at C:\/Mods\/Missing\.SC2Mod/u)
    expect([chain.opened, local.opened, reasons.length]).toEqual([1, 0, 0])
    // the connection is still the server's: the next request opens there
    const context = await shared.openModContext!(request)
    expect([chain.opened, local.opened]).toEqual([2, 0])
    await context.dispose()
    await shared.dispose()
  })
})
