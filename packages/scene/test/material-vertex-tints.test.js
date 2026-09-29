import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialWebGlDraws } from '../src/render/material-webgl.js'
import { prepareMaterialGeometry } from '../src/render/material-geometry.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const program = {
  fragmentSource:
    'precision highp float; out vec4 materialColor; void main(){materialColor=vec4(1.0);}',
  uniforms: {},
  textures: [],
  defines: { uvSetCount: 1 },
  blend: 'blend',
  twoSided: true,
}
const material = { textures: new Map() }
// Two sprites of their own tints in one primitive, as an effect emitter draws them.
const tints = Float32Array.of(
  ...[1, 0.5, 0.25, 0.75],
  ...[1, 0.5, 0.25, 0.75],
  ...[1, 0.5, 0.25, 0.75],
  ...[1, 0.5, 0.25, 0.75],
  ...[0, 1, 0, 0.5],
  ...[0, 1, 0, 0.5],
  ...[0, 1, 0, 0.5],
  ...[0, 1, 0, 0.5],
)
const sprites = {
  id: 'sprites',
  topology: 'triangles',
  positions: Float32Array.of(
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    2,
    0,
    0,
    3,
    0,
    0,
    3,
    1,
    0,
    2,
    1,
    0,
  ),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1),
  colors: tints,
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
  vertexTints: tints,
}

function recording() {
  const calls = []
  const constants = new Map()
  const attributes = new Map()
  const target = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    getUniformLocation: (_, name) => ({ name }),
    getAttribLocation: (_, name) => {
      if (!attributes.has(name)) attributes.set(name, attributes.size)
      return attributes.get(name)
    },
  }
  const gl = new Proxy(target, {
    get(object, name) {
      if (typeof name !== 'string') return undefined
      if (/^[A-Z0-9_]+$/u.test(name)) {
        if (!constants.has(name)) constants.set(name, 0x9000 + constants.size)
        return constants.get(name)
      }
      const value = object[name]
      return (...args) => {
        const result =
          value !== undefined ? value(...args) : name.startsWith('create') ? {} : undefined
        calls.push({ name, args })
        return result
      }
    },
  })
  return { gl, calls, attributes }
}

it('draws per-vertex tints flat into the colour, where a single draw takes its tint', () => {
  // Expansion keeps each corner's tint with its corner.
  const expanded = prepareMaterialGeometry(sprites, 1e6)
  assert.equal(expanded.vertexTints.length, 12 * 4)
  const at = corner => [...expanded.vertexTints.subarray(corner * 4, corner * 4 + 4)]
  for (let corner = 0; corner < 6; corner++) assert.deepEqual(at(corner), [...tints.subarray(0, 4)])
  for (let corner = 6; corner < 12; corner++)
    assert.deepEqual(at(corner), [...tints.subarray(16, 20)])
  assert.throws(
    () => prepareMaterialGeometry({ ...sprites, vertexTints: tints.subarray(4) }, 1e6),
    /invalid material vertex tints/,
  )
  const { gl, calls, attributes } = recording()
  const draws = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const plain = { ...sprites, vertexTints: undefined, tint: [1, 0.5, 0.25, 0.75] }
  delete plain.vertexTints
  draws.drawSequence(
    [
      { draw: { primitive: expanded, program, material } },
      { draw: { primitive: plain, program, material } },
    ],
    camera,
  )
  const sources = calls.filter(call => call.name === 'shaderSource').map(call => call.args[1])
  const tinted = sources.filter(source => source.includes('v_vertexTint'))
  // The tinted draw links a vertex stage handing the tint on flat, and a colour multiplied by it.
  assert.equal(tinted.length, 2)
  assert.ok(tinted.some(source => /flat out vec4 v_vertexTint/u.test(source)))
  assert.ok(tinted.some(source => /materialColor\*=u_instanceTint\*v_vertexTint;/u.test(source)))
  // The plain draw of the same material links the stages without it.
  assert.equal(sources.length, 4)
  const pointers = calls.filter(
    call => call.name === 'vertexAttribPointer' && call.args[0] === attributes.get('a_vertexTint'),
  )
  assert.equal(pointers.length, 1)
  const buffers = calls.filter(call => call.name === 'bufferData').map(call => call.args[1])
  assert.ok(buffers.includes(expanded.vertexTints))
  draws.release()
})
