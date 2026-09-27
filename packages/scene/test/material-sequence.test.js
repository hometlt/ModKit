import assert from 'node:assert/strict'
import { it } from 'node:test'

import { materialWebGlDraws } from '../src/render/material-webgl.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const source = {
  fragmentSource: 'precision highp float; uniform sampler2D u_diffuseMap; void main(){}',
  uniforms: { u_specularity: 0.5 },
  textures: [
    { resourceId: 'albedo', uniform: 'u_diffuseMap', slot: 'diffuse', wrapU: 'wrap', wrapV: 'wrap' },
  ],
  defines: { uvSetCount: 1 },
  blend: 'opaque',
  twoSided: false,
}
const material = { textures: new Map([['albedo', { id: 'albedo.png' }]]) }
const mesh = id => ({
  id,
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
})
const placements = count => {
  const matrices = new Float32Array(count * 16)
  for (let index = 0; index < count; index++) matrices.set(identity, index * 16)
  return { matrices, count }
}

// Counts every call by name and keeps the last value uploaded to each uniform.
function context() {
  const calls = new Map()
  const uniforms = new Map()
  const boundTextures = []
  const names = ['a_position', 'a_normal', 'a_tangent', 'a_color', 'a_uv0']
  for (let column = 0; column < 4; column++) names.push(`a_instanceMatrix${column}`)
  const gl = {
    TRIANGLES: 4,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    FLOAT: 5126,
    UNSIGNED_INT: 5125,
    STATIC_DRAW: 35044,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    NO_ERROR: 0,
    TEXTURE0: 33984,
    TEXTURE_2D: 3553,
    CULL_FACE: 2884,
    createShader: () => ({}),
    createProgram: () => ({}),
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    createSampler: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    getUniformLocation: (_, name) => name,
    getAttribLocation: (_, name) => names.indexOf(name),
  }
  const proxy = new Proxy(gl, {
    get(target, name) {
      const value = target[name]
      if (value !== undefined && typeof value !== 'function') return value
      return (...args) => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        if (String(name).startsWith('uniform') && args[0] !== null) uniforms.set(args[0], args.at(-1))
        if (name === 'bindTexture') boundTextures.push(args[1])
        return value?.(...args)
      }
    },
  })
  const count = name => calls.get(name) ?? 0
  return { gl: proxy, calls, uniforms, count, boundTextures }
}

it('draws a sequence changing only what differs from the previous draw, and restores once', () => {
  const { gl, count, uniforms } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  const draws = [
    { draw: { primitive: mesh('a'), program: source, material }, instances: placements(3) },
    { draw: { primitive: mesh('b'), program: source, material }, instances: placements(2) },
    { draw: { primitive: mesh('c'), program: source, material } },
  ]
  assert.equal(renderer.drawSequence(draws, camera), 6)
  assert.equal(renderer.drawCalls(), 3)
  // One program, one lease, one texture: bound, uploaded and set once for the whole sequence.
  assert.equal(count('useProgram'), 1)
  assert.equal(count('bindTexture'), 1)
  assert.equal(count('createSampler'), 1)
  assert.equal(count('uniformMatrix4fv'), 3) // view, view-projection, world-to-material
  assert.equal(count('uniform4fv'), 1) // the shared tint
  assert.equal(count('colorMask'), 2) // the draws' colour mask, and the restore
  assert.equal(count('bindVertexArray'), 4) // three geometries, and the restore
  assert.equal(uniforms.get('u_specularity'), 0.5)
  // Restored once: the sampler unit, the vertex array, the colour mask and culling.
  assert.equal(count('bindSampler'), 2)
  assert.equal(count('disable'), 3) // culling restore, polygon offset and blending of the draws

  // Same camera values in a later sequence: the program keeps its frame and material uniforms.
  renderer.drawSequence(draws.slice(0, 1), { ...camera })
  assert.equal(count('uniformMatrix4fv'), 3)
  assert.equal(count('useProgram'), 2)
  // A moved camera uploads the frame again; the material and tint stay.
  const moved = Float32Array.from(identity)
  moved[12] = 5
  renderer.drawSequence(draws.slice(0, 1), { viewProjection: moved, viewMatrix: moved })
  assert.equal(count('uniformMatrix4fv'), 5)
  assert.equal(uniforms.get('u_viewProjection'), moved)
  assert.equal(count('uniform4fv'), 1)
})

it('shares one sampler object between leases with equal sampling and deletes it on release', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  // A per-frame material lease (new program object, same shader) samples like the previous one.
  renderer.draw({ primitive: mesh('a'), program: { ...source }, material }, camera)
  renderer.sweep()
  renderer.draw({ primitive: mesh('a'), program: { ...source }, material }, camera)
  renderer.sweep()
  assert.equal(count('createSampler'), 1)
  assert.equal(count('deleteSampler'), 0)
  renderer.release()
  assert.equal(count('deleteSampler'), 1)
})

it('takes each lease texture by its texture object, so equal ids of different sizes stay apart', () => {
  const { gl, boundTextures } = context()
  // One texture path, reduced differently for two models.
  const large = { id: 'albedo.png', width: 256, height: 256 }
  const small = { id: 'albedo.png', width: 128, height: 128 }
  const handles = new Map([
    [large, { name: 'large' }],
    [small, { name: 'small' }],
  ])
  const renderer = materialWebGlDraws(gl, texture => handles.get(texture), { checkEachDraw: false })
  for (const [id, texture] of [
    ['a', large],
    ['b', small],
  ])
    renderer.draw(
      { primitive: mesh(id), program: { ...source }, material: { textures: new Map([['albedo', texture]]) } },
      camera,
    )
  assert.deepEqual(
    boundTextures.map(texture => texture.name),
    ['large', 'small'],
  )
})
