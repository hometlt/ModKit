import { describe, expect, it } from 'vitest'
import type { CandidateWorldSceneInfo, CandidateWorldSceneSource, WorldSceneItem } from '@modkit/sdk/maps'
import { createUvwWorldSceneSource, materializeWorldToUvw, parseUvwProfile } from '../src/world/index.js'

const snapshotId = 'lattice-native'
const terrainLayer = 'native:terrain'
const objectsLayer = 'native:objects'
const triangle = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]] as const
const options = { maxPageItems: 32, maxTerrainItems: 9, maxFacetItems: 32, maxOutputBytes: 100_000 }

const info: CandidateWorldSceneInfo = {
  contract: 'example.publisher/world-source', major: 1, maturity: 'publisher-candidate',
  snapshotId, mapId: 'lattice-map', gameId: 'warzone/2100',
  coordinateSpaces: [{
    id: 'uvw-canonical', horizontalAxes: ['x', 'z'], verticalAxis: 'y', handedness: 'right',
    linearUnit: 'source-unit', rotationUnit: 'radian', origin: 'measured',
  }],
  crossSpaceTransforms: [{ from: 'map-native', to: 'uvw-canonical', state: 'known' }],
  bounds: [{
    facet: 'terrain', coordinateSpaceId: 'uvw-canonical',
    x: { state: 'known', minimum: 0, maximum: 2 },
    y: { state: 'known', minimum: 0, maximum: 0 },
    z: { state: 'known', minimum: 0, maximum: 2 },
  }],
  uvwTransform: {
    schemaVersion: 1, snapshotId, sourceCoordinateSpaceId: 'map-native',
    targetCoordinateSpaceId: 'uvw-canonical',
    basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'source-unit', sourceUnit: 'example-game-unit', unitsPerCell: 1 },
    axes: {
      x: { sourceAxis: 'x', scale: 1, offset: 0 },
      y: { sourceAxis: 'z', scale: 1, offset: 0 },
      z: { sourceAxis: 'y', scale: -1, offset: 0 },
    },
    heightfield: { columns: 3, rows: 3, cellSize: 1, origin: [0, 0, 0], sourceRowOrder: 'reverse' },
    bounds: {
      coordinateSpaceId: 'uvw-canonical',
      minimum: { x: 0, y: 0, z: 0 }, maximum: { x: 2, y: 0, z: 2 },
    },
    proof: {
      kind: 'adapter-qualification', method: 'sealed-legacy-differential', oracle: 'fixture',
      corpus: '3x3', sourceDigests: { input: `sha256:${'1'.repeat(64)}` }, tupleCount: 9,
      comparison: 'ieee-754-binary64-exact',
      nativeTupleDigest: `sha256:${'2'.repeat(64)}`,
      canonicalTupleDigest: `sha256:${'3'.repeat(64)}`,
    },
  },
  facets: [
    { facet: 'terrain', layerId: terrainLayer, state: 'available', itemCount: 9, lods: ['exact'] },
    { facet: 'objects', layerId: objectsLayer, state: 'available', itemCount: 2, lods: ['exact'] },
  ],
  provenance: [], unknownFacets: [], lossPolicy: 'explicit-partial', complete: true,
}

function nativeSource(cliffs: 'known' | 'empty' | 'unknown' | 'partial', objects = true): CandidateWorldSceneSource {
  const terrain: WorldSceneItem[] = Array.from({ length: 9 }, (_, index) => {
    const x = index % 3, y = Math.floor(index / 3)
    const inside = x < 2 && y < 2
    return {
      facet: 'terrain', id: `sample:${x}:${y}`, layerId: terrainLayer,
      coordinateSpaceId: 'height-grid', lod: 'exact', x, y,
      heightBase: 0, heightAdjustment: 0, mask: 0,
      uvwPosition: { x, y: 0, z: 2 - y },
      ...(inside && cliffs !== 'unknown' && (cliffs !== 'partial' || index === 0)
        ? { cliffFace: cliffs === 'known' && (x === 0 && y === 0 || x === 1 && y === 1) }
        : {}),
    }
  })
  const placed: WorldSceneItem[] = objects ? [
    {
      facet: 'objects', id: 'native:oil', layerId: objectsLayer, coordinateSpaceId: 'map-native',
      kind: 'feature', objectId: 1, position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0.5, y: 0, z: 0.5 }, uvwRotation: [0, 0, 0, 1],
      latticeCoverage: { coordinateSpaceId: 'map-native', roles: ['resource'], resourceKind: 'Oil', blocked: [] },
      uvwLatticeCoverage: { blocked: [], noBuild: triangle },
    },
    {
      facet: 'objects', id: 'native:crystal', layerId: objectsLayer, coordinateSpaceId: 'map-native',
      kind: 'feature', objectId: 2, position: { x: 1, y: 0, z: 1 },
      uvwPosition: { x: 1.5, y: 0, z: 1.5 }, uvwRotation: [0, 0, 0, 1],
      latticeCoverage: { coordinateSpaceId: 'map-native', roles: [], resourceKind: 'Crystal',
        resourceKindScope: 'other/game', noBuild: triangle },
      uvwLatticeCoverage: { noBuild: triangle },
    },
  ] : []
  return {
    contract: info.contract, major: 1, snapshotId,
    info: async () => ({ ...info, facets: objects ? info.facets : info.facets.slice(0, 1) }),
    page: async request => ({
      snapshotId, facet: request.facet, state: 'available',
      items: request.facet === 'terrain' ? terrain
        : request.facet === 'objects' ? placed
          : request.facet === 'layers' && objects ? [{
              facet: 'layers', id: objectsLayer, layerId: objectsLayer,
              kind: 'objects', state: 'available', itemCount: placed.length, lods: ['exact'],
            }] : [],
    }),
  }
}

describe('publisher lattice in the single UVW adapter', () => {
  it('preserves reversed cliff cells, known-empty channels and per-object scoped kinds through reopen', async () => {
    const first = await materializeWorldToUvw(nativeSource('known'), options)
    if (first.state !== 'materialized') throw new Error(JSON.stringify(first.refusals))
    const layers = first.document.spaces[0]!.layers
    const ground = layers.find(layer => layer.kind === 'heightfield')
    const objects = layers.find(layer => layer.kind === 'objects')
    expect(ground?.kind === 'heightfield' && ground.cliffFaces).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }])
    if (objects?.kind !== 'objects') throw new Error('objects missing')
    expect(objects.instances.map(instance => instance.latticeCoverage)).toEqual([
      { roles: [], resourceKind: 'Crystal', resourceKindScope: 'other/game', noBuild: triangle },
      { roles: ['resource'], resourceKind: 'Oil', resourceKindScope: 'warzone/2100', blocked: [], noBuild: triangle },
    ])
    const reopened = createUvwWorldSceneSource(first.document, { snapshotId: 'reopened', maxPageSize: 32 })
    expect((await reopened.info()).gameId).toBeUndefined()
    const terrainPage = await reopened.page({ facet: 'terrain', layerId: 'main/terrain', limit: 32 })
    expect(terrainPage.items.filter(item => item.facet === 'terrain' && item.cliffFace === true)).toHaveLength(2)
    const second = await materializeWorldToUvw(reopened, options)
    expect(second.state).toBe('materialized')
    if (second.state === 'materialized') expect(second.bytes).toEqual(first.bytes)
  })

  it('keeps unknown separate from proven all-false and refuses incomplete classification', async () => {
    const unknown = await materializeWorldToUvw(nativeSource('unknown', false), options)
    const empty = await materializeWorldToUvw(nativeSource('empty', false), options)
    if (unknown.state !== 'materialized' || empty.state !== 'materialized') throw new Error('terrain refused')
    const ground = (result: typeof unknown) => result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')
    expect(ground(unknown)).not.toHaveProperty('cliffFaces')
    expect(ground(empty)).toHaveProperty('cliffFaces', [])
    const partial = await materializeWorldToUvw(nativeSource('partial', false), options)
    expect(partial.state).toBe('refused')
  })

  it('rejects out-of-order cells and unscoped resource kinds at the wire boundary', async () => {
    const first = await materializeWorldToUvw(nativeSource('known'), options)
    if (first.state !== 'materialized') throw new Error(JSON.stringify(first.refusals))
    const invalid = structuredClone(first.document) as unknown as { spaces: { layers: Record<string, unknown>[] }[] }
    const ground = invalid.spaces[0]!.layers.find(layer => layer['kind'] === 'heightfield')!
    ground['cliffFaces'] = [{ x: 0, y: 1 }, { x: 1, y: 0 }]
    expect(() => parseUvwProfile(new TextEncoder().encode(JSON.stringify(invalid)))).toThrow()
    const unscoped = nativeSource('unknown')
    const originalInfo = unscoped.info
    const source = { ...unscoped, info: async () => ({ ...(await originalInfo()), gameId: undefined }) }
    const result = await materializeWorldToUvw(source, options)
    expect(result.state).toBe('refused')
  })
})
