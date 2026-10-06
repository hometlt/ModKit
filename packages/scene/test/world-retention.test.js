import assert from 'node:assert/strict'
import { it } from 'node:test'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A forced collection, to see what a past plan still holds alive.
setFlagsFromString('--expose-gc')
const collect = runInNewContext('gc')

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const unit = (objectId, x) => ({
  facet: 'objects',
  id: `unit ${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'unit',
  objectId,
  resourceId: 'unit',
  position: { x, y: 0, z: 0 },
  uvwPosition: { x, y: 0, z: 0 },
})
const model = {
  state: 'converted',
  sourceKey: 'unit',
  complete: true,
  diagnostics: [],
  nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  primitives: [
    { id: 'triangle', topology: 'triangles', positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1) },
  ],
}
const terrain = Array.from({ length: 9 }, (_, index) => ({
  facet: 'terrain',
  id: `ground:${index}`,
  layerId: 'ground',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 3,
  y: Math.floor(index / 3),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 3, y: 0, z: -Math.floor(index / 3) },
}))

it('keeps no past frame alive through an object that left the list while its caller holds it', async () => {
  const models = new Map([['unit', model]])
  const staying = unit(1, 0)
  // a unit that walks out of view: the caller keeps it for when it comes back
  const leaving = unit(2, 2)
  let plan = createWorldWebGlPlan({ items: [...terrain, staying, leaving], models })
  // Lines of a plan without dynamic lines are its terrain preparation's own: alive while it is.
  const pastPreparation = new WeakRef(plan.lines)
  // new ground items: a new preparation
  const ground = terrain.map(item => ({ ...item }))
  plan = createWorldWebGlPlan({ items: [...ground, staying], models }, plan)
  assert.notEqual(plan.lines, pastPreparation.deref())
  await new Promise(resolve => setImmediate(resolve))
  collect()
  assert.equal(pastPreparation.deref(), undefined)
  // and the unit, back in view, is drawn as before
  plan = createWorldWebGlPlan({ items: [...ground, staying, leaving], models }, plan)
  assert.deepEqual(
    plan.picking.objects.map(object => object.objectId).sort(),
    [1, 2],
  )
})

