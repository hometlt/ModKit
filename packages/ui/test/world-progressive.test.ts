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
import {
  createWorldLatticePlan,
  drawWorldLattice,
  WORLD_CLIFF_FACE_COLOR,
  WORLD_RAMP_COLOR,
  WORLD_LATTICE_ROLE_COLORS,
  worldLatticeColor,
  worldLatticeObjectAt,
} from '../src/world/lattice.js'

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
      modelResource: {
        id,
        role: 'sidecar' as const,
        scopes: ['workspace-dependency-layer'] as const,
        logicalId: id,
      },
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

  it('does not acquire or report models used only by excluded objects', async () => {
    const calls: string[] = []
    const result = await inspectCandidateWorld(fixture(calls), {
      maxLayers: 8,
      maxItemsPerLayer: 16,
      objectFilter: item => item.derivedFrom === 'cliffs',
    })
    expect(calls.filter(call => call.startsWith('model:'))).toEqual(['model:wall'])
    expect(worldModelAssetStatus(result)).toEqual({ total: 1, converted: 1, partial: false })
    expect(result.layers.flatMap(layer => layer.page.items).filter(item => item.facet === 'objects')
      .map(item => item.id)).toEqual(['wall'])
    calls.length = 0
    const shared = fixture(calls)
    const page = shared.page
    shared.page = async (request, signal) => {
      const result = await page(request, signal)
      return { ...result, items: result.items.map(item => item.facet === 'objects' && item.id === 'wall'
        ? { ...item, modelComponents: [{ id: 'root', resourceId: 'wall' },
          { id: 'child', resourceId: 'tree', parentId: 'root' }] } : item) }
    }
    const attached = await inspectCandidateWorld(shared, { maxLayers: 8, maxItemsPerLayer: 16,
      objectFilter: item => item.derivedFrom === 'cliffs' })
    expect(calls.filter(call => call.startsWith('model:')).sort()).toEqual(['model:tree', 'model:wall'])
    expect(worldModelAssetStatus(attached)).toEqual({ total: 2, converted: 2, partial: false })
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
    for (let y = 0; y < 64; y += 2)
      for (let x = 0; x < 64; x += 2) hits.add(worldLatticeObjectAt(canvas, plan, x, y))
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

  it('keeps explicit cliff faces, mixed roles and disconnected coverage in one compatible space', async () => {
    const source = fixture()
    const items = (
      await Promise.all(
        ['terrain', 'cliffs', 'objects'].map(facet =>
          source.page({ facet: facet as 'terrain', limit: 16 }),
        ),
      )
    ).flatMap(page => page.items)
    const polygon = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.3, y: 0.3 },
    ]
    const distant = [
      { x: 0.6, y: 0.6 },
      { x: 1, y: 0.6 },
      { x: 1, y: 1 },
    ]
    const published: WorldSceneItem[] = items.map(item =>
      item.facet === 'terrain' && item.x === 0 && item.y === 0
        ? { ...item, cliffFace: true }
        : item.facet === 'objects' && item.objectId === 2
          ? {
              ...item,
              latticeCoverage: {
                coordinateSpaceId: 'map-native',
                roles: ['resource', 'destructible'],
                resourceKind: 'oil',
              },
              uvwLatticeCoverage: { blocked: [polygon, distant], noBuild: [], outline: [polygon] },
            }
          : item,
    )
    const plan = createWorldLatticePlan(published)
    expect(plan.cliffFaces).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ])
    expect(plan.objects[0]?.roles).toEqual(['resource', 'destructible'])
    expect(plan.objects[0]?.coverage?.blocked).toHaveLength(2)
    expect(plan.objects[0]?.coverage?.noBuild).toEqual([])
    const fills: string[] = []
    const strokes: string[] = []
    const labels: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textBaseline: '',
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arc() {},
      rect() {},
      fillRect() {},
      fill() {
        fills.push(this.fillStyle)
      },
      stroke() {
        strokes.push(this.strokeStyle)
      },
      fillText(value: string) {
        labels.push(value)
      },
      measureText(value: string) {
        return { width: value.length * 6 }
      },
      createLinearGradient() {
        return { addColorStop() {} }
      },
    }
    drawWorldLattice(
      { width: 160, height: 160, getContext: () => context } as unknown as HTMLCanvasElement,
      plan,
    )
    expect(fills).toContain(WORLD_CLIFF_FACE_COLOR)
    expect(strokes).toContain('#ed583e')
    expect(labels).toContain('oil')
    const otherSpace: WorldSceneItem = {
      ...published.find(item => item.facet === 'objects' && item.objectId === 2)!,
      id: 'other',
      layerId: 'other-objects',
      objectId: 9,
      uvwPosition: { x: 10.75, y: 0, z: 0.5 },
    } as WorldSceneItem
    const otherTerrain = published.flatMap(item =>
      item.facet === 'terrain'
        ? [
            {
              ...item,
              id: `other-${item.id}`,
              layerId: 'other-terrain',
              cliffFace: false,
              uvwPosition: { ...item.uvwPosition!, x: item.uvwPosition!.x + 10 },
            },
          ]
        : [],
    )
    const layer = (
      layerId: string,
      kind: 'terrain' | 'cliffs' | 'objects',
      spaceId: string,
    ): WorldSceneLayerItem => ({
      facet: 'layers',
      id: layerId,
      layerId,
      kind,
      state: 'available',
      itemCount: 1,
      lods: ['exact'],
      spaceId,
    })
    const withSpaces = createWorldLatticePlan([
      layer('terrain', 'terrain', 'a'),
      layer('cliffs', 'cliffs', 'a'),
      layer('objects', 'objects', 'a'),
      layer('other-terrain', 'terrain', 'b'),
      layer('other-objects', 'objects', 'b'),
      ...published,
      ...otherTerrain,
      otherSpace,
    ])
    expect(withSpaces.objects.map(object => object.objectId)).toEqual([2])
    expect(withSpaces.cliffFaces).toHaveLength(1)
    const secondSpace = createWorldLatticePlan(
      [
        layer('terrain', 'terrain', 'a'),
        layer('cliffs', 'cliffs', 'a'),
        layer('objects', 'objects', 'a'),
        layer('other-terrain', 'terrain', 'b'),
        layer('other-objects', 'objects', 'b'),
        ...published,
        ...otherTerrain,
        otherSpace,
      ],
      'b',
    )
    expect(secondSpace.cells).toHaveLength(1)
    expect(secondSpace.objects.map(object => object.objectId)).toEqual([9])
    expect(secondSpace.cliffFaces).toEqual([])
    const objectsOnly = createWorldLatticePlan(
      [layer('other-objects', 'objects', 'b'), otherSpace],
      'b',
    )
    expect(objectsOnly.objects[0]?.point).toEqual([10.75, 0.5])
    expect(objectsOnly.objects[0]?.coverage?.blocked).toHaveLength(2)
  })
})

/** Grid identities stay native while the canonical frame has unequal, reflected cell axes. */
function overviewGrid(
  columns: number,
  rows: number,
  faces: readonly string[],
  layerId = 'terrain',
): WorldSceneItem[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns,
      y = Math.floor(index / columns)
    return {
      facet: 'terrain',
      id: `${layerId}-${x}-${y}`,
      layerId,
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: x,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x: 10 + 2 * x, y: x, z: 20 - 3 * y },
      ...(x < columns - 1 && y < rows - 1 ? { cliffFace: faces.includes(`${x},${y}`) } : {}),
    }
  })
}

/** Record polygon fills separately from point markers and legend symbols. */
function overviewCanvas() {
  const fills: { color: string; polygon: boolean }[] = []
  const strokes: string[] = []
  let polygon = false
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
    clearRect() {},
    fillRect() {},
    moveTo() {},
    closePath() {},
    beginPath() {
      polygon = false
    },
    lineTo() {
      polygon = true
    },
    arc() {
      polygon = false
    },
    rect() {
      polygon = true
    },
    fill() {
      fills.push({ color: String(this.fillStyle), polygon })
    },
    stroke() {
      strokes.push(this.strokeStyle)
    },
    fillText() {},
    measureText(value: string) {
      return { width: value.length * 6 }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
  }
  return {
    fills,
    strokes,
    canvas: { width: 200, height: 200, getContext: () => context } as unknown as HTMLCanvasElement,
  }
}

describe('world lattice overview profile', () => {
  it('marks published ramps and blocked footprints without classifying unknown ground', async () => {
    const source = fixture()
    const items = (
      await Promise.all(
        ['terrain', 'cliffs'].map(facet => source.page({ facet: facet as 'terrain', limit: 16 })),
      )
    )
      .flatMap(page => page.items)
      .map(item => (item.facet === 'cliffs' && item.level === 1 ? { ...item, ramp: true } : item))
    const plan = createWorldLatticePlan(items, undefined, 'overview')
    expect(plan.ramps).toHaveLength(1)
    expect(plan.contours).toEqual([])
    expect(plan.cliffBankFills).toEqual([])
    const draw = overviewCanvas()
    drawWorldLattice(draw.canvas, {
      ...plan,
      objects: [
        {
          point: [0, 0],
          objectId: 1,
          kind: 'feature',
          coverage: {
            outline: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            ],
            blocked: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            ],
          },
        },
      ],
    })
    expect(draw.fills.some(fill => fill.polygon && fill.color === WORLD_RAMP_COLOR)).toBe(true)
    expect(draw.fills.some(fill => fill.polygon && fill.color === 'rgba(237, 88, 62, 0.30)')).toBe(
      true,
    )
    const polygonColors = draw.fills.filter(fill => fill.polygon).map(fill => fill.color)
    expect(polygonColors.indexOf('#b8b8b8')).toBeLessThan(
      polygonColors.indexOf('rgba(237, 88, 62, 0.30)'),
    )
    const unknown = overviewCanvas()
    drawWorldLattice(unknown.canvas, plan)
    expect(unknown.fills.some(fill => fill.color === 'rgba(237, 88, 62, 0.30)')).toBe(false)
  })
  it('keeps the default plan intact and changes only opt-in presentation', () => {
    const items = overviewGrid(3, 2, ['0,0', '1,0'])
    const legacy = createWorldLatticePlan(items)
    expect(createWorldLatticePlan(items, undefined, 'lattice')).toEqual(legacy)
    expect(legacy).not.toHaveProperty('style')
    expect(legacy).not.toHaveProperty('cliffMidlines')
    expect(legacy.cells[0]?.colors[0]).toContain('hsl(90 ')
    const overview = createWorldLatticePlan(items, undefined, 'overview')
    expect(overview.style).toBe('overview')
    expect(overview.cells.map(cell => cell.vertices)).toEqual(
      legacy.cells.map(cell => cell.vertices),
    )
    expect(overview.cliffFaces).toEqual(legacy.cliffFaces)
    expect(overview.contours).toEqual(legacy.contours)
    expect(overview.cells[0]?.colors[0]).toContain('hsl(28 ')
    expect(() => createWorldLatticePlan(items, undefined, 'other' as 'overview')).toThrow(
      'Unknown world lattice style',
    )
  })

  it('does not invent banks from cliff coverage without complete neighboring terrain', () => {
    const plan = createWorldLatticePlan(overviewGrid(3, 2, ['0,0', '1,0']), undefined, 'overview')
    expect(plan.cliffMidlines).toEqual([])
    expect(plan.cliffMidlineStats?.oneBankComponents).toBe(1)
    expect(plan.cliffFaces).toHaveLength(2)
  })

  it('keeps missing-bank diagnostics separate for coincident layers', () => {
    const plan = createWorldLatticePlan(
      [...overviewGrid(2, 2, ['0,0'], 'a'), ...overviewGrid(2, 2, ['0,0'], 'b')],
      undefined,
      'overview',
    )
    expect(plan.cliffFaces).toHaveLength(2)
    expect(plan.cliffMidlineStats?.components).toBe(2)
    expect(plan.cliffMidlines).toEqual([])
  })

  it('uses authored level contours without inventing derived bank lines', async () => {
    const source = fixture()
    const items = (
      await Promise.all(
        ['terrain', 'cliffs'].map(facet => source.page({ facet: facet as 'terrain', limit: 16 })),
      )
    ).flatMap(page => page.items)
    const plan = createWorldLatticePlan(items, undefined, 'overview')
    expect(plan.contours).toHaveLength(1)
    expect(plan.cliffMidlines).toEqual([])
    const draw = overviewCanvas()
    drawWorldLattice(draw.canvas, plan)
    expect(draw.strokes).toContain('#fff')
  })

  it('fills known outlines while unknown and known-empty resource outlines stay point markers', () => {
    const outline = [
      { x: 10, y: 20 },
      { x: 11, y: 20 },
      { x: 11, y: 19 },
    ]
    const objects: WorldSceneItem[] = ['resource', 'destructible', 'resource', 'resource'].map(
      (role, index) => ({
        facet: 'objects',
        id: `object-${index}`,
        layerId: 'objects',
        coordinateSpaceId: 'map-native',
        objectId: index + 1,
        kind: 'feature',
        resourceId: `resource-${index}`,
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 10.5, y: 0, z: 19.5 },
        latticeCoverage: {
          coordinateSpaceId: 'map-native',
          roles: [role as 'resource' | 'destructible'],
        },
        ...(index < 2
          ? { uvwLatticeCoverage: { outline: [outline] } }
          : index === 3
            ? { uvwLatticeCoverage: { outline: [] } }
            : {}),
      }),
    )
    const plan = createWorldLatticePlan(
      [...overviewGrid(2, 2, []), ...objects],
      undefined,
      'overview',
    )
    const draw = overviewCanvas()
    drawWorldLattice(draw.canvas, plan)
    expect(
      draw.fills.filter(fill => fill.polygon && fill.color === WORLD_LATTICE_ROLE_COLORS.resource),
    ).toHaveLength(1)
    expect(draw.fills.filter(fill => fill.polygon && fill.color === '#fff')).toHaveLength(1)
    expect(plan.objects[2]?.coverage).toBeUndefined()
    expect(plan.objects[3]?.coverage?.outline).toEqual([])
    expect(draw.strokes).toContain('#141414')
  })
})
