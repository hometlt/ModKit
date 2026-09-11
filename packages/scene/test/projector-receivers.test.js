// Intended for scene/test under its existing Node/TS harness; not executed as a draft.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipProjectorReceivers } from '../src/uvm/projector-receivers.js'
import { headlessDepthBias, applyWebGlDepthBias } from '../src/render/depth-bias.js'
import { createUvmProjectorFrame } from '../src/uvm/projectors.js'
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const frame = {
  projectionType: 'orthographic',
  origin: [0, 0, 0],
  rightAxis: [1, 0, 0],
  upAxis: [0, 1, 0],
  forwardAxis: [0, 0, 1],
  near: 0.1,
  far: 2,
  left: -1,
  rightExtent: 1,
  bottom: -1,
  top: 1,
  tangentX: 1,
  tangentY: 1,
}
const receiver = (positions, transform = identity) => [
  {
    primitive: { id: 'receiver', topology: 'triangles', positions: Float32Array.from(positions) },
    transform,
  },
]
const budget = { maxBytes: 65536, maxTriangles: 100 }
test('six-plane clipping preserves full triangle positions and orthographic UVs', () => {
  const input = receiver([-0.5, -0.5, 1, 0.5, -0.5, 1, 0, 0.5, 1]),
    before = input[0].primitive.positions.slice()
  const out = clipProjectorReceivers(frame, input, budget)
  assert.deepEqual(out.positions, before)
  assert.deepEqual([...out.textureCoordinates], [0.25, 0.25, 0.75, 0.25, 0.5, 0.75])
  assert.deepEqual([...out.indices], [0, 1, 2])
  assert.deepEqual(input[0].primitive.positions, before)
})
test('crossing receivers are clipped to volume; perspective UVs use receiver depth', () => {
  const clipped = clipProjectorReceivers(frame, receiver([-2, 0, 1, 0, 0, 1, 0, 1, 1]), budget)
  assert.deepEqual(
    [...clipped.positions],
    [-1, 0.5, 1, -1, 0, 1, 0, 0, 1, -1, 0.5, 1, 0, 0, 1, 0, 1, 1],
  )
  assert.deepEqual([...clipped.indices], [0, 1, 2, 3, 4, 5])
  const perspective = clipProjectorReceivers(
    { ...frame, projectionType: 'perspective', far: 3 },
    receiver([-1, -1, 2, 1, -1, 2, 0, 1, 2]),
    budget,
  )
  assert.deepEqual([...perspective.textureCoordinates], [0.25, 0.25, 0.75, 0.25, 0.5, 0.75])
  assert.equal(
    clipProjectorReceivers(frame, receiver([0, 0, -1, 1, 0, -1, 0, 1, -1]), budget).positions
      .length,
    0,
  )
})
test('receiver transforms, output budget, malformed geometry and cancellation are explicit', () => {
  const translated = [...identity]
  translated[12] = 0.25
  const result = clipProjectorReceivers(
    frame,
    receiver([0, 0, 1, 0.5, 0, 1, 0, 0.5, 1], translated),
    budget,
  )
  assert.equal(result.positions[0], 0.25)
  assert.throws(
    () =>
      clipProjectorReceivers(frame, receiver([0, 0, 1, 0.5, 0, 1, 0, 0.5, 1]), {
        ...budget,
        maxBytes: 551,
      }),
    /budget/,
  )
  assert.throws(
    () => clipProjectorReceivers(frame, receiver([NaN, 0, 1, 1, 0, 1, 0, 1, 1]), budget),
    /nonfinite/,
  )
  assert.throws(
    () =>
      clipProjectorReceivers(frame, receiver([0, 0, 1, 1, 0, 1, 0, 1, 1]), {
        ...budget,
        signal: AbortSignal.abort(),
      }),
    /abort/i,
  )
})
test('draw-local depth offset preserves absent behavior and moves biased slopes toward the camera', () => {
  const triangle = [
    { x: 0, y: 0, z: 0.5 },
    { x: 2, y: 0, z: 0.7 },
    { x: 0, y: 2, z: 0.5 },
  ]
  assert.equal(headlessDepthBias(triangle, undefined), 0)
  assert.ok(headlessDepthBias(triangle, { slopeScale: -1, units: -1 }) < -0.09)
  assert.throws(() => headlessDepthBias(triangle, { slopeScale: NaN, units: 0 }), /invalid/)
})
test('common UVM projector uses sampled receivers and leaves its source unchanged', () => {
  const projector = {
    node: 0,
    material: 0,
    active: 1,
    projectionType: 'orthographic',
    offset: [0, 0, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    near: 0.1,
    far: 2,
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
  const original = structuredClone(document),
    warnings = []
  const out = createUvmProjectorFrame(document, {
    receivers: receiver([-0.5, -0.5, 1, 0.5, -0.5, 1, 0, 0.5, 1]).map(item => item.primitive),
    nodeTransforms: new Map([['node-0', Float32Array.from(identity)]]),
    activeNodes: new Set(['node-0']),
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
    maxBytes: 65536,
    maxNodes: 100,
    warn: value => warnings.push(value),
  })
  assert.equal(out.primitives.length, 1)
  assert.deepEqual(out.primitives[0].depthBias, { slopeScale: -1, units: -1 })
  assert.deepEqual([...out.primitives[0].textureCoordinates], [0.25, 0.25, 0.75, 0.25, 0.5, 0.75])
  assert.deepEqual(document, original)
  assert.deepEqual(warnings, [])
})

test('WebGL offset is disabled for the following ordinary draw', () => {
  const calls = [],
    gl = {
      POLYGON_OFFSET_FILL: 0x8037,
      enable: value => calls.push(['enable', value]),
      disable: value => calls.push(['disable', value]),
      polygonOffset: (slope, units) => calls.push(['offset', slope, units]),
    }
  applyWebGlDepthBias(gl, { slopeScale: -1, units: -1 })
  applyWebGlDepthBias(gl, undefined)
  assert.deepEqual(calls, [
    ['enable', 0x8037],
    ['offset', -1, -1],
    ['disable', 0x8037],
  ])
})

test('headless provider applies offset per primitive and preserves unbiased draw behavior', async () => {
  const { renderHeadless } = await import('../src/render/headless.js')
  const positions = Float32Array.from([-0.75, -0.75, 0.5, 0, 0.75, 0.5, 0.75, -0.75, 0.5])
  const primitive = (id, depthBias) => ({
    id,
    materialId: id,
    topology: 'triangles',
    positions,
    ...(depthBias === undefined ? {} : { depthBias }),
  })
  const render = async biased =>
    renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 16, height: 16 },
      camera: { viewProjection: Float32Array.from(identity) },
      scene: {
        materials: [
          { id: 'green', baseColor: [0, 1, 0, 1] },
          { id: 'red', baseColor: [1, 0, 0, 1] },
        ],
        primitives: [
          primitive('green', biased ? { slopeScale: -1, units: -1 } : undefined),
          primitive('red'),
        ],
      },
    })
  const plain = await render(false),
    biased = await render(true),
    center = (8 * 16 + 8) * 4
  assert.deepEqual([...plain.rgba.slice(center, center + 4)], [255, 0, 0, 255])
  assert.deepEqual([...biased.rgba.slice(center, center + 4)], [0, 255, 0, 255])
})
