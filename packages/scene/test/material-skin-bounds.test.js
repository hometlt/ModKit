import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialSkinBounds, materialVertexDepths } from '../src/render/material-skin.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
/** Column-major: a turn about z by `angle`, then a move by x, y, z. */
const placement = (angle, x, y, z) =>
  Float32Array.of(
    Math.cos(angle),
    Math.sin(angle),
    0,
    0,
    -Math.sin(angle),
    Math.cos(angle),
    0,
    0,
    0,
    0,
    1,
    0,
    x,
    y,
    z,
    1,
  )
const apply = (matrix, [x, y, z]) =>
  [0, 1, 2, 3].map(
    row => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row],
  )

// A strip of four vertices: the first two moved by slot 0, the last by slot 1, the third by both.
const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0.5, 0, 3, 1, 0.25)
const joints = Uint8Array.of(0, 2, 2, 2, 0, 2, 2, 2, 0, 1, 2, 2, 1, 2, 2, 2)
const weights = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0, 1, 0, 0, 0)
const skinned = matrices => {
  let posed = 0
  const primitive = {
    id: 'strip',
    topology: 'triangle-strip',
    positions,
    skin: {
      joints,
      weights,
      palette: Float32Array.from([...matrices.flatMap(matrix => [...matrix]), ...identity]),
      deformed: () => {
        posed += 1
        throw new Error('skin posed on the CPU')
      },
    },
  }
  return { primitive, posed: () => posed }
}
/** Each vertex as the GPU poses it: its slots' matrices applied to it, weighted. */
const posedVertices = matrices => {
  const palette = [...matrices, identity]
  return Array.from({ length: 4 }, (_, vertex) => {
    const result = [0, 0, 0, 0]
    for (let influence = 0; influence < 4; influence++) {
      const weight = weights[vertex * 4 + influence]
      if (weight === 0) continue
      const moved = apply(
        palette[joints[vertex * 4 + influence]],
        positions.subarray(vertex * 3, vertex * 3 + 3),
      )
      for (let axis = 0; axis < 4; axis++) result[axis] += weight * moved[axis]
    }
    return result
  })
}

it("bounds a skin's pose without posing it, as its vertices' own bounds in the bind pose", () => {
  const rest = skinned([identity, identity])
  assert.deepEqual(materialSkinBounds(rest.primitive, rest.primitive.skin), {
    minimum: [0, 0, 0],
    maximum: [3, 1, 0.25],
  })
  const matrices = [placement(0.7, 1, -2, 0.5), placement(-1.2, -3, 0.25, 2)]
  const turned = skinned(matrices)
  const { minimum, maximum } = materialSkinBounds(turned.primitive, turned.primitive.skin)
  for (const vertex of posedVertices(matrices))
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(vertex[axis] >= minimum[axis] - 1e-9, `vertex ${vertex} within ${minimum}`)
      assert.ok(vertex[axis] <= maximum[axis] + 1e-9, `vertex ${vertex} within ${maximum}`)
    }
  // the same pose comes back from its palette
  assert.equal(
    materialSkinBounds(turned.primitive, turned.primitive.skin),
    materialSkinBounds(turned.primitive, turned.primitive.skin),
  )
  assert.equal(rest.posed() + turned.posed(), 0)
})

it("gives a skin's vertex depths as its pose stands, under a perspective view, without posing it", () => {
  const matrices = [placement(0.7, 1, -2, 0.5), placement(-1.2, -3, 0.25, 2)]
  const { primitive, posed } = skinned(matrices)
  // w = z + 4: a perspective view
  const view = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 1, 0, 0, 0.25, 4)
  const depths = materialVertexDepths(primitive, view)
  posedVertices(matrices).forEach((vertex, index) => {
    const [, , z, w] = apply(view, vertex)
    assert.ok(
      Math.abs(depths[index] - z / w) < 1e-12,
      `vertex ${index}: ${depths[index]} against ${z / w}`,
    )
  })
  assert.equal(posed(), 0)
  // a primitive without a skin reads its own positions
  const plain = materialVertexDepths({ ...primitive, skin: undefined }, view)
  assert.ok(Math.abs(plain[3] - (0.5 * 0.25 + 0.25) / (0.25 + 4)) < 1e-12)
})
