import { describe, expect, it } from 'vitest'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneItem,
  WorldSceneLayerItem,
} from '@modkit/sdk/maps'
import {
  inspectCandidateWorld,
  worldModelAssetStatus,
  type CandidateWorldViewerModel,
  type WorldLoadProgress,
} from '../src/world/index.js'
import { createWorldLatticePlan, worldLatticeColor, worldLatticeObjectAt } from '../src/world/lattice.js'

function fixture(log: string[] = []): CandidateWorldSceneSource {
  const items: WorldSceneItem[] = [
    ...Array.from({ length: 4 }, (_, i) => ({
      facet: 'terrain' as const,
      id: `t${i}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact' as const,
      x: i % 2,
      y: Math.floor(i / 2),
      heightBase: i % 2,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x: i % 2, y: i % 2, z: Math.floor(i / 2) },
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      facet: 'cliffs' as const,
      id: `c${i}`,
      layerId: 'cliffs',
      coordinateSpaceId: 'height-grid' as const,
      lod: 'exact' as const,
      x: i % 2,
      y: Math.floor(i / 2),
      level: i % 2,
      authored: true,
    })),
    {
      facet: 'objects',
      id: 'wall',
      layerId: 'objects',
      coordinateSpaceId: 'map-native',
      objectId: 1,
      kind: 'doodad',
      derivedFrom: 'cliffs',
      resourceId: 'wall',
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 },
    },
    {
      facet: 'objects',
      id: 'tree',
      layerId: 'objects',
      coordinateSpaceId: 'map-native',
      objectId: 2,
      kind: 'doodad',
      resourceId: 'tree',
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0.75, y: 0, z: 0.5 },
    },
    ...['tree', 'wall'].map(id => ({
      facet: 'resources' as const,
      id,
      layerId: 'resources',
      kind: 'uvm' as const,
      objectIds: id === 'tree' ? ['2', '3', '4'] : ['1'],
      modelResource: { id, role: 'sidecar' as const, scopes: ['workspace-dependency-layer'] as const, logicalId: id },
      resolved: false,
    })),
  ]
  const layers = ['terrain', 'cliffs', 'objects', 'resources'].map(kind => ({
    facet: 'layers',
    id: kind,
    layerId: kind,
    kind,
    state: 'available',
    itemCount: items.filter(item => item.facet === kind).length,
    lods: ['exact'],
    ...(kind === 'terrain'
      ? { materials: [{ materialId: 'sand', baseColorResourceId: 'sand' }] }
      : {}),
  })) as WorldSceneLayerItem[]
  const info = {
    contract: 'common.view/world-scene-source',
    major: 1,
    snapshotId: 'fixture',
    maturity: 'publisher-candidate',
    mapId: 'test',
    coordinateSpaces: [],
    crossSpaceTransforms: [],
    bounds: [],
    facets: [],
    provenance: [],
    unknownFacets: [],
    lossPolicy: 'explicit-partial',
    complete: true,
  } as CandidateWorldSceneInfo
  return {
    contract: info.contract,
    major: 1,
    snapshotId: info.snapshotId,
    async info() {
      return info
    },
    async page(request) {
      return {
        snapshotId: info.snapshotId,
        facet: request.facet,
        state: 'available',
        items:
          request.facet === 'layers' ? layers : items.filter(item => item.facet === request.facet),
      }
    },
    async texture(id) {
      log.push(`texture:${id}`)
      return {
        state: 'decoded',
        texture: { id, width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) },
        diagnostics: [],
      }
    },
    async model(id) {
      log.push(`model:${id}`)
      return {
        state: 'converted',
        sourceKey: id,
        meshes: [],
        primitives: [],
        diagnostics: [],
        complete: true,
      }
    },
  }
}

describe('progressive world preview', () => {
  it('publishes independent geometry/texture/cliff/object snapshots in that order', async () => {
    const calls: string[] = []
    const updates: { model: CandidateWorldViewerModel; progress: WorldLoadProgress }[] = []
    const result = await inspectCandidateWorld(fixture(calls), {
      maxLayers: 8,
      maxItemsPerLayer: 16,
      onProgress(model, progress) {
        calls.push(progress.phase)
        updates.push({ model, progress })
      },
    })
    expect(calls[0]).toBe('geometry')
    expect(calls.indexOf('texture:sand')).toBeLessThan(calls.indexOf('model:wall'))
    expect(calls.indexOf('model:wall')).toBeLessThan(calls.indexOf('model:tree'))
    const initial = updates[0]?.model
    if (initial === undefined) throw new Error('initial snapshot was not published')
    expect(initial.models?.size).toBe(0)
    expect(initial.terrainTextures?.size).toBe(0)
    expect(result.models?.size).toBe(2)
    expect(result.terrainTextures?.size).toBe(1)
    expect(initial.models?.size).toBe(0)
    expect(initial.layers).toBe(result.layers)
    const cliffs = updates.find(
      update => update.progress.phase === 'cliffs' && update.progress.completed === 1,
    )?.model
    if (cliffs?.models === undefined) throw new Error('cliff snapshot was not published')
    expect([...cliffs.models.keys()]).toEqual(['wall'])
    expect(result.models).not.toBe(cliffs.models)
  })

  it('cancels between geometry and assets without dispatching texture or model requests', async () => {
    const abort = new AbortController()
    const calls: string[] = []
    await expect(
      inspectCandidateWorld(fixture(calls), {
        maxLayers: 8,
        maxItemsPerLayer: 16,
        signal: abort.signal,
        onProgress: () => abort.abort(new Error('closed')),
      }),
    ).rejects.toThrow('closed')
    expect(calls).toEqual([])
  })

  it('reports advertised models omitted by the bounded preview', async () => {
    const result = await inspectCandidateWorld(fixture(), {
      maxLayers: 8,
      maxItemsPerLayer: 16,
      maxModels: 1,
    })
    expect(worldModelAssetStatus(result)).toEqual({ total: 2, converted: 1, partial: true })
    expect(result.models?.get('wall')?.state).toBe('converted')
    expect(result.models?.get('tree')?.state).toBe('unresolved')
  })

  it('builds the filled height lattice and cliff contours without opening any assets', async () => {
    const source = fixture()
    const items = (
      await Promise.all(
        ['terrain', 'cliffs', 'objects'].map(facet =>
          source.page({ facet: facet as 'terrain', limit: 16 }),
        ),
      )
    ).flatMap(page => page.items)
    const plan = createWorldLatticePlan(items)
    expect(plan.cells).toHaveLength(1)
    expect(plan.cells[0]?.colors[0]).not.toBe(plan.cells[0]?.colors[1])
    expect(plan.contours).toEqual([
      [
        [0.5, 0],
        [0.5, 1],
      ],
    ])
    expect(plan.objects).toEqual([{ point: [0.75, 0.5], objectId: 2, kind: 'doodad' }])
    // A click on the drawn point selects it; one far from every point selects nothing.
    const canvas = { width: 64, height: 64 }
    const hits = new Set<number | undefined>()
    for (let y = 0; y < 64; y += 2) for (let x = 0; x < 64; x += 2) hits.add(worldLatticeObjectAt(canvas, plan, x, y))
    expect(hits).toEqual(new Set([2, undefined]))
    expect(worldLatticeObjectAt(canvas, plan, 0, 0)).toBeUndefined()
    expect(worldLatticeColor(0, 0, 1, true)).toContain('207')
    expect(plan.ramps).toEqual([])
    expect(plan.flat).toBe(false)
    // terrain of one height (a 2D game's map) is flat: its lattice would draw one colour
    const level = createWorldLatticePlan(
      items.map(item =>
        item.facet === 'terrain' && item.uvwPosition !== undefined
          ? { ...item, uvwPosition: { ...item.uvwPosition, y: 0 } }
          : item,
      ),
    )
    expect(level.flat).toBe(true)
  })

  it('draws a ramp as its cells, with no cliff line across it', async () => {
    const source = fixture()
    const items = (
      await Promise.all(
        ['terrain', 'cliffs'].map(facet => source.page({ facet: facet as 'terrain', limit: 16 })),
      )
    ).flatMap(page => page.items)
    // The same step, but the publisher marks its higher side as ramp ground.
    const ramped = items.map(item =>
      item.facet === 'cliffs' && item.level === 1 ? { ...item, ramp: true } : item,
    )
    const plan = createWorldLatticePlan(ramped)
    expect(plan.contours).toEqual([])
    expect(plan.ramps).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ])
  })
})
