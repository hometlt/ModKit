import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

it('draws an untextured primitive with its COLOR_0 times the object tint, not a stand-in hue', () => {
  const model = {
    state: 'converted',
    sourceKey: 'part',
    complete: true,
    diagnostics: [],
    meshes: [],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        indices: Uint16Array.from([0, 1, 2]),
        colors: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5]),
      },
    ],
    materials: [],
    textures: [],
  }
  const plan = createWorldWebGlPlan({
    items: [
      {
        facet: 'objects',
        id: 'object-1',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'doodad',
        objectId: 1,
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 0, y: 0, z: 0 },
        resourceId: 'model',
        presentationTint: [0.5, 1, 1],
      },
    ],
    models: new Map([['model', model]]),
  })
  const colors = [...plan.opaqueTriangles.colors].slice(-12)
  assert.deepEqual(colors, [0.5, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5])
})
