import { expect, it } from 'vitest'
import { renderHeadless } from '../src/render/headless.js'
import type { SceneRendererScene } from '@modkit/sdk/renderer'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const scene: SceneRendererScene = {
  materialContext: { sceneLighting: true },
  textures: [{ id: 'white', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }],
  materials: [
    {
      id: 'surface',
      baseColor: [1, 1, 1, 1],
      textureBindings: [{ resourceId: 'white', textureId: 'white' }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: {
                diffuse: {
                  slot: 'diffuse',
                  texturePath: 'white',
                  channels: 0,
                  op: 2,
                  teamColorMode: 0,
                  uvSource: 0,
                  invert: false,
                  clampResult: true,
                  wrapX: true,
                  wrapY: true,
                },
              },
              blendMode: 0,
              priority: 0,
              specularity: 10,
              specMult: 0,
              emisMult: 1,
              specMode: 0,
              alphaTestThreshold: 0,
              twoSided: true,
              unshaded: false,
              doubleLambert: false,
              clampOutput: false,
              usesVertexColor: false,
              usesVertexAlpha: false,
            },
          },
        },
      },
    },
  ],
  primitives: [
    {
      id: 'quad',
      materialId: 'surface',
      topology: 'triangles',
      positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
      normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
    },
  ],
}
const draw = async (lighting: Partial<SceneRendererScene>) =>
  (
    await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 2, height: 2 },
      camera: { viewProjection: identity },
      scene: { ...scene, ...lighting },
    })
  ).rgba

it.each([{ direction: [0, 0, 1] }, { direction: [1, 0, 0] }, { direction: [0, 0, -1] }] as const)(
  'shares key direction and colours across legacy and modern rigs $direction',
  async ({ direction }) => {
    const legacy = { direction, ambient: 0.2, color: [0.3, 0.5, 0.7, 1] as const }
    const modern = {
      lights: [{ type: 'directional' as const, direction, color: [0.3, 0.5, 0.7] as const }],
      ambientLight: [0.2, 0.2, 0.2] as const,
    }
    expect(await draw(modern)).toEqual(await draw({ light: legacy }))
    expect(await draw({ ...modern, light: legacy })).toEqual(await draw({ light: legacy }))
  },
)

it('keeps ambient-only rigs lit without inventing a directional light', async () => {
  const pixels = await draw({ lights: [], ambientLight: [0.2, 0.4, 0.6] })
  expect(Array.from(pixels.slice(0, 4))).toEqual([51, 102, 153, 255])
})
