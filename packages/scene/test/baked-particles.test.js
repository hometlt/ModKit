import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'

// UV_game_baked_particles (SPEC_UVM §13.4): the frame of the clip's track for the clock, each
// sprite a quad of its half size about its position, its atlas cell's UVs and its colour.
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const sprite = (position, axis = [0, 0, 1], cell = 2) => [
  ...position,
  0.5,
  0.5,
  0,
  1,
  0.5,
  0,
  1,
  cell,
  ...axis,
  0,
  0,
  1,
]
function documentOf(orientation, loop, sprites) {
  const frames = Uint32Array.of(0, 1, sprites.length / 17)
  const values = Float32Array.from(sprites)
  const binary = new Uint8Array(frames.byteLength + values.byteLength)
  binary.set(new Uint8Array(frames.buffer), 0)
  binary.set(new Uint8Array(values.buffer), frames.byteLength)
  const document = {
    asset: { version: '2.0' },
    nodes: [{}],
    materials: [{}],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: frames.byteLength },
      { buffer: 0, byteOffset: frames.byteLength, byteLength: values.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: frames.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: values.length, type: 'SCALAR' },
    ],
    extensions: {
      UV_game_baked_particles: {
        frameRate: 15,
        batches: [{ material: 0, orientation, atlas: [4, 4] }],
        tracks: [{ sequence: 3, batch: 0, loop, frames: 0, sprites: 1 }],
      },
    },
  }
  return { document, binary }
}
const options = binary => ({
  binary,
  materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
  activeNodes: new Set(['node-0']),
  nodeTransformsAt: () => new Map(),
  viewMatrix: identity,
  sequenceIndex: 3,
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
})

test('a baked frame draws its sprites facing the camera with their atlas cell and colour', () => {
  const { document, binary } = documentOf('camera', true, [
    ...sprite([1, 0, 0]),
    ...sprite([2, 0, 0]),
    ...sprite([3, 0, 0]),
  ])
  const first = createUvmEffectFrame(document, { ...options(binary), time: 0 })
  assert.equal(first.primitives.length, 1)
  const [primitive] = first.primitives
  assert.deepEqual([...primitive.positions], [0.5, 0.5, 0, 1.5, 0.5, 0, 1.5, -0.5, 0, 0.5, -0.5, 0])
  assert.deepEqual([...primitive.textureCoordinates], [0.5, 0, 0.75, 0, 0.75, 0.25, 0.5, 0.25])
  assert.deepEqual([...primitive.indices], [0, 1, 2, 0, 2, 3])
  assert.deepEqual([...(primitive.colors ?? primitive.vertexTints).subarray(0, 4)], [1, 0.5, 0, 1])
  // frame 1 holds two sprites; past the last frame a looping track starts again
  assert.equal(
    createUvmEffectFrame(document, { ...options(binary), time: 1 / 15 }).primitives[0].positions
      .length,
    24,
  )
  assert.equal(
    createUvmEffectFrame(document, { ...options(binary), time: 3 / 15 }).primitives[0].positions
      .length,
    24,
  )
  // another clip draws nothing of it
  assert.equal(
    createUvmEffectFrame(document, { ...options(binary), time: 0, sequenceIndex: 1 }).primitives
      .length,
    0,
  )
})

test('a track that does not loop ends; an axis card spans its axis across the view', () => {
  const ended = documentOf('camera', false, [...sprite([1, 0, 0]), ...sprite([2, 0, 0])])
  assert.equal(
    createUvmEffectFrame(ended.document, { ...options(ended.binary), time: 2 / 15 }).primitives
      .length,
    0,
  )
  const { document, binary } = documentOf('axis', false, [
    ...sprite([0, 0, -5], [0, 1, 0]),
    ...sprite([0, 0, -5], [0, 1, 0]),
  ])
  const [primitive] = createUvmEffectFrame(document, { ...options(binary), time: 0 }).primitives
  assert.deepEqual([...primitive.positions], [-0.5, 1, -5, 0.5, 1, -5, 0.5, -1, -5, -0.5, -1, -5])
})

test('a ribbon batch joins its points into a strip whose quads share their edges', () => {
  // three points along x, strip 7, half width 0.5, u 0, 1, 2; seen from the origin down -z
  const point = (x, u) => [x, 0, -5, 0.5, 0, u, 1, 1, 1, 1, 0, 7, 0, 0, 0, 0, 1]
  const { document, binary } = documentOf('ribbon', false, [
    ...point(0, 0),
    ...point(0, 0),
    ...point(1, 1),
    ...point(2, 2),
  ])
  // frame 1 holds the three points of the strip
  const [primitive] = createUvmEffectFrame(document, {
    ...options(binary),
    time: 1 / 15,
  }).primitives
  assert.equal(primitive.positions.length, 24)
  const corners = [...primitive.positions].map(value => Math.round(value * 1000) / 1000)
  const quads = [corners.slice(0, 12), corners.slice(12, 24)].sort((a, b) => a[0] - b[0])
  // each quad spans its segment, half a unit to either side of the strip
  assert.deepEqual(quads[0], [0, -0.5, -5, 1, -0.5, -5, 1, 0.5, -5, 0, 0.5, -5])
  // the second quad starts on the first one's end edge
  assert.deepEqual(quads[1].slice(0, 3), quads[0].slice(3, 6))
  assert.deepEqual(quads[1].slice(9, 12), quads[0].slice(6, 9))
})
