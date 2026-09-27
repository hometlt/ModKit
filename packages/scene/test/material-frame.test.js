import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  IDENTITY_MATERIAL_FRAME,
  invertMaterialFrame,
  materialFrame,
  multiplyMaterialFrames,
} from '../src/materials/frame.js'

// Column-major: a quarter turn about X (y -> z), scale 2 on X, then a translation.
const turned = [2, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 3, 4, 5, 1]
// Elimination leaves signed zeros where the value is zero; compare values, not zero signs.
const values = frame => frame.map(value => value + 0)

it('inverts an affine frame exactly, pivoting past a zero diagonal', () => {
  // The first column's pivot is fine; the second column's diagonal is zero and needs a row swap.
  assert.deepEqual(
    values(invertMaterialFrame(turned)),
    [0.5, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, -1.5, -5, 4, 1],
  )
  assert.ok(Object.isFrozen(invertMaterialFrame(turned)))
  assert.deepEqual(
    values(multiplyMaterialFrames(turned, invertMaterialFrame(turned))),
    IDENTITY_MATERIAL_FRAME,
  )
})

it('keeps no state between inversions', () => {
  const scaled = [4, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0.5, 0, 1, 2, 3, 1]
  const first = invertMaterialFrame(turned)
  assert.deepEqual(
    values(invertMaterialFrame(scaled)),
    [0.25, 0, 0, 0, 0, 0.125, 0, 0, 0, 0, 2, 0, -0.25, -0.25, -6, 1],
  )
  assert.deepEqual(invertMaterialFrame(turned), first)
})

it('refuses frames that are not finite affine float32 matrices with a float32 inverse', () => {
  assert.throws(() => materialFrame([1, 0, 0]), /finite affine float32/)
  assert.throws(() => materialFrame([...IDENTITY_MATERIAL_FRAME.slice(0, 15), 2]), /affine/)
  assert.throws(
    () => materialFrame(IDENTITY_MATERIAL_FRAME.map((v, i) => (i === 5 ? NaN : v))),
    /finite/,
  )
  assert.throws(
    () => materialFrame(IDENTITY_MATERIAL_FRAME.map((v, i) => (i === 0 ? 1e39 : v))),
    /float32/,
  )
  // Singular: the Y axis collapses.
  assert.throws(
    () => materialFrame(IDENTITY_MATERIAL_FRAME.map((v, i) => (i === 5 ? 0 : v))),
    /invertible/,
  )
  // Invertible in doubles, but the inverse leaves float32.
  assert.throws(
    () => materialFrame(IDENTITY_MATERIAL_FRAME.map((v, i) => (i === 0 ? 1e-39 : v))),
    /inverse exceeds float32/,
  )
  const frame = materialFrame([...turned])
  assert.deepEqual(frame, turned)
  assert.ok(Object.isFrozen(frame))
})
