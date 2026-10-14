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
  worldWebGlCameraFromSource,
  worldWebGlCameraFromModel,
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

it('keeps an authored lens independent of world bounds and applies camera roll', () => {
  const source = {
    eye: [1, 2, 3],
    target: [1, 2, 0],
    up: [0, 1, 0],
    verticalFieldOfView: Math.PI / 3,
    near: 0.001,
    far: 100,
  }
  const view = worldWebGlCameraFromSource(source)
  const first = createWorldWebGlCameraFrame(plan, 64, 48, view)
  const other = createWorldWebGlCameraFrame(
    createWorldWebGlPlan({ items: ground(80) }),
    64,
    48,
    view,
  )
  close(first.eyePosition, source.eye)
  close(first.viewProjection, other.viewProjection)
  const rolled = createWorldWebGlCameraFrame(
    plan,
    64,
    48,
    worldWebGlCameraFromSource({ ...source, roll: Math.PI / 2 }),
  )
  close(rolled.eyePosition, source.eye)
  assert.notDeepEqual(rolled.viewMatrix, first.viewMatrix)
  // A point to the camera's right moves down after +90 degrees of local roll.
  const project = matrix => {
    const point = [2, 2, 0, 1]
    const clip = [0, 1, 2, 3].map(row =>
      point.reduce((sum, value, column) => sum + value * matrix[column * 4 + row], 0),
    )
    return [clip[0] / clip[3], clip[1] / clip[3]]
  }
  close(project(first.viewProjection), [Math.sqrt(3) / 4, 0], 6)
  close(project(rolled.viewProjection), [0, -Math.sqrt(3) / 3], 6)
  assert.throws(() => worldWebGlCameraFromSource({ ...source, target: source.eye }), /degenerate/)
  assert.throws(() => worldWebGlCameraFromSource({ ...source, far: source.near }), /lens/)
})

it('preserves horizontal FOV across viewport aspect ratios', () => {
  const source = {
    eye: [0, 0, 3],
    target: [0, 0, 0],
    up: [0, 1, 0],
    horizontalFieldOfView: Math.PI / 2,
    near: 0.01,
    far: 100,
  }
  const view = worldWebGlCameraFromSource(source)
  const square = createWorldWebGlCameraFrame(plan, 100, 100, view)
  const wide = createWorldWebGlCameraFrame(plan, 200, 100, view)
  assert.ok(Math.abs(square.viewProjection[0] - wide.viewProjection[0]) < 1e-6)
  assert.ok(Math.abs(wide.viewProjection[5] - 2 * square.viewProjection[5]) < 1e-6)
  assert.throws(() => worldWebGlCameraFromSource({ ...source, horizontalFieldOfView: 7 }), /lens/)
  assert.throws(() => worldWebGlCameraFromSource({ ...source, verticalFieldOfView: 1 }), /FOV axis/)
})

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

it('samples a meshless model camera on its moving parent and applies the world instance', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const rest = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  const child = [...identity]
  child[14] = 3
  const document = {
    asset: { version: '2.0' },
    nodes: [{ children: [1] }, { camera: 0, translation: [0, 0, 3] }],
    cameras: [{ type: 'perspective', perspective: { yfov: Math.PI / 3, znear: 0.1, zfar: 100 } }],
  }
  const model = {
    state: 'converted',
    sourceKey: 'camera-test',
    meshes: [],
    primitives: [],
    diagnostics: [],
    complete: true,
    uvmBytes: new TextEncoder().encode(JSON.stringify(document)),
    nodes: [
      { id: 'node-0', childIds: ['node-1'], meshIds: [], transform: identity, trs: rest },
      { id: 'node-1', childIds: [], meshIds: [], transform: child },
    ],
    animations: [
      {
        id: 'move',
        name: 'Move',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        channels: [
          {
            target: 'node-0',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [2, 0, 0] },
            ],
          },
        ],
      },
    ],
  }
  const actor = {
    facet: 'objects',
    id: 'actor',
    objectId: 1,
    layerId: 'objects',
    coordinateSpaceId: 'test',
    kind: 'doodad',
    resourceId: 'camera',
    position: { x: 10, y: 0, z: 0 },
    uvwPosition: { x: 10, y: 0, z: 0 },
    presentationAnimation: { name: 'Move', loop: false, speed: 1, groups: [] },
  }
  const input = { items: [actor], models: new Map([['camera', model]]) }
  const first = worldWebGlCameraFromModel(
    { ...input, timeSeconds: 0 },
    { objectId: 1, cameraIndex: 0 },
  )
  const last = worldWebGlCameraFromModel(
    { ...input, timeSeconds: 1 },
    { objectId: 1, cameraIndex: 0 },
  )
  close(first.source.eye, [10, 0, 3], 6)
  close(last.source.eye, [12, 0, 3], 6)
  close(last.source.target, [12, 0, 2], 6)
  assert.throws(
    () => worldWebGlCameraFromModel(input, { objectId: 1, cameraIndex: 1 }),
    /index is unavailable/,
  )
  const mappedModel = {
    ...model,
    cameras: [{ projectedCameraIndex: null }, { projectedCameraIndex: 0 }],
  }
  const mappedInput = { ...input, timeSeconds: 1, models: new Map([['camera', mappedModel]]) }
  const mapped = worldWebGlCameraFromModel(mappedInput, { objectId: 1, cameraIndex: 1 })
  close(mapped.source.eye, last.source.eye, 6)
  close(mapped.source.target, last.source.target, 6)
  assert.throws(
    () => worldWebGlCameraFromModel(mappedInput, { objectId: 1, cameraIndex: 0 }),
    /not projected into UVM/,
  )
  const halfTurn = Math.SQRT1_2
  const rolledModel = {
    ...mappedModel,
    nodes: [
      { ...model.nodes[0], trs: { ...rest, rotation: [0, 0, halfTurn, halfTurn] } },
      model.nodes[1],
    ],
  }
  const rolled = worldWebGlCameraFromModel(
    { ...mappedInput, models: new Map([['camera', rolledModel]]) },
    { objectId: 1, cameraIndex: 1 },
  )
  close(rolled.source.up, [-1, 0, 0], 6)
})
