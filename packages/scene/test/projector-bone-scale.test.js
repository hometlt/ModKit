import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmProjectorFrame } from '../src/uvm/projectors.js'

// A downward orthographic projector: box ±1 across, 0.1..4 deep, placed on its bone.
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
// Ground 3 below the bone, wide enough for any box here: the projector looks along its +Z.
const ground = {
  id: 'ground',
  topology: 'triangles',
  positions: Float32Array.of(-10, -10, 3, 10, -10, 3, 10, 10, 3, -10, -10, 3, 10, 10, 3, -10, 10, 3),
}
const extentOnGround = bone => {
  const out = createUvmProjectorFrame(document, {
    receivers: [ground],
    nodeTransforms: new Map([['node-0', Float32Array.from(bone)]]),
    activeNodes: new Set(['node-0']),
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
    maxBytes: 1 << 20,
    maxNodes: 1000,
    warn: () => {},
  })
  assert.equal(out.primitives.length, 1)
  const positions = out.primitives[0].positions
  const xs = [...positions].filter((_, index) => index % 3 === 0)
  const ys = [...positions].filter((_, index) => index % 3 === 1)
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
}

test('a projector box, offset and depth are authored in its bone units, scale included', () => {
  const unscaled = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.deepEqual(extentOnGround(unscaled), [-0.5, 1.5, -1, 1])
  // A bone scaled ×2: the box spans ±2 around an offset of 1 (0.2..8 deep); normalising the bone's
  // frame drew it over ±1 around 0.5.
  const scaled = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
  assert.deepEqual(extentOnGround(scaled), [-1, 3, -2, 2])
  // A rotated, scaled bone: the axes turn, the extents follow the scale along each axis.
  const turned = [0, 3, 0, 0, -3, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]
  assert.deepEqual(extentOnGround(turned), [-3, 3, -1.5, 4.5])
})

test('a non-uniform bone scale stretches the box along its own axis only', () => {
  const stretched = [3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.deepEqual(extentOnGround(stretched), [-1.5, 4.5, -1, 1])
})
