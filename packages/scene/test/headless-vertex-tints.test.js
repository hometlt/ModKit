import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'

// Effect sprites (an emitter's particles, baked PopcornFX) are one primitive whose sprites carry
// their own tint per vertex (`vertexTints`). The WebGL program multiplies it in flat; the CPU
// renderer drew them untinted, so grey effect textures came out white.
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const layer = value => ({
  slot: 'diffuse',
  texturePath: null,
  constantColor: { value },
  uvSource: 0,
  channels: 0,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
})
// an unlit opaque program drawing a constant grey
const program = {
  id: 'modkit.render-material.v1',
  parameters: {
    renderModel: {
      version: 1,
      standard: {
        layers: { diffuse: layer([0.25, 0.25, 0.25, 1]) },
        blendMode: 0,
        priority: 0,
        specularity: 10,
        specMult: 1,
        emisMult: 1,
        specMode: 0,
        alphaTestThreshold: 0,
        twoSided: true,
        unshaded: true,
        doubleLambert: false,
        clampOutput: false,
        usesVertexColor: false,
        usesVertexAlpha: false,
      },
    },
  },
}
const tint = (...value) => [...value, ...value, ...value, ...value]

it('multiplies each sprite by its own vertex tint, HDR included', async () => {
  // Two sprites side by side: the left green at twice the texel, the right red.
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [{ id: 'sprites', baseColor: [1, 1, 1, 1], shader: program }],
      primitives: [
        {
          id: 'sprites',
          materialId: 'sprites',
          topology: 'triangles',
          positions: Float32Array.of(-1, -1, 0, 0, -1, 0, 0, 1, 0, -1, 1, 0, 0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
          vertexTints: Float32Array.of(...tint(0, 2, 0, 1), ...tint(1, 0, 0, 1)),
        },
      ],
      materialContext: { ambient: [0, 0, 0, 0] },
    },
  })
  const pixel = (x, y) => [...frame.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)]
  assert.deepEqual(pixel(2, 4), [0, 128, 0])
  assert.deepEqual(pixel(6, 4), [64, 0, 0])
})
