import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { MapGameRasterSummary, ResolvedMapWorkspaceSnapshot } from '@modkit/sdk/maps'
import { isNavigationFlagEncoding, isVersionedPublisherId } from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { createUvwWorldSceneSource, materializeWorldToUvw, materializeWorldToUvpMap, openUvpMapBundle, validateUvwProfile } from '../src/world/index.js'
import { createWorldWebGlPlan } from '../../scene/src/world/webgl.js'
const options = { maxPageItems: 4, maxTerrainItems: 4, maxFacetItems: 256, maxOutputBytes: 1 << 20,
  packageId: 'test/game-rasters', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 }
async function fixture() {
  return JSON.parse(await readFile(new URL('../../../vendor/multiverse-specs/specs/world/fixtures/uvw-game-rasters.uvw.json', import.meta.url), 'utf8'))
}
it('preserves independent opaque numeric fields, NoData, scaling and category order without terrain or movement inference', async () => {
  const input = await fixture(), document = validateUvwProfile(input)
  const source = createUvwWorldSceneSource(document, { snapshotId: 'typed-game-fields', maxPageSize: 4 })
  const info = await source.info()
  expect(info.facets.filter(facet => facet.facet === 'game-raster')).toHaveLength(3)
  expect(info.facets.some(facet => facet.facet === 'navigation' || facet.facet === 'traversal')).toBe(false)
  const packed = await materializeWorldToUvpMap(source, options)
  if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
  expect(packed.document).toEqual(document)
  const opened = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])), { snapshotId: 'detached-game-fields' })
  const again = await materializeWorldToUvw(opened.source, options)
  if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
  expect(again.document).toEqual(document)
  const repacked = await materializeWorldToUvpMap(opened.source, options)
  if (repacked.state !== 'materialized') throw new Error(JSON.stringify(repacked.refusals))
  expect(repacked.entries).toEqual(packed.entries)
  const field = info.facets.find(facet => facet.facet === 'game-raster')!
  const window = await source.page({ facet: 'game-raster', layerId: field.layerId, lod: 'exact', limit: 4,
    bounds: { minimumX: 0, maximumX: 0.3, minimumY: -1, maximumY: -0.7 } })
  expect(window.items.every(item => item.facet === 'game-raster')).toBe(true)
  expect(isNavigationFlagEncoding).toBe(isVersionedPublisherId)
})
it('refuses unsafe storage, partial arrays, displaced cell footprints, invalid vocabularies and ambiguous category legends', async () => {
  const mutations = [
    (field: Record<string, any>) => { field['samples'][0][0] = 256 },
    (field: Record<string, any>) => { field['samples'][0][0] = -0 },
    (field: Record<string, any>) => { field['samples'][0][0] = 0.5 },
    (field: Record<string, any>) => { field['samples'][0][0] = Infinity },
    (field: Record<string, any>) => { field['samples'][0].pop() },
    (field: Record<string, any>) => { delete field['samples'][0][0] },
    (field: Record<string, any>) => { field['valueMeaning'] = 'metal' },
    (field: Record<string, any>) => { field['valueMeaning'] = 'example/metal@0' },
    (field: Record<string, any>) => { field['valueType'] = 'u64' },
    (field: Record<string, any>) => { field['sampling'] = 'unknown' },
    (field: Record<string, any>) => { field['minimum'] = 100; field['maximum'] = 10 },
    (field: Record<string, any>) => { field['origin'][0] += 0.5 },
    (field: Record<string, any>) => { delete field['origin'][1] },
    (field: Record<string, any>) => { field['categories'] = [{ value: 1, label: 'a' }, { value: 1, label: 'b' }] },
    (field: Record<string, any>) => { field['categories'] = [{ value: 1, label: 'a', color: '#zzz' }] },
    (field: Record<string, any>) => { field['valueScale'] = NaN },
  ]
  for (const mutate of mutations) {
    const input = await fixture(), field = input.spaces[0].layers.find((layer: { id: string }) => layer.id === 'metal')
    mutate(field); expect(() => validateUvwProfile(input)).toThrow()
  }
})
it('isolates raster layers and refuses incomplete or duplicate source cells instead of inventing NoData', async () => {
  const source = createUvwWorldSceneSource(validateUvwProfile(await fixture()), { snapshotId: 'raster-cells', maxPageSize: 4 })
  const facets = (await source.info()).facets.filter(facet => facet.facet === 'game-raster')
  const first = await source.page({ facet: 'game-raster', layerId: facets[0]!.layerId, lod: 'exact', limit: 1 })
  await expect(source.page({ facet: 'game-raster', layerId: facets[1]!.layerId, lod: 'exact', limit: 1, cursor: first.nextCursor! })).rejects.toThrow()
  for (const mode of ['missing', 'duplicate'] as const) {
    const broken = { ...source, page: async (request: Parameters<typeof source.page>[0]) => {
      const page = await source.page(request)
      return request.facet !== 'game-raster' ? page : { ...page, items: mode === 'missing' ? page.items.slice(1) : page.items.map((item, index) => index === 1 ? page.items[0]! : item) }
    } }
    expect((await materializeWorldToUvw(broken, options)).state).toBe('refused')
  }
})

function raster(id: string, width: number, height: number, cell: number): MapGameRasterSummary {
  return { descriptor: { id, label: id, meaning: 'other', width, height, minimum: 0, maximum: 255, editable: true,
    sampling: 'cell', valueScale: 0.25, valueOffset: 2, unit: 'example-amount',
    categories: [{ value: 4, label: 'authored category', color: '#abcdef' }] },
    values: { layer: id, width, height, values: Array.from({ length: width * height }, (_, index) => index) },
    metadata: { valueMeaning: `example/${id}@1`, valueType: 'u8', noDataValue: 255 }, exact: true, trailingBytes: 0,
    grid: { coordinateSpaceId: 'map-native', origin: { x: cell / 2, y: cell / 2, z: 0 }, columnStep: { x: cell, y: 0, z: 0 }, rowStep: { x: 0, y: cell, z: 0 } } }
}
function nativeSnapshot(): ResolvedMapWorkspaceSnapshot {
  // Use the same qualified frame/terrain witness as the independent-navigation regression.
  return nativeFrame()
}
it('publishes existing native map.layers arrays through the shared grid owner with distinct resolutions and literal values', async () => {
  const lease = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [raster('metal', 2, 2, 0.5), raster('grass', 4, 4, 0.25)] }, [], 4)
  try {
    const facets = (await lease.value.info()).facets.filter(facet => facet.facet === 'game-raster')
    expect(facets.map(facet => facet.state)).toEqual(['available', 'available'])
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const fields = result.document.spaces[0]!.layers.filter(layer => layer.kind === 'game-raster')
    expect(fields.find(field => field.id === 'metal')).toMatchObject({ columns: 2, rows: 2, cellSize: 0.5, origin: [0, 0, -1],
      samples: [[2, 3], [0, 1]], valueScale: 0.25, valueOffset: 2, unit: 'example-amount', valueMeaning: 'example/metal@1' })
    expect(fields.find(field => field.id === 'grass')).toMatchObject({ columns: 4, rows: 4, cellSize: 0.25,
      samples: [[12,13,14,15],[8,9,10,11],[4,5,6,7],[0,1,2,3]] })
    expect(result.excludedFacetIds.some(id => id.startsWith('world.game-raster'))).toBe(false)
    const first = await lease.value.page({ facet: 'game-raster', layerId: facets[0]!.layerId, lod: 'exact', limit: 1 })
    await expect(lease.value.page({ facet: 'game-raster', layerId: facets[1]!.layerId, lod: 'exact', limit: 1, cursor: first.nextCursor! })).rejects.toThrow()
    const source = createUvwWorldSceneSource(result.document, { snapshotId: 'render-neutral' })
    const terrainFacet = (await source.info()).facets.find(facet => facet.facet === 'terrain')!
    const terrain = await source.page({ facet: 'terrain', layerId: terrainFacet.layerId, lod: 'exact', limit: 64 })
    const page = await source.page({ facet: 'game-raster', layerId: (await source.info()).facets.find(facet => facet.facet === 'game-raster')!.layerId, lod: 'exact', limit: 64 })
    expect(createWorldWebGlPlan({ items: [...terrain.items, ...page.items], models: new Map() }).stats.terrainTriangles).toBe(2)
  } finally { await lease.release() }
})
it('keeps partial native rasters as per-layer losses, and rejects conflicting ids or stale metadata revisions', async () => {
  const good = raster('metal', 2, 2, 0.5), bad = { ...raster('grass', 4, 4, 0.25), exact: false }
  const lease = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [good, bad] }, [], 4)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.excludedFacetIds).toContain('world.game-raster/world.game-raster:grass')
    expect(result.excludedFacetIds).not.toContain('world.game-raster/world.game-raster:metal')
  } finally { await lease.release() }
  const revisions: string[] = []
  for (const valueMeaning of ['example/metal@1','foreign/metal@1']) {
    const source = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [{ ...good, metadata: { ...good.metadata, valueMeaning } }] }, [], 4)
    try { revisions.push((await source.value.info()).facets.find(facet => facet.facet === 'game-raster')!.contentRevision!) }
    finally { await source.release() }
  }
  expect(revisions[0]).not.toBe(revisions[1])
  expect(() => createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [good,good] }, [], 4)).toThrow('unique local ids')
})

it('preserves rectangular native axis swaps and refuses unsafe numeric or window publications', async () => {
  const published = raster('attributes', 3, 2, 0.25)
  const swapped: MapGameRasterSummary = { ...published,
    grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 7 },
      columnStep: { x: 0, y: 0.25, z: 0 }, rowStep: { x: 0.25, y: 0, z: 0 } } }
  const lease = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [swapped] }, [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, { ...options, maxPageItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'game-raster')).toMatchObject({
      columns: 2, rows: 3, origin: [0, 7, -0.75], samples: [[2,5],[1,4],[0,3]] })
  } finally { await lease.release() }
  const mutations: ((value: MapGameRasterSummary) => MapGameRasterSummary)[] = [
    value => ({ ...value, trailingBytes: 1 }),
    value => ({ ...value, values: { ...value.values, values: value.values.values.slice(1) } }),
    value => ({ ...value, values: { ...value.values, x: 1 } }),
    value => ({ ...value, values: { ...value.values, values: value.values.values.map((number, index) => index === 0 ? 256 : number) } }),
    value => ({ ...value, descriptor: { ...value.descriptor, sampling: undefined } } as unknown as MapGameRasterSummary),
    value => ({ ...value, metadata: { ...value.metadata, valueMeaning: 'unversioned' } }),
    value => ({ ...value, grid: { ...value.grid, origin: { x: 2, y: 2, z: 0 } } }),
  ]
  for (const mutate of mutations) {
    const source = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters: [mutate(raster('metal',2,2,0.5))] }, [], 4)
    try {
      const facet = (await source.value.info()).facets.find(facet => facet.facet === 'game-raster')!
      expect(facet.state).toBe('partial')
      const result = await materializeWorldToUvw(source.value, options)
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      expect(result.excludedFacetIds).toContain(`world.game-raster/${facet.layerId}`)
    } finally { await source.release() }
  }
})

function nativeFrame(): ResolvedMapWorkspaceSnapshot {
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

it('keeps native raster names separate from ground, navigation and reserved fallback names across detached UVP', async () => {
  const lease = createCandidateWorldSceneLease({ ...nativeSnapshot(), gameRasters:
    ['terrain', 'terrain-game-raster', 'item-main-navigation'].map(id => raster(id, 2, 2, 0.5)) }, [], 4)
  try {
    const packed = await materializeWorldToUvpMap(lease.value, options)
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const layers = packed.document.spaces[0]!.layers
    expect(new Set(layers.map(layer => layer.id)).size).toBe(layers.length)
    expect(layers.find(layer => layer.kind === 'heightfield')?.id).toBe('terrain')
    expect(layers.find(layer => layer.kind === 'navigation')?.id).toBe('item-main-navigation')
    expect(layers.filter(layer => layer.kind === 'game-raster').map(layer => layer.id).sort()).toEqual([
      'terrain-game-raster-2', 'terrain-game-raster', 'item-main-navigation-game-raster',
    ].sort())
    const opened = await openUvpMapBundle(packed.entries, { snapshotId: 'collision-free-reopen' })
    const again = await materializeWorldToUvw(opened.source, options)
    if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
    expect(again.document).toEqual(packed.document)
  } finally { await lease.release() }
})
