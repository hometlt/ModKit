import { expect, it } from 'vitest'
import type { MapQuerySurfaceSummary, ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { materializeWorldToUvw } from '../src/world/index.js'
function snapshot(): ResolvedMapWorkspaceSnapshot {
  const identity = { schemaVersion: 1 as const, workspaceId: 'navigation-fixture', gameId: 'example/game',
    mapId: 'map', analyzerId: 'fixture', snapshotId: 'navigation-fixture' }
  return { ...identity,
    semantic: { ...identity, documentPaths: [], objects: [], regions: [], catalogQueries: [],
      resolvedCatalogObjects: 0, diagnostics: [], complete: true,
      terrain: { version: 1, width: 2, height: 2, cellCount: 4, minimumHeightBase: 0, maximumHeightBase: 0,
        minimumHeightAdjustment: 0, maximumHeightAdjustment: 0, trailingBytes: 0,
        samples: Array.from({ length: 4 }, (_, index) => ({ x: index % 2, y: Math.floor(index / 2), heightBase: 0, heightAdjustment: 0, mask: 0 })) },
    },
    terrainTransform: { schemaVersion: 1, snapshotId: identity.snapshotId, descriptorVersion: 1,
      heightMap: { dim: [2, 2], offset: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      bounds: { coordinateSpaceId: 'map-native', minimum: { x: 0, y: 0, z: 0 }, maximum: { x: 1, y: 1, z: 0 } },
      source: { terrainDocumentPath: 'terrain', format: 'fixture', heightEncoding: 'f64' },
      mapping: { horizontal: 'offset-plus-grid-index-times-scale', vertical: 'direct-base-times-scale-plus-offset' } },
    uvwTransform: { schemaVersion: 1, snapshotId: identity.snapshotId, sourceCoordinateSpaceId: 'map-native',
      targetCoordinateSpaceId: 'uvw-canonical', basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'source-unit', sourceUnit: 'fixture-world-unit' },
      axes: { x: { sourceAxis: 'x', scale: 1, offset: 0 }, y: { sourceAxis: 'z', scale: 1, offset: 0 }, z: { sourceAxis: 'y', scale: -1, offset: 0 } },
      heightfield: { columns: 2, rows: 2, cellSize: 1, origin: [0, 0, -1], sourceRowOrder: 'reverse' },
      bounds: { coordinateSpaceId: 'uvw-canonical', minimum: { x: 0, y: 0, z: -1 }, maximum: { x: 1, y: 0, z: 0 } },
      proof: { kind: 'adapter-qualification', method: 'third-party-reference-differential', oracle: 'synthetic fixture', corpus: 'fixture',
        sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` }, tupleCount: 4, comparison: 'ieee-754-binary64-exact',
        nativeTupleDigest: `sha256:${'b'.repeat(64)}`, canonicalTupleDigest: `sha256:${'c'.repeat(64)}` } },
    navigation: { version: 1, width: 4, height: 4, cellCount: 16, minimumFlags: 0, maximumFlags: 15, trailingBytes: 0,
      exact: true, flagEncoding: 'example/pathing-flags@1',
      grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 0 }, columnStep: { x: 0.25, y: 0, z: 0 }, rowStep: { x: 0, y: 0.25, z: 0 } },
      samples: Array.from({ length: 16 }, (_, index) => ({ x: index % 4, y: Math.floor(index / 4), flags: index })) },
    worldCandidate: { contract: 'example/world', major: 1, maturity: 'publisher-candidate',
      coordinateSpaces: ['map-native', 'height-grid', 'navigation-grid', 'uvw-canonical'].map(id => ({
        id, horizontalAxes: ['x', 'y'], verticalAxis: 'z', handedness: 'right', linearUnit: 'fixture', rotationUnit: 'radian', origin: 'fixture' })),
      crossSpaceTransforms: [], unknownFacets: [] },
    unresolvedRequirementIds: [], diagnostics: [], diagnosticsTruncated: false, complete: true,
  }
}
function nativeMesh(): ResolvedMapWorkspaceSnapshot {
  const input = snapshot(), { terrain: _terrain, ...semantic } = input.semantic
  return { ...input, semantic: { ...semantic, objects: [{ objectId: 1, kind: 'doodad', position: { x: 0, y: 0, z: 0 } }] },
    worldCandidate: { ...input.worldCandidate, topology: 'mesh' },
    uvwTransform: { ...input.uvwTransform!, bounds: { ...input.uvwTransform!.bounds, maximum: { x: 1, y: 8, z: 0 } } },
    querySurfaces: [{ id: 'walk-surface', exact: true, width: 2, height: 2, cellCount: 4, trailingBytes: 0,
      grid: { coordinateSpaceId: 'map-native', origin: { x: 0.25, y: 0.25, z: 0 }, columnStep: { x: 0.5, y: 0, z: 0 }, rowStep: { x: 0, y: 0.5, z: 0 } },
      samples: Array.from({ length: 4 }, (_, index) => ({ x: index % 2, y: Math.floor(index / 2), height: (index + 1) * 2 })) }],
    traversals: [{ classId: 'ground', surfaceLayerId: 'walk-surface', exact: true, width: 2, height: 2, cellCount: 4, trailingBytes: 0,
      grid: { coordinateSpaceId: 'map-native', origin: { x: 0.25, y: 0.25, z: 0 }, columnStep: { x: 0.5, y: 0, z: 0 }, rowStep: { x: 0, y: 0.5, z: 0 } },
      samples: [{ x: 0, y: 0, walkable: true, exits: 1 }, { x: 1, y: 0, walkable: true, exits: 4 },
        { x: 0, y: 1, walkable: false, exits: 0 }, { x: 1, y: 1, walkable: true, exits: 0 }] }] }
}
const options = { maxPageItems: 4, maxTerrainItems: 4, maxFacetItems: 128, maxOutputBytes: 128_000 }
it('publishes native model-only worlds with independent query heights and explicitly bound traversal classes', async () => {
  const lease = createCandidateWorldSceneLease(nativeMesh(), [], 4)
  try {
    const info = await lease.value.info()
    expect(info.topology).toBe('mesh')
    expect(info.facets.find(facet => facet.facet === 'terrain')!.state).toBe('unavailable')
    expect(info.facets.find(facet => facet.facet === 'surfaces')).toMatchObject({ state: 'available', itemCount: 4 })
    expect(info.facets.find(facet => facet.facet === 'traversal')!.state).toBe('available')
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.observedTerrainItems).toBe(0)
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ id: 'walk-surface', role: 'query',
      columns: 2, rows: 2, cellSize: 0.5, origin: [0.25, 0, -0.75], samples: [[6, 8], [2, 4]] })
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'traversal')).toMatchObject({ surfaceLayerId: 'walk-surface', exits: [[0, 0], [1, 8]] })
    expect(result.excludedFacetIds.some(id => id.startsWith('world.surfaces'))).toBe(false)
  } finally { await lease.release() }
})
it('keeps invalid native query surfaces and their dependent classes partial, without guessing from flags or terrain', async () => {
  const mutations: ((value: MapQuerySurfaceSummary) => MapQuerySurfaceSummary)[] = [
    value => ({ ...value, exact: false }), value => ({ ...value, trailingBytes: 1 }),
    value => ({ ...value, samples: value.samples.slice(1) }),
    value => ({ ...value, samples: value.samples.map((sample, index) => index === 0 ? { ...sample, height: Infinity } : sample) }),
    value => ({ ...value, samples: value.samples.map((sample, index) => index === 0 ? { ...sample, height: 100 } : sample) }),
  ]
  for (const mutate of mutations) {
    const input = nativeMesh(), surface = input.querySurfaces![0]!
    const lease = createCandidateWorldSceneLease({ ...input, querySurfaces: [mutate(surface)] }, [], 4)
    try {
      expect((await lease.value.info()).facets.find(facet => facet.facet === 'surfaces')!.state).toBe('partial')
      expect((await lease.value.info()).facets.find(facet => facet.facet === 'traversal')!.state).toBe('partial')
      const result = await materializeWorldToUvw(lease.value, options)
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      expect(result.excludedFacetIds).toContain('world.surfaces')
      expect(result.excludedFacetIds.some(id => id.startsWith('world.traversal/'))).toBe(true)
    } finally { await lease.release() }
  }
})
it('retains native query NoData while refusing terrain binding in a mesh and duplicate surface identifiers', async () => {
  const input = nativeMesh(), surface = input.querySurfaces![0]!
  const lease = createCandidateWorldSceneLease({ ...input, querySurfaces: [{ ...surface, noDataValue: 2 }] }, [], 4)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ noDataValue: 2, samples: [[6, 8], [2, 4]] })
  } finally { await lease.release() }
  const wrong = createCandidateWorldSceneLease({ ...input, traversals: [{ ...input.traversals![0]!, surfaceLayerId: 'terrain' }] }, [], 4)
  try { expect((await wrong.value.info()).facets.find(facet => facet.facet === 'traversal')!.state).toBe('partial') }
  finally { await wrong.release() }
  expect(() => createCandidateWorldSceneLease({ ...input, querySurfaces: [surface, surface] }, [], 4)).toThrow('unique local ids')
})
