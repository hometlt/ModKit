import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  worldShadowRangeEye,
} from '../src/world/webgl.js'

// A 101×101 flat grid (100 units across) under SC2's game camera range: ShadowClip 75 at 27.8°.
const terrain = Array.from({ length: 101 * 101 }, (_, index) => ({
  facet: 'terrain',
  id: `t:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 101,
  y: Math.floor(index / 101),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 101, y: 0, z: -Math.floor(index / 101) },
}))
const lighting = {
  facet: 'lighting',
  id: 'lighting',
  layerId: 'lighting',
  coordinateSpaceId: 'uvw-canonical',
  ambientColor: [0.6, 0.5, 0.35],
  ambientIntensity: 1,
  directional: [{ id: 'key', direction: [0.37, -0.72, 0.59], color: [1, 1, 1], intensity: 1 }],
  shadowRange: { distance: 75, fieldOfViewDegrees: 27.8 },
}
const plan = createWorldWebGlPlan({ items: [...terrain, lighting] })

it('carries the lighting shadow range into the plan', () => {
  assert.deepEqual(plan.light.shadowRange, { distance: 75, fieldOfViewDegrees: 27.8 })
  assert.equal(worldShadowRangeEye(createWorldWebGlPlan({ items: terrain }), 800, 800), undefined)
})

it('places the eye that frames the view with the game field of view', () => {
  const camera = { ...DEFAULT_WORLD_WEBGL_CAMERA, elevation: 1.5, zoom: 8 }
  const range = worldShadowRangeEye(plan, 800, 800, camera)
  assert.ok(range)
  assert.equal(range.distance, 75)
  // The eye looks at the view centre from half the visible height / tan(13.9°) away, from above.
  const visibleRadius = (Math.hypot(100, 0, 100) * 0.65) / 8
  const distance = visibleRadius / Math.tan((27.8 * Math.PI) / 360)
  assert.ok(Math.abs(Math.hypot(range.eye[0] - 50, range.eye[1], range.eye[2] + 50) - distance) < 0.05)
  assert.ok(Math.abs(range.eye[1] - distance * Math.sin(1.5)) < 0.05)
})

it('draws no shadow map when the whole view lies past the range, as the editor map view shows none', () => {
  const overview = worldShadowRangeEye(plan, 800, 800, { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 1 })
  assert.equal(overview.reachable, false)
  const close = worldShadowRangeEye(plan, 800, 800, { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 12 })
  assert.equal(close.reachable, true)
})
