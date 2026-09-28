import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createModelSkinDeformer } from '../dist/model/skinning.js'

const translated = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const pose = (x0, x1) => [
  { boneIndex: 0, skinningMatrix: translated(x0, 0, 0) },
  { boneIndex: 1, skinningMatrix: translated(x1, 0, 0) },
]

/** Three vertices: the first on bone 0, the second on bone 1, the third split evenly. */
const primitive = {
  id: 'skin',
  materialId: 'm',
  topology: 'triangles',
  hierarchyId: 'h',
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  tangents: Float32Array.from([1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2]),
  boneIndices: Uint16Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
  boneWeights: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]),
}

describe('skin deformer', () => {
  it('places each vertex by its weighted bones and keeps the tangent handedness', () => {
    const frame = createModelSkinDeformer(primitive, [0, 1]).deform(pose(0, 2))
    assert.deepEqual([...frame.positions], [0, 0, 0, 3, 0, 0, 1, 1, 0])
    assert.deepEqual([...frame.normals], [0, 0, 1, 0, 0, 1, 0, 0, 1])
    assert.deepEqual([...frame.tangents], [1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1])
    assert.equal(frame.boneWeights, undefined)
    assert.equal(frame.hierarchyId, undefined)
  })

  it('gives every frame attributes of its own', () => {
    const deformer = createModelSkinDeformer(primitive, [0, 1])
    const other = createModelSkinDeformer(
      { ...primitive, positions: Float32Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5]) },
      [0, 1],
    )
    const first = deformer.deform(pose(0, 2))
    deformer.deform(pose(7, 9))
    other.deform(pose(1, 1))
    assert.deepEqual([...first.positions], [0, 0, 0, 3, 0, 0, 1, 1, 0])
    assert.deepEqual([...first.tangents], [1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1])
  })
})
