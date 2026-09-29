import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = { id: 'surface.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
// An opaque render-model material: its primitives take the shared (instanced) path.
const material = {
  id: 'surface',
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
            },
          },
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
// A model whose Stand clip lifts its root bone by `lift` over a second; without a material its
// triangle takes the fallback path, which writes the plan's shared batches.
const actor = (key, lift, withMaterial) => ({
  state: 'converted',
  sourceKey: key,
  complete: true,
  diagnostics: [],
  nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  skeleton: [
    {
      partId: 'triangle',
      boneIndex: 0,
      boneName: 'root',
      provenance: 'direct',
      hierarchyId: 'skin',
      parentBoneIndex: null,
      nodeId: 'root',
      localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      inverseBindMatrix: identity,
    },
  ],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      positions: Float32Array.of(-1, 0, -1, 1, 1, 0, 0, 0, 1),
      indices: Uint16Array.of(0, 1, 2),
      ...(withMaterial
        ? { materialId: 'surface', textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1) }
        : {}),
    },
  ],
  ...(withMaterial ? { materials: [material], textures: [texture] } : {}),
  animations:
    lift === 0
      ? []
      : [
          {
            id: 'stand',
            name: 'Stand',
            kind: 'animation',
            provenance: 'direct',
            frames: 2,
            durationSeconds: 1,
            looping: true,
            channels: [
              {
                target: 'root',
                kind: 'translation',
                firstFrame: 0,
                lastFrame: 1,
                interpolation: 'linear',
                samples: [
                  { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
                  { frame: 1, timeSeconds: 1, value: [0, lift, 0] },
                ],
              },
            ],
          },
        ],
})
const object = (objectId, resourceId, x) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId,
  position: { x, y: 0, z: 0 },
  uvwPosition: { x, y: 0, z: 0 },
  resourceId,
})
const world = (lift, timeSeconds) => ({
  items: [object(1, 'plain', 0), object(2, 'shaded', 4)],
  models: new Map([
    ['plain', actor('plain', lift, false)],
    ['shaded', actor('shaded', lift, true)],
  ]),
  timeSeconds,
})
const highest = pick => {
  let y = -Infinity
  for (let at = 1; at < pick.triangles.length; at += 3) y = Math.max(y, pick.triangles[at])
  for (const entry of pick.primitives) y = Math.max(y, entry.maximum[1])
  return y
}

it('frames a plan by the rest pose of objects whose geometry follows the clock', () => {
  // The same models without their clip: the pose every moving object holds at rest.
  const rest = createWorldWebGlPlan(world(0, 0)).bounds
  let plan
  for (const timeSeconds of [0, 0.25, 0.5, 0.75]) {
    plan = createWorldWebGlPlan(world(3, timeSeconds), plan)
    // The camera and the shadow map hold still while the models rise.
    assert.deepEqual(plan.bounds, rest)
    // Picking follows the clock: both objects are drawn and picked where they are now.
    for (const pick of plan.picking.objects)
      assert.ok(Math.abs(highest(pick) - (1 + 3 * timeSeconds)) < 1e-5, `${highest(pick)}`)
  }
})
