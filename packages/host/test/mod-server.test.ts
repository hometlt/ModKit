/**
 * The shared mod server (owner decision 07.10, 6Б): clients on the machine open the same chain's
 * server through one daemon. The whole ModContext contract crosses the named pipe; what one client
 * laid over files is seen by the others and taken away when that client goes; a client without
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

const encoder = new TextEncoder()
const UNITS = 'Base.SC2Data/GameData/UnitData.xml'

/** Content sources whose every context is the same chain's server, as the SC2 loader's are. */
function chainSources() {
  const disk = new Map([[UNITS, '<Catalog/>']])
  const overlays = new Map<string, string>()
  let revision = 0
  let opened = 0
  let disposed = 0
  const context = (): ModContext => ({
    schemaVersion: 1,
    gameId: 'test/game',
    contextId: 'chain',
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
        revision: String(revision),
        units: overlays.get(UNITS) ?? disk.get(UNITS),
        asked: request as never,
      }
    },
    get revision() {
      return String(revision)
    },
    async overlay(changes: readonly ModContextOverlay[]) {
      for (const change of changes) {
        if (change.text === undefined) overlays.delete(change.path)
        else overlays.set(change.path, change.text)
      }
      if (changes.length > 0) revision += 1
      return { revision: String(revision) }
    },
    async invalidate() {
      revision += 1
      return { revision: String(revision) }
    },
    async prepare() {},
    async dispose() {
      disposed += 1
    },
  })
  const sources = {
    async openModContext(request: ModContextRequest) {
      opened += 1
      // a path under which nothing exists is an error of the loader, not of the transport
      if (request.target !== 'C:/Mods/Mine.SC2Mod')
        throw new Error(`nothing exists at ${String(request.target)}`)
      return context()
    },
    dispose() {},
  } as unknown as ContentSources
  return {
    sources,
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
      expect(context.contextId).toBe('chain')
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
      'chain',
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

  it('lets every client read what one laid over a file, and takes it away when that client goes', async () => {
    const { address, chain } = await daemon()
    const editor = await connectModServer(address)
    const other = await connectModServer(address)
    const edited = await editor.openModContext(request)
    const reading = await other.openModContext(request)
    await edited.overlay!([
      { layerId: 'layer:0', path: UNITS, text: '<Catalog><CUnit id="Unsaved"/></Catalog>' },
    ])
    expect(await reading.query!({ kind: 'units' })).toMatchObject({
      units: '<Catalog><CUnit id="Unsaved"/></Catalog>',
    })
    // The other client hears the server's revision when it asks (an empty overlay).
    expect(reading.revision).toBe('1')
    await editor.close()
    for (let attempt = 0; attempt < 50 && chain.disposed < 1; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(await reading.query!({ kind: 'units' })).toMatchObject({ units: '<Catalog/>' })
    expect(await reading.overlay!([])).toEqual({ revision: '2' })
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
