import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  createWorldWebGlCameraFrame,
  createWorldWebGlPlan,
  DEFAULT_WORLD_WEBGL_CAMERA,
  flyWorldWebGlCamera,
  lookWorldWebGlCamera,
  orbitWorldWebGlCamera,
  worldViewGroundWindow,
  worldWebGlCameraFromMap,
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
const items = ground(8)
const plan = createWorldWebGlPlan({ items })
const perspective = { ...DEFAULT_WORLD_WEBGL_CAMERA, projection: 'perspective' }
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const close = (actual, expected, digits = 9) =>
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 10 ** -digits))

it('places a perspective eye where its lens frames the orthographic height at the target (MW6)', () => {
  const frame = plan.stats.frame
  const camera = createWorldWebGlCameraFrame(plan, 64, 48, perspective)
  // the default lens of 60°: the eye stands radius / tan(30°) from the target
  assert.ok(
    Math.abs(distance(camera.eyePosition, frame.center) - frame.radius / Math.tan(Math.PI / 6)) <
      1e-3,
  )
  // a perspective projection divides by depth: its w row is not (0, 0, 0, 1)
  assert.notDeepEqual(
    [...camera.viewProjection].filter((_, index) => index % 4 === 3),
    [0, 0, 0, 1],
  )
  const ortho = createWorldWebGlCameraFrame(plan, 64, 48, DEFAULT_WORLD_WEBGL_CAMERA)
  assert.deepEqual(
    [...ortho.viewProjection].filter((_, index) => index % 4 === 3).map(Math.round),
    [0, 0, 0, 1],
  )
})

it('looks around from where the eye stands, and the orbit turns about the target', () => {
  const eye = createWorldWebGlCameraFrame(plan, 64, 48, perspective).eyePosition
  const looked = lookWorldWebGlCamera({ items }, perspective, { x: 40, y: 25 })
  close(createWorldWebGlCameraFrame(plan, 64, 48, looked).eyePosition, eye, 6)
  assert.notDeepEqual(looked.target, perspective.target)
  // a perspective eye may look up past the horizon; the orbit stays above its target
  assert.ok(lookWorldWebGlCamera({ items }, perspective, { x: 0, y: -400 }).elevation < 0)
  assert.ok(orbitWorldWebGlCamera(DEFAULT_WORLD_WEBGL_CAMERA, { x: 0, y: -400 }).elevation > 0)
  // an orthographic camera asked to look orbits
  assert.deepEqual(
    lookWorldWebGlCamera({ items }, DEFAULT_WORLD_WEBGL_CAMERA, { x: 40, y: 25 }),
    orbitWorldWebGlCamera(DEFAULT_WORLD_WEBGL_CAMERA, { x: 40, y: 25 }),
  )
})

it('flies the eye and the target together along the view, across it and up', () => {
  const before = createWorldWebGlCameraFrame(plan, 64, 48, perspective).eyePosition
  const flown = flyWorldWebGlCamera(perspective, { forward: 2, right: 0, up: 1 })
  const after = createWorldWebGlCameraFrame(plan, 64, 48, flown).eyePosition
  // forward is the view (the target seen from the eye), up the world's +y
  const { azimuth, elevation } = perspective
  const forward = [
    -Math.cos(azimuth) * Math.cos(elevation),
    -Math.sin(elevation),
    -Math.sin(azimuth) * Math.cos(elevation),
  ]
  close(
    after.map((value, axis) => value - before[axis]),
    forward.map((value, axis) => 2 * value + (axis === 1 ? 1 : 0)),
    4,
  )
  // up is the world's up axis
  close(flyWorldWebGlCamera(perspective, { forward: 0, right: 0, up: 3 }).target, [0, 3, 0])
})

it('asks a growing world for the ground the perspective view shows, to its far plane', () => {
  const frame = plan.stats.frame
  const near = worldViewGroundWindow(frame, { ...perspective, far: 20 }, 4 / 3)
  const far = worldViewGroundWindow(frame, { ...perspective, far: 400 }, 4 / 3)
  assert.ok(Object.values(near).every(Number.isFinite))
  // a view that looks over the horizon reaches only as far as it draws
  const level = { ...perspective, elevation: -0.2 }
  const short = worldViewGroundWindow(frame, { ...level, far: 20 }, 1)
  const long = worldViewGroundWindow(frame, { ...level, far: 400 }, 1)
  assert.ok(long.maximumX - long.minimumX > short.maximumX - short.minimumX)
  assert.ok(far.maximumX - far.minimumX >= near.maximumX - near.minimumX)
})

it('refuses a lens outside its domain', () => {
  assert.throws(
    () => createWorldWebGlCameraFrame(plan, 64, 48, { ...perspective, fieldOfView: 3 }),
    /orbit\/zoom domain/,
  )
  assert.throws(
    () => createWorldWebGlCameraFrame(plan, 64, 48, { ...perspective, far: -1 }),
    /orbit\/zoom domain/,
  )
  assert.throws(
    () =>
      createWorldWebGlCameraFrame(plan, 64, 48, { ...DEFAULT_WORLD_WEBGL_CAMERA, elevation: -0.5 }),
    /orbit\/zoom domain/,
  )
})

it("opens on the game's view of its world: an orthographic preset or a perspective lens (WT3, MW6)", () => {
  // Tiberian Sun and Red Alert 2: the orthographic camera at 45° round and 30° down
  const isometric = worldWebGlCameraFromMap({
    projection: 'orthographic',
    azimuthDegrees: 45,
    elevationDegrees: 30,
  })
  assert.equal(isometric.projection, 'orthographic')
  assert.ok(Math.abs(isometric.azimuth - Math.PI / 4) < 1e-12)
  assert.ok(Math.abs(isometric.elevation - Math.PI / 6) < 1e-12)
  // a game seen in first person: its lens and draw distance
  const lens = worldWebGlCameraFromMap({
    projection: 'perspective',
    fieldOfViewDegrees: 70,
    drawDistance: 192,
  })
  assert.equal(lens.projection, 'perspective')
  assert.equal(lens.far, 192)
  assert.ok(Math.abs(lens.fieldOfView - (70 * Math.PI) / 180) < 1e-12)
  createWorldWebGlCameraFrame(plan, 64, 48, lens)
  // an orthographic view straight down is brought within its orbit
  const down = worldWebGlCameraFromMap({ projection: 'orthographic', elevationDegrees: 90 })
  assert.ok(down.elevation < Math.PI / 2)
  createWorldWebGlCameraFrame(plan, 64, 48, down)
  assert.equal(worldWebGlCameraFromMap(undefined), DEFAULT_WORLD_WEBGL_CAMERA)
})
