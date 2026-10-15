import { expect, it } from 'vitest'
import type { MapCliffSummary, ResolvedMapWorkspaceSnapshot, WorldSceneCliffItem, WorldSceneTerrainItem } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { createUvwWorldSceneSource, materializeWorldToUvw, materializeWorldToUvpMap, openUvpMapBundle, validateUvwProfile } from '../src/world/index.js'
import { createWorldWebGlPlan } from '../../scene/src/world/webgl.js'
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
function cliffs(): MapCliffSummary {
  return { version: 1, width: 4, height: 4, cellCount: 16, exact: true,
    grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 0 },
      columnStep: { x: 0.25, y: 0, z: 0 }, rowStep: { x: 0, y: 0.25, z: 0 } },
    samples: Array.from({ length: 16 }, (_, index) => ({ x: index % 4, y: Math.floor(index / 4), level: index % 3, authored: index % 2 === 0 })) }
}
const options = { maxPageItems: 4, maxTerrainItems: 4, maxFacetItems: 128, maxOutputBytes: 128_000 }

it('retains exact independent minitile classifications through native Host, UVW and detached UVP without changing terrain or movement', async () => {
  const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: cliffs() }, [], 4)
  try {
    const facet = (await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!
    expect(facet).toMatchObject({ state: 'available', itemCount: 16, lods: ['exact'] })
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'cliffs')).toMatchObject({
      columns: 4, rows: 4, cellSize: 0.25, origin: [0.125, 0, -0.875],
      levels: [[0, 1, 2, 0], [2, 0, 1, 2], [1, 2, 0, 1], [0, 1, 2, 0]],
      authored: [[true, false, true, false], [true, false, true, false], [true, false, true, false], [true, false, true, false]] })
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ columns: 2, rows: 2, samples: [[0, 0], [0, 0]] })
    expect(result.document.spaces[0]!.layers.some(layer => layer.kind === 'traversal')).toBe(false)
    expect(result.excludedFacetIds).not.toContain('world.cliffs')
    const packed = await materializeWorldToUvpMap(lease.value, { ...options, packageId: 'test/minitiles', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const detached = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])), { snapshotId: 'detached-minitiles' })
    const again = await materializeWorldToUvw(detached.source, options)
    if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
    expect(again.document).toEqual(packed.document)
    const detachedFacet = (await detached.source.info()).facets.find(facet => facet.facet === 'cliffs')!
    const detachedPage = await detached.source.page({ facet: 'cliffs', layerId: detachedFacet.layerId, lod: 'exact', limit: 4 })
    expect(detachedPage.items.every(item => item.facet === 'cliffs' && item.coordinateSpaceId === 'uvw-canonical')).toBe(true)
  } finally { await lease.release() }
})

it('preserves rectangular axis swaps and a classification reference plane outside terrain height bounds', async () => {
  const published: MapCliffSummary = { ...cliffs(), width: 3, height: 2, cellCount: 6,
    grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 7 },
      columnStep: { x: 0, y: 0.25, z: 0 }, rowStep: { x: 0.25, y: 0, z: 0 } },
    samples: Array.from({ length: 6 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3), level: index, authored: true })) }
  const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: published }, [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'cliffs')).toMatchObject({
      columns: 2, rows: 3, cellSize: 0.25, origin: [0.125, 7, -0.625], levels: [[2, 5], [1, 4], [0, 3]] })
    const facet = (await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!
    const page = await lease.value.page({ facet: 'cliffs', layerId: facet.layerId, lod: 'exact', limit: 64,
      bounds: { minimumX: 0.1, maximumX: 0.2, minimumY: -0.7, maximumY: -0.6 } })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ level: 2, uvwPosition: { x: 0.125, y: 7, z: -0.625 } })
  } finally { await lease.release() }
})

it('keeps invalid independent grids partial, preserves the implicit grid route and requires an admitted frame', async () => {
  const mutations: ((value: MapCliffSummary) => MapCliffSummary)[] = [
    value => ({ ...value, exact: false }), value => ({ ...value, samples: value.samples.slice(1) }),
    value => ({ ...value, samples: [...value.samples.slice(0, 15), value.samples[0]!] }),
    value => { const samples = [...value.samples]; delete samples[1]; return { ...value, samples } },
    value => ({ ...value, samples: value.samples.map((cell, index) => index === 0 ? { ...cell, level: -1 } : cell) }),
    value => ({ ...value, samples: value.samples.map((cell, index) => index === 0 ? { ...cell, level: 0.5 } : cell) }),
    value => ({ ...value, grid: { ...value.grid!, origin: { x: 2, y: 2, z: 0 } } }),
    value => ({ ...value, grid: { ...value.grid!, columnStep: { x: 0.25, y: 0.1, z: 0 } } }),
  ]
  for (const mutate of mutations) {
    const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: mutate(cliffs()) }, [], 64)
    try {
      const facet = (await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!
      expect(facet).toMatchObject({ state: 'partial', lods: ['sampled'] })
      expect(facet.reason).toContain('refused')
      const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      expect(result.excludedFacetIds).toContain('world.cliffs')
    } finally { await lease.release() }
  }
  const { grid: _notDeclared, ...denseButImplicit } = cliffs()
  const legacy = { ...denseButImplicit, width: 2, height: 2, cellCount: 4,
    samples: Array.from({ length: 4 }, (_, index) => ({ x: index % 2, y: Math.floor(index / 2), level: index, authored: true })) }
  for (const [published, expected] of [[denseButImplicit, 'partial'], [legacy, 'available']] as const) {
    const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: published }, [], 64)
    try { expect((await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!.state).toBe(expected) }
    finally { await lease.release() }
  }
  const { uvwTransform: _noFrame, ...withoutFrame } = snapshot()
  const lease = createCandidateWorldSceneLease({ ...withoutFrame, cliffs: cliffs() }, [], 64)
  try { expect((await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!.state).toBe('partial') }
  finally { await lease.release() }
})

it('rejects sparse or displaced canonical classifications and incomplete source pages', async () => {
  const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: cliffs() }, [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    for (const field of ['levels', 'authored'] as const) {
      const input = JSON.parse(JSON.stringify(result.document))
      const layer = input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'cliffs')
      delete layer[field][0][0]
      expect(() => validateUvwProfile(input)).toThrow()
    }
    const displaced = JSON.parse(JSON.stringify(result.document))
    displaced.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'cliffs').origin[0] = 1
    expect(() => validateUvwProfile(displaced)).toThrow('cliffs grid extends beyond')
    const canonical = createUvwWorldSceneSource(result.document, { snapshotId: 'canonical-cliffs', maxPageSize: 4 })
    const broken = { ...canonical, page: async (request: Parameters<typeof canonical.page>[0]) => {
      const page = await canonical.page(request)
      return request.facet === 'cliffs' ? { ...page, items: page.items.slice(1) } : page
    } }
    expect((await materializeWorldToUvw(broken, options)).state).toBe('refused')
  } finally { await lease.release() }
})

it('includes an independent single-sample grid size in the content revision', async () => {
  const revisions: string[] = []
  for (const step of [0.25, 0.5]) {
    const published = { ...cliffs(), width: 1, height: 1, cellCount: 1, samples: [cliffs().samples[0]!],
      grid: { ...cliffs().grid!, columnStep: { x: step, y: 0, z: 0 }, rowStep: { x: 0, y: step, z: 0 } } }
    const lease = createCandidateWorldSceneLease({ ...snapshot(), cliffs: published }, [], 64)
    try { revisions.push((await lease.value.info()).facets.find(facet => facet.facet === 'cliffs')!.contentRevision!) }
    finally { await lease.release() }
  }
  expect(revisions[0]).not.toBe(revisions[1])
})

it('does not generate terrain cliff walls from unrelated classification grid indices', () => {
  const terrain: WorldSceneTerrainItem[] = Array.from({ length: 4 }, (_, index) => ({
    facet: 'terrain', id: `terrain-${index}`, layerId: 'terrain', coordinateSpaceId: 'height-grid', lod: 'exact',
    x: index % 2, y: Math.floor(index / 2), heightBase: index, heightAdjustment: 0, mask: 0,
    uvwPosition: { x: index % 2, y: index, z: -Math.floor(index / 2) } }))
  const legacy: WorldSceneCliffItem[] = [0, 1].map(x => ({ facet: 'cliffs', id: `cliff-${x}`, layerId: 'cliffs',
    coordinateSpaceId: 'height-grid', lod: 'exact', x, y: 0, level: x, authored: true }))
  const implicit = createWorldWebGlPlan({ items: [...terrain, ...legacy], models: new Map() })
  expect(implicit.stats.cliffTriangles).toBe(2)
  const independent: WorldSceneCliffItem[] = legacy.map(item => ({ ...item, coordinateSpaceId: 'uvw-canonical',
    uvwPosition: { x: 0.125 + item.x * 0.25, y: 7, z: -0.125 } }))
  const explicit = createWorldWebGlPlan({ items: [...terrain, ...independent], models: new Map() })
  expect(explicit.stats.cliffTriangles).toBe(0)
  expect(explicit.stats.terrainTriangles).toBe(implicit.stats.terrainTriangles)
})
