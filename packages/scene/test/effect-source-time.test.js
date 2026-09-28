import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { writeUvmContainer } from '@modkit/uv/model/container'
import { createUvmEffectSource } from '../src/uvm/effect-source.js'

const projector = {
  name: 'shadow',
  node: 1,
  material: 0,
  active: 1,
  projectionType: 'orthographic',
  offset: [0, 0, 0],
  pitch: 0,
  yaw: 0,
  roll: 0,
  near: 0.1,
  far: 2,
  fieldOfView: 1,
  aspectRatio: 1,
  boxOffsetXLeft: -1,
  boxOffsetXRight: 1,
  boxOffsetYBack: -1,
  boxOffsetYFront: 1,
  boxOffsetZBottom: 0,
  boxOffsetZTop: 0,
  alphaInit: 1,
  falloff: 0,
  attenuationDistance: 0,
  flags: 0,
  layer: 0,
}
const emitter = {
  name: 'spark',
  node: 2,
  material: 0,
  emissionRate: 10,
  lifeSpan: 1,
  speed: 1,
  orientationMode: 'billboard',
  emitShape: 'point',
}

// Node 0 holds the projector's node 1; node 2 stands beside them. A Stand clip may move one node.
function uvm(effects, movedNode) {
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [{ children: [1] }, {}, {}],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_effects'],
    extensions: {
      UV_asset: { id: 'effect-source-time', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'scene-test', version: '1' } },
      UV_game_effects: {
        profile: 'common',
        trackTimeUnit: 'seconds',
        particles: [],
        ribbons: [],
        projectors: [],
        ...effects,
      },
    },
  }
  const container = { format: 'glb', document, binary: new Uint8Array(), extraChunks: [] }
  if (movedNode === undefined) return writeUvmContainer(container)
  const appended = appendUvmAccessors(container, [
    { type: 'SCALAR', values: Float32Array.of(0, 1) },
    { type: 'VEC3', values: Float32Array.of(0, 0, 0, 0, 1, 0) },
  ])
  const animated = structuredClone(appended.container)
  animated.document.animations = [
    {
      name: 'Stand',
      samplers: [
        { input: appended.accessors[0], output: appended.accessors[1], interpolation: 'LINEAR' },
      ],
      channels: [{ sampler: 0, target: { node: movedNode, path: 'translation' } }],
    },
  ]
  return writeUvmContainer(animated)
}

test('an effect source tells whether its particles, ribbons or decals follow the clock', () => {
  const still = createUvmEffectSource(uvm({ projectors: [projector] }))
  assert.equal(still.hasProjectors, true)
  assert.equal(still.liveEffects, false)
  assert.equal(still.projectionsFollowTime, false)
  // A projector track samples the clock.
  const track = { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [1] }] }
  const tracked = { ...projector, sequenceAnimation: { active: [{ sequenceIndex: 0, track }] } }
  assert.equal(createUvmEffectSource(uvm({ projectors: [tracked] })).projectionsFollowTime, true)
  // The clip moves the projector node's parent, so its world transform moves too.
  assert.equal(
    createUvmEffectSource(uvm({ projectors: [projector] }, 0)).projectionsFollowTime,
    true,
  )
  // A clip that only moves a node beside it leaves the decal where it is.
  const beside = createUvmEffectSource(uvm({ projectors: [projector] }, 2))
  assert.equal(beside.projectionsFollowTime, false)
  // Particles are simulated at the clock whatever the decals do.
  const live = createUvmEffectSource(uvm({ projectors: [projector], particles: [emitter] }, 2))
  assert.equal(live.liveEffects, true)
  assert.equal(live.projectionsFollowTime, false)
})
