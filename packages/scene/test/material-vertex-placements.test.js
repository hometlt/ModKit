import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialWebGlDraws } from '../src/render/material-webgl.js'
import { mergeMaterialDraws, primitiveVertexPlacements } from '../src/render/vertex-placements.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const program = {
  fragmentSource:
    'precision highp float; out vec4 materialColor; void main(){materialColor=vec4(1.0);}',
  uniforms: {},
  textures: [],
  defines: { uvSetCount: 2 },
  blend: 'additive',
  twoSided: true,
}
const material = { textures: new Map() }
const moved = (x, y, z) => Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1)
// A sprite as an effect emitter's prepared draw holds it: one triangle, every attribute its own
// array, its mask UVs its UV0.
function sprite(x, tint) {
  const textureCoordinates = Float32Array.of(0, 0, 1, 0, 0, 1)
  return {
    id: `sprite-${x}`,
    materialId: 'effect',
    topology: 'triangles',
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
    tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
    colors: Float32Array.of(...tint, ...tint, ...tint),
    textureCoordinates,
    textureCoordinateSets: [1, 2].map(set => ({ set, coordinates: textureCoordinates })),
    vertexTints: Float32Array.of(...tint, ...tint, ...tint),
    transform: moved(x, 0, 0),
  }
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

it('joins draws of one program into one primitive whose vertices keep their draw placements', () => {
  const first = sprite(2, [1, 0.5, 0, 1])
  const second = sprite(-3, [0, 1, 0, 0.5])
  const draws = [first, second].map(primitive => ({ primitive, program, material }))
  const merged = mergeMaterialDraws(draws)
  const primitive = merged.primitive
  assert.equal(merged.program, program)
  assert.equal(merged.material, material)
  assert.equal(primitive.transform, undefined)
  assert.equal(primitive.indices, undefined)
  // Vertices one draw after the other, as each draw held them.
  assert.deepEqual([...primitive.positions], [...first.positions, ...second.positions])
  assert.deepEqual([...primitive.tangents], [...first.tangents, ...second.tangents])
  assert.deepEqual([...primitive.vertexTints], [...first.vertexTints, ...second.vertexTints])
  // Mask UVs that were each draw's UV0 stay the joined UV0.
  assert.deepEqual(
    primitive.textureCoordinateSets.map(set => set.set),
    [1, 2],
  )
  for (const set of primitive.textureCoordinateSets)
    assert.equal(set.coordinates, primitive.textureCoordinates)
  // Each vertex carries its draw's model matrix.
  const placements = primitiveVertexPlacements(primitive)
  assert.equal(placements.length, 6 * 16)
  for (let vertex = 0; vertex < 6; vertex++)
    assert.deepEqual(
      [...placements.subarray(vertex * 16, vertex * 16 + 16)],
      [...(vertex < 3 ? first : second).transform],
    )
  // Indexed draws join their indices after each other's vertices.
  const indexed = mergeMaterialDraws(
    draws.map(draw => ({
      ...draw,
      primitive: { ...draw.primitive, indices: Uint32Array.of(2, 1, 0) },
    })),
  )
  assert.deepEqual([...indexed.primitive.indices], [2, 1, 0, 5, 4, 3])
  // One draw stays itself.
  assert.equal(mergeMaterialDraws([draws[0]]), draws[0])
})

it('leaves draws apart whose vertices do not lay out alike', () => {
  const draw = primitive => ({ primitive, program, material })
  const plain = sprite(0, [1, 1, 1, 1])
  const { normals: _normals, ...unlit } = sprite(1, [1, 1, 1, 1])
  assert.equal(mergeMaterialDraws([draw(plain), draw(unlit)]), undefined)
  assert.equal(
    mergeMaterialDraws([draw(plain), draw({ ...plain, indices: Uint32Array.of(0, 1, 2) })]),
    undefined,
  )
  assert.equal(
    mergeMaterialDraws([draw(plain), draw({ ...plain, topology: 'triangle-strip' })]),
    undefined,
  )
  assert.equal(
    mergeMaterialDraws([
      draw(plain),
      draw({
        ...plain,
        textureCoordinateSets: [{ set: 1, coordinates: plain.textureCoordinates }],
      }),
    ]),
    undefined,
  )
  assert.equal(
    mergeMaterialDraws([draw(plain), draw({ ...plain, colors: Float32Array.of(1, 1, 1) })]),
    undefined,
  )
})

it('reads the placements of a joined draw per vertex, where one draw sets its matrix once', () => {
  const first = sprite(2, [1, 0.5, 0, 1])
  const second = sprite(-3, [0, 1, 0, 0.5])
  const merged = mergeMaterialDraws(
    [first, second].map(primitive => ({ primitive, program, material })),
  )
  const { gl, calls, attributes } = recording()
  const draws = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  draws.drawSequence([{ draw: merged }], camera)
  const columns = [0, 1, 2, 3].map(column => attributes.get(`a_instanceMatrix${column}`))
  const placements = primitiveVertexPlacements(merged.primitive)
  assert.ok(calls.some(call => call.name === 'bufferData' && call.args[1] === placements))
  for (const location of columns) {
    // A matrix column every 64 bytes, advanced per vertex: no divisor of 1, no constant value.
    assert.ok(
      calls.some(
        call =>
          call.name === 'vertexAttribPointer' &&
          call.args[0] === location &&
          call.args[4] === 64 &&
          call.args[5] === columns.indexOf(location) * 16,
      ),
    )
    assert.ok(
      calls.some(
        call =>
          call.name === 'vertexAttribDivisor' && call.args[0] === location && call.args[1] === 0,
      ),
    )
    assert.ok(!calls.some(call => call.name === 'vertexAttrib4fv' && call.args[0] === location))
  }
  const submitted = calls.filter(call => call.name === 'drawArrays')
  assert.deepEqual(
    submitted.map(call => call.args.slice(1)),
    [[0, 6]],
  )
  // Alone, a draw sets its model matrix as the columns' constant values.
  calls.length = 0
  draws.drawSequence([{ draw: { primitive: first, program, material } }], camera)
  for (const location of columns)
    assert.ok(calls.some(call => call.name === 'vertexAttrib4fv' && call.args[0] === location))
  // Placed vertices draw once: never instanced, never with object-space normals.
  assert.throws(
    () =>
      draws.drawSequence([{ draw: merged, instances: { matrices: identity, count: 1 } }], camera),
    /placed vertices draw once/,
  )
  assert.throws(
    () =>
      draws.drawSequence(
        [{ draw: { ...merged, program: { ...program, normalMapSpace: 'object' } } }],
        camera,
      ),
    /placed vertices draw once/,
  )
  draws.release()
})
