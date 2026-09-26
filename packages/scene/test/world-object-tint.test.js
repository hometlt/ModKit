import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

it('draws a placed model with its authored tint, and the selection highlight on top of it', () => {
  const texture = { id: 'umbrella.dds', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
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
  const model = {
    state: 'converted',
    sourceKey: 'umbrella',
    complete: true,
    diagnostics: [],
    meshes: [],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        materialId: 'surface',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        indices: Uint16Array.from([0, 1, 2]),
        textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
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
    kind: 'doodad',
    objectId,
    position: { x: objectId * 5, y: 0, z: 0 },
    uvwPosition: { x: objectId * 5, y: 0, z: 0 },
    resourceId: 'model',
    ...extra,
  })
  const tint = [139 / 255, 177 / 255, 241 / 255]
  const tints = selectedObjectId =>
    createWorldWebGlPlan({
      items: [item(1, { presentationTint: tint }), item(2)],
      models: new Map([['model', model]]),
      ...(selectedObjectId === undefined ? {} : { selectedObjectId }),
    }).modelMaterialScenes.flatMap(scene => scene.primitives.map(primitive => primitive.tint))
  assert.deepEqual(tints(undefined), [[...tint, 1], undefined])
  // Selecting the tinted object keeps its tint under the highlight; selecting the other adds only it.
  assert.deepEqual(tints(1), [[tint[0], tint[1] * 0.82, tint[2] * 0.12, 1], undefined])
  assert.deepEqual(tints(2), [[...tint, 1], [1, 0.82, 0.12, 1]])
})
