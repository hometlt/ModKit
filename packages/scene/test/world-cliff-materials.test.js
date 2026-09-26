import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialIsSolid } from '../src/render/material-draws.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = { id: 'rock.dds', width: 1, height: 1, rgba: Uint8Array.of(90, 90, 100, 160) }
const rock = {
  id: 'rock',
  layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: {
              slot: 'diffuse',
              texturePath: texture.id,
              constantColor: { value: [1, 1, 1, 1] },
              uvSource: 0,
              channels: 0,
              op: 6,
              teamColorMode: 0,
              invert: false,
              clampResult: true,
              wrapX: true,
              wrapY: true,
              uvTiling: { value: [2, 2] },
            },
          },
          // An SC2 cliff material blends: its alpha is the terrain blend mask.
          blendMode: 1,
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
        },
      },
    },
  },
}
const piece = {
  state: 'converted',
  sourceKey: 'cliff',
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'face',
      topology: 'triangles',
      materialId: 'rock',
      positions: Float32Array.of(0, 0, 0, 1, 1, 0, 0, 1, 0),
      indices: Uint32Array.of(0, 1, 2),
      textureCoordinates: Float32Array.of(0, 0, 1, 1, 0, 1),
    },
  ],
  materials: [rock],
  textures: [texture],
}

it('draws a cliff piece through its material program, alpha-tested, not the plain textured path', () => {
  const terrain = Array.from({ length: 6 }, (_, i) => ({
    facet: 'terrain',
    id: `t:${i}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: 0,
    heightAdjustment: i % 3,
    mask: 0,
    uvwPosition: { x: i % 3, y: i % 3, z: -Math.floor(i / 3) },
  }))
  const plan = createWorldWebGlPlan({
    items: [
      ...terrain,
      {
        facet: 'objects',
        id: 'cliff:0',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'doodad',
        objectId: 1,
        derivedFrom: 'cliffs',
        resourceId: 'cliff',
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 0, y: 0, z: 0 },
        uvwRotation: [0, 0, 0, 1],
      },
    ],
    models: new Map([['cliff', piece]]),
  })
  // The program path keeps the material's own UV transform and face culling; the textured
  // fallback reads the atlas by raw UV and draws back faces.
  assert.equal(plan.modelMaterialScenes.length, 1)
  const [scene] = plan.modelMaterialScenes
  assert.deepEqual(
    scene.primitives.map(primitive => primitive.id),
    ['face'],
  )
  const [pass] = scene.programs.get('rock').passes
  assert.equal(materialIsSolid(pass), true)
  assert.equal(pass.twoSided, false)
  void identity
})
