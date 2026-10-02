import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  createWorldWebGlCameraFrame,
  createWorldWebGlPlan,
  DEFAULT_WORLD_WEBGL_CAMERA,
  worldViewGroundWindow,
} from '../src/world/webgl.js'

// a flat ground of `size` x `size` cells from the origin
const ground = size =>
  Array.from({ length: (size + 1) ** 2 }, (_, index) => {
    const x = index % (size + 1)
    const y = Math.floor(index / (size + 1))
    return {
      facet: 'terrain',
      id: `terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: y },
    }
  })

it('measures a camera in its pinned frame, so a world that grows keeps the view (MW5)', () => {
  const small = createWorldWebGlPlan({ items: ground(4) })
  const large = createWorldWebGlPlan({ items: ground(16) })
  const camera = { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 2, target: [1, 0, -1] }
  // the plan's own frame is the default
  assert.deepEqual(
    createWorldWebGlCameraFrame(small, 64, 48, camera),
    createWorldWebGlCameraFrame(small, 64, 48, { ...camera, frame: small.stats.frame }),
  )
  // pinned, the larger world is seen from where the smaller one was
  const pinned = { ...camera, frame: small.stats.frame }
  assert.deepEqual(
    createWorldWebGlCameraFrame(large, 64, 48, pinned).viewProjection,
    createWorldWebGlCameraFrame(small, 64, 48, pinned).viewProjection,
  )
  assert.notDeepEqual(
    createWorldWebGlCameraFrame(large, 64, 48, camera).viewProjection,
    createWorldWebGlCameraFrame(small, 64, 48, camera).viewProjection,
  )
  assert.throws(() =>
    createWorldWebGlCameraFrame(small, 64, 48, { ...camera, frame: { center: [0, 0], radius: 1 } }),
  )
})

it('names the ground a camera shows, deeper the lower it looks', () => {
  const frame = { center: [0, 0, 0], radius: 10 }
  const above = worldViewGroundWindow(
    frame,
    { azimuth: 0, elevation: Math.PI / 2 - 0.04, zoom: 1, target: [0, 0, 0] },
    1,
  )
  // straight down: the square the view frames, ten each way
  for (const value of [above.minimumX, above.minimumZ]) assert.ok(value < -9.9 && value > -10.5)
  for (const value of [above.maximumX, above.maximumZ]) assert.ok(value > 9.9 && value < 10.5)
  // a zoomed view moved by its target shows a smaller ground around that target
  const near = worldViewGroundWindow(
    frame,
    { azimuth: 0, elevation: Math.PI / 2 - 0.04, zoom: 4, target: [20, 0, 30] },
    1,
  )
  assert.ok(near.minimumX > 17 && near.maximumX < 23 && near.minimumZ > 27 && near.maximumZ < 33)
  // looking low, the far edge reaches further, and no further than the far plane
  const low = worldViewGroundWindow(
    frame,
    { azimuth: 0, elevation: 0.1, zoom: 1, target: [0, 0, 0] },
    1,
  )
  assert.ok(low.maximumX - low.minimumX > 40)
  assert.ok([low.minimumX, low.maximumX, low.minimumZ, low.maximumZ].every(Number.isFinite))
  assert.ok(Math.max(-low.minimumX, low.maximumX) <= 7 * 10 + 10 * 1.5)
})
