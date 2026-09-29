import assert from 'node:assert/strict'
import { it } from 'node:test'

import { DEFAULT_WORLD_WEBGL_CAMERA, createWorldWebGlRenderer } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = id => ({ id, width: 1, height: 1, rgba: Uint8Array.of(80, 160, 200, 255) })

// Hilly ground (it casts) and an actor whose clip lifts it: its fallback triangles change every frame,
// and the plan frames it at rest, so the light view stays.
function world() {
  const terrain = Array.from({ length: 9 }, (_, i) => ({
    facet: 'terrain',
    id: `ground:${i}`,
    layerId: 'ground',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: i % 2,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x: i % 3, y: i % 2, z: -Math.floor(i / 3) },
  }))
  const actor = {
    state: 'converted',
    sourceKey: 'actor',
    complete: true,
    diagnostics: [],
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    skeleton: [
      {
        partId: 'triangle',
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
        id: 'triangle',
        topology: 'triangles',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, -1),
      },
    ],
    animations: [
      {
        id: 'stand',
        name: 'Stand',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        looping: true,
        channels: [
          {
            target: 'root',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [0, 2, 0] },
            ],
          },
        ],
      },
    ],
  }
  return {
    items: [
      ...terrain,
      {
        facet: 'objects',
        id: 'actor',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'doodad',
        objectId: 1,
        resourceId: 'actor',
        position: { x: 1, y: 1, z: 0 },
        uvwPosition: { x: 1, y: 1, z: -1 },
      },
    ],
    models: new Map([['actor', actor]]),
    terrainMaterials: [{ materialId: 'ground', baseColorResourceId: 'ground.png' }],
    terrainWeightRasters: [
      {
        resourceId: 'weights',
        width: 1,
        height: 1,
        materialIds: ['ground'],
        encoding: 'rgba8-unorm',
        normalization: 'sum',
      },
    ],
    terrainTextures: new Map([
      ['ground.png', texture('ground.png')],
      ['weights', { ...texture('weights'), rgba: Uint8Array.of(255, 0, 0, 0) }],
    ]),
    shadows: true,
    camera: DEFAULT_WORLD_WEBGL_CAMERA,
    timeSeconds: 0,
  }
}

// A WebGL2 stand-in that records each frame's calls in order with the framebuffer they draw into.
function recordingCanvas() {
  const constants = new Map()
  let calls = []
  let framebuffer = null
  const target = {
    drawingBufferWidth: 64,
    drawingBufferHeight: 64,
    NO_ERROR: 0,
    FRAMEBUFFER_COMPLETE: 36053,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 4096,
    getError: () => 0,
    getExtension: () => null,
    isContextLost: () => false,
    checkFramebufferStatus: () => 36053,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    bindFramebuffer: (kind, handle) => {
      if (kind === gl.FRAMEBUFFER || kind === gl.DRAW_FRAMEBUFFER) framebuffer = handle
    },
  }
  const gl = new Proxy(target, {
    get(object, name) {
      if (typeof name !== 'string') return undefined
      if (/^[A-Z0-9_]+$/u.test(name) && !(name in object)) {
        if (!constants.has(name)) constants.set(name, 0x9000 + constants.size)
        return constants.get(name)
      }
      const value = object[name]
      if (name in object && typeof value !== 'function') return value
      return (...args) => {
        const result =
          value !== undefined ? value(...args) : name.startsWith('create') ? {} : undefined
        calls.push({ name, framebuffer, result })
        return result
      }
    },
  })
  return {
    canvas: { width: 64, height: 64, getContext: () => gl },
    frame: () => {
      const frame = calls
      calls = []
      return frame
    },
  }
}

const draws = frame =>
  frame.filter(call => /^draw(?:Arrays|Elements)(?:Instanced)?$/u.test(call.name))

it('keeps the shadow depth of the casters that stayed, and draws only the others onto a copy', () => {
  const recording = recordingCanvas()
  const renderer = createWorldWebGlRenderer(recording.canvas)
  // The same items and models at the next clocks: the ground's arrays stay the same objects.
  const input = world()
  const frames = [0, 0.1, 0.2, 0.3].map(timeSeconds => {
    renderer.draw({ ...input, timeSeconds })
    return recording.frame()
  })
  // The shadow map is the framebuffer of the first draw; each frame draws into it.
  const shadowMap = draws(frames[0])[0].framebuffer
  assert.notEqual(shadowMap, null)
  const shadowDraws = frame => draws(frame).filter(call => call.framebuffer === shadowMap).length
  const blits = frame => frame.filter(call => call.name === 'blitFramebuffer').length
  // First frame: nothing stayed yet. Second: the ground stayed, is drawn and kept (one copy out).
  assert.equal(blits(frames[0]), 0)
  assert.equal(blits(frames[1]), 1)
  assert.equal(shadowDraws(frames[1]), shadowDraws(frames[0]))
  // Later frames copy the kept ground in and draw only the moving actor.
  for (const frame of frames.slice(2)) {
    assert.equal(blits(frame), 1)
    assert.ok(shadowDraws(frame) < shadowDraws(frames[1]), `${shadowDraws(frame)} shadow draws`)
    assert.ok(shadowDraws(frame) > 0)
  }
  // Another view of the light (a moved camera) draws the kept casters again.
  renderer.draw({
    ...input,
    timeSeconds: 0.4,
    camera: { ...DEFAULT_WORLD_WEBGL_CAMERA, target: [0.5, 0, 0] },
  })
  const moved = recording.frame()
  assert.equal(shadowDraws(moved), shadowDraws(frames[1]))
  renderer.dispose()
})
