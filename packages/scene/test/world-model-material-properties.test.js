import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan, createWorldWebGlTransparentDrawPlan } from '../src/world/webgl.js'

const texture = { id: 'flash.dds', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
// one textured quad at height y; `material` holds the publisher's properties
const model = (key, y, material) => ({
  state: 'converted',
  sourceKey: key,
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'quad',
      topology: 'triangles',
      materialId: 'm',
      positions: Float32Array.of(0, y, 0, 1, y, 0, 0, y, -1, 1, y, 0, 1, y, -1, 0, y, -1),
      normals: Float32Array.from({ length: 18 }, (_, index) => (index % 3 === 1 ? 1 : 0)),
      textureCoordinates: Float32Array.from({ length: 12 }, () => 0),
      indices: Uint32Array.of(0, 1, 2, 3, 4, 5),
    },
  ],
  materials: [{ id: 'm', layers: [{ slot: 'diffuse', resourceId: texture.id }], ...material }],
  textures: [texture],
})
const item = (objectId, resourceId) => ({
  facet: 'objects',
  id: `effect:${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId,
  typeId: 'Effect',
  resourceId,
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  uvwRotation: [0, 0, 0, 1],
})

it('colours a fallback model by its baseColorFactor and draws an unlit one without light', () => {
  const plan = createWorldWebGlPlan({
    items: [item(1, 'flash')],
    models: new Map([
      ['flash', model('flash', 0, { baseColorFactor: [1, 0.25, 0, 1], unlit: true })],
    ]),
  })
  const [batch] = plan.texturedTriangles
  assert.equal(batch.unlit, true)
  assert.deepEqual([...batch.colors.subarray(0, 4)], [1, 0.25, 0, 1])
})

it('orders transparent fallback models by priority before depth', () => {
  // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
  const blend = { alphaMode: 'blend', unlit: true }
  const plan = createWorldWebGlPlan({
    items: [item(1, 'high'), item(2, 'low')],
    models: new Map([
      // the higher quad lies nearer a camera above, so depth alone draws it last
      ['high', model('high', 1, { ...blend, priority: 0 })],
      ['low', model('low', 0, { ...blend, priority: 3 })],
    ]),
  })
  const draws = createWorldWebGlTransparentDrawPlan(plan)
  assert.deepEqual(
    draws.map(draw => draw.batch.priority ?? 0),
    [0, 3],
  )
})
