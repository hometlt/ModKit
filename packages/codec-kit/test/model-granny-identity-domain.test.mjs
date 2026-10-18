/** DaIdentity dimension zero is emitted by primary LSLib UpgradeToGr7, not an inferred vector. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { unpackGrannyCurve } from '../dist/model/granny.js'
const raw = dimension => ({
  CurveDataHeader_DaIdentity: { Format: 2, Degree: 0 },
  Dimension: dimension,
})
const limits = { maxBytes: 4096, maxNodes: 100 }
test('zero native identity dimension uses the explicit caller domain', () => {
  assert.deepEqual(unpackGrannyCurve(raw(0), { kind: 'quaternion' }, limits).controls, [0, 0, 0, 1])
  assert.deepEqual(
    unpackGrannyCurve(raw(0), { kind: 'matrix3' }, limits).controls,
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
  )
  assert.deepEqual(
    unpackGrannyCurve(raw(0), { kind: 'vector', dimension: 3 }, limits).controls,
    [0, 0, 0],
  )
})
test('identity still refuses positive conflicting dimensions and bounded output overflow', () => {
  assert.throws(
    () => unpackGrannyCurve(raw(3), { kind: 'quaternion' }, limits),
    /dimension mismatch/,
  )
  assert.throws(() => unpackGrannyCurve(raw(-1), { kind: 'quaternion' }, limits))
  assert.throws(
    () => unpackGrannyCurve(raw(0), { kind: 'matrix3' }, { maxBytes: 1, maxNodes: 100 }),
    RangeError,
  )
})
