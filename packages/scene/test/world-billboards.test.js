import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  createWorldWebGlRenderer,
} from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const card = {
  facet: 'objects',
  id: 'card',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  resourceId: 'card',
  position: { x: 1, y: 1, z: 0 },
  uvwPosition: { x: 1, y: 0, z: -1 },
}
// A card bound to one bone that turns to the camera (Warcraft III's and StarCraft II's effect cards).
function cardModel(billboard = { mode: 'inverse-camera', basisRotations: [] }) {
  return {
    state: 'converted',
    sourceKey: 'card',
    complete: true,
    diagnostics: [],
    nodes: [
      {
        id: 'root',
        childIds: [],
        meshIds: ['mesh'],
        transform: identity,
        ...(billboard === null ? {} : { billboard }),
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['quad'] }],
    skeleton: [
      {
        partId: 'quad',
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
        id: 'quad',
        topology: 'triangles',
        positions: Float32Array.of(-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 0, 0, 1, 2, 0, -1, 2, 0),
      },
    ],
  }
}
function world(model = cardModel()) {
  const terrain = Array.from({ length: 9 }, (_, i) => ({
    facet: 'terrain',
    id: `ground:${i}`,
    layerId: 'ground',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x: i % 3, y: 0, z: -Math.floor(i / 3) },
  }))
  return { items: [...terrain, card], models: new Map([['card', model]]), timeSeconds: 0 }
}
const turned = (input, turn) => ({
  ...input,
  camera: { ...DEFAULT_WORLD_WEBGL_CAMERA, azimuth: DEFAULT_WORLD_WEBGL_CAMERA.azimuth + turn },
})

it('a camera-facing node turns with the orbit camera; the terrain and the zoom leave it', () => {
  const input = world()
  const initial = createWorldWebGlPlan(input)
  const turnedInput = turned(input, 1)
  const plan = createWorldWebGlPlan(turnedInput, initial)
  assert.notDeepEqual(plan.opaqueTriangles.positions, initial.opaqueTriangles.positions)
  assert.equal(plan.picking.terrainTriangles, initial.picking.terrainTriangles)
  assert.deepEqual(plan, createWorldWebGlPlan(turnedInput))
  // zoom and target are not the camera's turn
  const zoomed = { ...input, camera: { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 2, target: [1, 0, 0] } }
  assert.deepEqual(
    createWorldWebGlPlan(zoomed, initial).opaqueTriangles.positions,
    initial.opaqueTriangles.positions,
  )
  // the card faces the camera: its quad's normal points along the camera's view, whatever the turn
  // of the camera or of the object itself
  const facing = (value, turn) => {
    // the card's last triangle, drawn after the ground
    const p = value.opaqueTriangles.positions.slice(-9)
    const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]]
    const v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const azimuth = DEFAULT_WORLD_WEBGL_CAMERA.azimuth + turn
    const { elevation } = DEFAULT_WORLD_WEBGL_CAMERA
    const toEye = [
      Math.cos(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(azimuth) * Math.cos(elevation),
    ]
    return Math.abs(n[0] * toEye[0] + n[1] * toEye[1] + n[2] * toEye[2]) / Math.hypot(...n)
  }
  const yawed = {
    ...input,
    items: input.items.map(item =>
      item === card ? { ...card, uvwRotation: [0, Math.sin(0.35), 0, Math.cos(0.35)] } : item,
    ),
  }
  for (const [value, turn] of [
    [initial, 0],
    [plan, 1],
    [createWorldWebGlPlan(yawed), 0],
  ])
    assert.ok(facing(value, turn) > 0.999, `the card faces the eye (cos ${facing(value, turn)})`)
})

it('the renderer keeps its plan as the camera turns unless a model faces the camera', () => {
  const noop = () => {}
  const gl = {
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    deleteProgram: noop,
    createVertexArray: () => ({}),
    drawArrays: noop,
    getExtension: () => null,
  }
  const screen = { x: 32, y: 32, width: 64, height: 64 }
  for (const [model, faces] of [
    [cardModel(), true],
    [cardModel(null), false],
  ]) {
    const renderer = createWorldWebGlRenderer({ getContext: () => gl })
    const input = world(model)
    renderer.pick(input, screen)
    renderer.pick(turned(input, 0.5), screen)
    const stats = renderer.stats()
    assert.equal(stats.worldPlanBuilds, 1)
    assert.equal(stats.worldPlanDynamicUpdates, faces ? 1 : 0)
    assert.equal(stats.worldPlanReuses, faces ? 0 : 1)
    renderer.dispose()
  }
})
