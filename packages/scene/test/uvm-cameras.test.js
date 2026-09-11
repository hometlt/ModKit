import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  resolveUvmCamera,
  previewFrameFromInverseBind,
  previewCameraNodeMatrix,
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
