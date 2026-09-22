import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { splitTrianglesByBoneLimit } from '../dist/model/skinning.js'

/**
 * `count` triangles, the nth rigidly on bone n.
 *
 * Rigid on purpose: the split is about which bones a part has to bind, and one bone per triangle
 * makes that count exactly predictable.
 */
function oneBonePerTriangle(count: number) {
  const indices = new Uint32Array(count * 3)
  const boneIndices = new Uint32Array(count * 3 * 4)
  const boneWeights = new Float32Array(count * 3 * 4)
  for (let triangle = 0; triangle < count; triangle += 1)
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = triangle * 3 + corner
      indices[vertex] = vertex
      boneIndices[vertex * 4] = triangle
      boneWeights[vertex * 4] = 1
    }
  return { indices, boneIndices, boneWeights }
}

describe('splitting triangles to a bone budget', () => {
  it('leaves a mesh that already fits in one piece', () => {
    const { indices, boneIndices, boneWeights } = oneBonePerTriangle(4)
    const parts = splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, { maxBones: 8 })
    assert.equal(parts.length, 1)
    assert.deepEqual([...parts[0]!.bones], [0, 1, 2, 3])
    assert.equal(parts[0]!.indices.length, 12)
    // Vertices are renumbered into the part's own space, and say where each came from.
    assert.equal(parts[0]!.vertices.length, 12)
    assert.deepEqual([...parts[0]!.indices].slice(0, 3), [0, 1, 2])
  })

  it('splits when the mesh names more bones than the target can bind', () => {
    const { indices, boneIndices, boneWeights } = oneBonePerTriangle(10)
    const parts = splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, { maxBones: 4 })
    assert.equal(parts.length, 3)
    for (const part of parts) assert.ok(part.bones.length <= 4)
    // Nothing is dropped: every triangle is still there, exactly once.
    assert.equal(
      parts.reduce((total, part) => total + part.indices.length, 0),
      30,
    )
    // And the parts together still name every bone the mesh used.
    const bones = new Set(parts.flatMap(part => [...part.bones]))
    assert.equal(bones.size, 10)
  })

  it('maps a part vertex back to the vertex it came from', () => {
    const { indices, boneIndices, boneWeights } = oneBonePerTriangle(6)
    const parts = splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, { maxBones: 2 })
    for (const part of parts)
      for (const local of part.indices) {
        const original = part.vertices[local]!
        // The bone the original vertex followed is one this part binds.
        assert.ok(part.bones.includes(boneIndices[original * 4]!))
      }
  })

  it('treats an unskinned mesh as needing no bones at all', () => {
    const { indices } = oneBonePerTriangle(3)
    const parts = splitTrianglesByBoneLimit(indices, undefined, undefined, { maxBones: 1 })
    assert.equal(parts.length, 1)
    assert.deepEqual([...parts[0]!.bones], [])
  })

  it('refuses a triangle that cannot fit in any part rather than dropping influences', () => {
    const indices = Uint32Array.of(0, 1, 2)
    const boneIndices = Uint32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    const boneWeights = new Float32Array(12).fill(0.25)
    assert.throws(
      () => splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, { maxBones: 4 }),
      /more than the budget/u,
    )
  })
})
