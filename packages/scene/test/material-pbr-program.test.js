import assert from 'node:assert/strict'
import { it } from 'node:test'
import { shadePbr } from '@modkit/codec-kit/model-math/pbr'
import { renderHeadless } from '../src/render/headless.js'
import { createRenderMaterialSampler } from '../src/materials/render-model.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const layer = (slot, value) => ({
  slot,
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
const parameters = (extra = {}) => ({
  renderModel: {
    version: 1,
    standard: {
      // BAR's tex2: metalness in green, roughness in blue, picked by the layers' channels
      layers: {
        diffuse: layer('diffuse', [0.8, 0.6, 0.2, 1]),
        metalness: { ...layer('metalness', [0.1, 0.9, 0.3, 1]), channels: 4 },
        roughness: { ...layer('roughness', [0.1, 0.9, 0.3, 1]), channels: 5 },
      },
      blendMode: 0,
      priority: 0,
      specularity: 10,
      specMult: 1,
      emisMult: 1,
      specMode: 0,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: false,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
      lightingModel: 'pbr-metallic-roughness',
      roughnessFactor: 0.5,
      ...extra,
    },
  },
})

async function centre(extra) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [
        {
          id: 'm',
          baseColor: [1, 0, 1, 1],
          shader: { id: 'modkit.render-material.v1', parameters: parameters(extra) },
        },
      ],
      primitives: [
        {
          id: 'quad',
          materialId: 'm',
          topology: 'triangles',
          positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
          normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        },
      ],
      // off the mirror direction, so the highlight does not saturate the pixel
      light: { direction: [0, 0.6, 0.8], color: [1, 1, 1, 1] },
    },
  })
  return {
    pixel: [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)],
    codes: frame.diagnostics.map(item => item.code),
  }
}

it('draws a program material by the glTF BRDF when its lighting model says pbr', async () => {
  const { pixel, codes } = await centre()
  const expected = shadePbr(
    { baseColor: [0.8, 0.6, 0.2], metallic: 0.9, roughness: 0.15 },
    [0, 0, 1],
    [0, 0, 1],
    { direction: [0, 0.6, 0.8], color: [0.75, 0.75, 0.75] },
    [0.25, 0.25, 0.25],
  ).map(value => Math.round(Math.min(1, value) * 255))
  pixel.slice(0, 3).forEach((value, channel) => assert.ok(Math.abs(value - expected[channel]) <= 1))
  assert.equal(pixel[3], 255)
  assert.deepEqual(codes, [])
})

it('validates the pbr fields of a program before drawing it', () => {
  for (const extra of [
    { lightingModel: 'phong' },
    { metallicFactor: 2 },
    { colorPipeline: 'linear-srgb', lightingModel: 'm3' },
    { tonemap: [4.75, 0.75, 3.5, 0.85, 1] },
    { colorPipeline: 'linear-srgb', tonemap: [4.75, 0.75, 3.5, 0.85, 0] },
  ])
    assert.throws(() => createRenderMaterialSampler(parameters(extra), budget), TypeError)
  assert.equal(
    createRenderMaterialSampler(
      parameters({ colorPipeline: 'linear-srgb', tonemap: [4.75, 0.75, 3.5, 0.85, 1] }),
      budget,
    ).resources.length,
    0,
  )
})
