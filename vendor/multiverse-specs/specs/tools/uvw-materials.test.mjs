import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { projectUvwMaterial, uvwUvTransformToGltf } from './uvw-materials.mjs'
import { assertGltfMaterialReferences } from './gltf-materials.mjs'
import { assertUvmCore } from './uvm-core.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const policy = { metallicFactor: 0, roughnessFactor: 1, alphaMode: 'OPAQUE' }
const resources = {
  gltf: { textures: [{ source: 0, sampler: 0 }], images: [{ uri: 'grass.png' }], samplers: [{}] },
  bindings: [
    { resourceId: 'grass-image', usage: 'base-color-srgb', index: 0 },
    { resourceId: 'normal', usage: 'normal-linear-rgb', index: 0 },
    { resourceId: 'specular', usage: 'specular-strength-alpha', index: 0 },
    { resourceId: 'specular', usage: 'specular-color-srgb-rgb', index: 0 },
  ],
}
const read = name => readFile(new URL(name, import.meta.url), 'utf8').then(JSON.parse)

test('shared UVM material validation preserves boolean shadow flags and omitted defaults', async () => {
  const document = await read('../model/fixtures/uvm-core-textured.uvm.gltf')
  document.extensionsUsed.push('UV_game_material')
  document.materials[0].extensions = { UV_game_material: {
    shader: 'example.standard', castShadows: false, receiveShadows: false,
  } }
  const before = JSON.stringify(document)
  assert.equal(assertUvmCore(document), document)
  assert.equal(JSON.stringify(document), before)
  for (const name of ['castShadows', 'receiveShadows']) {
    const invalid = structuredClone(document)
    invalid.materials[0].extensions.UV_game_material[name] = 0
    assert.throws(() => assertUvmCore(invalid), /material-shadow-flags/)
    delete document.materials[0].extensions.UV_game_material[name]
  }
  assert.equal(assertUvmCore(document), document)
  assert.deepEqual(document.materials[0].extensions.UV_game_material, { shader: 'example.standard' })
})

test('explicit terrain projection preserves authored bytes, IDs and omitted defaults', async () => {
  const world = await read('../world/fixtures/uvw-profile-renderable-world.uvw.json')
  const before = await uvpJsonArtifactDigest('uvw', world)
  const source = world.spaces[0].layers.find(layer => layer.kind === 'terrain-materials').materials[0]
  const result = projectUvwMaterial('terrain', source, { ...policy, sourceUvPivot: 'center' }, resources)
  assert.equal(result.sourceId, 'grass')
  assert.equal(result.material.pbrMetallicRoughness.baseColorFactor, undefined)
  assert.deepEqual(result.extensionsUsed, ['KHR_texture_transform'])
  assert.deepEqual(result.material.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.offset, [-0.5, -0.5])
  assert.deepEqual(result.retained.uvTransform, source.uvTransform)
  assert.equal(await uvpJsonArtifactDigest('uvw', world), before)
  const factor = [0, 0.25, 1, 0]
  const colorOnly = projectUvwMaterial('terrain', { id: 'tint', baseColorFactor: factor }, policy)
  assert.deepEqual(colorOnly.material.pbrMetallicRoughness.baseColorFactor, factor)
  assert.equal(colorOnly.material.alphaMode, 'OPAQUE')
  assert.equal(colorOnly.material.pbrMetallicRoughness.baseColorTexture, undefined)
  colorOnly.material.pbrMetallicRoughness.baseColorFactor[0] = 1
  assert.equal(factor[0], 0)
})

test('projected terrain equals the material fixture checked by the shared schema', async () => {
  const expected = (await read('../model/fixtures/gltf-materials.profile.json')).pbr
  const source = { id: 'tint', label: 'Tinted terrain', baseColorFactor: [0, 0.25, 1, 0],
    baseColorResourceId: 'grass-image', uvTransform: { offset: [0, 0], scale: [2, 2], rotation: 0 } }
  const result = projectUvwMaterial('terrain', source,
    { ...policy, sourceUvPivot: 'center', alphaMode: 'MASK', alphaCutoff: 0.4, doubleSided: true },
    { ...resources, bindings: [{ ...resources.bindings[0], texCoord: 1 }] })
  assert.deepEqual(result.material, expected)
})

test('terrain image encoding metadata never silently becomes a different glTF channel convention', () => {
  for (const normalEncoding of ['rgb-inverted-y', 'xy-in-alpha-green']) {
    const source = { id: 'ground', normalResourceId: 'normal', normalEncoding }
    const before = JSON.stringify(source)
    assert.throws(() => projectUvwMaterial('terrain', source, policy, resources), /material-terrain-encoding/)
    assert.equal(JSON.stringify(source), before)
  }
  assert.throws(() => projectUvwMaterial('terrain', {
    id: 'ground', specularResourceId: 'specular', specularEncoding: 'gloss',
  }, { ...policy, specularEncoding: 'strength-alpha' }, resources), /material-terrain-encoding/)
  const rgb = projectUvwMaterial('terrain', {
    id: 'ground', normalResourceId: 'normal', normalEncoding: 'rgb',
  }, policy, resources)
  assert.equal(rgb.material.normalTexture.index, 0)
  assert.equal(rgb.retained.normalEncoding, 'rgb')
  for (const field of ['normalEncoding', 'specularEncoding'])
    assert.throws(() => projectUvwMaterial('terrain', { id: 'ground', [field]: 'guess' }, policy), /material-terrain-encoding/)
})

test('UV pivot conversion preserves corners, centres, reflections and nonuniform scale', () => {
  const apply = (uv, t, c) => {
    const x = (uv[0] - c) * t.scale[0], y = (uv[1] - c) * t.scale[1]
    return [c + Math.cos(t.rotation) * x - Math.sin(t.rotation) * y + t.offset[0],
      c + Math.sin(t.rotation) * x + Math.cos(t.rotation) * y + t.offset[1]]
  }
  for (const pivot of ['center', 'origin']) for (const rotation of [0, Math.PI / 2, -Math.PI / 3, 0.31])
    for (const scale of [[1, 1], [2, 3], [-2, 0.3], [-1, -1]]) {
      const original = { offset: [0.1, -0.2], scale, rotation }
      const converted = uvwUvTransformToGltf(original, pivot)
      for (const uv of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [-3.2, 4.7]]) {
        const expected = apply(uv, original, pivot === 'center' ? 0.5 : 0)
        const actual = apply(uv, converted, 0)
        actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12))
      }
    }
  assert.throws(() => uvwUvTransformToGltf({ offset: [0, 0], scale: [1, 1], rotation: 0 }), /material-uv-policy/)
  assert.throws(() => uvwUvTransformToGltf({ offset: [0, 0], scale: [0, 1], rotation: 0 }, 'center'), /material-uv-policy/)
  assert.throws(() => uvwUvTransformToGltf({ offset: [Number.MAX_VALUE, 0], scale: [-Number.MAX_VALUE, 1], rotation: 0 }, 'center'), /material-uv-overflow/)
})

test('specular channel meaning is explicit and normal textures need a canonical binding', () => {
  const source = { id: 'rock', normalResourceId: 'normal', specularResourceId: 'specular' }
  assert.throws(() => projectUvwMaterial('terrain', source, policy, resources), /material-specular-policy/)
  for (const encoding of ['strength-alpha', 'color-srgb-rgb']) {
    const output = projectUvwMaterial('terrain', source, { ...policy, specularEncoding: encoding }, resources)
    assert.deepEqual(output.material.normalTexture, { index: 0 })
    const extension = output.material.extensions.KHR_materials_specular
    const key = encoding === 'strength-alpha' ? 'specularTexture' : 'specularColorTexture'
    assert.deepEqual(extension, { [key]: { index: 0 } })
    assert.deepEqual(output.extensionsUsed, ['KHR_materials_specular'])
  }
  const swizzled = { ...resources, bindings: [{ resourceId: 'normal', usage: 'normal-alpha-green', index: 0 }] }
  assert.throws(() => projectUvwMaterial('terrain', { id: 'rock', normalResourceId: 'normal' }, policy, swizzled), /material-texture-binding/)
})

test('water color transfer is explicit; unsupported water mechanics require opt-in preview and remain available', async () => {
  const source = { id: 'lake', color: [0.5, 0.04045, 1, 0.2] }
  assert.throws(() => projectUvwMaterial('water', source, policy), /material-color-policy/)
  const converted = projectUvwMaterial('water', source, { ...policy, waterColorSpace: 'srgb', alphaMode: 'BLEND' })
  const color = converted.material.pbrMetallicRoughness.baseColorFactor
  assert.ok(Math.abs(color[0] - 0.21404114048223255) < 1e-15)
  assert.equal(color[1], 0.04045 / 12.92); assert.equal(color[2], 1); assert.equal(color[3], 0.2)
  assert.deepEqual(converted.retained.color, source.color)
  const world = await read('../world/fixtures/uvw-profile-renderable-world.uvw.json')
  const water = world.spaces[0].layers.find(layer => layer.kind === 'water').materials[0]
  const waterPolicy = { ...policy, waterColorSpace: 'linear', alphaMode: 'BLEND' }
  const waterResources = { ...resources, bindings: [{ resourceId: water.baseColorResourceId, usage: 'base-color-srgb', index: 0 }] }
  assert.throws(() => projectUvwMaterial('water', water, waterPolicy, waterResources), /material-water-semantics/)
  const preview = projectUvwMaterial('water', water, { ...waterPolicy, allowPartial: true }, waterResources)
  assert.equal(preview.fidelity, 'preview')
  for (const { field } of preview.diagnostics) assert.deepEqual(preview.retained[field], water[field])
  assert.equal(preview.retained.specularity, water.specularity)
  assert.deepEqual(preview.retained.scroll, water.scroll)
  assert.notEqual(preview.retained.scroll, water.scroll)
})

test('material references are checked by the same owner in the UVM reader and UVW projection', async () => {
  const model = await read('../model/fixtures/uvm-core-textured.uvm.gltf')
  assertUvmCore(model)
  for (const change of [d => { d.materials[0].pbrMetallicRoughness.baseColorTexture.index = 99 },
    d => { d.textures[0].source = 99 }, d => { d.textures[0].sampler = 99 }]) {
    const invalid = structuredClone(model); change(invalid)
    assert.throws(() => assertUvmCore(invalid), /material-reference/)
  }
  const source = { id: 'grass', baseColorResourceId: 'grass-image' }
  assert.throws(() => projectUvwMaterial('terrain', source, policy, { ...resources, gltf: { textures: [] } }), /material-reference/)
  assert.throws(() => projectUvwMaterial('terrain', source, policy, { ...resources, bindings: [...resources.bindings, resources.bindings[0]] }), /material-texture-binding/)
  const known = { materials: [{ extensions: { KHR_materials_specular: {} } }] }
  assert.throws(() => assertGltfMaterialReferences(known), /material-extension-undeclared/)
  known.extensionsUsed = ['KHR_materials_specular', 'KHR_materials_unlit']
  known.materials[0].extensions.KHR_materials_unlit = {}
  assert.throws(() => assertGltfMaterialReferences(known), /material-extension-conflict/)
})

test('migration refuses ambiguous policy and mixed material dialects without changing input', () => {
  const source = { id: 'grass', baseColorFactor: [1, 1, 1, 1] }
  assert.throws(() => projectUvwMaterial('terrain', source, {}), /material-pbr-policy/)
  assert.throws(() => projectUvwMaterial('terrain', { ...source, pbrMetallicRoughness: {} }, policy), /material-source-field/)
  assert.throws(() => projectUvwMaterial('terrain', { ...source, baseColorFactor: [1, 2, 1, 1] }, policy), /material-color/)
  assert.deepEqual(source, { id: 'grass', baseColorFactor: [1, 1, 1, 1] })
})

test('image-source extensions retain declarations and validate both source and fallback', async () => {
  const model = await read('../model/fixtures/uvm-core-textured.uvm.gltf')
  for (const name of ['KHR_texture_basisu', 'EXT_texture_webp']) {
    const document = structuredClone(model)
    document.extensionsUsed = [...document.extensionsUsed, name]
    document.extensionsRequired = [...(document.extensionsRequired ?? []), name]
    const texture = document.textures[0]
    texture.extensions = { [name]: { source: 0 } }
    delete texture.source
    assertUvmCore(document)
    const output = projectUvwMaterial('terrain', { id: 'grass', baseColorResourceId: 'grass-image' }, policy,
      { ...resources, gltf: document })
    assert.ok(output.extensionsUsed.includes(name))
    texture.source = 99
    assert.throws(() => assertUvmCore(document), /material-reference/)
    texture.source = 0
    texture.extensions[name].source = 99
    assert.throws(() => assertUvmCore(document), /material-reference/)
    texture.extensions[name].source = 0
    document.extensionsUsed = document.extensionsUsed.filter(value => value !== name)
    assert.throws(() => assertGltfMaterialReferences(document), /material-extension-undeclared/)
  }
})

test('every admitted texture slot checks references and declares its UV extension', () => {
  const slots = [
    (m, info) => { m.pbrMetallicRoughness = { baseColorTexture: info } },
    (m, info) => { m.pbrMetallicRoughness = { metallicRoughnessTexture: info } },
    (m, info) => { m.normalTexture = info },
    (m, info) => { m.occlusionTexture = info },
    (m, info) => { m.emissiveTexture = info },
    (m, info) => { m.extensions = { KHR_materials_specular: { specularTexture: info } } },
    (m, info) => { m.extensions = { KHR_materials_specular: { specularColorTexture: info } } },
  ]
  for (const assign of slots) {
    const material = {}, info = { index: 0, extensions: { KHR_texture_transform: { texCoord: 1 } } }
    assign(material, info)
    const document = { ...resources.gltf, materials: [material],
      extensionsUsed: ['KHR_texture_transform', 'KHR_materials_specular'] }
    assertGltfMaterialReferences(document)
    info.index = 99
    assert.throws(() => assertGltfMaterialReferences(document), /material-reference/)
    info.index = 0
    info.extensions.KHR_texture_transform.texCoord = -1
    assert.throws(() => assertGltfMaterialReferences(document), /material-reference/)
    info.extensions.KHR_texture_transform.texCoord = 1
    document.extensionsUsed = ['KHR_materials_specular']
    assert.throws(() => assertGltfMaterialReferences(document), /material-extension-undeclared/)
  }
})
