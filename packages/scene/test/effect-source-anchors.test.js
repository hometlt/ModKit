import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { createModelSceneSampler } from '../src/model/sampler.js'
import { createUvmEffectSource } from '../src/uvm/effect-source.js'
import { readUvmModel } from '../src/uvm/model.js'
import { createUvmProjectorFrame } from '../src/uvm/projectors.js'

const projector = {
  name: 'shadow',
  node: 2,
  material: 0,
  active: 1,
  projectionType: 'orthographic',
  offset: [0.25, 0, 0],
  pitch: 0,
  yaw: 0,
  roll: 0,
  near: 0.1,
  far: 6,
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

// Node 0 holds node 1 (which holds the projector's node 2) and node 3 (which holds node 4). The Stand
// clip moves nodes 0, 1 and 3: the decal reads 2 and its ancestors, never the 3–4 branch.
function uvm() {
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { children: [1, 3] },
      { children: [2], translation: [0, 0.5, 0] },
      { rotation: [0, 0, 0.3826834, 0.9238795] },
      { children: [4] },
      {},
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_effects'],
    extensions: {
      UV_asset: { id: 'effect-source-anchors', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'scene-test', version: '1' } },
      UV_game_effects: {
        profile: 'common',
        trackTimeUnit: 'seconds',
        particles: [],
        ribbons: [],
        projectors: [projector],
      },
    },
  }
  const container = { format: 'glb', document, binary: new Uint8Array(), extraChunks: [] }
  const appended = appendUvmAccessors(container, [
    { type: 'SCALAR', values: Float32Array.of(0, 1, 2) },
    { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1.5, 0.25, -0.5, 0, 0, 0) },
    { type: 'VEC3', values: Float32Array.of(0, 0.5, 0, 0.3, 0.9, 0.1, 0, 0.5, 0) },
    { type: 'VEC4', values: Float32Array.of(0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068, 0, 0, 0, 1) },
  ])
  const animated = structuredClone(appended.container)
  const [times, root, middle, beside] = appended.accessors
  animated.document.animations = [
    {
      name: 'Stand',
      samplers: [
        { input: times, output: root, interpolation: 'LINEAR' },
        { input: times, output: middle, interpolation: 'LINEAR' },
        { input: times, output: beside, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 0, path: 'translation' } },
        { sampler: 1, target: { node: 1, path: 'translation' } },
        { sampler: 2, target: { node: 3, path: 'rotation' } },
      ],
    },
  ]
  return writeUvmContainer(animated)
}

test('an effect projects from the poses of the nodes it names as from the whole rig', () => {
  const bytes = uvm()
  const source = createUvmEffectSource(bytes)
  assert.equal(source?.projectionsFollowTime, true)
  // The whole rig, sampled as the effect source sampled it for every step before.
  const { document, binary } = readUvmContainer(bytes)
  const { scene, rig } = readUvmModel(document, binary, { maxScalarBytes: 64 * 1024 * 1024 })
  const clip = rig.clips.find(candidate => candidate.name?.toLowerCase() === 'stand')
  assert.ok(clip)
  const whole = createModelSceneSampler(
    {
      nodes: scene.nodes.map(node => ({ ...node, meshIds: [] })),
      meshes: [],
      primitives: [],
      skeleton: rig.bindings,
      nodePoses: rig.nodePoses,
    },
    {
      maxBytes: 64 * 1024 * 1024,
      clip: { ...clip, channels: clip.channels.filter(channel => channel.kind !== 'visibility') },
    },
  )
  const ground = {
    id: 'ground',
    topology: 'triangles',
    positions: Float32Array.of(-9, -9, 4, 9, -9, 4, 9, 9, 4, -9, -9, 4, 9, 9, 4, -9, 9, 4),
  }
  const materials = [{ id: 'material-0', baseColor: [1, 1, 1, 1] }]
  for (const time of [0, 0.25, 0.5, 0.95, 1.5, 1.9]) {
    const expected = createUvmProjectorFrame(document, {
      time,
      materials,
      receivers: [ground],
      activeNodes: new Set(scene.nodes.map(node => node.id)),
      nodeTransforms: whole.sample(time).nodeTransforms,
      ...(clip.sequenceIndex === undefined ? {} : { sequenceIndex: clip.sequenceIndex }),
      maxBytes: 64 * 1024 * 1024,
      maxNodes: 1_000_000,
      warn: () => {},
    })
    assert.ok(expected.primitives.length > 0, `decal at ${time}`)
    assert.deepEqual(source.project(time, materials, [ground]), expected, `time ${time}`)
  }
})
