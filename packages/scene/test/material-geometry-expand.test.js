import assert from 'node:assert/strict'
import { it } from 'node:test'
import { prepareMaterialGeometry } from '../src/render/material-geometry.js'

it('expands UV sets that share coordinates into one array', () => {
  const uv = Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1)
  const other = Float32Array.of(0.5, 0.5, 1, 0.5, 1, 1, 0.5, 1)
  const prepared = prepareMaterialGeometry(
    {
      id: 'sprite',
      topology: 'triangles',
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0),
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
      textureCoordinates: uv,
      textureCoordinateSets: [
        { set: 1, coordinates: uv },
        { set: 2, coordinates: other },
        { set: 3, coordinates: uv },
      ],
    },
    1 << 20,
  )
  const [one, two, three] = prepared.textureCoordinateSets.map(set => set.coordinates)
  assert.equal(one, prepared.textureCoordinates)
  assert.equal(three, prepared.textureCoordinates)
  assert.notEqual(two, prepared.textureCoordinates)
  assert.deepEqual([...prepared.textureCoordinates], [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
  assert.deepEqual([...two], [0.5, 0.5, 1, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 1])
})

it('checks an array once, and a kept index array against each vertex count', () => {
  const triangle = {
    id: 'triangle',
    topology: 'triangles',
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    indices: Uint32Array.of(0, 1, 2),
    normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
    tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
    textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  }
  assert.equal(prepareMaterialGeometry(triangle, 1 << 20), triangle)
  // The same indices name vertex 2, which two vertices do not have.
  assert.throws(
    () =>
      prepareMaterialGeometry(
        { ...triangle, positions: Float32Array.of(0, 0, 0, 1, 0, 0) },
        1 << 20,
      ),
    /out of range/,
  )
  // An array found not finite is not taken as checked.
  const broken = Float32Array.of(0, 0, Number.NaN, 0, 0, 1)
  for (let round = 0; round < 2; round++)
    assert.throws(
      () =>
        prepareMaterialGeometry(
          {
            ...triangle,
            positions: Float32Array.from(triangle.positions),
            textureCoordinates: broken,
          },
          1 << 20,
        ),
      /vertex attributes/,
    )
})
