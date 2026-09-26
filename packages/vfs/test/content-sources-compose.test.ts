import { describe, expect, it } from 'vitest'
import {
  composeContentSources,
  type ContentSources,
  type ModContext,
  type ModPackagePlacement,
} from '../src/content-sources.js'

function part(
  name: string,
  extra: Partial<ContentSources> & { readonly runtimePreparer?: unknown } = {},
): ContentSources {
  return {
    async snapshot() {
      return {
        label: name,
        regions: [{ id: `${name}:region`, label: name }],
        connections: [],
        roots: [{ id: `${name}:root`, label: name, region: `${name}:region`, kind: 'local' }],
      }
    },
    async connect() {},
    async disconnect() {},
    async search() {
      return []
    },
    async add() {},
    async remove() {},
    async refresh() {},
    async list(sourceId) {
      return [{ path: `${name} listed ${sourceId}`, name, directory: false }]
    },
    async read() {
      return new TextEncoder().encode(name)
    },
    async dispose() {},
    ...extra,
  }
}

const context = (gameId: string): ModContext =>
  ({
    schemaVersion: 1,
    gameId,
    contextId: gameId,
    layers: [],
    unresolved: [],
    diagnostics: [],
  }) as unknown as ModContext

describe('several extensions’ content sources as one catalogue', () => {
  it('routes each call to the part whose snapshot names the id', async () => {
    const composed = composeContentSources([part('sc2'), part('roblox')])
    const snapshot = await composed.snapshot()
    expect(snapshot.roots.map(root => root.id)).toEqual(['sc2:root', 'roblox:root'])
    expect(snapshot.label).toBe('sc2 · roblox')
    expect((await composed.list('roblox:root', ''))[0]?.path).toBe('roblox listed roblox:root')
    expect(new TextDecoder().decode(await composed.read('sc2:root', 'x', 8))).toBe('sc2')
    await expect(composed.list('nobody:root', '')).rejects.toThrow(/no content source module owns/)
  })

  it('refuses two parts naming the same root', async () => {
    const composed = composeContentSources([part('same'), part('same')])
    await expect(composed.snapshot()).rejects.toThrow(/two content source modules name the region/)
  })

  it('offers an optional method only when some part supports it', async () => {
    const plain = composeContentSources([part('a'), part('b')])
    expect(plain.download).toBeUndefined()
    expect(plain.openModContext).toBeUndefined()
    const downloads = composeContentSources([
      part('a'),
      part('b', { download: async () => 'fetched' }),
    ])
    await downloads.snapshot()
    expect(await downloads.download?.('b:root', 'rbxassetid/1')).toBe('fetched')
    await expect(downloads.download?.('a:root', 'x')).rejects.toThrow(/does not support download/)
  })

  it('opens a host path in the part that places it in a package, else in the first that opens', async () => {
    const place = async (target: unknown): Promise<ModPackagePlacement> =>
      String(target).endsWith('.rbxl')
        ? { kind: 'package', sourceId: 'host', path: String(target), displayName: 'place' }
        : { kind: 'loose' }
    const composed = composeContentSources([
      part('sc2', {
        openModContext: async () => context('blizzard/starcraft-2'),
        locateModPackage: async () => ({ kind: 'loose' }),
      }),
      part('roblox', {
        openModContext: async () => context('roblox/roblox'),
        locateModPackage: place,
      }),
    ])
    expect(
      (await composed.openModContext!({ schemaVersion: 1, target: 'C:/Work/Place.rbxl' })).gameId,
    ).toBe('roblox/roblox')
    expect(
      (await composed.openModContext!({ schemaVersion: 1, target: 'C:/Work/Script.galaxy' }))
        .gameId,
    ).toBe('blizzard/starcraft-2')
    expect((await composed.locateModPackage!('C:/Work/Script.galaxy')).kind).toBe('loose')
  })

  it('gives a loose file to the module that accepts it, not to one that calls it foreign', async () => {
    const composed = composeContentSources([
      part('dow', {
        openModContext: async () => context('relic/dawn-of-war'),
        locateModPackage: async target =>
          String(target).endsWith('.galaxy') ? { kind: 'foreign' } : { kind: 'loose' },
      }),
      part('sc2', {
        openModContext: async () => context('blizzard/starcraft-2'),
        locateModPackage: async () => ({ kind: 'loose' }),
      }),
    ])
    expect(
      (await composed.openModContext!({ schemaVersion: 1, target: 'C:/Work/Script.galaxy' }))
        .gameId,
    ).toBe('blizzard/starcraft-2')
    expect(
      (await composed.openModContext!({ schemaVersion: 1, target: 'C:/Work/notes.txt' })).gameId,
    ).toBe('relic/dawn-of-war')
    const alone = composeContentSources([
      part('dow', {
        openModContext: async () => context('relic/dawn-of-war'),
        locateModPackage: async () => ({ kind: 'foreign' }),
      }),
      part('wz', { list: async () => [] }),
    ])
    expect((await alone.locateModPackage!('C:/Work/Script.galaxy')).kind).toBe('missing')
    await expect(
      alone.openModContext!({ schemaVersion: 1, target: 'C:/Work/Script.galaxy' }),
    ).rejects.toThrow(/no content source module/)
  })

  it('carries every part’s Runtime preparer and returns one part unchanged', () => {
    const sc2 = part('sc2', { runtimePreparer: { gameId: 'blizzard/starcraft-2' } })
    const composed = composeContentSources([
      sc2,
      part('wz', { runtimePreparer: { gameId: 'warzone/2100' } }),
    ]) as ContentSources & {
      readonly runtimePreparers?: readonly { readonly gameId: string }[]
    }
    expect(composed.runtimePreparers?.map(item => item.gameId)).toEqual([
      'blizzard/starcraft-2',
      'warzone/2100',
    ])
    expect(composeContentSources([sc2])).toBe(sc2)
  })
})
