import { describe, expect, it } from 'vitest'
import {
  composeContentSources,
  hiddenPathMatcher,
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

  it('carries every part’s Runtime preparer and one part’s own members', () => {
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
    const alone = composeContentSources([sc2]) as ContentSources & {
      readonly runtimePreparer?: { readonly gameId: string }
    }
    expect(alone.runtimePreparer?.gameId).toBe('blizzard/starcraft-2')
    expect(alone.files).toBeUndefined()
  })
})

describe('hidden entries of a content source', () => {
  const source = (hiddenPaths?: readonly string[]) =>
    composeContentSources([
      part('casc', {
        async snapshot() {
          return {
            label: 'casc',
            regions: [],
            connections: [],
            roots: [
              {
                id: 'local:casc',
                label: 'CASC',
                region: 'local',
                kind: 'local',
                ...(hiddenPaths === undefined ? {} : { hiddenPaths }),
              },
            ],
          }
        },
        async list() {
          return [
            { path: 'versions.winarchive', name: 'versions.winarchive', directory: true },
            { path: 'mods', name: 'mods', directory: true },
            { path: 'thumbs.db', name: 'thumbs.db', directory: false, hidden: true },
          ]
        },
        async files(_sourceId, _path, query) {
          return {
            items: [
              { path: 'Versions.WinArchive/Base.SC2Data' },
              { path: 'mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml' },
              { path: 'mods/.DS_Store' },
            ],
            ...(query.cursor === undefined ? { nextCursor: 'more' } : {}),
          }
        },
      }),
    ])

  it('leaves out what the root hides or the source marks, unless asked, then marks it', async () => {
    const hiding = source(['versions.*archive', '**/.ds_store'])
    expect((await hiding.list('local:casc', '')).map(entry => entry.path)).toEqual(['mods'])
    expect(await hiding.list('local:casc', '', { includeHidden: true })).toEqual([
      { path: 'versions.winarchive', name: 'versions.winarchive', directory: true, hidden: true },
      { path: 'mods', name: 'mods', directory: true },
      { path: 'thumbs.db', name: 'thumbs.db', directory: false, hidden: true },
    ])
    const page = await hiding.files!('local:casc', '', { limit: 10 })
    expect(page).toEqual({
      items: [{ path: 'mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml' }],
      nextCursor: 'more',
    })
    const all = await hiding.files!('local:casc', '', { limit: 10, includeHidden: true })
    expect(all?.items.filter(item => item.hidden).map(item => item.path)).toEqual([
      'Versions.WinArchive/Base.SC2Data',
      'mods/.DS_Store',
    ])
    expect(
      new TextDecoder().decode(await hiding.read('local:casc', 'versions.winarchive/x', 8)),
    ).toBe('casc')
  })

  it('hides only what is marked when the root declares no rules', async () => {
    expect((await source().list('local:casc', '')).map(entry => entry.path)).toEqual([
      'versions.winarchive',
      'mods',
    ])
  })
})

describe('hidden path rules', () => {
  it('match a path or one of its folders, one segment per star, any folders per double star', () => {
    const hidden = hiddenPathMatcher(['__MACOSX', '**/.DS_Store', 'data/*.tmp', 'a?c/**'])
    expect(hidden('__macosx')).toBe(true)
    expect(hidden('__MACOSX/Photos/._x.png')).toBe(true)
    expect(hidden('.ds_store')).toBe(true)
    expect(hidden('one/two/.DS_Store')).toBe(true)
    expect(hidden('data/x.tmp')).toBe(true)
    expect(hidden('data/sub/x.tmp')).toBe(false)
    expect(hidden('abc/deep/file')).toBe(true)
    expect(hidden('/abc')).toBe(true)
    expect(hidden('ab/c')).toBe(false)
    expect(hidden('not__MACOSX')).toBe(false)
    expect(hidden('data.tmp')).toBe(false)
    expect(hiddenPathMatcher([])('anything')).toBe(false)
    expect(hiddenPathMatcher(['**'])('anything')).toBe(false)
  })
})

describe('the entry at an exact path', () => {
  it('is asked of the part that owns the source, and of nobody when it cannot answer', async () => {
    const composed = composeContentSources([
      part('sc2'),
      part('roblox', {
        async lookup(sourceId, path) {
          return { path: `${sourceId}/${path}`, name: path, directory: false }
        },
      }),
    ])
    expect(await composed.lookup?.('roblox:root', 'mesh/123')).toEqual({
      path: 'roblox:root/mesh/123',
      name: 'mesh/123',
      directory: false,
    })
    expect(await composed.lookup?.('sc2:root', 'x')).toBeUndefined()
  })

  it('refreshes the host files in every part that read them, failing only when all refuse', async () => {
    const refreshed: string[] = []
    const reading = (name: string) =>
      part(name, {
        async refresh(sourceId) {
          refreshed.push(`${name}:${sourceId}`)
        },
      })
    const refusing = (name: string) =>
      part(name, {
        async refresh(sourceId) {
          throw new RangeError(`${name} owns no ${sourceId}`)
        },
      })
    // a mod folder on disk (HOST_LAYER_SOURCE_ID) belongs to no part's snapshot
    await composeContentSources([refusing('roblox'), reading('sc2')]).refresh('host')
    expect(refreshed).toEqual(['sc2:host'])
    await expect(
      composeContentSources([refusing('a'), refusing('b')]).refresh('host'),
    ).rejects.toThrow(/owns no host/)
    // any other id still goes to its one part
    await composeContentSources([reading('sc2'), reading('roblox')]).refresh('roblox:root')
    expect(refreshed).toEqual(['sc2:host', 'roblox:roblox:root'])
  })
})
