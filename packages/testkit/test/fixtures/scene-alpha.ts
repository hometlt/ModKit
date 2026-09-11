import type {
  SceneRenderRequest,
  SceneRendererMaterial,
  SceneRendererPrimitive,
} from '@modkit/sdk/renderer'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const quad = (id: string, z: number): SceneRendererPrimitive => ({
  id,
  materialId: id,
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  textureCoordinates: new Float32Array(8),
})
export interface AlphaCase {
  readonly name: string
  readonly request: SceneRenderRequest
  readonly pixel: readonly number[]
}

/** Full-viewport quads make every pixel, including triangle seams, an independently specified oracle. */
export function alphaCases(): readonly AlphaCase[] {
  const result: AlphaCase[] = []
  const add = (
    name: string,
    materials: SceneRendererMaterial[],
    primitives: SceneRendererPrimitive[],
    pixel: readonly number[],
    textured = false,
  ) => {
    result.push({
      name,
      pixel,
      request: {
        outputKind: 'rgba8',
        viewport: { width: 8, height: 8 },
        camera: { viewProjection: identity.slice() },
        scene: {
          materials,
          primitives,
          ...(textured
            ? {
                textures: [
                  { id: 'tex', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 128) },
                ],
              }
            : {}),
        },
      },
    })
  }
  add(
    'opaque ignores factor and texture alpha',
    [{ id: 'red', baseColor: [1, 0, 0, 0], baseColorTexture: 'tex' }],
    [quad('red', 0)],
    [255, 0, 0, 255],
    true,
  )
  for (const reverse of [false, true]) {
    const primitives = [quad('red', -0.5), quad('blue', 0.5)]
    if (reverse) primitives.reverse()
    add(
      `mask depth hole, reversed=${reverse}`,
      [
        { id: 'red', baseColor: [1, 0, 0, 0.25], alphaMode: 'mask', alphaCutoff: 0.5 },
        { id: 'blue', baseColor: [0, 0, 1, 1] },
      ],
      primitives,
      [0, 0, 255, 255],
    )
  }
  add(
    'mask threshold equality',
    [{ id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'mask', alphaCutoff: 0.5 }],
    [quad('red', 0)],
    [255, 0, 0, 255],
  )
  add(
    'mask includes texel alpha',
    [
      {
        id: 'red',
        baseColor: [1, 0, 0, 0.5],
        alphaMode: 'mask',
        alphaCutoff: 0.3,
        baseColorTexture: 'tex',
      },
    ],
    [quad('red', 0)],
    [0, 0, 0, 0],
    true,
  )
  for (const cutoff of [2, 1 + Number.EPSILON])
    add(
      `mask threshold above one: ${cutoff}`,
      [{ id: 'red', baseColor: [1, 0, 0, 1], alphaMode: 'mask', alphaCutoff: cutoff }],
      [quad('red', 0)],
      [0, 0, 0, 0],
    )
  add(
    'mask fractional texture threshold equality',
    [
      {
        id: 'red',
        baseColor: [1, 0, 0, 1],
        baseColorTexture: 'tex',
        alphaMode: 'mask',
        alphaCutoff: 128 / 255,
      },
    ],
    [quad('red', 0)],
    [255, 0, 0, 255],
    true,
  )
  add(
    'blend includes texel alpha',
    [{ id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'blend', baseColorTexture: 'tex' }],
    [quad('red', 0)],
    [255, 0, 0, 64],
    true,
  )
  for (const reverse of [false, true])
    for (const winding of [false, true]) {
      let primitives = [quad('red', -0.5), quad('blue', 0.5)]
      if (reverse) primitives.reverse()
      if (winding)
        primitives = primitives.map(p => ({ ...p, indices: Uint32Array.of(2, 1, 0, 3, 2, 0) }))
      add(
        `layered blend, reversed=${reverse}, winding=${winding}`,
        [
          { id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'blend' },
          { id: 'blue', baseColor: [0, 0, 1, 0.5], alphaMode: 'blend' },
        ],
        primitives,
        [170, 0, 85, 192],
      )
    }
  add(
    'solid depth occludes blend',
    [
      { id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'blend' },
      { id: 'blue', baseColor: [0, 0, 1, 1] },
    ],
    [quad('red', 0.5), quad('blue', -0.5)],
    [0, 0, 255, 255],
  )
  return result
}
