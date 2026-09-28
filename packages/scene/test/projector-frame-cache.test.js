import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmProjectorFrame, createUvmProjectorFrameCache } from '../src/uvm/projectors.js'

// A downward orthographic projector over a ground plane 3 below its bone (see projector-bone-scale).
const projector = {
  node: 0,
  material: 0,
  active: 1,
  projectionType: 'orthographic',
  offset: [0.5, 0, 0],
  pitch: 0,
  yaw: 0,
  roll: 0,
  near: 0.1,
  far: 4,
  fieldOfView: 1,
  aspectRatio: 1,
  boxOffsetXLeft: -1,
  boxOffsetXRight: 1,
  boxOffsetYBack: -1,
  boxOffsetYFront: 1,
  boxOffsetZBottom: 0,
  boxOffsetZTop: 0,
  alphaInit: 1,
  falloff: 0,
  attenuationDistance: 0,
  flags: 0,
  layer: 0,
}
const document = {
  asset: { version: '2.0' },
  nodes: [{}],
  extensions: { UV_game_effects: { projectors: [projector] } },
}
const ground = {
  id: 'ground',
  topology: 'triangles',
  positions: Float32Array.of(-10, -10, 3, 10, -10, 3, 10, 10, 3, -10, -10, 3, 10, 10, 3, -10, 10, 3),
}
const base = { id: 'material-0', baseColor: [1, 1, 1, 1] }
const still = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 1, 0, 1]

const project = (bone, cache, { receiver = ground, material = base } = {}) =>
  createUvmProjectorFrame(document, {
    receivers: [receiver],
    nodeTransforms: new Map([['node-0', Float32Array.from(bone)]]),
    activeNodes: new Set(['node-0']),
    materials: [material],
    maxBytes: 1 << 20,
    maxNodes: 1000,
    warn: () => {},
    ...(cache === undefined ? {} : { cache }),
  })

test("a placement's projector that stands where it stood takes its triangles and material again", () => {
  const cache = createUvmProjectorFrameCache()
  const first = project(still, cache)
  const again = project(still, cache)
  for (const key of ['positions', 'indices', 'textureCoordinates'])
    assert.equal(again.primitives[0][key], first.primitives[0][key], key)
  assert.equal(again.materials[0], first.materials[0])
  // What it takes is what projecting afresh makes.
  assert.deepEqual(again, project(still))
  // A moved projector clips again, and so does the one moved back.
  const away = project(moved, cache)
  assert.notEqual(away.primitives[0].positions, first.primitives[0].positions)
  assert.deepEqual(away, project(moved))
  const back = project(still, cache)
  assert.notEqual(back.primitives[0].positions, first.primitives[0].positions)
  assert.deepEqual(back, first)
})

test('another receiver buffer or material is projected anew, even with the same values', () => {
  const cache = createUvmProjectorFrameCache()
  const first = project(still, cache)
  const copied = project(still, cache, {
    receiver: { ...ground, positions: ground.positions.slice() },
  })
  assert.notEqual(copied.primitives[0].positions, first.primitives[0].positions)
  assert.deepEqual(copied, first)
  const other = project(still, cache, { material: { ...base } })
  assert.notEqual(other.materials[0], first.materials[0])
  assert.deepEqual(other.materials, first.materials)
  // Placements keep their own caches: nothing is shared between them.
  const elsewhere = project(still, createUvmProjectorFrameCache())
  assert.notEqual(elsewhere.primitives[0].positions, first.primitives[0].positions)
})
