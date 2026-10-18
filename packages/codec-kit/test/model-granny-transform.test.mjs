/** Native component flags, explicit loss admission and unchanged quaternion/scale semantics. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectGrannyTransform } from '../dist/model/granny.js'

const native = () => ({ flags: 7, position: [1, -2, 3], orientation: [0, 0, -2, -2],
  scaleShear: [-2, 0, 0, 0, 0, 0, 0, 0, 3] })

test('native TRS retains scale, quaternion sign and owned arrays; flags select defaults', () => {
  const input = native(), result = projectGrannyTransform(input, 0)
  assert.deepEqual(result.trs, { translation: [1, -2, 3],
    rotation: [0, 0, -0.7071067811865475, -0.7071067811865475], scale: [-2, 0, 3] })
  assert.equal(result.normalizedRotation, true); assert.equal(result.zeroRotation, false)
  assert.equal(result.discardedShear, 0)
  input.position[0] = 100; input.orientation[2] = 100; input.scaleShear[0] = 100
  assert.equal(result.trs.translation[0], 1); assert.equal(result.trs.scale[0], -2)
  assert.deepEqual(projectGrannyTransform({ flags: 0, position: null,
    orientation: 'ignored', scaleShear: NaN }, 0).trs,
    { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
})

test('each off-diagonal coefficient observes the explicit inclusive shear threshold', () => {
  for (const i of [1, 2, 3, 5, 6, 7]) for (const sign of [-1, 1]) {
    const input = native(); input.scaleShear[i] = sign * 1e-5
    assert.equal(projectGrannyTransform(input, 1e-5).discardedShear, 1e-5)
    assert.throws(() => projectGrannyTransform(input, 0), /shear/)
    input.scaleShear[i] *= 2
    assert.throws(() => projectGrannyTransform(input, 1e-5), /shear/)
  }
})

test('zero quaternion remains zero and is reported instead of fabricating an identity', () => {
  const input = native(); input.orientation = [0, 0, 0, 0]
  const result = projectGrannyTransform(input, 0)
  assert.deepEqual(result.trs.rotation, [0, 0, 0, 0]); assert.equal(result.zeroRotation, true)
  assert.equal(result.normalizedRotation, false)
  input.orientation = [0, 0, 0, -1]
  assert.deepEqual(projectGrannyTransform(input, 0).trs.rotation, [0, 0, 0, -1])
  assert.equal(projectGrannyTransform(input, 0).normalizedRotation, false)
})

test('invalid structures, tolerances and enabled sparse/nonfinite vectors refuse', () => {
  for (const value of [undefined, null, [], 1, 'x', {}, { flags: NaN }])
    assert.throws(() => projectGrannyTransform(value, 0))
  for (const tolerance of [-1, NaN, Infinity]) assert.throws(() => projectGrannyTransform(native(), tolerance))
  for (const [field, width] of [['position', 3], ['orientation', 4], ['scaleShear', 9]]) {
    for (const vector of [null, new Float32Array(width), [], Array(width), Array(width).fill(Infinity)]) {
      const input = native(); input[field] = vector
      assert.throws(() => projectGrannyTransform(input, 0))
    }
  }
})
