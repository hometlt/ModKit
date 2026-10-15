import { expect, it } from 'vitest'
import type { MapTraversalSummary, ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { materializeWorldToUvw, materializeWorldToUvpMap, openUvpMapBundle } from '../src/world/index.js'

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
function traversal(classId = 'ground'): MapTraversalSummary {
  return { classId, surfaceLayerId: 'terrain', exact: true, width: 2, height: 2, cellCount: 4, trailingBytes: 0,
    grid: { coordinateSpaceId: 'map-native', origin: { x: 0.25, y: 0.25, z: 0 },
      columnStep: { x: 0.5, y: 0, z: 0 }, rowStep: { x: 0, y: 0.5, z: 0 } },
    samples: [{ x: 0, y: 0, walkable: true, exits: 1 }, { x: 1, y: 0, walkable: true, exits: 4 },
      { x: 0, y: 1, walkable: false, exits: 0 }, { x: 1, y: 1, walkable: true, exits: 0 }] }
}
const options = { maxPageItems: 2, maxTerrainItems: 4, maxFacetItems: 128, maxOutputBytes: 128_000 }

it('publishes native authored traversal with independent cell size and preserves its surface through detached UVP', async () => {
  const lease = createCandidateWorldSceneLease({ ...snapshot(), traversals: [traversal()] }, [], 2)
  try {
    const info = await lease.value.info()
    expect(info.facets.find(facet => facet.facet === 'traversal')).toMatchObject({ state: 'available', itemCount: 4, lods: ['exact'] })
    const facet = info.facets.find(facet => facet.facet === 'traversal')!
    const window = await lease.value.page({ facet: 'traversal', layerId: facet.layerId, lod: 'exact', limit: 2,
      bounds: { minimumX: 0.2, maximumX: 0.3, minimumY: -0.3, maximumY: -0.2 } })
    expect(window.items).toHaveLength(1)
    expect(window.items[0]).toMatchObject({ uvwPosition: { x: 0.25, y: 0, z: -0.25 } })
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'traversal')).toMatchObject({
      id: 'traversal-ground', classId: 'ground', surfaceLayerId: 'terrain', origin: [0, 0, -1],
      columns: 2, rows: 2, cellSize: 0.5, walkable: [[false, true], [true, true]], exits: [[0, 0], [1, 8]] })
    expect(result.excludedFacetIds.some(id => id.startsWith('world.traversal'))).toBe(false)
    const packed = await materializeWorldToUvpMap(lease.value, { ...options, packageId: 'test/native-traversal', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const detached = await openUvpMapBundle(new Map([...packed.entries].map(([path, bytes]) => [path, bytes.slice()])), { snapshotId: 'detached-native-traversal' })
    const reopened = await materializeWorldToUvw(detached.source, options)
    if (reopened.state !== 'materialized') throw new Error(JSON.stringify(reopened.refusals))
    expect(reopened.document).toEqual(packed.document)
  } finally { await lease.release() }
})

it('maps native column and row exits exactly once for all eight square-grid orientations', async () => {
  const cases = [
    [1, 0, 0, 1, 1, 8], [-1, 0, 0, 1, 2, 8], [1, 0, 0, -1, 1, 4], [-1, 0, 0, -1, 2, 4],
    [0, 1, 1, 0, 8, 1], [0, -1, 1, 0, 4, 1], [0, 1, -1, 0, 8, 2], [0, -1, -1, 0, 4, 2],
  ] as const
  for (const [cx, cy, rx, ry, expectedColumnBit, expectedRowBit] of cases) {
    const policy = traversal()
    const grid = { coordinateSpaceId: 'map-native' as const,
      origin: { x: cx + rx > 0 ? 0.25 : 0.75, y: cy + ry > 0 ? 0.25 : 0.75, z: 0 },
      columnStep: { x: cx * 0.5, y: cy * 0.5, z: 0 }, rowStep: { x: rx * 0.5, y: ry * 0.5, z: 0 } }
    const lease = createCandidateWorldSceneLease({ ...snapshot(), traversals: [{ ...policy, grid }] }, [], 64)
    try {
      const facet = (await lease.value.info()).facets.find(facet => facet.facet === 'traversal')!
      expect(facet.state).toBe('available')
      const page = await lease.value.page({ facet: 'traversal', layerId: facet.layerId, lod: 'exact', limit: 64 })
      const start = page.items.find(item => item.facet === 'traversal' && item.uvwPosition.x === grid.origin.x && item.uvwPosition.z === -grid.origin.y)
      const bend = page.items.find(item => item.facet === 'traversal' && item.uvwPosition.x === grid.origin.x + grid.columnStep.x && item.uvwPosition.z === -(grid.origin.y + grid.columnStep.y))
      expect(start).toMatchObject({ exits: expectedColumnBit })
      expect(bend).toMatchObject({ exits: expectedRowBit })
      expect((await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })).state).toBe('materialized')
    } finally { await lease.release() }
  }
  const rectangular: MapTraversalSummary = { ...traversal(), width: 3, height: 2, cellCount: 6,
    grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 0 },
      columnStep: { x: 0, y: 0.25, z: 0 }, rowStep: { x: 0.25, y: 0, z: 0 } },
    samples: Array.from({ length: 6 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3), walkable: true, exits: index % 3 === 2 ? 0 : 1 })) }
  const lease = createCandidateWorldSceneLease({ ...snapshot(), traversals: [rectangular] }, [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'traversal')).toMatchObject({
      columns: 2, rows: 3, cellSize: 0.25, origin: [0, 0, -0.75], exits: [[0, 0], [8, 8], [8, 8]] })
  } finally { await lease.release() }
})

it('isolates classes, cursors and partial losses instead of treating one retained class as every traversal layer', async () => {
  const lease = createCandidateWorldSceneLease({ ...snapshot(), traversals: [traversal(), { ...traversal('air'), exact: false }] }, [], 2)
  try {
    const info = await lease.value.info()
    const ground = info.facets.find(facet => facet.layerId.endsWith(':ground'))!
    const air = info.facets.find(facet => facet.layerId.endsWith(':air'))!
    expect(ground.state).toBe('available'); expect(air.state).toBe('partial')
    const page = await lease.value.page({ facet: 'traversal', layerId: ground.layerId, lod: 'exact', limit: 2 })
    expect(page.items.every(item => item.layerId === ground.layerId)).toBe(true)
    await expect(lease.value.page({ facet: 'traversal', layerId: air.layerId, lod: 'exact', limit: 2, cursor: page.nextCursor! })).rejects.toThrow()
    expect((await lease.value.page({ facet: 'traversal', layerId: air.layerId, lod: 'exact', limit: 2 })).state).toBe('unsupported')
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.filter(layer => layer.kind === 'traversal').map(layer => layer.classId)).toEqual(['ground'])
    expect(result.excludedFacetIds).toContain(`world.traversal/${air.layerId}`)
    expect(result.excludedFacetIds).not.toContain(`world.traversal/${ground.layerId}`)
  } finally { await lease.release() }
  const both = createCandidateWorldSceneLease({ ...snapshot(), traversals: [traversal(), traversal('air')] }, [], 2)
  try {
    const result = await materializeWorldToUvw(both.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.filter(layer => layer.kind === 'traversal').map(layer => layer.classId)).toEqual(['air', 'ground'])
    expect(result.excludedFacetIds.some(id => id.startsWith('world.traversal'))).toBe(false)
  } finally { await both.release() }
})

it('refuses incomplete, invalid, displaced, vertical, skewed or unknown native traversal policy without flag inference', async () => {
  const mutations: ((value: MapTraversalSummary) => MapTraversalSummary)[] = [
    value => ({ ...value, exact: false }), value => ({ ...value, trailingBytes: 1 }),
    value => ({ ...value, samples: value.samples.slice(1) }),
    value => { const samples = [...value.samples]; delete samples[1]; return { ...value, samples } },
    value => ({ ...value, samples: [...value.samples.slice(0, 3), value.samples[0]!] }),
    value => ({ ...value, samples: value.samples.map((cell, index) => index === 0 ? { ...cell, exits: 16 } : cell) }),
    value => ({ ...value, samples: value.samples.map((cell, index) => index === 0 ? { ...cell, exits: 2 } : cell) }),
    value => ({ ...value, samples: value.samples.map((cell, index) => index === 2 ? { ...cell, exits: 1 } : cell) }),
    value => ({ ...value, grid: { ...value.grid, origin: { x: 0.01, y: 0.25, z: 0 } } }),
    value => ({ ...value, grid: { ...value.grid, columnStep: { x: 0.5, y: 0.1, z: 0 } } }),
    value => ({ ...value, grid: { ...value.grid, columnStep: { x: 0.5, y: 0, z: 0.1 } } }),
  ]
  for (const mutate of mutations) {
    const lease = createCandidateWorldSceneLease({ ...snapshot(), traversals: [mutate(traversal())] }, [], 64)
    try {
      const facet = (await lease.value.info()).facets.find(facet => facet.facet === 'traversal')!
      expect(facet).toMatchObject({ state: 'partial', lods: [] })
      expect(facet.reason).toContain('refused')
      const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      expect(result.excludedFacetIds).toContain(`world.traversal/${facet.layerId}`)
      expect(result.document.spaces[0]!.layers.some(layer => layer.kind === 'traversal')).toBe(false)
    } finally { await lease.release() }
  }
  const flagsOnly = createCandidateWorldSceneLease(snapshot(), [], 64)
  try { expect((await flagsOnly.value.info()).facets.some(facet => facet.facet === 'traversal')).toBe(false) } finally { await flagsOnly.release() }
  expect(() => createCandidateWorldSceneLease({ ...snapshot(), traversals: [traversal(), traversal()] }, [], 64)).toThrow('unique local ids')
  expect(() => createCandidateWorldSceneLease({ ...snapshot(), traversals: [{ ...traversal(), classId: 'bad class' }] }, [], 64)).toThrow('unique local ids')
  const { uvwTransform: _missing, ...withoutFrame } = snapshot()
  const unqualified = createCandidateWorldSceneLease({ ...withoutFrame, traversals: [traversal()] }, [], 64)
  try { expect((await unqualified.value.info()).facets.find(facet => facet.facet === 'traversal')).toMatchObject({ state: 'partial', lods: [] }) }
  finally { await unqualified.release() }
})

it('includes surface metadata in content revisions and confines native surface references', async () => {
  const policy = traversal()
  const { surfaceLayerId: _omitted, ...topologyOnly } = policy
  const withSurface = createCandidateWorldSceneLease({ ...snapshot(), traversals: [policy] }, [], 64)
  const withoutSurface = createCandidateWorldSceneLease({ ...snapshot(), traversals: [topologyOnly] }, [], 64)
  const foreignSurface = createCandidateWorldSceneLease({ ...snapshot(), traversals: [{ ...policy, surfaceLayerId: 'missing' } as unknown as MapTraversalSummary] }, [], 64)
  try {
    const first = (await withSurface.value.info()).facets.find(facet => facet.facet === 'traversal')!
    const second = (await withoutSurface.value.info()).facets.find(facet => facet.facet === 'traversal')!
    expect(first.state).toBe('available'); expect(second.state).toBe('available')
    expect(first.contentRevision).not.toBe(second.contentRevision)
    expect((await foreignSurface.value.info()).facets.find(facet => facet.facet === 'traversal')).toMatchObject({ state: 'partial', lods: [] })
  } finally { await withSurface.release(); await withoutSurface.release(); await foreignSurface.release() }
})
