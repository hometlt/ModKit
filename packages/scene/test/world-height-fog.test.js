import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  worldFogEye,
  worldShadowRangeEye,
} from '../src/world/webgl.js'

// A 21×21 flat grid under Highland's white fog (its CTerrain MarSara override).
const terrain = Array.from({ length: 21 * 21 }, (_, index) => ({
  facet: 'terrain',
  id: `t:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 21,
  y: Math.floor(index / 21),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 21, y: 0, z: -Math.floor(index / 21) },
}))
const fog = { color: [1, 1, 1], density: 0.05, falloff: 0.3, startingHeight: 3.4 }
const lighting = {
  facet: 'lighting',
  id: 'lighting',
  layerId: 'lighting',
  coordinateSpaceId: 'uvw-canonical',
  ambientColor: [0.52, 0.47, 0.4],
  ambientIntensity: 1,
  directional: [{ id: 'key', direction: [0.72, -0.68, 0.12], color: [1, 1, 1], intensity: 1 }],
  fog,
}

it('carries the lighting height fog into the plan', () => {
  assert.deepEqual(createWorldWebGlPlan({ items: [...terrain, lighting] }).light.fog, fog)
  assert.equal(createWorldWebGlPlan({ items: terrain }).light.fog, undefined)
})

it('integrates the fog from the game eye that frames the view, else from the view camera', () => {
  const camera = { ...DEFAULT_WORLD_WEBGL_CAMERA, elevation: 1.2, zoom: 4 }
  const ranged = createWorldWebGlPlan({
    items: [...terrain, { ...lighting, shadowRange: { distance: 75, fieldOfViewDegrees: 27.8 } }],
  })
  assert.deepEqual(worldFogEye(ranged, 800, 600, camera), worldShadowRangeEye(ranged, 800, 600, camera).eye)
  const plain = createWorldWebGlPlan({ items: [...terrain, lighting] })
  const eye = worldFogEye(plain, 800, 600, camera)
  // The orthographic view camera stands above the grid, looking down at its elevation.
  assert.ok(eye[1] > 0)
  assert.ok(eye.every(Number.isFinite))
})
