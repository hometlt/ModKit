import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { materialMirrors, materialNormalMatrix } from '../src/render/material-geometry.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const mirrorX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const triangle = [-0.75, -0.75, 0.5, 0, 0.75, 0.5, 0.75, -0.75, 0.5]
const reversed = [...triangle.slice(6, 9), ...triangle.slice(3, 6), ...triangle.slice(0, 3)]

/** Whether a one-sided triangle with these corners and model matrix covers the centre pixel. */
async function covers(positions, transform) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 16, height: 16 },
    camera: { viewProjection: Float32Array.from(identity) },
    clearColor: [0, 0, 0, 1],
    scene: {
      materials: [
        {
          id: 'one-sided',
          baseColor: [0, 1, 0, 1],
          simpleEffect: {
            blend: 'opaque',
            depthTest: true,
            depthWrite: true,
            doubleSided: false,
            alphaCutoff: 0,
            wrapU: 'clamp',
            wrapV: 'clamp',
          },
        },
      ],
      primitives: [
        {
          id: 'triangle',
          materialId: 'one-sided',
          topology: 'triangles',
          positions: Float32Array.from(positions),
          transform: Float32Array.from(transform),
        },
      ],
    },
  })
  return frame.rgba[(8 * 16 + 8) * 4 + 1] > 0
}

test('a mirrored node keeps the faces its winding fronts and culls the others (glTF)', async () => {
  const front = await covers(triangle, identity)
  // exactly one winding is a front face
  assert.notEqual(front, await covers(reversed, identity))
  // a mirror turns the screen winding over, and the front faces with it
  assert.equal(await covers(triangle, mirrorX), front)
  assert.equal(await covers(reversed, mirrorX), !front)
})

test('materialMirrors is the sign of materialNormalMatrix, without making the matrix', () => {
  // A fixed sequence in [-2, 2), every seventh value tiny, so that determinants near zero come too.
  let seed = 1
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = 2 * (seed / 2 ** 31 - 1)
    return seed % 7 === 0 ? value * 1e-20 : value
  }
  const matrices = [
    identity,
    mirrorX,
    [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 5, 6, 7, 1], // two flips: a turn, not a mirror
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  ]
  for (let index = 0; index < 2000; index++) matrices.push(Array.from({ length: 16 }, next))
  let mirrored = 0
  for (const values of matrices) {
    const matrix = Float32Array.from(values)
    const expected = materialNormalMatrix(matrix).sign < 0
    assert.equal(materialMirrors(matrix), expected, values.join(', '))
    if (expected) mirrored++
  }
  assert.ok(mirrored > 100 && mirrored < matrices.length - 100)
  assert.throws(
    () =>
      materialMirrors(Float32Array.from(mirrorX, (value, index) => (index === 5 ? NaN : value))),
    /invalid material geometry component/,
  )
})
