import assert from 'node:assert/strict'
import { it } from 'node:test'
import { generateUvmVertexTangents } from '../src/uvm/normals.js'

// A quad in the XY plane facing +Z, its U along +X and V along +Y: every tangent is +X, right-handed.
it('gives each vertex its UV tangent, orthogonal to its normal, with handedness', () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)
  const normals = Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)
  const uv = Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1)
  const tangents = generateUvmVertexTangents(positions, normals, uv, Uint32Array.of(0, 1, 2, 0, 2, 3))
  assert.deepEqual([...tangents], [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])
  // V mirrored: the bitangent flips, so does w
  const mirrored = generateUvmVertexTangents(positions, normals, Float32Array.of(0, 1, 1, 1, 1, 0, 0, 0), Uint32Array.of(0, 1, 2, 0, 2, 3))
  assert.deepEqual([...mirrored].filter((_, index) => index % 4 === 3), [-1, -1, -1, -1])
  assert.throws(() => generateUvmVertexTangents(positions, normals, uv, Uint32Array.of(0, 1, 9)), /outside/)
})
