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

it('keeps independent opacity for fallback instances and preserves it when selected', () => {
  const resource = model('shared', 0, { baseColorFactor: [1, 1, 1, 1], unlit: true })
  const first = { ...item(1, 'shared'), presentationOpacity: 0.1 }
  const second = { ...item(2, 'shared'), presentationOpacity: 0.2 }
  const plan = createWorldWebGlPlan({ items: [first, second], models: new Map([['shared', resource]]), selectedObjectId: 1 })
  const colors = createWorldWebGlTransparentDrawPlan(plan).flatMap(draw => Array.from({ length: draw.batch.colors.length / 4 }, (_, index) => [...draw.batch.colors.subarray(index * 4, index * 4 + 4)]))
  assert.ok(colors.some(color => Math.abs(color[3] - 0.1) < 1e-6))
  assert.ok(colors.some(color => Math.abs(color[3] - 0.2) < 1e-6))
  assert.ok(colors.some(color => Math.abs(color[1] - 0.82) < 1e-6 && Math.abs(color[3] - 0.1) < 1e-6))
  assert.equal(resource.primitives[0].tint, undefined)
  for (const presentationOpacity of [-1, 2, NaN])
    assert.throws(() => createWorldWebGlPlan({ items: [{ ...first, presentationOpacity }], models: new Map([['shared', resource]]) }), /presentationOpacity/)
})

it('passes instance opacity to the shared material primitives and restores default coverage on seek', () => {
  const resource = model('shared', 0, { baseColorFactor: [1, 0, 0, 1] })
  const input = { items: [{ ...item(1, 'shared'), presentationOpacity: 0.2 }], models: new Map([['shared', resource]]) }
  const plan = createWorldWebGlPlan(input)
  const primitives = plan.modelMaterialScenes.flatMap(scene => scene.primitives)
  assert.ok(primitives.some(primitive => Math.abs(primitive.tint[3] - 0.2) < 1e-6))
  const restored = createWorldWebGlPlan({ ...input, items: [item(1, 'shared')] })
  assert.ok(restored.modelMaterialScenes.flatMap(scene => scene.primitives).every(primitive => primitive.tint === undefined || primitive.tint[3] === 1))
})

it('fades surviving fallback cutout pixels without turning the fade into an alpha rejection', () => {
  const resource = model('cutout', 0, { alphaMode: 'mask', alphaCutoff: 0.5, unlit: true })
  for (const opacity of [0, 0.2, 1]) {
    const plan = createWorldWebGlPlan({ items: [{ ...item(1, 'cutout'), presentationOpacity: opacity }], models: new Map([['cutout', resource]]) })
    const batches = opacity === 1 ? plan.texturedTriangles : createWorldWebGlTransparentDrawPlan(plan).map(draw => draw.batch)
    assert.ok(batches.length > 0)
    assert.ok(batches.every(batch => Math.abs(batch.alphaCutoff - 0.5 * opacity) < 1e-6))
    assert.ok(batches.every(batch => Math.abs(batch.colors[3] - opacity) < 1e-6))
  }
})
