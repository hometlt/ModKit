import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'

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
