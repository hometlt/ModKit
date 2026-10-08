import { describe, expect, it, vi } from 'vitest'
import type { ModContext } from '@modkit/vfs/content-sources'
import { createModContextDataWorkspaceInputs } from '../src/mod-context-data-workspace.js'

const encoder = new TextEncoder()

function context(): ModContext {
  const documents = new Map([
    ['core', 'Base.SC2Data/GameData/UnitData.xml', '<Catalog><CUnit id="Marine"/></Catalog>'],
    ['liberty', 'Base.SC2Data/GameData/UnitData.xml', '<Catalog><CUnit id="Marine"><LifeMax value="45"/></CUnit></Catalog>'],
  ].map(([layerId, path, text]) => [`${layerId}/${path}`, text]))
  const read = vi.fn(async (layerId: string, path: string, maxBytes: number) => {
    const text = documents.get(`${layerId}/${path}`)
    if (text === undefined) throw new RangeError(`missing ${layerId}/${path}`)
    const bytes = encoder.encode(text)
    if (bytes.length > maxBytes) throw new RangeError('budget')
    return bytes
  })
  return {
    schemaVersion: 1,
    gameId: 'blizzard/starcraft-2',
    contextId: 'ctx:marine',
    layers: [
      { id: 'core', displayName: 'Core', sourceId: 'local:casc', sourcePath: 'mods/core.sc2mod', role: 'dependency', provenance: 'implicit' },
      { id: 'liberty', displayName: 'Liberty', sourceId: 'local:casc', sourcePath: 'mods/liberty.sc2mod', role: 'primary', provenance: 'opened' },
    ],
    unresolved: [],
    diagnostics: [],
    files: async (layerId, page) => ({
      items: [...documents.keys()].filter(key => key.startsWith(`${layerId}/`))
        .map(key => key.slice(layerId.length + 1))
        .filter(path => path.toLowerCase().startsWith((page.prefix ?? '').toLowerCase())),
    }),
    read,
    locate: async () => undefined,
    dispose: async () => undefined,
  }
}

describe('resolved Data inputs from ModContext', () => {
  it('resolves mixed-case layers without sharing strict hits or misses and keeps legacy aliases', async () => {
    const documents = new Map([
      ['upper/Unit.xml', 'UPPER'],
      ['lower/unit.xml', 'lower'],
      ['legacy/Unit.xml', 'legacy'],
    ])
    const source: ModContext = {
      ...context(),
      gameId: 'test/game',
      contextId: 'mixed-case',
      layers: [
        {
          id: 'upper',
          sourceId: 'strict',
          sourcePath: 'Mods/Base',
          displayName: 'Upper',
          caseSensitive: true,
          role: 'dependency',
          provenance: 'declared',
        },
        {
          id: 'lower',
          sourceId: 'strict',
          sourcePath: 'mods/base',
          displayName: 'Lower',
          caseSensitive: true,
          role: 'dependency',
          provenance: 'declared',
        },
        {
          id: 'legacy',
          sourceId: 'legacy',
          sourcePath: 'Mods/Legacy',
          displayName: 'Legacy',
          role: 'primary',
          provenance: 'opened',
        },
      ],
      files: async layerId => ({
        items: [...documents.keys()]
          .filter(key => key.startsWith(`${layerId}/`))
          .map(key => key.slice(layerId.length + 1)),
      }),
      read: vi.fn(async (layerId, path) => {
        const text = documents.get(`${layerId}/${path}`)
        if (text === undefined) throw new RangeError(path)
        return encoder.encode(text)
      }),
    }
    const { workspace, resources } = createModContextDataWorkspaceInputs(source)
    const lookup = (id: string, logicalId: string, parentResourceId?: string) =>
      resources.resolve({
        id,
        logicalId,
        role: 'buffer',
        scopes: ['workspace-dependency-layer'],
        ...(parentResourceId === undefined ? {} : { parentResourceId }),
      })
    const readText = async (id: string, path: string, expected: string, parent?: string) => {
      const result = await lookup(id, path, parent)
      expect(result.state).toBe('resolved')
      if (result.state !== 'resolved') throw new Error('expected resolved resource')
      try {
        if (result.lease.value.kind !== 'bytes') throw new Error('expected bytes')
        expect(new TextDecoder().decode(await result.lease.value.read(0n, expected.length))).toBe(
          expected,
        )
      } finally {
        await result.lease.release()
      }
    }
    try {
      expect(workspace.loadOrder.map(root => root.sourcePath)).toEqual([
        'Mods/Base',
        'mods/base',
        'Mods/Legacy',
      ])
      expect(await lookup('strict-miss', 'Mods/Base/unit.xml')).toMatchObject({
        state: 'unresolved',
        reason: 'not-found',
      })
      await readText('upper', 'Mods/Base/Unit.xml', 'UPPER')
      await readText('lower', 'mods/base/unit.xml', 'lower', 'upper')
      await readText('upper-again', 'Mods/Base/Unit.xml', 'UPPER')
      expect(await lookup('same-upper-cycle', 'Mods/Base/Unit.xml', 'upper')).toMatchObject({
        state: 'unresolved',
        reason: 'cycle-detected',
      })
      await readText('legacy', 'MODS/LEGACY/UNIT.XML', 'legacy')
      await readText('legacy-cached', 'mods/legacy/unit.xml', 'legacy')
      expect(await lookup('legacy-cycle', 'mods/legacy/unit.xml', 'legacy')).toMatchObject({
        state: 'unresolved',
        reason: 'cycle-detected',
      })
      expect(source.read).toHaveBeenCalledWith('upper', 'Unit.xml', expect.any(Number))
      expect(source.read).toHaveBeenCalledWith('lower', 'unit.xml', expect.any(Number))
      expect(source.read).toHaveBeenCalledWith('legacy', 'Unit.xml', expect.any(Number))
    } finally {
      await resources.dispose()
    }
    expect(() =>
      createModContextDataWorkspaceInputs({
        ...source,
        layers: [source.layers[0]!, { ...source.layers[1]!, caseSensitive: false }],
      }),
    ).toThrow(/ambiguous ModContext layer path/u)
  })

  it('confines a strict nested root when its provider lists siblings or ignores the prefix hint', async () => {
    const paths = ['Maps/Alpha/Data.xml', 'maps/alpha/Data.xml', 'Maps/AlphaOther/Data.xml']
    const source: ModContext = {
      ...context(),
      layers: [{ ...context().layers[1]!, caseSensitive: true }],
      files: async () => ({ items: paths }),
      read: vi.fn(async (_layer, path) => encoder.encode(path)),
    }
    const { workspace, resources, listFiles } = createModContextDataWorkspaceInputs(source, {
      nestedRoot: { parentLayerId: 'liberty', path: 'Maps/Alpha' },
    })
    const root = workspace.loadOrder.at(-1)!
    try {
      expect(await listFiles(root.rootId, '', 10)).toEqual({ paths: ['Data.xml'], complete: true })
      expect(await listFiles(root.rootId, 'data', 10)).toEqual({ paths: [], complete: true })
      const value = await resources.resolve({
        id: 'nested',
        logicalId: `${root.sourcePath}/Data.xml`,
        role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(value.state).toBe('resolved')
      if (value.state === 'resolved') await value.lease.release()
      expect(source.read).toHaveBeenCalledWith('liberty', 'Maps/Alpha/Data.xml', expect.any(Number))
      expect(
        await resources.resolve({
          id: 'wrong',
          logicalId: `${root.sourcePath}/data.xml`,
          role: 'buffer',
          scopes: ['workspace-dependency-layer'],
        }),
      ).toMatchObject({ state: 'unresolved', reason: 'not-found' })
    } finally {
      await resources.dispose()
    }
  })

  it('preserves the loader order and resolves each native document through the owning layer', async () => {
    const source = context()
    const { workspace, resources } = createModContextDataWorkspaceInputs(source)
    try {
      expect(workspace.loadOrder.map(root => root.rootId)).toEqual(['core', 'liberty'])
      expect(workspace.logicalRoots?.map(root => root.rootId)).toEqual(['liberty', 'core'])
      const document = await resources.resolve({
        id: 'marine', logicalId: 'mods/liberty.sc2mod/base.sc2data/gamedata/unitdata.xml',
        role: 'buffer', scopes: ['workspace-dependency-layer'],
      })
      expect(document.state).toBe('resolved')
      if (document.state !== 'resolved') return
      try {
        const value = document.lease.value
        expect(value.kind).toBe('bytes')
        if (value.kind === 'bytes') {
          const chunks = []
          for await (const chunk of value.stream()) chunks.push(chunk)
          expect(new TextDecoder().decode(Buffer.concat(chunks))).toContain('LifeMax')
        }
      } finally {
        await document.lease.release()
      }
      expect(source.read).toHaveBeenCalledWith('liberty', 'Base.SC2Data/GameData/UnitData.xml', expect.any(Number))
    } finally {
      await resources.dispose()
    }
  })

  it('refuses incomplete and path-ambiguous contexts before any Data analysis', () => {
    expect(() => createModContextDataWorkspaceInputs({ ...context(), unresolved: ['Missing.SC2Mod'] })).toThrow(/unresolved dependencies/u)
    const complete = context()
    expect(() => createModContextDataWorkspaceInputs({ ...complete, layers: [complete.layers[0]!, { ...complete.layers[1]!, sourcePath: 'MODS/CORE.SC2MOD' }] })).toThrow(/ambiguous ModContext layer path/u)
  })

  it('keeps the real path of every package folder on disk, also with one source for several', async () => {
    const base = context()
    const { workspace, resources } = createModContextDataWorkspaceInputs(
      {
        ...base,
        layers: [
          base.layers[0]!,
          { id: 'a', displayName: 'A', sourceId: 'host', sourcePath: 'C:\\Mods\\A.SC2Mod', role: 'dependency', provenance: 'declared' },
          { id: 'b', displayName: 'B', sourceId: 'host', sourcePath: 'C:\\Mods\\B.SC2Mod', role: 'primary', provenance: 'opened' },
        ],
      },
      { nestedRoot: { parentLayerId: 'b', path: 'Maps/M.SC2Map' } },
    )
    try {
      expect(workspace.loadOrder.map(root => [root.sourcePath, root.location])).toEqual([
        ['mods/core.sc2mod', undefined],
        ['context-layers/1', 'C:\\Mods\\A.SC2Mod'],
        ['context-layers/2', 'C:\\Mods\\B.SC2Mod'],
        ['context-layers/2/Maps/M.SC2Map', 'C:\\Mods\\B.SC2Mod/Maps/M.SC2Map'],
      ])
      expect(Object.hasOwn(workspace.loadOrder[0]!, 'location')).toBe(false)
    } finally {
      await resources.dispose()
    }
  })

  it('projects a nested map directory through its campaign layer without a second reader', async () => {
    const base = context()
    const mapRelative = 'Base.SC2Maps/Maps/Campaign/TArcade.SC2Map/Objects'
    const read = vi.fn(async (_layerId: string, path: string) => {
      if (path.toLowerCase() !== mapRelative.toLowerCase()) throw new RangeError(path)
      return encoder.encode('<Objects/>')
    })
    const nested: ModContext = {
      ...base,
      layers: [...base.layers, { id: 'campaign', displayName: 'Liberty campaign',
        sourceId: 'local:casc', sourcePath: 'campaigns/liberty.sc2campaign',
        role: 'primary', provenance: 'opened' }],
      files: async (layerId, page) => ({ items: layerId === 'campaign' &&
        mapRelative.toLowerCase().startsWith((page.prefix ?? '').toLowerCase()) ? [mapRelative] : [] }),
      read,
    }
    const { workspace, resources } = createModContextDataWorkspaceInputs(nested, {
      nestedRoot: { parentLayerId: 'campaign', path: 'Base.SC2Maps/Maps/Campaign/TArcade.SC2Map' },
    })
    try {
      expect(workspace.loadOrder.at(-1)?.sourcePath).toBe(
        'campaigns/liberty.sc2campaign/Base.SC2Maps/Maps/Campaign/TArcade.SC2Map',
      )
      const opened = await resources.resolve({ id: 'map-objects',
        logicalId: `${workspace.loadOrder.at(-1)?.sourcePath}/Objects`, role: 'buffer',
        scopes: ['workspace-dependency-layer'] })
      expect(opened.state).toBe('resolved')
      if (opened.state === 'resolved') await opened.lease.release()
      expect(read).toHaveBeenCalledWith('campaign', mapRelative, expect.any(Number))
    } finally { await resources.dispose() }
  })

  it('rejects an unknown or escaping nested root', () => {
    const source = context()
    expect(() => createModContextDataWorkspaceInputs(source, {
      nestedRoot: { parentLayerId: 'missing', path: 'Maps/Example.SC2Map' },
    })).toThrow(/no parent layer/u)
    expect(() => createModContextDataWorkspaceInputs(source, {
      nestedRoot: { parentLayerId: 'liberty', path: '../Example.SC2Map' },
    })).toThrow()
  })
})
