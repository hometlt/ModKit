import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

it('draws the vertices at or below an object origin lower by its foundation stretch, in world units', () => {
  const texture = { id: 'bunker.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
  const diffuse = {
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
  }
  const material = {
    id: 'surface',
    layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
    shader: {
      id: 'modkit.render-material.v1',
      parameters: {
        renderModel: {
          version: 1,
          standard: {
            layers: { diffuse },
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
    },
  }
  // a wall: its foot on the origin, its top one unit up
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
  const model = {
    state: 'converted',
    sourceKey: 'bunker',
    complete: true,
    diagnostics: [],
    meshes: [],
    primitives: [
      {
        id: 'wall',
        topology: 'triangles',
        materialId: 'surface',
        positions,
        indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
        textureCoordinates: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
      },
    ],
    materials: [material],
    textures: [texture],
  }
  const item = (objectId, extra) => ({
    facet: 'objects',
    id: `object-${objectId}`,
    layerId: 'objects',
    coordinateSpaceId: 'uvw',
    kind: 'structure',
    objectId,
    position: { x: objectId * 5, y: 0, z: 0 },
    uvwPosition: { x: objectId * 5, y: 0, z: 0 },
    uvwScale: { x: 2, y: 2, z: 2 },
    resourceId: 'model',
    ...extra,
  })
  const drawn = createWorldWebGlPlan({
    items: [item(1, { presentationFoundationStretch: 3 }), item(2)],
    models: new Map([['model', model]]),
  }).modelMaterialScenes.flatMap(scene => scene.primitives.map(primitive => primitive.positions))
  // twice the size: 3 world units down is 1.5 of the model's
  assert.deepEqual([...drawn[0]], [0, -1.5, 0, 1, -1.5, 0, 1, 1, 0, 0, 1, 0])
  // without a stretch the model's own vertices draw
  assert.equal(drawn[1], positions)
})
