/** Full shear projection: pinned LSLib Transform.ToMatrix4 with OpenTK4.9.4 produced these goldens.
 * Source6f5f6987 LSLib/Granny/GR2/Format.cs; literal native coefficients and exact unit quaternion.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectGrannyTransform, projectGrannyTransformMatrix } from '../dist/model/granny.js'
import { composeTrsMatrix } from '../dist/model-math/sequence-pose.js'

const native = flags => ({ flags, position: [29, 31, 37], orientation: [0, 0, 1, 0],
  scaleShear: [2, 3, 5, 7, 11, 13, 17, 19, 23] })
const golden = [
  [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
  [1,0,0,0,0,1,0,0,0,0,1,0,29,31,37,1],
  [-1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1],
  [-1,0,0,0,0,-1,0,0,0,0,1,0,29,31,37,1],
  [2,3,5,0,7,11,13,0,17,19,23,0,0,0,0,1],
  [2,3,5,0,7,11,13,0,17,19,23,0,29,31,37,1],
  [-2,-3,5,0,-7,-11,13,0,-17,-19,23,0,0,0,0,1],
  [-2,-3,5,0,-7,-11,13,0,-17,-19,23,0,29,31,37,1],
]

test('all native presence flags match independent asymmetric-shear/rotation/translation goldens', () => {
  for (let flags = 0; flags < 8; flags++) {
    const result = projectGrannyTransformMatrix(native(flags))
    assert.deepEqual(result.matrix, golden[flags], `flags${flags}`)
    assert.equal(result.normalizedRotation, false); assert.equal(result.zeroRotation, false)
  }
  assert.throws(() => projectGrannyTransform(native(7), 0), /shear/)
})

test('diagonal negative/zero scales agree with existing TRS composition; normalization is explicit', () => {
  const input = native(7); input.scaleShear = [-2, 0, 0, 0, 0, 0, 0, 0, 3]
  input.orientation = [0, 0, 2, 0]
  const trs = projectGrannyTransform(input, 0), full = projectGrannyTransformMatrix(input)
  const matrix = new Float32Array(16)
  composeTrsMatrix(matrix, 0, trs.trs.translation, trs.trs.rotation, trs.trs.scale)
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(matrix[i] - full.matrix[i]) < 1e-7)
  assert.equal(full.normalizedRotation, true); assert.equal(full.zeroRotation, false)
  input.orientation = [0, 0, 0, 0]
  assert.equal(projectGrannyTransformMatrix(input).zeroRotation, true)
})

test('disabled malformed components stay ignored and returned matrix owns its coefficients', () => {
  assert.deepEqual(projectGrannyTransformMatrix({ flags: 0, position: null, orientation: 'ignored', scaleShear: NaN }).matrix, golden[0])
  const input = native(7), result = projectGrannyTransformMatrix(input)
  input.scaleShear.fill(99); input.position.fill(99); input.orientation.fill(99)
  assert.deepEqual(result.matrix, golden[7])
})

test('enabled invalid values and float32 composition/affine product overflow refuse', () => {
  for (const value of [null, undefined, {}, { flags: 1, position: Array(3) }])
    assert.throws(() => projectGrannyTransformMatrix(value))
  const input = native(7); input.position = [1e300, 0, 0]
  assert.throws(() => projectGrannyTransformMatrix(input), /finite float range/)
  // Existing TRS admission remains finite-number based, without the new matrix backend constraint.
  input.scaleShear = [1,0,0,0,1,0,0,0,1]
  assert.equal(projectGrannyTransform(input, 0).trs.translation[0], 1e300)
  input.position = [0,0,0]; input.scaleShear.fill(Number.MAX_VALUE)
  input.orientation = [0,0,1,2]
  assert.throws(() => projectGrannyTransformMatrix(input), /nonfinite/)
})
