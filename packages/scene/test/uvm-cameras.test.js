import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  resolveUvmCamera,
  previewFrameFromInverseBind,
  previewCameraNodeMatrix,
  spriteCamera,
} from '../src/uvm/cameras.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const doc = {
  nodes: [{ camera: 0 }],
  cameras: [{ type: 'perspective', perspective: { yfov: Math.PI / 2, znear: 1, zfar: 9 } }],
}
const options = {
  aspect: 2,
  maxBytes: 65536,
  maxNodes: 1000,
  activeNodes: new Set(['node-0']),
  nodeTransforms: new Map([['node-0', Float32Array.from(identity)]]),
}
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  expected.forEach((value, index) =>
    assert.ok(
      Math.abs(actual[index] - value) < 1e-6,
      `matrix component ${index}: ${actual[index]} != ${value}`,
    ),
  )
}
it('selects glTF perspective by node and returns full owned projection/view/eye', () => {
  const frame = Float32Array.from(identity)
  frame[12] = 3
  frame[13] = 4
  frame[14] = 5
  const actual = resolveUvmCamera(
    doc,
    { node: 0 },
    { ...options, nodeTransforms: new Map([['node-0', frame]]) },
  )
  close(actual.viewMatrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, -4, -5, 1])
  close(actual.viewProjection, [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.25, -1, -1.5, -4, 4, 5])
  assert.deepEqual(actual.eyePosition, [3, 4, 5])
  frame.fill(0)
  assert.equal(actual.viewMatrix[12], -3)
})
it('samples portable camera projection tracks from the selected sequence clock', () => {
  const sequenceTrack = (from, to) => [{
    sequenceIndex: 7,
    track: {
      lineType: 1,
      globalSeqId: null,
      keys: [{ frame: 0, vector: [from] }, { frame: 1, vector: [to] }],
    },
  }]
  const animated = structuredClone(doc)
  animated.cameras[0].extensions = {
    UV_scene_camera: {
      version: 1,
      sequenceAnimation: {
        yfov: sequenceTrack(Math.PI / 2, Math.PI / 3),
        znear: sequenceTrack(1, 2),
        zfar: sequenceTrack(9, 18),
      },
    },
  }
  const start = resolveUvmCamera(
    animated,
    { node: 0 },
    { ...options, time: 0, sequenceIndex: 7 },
  )
  const end = resolveUvmCamera(
    animated,
    { node: 0 },
    { ...options, time: 1, sequenceIndex: 7 },
  )
  assert.notDeepEqual([...end.viewProjection], [...start.viewProjection])
  assert.ok(Math.abs(end.viewProjection[0] - Math.sqrt(3) / 2) < 1e-6)
  close(
    resolveUvmCamera(animated, { node: 0 }, { ...options, time: 1, sequenceIndex: 8 })
      .viewProjection,
    start.viewProjection,
  )
})
it('uses authored aspect, ignores positive camera scale and selects orthographic projection', () => {
  const scaled = Float32Array.from(identity)
  scaled[0] = 2
  scaled[5] = 3
  scaled[10] = 4
  const settings = { ...options, nodeTransforms: new Map([['node-0', scaled]]) }
  const perspective = structuredClone(doc)
  perspective.cameras[0].perspective.aspectRatio = 1
  close(
    resolveUvmCamera(perspective, { node: 0 }, settings).viewProjection,
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.25, -1, 0, 0, -2.25, 0],
  )
  const orthographic = {
    nodes: doc.nodes,
    cameras: [{ type: 'orthographic', orthographic: { xmag: 2, ymag: 4, znear: 0, zfar: 8 } }],
  }
  close(
    resolveUvmCamera(orthographic, { node: 0 }, settings).viewProjection,
    [0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, -0.25, 0, 0, 0, -1, 1],
  )
})
it('preserves explicit matrix override and refuses ambiguous, inactive, malformed and unbounded requests', () => {
  const actual = resolveUvmCamera(
    doc,
    { viewProjection: identity, viewMatrix: identity, eyePosition: [0, 0, 0] },
    options,
  )
  close(actual.viewProjection, identity)
  assert.notEqual(actual.viewProjection, identity)
  assert.throws(
    () => resolveUvmCamera(doc, { node: 0, viewProjection: identity }, options),
    /mutually exclusive/,
  )
  assert.throws(
    () => resolveUvmCamera(doc, { node: 0 }, { ...options, activeNodes: new Set() }),
    /selected scene/,
  )
  assert.throws(() => resolveUvmCamera(doc, { node: 9 }, options), /camera node/)
  assert.throws(() => resolveUvmCamera(doc, { node: 0 }, { ...options, maxBytes: 1 }), /budget/)
  assert.throws(
    () => resolveUvmCamera(doc, { node: 0 }, { ...options, signal: AbortSignal.abort() }),
    /abort/i,
  )
  const infinite = structuredClone(doc)
  delete infinite.cameras[0].perspective.zfar
  assert.throws(() => resolveUvmCamera(infinite, { node: 0 }, options), /infinite-far/)
  const shear = Float32Array.from(identity)
  shear[4] = 1
  assert.throws(
    () =>
      resolveUvmCamera(
        doc,
        { node: 0 },
        { ...options, nodeTransforms: new Map([['node-0', shear]]) },
      ),
    /shear/,
  )
})
it('derives native-independent bind position/forward and an exact look-at node without mutating input', () => {
  const inverse = identity.slice()
  inverse[12] = -3
  inverse[13] = -4
  inverse[14] = -5
  const frame = previewFrameFromInverseBind(inverse)
  assert.deepEqual(frame, { position: [3, 4, 5], forward: [-0, -0, -1] })
  close(
    previewCameraNodeMatrix(frame.position, [3, 4, 4], [0, 1, 0]),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1],
  )
  assert.equal(inverse[12], -3)
  assert.throws(() => previewFrameFromInverseBind(Array(16).fill(0)), /affine|singular/)
  assert.throws(() => previewCameraNodeMatrix([0, 0, 0], [0, 0, 0], [0, 1, 0]), /singular/)
})

it('draws sprite frames with an orthographic camera at a facing, a pitch and a pixel scale (V7)', () => {
  // a point to its pixel, from the top-left, as the renderer rasterizes the request's camera
  const pixel = (camera, point, width, height) => {
    const m = camera.viewProjection
    const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12]
    const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13]
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15]
    return [((x / w + 1) / 2) * width, ((1 - y / w) / 2) * height]
  }
  const close = (actual, expected) =>
    actual.forEach((value, index) =>
      assert.ok(Math.abs(value - expected[index]) < 1e-3, `${actual}`),
    )
  const front = spriteCamera({
    azimuthDegrees: 0,
    elevationDegrees: 30,
    pixelsPerUnit: 10,
    width: 64,
    height: 48,
  })
  close(pixel(front, [0, 0, 0], 64, 48), [32, 24])
  // facing 0 looks along -z: +x is the frame's right, ten pixels per unit
  close(pixel(front, [1, 0, 0], 64, 48), [42, 24])
  // straight down (StarCraft) the facing's far side is the frame's top
  const down = spriteCamera({
    azimuthDegrees: 0,
    elevationDegrees: 90,
    pixelsPerUnit: 10,
    width: 64,
    height: 48,
  })
  close(pixel(down, [0, 0, -1], 64, 48), [32, 14])
  // a quarter turn shows the model's +x side; the target lands on its anchor
  const side = spriteCamera({
    azimuthDegrees: 90,
    elevationDegrees: 0,
    pixelsPerUnit: 4,
    width: 32,
    height: 32,
    anchor: [10, 30],
  })
  close(pixel(side, [0, 0, 0], 32, 32), [10, 30])
  close(pixel(side, [0, 0, -1], 32, 32), [14, 30])
  assert.deepEqual(side.eyePosition.map(Math.round), [1000, 0, 0])
  assert.throws(() =>
    spriteCamera({
      azimuthDegrees: 0,
      elevationDegrees: 30,
      pixelsPerUnit: 0,
      width: 8,
      height: 8,
    }),
  )
})
