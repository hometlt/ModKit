import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { bakeSkinToRigidParts } from '../dist/model/skinning.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** Bone 1 sits ten units along +X, so a part baked into its frame loses that offset. */
const movedAlongX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]

/**
 * Two triangles: the first rigidly on bone 0, the second rigidly on bone 1.
 *
 * Rigid on purpose — the interesting assertions are about where the vertices land and what the
 * bake reports, and a shared vertex is exercised separately below.
 */
function twoRigidTriangles() {
  return {
    id: 'skin',
    topology: 'triangles' as const,
    hierarchyId: 'rig',
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      10, 0, 0, 11, 0, 0, 10, 1, 0,
    ]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    boneIndices: new Uint32Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ]),
    boneWeights: new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ]),
  } as never
}

describe('baking a skin into rigid parts', () => {
  it('splits by the bone each vertex follows and places each part by its bind matrix', () => {
    const result = bakeSkinToRigidParts(twoRigidTriangles(), {
      bindMatrices: [identity, movedAlongX],
    })
    assert.equal(result.parts.length, 2)
    const [first, second] = result.parts
    assert.equal(first?.boneSlot, 0)
    assert.equal(second?.boneSlot, 1)
    // Bone 1's part is expressed in bone 1's own frame, so its ten-unit offset is in the
    // transform rather than in every vertex — which is exactly what a rigid target re-applies.
    assert.deepEqual([...(second?.positions ?? [])].slice(0, 3), [0, 0, 0])
    assert.deepEqual([...(second?.transform ?? [])], movedAlongX)
    assert.deepEqual([...(first?.positions ?? [])].slice(0, 3), [0, 0, 0])
    // Attributes travel with their vertices.
    assert.equal(second?.textureCoordinates?.length, 6)
    assert.equal(second?.normals?.length, 9)
  })

  it('keeps the vertices in the model frame when the caller asks for it', () => {
    const result = bakeSkinToRigidParts(twoRigidTriangles(), {
      bindMatrices: [identity, movedAlongX],
      space: 'model',
    })
    const second = result.parts.find(part => part.boneSlot === 1)
    assert.deepEqual([...(second?.positions ?? [])].slice(0, 3), [10, 0, 0])
  })

  it('reports what the bake cost rather than implying a clean conversion', () => {
    const rigid = bakeSkinToRigidParts(twoRigidTriangles(), {
      bindMatrices: [identity, movedAlongX],
    })
    // A skin that was already rigid loses nothing, and says so.
    assert.equal(rigid.blendedVertices, 0)
    assert.equal(rigid.maxDroppedWeight, 0)

    const blended = twoRigidTriangles() as unknown as {
      boneIndices: Uint32Array
      boneWeights: Float32Array
    }
    // One vertex genuinely shared: 60 % bone 0, 40 % bone 1.
    blended.boneIndices[0] = 0
    blended.boneIndices[1] = 1
    blended.boneWeights[0] = 0.6
    blended.boneWeights[1] = 0.4
    const result = bakeSkinToRigidParts(blended as never, {
      bindMatrices: [identity, movedAlongX],
    })
    assert.equal(result.blendedVertices, 1)
    assert.ok(Math.abs(result.maxDroppedWeight - 0.4) < 1e-6)
  })

  it('refuses a bind matrix it cannot invert instead of placing the part wrongly', () => {
    const flattened = [...identity]
    flattened[0] = 0
    flattened[5] = 0
    flattened[10] = 0
    assert.throws(
      () =>
        bakeSkinToRigidParts(twoRigidTriangles(), {
          bindMatrices: [flattened, movedAlongX],
        }),
      /no inverse/u,
    )
  })

  it('refuses a primitive that carries no skin at all', () => {
    const rigid = twoRigidTriangles() as unknown as Record<string, unknown>
    delete rigid['boneWeights']
    assert.throws(() => bakeSkinToRigidParts(rigid as never, { bindMatrices: [identity] }), /four indices and weights/u)
  })
})
