import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialWebGlDraws } from '../src/render/material-webgl.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const program = {
  fragmentSource: 'precision highp float; void main(){}',
  uniforms: {},
  textures: [],
  defines: { uvSetCount: 1 },
  blend: 'opaque',
  twoSided: false,
}
const material = { textures: new Map() }
const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0)
const geometry = {
  id: 'triangle',
  topology: 'triangles',
  positions,
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
}
const joints = Uint8Array.of(0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1)
const weights = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)
const skinned = palette => ({
  ...geometry,
  skin: { joints, weights, palette, deformed: () => geometry },
})
const draw = primitive => ({ draw: { primitive, program, material } })

// A WebGL2 stand-in recording every call, with named uniform locations and numbered attributes.
function recording() {
  const calls = []
  const constants = new Map()
  const attributes = new Map()
  const uniforms = new Map()
  const target = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    getExtension: () => null,
    getUniformLocation: (_, name) => {
      if (!uniforms.has(name)) uniforms.set(name, { name })
      return uniforms.get(name)
    },
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
  const named = name => calls.filter(call => call.name === name)
  return { gl, calls, attributes, constants, named }
}

it('draws a skin posed on the GPU with its own program, its vertex slots and the frame palettes', () => {
  const { gl, calls, attributes, constants, named } = recording()
  const draws = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const first = new Float32Array(2 * 16)
  const second = new Float32Array(3 * 16)
  first.set(identity, 0)
  second.set(identity, 32)
  // The frame's palettes upload at once; one drawn later is appended with its own upload.
  draws.prepareSkins([first, first])
  const prepared = calls.length
  draws.drawSequence([draw(skinned(first)), draw(skinned(second)), draw(geometry)], camera)
  const image = named('texImage2D')
  assert.equal(image.length, 1)
  assert.equal(image[0].args[2], constants.get('RGBA32F'))
  const uploads = named('texSubImage2D')
  assert.equal(uploads.length, 2)
  // The first palette's texels at 0, the second's after them (eight texels a two-matrix palette).
  const bases = named('uniform1i')
    .filter(call => call.args[0].name === 'u_skinBase')
    .map(call => call.args[1])
  assert.deepEqual(bases, [0, 8])
  assert.ok(calls.slice(0, prepared).some(call => call.name === 'texSubImage2D'))
  // The skinned draws link the skinning vertex stage, the plain draw the plain one.
  const vertexSources = named('shaderSource')
    .map(call => call.args[1])
    .filter(source => source.includes('gl_Position'))
  assert.equal(vertexSources.filter(source => source.includes('u_skinPalette')).length, 1)
  assert.equal(vertexSources.filter(source => !source.includes('u_skinPalette')).length, 1)
  // Slots arrive as unsigned bytes, weights as floats, from one buffer each.
  const pointers = named('vertexAttribPointer')
  const slots = pointers.filter(call => call.args[0] === attributes.get('a_skinJoints'))
  const blend = pointers.filter(call => call.args[0] === attributes.get('a_skinWeights'))
  assert.ok(
    slots.length > 0 && slots.every(call => call.args[2] === constants.get('UNSIGNED_BYTE')),
  )
  assert.ok(blend.length > 0 && blend.every(call => call.args[2] === constants.get('FLOAT')))
  const buffers = named('bufferData').map(call => call.args[1])
  assert.equal(buffers.filter(data => data === joints).length, 1)
  assert.equal(buffers.filter(data => data === weights).length, 1)
  // A new frame packs its own palettes from the start.
  draws.sweep()
  calls.length = 0
  draws.drawSequence([draw(skinned(second))], camera)
  assert.deepEqual(
    named('uniform1i')
      .filter(call => call.args[0].name === 'u_skinBase')
      .map(call => call.args[1]),
    [0],
  )
  draws.release()
})
