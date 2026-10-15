import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createUvwGltfDocument, prepareUvwGltfMigration, restoreUvwProfileDocument, assertUvwProfile } from './uvw-profile.mjs'
import { uvwGltfGraph } from './uvw-gltf.mjs'
import { verifyUvwGltfMigration } from './uvw-gltf-migration.mjs'
import { jcsStringify, uvpJsonArtifactDigest, uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { composeVerifiedReceipt, verifiedCompositionDocuments, verifiedCompositionModels,
  verifiedCompositionWorldSpaces } from './uv-composition.mjs'
import { packGlb, readGltfFixture } from './uvm-core.mjs'
import { fileURLToPath } from 'node:url'
import { runBrowserWorker } from '../../runtime/test/browser-runner.ts'
import { assertTerrainAtlas, assertDerivedCliffObject } from './uvw-terrain-atlas.ts'

const read = name => readFile(new URL(name, import.meta.url), 'utf8').then(JSON.parse)
const fixture = await read('../world/fixtures/uvw-gltf-spatial.uvw.gltf')
const painted = await read('../world/fixtures/uvw-gltf-materials.uvw.gltf')
const digest = 'sha256:03e22857c5669457721eb6a0c4d52055010175711beb11838926ebda3bc7a927'

test('exact glTF spatial migration round-trips JSON numbers, noData, ordering and comments', async () => {
  const source = restoreUvwProfileDocument(fixture)
  const before = jcsStringify(source)
  const migrated = createUvwGltfDocument(source)
  assert.deepEqual(migrated, fixture)
  assert.equal(jcsStringify(source), before)
  const graph = uvwGltfGraph(migrated)
  const surface = graph.spaces[0].layers[0]
  assert.equal(surface.samples[0][0], 1 + 2 ** -32)
  assert.notEqual(surface.samples[0][0], Math.fround(surface.samples[0][0]))
  assert.equal(surface.samples[0][3], surface.noDataValue)
  assert.equal(jcsStringify(restoreUvwProfileDocument(migrated)), before)
  assert.equal(await uvpJsonArtifactDigest('uvw', migrated), digest)
  const oldDomain = 'sha256:' + createHash('sha256').update(jcsStringify({ schemaVersion: 1,
    domain: 'uvp/artifact/uvw@1', value: migrated })).digest('hex')
  assert.notEqual(oldDomain, digest)
  assert.notEqual(await uvpJsonArtifactDigest('uvw', source), digest)
  surface.samples[0][0] = 7
  assert.equal(jcsStringify(source), before)
  assert.equal(jcsStringify(restoreUvwProfileDocument(fixture)), before)
})

test('authored cliffs migrate exactly and malformed level/mask grids refuse', () => {
  const source = restoreUvwProfileDocument(fixture)
  const cliff = { schemaVersion: 1, id: 'cliffs', kind: 'cliffs', columns: 2, rows: 2,
    cellSize: 1, origin: [0, 0, 0], levels: [[0, 0], [1, 1]],
    authored: [[false, false], [true, true]] }
  source.spaces[0].layers.unshift(cliff)
  const migrated = createUvwGltfDocument(source)
  assert.deepEqual(migrated.extensions.UV_world_graph.spaces[0].layers[0], cliff)
  assert.deepEqual(restoreUvwProfileDocument(migrated), source)
  for (const referenceY of [-100, 100]) {
    const displacedPlane = structuredClone(migrated)
    displacedPlane.extensions.UV_world_graph.spaces[0].layers[0].origin[1] = referenceY
    assert.doesNotThrow(() => assertUvwProfile(displacedPlane))
  }
  for (const mutate of [
    layer => { layer.levels[1].pop() },
    layer => { layer.authored[0][0] = 1 },
    layer => { layer.origin[0] = -1 },
  ]) {
    const invalid = structuredClone(migrated)
    mutate(invalid.extensions.UV_world_graph.spaces[0].layers[0])
    assert.throws(() => assertUvwProfile(invalid), error => error.rule?.startsWith('cliffs-'))
  }
})

test('regions, gateways and lighting retain exact authored values with preview scope', async () => {
  const source = restoreUvwProfileDocument(fixture)
  const reference = await read('../world/fixtures/uvw-profile-renderable-world.uvw.json')
  const visual = reference.spaces[0].layers.filter(layer =>
    ['regions', 'gateways', 'lighting'].includes(layer.kind))
  source.spaces[0].layers.push(...structuredClone(visual))
  source.spaces[0].layers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const prepared = prepareUvwGltfMigration(source)
  assert.equal(prepared.scope, 'preview')
  assert.deepEqual(prepared.visualLayers.map(row => row.kind), ['gateways', 'lighting', 'regions'])
  assert.deepEqual(restoreUvwProfileDocument(prepared.document), source)
  const compose = async (id, path, document) => {
    const hash = await uvpJsonArtifactDigest('uvw', document)
    const manifest = { id, version: '1.0.0', kind: 'map', dependencies: [],
      requires: { intrinsics: [], capabilities: [] }, contents: [{ family: 'uvw', path, hash }] }
    const result = await composeVerifiedReceipt(id, [manifest], { intrinsics: [] }, [],
      async () => ({ digest: hash, document }))
    assert.equal(result.refusal, undefined)
    return result.receipt
  }
  const sourceReceipt = await compose('sample/visual-source', 'worlds/source.uvw.json', source)
  const targetReceipt = await compose('sample/visual-target', 'worlds/target.uvw.gltf', prepared.document)
  const migration = await verifyUvwGltfMigration(sourceReceipt, targetReceipt,
    { sourcePackageId: 'sample/visual-source', sourcePath: 'worlds/source.uvw.json',
      targetPackageId: 'sample/visual-target', targetPath: 'worlds/target.uvw.gltf' })
  assert.equal(migration.scope, 'preview')
  assert.equal(migration.losses.length, 3)
  for (const [kind, mutate] of [
    ['gateways', layer => { layer.segments[0].end = [...layer.segments[0].start] }],
    ['lighting', layer => { layer.directional[0].direction = [0, 0, 0] }],
    ['regions', layer => { layer.regions[0].shapes[0].radius = 0 }],
  ]) {
    const invalid = structuredClone(prepared.document)
    const layer = invalid.extensions.UV_world_graph.spaces[0].layers.find(row => row.kind === kind)
    mutate(layer)
    assert.throws(() => assertUvwProfile(invalid), error => error.rule?.startsWith(`${kind}-`))
  }
})

test('lighting retains the Core world contract and refuses malformed optional settings', async () => {
  const source = restoreUvwProfileDocument(fixture)
  const reference = await read('../world/fixtures/uvw-profile-renderable-world.uvw.json')
  const lighting = reference.spaces[0].layers.find(layer => layer.kind === 'lighting')
  source.spaces[0].layers.push(lighting)
  source.spaces[0].layers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  lighting.terrain = { specularExponent: 16, diffuseMultiplier: 1, specularMultiplier: 0.5 }
  lighting.toneMapping = { operator: 'filmic', exposure: 1, whitePoint: 2, contrast: 1,
    correctGamma: true,
    colorization: { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1,
      brightness: 0, contrast: 1, hue: 0, saturation: 1, lightness: 0, blend: 0.5 },
    ambientOcclusion: { radius: 1, noOcclusion: 0, fullOcclusion: 1, power: 2 } }
  Object.assign(lighting.directional[0], { specularColor: [0.2, 0.3, 0.4],
    specularIntensity: 1, useAmbientOcclusion: false })
  assert.doesNotThrow(() => assertUvwProfile(source))
  assert.deepEqual(restoreUvwProfileDocument(createUvwGltfDocument(source)), source)
  for (const mutate of [
    layer => { layer.toneMapping.exposure = 0 },
    layer => { layer.toneMapping.operator = 'unknown' },
    layer => { delete layer.toneMapping.colorization.hue },
    layer => { layer.toneMapping.ambientOcclusion.power = Infinity },
    layer => { layer.terrain.extra = 0 },
    layer => { layer.directional[0].useAmbientOcclusion = 1 },
  ]) {
    const invalid = structuredClone(source)
    mutate(invalid.spaces[0].layers.find(layer => layer.kind === 'lighting'))
    assert.throws(() => assertUvwProfile(invalid), error => error.rule === 'lighting-value')
  }
})

test('glTF envelope refuses unknown profiles, undeclared support, buffers and mixed legacy fields', async () => {
  for (const change of [
    d => { d.asset.version = '1.0' },
    d => { d.asset.extras.uv.version = '2.0' },
    d => { d.asset.extras.uv.profile = 'visual' },
    d => { delete d.extensionsRequired },
    d => { d.extensionsUsed = [] },
    d => { d.extensionsRequired = [] },
    d => { d.extensions.UNKNOWN = {} },
    d => { d.buffers = [{ byteLength: 1, uri: 'unknown.bin' }] },
    d => { d.materials = [] },
    d => { d.uv = { format: 'UVW' }; d.spaces = [] },
  ]) {
    const invalid = structuredClone(fixture); change(invalid)
    assert.throws(() => assertUvwProfile(invalid), /uvw-gltf-envelope/)
    await assert.rejects(uvpJsonArtifactDigest('uvw', invalid), /uvw-gltf-envelope/)
  }
  for (const change of [
    g => { g.schemaVersion = 2 }, g => { g.spaces = [] },
    g => { g.connections = [{ kind: 'portal' }] },
    g => { g.spaces[0].topology = 'volume' },
  ]) {
    const invalid = structuredClone(fixture); change(invalid.extensions.UV_world_graph)
    assert.throws(() => assertUvwProfile(invalid), /uvw-gltf-profile/)
  }
})

test('migration refuses visual layers and unknown source data instead of dropping them', async () => {
  const renderable = await read('../world/fixtures/uvw-profile-renderable-world.uvw.json')
  // The historical schema-only fixture is not ordered for the semantic verifier.
  for (const space of renderable.spaces) space.layers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const before = jcsStringify(renderable)
  assert.throws(() => createUvwGltfDocument(renderable), error => /^uvw-gltf-(layer|material-source)$/.test(error.rule ?? ''))
  assert.equal(jcsStringify(renderable), before)
  for (const change of [d => { d.uv.version = '2.0' }, d => { d.extra = {} }, d => { d.uv.extra = {} }]) {
    const source = restoreUvwProfileDocument(fixture); change(source)
    assert.throws(() => createUvwGltfDocument(source), error => error.rule === 'uvw-gltf-source')
  }
  const invalid = structuredClone(fixture)
  invalid.extensions.UV_world_graph.spaces[0].layers[1].exits[0][0] = 2
  assert.throws(() => assertUvwProfile(invalid), /edge from/)
})

const materialPolicies = [
  { spaceId: 'main', layerId: 'paint', materialId: 'grass', policy: { metallicFactor: 0, roughnessFactor: 1, alphaMode: 'OPAQUE' } },
  { spaceId: 'main', layerId: 'paint', materialId: 'rock', policy: { metallicFactor: 0, roughnessFactor: 1, alphaMode: 'OPAQUE' } },
  { spaceId: 'main', layerId: 'water', materialId: 'lake', policy: { metallicFactor: 0, roughnessFactor: 0.2, alphaMode: 'BLEND', waterColorSpace: 'linear' } },
]
function materialSource() {
  const source = restoreUvwProfileDocument(fixture)
  delete source.$comment
  source.spaces[0].layers = structuredClone(painted.extensions.UV_world_graph.spaces[0].layers)
  source.spaces[0].layers[0].materials = [
    { id: 'grass', label: 'Grass', classification: 'grass', sourceIndex: 3, baseColorFactor: [0.25, 0.5, 0.125, 1] },
    { id: 'rock' },
  ]
  source.spaces[0].layers[3].materials = [
    { id: 'lake', label: 'Lake', classification: 'water', shorelineMode: 'terrain-clipped', color: [0, 0.125, 0.5, 0.75] },
  ]
  return source
}

test('terrain blends and water use one glTF material table with explicit per-source projection policy', async () => {
  const source = materialSource(), before = jcsStringify(source)
  const result = createUvwGltfDocument(source, { materialPolicies })
  assert.deepEqual(result, painted)
  assert.equal(jcsStringify(source), before)
  assert.equal(assertUvwProfile(result), result)
  assert.equal(uvwGltfGraph(result), result.extensions.UV_world_graph)
  assert.equal(result.materials[1].pbrMetallicRoughness.baseColorFactor, undefined)
  assert.equal(result.extensions.UV_world_graph.spaces[0].layers[0].materials[0].baseColorFactor, undefined)
  assert.throws(() => restoreUvwProfileDocument(result), error => error.rule === 'uvw-gltf-restore-material')
  const oldHash = await uvpJsonArtifactDigest('uvw', result)
  result.materials[0].pbrMetallicRoughness.baseColorFactor[0] = 0.9
  assert.notEqual(await uvpJsonArtifactDigest('uvw', result), oldHash)
  assert.equal(jcsStringify(source), before)
})

test('material migration refuses guesses, duplicate policies and every unsupported source field atomically', () => {
  const source = materialSource(), before = jcsStringify(source)
  for (const policies of [[], materialPolicies.slice(1), [...materialPolicies, materialPolicies[0]],
    [...materialPolicies, { ...materialPolicies[0], materialId: 'missing' }]])
    assert.throws(() => createUvwGltfDocument(source, { materialPolicies: policies }), error => error.rule === 'uvw-gltf-material-policy')
  assert.equal(jcsStringify(source), before)
  for (const [layerIndex, key, value] of [[0, 'baseColorResourceId', 'image'], [0, 'normalResourceId', 'image'],
    [0, 'uvTransform', { offset: [0, 0], scale: [1, 1], rotation: 0 }],
    [3, 'scroll', [1, 0, 0, 1]], [3, 'receiveShadows', false], [3, 'unknown', 1]]) {
    const input = materialSource(); input.spaces[0].layers[layerIndex].materials[0][key] = value
    const snapshot = jcsStringify(input)
    assert.throws(() => createUvwGltfDocument(input, { materialPolicies }), error => error.rule === 'uvw-gltf-material-source')
    assert.equal(jcsStringify(input), snapshot)
  }
  const raster = materialSource(); raster.spaces[0].layers[0].weightRasters = []
  assert.throws(() => createUvwGltfDocument(raster, { materialPolicies }),
    error => error.rule === 'uvw-gltf-layer')
  const missingColorPolicy = structuredClone(materialPolicies)
  delete missingColorPolicy[2].policy.waterColorSpace
  assert.throws(() => createUvwGltfDocument(source, { materialPolicies: missingColorPolicy }), /material-color-policy/)
})

test('material admission rejects broken joins, incomplete blends, mixed dialects and external resource escapes', async () => {
  for (const change of [
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials[0].material = 5 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials[0].material = -1 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials[0].material = 0.5 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials[1].id = 'grass' },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials.reverse() },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].materials[0].baseColorFactor = [1, 1, 1, 1] },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples.pop() },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples[0][0].weights[0].materialId = 'lake' },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples[0][0].weights[0].weight = 0.5 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples[0][1].weights[1].materialId = 'grass' },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].samples[0][1].weights.reverse() },
    d => { d.extensions.UV_world_graph.spaces[0].layers[0].origin[0] = 1 },
    d => { d.extensions.UV_world_graph.spaces[0].layers[3].zones[0].materialId = 'grass' },
    d => { d.extensions.UV_world_graph.spaces[0].layers[3].zones[0].minimum = [2, 2] },
    d => { d.extensions.UV_world_graph.spaces[0].layers[3].zones.push(d.extensions.UV_world_graph.spaces[0].layers[3].zones[0]) },
    d => { d.materials[0].extensions = { UNKNOWN: {} } },
    d => { delete d.materials },
    d => { d.materials[0].extensions = { KHR_materials_specular: {} } },
    d => { d.materials[0].normalTexture = { index: 0 } },
    d => { d.textures = []; d.images = [{ uri: 'file:///outside.png' }] },
  ]) {
    const invalid = structuredClone(painted); change(invalid)
    assert.throws(() => assertUvwProfile(invalid), /material|water-zone|envelope|resource/)
    await assert.rejects(uvpJsonArtifactDigest('uvw', invalid), /material|water-zone|envelope|resource/)
  }
})

test('whole-world migration cannot silently discard the source retained by a nonlinear material conversion', () => {
  const source = materialSource(), before = jcsStringify(source)
  const policies = structuredClone(materialPolicies)
  policies[2].policy.waterColorSpace = 'srgb'
  assert.throws(() => createUvwGltfDocument(source, { materialPolicies: policies }),
    error => error.rule === 'uvw-gltf-material-retained' && /color/.test(error.message))
  assert.equal(jcsStringify(source), before)
  // Linear material conversion still takes the original admitted route and produces the pinned fixture.
  assert.deepEqual(createUvwGltfDocument(source, { materialPolicies }), painted)
})

function resourceSource() {
  const source = materialSource()
  source.spaces[0].layers[0].materials[0].baseColorResourceId = 'color'
  source.spaces[0].layers[0].materials[0].normalResourceId = 'color'
  source.spaces[0].layers.splice(1, 0, { schemaVersion: 1, id: 'resources', kind: 'resources', resources: [
    { id: 'color', kind: 'media', uri: '../media/checker.png' },
    { id: 'model', kind: 'uvm', uri: '../models/a.uvm.gltf' },
    { id: 'unused', kind: 'media', uri: '../media/unused.png' },
  ] })
  return source
}

const resourceMappings = [
  { spaceId: 'main', layerId: 'resources', resourceId: 'unused', outputs: [] },
  { spaceId: 'main', layerId: 'resources', resourceId: 'color', outputs: [
    { usage: 'normal-linear-rgb', uri: '../media/checker.png', mimeType: 'image/png', sampler: { wrapS: 33071 } },
    { usage: 'base-color-srgb', uri: '../media/checker.png', mimeType: 'image/png', sampler: { wrapS: 10497 } },
  ] },
  { spaceId: 'main', layerId: 'resources', resourceId: 'model', outputs: [] },
]

function atlasSource() {
  const source = resourceSource(), layer = source.spaces[0].layers[0]
  layer.materials[0].atlas = { rows: 2 }
  layer.samples = layer.samples.map(row => row.map(() => ({ layers: [
    { materialId: 'grass', tile: { column: 1, row: 1 } },
    { materialId: 'grass', tile: { column: 0, row: 0 } },
  ] })))
  return source
}

const terrainCorners = await read('../world/fixtures/uvw-terrain-corners.json')
function cornerSource() {
  const source = atlasSource(), layer = source.spaces[0].layers[0]
  layer.materials[0].atlas = structuredClone(terrainCorners.material.atlas)
  layer.samples[0][0] = structuredClone(terrainCorners.sample)
  layer.samples[0][1] = structuredClone(terrainCorners.weightedSample)
  return source
}

test('terrain corner coverage, UVs and tile orientation migrate exactly into glTF', async () => {
  const source = cornerSource(), before = jcsStringify(source)
  const prepared = prepareUvwGltfMigration(source, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' })
  const layer = prepared.document.extensions.UV_world_graph.spaces[0].layers[0]
  assert.deepEqual(layer.samples, source.spaces[0].layers[0].samples)
  assert.deepEqual(layer.materials[0].atlas, terrainCorners.material.atlas)
  // The existing spatial-only reverse converter must not silently drop glTF materials.
  assert.throws(() => restoreUvwProfileDocument(prepared.document),
    error => error.rule === 'uvw-gltf-restore-material')
  assert.equal(jcsStringify(source), before)
  const hash = await uvpJsonArtifactDigest('uvw', prepared.document)
  for (const mutate of [
    row => { row.samples[0][0].layers[1].cornerAlpha.reverse() },
    row => { row.samples[0][0].cornerUv.reverse() },
    row => { row.materials[0].atlas.tileTop = 'local-y-1' },
  ]) {
    const changed = structuredClone(prepared.document)
    mutate(changed.extensions.UV_world_graph.spaces[0].layers[0])
    assert.doesNotThrow(() => assertUvwProfile(changed))
    assert.notEqual(await uvpJsonArtifactDigest('uvw', changed), hash)
  }
  // Omission retains the original profile bytes; defaults are never materialized.
  const old = atlasSource(), migrated = prepareUvwGltfMigration(old, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }).document
  const oldLayer = migrated.extensions.UV_world_graph.spaces[0].layers[0]
  assert.deepEqual(oldLayer.samples, old.spaces[0].layers[0].samples)
  assert.deepEqual(oldLayer.materials[0].atlas, { rows: 2 })
})

test('terrain corner validators reject malformed values in both envelopes without repair', () => {
  const source = cornerSource()
  const target = prepareUvwGltfMigration(source, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }).document
  for (const mutate of [
    row => { row.materials[0].atlas.tileTop = 'north' },
    row => { row.samples[0][0].cornerUv.pop() },
    row => { row.samples[0][1].cornerUv[0].push(2) },
    row => { row.samples[0][1].cornerUv[0][0] = Infinity },
    row => { delete row.samples[0][1].cornerUv[0][0] },
    row => { row.samples[0][0].layers[1].cornerAlpha.pop() },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = -0.01 },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = 1.01 },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = NaN },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = true },
    row => { delete row.samples[0][0].layers[1].cornerAlpha[0] },
  ]) {
    for (const original of [source, target]) {
      const invalid = structuredClone(original)
      const layer = invalid.spaces?.[0].layers[0] ?? invalid.extensions.UV_world_graph.spaces[0].layers[0]
      mutate(layer)
      const before = structuredClone(invalid)
      assert.throws(() => assertUvwProfile(invalid), /terrain-atlas|terrain-corner/)
      assert.deepEqual(invalid, before)
    }
  }
})

test('atlas-only terrain migrates without changing tile order or duplicating material schema', () => {
  const source = atlasSource(), before = jcsStringify(source)
  const prepared = prepareUvwGltfMigration(source, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' })
  const layer = prepared.document.extensions.UV_world_graph.spaces[0].layers[0]
  assert.deepEqual(layer.materials[0].atlas, { rows: 2 })
  assert.deepEqual(layer.samples, source.spaces[0].layers[0].samples)
  assert.equal(layer.samples[0][0].weights, undefined)
  assert.ok(prepared.document.materials[0].pbrMetallicRoughness.baseColorTexture)
  assert.equal(prepared.document.materials[0].atlas, undefined)
  assert.equal(jcsStringify(source), before)
  assert.equal(assertUvwProfile(prepared.document), prepared.document)
})

test('atlas sample order can use sixteen materials while references and rows stay checked', async () => {
  const document = await read('../world/fixtures/uvw-gltf-textured.uvw.gltf')
  const layer = document.extensions.UV_world_graph.spaces[0].layers.find(row => row.kind === 'terrain-materials')
  layer.materials = Array.from({ length: 16 }, (_, index) => ({
    id: `tiles-${String(index).padStart(2, '0')}`, material: 0, atlas: { rows: 2 },
  }))
  const entries = layer.materials.map((material, index) => ({
    materialId: material.id, tile: { column: index % 2, row: index % 2 },
  })).reverse()
  layer.samples = layer.samples.map(row => row.map(() => ({ layers: structuredClone(entries) })))
  const before = jcsStringify(document), hash = await uvpJsonArtifactDigest('uvw', document)
  assert.equal(uvwGltfGraph(document), document.extensions.UV_world_graph)
  assert.equal(jcsStringify(document), before)
  const changed = structuredClone(document)
  changed.extensions.UV_world_graph.spaces[0].layers[0].samples[0][0].layers.reverse()
  assert.notEqual(await uvpJsonArtifactDigest('uvw', changed), hash)
})

test('atlas source and glTF validators refuse malformed joins without repairing input', () => {
  const valid = prepareUvwGltfMigration(atlasSource(), { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }).document
  for (const mutate of [
    layer => { layer.materials[0].atlas.rows = 0 },
    layer => { layer.materials[0].atlas.extra = true },
    (layer, document) => {
      if (document) delete document.materials[layer.materials[0].material].pbrMetallicRoughness.baseColorTexture
      else delete layer.materials[0].baseColorResourceId
    },
    layer => { delete layer.materials[0].atlas },
    layer => { layer.samples[0][0].layers = [] },
    layer => { layer.samples[0][0].layers[0].materialId = 'missing' },
    layer => { layer.samples[0][0].layers[0].tile.row = 2 },
    layer => { layer.samples[0][0].layers[0].tile.column = -1 },
    layer => { layer.samples[0][0].layers[0].tile.row = 0.5 },
    layer => { layer.samples[0][0].layers[0].tile.column = 2 ** 53 },
    layer => { layer.samples[0][0].weights = [{ materialId: 'grass', weight: 0.2 }] },
  ]) {
    const source = atlasSource(); mutate(source.spaces[0].layers[0])
    const before = jcsStringify(source)
    assert.throws(() => assertUvwProfile(source), /terrain-atlas|material-weight/)
    assert.equal(jcsStringify(source), before)
    const target = structuredClone(valid)
    mutate(target.extensions.UV_world_graph.spaces[0].layers[0], target)
    const targetBefore = jcsStringify(target)
    assert.throws(() => assertUvwProfile(target), /terrain-atlas|material-weight/)
    assert.equal(jcsStringify(target), targetBefore)
  }
  const source = atlasSource()
  source.spaces[0].layers[0].samples[0][0].weights = [{ materialId: 'grass', weight: 1 }]
  assert.doesNotThrow(() => assertUvwProfile(source))
})

test('derived cliff pieces retain their marker and reject ordinary unit placements', async () => {
  const source = resourceSource()
  const fixture = await read('../world/fixtures/uvw-gltf-objects.uvw.gltf')
  const objects = structuredClone(fixture.extensions.UV_world_graph.spaces[0].layers[0])
  source.spaces[0].layers.unshift(objects)
  const instance = source.spaces[0].layers[0].instances[0]
  instance.objectKind = 'doodad'; instance.derivedFrom = 'cliffs'
  const document = prepareUvwGltfMigration(source, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }).document
  assert.deepEqual(document.extensions.UV_world_graph.spaces[0].layers[0], objects)
  assert.equal(assertUvwProfile(document), document)
  const withoutMarker = structuredClone(document)
  delete withoutMarker.extensions.UV_world_graph.spaces[0].layers[0].instances[0].derivedFrom
  assert.notEqual(await uvpJsonArtifactDigest('uvw', document), await uvpJsonArtifactDigest('uvw', withoutMarker))
  for (const value of ['unit', 'structure']) {
    const invalid = structuredClone(document)
    invalid.extensions.UV_world_graph.spaces[0].layers[0].instances[0].objectKind = value
    assert.throws(() => assertUvwProfile(invalid), error => error.rule === 'objects-derived-from')
  }
  instance.derivedFrom = 'terrain'
  assert.throws(() => assertUvwProfile(source), error => error.rule === 'objects-derived-from')
})

test('atlas and derived-piece validation gives identical results in Node and Chrome', {
  skip: process.env.MULTIVERSE_TEST_REAL_BROWSER !== '1',
}, async () => {
  const good = atlasSource().spaces[0].layers[0]
  const bad = structuredClone(good); bad.samples[0][0].layers[0].tile.row = 2
  const inputs = [{ layer: good }, { layer: bad }, { layer: good,
    object: { objectKind: 'doodad', derivedFrom: 'cliffs' } }, { layer: good,
    object: { objectKind: 'unit', derivedFrom: 'cliffs' } }]
  const corners = cornerSource().spaces[0].layers[0]
  inputs.push({ layer: corners })
  for (const mutate of [
    row => { row.samples[0][1].cornerUv[0][0] = Infinity },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = NaN },
    row => { row.samples[0][0].layers[1].cornerAlpha[0] = true },
    row => { row.materials[0].atlas.tileTop = 'north' },
  ]) {
    const invalid = structuredClone(corners); mutate(invalid)
    inputs.push({ layer: invalid })
  }
  const expected = inputs.map(input => {
    try {
      assertTerrainAtlas(input.layer, input.document)
      if (input.object !== undefined) assertDerivedCliffObject(input.object)
      return { accepted: true }
    } catch (error) { return { message: error.message, rule: error.rule } }
  })
  const browser = await runBrowserWorker(new URL('./uvw-atlas-browser.ts', import.meta.url), inputs)
  assert.deepEqual(browser.result, { result: expected })
})

test('placed objects retain compound model links through the addressed resource catalog', () => {
  const source = resourceSource()
  const objectLayer = { schemaVersion: 1, id: 'objects', kind: 'objects', instances: [
    { id: 'actor', objectKind: 'unit', position: [0.5, 0.5, 0.5],
      rotation: [0, 0, 0, 1], scale: [1, 1, 1], resourceIds: ['model'],
      modelComponents: [
        { id: 'body', resourceId: 'model' },
        { id: 'weapon', resourceId: 'model', parentId: 'body', parentSocketId: 'weapon-socket' },
      ] },
  ] }
  source.spaces[0].layers.unshift(objectLayer)
  const prepared = prepareUvwGltfMigration(source, { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' })
  const target = prepared.document
  assert.equal(prepared.scope, 'preview')
  assert.deepEqual(prepared.visualLayers.map(row => row.kind), ['objects'])
  assert.deepEqual(target.extensions.UV_world_graph.spaces[0].layers[0], objectLayer)
  assert.equal(assertUvwProfile(target), target)
  for (const mutate of [
    object => { object.resourceIds = ['missing'] },
    object => { object.modelComponents[0].parentId = 'weapon'; object.modelComponents[0].parentSocketId = 'weapon-socket' },
    object => { object.rotation = [0, 0, 0, 2] },
  ]) {
    const invalid = structuredClone(target)
    mutate(invalid.extensions.UV_world_graph.spaces[0].layers[0].instances[0])
    assert.throws(() => assertUvwProfile(invalid), error => error.rule?.startsWith('objects-'))
  }
})

test('migration proves component sockets from hashed UVM GLB bytes', async () => {
  const source = resourceSource()
  source.spaces[0].layers.find(layer => layer.kind === 'resources').resources
    .find(resource => resource.id === 'model').uri = '../models/a.uvm.glb'
  source.spaces[0].layers.unshift({ schemaVersion: 1, id: 'objects', kind: 'objects', instances: [
    { id: 'actor', objectKind: 'unit', position: [0.5, 0.5, 0.5],
      rotation: [0, 0, 0, 1], scale: [1, 1, 1], resourceIds: ['model'], modelComponents: [
        { id: 'body', resourceId: 'model' },
        { id: 'weapon', resourceId: 'model', parentId: 'body', parentSocketId: 'weapon-socket' },
      ] },
  ] })
  const options = { sourcePackageId: 'sample/socket-source', sourcePath: 'worlds/source.uvw.json',
    targetPackageId: 'sample/socket-target', targetPath: 'worlds/target.uvw.gltf',
    materialPolicies, resourceMappings }
  const target = prepareUvwGltfMigration(source, options).document
  const { document, binary } = readGltfFixture(fileURLToPath(
    new URL('../model/fixtures/uvm-core-rig.uvm.gltf', import.meta.url)))
  document.extensionsUsed.push('UV_game_socket')
  document.nodes.push({ name: 'weapon socket', extensions: { UV_game_socket: {
    id: 'weapon-socket', role: 'attach',
    extras: { modkit: { id: 'weapon-socket', nodeId: 'socket-node' } },
  } } })
  const modelBytes = packGlb(document, binary)
  const mediaBytes = new Uint8Array(await readFile(new URL('../world/fixtures/media/checker.png', import.meta.url)))
  const mediaHash = await uvpMediaArtifactDigest(mediaBytes)
  const compose = async (id, path, world, bytes, modelWitness = true) => {
    const modelHash = await uvpMediaArtifactDigest(bytes)
    const manifest = { id, version: '1.0.0', kind: 'map', dependencies: [],
      requires: { intrinsics: [], capabilities: [] }, contents: [
        { family: 'uvw', path, hash: await uvpJsonArtifactDigest('uvw', world) },
        { family: 'media', path: 'media/checker.png', hash: mediaHash },
        { family: 'media', path: 'media/unused.png', hash: mediaHash },
        { family: 'uvm', path: 'models/a.uvm.glb', hash: modelHash },
      ] }
    const result = await composeVerifiedReceipt(id, [manifest], { intrinsics: [] }, [],
      async ({ content }) => content.family === 'uvw' ? { digest: content.hash, document: world }
        : content.family === 'media' ? { digest: content.hash, bytes: mediaBytes }
          : modelWitness ? { digest: content.hash, bytes } : content.hash)
    assert.equal(result.refusal, undefined)
    return result.receipt
  }
  const sourceReceipt = await compose(options.sourcePackageId, options.sourcePath, source, modelBytes)
  const targetReceipt = await compose(options.targetPackageId, options.targetPath, target, modelBytes)
  const firstCopy = await verifiedCompositionModels(targetReceipt)
  firstCopy.models[0].bytes[0] = 0
  assert.equal((await verifiedCompositionModels(targetReceipt)).models[0].bytes[0], modelBytes[0])
  const receipt = await verifyUvwGltfMigration(sourceReceipt, targetReceipt, options)
  assert.deepEqual(receipt.socketLinks.map(row => [row.parentSocketId, row.nodeIndex]),
    [['weapon-socket', document.nodes.length - 1]])
  assert.equal(receipt.scope, 'preview')
  const legacySocket = structuredClone(document)
  delete legacySocket.nodes.at(-1).extensions.UV_game_socket.id
  const legacyBytes = packGlb(legacySocket, binary)
  const legacySource = await compose(options.sourcePackageId, options.sourcePath, source, legacyBytes)
  const legacyTarget = await compose(options.targetPackageId, options.targetPath, target, legacyBytes)
  assert.equal((await verifyUvwGltfMigration(legacySource, legacyTarget, options)).socketLinks.length, 1)
  const digestOnly = await compose(options.targetPackageId, options.targetPath, target, modelBytes, false)
  await assert.rejects(verifyUvwGltfMigration(sourceReceipt, digestOnly, options),
    /uvw-gltf-model-unverified/)
  const sourceDigestOnly = await compose(options.sourcePackageId, options.sourcePath, source, modelBytes, false)
  await assert.rejects(verifyUvwGltfMigration(sourceDigestOnly, targetReceipt, options),
    /uvw-gltf-model-unverified/)
  const missingSocket = structuredClone(document)
  missingSocket.nodes.at(-1).extensions.UV_game_socket.id = 'other-socket'
  const wrongBytes = packGlb(missingSocket, binary)
  const claimedHash = await uvpMediaArtifactDigest(modelBytes)
  const mismatchManifest = { id: 'sample/model-mismatch', version: '1.0.0', kind: 'map',
    dependencies: [], requires: { intrinsics: [], capabilities: [] },
    contents: [{ family: 'uvm', path: 'models/a.uvm.glb', hash: claimedHash }] }
  const mismatch = await composeVerifiedReceipt(mismatchManifest.id, [mismatchManifest],
    { intrinsics: [] }, [], async () => ({ digest: claimedHash, bytes: wrongBytes }))
  assert.equal(mismatch.refusal?.rule, 'artifact-digest-mismatch')
  const changedSource = await compose(options.sourcePackageId, options.sourcePath, source, wrongBytes)
  const changedTarget = await compose(options.targetPackageId, options.targetPath, target, wrongBytes)
  await assert.rejects(verifyUvwGltfMigration(changedSource, changedTarget, options),
    /uvw-gltf-model-socket/)
  const duplicateSocket = structuredClone(document)
  duplicateSocket.nodes.push(structuredClone(duplicateSocket.nodes.at(-1)))
  const duplicateBytes = packGlb(duplicateSocket, binary)
  const duplicateSource = await compose(options.sourcePackageId, options.sourcePath, source, duplicateBytes)
  const duplicateTarget = await compose(options.targetPackageId, options.targetPath, target, duplicateBytes)
  await assert.rejects(verifyUvwGltfMigration(duplicateSource, duplicateTarget, options),
    /Duplicate or invalid stable socket ID/)
})

test('resource preparation inventories unused media/UVM and binds one source to distinct usages and samplers', () => {
  const source = resourceSource(), before = jcsStringify(source)
  const options = { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }
  const first = prepareUvwGltfMigration(source, options)
  assert.equal(jcsStringify(source), before)
  assert.equal(assertUvwProfile(first.document), first.document)
  assert.deepEqual(first.inventory.map(row => row.source.resourceId), ['color', 'model', 'unused'])
  assert.deepEqual(first.inventory[0].outputs.map(row => row.usage), ['base-color-srgb', 'normal-linear-rgb'])
  assert.equal(first.document.samplers[0].wrapS, 10497)
  assert.equal(first.document.samplers[1].wrapS, 33071)
  assert.equal(first.document.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0)
  assert.equal(first.document.materials[0].normalTexture.index, 1)
  assert.equal(first.document.extensions.UV_world_graph.spaces[0].layers[1].resources[1].original.family, 'uvm')
  assert.deepEqual(prepareUvwGltfMigration(source, { ...options, resourceMappings: [...resourceMappings].reverse() }), first)
  const broken = structuredClone(first.document)
  broken.extensions.UV_world_graph.spaces[0].layers[1].resources[0].outputs[0].texture = 99
  assert.throws(() => assertUvwProfile(broken), /uvw-gltf-resource/)
  broken.extensions.UV_world_graph.spaces[0].layers[1].resources[0].outputs[0].texture = 0
  broken.extensions.UV_world_graph.spaces[0].layers[1].resources[0].original.path = '../outside.png'
  assert.throws(() => assertUvwProfile(broken), /resource-path/)
  assert.throws(() => createUvwGltfDocument(source, { materialPolicies }),
    error => error.rule === 'uvw-gltf-material-source')
})

test('resource preparation refuses missing/ambiguous references, unaddressed rows and escaped paths atomically', () => {
  const source = resourceSource(), before = jcsStringify(source)
  const options = { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }
  for (const mappings of [resourceMappings.slice(1), [...resourceMappings, resourceMappings[0]],
    [...resourceMappings, { spaceId: 'main', layerId: 'resources', resourceId: 'missing', outputs: [] }]])
    assert.throws(() => prepareUvwGltfMigration(source, { ...options, resourceMappings: mappings }),
      error => error.rule === 'uvw-gltf-resource-mapping')
  const duplicate = structuredClone(source)
  duplicate.spaces[0].layers.splice(2, 0, { schemaVersion: 1, id: 'resources-two', kind: 'resources',
    resources: [{ id: 'color', kind: 'media', uri: '../media/checker.png' }] })
  assert.throws(() => prepareUvwGltfMigration(duplicate, { ...options,
    resourceMappings: [...resourceMappings, { spaceId: 'main', layerId: 'resources-two', resourceId: 'color', outputs: [] }] }),
  error => error.rule === 'uvw-gltf-resource-reference')
  const escaped = structuredClone(source)
  escaped.spaces[0].layers[1].resources[0].uri = '../../../outside.png'
  assert.throws(() => prepareUvwGltfMigration(escaped, options), /resource-uri/)
  assert.equal(jcsStringify(source), before)
})

test('equal resource IDs in different spaces keep separate addresses', () => {
  const source = resourceSource()
  const second = structuredClone(source.spaces[0])
  second.id = 'other'
  second.layers = [
    { schemaVersion: 1, id: 'resources', kind: 'resources', resources: [
      { id: 'color', kind: 'media', uri: '../media/other.png' },
    ] },
    structuredClone(source.spaces[0].layers.find(layer => layer.kind === 'heightfield')),
  ]
  source.spaces.push(second)
  const prepared = prepareUvwGltfMigration(source, { materialPolicies,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf',
    resourceMappings: [...resourceMappings,
      { spaceId: 'other', layerId: 'resources', resourceId: 'color', outputs: [] }] })
  assert.deepEqual(prepared.inventory.filter(row => row.source.resourceId === 'color')
    .map(row => row.source.spaceId), ['main', 'other'])
  assert.equal(prepared.document.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0)
})

test('water uses the shared material profile with ordered caustics and packed normals', () => {
  const source = resourceSource(), water = source.spaces[0].layers[4].materials[0]
  const entries = source.spaces[0].layers[1].resources
  entries.push(...['caustics-a', 'caustics-b', 'normal', 'secondary'].map(id =>
    ({ id, kind: 'media', uri: `../media/${id}.png` })))
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  Object.assign(water, { baseColorResourceId: 'color', secondaryColorResourceId: 'secondary',
    normalResourceId: 'normal', uvScale: [1, 2, 3, 4], scroll: [0.1, 0.2, 0.3, 0.4],
    colorFalloff: 0.5, specularity: 12, specularScale: 0.8, reflectivityPower: 2,
    causticsResourceId: 'caustics-a', causticsFrameResourceIds: ['caustics-a', 'caustics-b'],
    causticsScale: [2, 3], causticsFramesPerSecond: 8, causticsFalloff: 0.4,
    receiveShadows: false })
  const policies = structuredClone(materialPolicies)
  policies[2].policy.waterSurfaceProfile = 'uv.water.surface@1'
  policies[2].policy.waterSurfaceBlend = 'blend'
  const mappings = [...resourceMappings,
    ...[['caustics-a', 'caustics-linear-rgb'], ['caustics-b', 'caustics-linear-rgb'],
      ['normal', 'wave-normal-rg-ba-xy'], ['secondary', 'secondary-color-srgb']].map(([resourceId, usage]) =>
      ({ spaceId: 'main', layerId: 'resources', resourceId,
        outputs: [{ usage, uri: `../media/${resourceId}.png`, mimeType: 'image/png' }] }))]
  const options = { materialPolicies: policies, resourceMappings: mappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }
  const before = jcsStringify(source)
  const result = prepareUvwGltfMigration(source, options)
  assert.equal(result.scope, 'preview') // No water renderer parity claim.
  assert.equal(assertUvwProfile(result.document), result.document)
  assert.equal(jcsStringify(source), before)
  const profile = result.document.materials[2].extensions.UV_game_material
  assert.equal(profile.shader, 'uv.water.surface@1')
  assert.deepEqual(profile.layers.map(layer => layer.slot), ['diffuse', 'layer1', 'normal', 'caustics'])
  assert.equal(profile.layers[2].channelPacking, 'rg-ba-xy')
  assert.deepEqual(profile.layers[3].frames.map(index =>
    result.document.images[result.document.textures[index].source].uri),
  ['../media/caustics-a.png', '../media/caustics-b.png'])
  assert.equal(profile.params.colorFalloff, 0.5)
  assert.equal(profile.params.causticsFalloff, 0.4)
  assert.deepEqual(profile.params.surfaceScroll, [0.1, 0.2, 0.3, 0.4])
  assert.deepEqual(result.materials[2].retained, [])
  const singleSurface = structuredClone(source)
  delete singleSurface.spaces[0].layers[4].materials[0].secondaryColorResourceId
  const repeated = prepareUvwGltfMigration(singleSurface, options).document.materials[2].extensions.UV_game_material.layers
  assert.equal(repeated[0].texture, repeated[1].texture)
  const broken = structuredClone(result.document)
  broken.materials[2].extensions.UV_game_material.layers[3].frames[1] = 999
  assert.throws(() => assertUvwProfile(broken), /material-reference/)
  const wrongOrder = structuredClone(source)
  wrongOrder.spaces[0].layers[4].materials[0].causticsFrameResourceIds.reverse()
  assert.throws(() => prepareUvwGltfMigration(wrongOrder, options), /material-water-policy/)
})

test('raw terrain weight rasters have explicit sampling, byte closure and zero-sum refusal', async () => {
  const source = materialSource(), layer = source.spaces[0].layers[0]
  delete layer.samples
  layer.weightRasters = [{ resourceId: 'weights', width: 2, height: 2,
    materialIds: ['grass', 'rock'], encoding: 'rgba8-unorm', normalization: 'sum' }]
  source.spaces[0].layers.splice(1, 0, { schemaVersion: 1, id: 'resources', kind: 'resources',
    resources: [{ id: 'weights', kind: 'media', uri: '../media/weights.rgba' }] })
  const sampling = { coordinates: 'material-grid-extent', filter: 'bilinear', wrap: 'clamp',
    normalization: 'sum', zeroSum: { mode: 'refuse' } }
  const options = { sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf',
    materialPolicies, resourceMappings: [{ spaceId: 'main', layerId: 'resources',
      resourceId: 'weights', outputs: [{ usage: 'weight-rgba8', uri: '../media/weights.rgba',
        encoding: 'rgba8-unorm' }] }],
    rasterPolicies: [{ spaceId: 'main', layerId: 'paint', sampling }] }
  const prepared = prepareUvwGltfMigration(source, options)
  assert.equal(prepared.scope, 'preview')
  assert.equal(assertUvwProfile(prepared.document), prepared.document)
  const bytes = Uint8Array.from([255, 0, 0, 0, 128, 127, 0, 0,
    0, 255, 0, 0, 64, 64, 0, 0])
  const mediaHash = await uvpMediaArtifactDigest(bytes)
  const manifest = { id: 'sample/weights', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path: options.targetPath,
        hash: await uvpJsonArtifactDigest('uvw', prepared.document) },
      { family: 'media', path: 'media/weights.rgba', hash: mediaHash },
    ] }
  const compose = async data => composeVerifiedReceipt(manifest.id, [
    { ...manifest, contents: [{ ...manifest.contents[0] },
      { ...manifest.contents[1], hash: await uvpMediaArtifactDigest(data) }] }],
  { intrinsics: [] }, [], async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document: prepared.document }
    : { digest: content.hash, bytes: data })
  const targetResult = await compose(bytes)
  assert.equal(targetResult.refusal, undefined)
  const sourceManifest = structuredClone(manifest)
  sourceManifest.id = 'sample/weights-source'
  sourceManifest.contents[0] = { family: 'uvw', path: options.sourcePath,
    hash: await uvpJsonArtifactDigest('uvw', source) }
  const sourceResult = await composeVerifiedReceipt(sourceManifest.id, [sourceManifest],
    { intrinsics: [] }, [], async ({ content }) => content.family === 'uvw'
      ? { digest: content.hash, document: source }
      : { digest: content.hash, bytes })
  assert.equal(sourceResult.refusal, undefined)
  const migration = await verifyUvwGltfMigration(sourceResult.receipt, targetResult.receipt,
    { ...options, sourcePackageId: sourceManifest.id, targetPackageId: manifest.id })
  assert.equal(migration.scope, 'preview')
  assert.equal(migration.rasters.length, 1)
  assert.equal(migration.losses[0].sourcePointer, '/spaces/0/layers/0')
  assert.equal(migration.resources[0].outputs[0].encoding, 'rgba8-unorm')
  const zero = bytes.slice(); zero.fill(0, 0, 4)
  assert.equal((await compose(zero)).refusal?.rule, 'world-raster-zero-sum')
  assert.equal((await compose(bytes.slice(0, 15))).refusal?.rule, 'world-raster-length')
  const fallback = structuredClone(prepared.document)
  fallback.extensions.UV_world_graph.spaces[0].layers[0].rasterSampling.zeroSum =
    { mode: 'material', materialId: 'grass' }
  assert.equal(assertUvwProfile(fallback), fallback)
  const mixed = structuredClone(source)
  mixed.spaces[0].layers[0].samples = [[{ weights: [{ materialId: 'grass', weight: 1 }] }]]
  assert.throws(() => prepareUvwGltfMigration(mixed, options),
    error => error.rule === 'uvw-gltf-raster-authoring')
})

test('sixteen terrain weight rasters retain all 64 channels in the existing glTF migration', () => {
  for (const count of [3, 4, 6, 16]) {
    const source = materialSource(), paint = source.spaces[0].layers[0]
    delete paint.samples
    paint.materials = Array.from({ length: count * 4 }, (_, index) => ({ id: `material-${String(index).padStart(2, '0')}` }))
    paint.weightRasters = Array.from({ length: count }, (_, index) => ({
      resourceId: `weights-${String(index).padStart(2, '0')}`, width: 2, height: 2,
      materialIds: paint.materials.slice(index * 4, index * 4 + 4).map(material => material.id),
      encoding: 'rgba8-unorm', normalization: 'sum',
    }))
    source.spaces[0].layers.splice(1, 0, { schemaVersion: 1, id: 'resources', kind: 'resources',
      resources: paint.weightRasters.map(raster => ({ id: raster.resourceId, kind: 'media',
        uri: `../media/${raster.resourceId}.rgba` })) })
    const options = { sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf',
      materialPolicies: [
        ...paint.materials.map(material => ({ ...materialPolicies[0], materialId: material.id })),
        materialPolicies[2],
      ],
      resourceMappings: paint.weightRasters.map(raster => ({ spaceId: 'main', layerId: 'resources',
        resourceId: raster.resourceId, outputs: [{ usage: 'weight-rgba8',
          uri: `../media/${raster.resourceId}.rgba`, encoding: 'rgba8-unorm' }] })),
      rasterPolicies: [{ spaceId: 'main', layerId: 'paint', sampling: {
        coordinates: 'material-grid-extent', filter: 'bilinear', wrap: 'clamp',
        normalization: 'sum', zeroSum: { mode: 'refuse' },
      } }],
    }
    const before = jcsStringify(source)
    const prepared = prepareUvwGltfMigration(source, options)
    assert.equal(assertUvwProfile(prepared.document), prepared.document)
    const migrated = prepared.document.extensions.UV_world_graph.spaces[0].layers[0]
    assert.deepEqual(migrated.weightRasters, paint.weightRasters)
    assert.equal(migrated.materials.length, count * 4)
    assert.equal(jcsStringify(source), before)
    const bad = structuredClone(prepared.document)
    const layer = bad.extensions.UV_world_graph.spaces[0].layers[0]
    layer.weightRasters.push({ ...layer.weightRasters[0], resourceId: 'overflow' })
    if (count === 16) assert.throws(() => assertUvwProfile(bad), /uvw-gltf-raster-grid/)
    layer.weightRasters.pop()
    layer.weightRasters[count - 1].materialIds[0] = layer.weightRasters[0].materialIds[0]
    assert.throws(() => assertUvwProfile(bad), /uvw-gltf-raster-grid/)
  }
})

test('mixed inline/raster source needs byte-proved preview equivalence before migration', async () => {
  const source = materialSource(), paint = source.spaces[0].layers[0]
  paint.samples = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () =>
    ({ weights: [{ materialId: 'grass', weight: 1 }] })))
  paint.weightRasters = [{ resourceId: 'weights', width: 4, height: 4,
    materialIds: ['grass', 'rock'], encoding: 'rgba8-unorm', normalization: 'sum' }]
  source.spaces[0].layers.splice(1, 0, { schemaVersion: 1, id: 'resources', kind: 'resources',
    resources: [{ id: 'weights', kind: 'media', uri: '../media/source.rgba' }] })
  const sampling = { coordinates: 'material-grid-extent', filter: 'bilinear', wrap: 'clamp',
    normalization: 'sum', zeroSum: { mode: 'refuse' } }
  const base = { sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf',
    materialPolicies, resourceMappings: [{ spaceId: 'main', layerId: 'resources',
      resourceId: 'weights', outputs: [{ usage: 'weight-rgba8', uri: '../media/converted.rgba',
        encoding: 'rgba8-unorm' }] }], rasterPolicies: [{ spaceId: 'main', layerId: 'paint', sampling }] }
  assert.throws(() => prepareUvwGltfMigration(source, base),
    error => error.rule === 'uvw-gltf-raster-authoring')
  const options = { ...base, rasterPolicies: [{ ...base.rasterPolicies[0],
    inlinePreview: { role: 'assert-equivalent-preview', maxAbsError: 0 } }] }
  const before = jcsStringify(source)
  const prepared = prepareUvwGltfMigration(source, options)
  assert.equal(jcsStringify(source), before)
  assert.equal(prepared.document.extensions.UV_world_graph.spaces[0].layers[0].samples, undefined)
  assert.equal(prepared.rasters[0].inlinePreview.sourcePointer, '/spaces/0/layers/0/samples')
  const bytes = Uint8Array.from({ length: 4 * 4 * 4 }, (_, index) => index % 4 === 0 ? 255 : 0)
  const sourceHash = await uvpMediaArtifactDigest(bytes)
  const packageOf = async (id, path, world, converted) => ({ id, version: '1.0.0', kind: 'map',
    dependencies: [], requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path, hash: await uvpJsonArtifactDigest('uvw', world) },
      { family: 'media', path: 'media/source.rgba', hash: sourceHash },
      ...(converted === undefined ? [] : [{ family: 'media', path: 'media/converted.rgba',
        hash: await uvpMediaArtifactDigest(converted) }]),
    ] })
  const compose = (manifest, world, converted) => composeVerifiedReceipt(manifest.id, [manifest],
    { intrinsics: [] }, [], async ({ content }) => content.family === 'uvw'
      ? { digest: content.hash, document: world }
      : { digest: content.hash, bytes: content.path === 'media/source.rgba' ? bytes : converted })
  const sourceManifest = await packageOf('sample/mixed-source', options.sourcePath, source)
  const targetManifest = await packageOf('sample/mixed-target', options.targetPath, prepared.document, bytes)
  const sourceResult = await compose(sourceManifest, source)
  const targetResult = await compose(targetManifest, prepared.document, bytes)
  assert.equal(sourceResult.refusal, undefined)
  assert.equal(targetResult.refusal, undefined)
  const addressed = { ...options, sourcePackageId: sourceManifest.id, targetPackageId: targetManifest.id }
  const receipt = await verifyUvwGltfMigration(sourceResult.receipt, targetResult.receipt, addressed)
  assert.equal(receipt.scope, 'preview')
  assert.equal(receipt.rasters[0].inlinePreview.role, 'assert-equivalent-preview')
  assert.equal(receipt.losses.some(row => row.sourcePointer === '/spaces/0/layers/0/samples'), true)
  const different = bytes.slice(); different[0] = 0; different[1] = 255
  const changedManifest = await packageOf(targetManifest.id, options.targetPath, prepared.document, different)
  const changed = await compose(changedManifest, prepared.document, different)
  assert.equal(changed.refusal, undefined)
  await assert.rejects(verifyUvwGltfMigration(sourceResult.receipt, changed.receipt, addressed),
    /Inline and raster differ/)
  const transformed = structuredClone(source)
  transformed.spaces[0].layers[0].samples[0][0].uvTransform =
    { offset: [0, 0], scale: [1, 1], rotation: 0 }
  assert.throws(() => prepareUvwGltfMigration(transformed, options),
    error => error.rule === 'uvw-gltf-raster-authoring')
})

test('composition closes every original, including unused media, and rejects a false image MIME', async () => {
  const source = cornerSource(), options = { materialPolicies, resourceMappings,
    sourcePath: 'worlds/source.uvw.json', targetPath: 'worlds/target.uvw.gltf' }
  const document = prepareUvwGltfMigration(source, options).document
  const bytes = new Uint8Array(await readFile(new URL('../world/fixtures/media/checker.png', import.meta.url)))
  const mediaHash = await uvpMediaArtifactDigest(bytes)
  const worldHash = await uvpJsonArtifactDigest('uvw', document)
  const modelHash = `sha256:${'a'.repeat(64)}`
  const manifest = { id: 'sample/world', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path: options.targetPath, hash: worldHash },
      { family: 'media', path: 'media/checker.png', hash: mediaHash },
      { family: 'media', path: 'media/unused.png', hash: mediaHash },
      { family: 'uvm', path: 'models/a.uvm.gltf', hash: modelHash },
    ] }
  const read = async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document }
    : content.family === 'media' ? { digest: content.hash, bytes } : content.hash
  const result = await composeVerifiedReceipt(manifest.id, [manifest], { intrinsics: [] }, [], read)
  assert.equal(result.refusal, undefined)
  const captured = (await verifiedCompositionDocuments(result.receipt)).documents[0].document
  const capturedLayer = captured.extensions.UV_world_graph.spaces[0].layers[0]
  assert.deepEqual(capturedLayer.samples[0][0], terrainCorners.sample)
  assert.deepEqual(capturedLayer.materials[0].atlas, terrainCorners.material.atlas)
  assert.throws(() => { capturedLayer.samples[0][0].cornerUv[0][0] = 9 }, TypeError)
  const missing = structuredClone(manifest)
  missing.contents = missing.contents.filter(row => row.path !== 'media/unused.png')
  assert.equal((await composeVerifiedReceipt(missing.id, [missing], { intrinsics: [] }, [], read)).refusal?.rule,
    'world-resource-unverified')
  const wrongFamily = structuredClone(manifest)
  wrongFamily.contents.find(row => row.path === 'models/a.uvm.gltf').family = 'media'
  wrongFamily.contents.find(row => row.path === 'models/a.uvm.gltf').hash = mediaHash
  assert.equal((await composeVerifiedReceipt(wrongFamily.id, [wrongFamily], { intrinsics: [] }, [], read)).refusal?.rule,
    'world-resource-unverified')
  const wrongMime = structuredClone(document)
  wrongMime.images[0].mimeType = 'image/jpeg'
  const bad = structuredClone(manifest)
  bad.contents[0].hash = await uvpJsonArtifactDigest('uvw', wrongMime)
  const readBad = async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document: wrongMime }
    : read({ content })
  assert.equal((await composeVerifiedReceipt(bad.id, [bad], { intrinsics: [] }, [], readBad)).refusal?.rule,
    'world-resource-mime')
})

test('migration receipt binds both verified compositions, source provenance and retained fields', async () => {
  const source = resourceSource()
  source.spaces[0].layers[4].materials[0].color = [0.2, 0.4, 0.6, 0.75]
  const policies = structuredClone(materialPolicies)
  policies[2].policy.waterColorSpace = 'srgb'
  const options = { sourcePackageId: 'sample/source', sourcePath: 'worlds/source.uvw.json',
    targetPackageId: 'sample/target', targetPath: 'worlds/target.uvw.gltf',
    materialPolicies: policies, resourceMappings }
  const document = prepareUvwGltfMigration(source, options).document
  const bytes = new Uint8Array(await readFile(new URL('../world/fixtures/media/checker.png', import.meta.url)))
  const mediaHash = await uvpMediaArtifactDigest(bytes), modelHash = `sha256:${'a'.repeat(64)}`
  const manifest = (id, path, hash) => ({ id, version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents: [
      { family: 'uvw', path, hash },
      { family: 'media', path: 'media/checker.png', hash: mediaHash },
      { family: 'media', path: 'media/unused.png', hash: mediaHash },
      { family: 'uvm', path: 'models/a.uvm.gltf', hash: modelHash },
    ] })
  const sourceManifest = manifest(options.sourcePackageId, options.sourcePath,
    await uvpJsonArtifactDigest('uvw', source))
  const targetManifest = manifest(options.targetPackageId, options.targetPath,
    await uvpJsonArtifactDigest('uvw', document))
  const read = world => async ({ content }) => content.family === 'uvw'
    ? { digest: content.hash, document: world }
    : content.family === 'media' ? { digest: content.hash, bytes } : content.hash
  const sourceResult = await composeVerifiedReceipt(sourceManifest.id, [sourceManifest],
    { intrinsics: [] }, [], read(source))
  const targetResult = await composeVerifiedReceipt(targetManifest.id, [targetManifest],
    { intrinsics: [] }, [], read(document))
  assert.equal(sourceResult.refusal, undefined)
  assert.equal(targetResult.refusal, undefined)
  const receipt = await verifyUvwGltfMigration(sourceResult.receipt, targetResult.receipt, options)
  assert.equal(receipt.profile, 'uv/uvw-gltf-migration@1')
  assert.equal(receipt.scope, 'manifest-verified')
  assert.deepEqual(receipt.losses, [])
  assert.equal(receipt.resources.length, 3)
  assert.equal(receipt.resources[0].original.hash, mediaHash)
  assert.equal(receipt.resources[1].original.hash, modelHash)
  assert.equal(receipt.materials[2].retained[0].sourcePointer, '/spaces/0/layers/4/materials/0/color')
  assert.deepEqual(receipt.materials[2].retained[0].value, [0.2, 0.4, 0.6, 0.75])
  await assert.rejects(verifyUvwGltfMigration(sourceResult.receipt, targetResult.receipt,
    { ...options, resourceMappings: resourceMappings.slice(1) }),
  error => error.rule === 'uvw-gltf-resource-mapping')
  const unverifiedSource = await composeVerifiedReceipt(sourceManifest.id, [sourceManifest],
    { intrinsics: [] }, [], async ({ content }) => content.family === 'media' ? content.hash
      : read(source)({ content }))
  assert.equal(unverifiedSource.refusal, undefined)
  await assert.rejects(verifyUvwGltfMigration(unverifiedSource.receipt, targetResult.receipt, options),
    /uvw-gltf-migration-original/)
})

test('declared specular and shared table indices are admitted; water fallback must be unambiguous', () => {
  const document = structuredClone(painted)
  document.extensionsUsed.push('KHR_materials_specular')
  document.materials[0].extensions = { KHR_materials_specular: { specularFactor: 0.8, specularColorFactor: [2, 1, 0.5] } }
  const layers = document.extensions.UV_world_graph.spaces[0].layers
  layers[0].materials[1].material = 0 // A shared standard material is not copied into either catalog.
  delete layers[3].materials
  layers[3].zones[0].materialId = 'grass'
  assert.equal(assertUvwProfile(document), document)
  const second = structuredClone(layers[0]); second.id = 'paint-two'; layers.splice(1, 0, second)
  assert.throws(() => assertUvwProfile(document), /ambiguous water material/)
})

test('verified composition captures glTF geometry once and qualifies each instance through the existing linker', async () => {
  const root = { id: 'sample/world', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] },
    contents: [{ family: 'uvw', path: 'world.uvw.gltf', hash: digest }],
    worldInstances: { schemaVersion: 1, instances: ['alpha', 'beta'].map(id =>
      ({ id, packageId: 'sample/world', path: 'world.uvw.gltf' })) } }
  const input = structuredClone(fixture)
  const result = await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [],
    async () => ({ digest, document: input }))
  assert.equal(result.refusal, undefined, JSON.stringify(result))
  const linked = await verifiedCompositionWorldSpaces(result.receipt)
  assert.deepEqual(linked.spaces.map(s => s.address), ['alpha/main', 'beta/main'])
  const captured = (await verifiedCompositionDocuments(result.receipt)).documents[0].document
  assert.equal(linked.spaces[0].space, captured.extensions.UV_world_graph.spaces[0])
  assert.equal(linked.spaces[0].space, linked.spaces[1].space)
  assert.throws(() => { linked.spaces[0].space.id = 'other' }, TypeError)
  input.extensions.UV_world_graph.spaces[0].id = 'caller-edit'
  assert.equal((await verifiedCompositionWorldSpaces(result.receipt)).spaces[0].space.id, 'main')
  const bad = await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [],
    async () => ({ digest, document: input }))
  assert.equal(bad.refusal?.rule, 'artifact-digest-mismatch')
})

test('the glTF envelope cannot bypass the existing qualified-space budget', async () => {
  const input = structuredClone(fixture), graph = input.extensions.UV_world_graph
  graph.spaces = Array.from({ length: 1025 }, (_, i) => ({ ...graph.spaces[0], id: `space-${String(i).padStart(4, '0')}` }))
  const hash = await uvpJsonArtifactDigest('uvw', input)
  const root = { id: 'sample/world', version: '1.0.0', kind: 'map', dependencies: [],
    requires: { intrinsics: [], capabilities: [] },
    contents: [{ family: 'uvw', path: 'world.uvw.gltf', hash }],
    worldInstances: { schemaVersion: 1, instances: Array.from({ length: 64 }, (_, i) =>
      ({ id: `world-${String(i).padStart(2, '0')}`, packageId: 'sample/world', path: 'world.uvw.gltf' })) } }
  const result = await composeVerifiedReceipt(root.id, [root], { intrinsics: [] }, [],
    async () => ({ digest: hash, document: input }))
  assert.equal(result.refusal?.rule, 'world-instance-budget')
})
