/** Shared CPU/GPU regression scene: a buried road, two overlapping road faces, and ordinary models. */
import type { WorldSceneModelResult, WorldSceneObjectItem } from '@modkit/sdk/maps'
import type { WorldWebGlInput } from '../src/world/webgl.js'

export function overlayFixture(
  options: { overlay?: boolean; building?: number; reverse?: boolean; mask?: boolean } = {},
): WorldWebGlInput {
  const model = (
    id: string,
    height: number,
    color: number[],
    overlay: boolean,
  ): WorldSceneModelResult => ({
    state: 'converted',
    sourceKey: id,
    diagnostics: [],
    complete: true,
    meshes: [],
    primitives: [
      {
        id,
        topology: 'triangles',
        materialId: id,
        positions: Float32Array.of(
          0,
          height,
          0,
          1,
          height,
          0,
          1,
          height,
          1,
          0,
          height,
          0,
          1,
          height,
          1,
          0,
          height,
          1,
        ),
        normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0),
      },
    ],
    materials: [
      {
        id,
        shader: {
          id: 'modkit.render-material.v1',
          parameters: {
            renderModel: {
              version: 1,
              ...(overlay ? { presentation: 'terrain-overlay' } : {}),
              standard: {
                layers: {
                  diffuse: {
                    slot: 'diffuse',
                    texturePath: null,
                    constantColor: { value: [...color, options.mask ? 0 : 1] },
                    uvSource: 0,
                    channels: 0,
                    op: 2,
                    teamColorMode: 1,
                    invert: false,
                    clampResult: true,
                    wrapX: true,
                    wrapY: true,
                  },
                },
                blendMode: options.mask ? 1 : 0,
                priority: 0,
                specularity: 0,
                specMult: 0,
                emisMult: 1,
                specMode: 0,
                alphaTestThreshold: 0.5,
                twoSided: true,
                unshaded: true,
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
  })
  const ids = options.reverse ? ['back', 'road'] : ['road', 'back']
  const objects = ids.map((id, i): WorldSceneObjectItem => ({
    facet: 'objects',
    id,
    layerId: 'objects',
    coordinateSpaceId: 'map-native',
    kind: 'doodad',
    objectId: i + 1,
    position: { x: 0, y: 0, z: 0 },
    resourceId: id,
  }))
  const models = new Map([
    ['road', model('road', 0, [1, 0, 0], options.overlay !== false)],
    ['back', model('back', -0.2, [0, 0, 1], options.overlay !== false)],
  ])
  if (options.building !== undefined) {
    objects.push({ ...objects[0]!, id: 'building', objectId: 3, resourceId: 'building' })
    models.set('building', model('building', options.building, [0, 1, 0], false))
  }
  return {
    items: [
      ...Array.from({ length: 4 }, (_, i) => ({
        facet: 'terrain' as const,
        id: `t${i}`,
        layerId: 'terrain',
        coordinateSpaceId: 'height-grid',
        lod: 'exact' as const,
        x: i % 2,
        y: Math.floor(i / 2),
        heightBase: 1,
        heightAdjustment: 0,
        mask: 0,
        mapNativePosition: { x: i % 2, y: Math.floor(i / 2), z: 1 },
      })),
      ...objects,
    ],
    models,
  }
}
export const overlayCamera = {
  azimuth: Math.PI / 2,
  elevation: 1.5,
  zoom: 1,
  target: [0, 0, 0] as const,
  frame: { center: [0.5, 0.5, 0.5] as const, radius: 0.8 },
}
