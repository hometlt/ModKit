import { describe, expect, it } from 'vitest'
import {
  createLayeredArchiveContentSources,
  layeredModContext,
  type ContentSourceRoot,
  type LayerArchive,
  type LayerArchiveEntry,
} from '../src/content-sources.js'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const key = (path: string) => path.replaceAll('\\', '/').toLowerCase()

interface Log {
  readonly closed: string[]
  readonly lookups: string[]
}

/**
 * An archive in memory: `named` is what its listing names, `unnamed` what it holds without a name
 * (found only by `lookup`, as an MPQ patch without its file list).
 */
function archive(
  id: string,
  named: Readonly<Record<string, string>>,
  log: Log,
  options: { readonly unnamed?: Readonly<Record<string, string>>; readonly hidden?: string } = {},
): LayerArchive {
  const contents = new Map(
    Object.entries({ ...named, ...options.unnamed }).map(([path, value]) => [key(path), value]),
  )
  const sizeOf = (path: string) => text(contents.get(key(path)) ?? '').byteLength
  const entry = (path: string): LayerArchiveEntry => ({
    path,
    size: sizeOf(path),
    ...(path === options.hidden ? { hidden: true } : {}),
  })
  return {
    id,
    entries: Object.keys(named).map(entry),
    ...(options.unnamed === undefined
      ? {}
      : {
          async lookup(path: string) {
            log.lookups.push(`${id}:${path}`)
            return contents.has(key(path)) ? { path, size: sizeOf(path) } : undefined
          },
        }),
    async read(path, maxBytes) {
      const value = contents.get(key(path))
      if (value === undefined) throw new RangeError(`${id} has no ${path}`)
      const bytes = text(value)
      if (bytes.byteLength > maxBytes)
        throw new RangeError(`${path} is more than ${String(maxBytes)}`)
      return bytes
    },
    close() {
      log.closed.push(id)
    },
  }
}

const root = (id: string): ContentSourceRoot => ({ id, label: id, region: 'local', kind: 'local' })

/** A patch in front of an expansion in front of a base, as a SAGE SkuDef orders them. */
function chain(log: Log): LayerArchive[] {
  return [
    archive('patch.big', { 'Data\\INI\\eva.ini': 'patched eva', 'data/new.txt': 'new' }, log),
    archive('expansion.big', { 'data/ini/eva.ini': 'expansion eva', 'art/unit.dds': 'dds' }, log),
    archive(
      'base.big',
      {
        'data/ini/eva.ini': 'shipped eva',
        'data/ini/gamedata.ini': 'gamedata',
        'readme.txt': 'hi',
      },
      log,
    ),
  ]
}

describe('archives as the one tree a game reads', () => {
  it('serves each path from the highest archive and spells it as the highest names it', async () => {
    const log: Log = { closed: [], lookups: [] }
    const sources = createLayeredArchiveContentSources('Game', [
      { root: root('local:game'), open: async () => chain(log) },
    ])
    expect(await sources.snapshot()).toEqual({
      label: 'Game',
      regions: [],
      connections: [],
      roots: [root('local:game')],
    })
    expect(await sources.list('local:game', '')).toEqual([
      { path: 'art', name: 'art', directory: true },
      { path: 'Data', name: 'Data', directory: true },
      { path: 'readme.txt', name: 'readme.txt', directory: false, size: 2 },
    ])
    // each file keeps the spelling of the archive that names it highest
    expect((await sources.list('local:game', 'DATA/ini')).map(entry => entry.path)).toEqual([
      'Data/INI/eva.ini',
      'data/ini/gamedata.ini',
    ])
    expect(decode(await sources.read('local:game', 'data/ini/EVA.ini', 64))).toBe('patched eva')
    expect(decode(await sources.read('local:game', 'data/ini/gamedata.ini', 64))).toBe('gamedata')

    const layers = await sources.layers('local:game')
    expect(layers.archives).toEqual(['patch.big', 'expansion.big', 'base.big'])
    expect(layers.shadowedCount).toBe(1)
    expect(layers.owner('data/ini/eva.ini')).toEqual({ archive: 'patch.big', rank: 0 })
    expect(layers.shadowedBy('DATA\\INI\\EVA.INI')).toEqual([
      { archive: 'expansion.big', rank: 1 },
      { archive: 'base.big', rank: 2 },
    ])
    expect(layers.owner('nowhere.txt')).toBeUndefined()
    // a hidden copy is still read by its rank
    expect(decode(await layers.read('data/ini/eva.ini', 64, 2))).toBe('shipped eva')
    await expect(layers.read('data/ini/gamedata.ini', 64, 0)).rejects.toThrow(/patch.big holds no/u)
    await expect(sources.read('local:game', 'data/ini/eva.ini', 4)).rejects.toThrow(/more than 4/u)
    await expect(sources.read('local:game', 'missing.ini', 64)).rejects.toThrow(
      /Game has no file «missing.ini»/u,
    )
    await expect(sources.list('local:game', 'nowhere')).rejects.toThrow(/was not found/u)
    await expect(sources.list('local:other', '')).rejects.toThrow(/no Game content source/u)
    await sources.dispose()
    expect(log.closed).toEqual(['patch.big', 'expansion.big', 'base.big'])
  })

  it('pages files beneath a folder, narrowed by extension and by an in-order pattern', async () => {
    const log: Log = { closed: [], lookups: [] }
    const sources = createLayeredArchiveContentSources('Game', [
      { root: root('local:game'), open: async () => chain(log) },
    ])
    const first = await sources.files('local:game', 'data', { pattern: 'ini', limit: 1 })
    expect(first).toEqual({ items: [{ path: 'Data/INI/eva.ini', size: 11 }], nextCursor: '2' })
    expect(
      await sources.files('local:game', 'data', {
        pattern: 'ini',
        cursor: first.nextCursor ?? '',
        limit: 5,
      }),
    ).toEqual({ items: [{ path: 'data/ini/gamedata.ini', size: 8 }] })
    expect(await sources.files('local:game', '', { extensions: ['txt'], limit: 10 })).toEqual({
      items: [
        { path: 'data/new.txt', size: 3 },
        { path: 'readme.txt', size: 2 },
      ],
    })
    await expect(sources.files('local:game', '', { limit: 0 })).rejects.toThrow(/page limit/u)
    await expect(sources.files('local:game', '', { cursor: '-1', limit: 1 })).rejects.toThrow(
      /cursor/u,
    )
    await sources.dispose()
  })

  it('lets an archive without names serve what it finds by path, and read what nobody names', async () => {
    const log: Log = { closed: [], lookups: [] }
    const patch = archive('patch.mpq', {}, log, {
      unnamed: { 'units\\unitdata.slk': 'patched slk', 'scripts\\war3patch.j': 'patch only' },
    })
    const base = archive(
      'war3.mpq',
      { 'Units\\UnitData.slk': 'shipped slk', '(listfile)': 'names' },
      log,
      { hidden: '(listfile)' },
    )
    const sources = createLayeredArchiveContentSources('Warcraft III', [
      { root: root('local:war3'), open: async () => [patch, base] },
    ])
    // the name comes from the base's list, the bytes from the patch that holds the path
    expect(decode(await sources.read('local:war3', 'units/unitdata.slk', 64))).toBe('patched slk')
    expect(await sources.files('local:war3', '', { limit: 10 })).toEqual({
      items: [
        { path: '(listfile)', size: 5, hidden: true },
        { path: 'Units/UnitData.slk', size: 11 },
      ],
    })
    const layers = await sources.layers('local:war3')
    expect(layers.owner('units/unitdata.slk')).toEqual({ archive: 'patch.mpq', rank: 0 })
    expect(layers.shadowedCount).toBe(1)
    // nobody names it, so it is not listed, but a read finds it in the patch by path
    expect(decode(await sources.read('local:war3', 'Scripts/war3patch.j', 64))).toBe('patch only')
    expect(log.lookups).toContain('patch.mpq:Units/UnitData.slk')
    await sources.dispose()
  })

  it('opens on first use, retries a refused open, and reopens after refresh', async () => {
    const log: Log = { closed: [], lookups: [] }
    let opens = 0
    const sources = createLayeredArchiveContentSources('Game', [
      {
        root: root('local:game'),
        async open() {
          opens += 1
          if (opens === 1) throw new Error('the game is patching')
          return chain(log)
        },
      },
    ])
    expect(opens).toBe(0)
    await expect(sources.list('local:game', '')).rejects.toThrow(/patching/u)
    expect((await sources.list('local:game', '')).length).toBe(3)
    await sources.read('local:game', 'readme.txt', 8)
    expect(opens).toBe(2)
    await sources.refresh('local:game')
    expect(log.closed).toEqual(['patch.big', 'expansion.big', 'base.big'])
    await sources.list('local:game', '')
    expect(opens).toBe(3)
    await sources.dispose()
    await expect(sources.connect('local')).rejects.toThrow(/Game content sources have no accounts/u)
    await expect(sources.search('local', 'x')).rejects.toThrow(/no catalogue/u)
  })

  it('closes the archives it was given when merging them fails', async () => {
    const log: Log = { closed: [], lookups: [] }
    const failing: LayerArchive = {
      ...archive('broken.mpq', {}, log, { unnamed: {} }),
      async lookup() {
        throw new Error('hash table damaged')
      },
    }
    const sources = createLayeredArchiveContentSources('Game', [
      { root: root('local:game'), open: async () => [failing, ...chain(log)] },
    ])
    await expect(sources.list('local:game', '')).rejects.toThrow(/damaged/u)
    expect(log.closed).toEqual(['broken.mpq', 'patch.big', 'expansion.big', 'base.big'])
  })
})

describe('the mod context of a layered installation', () => {
  it('opens a file of a root over the whole installation, as a game without packages does', async () => {
    const log: Log = { closed: [], lookups: [] }
    const sources = createLayeredArchiveContentSources(
      'Game',
      [{ root: root('local:game'), open: async () => chain(log) }],
      { modContext: { gameId: 'test/game' } },
    )
    expect(
      await sources.locateModPackage!({ sourceId: 'local:game', path: 'art/unit.dds' }),
    ).toEqual({ kind: 'loose' })
    expect(await sources.locateModPackage!({ sourceId: 'local:other', path: 'a' })).toEqual({
      kind: 'foreign',
    })
    expect(await sources.locateModPackage!('C:/Games/unit.dds')).toEqual({ kind: 'foreign' })
    const context = await sources.openModContext!({
      schemaVersion: 1,
      target: { sourceId: 'local:game', path: 'Art/Unit.dds' },
    })
    expect(context.gameId).toBe('test/game')
    expect(
      context.layers.map(layer => [layer.id, layer.role, layer.kind, layer.sourcePath]),
    ).toEqual([
      ['installation', 'dependency', 'files', ''],
      ['opened', 'primary', 'files', 'Art/Unit.dds'],
    ])
    expect(context.layers.some(layer => 'content' in layer)).toBe(false)
    // the installation lists every served file once; pages narrow by prefix without case
    expect((await context.files('installation', { limit: 10, prefix: 'DATA/' })).items).toEqual([
      'Data/INI/eva.ini',
      'data/ini/gamedata.ini',
      'data/new.txt',
    ])
    const first = await context.files('installation', { limit: 2 })
    expect(first).toEqual({ items: ['art/unit.dds', 'Data/INI/eva.ini'], nextCursor: '2' })
    expect((await context.files('opened', { limit: 10 })).items).toEqual(['Unit.dds'])
    // the highest layer that lists a path serves it
    expect(await context.locate('data/ini/EVA.ini')).toEqual({
      layerId: 'installation',
      path: 'Data/INI/eva.ini',
    })
    expect(await context.locate('unit.dds')).toEqual({ layerId: 'opened', path: 'Unit.dds' })
    expect(await context.locate('missing.txt')).toBeUndefined()
    expect(decode(await context.read('opened', 'unit.dds', 64))).toBe('dds')
    expect(decode(await context.read('installation', 'data/ini/eva.ini', 64))).toBe('patched eva')
    await expect(context.read('installation', 'missing.txt', 64)).rejects.toThrow(/not a file/u)
    await expect(context.read('nowhere', 'readme.txt', 64)).rejects.toThrow(/no layer/u)
    await context.dispose()
    // the root itself opens as the installation alone
    const whole = await sources.openModContext!({
      schemaVersion: 1,
      target: { sourceId: 'local:game', path: '' },
    })
    expect(whole.layers.map(layer => [layer.id, layer.role])).toEqual([['installation', 'primary']])
    await expect(
      sources.openModContext!({ schemaVersion: 1, target: 'C:/Games/unit.dds' }),
    ).rejects.toThrow(TypeError)
    // without a gameId of its own, a root's game names the context: one call, several games
    const several = createLayeredArchiveContentSources(
      'Earth',
      [
        {
          root: { ...root('local:earth-2150'), game: 'realitypump/earth-2150' },
          open: async () => chain(log),
        },
        { root: root('local:anonymous'), open: async () => chain(log) },
      ],
      { modContext: {} },
    )
    const earth = await several.openModContext!({
      schemaVersion: 1,
      target: { sourceId: 'local:earth-2150', path: 'readme.txt' },
    })
    expect(earth.gameId).toBe('realitypump/earth-2150')
    await expect(
      several.openModContext!({
        schemaVersion: 1,
        target: { sourceId: 'local:anonymous', path: 'readme.txt' },
      }),
    ).rejects.toThrow(/names no game/u)
  })

  it('opens a host path inside the installation folder, an archive member as the file the tree serves', async () => {
    const log: Log = { closed: [], lookups: [] }
    const sources = createLayeredArchiveContentSources(
      'Game',
      [
        {
          root: { ...root('local:game'), storageOf: 'F:\\Games\\The Game\\' },
          open: async () => chain(log),
        },
      ],
      { modContext: { gameId: 'test/game' } },
    )
    // a member of an archive opened from disk (a model inside expansion.big, its textures beside)
    const member = 'f:/games/THE GAME/expansion.big/Art/Unit.dds'
    expect(await sources.locateModPackage!(member)).toEqual({ kind: 'loose' })
    expect(await sources.locateModPackage!('F:/Games/Another Game/unit.dds')).toEqual({
      kind: 'foreign',
    })
    const context = await sources.openModContext!({ schemaVersion: 1, target: member })
    expect(context.layers.map(layer => [layer.id, layer.role, layer.sourcePath])).toEqual([
      ['installation', 'dependency', ''],
      ['opened', 'primary', 'Art/Unit.dds'],
    ])
    // the rest of the installation is there for it: a file of another archive by its path
    expect(await context.locate('data/ini/gamedata.ini')).toEqual({
      layerId: 'installation',
      path: 'data/ini/gamedata.ini',
    })
    await context.dispose()
    // a loose file of the folder opens at its path under it
    const loose = await sources.openModContext!({
      schemaVersion: 1,
      target: 'F:/Games/The Game/readme.txt',
    })
    expect(loose.layers.at(-1)?.sourcePath).toBe('readme.txt')
    await loose.dispose()
  })

  it('reads an opened archive over the installation, without its hidden entries, and closes it', async () => {
    const log: Log = { closed: [], lookups: [] }
    const sources = createLayeredArchiveContentSources('Game', [
      { root: root('local:game'), open: async () => chain(log) },
    ])
    const map = archive('map.w3x', { 'war3map.j': 'map script', '(listfile)': 'names' }, log, {
      hidden: '(listfile)',
    })
    const context = layeredModContext(sources, {
      gameId: 'test/game',
      contextId: 'test:map',
      layers: [
        {
          id: 'game',
          displayName: 'Game',
          sourceId: 'local:game',
          sourcePath: '',
          role: 'dependency',
          provenance: 'implicit',
          kind: 'files',
          content: { root: 'local:game' },
        },
        {
          id: 'map',
          displayName: 'map.w3x',
          sourceId: 'host',
          sourcePath: 'C:/Maps/map.w3x',
          role: 'primary',
          provenance: 'opened',
          kind: 'package',
          content: { archive: map },
        },
      ],
    })
    expect((await context.files('map', { limit: 10 })).items).toEqual(['war3map.j'])
    expect(decode(await context.read('map', 'WAR3MAP.J', 64))).toBe('map script')
    await expect(context.read('map', '(listfile)', 64)).rejects.toThrow(/not a file/u)
    expect(await context.locate('readme.txt')).toEqual({ layerId: 'game', path: 'readme.txt' })
    await context.dispose()
    expect(log.closed).toEqual(['map.w3x'])
    expect(() =>
      layeredModContext(sources, {
        gameId: 'g',
        contextId: 'c',
        layers: [
          { ...context.layers[0]!, content: { root: 'local:game' } },
          { ...context.layers[0]!, content: { root: 'local:game' } },
        ],
      }),
    ).toThrow(/repeat/u)
  })
})
