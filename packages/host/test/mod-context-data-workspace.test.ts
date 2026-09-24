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
