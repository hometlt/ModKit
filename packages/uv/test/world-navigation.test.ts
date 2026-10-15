import { expect, it } from 'vitest'
import type { MapNavigationSummary, ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { createUvwWorldSceneSource, materializeWorldToUvw, materializeWorldToUvpMap,
  openUvpMapBundle, validateUvwProfile } from '../src/world/index.js'

/** Bounded native source with 2x2 terrain samples and an independently measured 4x4 flags grid. */
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
const options = { maxPageItems: 64, maxTerrainItems: 4, maxFacetItems: 128, maxOutputBytes: 128_000 }

it('exports exact independent native navigation through Host, UVW and detached UVP without guessing passability', async () => {
  const lease = createCandidateWorldSceneLease(snapshot(), [], 64)
  try {
    const info = await lease.value.info()
    expect(info.facets.find(facet => facet.facet === 'navigation')).toMatchObject({ state: 'available', lods: ['summary', 'sampled', 'exact'] })
    const sampled = await lease.value.page({ facet: 'navigation', layerId: info.facets.find(facet => facet.facet === 'navigation')!.layerId, lod: 'sampled', limit: 64 })
    expect(sampled.items.every(item => item.facet === 'navigation' && item.lod === 'sampled')).toBe(true)
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const navigation = result.document.spaces[0]!.layers.find(layer => layer.kind === 'navigation')
    expect(navigation).toMatchObject({ columns: 4, rows: 4, cellSize: 0.25, origin: [0.125, 0, -0.875],
      flagEncoding: 'example/pathing-flags@1', samples: [[12, 13, 14, 15], [8, 9, 10, 11], [4, 5, 6, 7], [0, 1, 2, 3]] })
    expect(result.excludedFacetIds).not.toContain('world.navigation')
    const packed = await materializeWorldToUvpMap(lease.value, { ...options, packageId: 'test/navigation', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const reopened = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])), { snapshotId: 'detached-navigation' })
    const again = await materializeWorldToUvw(reopened.source, options)
    expect(again.state).toBe('materialized')
    if (again.state === 'materialized') expect(again.document).toEqual(packed.document)
    expect(reopened.document.spaces[0]!.layers.some(layer => (layer.kind as string) === 'traversal')).toBe(false)
  } finally { await lease.release() }
})

it('keeps sampled, incomplete, ambiguous and malformed navigation partial with explicit export exclusion', async () => {
  const mutations: readonly ((value: MapNavigationSummary) => MapNavigationSummary)[] = [
    value => ({ ...value, exact: false }),
    value => ({ ...value, trailingBytes: 1 }),
    value => ({ ...value, samples: value.samples.slice(1) }),
    value => ({ ...value, samples: [...value.samples.slice(0, -1), value.samples[0]!] }),
    value => ({ ...value, flagEncoding: 'unknown' }),
    value => ({ ...value, samples: value.samples.map((sample, index) => index === 0 ? { ...sample, flags: -1 } : sample) }),
    value => ({ ...value, grid: { ...value.grid!, columnStep: { x: 0.25, y: 0.125, z: 0 } } }),
    value => ({ ...value, grid: { ...value.grid!, origin: { x: 10, y: 0, z: 0 } } }),
    value => { const { grid: _grid, ...withoutGrid } = value; return withoutGrid },
  ]
  for (const mutate of mutations) {
    const base = snapshot()
    const lease = createCandidateWorldSceneLease({ ...base, navigation: mutate(base.navigation!) }, [], 64)
    try {
      const info = await lease.value.info()
      expect(info.facets.find(facet => facet.facet === 'navigation')?.state).toBe('partial')
      const result = await materializeWorldToUvw(lease.value, options)
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      expect(result.excludedFacetIds).toContain('world.navigation')
    } finally { await lease.release() }
  }
})

it('rejects displaced navigation on standalone admission before a renderer may consume it', async () => {
  const lease = createCandidateWorldSceneLease(snapshot(), [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const value = structuredClone(result.document)
    const layer = value.spaces[0]!.layers.find(item => item.kind === 'navigation')!
    if (layer.kind !== 'navigation') throw new Error('navigation missing')
    expect(() => validateUvwProfile({ ...value, spaces: value.spaces.map(space => ({ ...space,
      layers: space.layers.map(item => item === layer ? { ...item, origin: [99, 0, 99] } : item),
    })) })).toThrow(/navigation grid extends/)
    for (const encoding of ['', 'unknown', 'example/pathing@0', 'example/pathing@1\n', true, null]) {
      expect(() => validateUvwProfile({ ...value, spaces: value.spaces.map(space => ({ ...space,
        layers: space.layers.map(item => item === layer ? { ...item, flagEncoding: encoding } : item),
      })) })).toThrow(/flagEncoding/)
    }
    const source = createUvwWorldSceneSource(result.document, { snapshotId: 'canonical-grid' })
    expect((await source.info()).canonicalArtifact).toBeDefined()
  } finally { await lease.release() }
})

it('changes the navigation revision when its vocabulary changes even if every flags value is the same', async () => {
  const first = snapshot(), second = { ...first, navigation: { ...first.navigation!, flagEncoding: 'example/pathing-flags@2' } }
  const revisions: (string | undefined)[] = []
  for (const value of [first, second]) {
    const lease = createCandidateWorldSceneLease(value, [], 64)
    try { revisions.push((await lease.value.info()).facets.find(facet => facet.facet === 'navigation')?.contentRevision) }
    finally { await lease.release() }
  }
  expect(revisions[0]).toBeDefined()
  expect(revisions[0]).not.toBe(revisions[1])
})
