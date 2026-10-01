import { expect, it } from 'vitest'
import type { ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '../src/maps/world-source.js'

// a 2×2 map whose fourth sample is an air column: no ground there, its height a placeholder
const samples = [0, 1, 2, -50].map((heightBase, index) => ({
  x: index % 2,
  y: Math.floor(index / 2),
  heightBase,
  heightAdjustment: 0,
  mask: 0,
  ...(index === 3 ? { noGround: true as const } : {}),
}))
const snapshot = {
  schemaVersion: 1,
  workspaceId: 'workspace',
  gameId: 'example/game',
  mapId: 'fixture.map',
  analyzerId: 'fixture',
  snapshotId: 'snapshot-air',
  semantic: {
    schemaVersion: 1,
    workspaceId: 'workspace',
    gameId: 'example/game',
    mapId: 'fixture.map',
    analyzerId: 'fixture',
    documentPaths: [],
    objects: [],
    regions: [],
    catalogQueries: [],
    resolvedCatalogObjects: 0,
    diagnostics: [],
    complete: true,
    terrain: {
      version: 1,
      width: 2,
      height: 2,
      cellCount: 4,
      minimumHeightBase: -50,
      maximumHeightBase: 2,
      minimumHeightAdjustment: 0,
      maximumHeightAdjustment: 0,
      trailingBytes: 0,
      samples,
    },
  },
  terrainMaterials: {
    version: 1,
    width: 2,
    height: 2,
    cellCount: 4,
    textureNames: ['Grass'],
    exact: true,
    samples: samples.map(({ x, y }) => ({ x, y, textureIndex: 0, textureName: 'Grass' })),
  },
  terrainTransform: {
    schemaVersion: 1,
    snapshotId: 'snapshot-air',
    descriptorVersion: 1,
    heightMap: { dim: [2, 2], offset: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    // the ground spans 0..2: the air column's height is no ground height
    bounds: {
      coordinateSpaceId: 'map-native',
      minimum: { x: 0, y: 0, z: 0 },
      maximum: { x: 1, y: 1, z: 2 },
    },
    source: { terrainDocumentPath: 'terrain', format: 'fixture', heightEncoding: 'f64' },
    mapping: {
      horizontal: 'offset-plus-grid-index-times-scale',
      vertical: 'direct-base-times-scale-plus-offset',
    },
  },
  uvwTransform: {
    schemaVersion: 1,
    snapshotId: 'snapshot-air',
    sourceCoordinateSpaceId: 'map-native',
    targetCoordinateSpaceId: 'uvw-canonical',
    basis: {
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: 'source-unit',
      sourceUnit: 'fixture-unit',
    },
    axes: {
      x: { sourceAxis: 'x', scale: 1, offset: 0 },
      y: { sourceAxis: 'z', scale: 1, offset: 0 },
      z: { sourceAxis: 'y', scale: 1, offset: 0 },
    },
    heightfield: {
      columns: 2,
      rows: 2,
      cellSize: 1,
      origin: [0, 0, 0],
      sourceRowOrder: 'forward',
    },
    bounds: {
      coordinateSpaceId: 'uvw-canonical',
      minimum: { x: 0, y: 0, z: 0 },
      maximum: { x: 1, y: 2, z: 1 },
    },
    proof: {
      kind: 'adapter-qualification',
      method: 'third-party-reference-differential',
      oracle: 'fixture',
      corpus: 'fixture',
      sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` },
      tupleCount: 4,
      comparison: 'ieee-754-binary64-exact',
      nativeTupleDigest: `sha256:${'b'.repeat(64)}`,
      canonicalTupleDigest: `sha256:${'c'.repeat(64)}`,
    },
  },
  worldCandidate: {
    contract: 'example/world',
    major: 1,
    maturity: 'publisher-candidate',
    coordinateSpaces: [],
    crossSpaceTransforms: [],
    unknownFacets: [],
  },
  unresolvedRequirementIds: [],
  diagnostics: [],
  diagnosticsTruncated: false,
  complete: true,
} as unknown as ResolvedMapWorkspaceSnapshot

it('publishes no terrain item where there is no ground, and declares the noDataValue (П26)', async () => {
  const lease = createCandidateWorldSceneLease(snapshot, [], 64)
  try {
    const info = (await lease.value.info()) as Awaited<ReturnType<typeof lease.value.info>> & {
      uvwTransformRefusal?: string
    }
    // the ground's bounds leave the placeholder out, and the transform is admitted on them
    expect(info.uvwTransformRefusal).toBeUndefined()
    expect(info.facets.find(facet => facet.facet === 'terrain')?.itemCount).toBe(3)
    const layers = await lease.value.page({ facet: 'layers', limit: 64 })
    const layer = layers.items.find(item => item.facet === 'layers' && item.kind === 'terrain')
    if (layer?.facet !== 'layers') throw new Error('no terrain layer')
    expect(layer.grid?.noDataValue).toBe(-9999)
    const terrain = await lease.value.page({
      facet: 'terrain',
      layerId: layer.layerId,
      lod: 'exact',
      limit: 64,
    })
    expect(terrain.items.map(item => (item.facet === 'terrain' ? [item.x, item.y] : []))).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ])
    // the materials keep the whole grid, the air column included
    const materialLayer = layers.items.find(
      item => item.facet === 'layers' && item.kind === 'terrain-materials',
    )
    const materials = await lease.value.page({
      facet: 'terrain-materials',
      layerId: materialLayer!.layerId,
      lod: 'exact',
      limit: 64,
    })
    expect(materials.items).toHaveLength(4)
  } finally {
    await lease.release()
  }
})
