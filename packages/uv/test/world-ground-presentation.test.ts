import { expect, it } from 'vitest'
import type {
  CandidateWorldSceneSource, MapCliffSummary, MapTerrainSample, ResolvedMapWorkspaceSnapshot, WorldSceneTerrainItem,
} from '@modkit/sdk/maps'
import { createCandidateWorldSceneLease } from '@modkit/host'
import { materializeWorldToUvw, materializeWorldToUvpMap, openUvpMapBundle, validateUvwProfile } from '../src/world/index.js'

// A 2x2 native ground stored north row first (sourceRowOrder reverse) under a 4x4 cliff grid:
// the presentation a native SC2 world attaches to its ground and cliffs must survive UVW and UVP.
function snapshot(samples: readonly MapTerrainSample[], cliffs: MapCliffSummary): ResolvedMapWorkspaceSnapshot {
  const identity = { schemaVersion: 1 as const, workspaceId: 'presentation-fixture', gameId: 'example/game',
    mapId: 'map', analyzerId: 'fixture', snapshotId: 'presentation-fixture' }
  return { ...identity,
    semantic: { ...identity, documentPaths: [], objects: [], regions: [], catalogQueries: [],
      resolvedCatalogObjects: 0, diagnostics: [], complete: true,
      terrain: { version: 1, width: 2, height: 2, cellCount: 4, minimumHeightBase: 0, maximumHeightBase: 0,
        minimumHeightAdjustment: 0, maximumHeightAdjustment: 0, trailingBytes: 0, samples } },
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
    cliffs,
    worldCandidate: { contract: 'example/world', major: 1, maturity: 'publisher-candidate',
      coordinateSpaces: ['map-native', 'height-grid', 'uvw-canonical'].map(id => ({
        id, horizontalAxes: ['x', 'y'], verticalAxis: 'z', handedness: 'right', linearUnit: 'fixture', rotationUnit: 'radian', origin: 'fixture' })),
      crossSpaceTransforms: [], unknownFacets: [] },
    unresolvedRequirementIds: [], diagnostics: [], diagnosticsTruncated: false, complete: true,
  }
}
const samples = (ambientOcclusion: (index: number) => number | undefined): MapTerrainSample[] =>
  Array.from({ length: 4 }, (_, index) => {
    const value = ambientOcclusion(index)
    return { x: index % 2, y: Math.floor(index / 2), heightBase: 0, heightAdjustment: 0, mask: 0,
      ...(value === undefined ? {} : { ambientOcclusion: value }),
      ...(index === 0 ? { presentationCellHidden: true as const } : {}) }
  })
const cliffs: MapCliffSummary = { version: 1, width: 4, height: 4, cellCount: 16, exact: true,
  grid: { coordinateSpaceId: 'map-native', origin: { x: 0.125, y: 0.125, z: 0 },
    columnStep: { x: 0.25, y: 0, z: 0 }, rowStep: { x: 0, y: 0.25, z: 0 } },
  samples: Array.from({ length: 16 }, (_, index) => ({ x: index % 4, y: Math.floor(index / 4), level: index % 3,
    authored: true, ...(index % 5 === 0 ? { ramp: true } : {}) })) }
const options = { maxPageItems: 64, maxTerrainItems: 4, maxFacetItems: 128, maxOutputBytes: 128_000 }

it('keeps ground presentation and cliff ramps in UVW rows, through UVP and back', async () => {
  const lease = createCandidateWorldSceneLease(snapshot(samples(index => (index + 1) / 10), cliffs), [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const layers = result.document.spaces[0]!.layers
    // canonical row 0 is the native north row y=1
    expect(layers.find(layer => layer.kind === 'heightfield')).toMatchObject({
      ambientOcclusion: [[0.3, 0.4], [0.1, 0.2]], presentationCellHidden: [[true]] })
    expect(layers.find(layer => layer.kind === 'cliffs')).toMatchObject({
      ramps: [[false, false, false, true], [false, false, true, false], [false, true, false, false], [true, false, false, false]] })
    expect(result.lostFields.map(field => field.path)).not.toContain('world.cliffs.ramp')
    expect(result.lostFields.map(field => field.path)).not.toContain('world.terrain.ambientOcclusion')

    const packed = await materializeWorldToUvpMap(lease.value, { ...options, packageId: 'test/presentation', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const detached = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])), { snapshotId: 'detached-presentation' })
    const again = await materializeWorldToUvw(detached.source, options)
    if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
    expect(again.document).toEqual(packed.document)
    const terrain = (await detached.source.info()).facets.find(facet => facet.facet === 'terrain')!
    const page = await detached.source.page({ facet: 'terrain', layerId: terrain.layerId, lod: 'exact', limit: 64 })
    const at = (x: number, y: number) => page.items.find(item => item.facet === 'terrain' && item.x === x && item.y === y) as WorldSceneTerrainItem
    expect(at(0, 0)).toMatchObject({ ambientOcclusion: 0.3, presentationCellHidden: true })
    expect(at(1, 1)).toMatchObject({ ambientOcclusion: 0.2 })
    expect(at(1, 0).presentationCellHidden).toBeUndefined()
  } finally { await lease.release() }
})

it('reports a partial per-sample value lost instead of inventing the missing samples', async () => {
  const lease = createCandidateWorldSceneLease(snapshot(samples(index => index === 3 ? undefined : 0.5), cliffs), [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).not.toHaveProperty('ambientOcclusion')
    expect(result.lostFields).toContainEqual({ path: 'world.terrain.ambientOcclusion', count: 3 })
  } finally { await lease.release() }
})

it('admits the grids only on ground, in their own shapes and ranges', async () => {
  const lease = createCandidateWorldSceneLease(snapshot(samples(() => 1), cliffs), [], 64)
  const base = await (async () => {
    try {
      const result = await materializeWorldToUvw(lease.value as CandidateWorldSceneSource, options)
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
      return result.document
    } finally { await lease.release() }
  })()
  const mutate = (change: (ground: Record<string, unknown>) => void) => {
    const input = JSON.parse(JSON.stringify(base))
    change(input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'heightfield'))
    return () => validateUvwProfile(input)
  }
  expect(mutate(ground => { ground['baseOffsets'] = [[0, -1], [0.5, 0]] })).not.toThrow()
  expect(mutate(ground => { ground['ambientOcclusion'] = [[0, 1], [1.5, 1]] })).toThrow()
  expect(mutate(ground => { ground['presentationCellHidden'] = [[true, false]] })).toThrow()
  expect(mutate(ground => { ground['baseOffsets'] = [[0, 0]] })).toThrow()
})

it('writes a world whose colorization carries palette variations, naming them among the lost fields', async () => {
  const lit = { ...snapshot(samples(() => undefined), cliffs),
    lighting: { coordinateSpaceId: 'map-native', ambientColor: [0.2, 0.2, 0.2] as const, ambientIntensity: 1, directional: [],
      toneMapping: { operator: 'filmic' as const, exposure: 1, whitePoint: 2, contrast: 1,
        colorization: { hue: 0, saturation: 0.5, lightness: 0, brightness: 1, contrast: 1, blend: 0.5, inputLow: 0, inputHigh: 1,
          inputGamma: 1, outputLow: 0, outputHigh: 1,
          variations: [{ command: 'red' as const, region: 'midtones' as const, steps: 2 }] } } } }
  const lease = createCandidateWorldSceneLease(lit, [], 64)
  try {
    const result = await materializeWorldToUvw(lease.value, options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.lostFields).toContainEqual({ path: 'world.lighting.toneMapping.colorization.variations', count: 1 })
    const lighting = result.document.spaces[0]!.layers.find(layer => layer.kind === 'lighting')
    expect(lighting).toMatchObject({ toneMapping: { colorization: { saturation: 0.5, blend: 0.5 } } })
  } finally { await lease.release() }
})
