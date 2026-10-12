import { expect, it } from 'vitest'
import { renderHeadless } from '../src/render/headless.js'
import type { SceneRendererTexture } from '@modkit/sdk/renderer'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255)

// Constant UVs isolate texture sampling from camera interpolation and triangle coverage.
async function sample(u: number, v: number, settings: Partial<SceneRendererTexture> = {}) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 2, height: 2 },
    camera: { viewProjection: identity },
    scene: {
      textures: [{ id: 'texture', width: 2, height: 2, rgba, ...settings }],
      materials: [{ id: 'material', baseColor: [1, 1, 1, 1], baseColorTexture: 'texture' }],
      primitives: [
        {
          id: 'quad',
          topology: 'triangles',
          materialId: 'material',
          positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
          textureCoordinates: Float32Array.from([u, v, u, v, u, v, u, v]),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        },
      ],
    },
  })
  return Array.from(frame.rgba.slice(0, 4))
}

it.each([undefined, 'linear'] as const)(
  'bilinearly filters the base route with %s filter',
  async filter => {
    expect(await sample(0.5, 0.5, filter === undefined ? {} : { filter })).toEqual([128, 128, 128, 255])
  },
)

it('retains explicit nearest sampling', async () => {
  expect(await sample(0.5, 0.5, { filter: 'nearest' })).toEqual([255, 255, 255, 255])
})

it('filters across repeat seams and clamps edge texels', async () => {
  expect(await sample(0, 0)).toEqual([128, 128, 128, 255])
  expect(await sample(0, 0, { wrapU: 'clamp', wrapV: 'clamp' })).toEqual([255, 0, 0, 255])
  expect(await sample(-0.25, 0.25)).toEqual([0, 255, 0, 255])
  expect(await sample(-0.25, 0.25, { wrapU: 'clamp' })).toEqual([255, 0, 0, 255])
})

it('retains the first-texel fallback for nonfinite base-route UVs', async () => {
  expect(await sample(Number.NaN, 0.25)).toEqual([255, 0, 0, 255])
  expect(await sample(0.25, Number.POSITIVE_INFINITY)).toEqual([255, 0, 0, 255])
})

it('bilinearly samples compressed storage after decoding', async () => {
  expect(
    await sample(0.5, 0.5, {
      width: 4,
      height: 4,
      rgba: new Uint8Array(0),
      compressed: {
        schemaVersion: 1,
        format: 'bc1-rgba-unorm',
        dimensions: { width: 4, height: 4, depth: 1 },
        mipLevelCount: 1,
        layerCount: 1,
        faceCount: 1,
        colorSpace: 'unknown',
        alphaMode: 'unknown',
        block: { width: 4, height: 4, depth: 1, bytes: 8 },
        subresources: [
          {
            mipLevel: 0,
            layer: 0,
            face: 0,
            depthSlice: 0,
            width: 4,
            height: 4,
            depth: 1,
            data: Uint8Array.of(0, 248, 31, 0, 80, 80, 80, 80),
          },
        ],
        source: { codecId: 'dds', containerFormat: 'dds', preservation: 'source-bytes' },
      },
    }),
  ).toEqual([128, 0, 128, 255])
})
