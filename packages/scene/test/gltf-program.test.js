import assert from 'node:assert/strict'
import { it } from 'node:test'
import { TEAM_RAMP_MAX } from '@modkit/codec-kit/model-math/color-remap'
import { createGltfMaterialPrograms } from '../src/materials/gltf-program.js'

const texture = (id, extra = {}) => ({
  id,
  width: 1,
  height: 1,
  rgba: Uint8Array.of(255, 255, 255, 255),
  ...extra,
})
const textures = new Map(['base', 'mr', 'mask', 'normal'].map(id => [id, texture(id)]))
const pbr = (extra = {}) => ({
  id: 'm',
  baseColor: [1, 1, 1, 1],
  shading: 'pbr',
  pbr: { metallic: 0, roughness: 1 },
  ...extra,
})
// a pixel lit head-on by a white key light, without ambient
const headOn = {
  normal: [0, 0, 1],
  lightDirection: [0, 0, 1],
  viewDirection: [0, 0, 1],
  sceneLighting: { lightColor: [1, 1, 1], ambientColor: [0, 0, 0] },
}

it('leaves what a glTF program does not carry to the fallback', () => {
  for (const material of [
    pbr({ shading: 'lambert' }),
    pbr({ shader: { id: 'custom', parameters: {} } }),
    pbr({ simpleEffect: { kind: 'additive' } }),
    pbr({ context: { teamColor: [1, 0, 0] } }),
    pbr({ pbr: { metallic: 0, roughness: 1, normalTexture: 'normal' } }),
    pbr({ pbr: { metallic: 0, roughness: 1, occlusionTexture: 'normal' } }),
    pbr({ pbr: { metallic: 0, roughness: 1, emissiveTexture: 'normal' } }),
    pbr({ alphaMode: 'mask', alphaCutoff: 1.5 }),
    // a depth write against the coverage is the base route's alone
    pbr({ alphaMode: 'blend', depthWrite: true }),
    pbr({ depthWrite: false }),
  ])
    assert.equal(createGltfMaterialPrograms(material, textures), undefined)
  for (const material of [
    pbr({ alphaMode: 'blend', depthWrite: false }),
    pbr({ alphaMode: 'mask', alphaCutoff: 1 }),
    pbr({ depthWrite: true }),
  ])
    assert.notEqual(createGltfMaterialPrograms(material, textures), undefined)
})

it('shares the shader sources of a layout and binds each texture to its uniform', () => {
  const plain = createGltfMaterialPrograms(pbr(), textures).sample(undefined)
  const other = createGltfMaterialPrograms(
    pbr({ id: 'n', baseColor: [0.2, 0.3, 0.4, 1], priority: 2, doubleSided: true }),
    textures,
  ).sample(undefined)
  assert.equal(plain.key, 'gltf;;team=0;opaque')
  assert.equal(other.key, plain.key)
  assert.equal(other.vertexSource, plain.vertexSource)
  assert.equal(other.fragmentSource, plain.fragmentSource)
  assert.deepEqual(other.uniforms.u_baseColorFactor, [0.2, 0.3, 0.4, 1])
  assert.deepEqual([plain.blend, plain.twoSided, plain.priority], ['opaque', false, 0])
  assert.deepEqual([other.twoSided, other.priority], [true, 2])
  assert.doesNotMatch(plain.fragmentSource, /u_teamColor|discard|u_baseColorMap/)
  assert.equal(plain.defines.sceneLighting, true)
  assert.equal(plain.defines.pbr, true)

  const programs = createGltfMaterialPrograms(
    pbr({
      baseColorTexture: 'base',
      pbr: { metallic: 1.5, roughness: 0.5, metallicRoughnessTexture: 'mr' },
      teamColor: { mask: { texture: 'mask', channel: 'a' }, blend: 'multiply' },
      alphaMode: 'mask',
      alphaCutoff: 0.3,
    }),
    textures,
  )
  assert.deepEqual([...programs.textures.keys()], ['base', 'mr', 'mask'])
  const full = programs.sample({ teamColor: [0, 0, 1] })
  assert.equal(full.key, 'gltf;tm;team=2;mask')
  assert.deepEqual([full.blend, full.defines.alphaTest], ['alpha-test', true])
  assert.equal(full.uniforms.u_alphaCutoff, 0.3)
  // factors are clamped to their unit range, as the base route reads them
  assert.deepEqual([full.uniforms.u_metallicFactor, full.uniforms.u_roughnessFactor], [1, 0.5])
  assert.match(full.fragmentSource, /discard/)
  assert.deepEqual(
    full.textures.map(binding => [binding.slot, binding.uniform, binding.resourceId]),
    [
      ['diffuse', 'u_baseColorMap', 'base'],
      ['metalness', 'u_metallicRoughnessMap', 'mr'],
      ['teamColorMask', 'u_teamMaskMap', 'mask'],
    ],
  )
  assert.deepEqual(
    [full.uniforms.u_teamMaskChannel, full.uniforms.u_teamMaskMode],
    [3, 0],
  )
  // the CPU twin discards below the cutoff
  assert.equal(full.shade({ ...headOn, vertexColor: [1, 1, 1, 0.2] }).alphaTestPassed, false)
  assert.equal(full.shade({ ...headOn, vertexColor: [1, 1, 1, 0.4] }).alphaTestPassed, true)
})

it('draws without a texture the scene lacks, as the base route does', () => {
  const scene = new Map([['base', texture('base', { dimension: 'cube' })]])
  const programs = createGltfMaterialPrograms(
    pbr({
      baseColorTexture: 'base',
      teamColor: { mask: { texture: 'absent', channel: 'r' }, blend: 'lerp' },
    }),
    scene,
  )
  assert.equal(programs.textures.size, 0)
  const program = programs.sample({ teamColor: [1, 0, 0] })
  assert.equal(program.key, 'gltf;;team=0;opaque')
  assert.deepEqual(program.textures, [])
  assert.equal(program.uniforms.u_teamColor, undefined)
})

it("sets each moment's team colour: the player's, none at zero intensity", () => {
  const programs = createGltfMaterialPrograms(
    pbr({ teamColor: { mask: 'whole', blend: 'multiply' } }),
    textures,
  )
  const red = programs.sample({ teamColor: [1, 0, 0] })
  const none = programs.sample({ teamColor: [1, 0, 0], teamColorIntensity: 0 })
  assert.equal(red.key, 'gltf;;team=1;opaque')
  assert.equal(none.fragmentSource, red.fragmentSource)
  assert.deepEqual(red.uniforms.u_teamColor, [1, 0, 0])
  assert.deepEqual([red.uniforms.u_teamBlend, red.uniforms.u_teamStrength], [0, 1])
  assert.equal(none.uniforms.u_teamStrength, 0)
  assert.equal(red.uniforms.u_teamRamp.length, TEAM_RAMP_MAX * 3)
  // white times red: its red as the white's, its green and blue only the dielectric's untinted
  // specular; with no team colour the white stays white
  const lit = red.shade(headOn).rgba
  const white = none.shade(headOn).rgba
  assert.deepEqual([white[1], white[2]], [white[0], white[0]])
  assert.equal(lit[0], white[0])
  assert.equal(lit[2], lit[1])
  assert.ok(lit[1] > 0 && lit[1] < lit[0] / 2)
  assert.equal(lit[3], 1)
})
