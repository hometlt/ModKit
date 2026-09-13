import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { renderHeadless } from '../src/render/headless.js'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

describe('headless scene renderer', () => {
  it('renders a neutral triangle without DOM or game-specific knowledge', async () => {
    const result = await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 16, height: 16 },
      camera: { viewProjection: identity },
      clearColor: [0, 0, 0, 0],
      scene: {
        materials: [{ id: 'material', baseColor: [1, 0.25, 0, 1] }],
        primitives: [
          {
            id: 'triangle',
            topology: 'triangles',
            materialId: 'material',
            positions: Float32Array.from([-0.75, -0.75, 0, 0, 0.75, 0, 0.75, -0.75, 0]),
          },
        ],
      },
    })

    assert.equal(result.width, 16)
    assert.equal(result.height, 16)
    assert.equal(result.rgba.byteLength, 16 * 16 * 4)
    assert.equal(result.statistics.primitives, 1)
    assert.equal(result.statistics.triangles, 1)
    assert.ok(result.statistics.fragments > 0)
  })

  it('modulates ordinary base-color materials with perspective-correct vertex RGBA', async () => {
    const result = await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 4, height: 4 },
      camera: { viewProjection: identity },
      clearColor: [0, 0, 0, 0],
      scene: {
        materials: [{ id: 'material', baseColor: [0.5, 0.5, 0.5, 0.5], alphaMode: 'blend' }],
        primitives: [
          {
            id: 'triangle',
            topology: 'triangles',
            materialId: 'material',
            positions: Float32Array.from([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
            colors: Float32Array.from([1, 0.5, 0.25, 0.5, 1, 0.5, 0.25, 0.5, 1, 0.5, 0.25, 0.5]),
          },
        ],
      },
    })

    assert.deepEqual([...result.rgba.subarray((2 * 4 + 1) * 4, (2 * 4 + 2) * 4)], [128, 64, 32, 64])
  })

  it('rejects malformed COLOR_0 before drawing an ordinary material', async () => {
    await assert.rejects(
      renderHeadless({
        outputKind: 'rgba8',
        viewport: { width: 4, height: 4 },
        camera: { viewProjection: identity },
        scene: {
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: Float32Array.from([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
              colors: Float32Array.of(1, 1, 1, 1),
            },
          ],
        },
      }),
      /RGBA/,
    )
  })
})
