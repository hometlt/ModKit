// Destination scene/test. Existing node:test harness; no runtime executed during draft preparation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createModelPoseBlendSampler,
  createModelSkeletonNodes,
} from '@modkit/codec-kit/model/skeleton'
import { SequencePoseSampler } from '@modkit/codec-kit/model-math/sequence-pose'
import { createModelSceneSampler } from '../src/model/sampler.js'
import { readUvmPoseSamples } from '../src/uvm/pose-samples.js'
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const inverse = (x, y) => {
  const result = [...identity]
  result[12] = -x
  result[13] = -y
  return result
}
const bone = (index, parent, translation, ibm) => ({
  partId: `part-${index}`,
  nodeId: `node-${index}`,
  hierarchyId: 'rig',
  boneIndex: index,
  parentBoneIndex: parent,
  boneName: `joint-${index}`,
  provenance: 'direct',
  localPose: { translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  inverseBindMatrix: ibm,
})
// Sparse and child-before-parent storage exercises the common-to-pinned topology map.
const bindings = [bone(3, 9, [0, 2, 0], inverse(10, 2)), bone(9, null, [10, 0, 0], inverse(10, 0))]
const channel = (kind, a, b = a, extra = {}) => ({
  target: 'node-9',
  kind,
  firstFrame: 0,
  lastFrame: 1,
  interpolation: kind === 'rotation' ? 'spherical-linear' : 'linear',
  samples: [
    { frame: 0, timeSeconds: 0, value: a },
    { frame: 1, timeSeconds: 1, value: b },
  ],
  ...extra,
})
const clip = (id, channels) => ({
  id,
  name: id,
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels,
})
const a = clip('a', [channel('translation', [2, 0, 0])]),
  b = clip('b', [channel('translation', [6, 0, 0])]),
  delta = clip('delta', [channel('translation', [4, 0, 0])])
const samples = [
  { clip: a, time: 0.5, weight: 1 },
  { clip: b, time: 0.5, weight: 3 },
  { clip: delta, time: 0.5, weight: 0.5, additive: true },
]
const matrix = (x, y) => {
  const result = [...identity]
  result[12] = x
  result[13] = y
  return result
}
const close = (a, b) => {
  assert.equal(a.length, b.length)
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 3e-5, `${i}: ${v} != ${b[i]}`))
}
test('weighted overrides plus additive deltas produce complete sparse world and skin matrices', () => {
  const sampler = createModelPoseBlendSampler({ bindings, hierarchyId: 'rig', samples }),
    actual = sampler.sample()
  assert.deepEqual(
    actual.bones.map(x => x.boneIndex),
    [3, 9],
  )
  assert.deepEqual(actual.bones[0].worldMatrix, matrix(7, 2))
  assert.deepEqual(actual.bones[1].worldMatrix, matrix(7, 0))
  assert.deepEqual(actual.bones[0].skinningMatrix, matrix(-3, 0))
  assert.deepEqual(actual.bones[1].skinningMatrix, matrix(-3, 0))
  const saved = structuredClone(actual)
  sampler.sample(5)
  assert.deepEqual(actual, saved)
  assert.throws(() => {
    actual.bones[0].worldMatrix[12] = 0
  }, TypeError)
})
test('quaternion hemisphere blending, additive rotations and multiplicative scales match unchanged pinned kernel', () => {
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    nq = q.map(v => -v)
  const first = clip('first', [
    channel('translation', [2, 0, 0]),
    channel('rotation', q),
    channel('scale', [1, 2, 1]),
  ])
  const second = clip('second', [
    channel('translation', [6, 0, 0]),
    channel('rotation', nq),
    channel('scale', [3, 2, 1]),
  ])
  const additive = clip('additive', [
    channel('translation', [4, 0, 0]),
    channel('rotation', q),
    channel('scale', [2, 1, 1]),
  ])
  const actual = createModelPoseBlendSampler({
    bindings,
    hierarchyId: 'rig',
    samples: [
      { clip: first, time: 0, weight: 1 },
      { clip: second, time: 0, weight: 3 },
      { clip: additive, time: 0, weight: 0.5, additive: true },
    ],
  }).sample()
  const constant = vector => ({ lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector }] })
  const sequence = (translation, rotation, scale, additive = false) => ({
    name: 'independent',
    durationSeconds: 1,
    looping: false,
    nodeTracks: [
      {
        boneIndex: 0,
        translation: constant(translation),
        rotation: constant(rotation),
        scale: constant(scale),
      },
      {
        boneIndex: 1,
        ...(additive
          ? {}
          : {
              translation: constant([0, 2, 0]),
              rotation: constant([0, 0, 0, 1]),
              scale: constant([1, 1, 1]),
            }),
      },
    ],
  })
  const pinned = new SequencePoseSampler([
    {
      index: 0,
      name: 'root',
      parentIndex: -1,
      inverseBindMatrix: Float32Array.from(inverse(10, 0)),
    },
    {
      index: 1,
      name: 'child',
      parentIndex: 0,
      inverseBindMatrix: Float32Array.from(inverse(10, 2)),
    },
  ]).sampleBlendedPose([
    { sequence: sequence([2, 0, 0], q, [1, 2, 1]), timeSeconds: 0, weight: 1 },
    { sequence: sequence([6, 0, 0], nq, [3, 2, 1]), timeSeconds: 0, weight: 3 },
    {
      sequence: sequence([4, 0, 0], q, [2, 1, 1], true),
      timeSeconds: 0,
      weight: 0.5,
      additive: true,
    },
  ])
  for (const [ordinal, boneIndex] of [9, 3].entries()) {
    const bone = actual.bones.find(x => x.boneIndex === boneIndex)
    close(bone.worldMatrix, [...pinned.world.subarray(ordinal * 16, ordinal * 16 + 16)])
    close(bone.skinningMatrix, [...pinned.skinning.subarray(ordinal * 16, ordinal * 16 + 16)])
  }
})
test('same blended pose drives every skin vertex and inherited socket world matrix', () => {
  const nodes = createModelSkeletonNodes(bindings, 'rig').map(node => ({
    ...node,
    childIds: [...node.childIds],
    meshIds: [],
  }))
  nodes.find(node => node.id === 'node-3').childIds.push('socket')
  nodes.find(node => node.id === 'node-9').meshIds.push('mesh')
  nodes.push({ id: 'socket', childIds: [], meshIds: [], transform: matrix(0, 1) })
  const primitive = {
    id: 'triangle',
    hierarchyId: 'rig',
    topology: 'triangles',
    positions: Float32Array.of(10, 0, 0, 10, 2, 0, 11, 1, 0),
    indices: Uint16Array.of(0, 1, 2),
    boneIndices: Uint16Array.of(9, 9, 9, 9, 3, 9, 9, 9, 9, 3, 9, 9),
    boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0),
  }
  const sampler = createModelSceneSampler(
    {
      nodes,
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [primitive],
      skeleton: bindings,
    },
    { poseSamples: samples, poseTime: 0.5 },
  )
  const result = sampler.sample(0.5)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual([...result.primitives[0].positions], [7, 0, 0, 7, 2, 0, 8, 1, 0])
  assert.deepEqual([...result.nodeTransforms.get('socket')], matrix(7, 3))
})
test('historical offsets preserve negative concurrent wrap times and input capture', () => {
  const wrapped = clip('wrapped', [
    channel('translation', [0, 0, 0], [4, 0, 0], { concurrent: true, wrapSeconds: 1 }),
  ])
  const request = [{ clip: wrapped, time: 0.25, weight: 1 }]
  const sampler = createModelPoseBlendSampler({ bindings, hierarchyId: 'rig', samples: request })
  request[0].clip.channels[0].samples[1].value[0] = 400
  request[0].weight = 0
  // Pinned signed-remainder semantics retain a negative time, then hold the first key.
  assert.deepEqual(
    sampler.sample(-0.5).bones.find(bone => bone.boneIndex === 9).worldMatrix,
    matrix(0, 0),
  )
  assert.deepEqual(
    sampler.sample(1.5).bones.find(bone => bone.boneIndex === 9).worldMatrix,
    matrix(3, 0),
  )
  assert.throws(() => sampler.sample(0, AbortSignal.abort()), { name: 'AbortError' })
})
test('malformed selections, absent targets and sequence-by-bone budgets reject before blended output', () => {
  for (const input of [[], [{ clip: a, time: 0, weight: 0 }], [{ clip: a, time: 0, weight: -1 }]])
    assert.throws(
      () => createModelPoseBlendSampler({ bindings, hierarchyId: 'rig', samples: input }),
      /poseSamples|weight/,
    )
  assert.throws(
    () =>
      createModelPoseBlendSampler({
        bindings,
        hierarchyId: 'rig',
        samples,
        budget: { maxDepth: 64, maxNodes: 1000, maxBytes: 1024 },
      }),
    /budget|maxBytes/,
  )
  assert.throws(
    () => readUvmPoseSamples([{ clipId: 'missing', time: 0, weight: 1 }], [a]),
    /unknown/,
  )
  assert.throws(
    () => readUvmPoseSamples([{ clipId: 'a', time: -1, weight: 1 }], [a]),
    /explicit pose/,
  )
  assert.throws(
    () =>
      createModelPoseBlendSampler({
        bindings,
        hierarchyId: 'rig',
        samples: [
          {
            clip: clip('bad', [{ ...channel('translation', [0, 0, 0]), target: 'absent' }]),
            time: 0,
            weight: 1,
          },
        ],
      }),
    /whole-bone/,
  )
})

test('explicit global clock is shared by clips while local blend times and historical offsets stay separate', () => {
  const first = clip('first-clock', [
    channel('translation', [0, 0, 0], [4, 0, 0], { concurrent: true, wrapSeconds: 1 }),
  ])
  const second = clip('second-clock', [
    channel('translation', [0, 0, 0], [8, 0, 0], { concurrent: true, wrapSeconds: 1 }),
  ])
  const selected = [
    { clip: first, time: 0.25, weight: 1 },
    { clip: second, time: 0.75, weight: 1 },
  ]
  const sampler = createModelPoseBlendSampler({ bindings, hierarchyId: 'rig', samples: selected })
  const x = pose => pose.bones.find(bone => bone.boneIndex === 9).worldMatrix[12]
  assert.equal(x(sampler.sample()), 3.5)
  assert.equal(x(sampler.sample(0, undefined, 0.75)), 4.5)
  assert.equal(x(sampler.sample(-0.5, undefined, 0.75)), 4.5)
  assert.equal(x(sampler.sample(-0.5)), 1)
  assert.equal(x(sampler.sample(0, undefined, 0)), 0)
  for (const invalid of [-1, NaN, Infinity, null, '0'])
    assert.throws(() => sampler.sample(0, undefined, invalid), /global time/)
  assert.throws(() => sampler.sample(0, AbortSignal.abort(), 0.75), { name: 'AbortError' })
  const nodes = createModelSkeletonNodes(bindings, 'rig').map(node => ({
    ...node,
    childIds: [...node.childIds],
    meshIds: [],
  }))
  nodes.find(node => node.id === 'node-3').childIds.push('socket')
  nodes.find(node => node.id === 'node-9').meshIds.push('mesh')
  nodes.push({ id: 'socket', childIds: [], meshIds: [], transform: matrix(0, 1) })
  const projection = {
    nodes,
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    skeleton: bindings,
    primitives: [
      {
        id: 'triangle',
        hierarchyId: 'rig',
        topology: 'triangles',
        positions: Float32Array.of(10, 0, 0, 10, 2, 0, 11, 1, 0),
        boneIndices: Uint16Array.of(9, 9, 9, 9, 3, 9, 9, 9, 9, 3, 9, 9),
        boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0),
      },
    ],
  }
  const scene = createModelSceneSampler(projection, { poseSamples: selected, poseTime: 0.5 })
  const current = scene.sample(0.5, undefined, undefined, 0.75)
  assert.deepEqual(current.diagnostics, [])
  assert.equal(current.primitives[0].positions[0], 4.5)
  assert.deepEqual([...current.nodeTransforms.get('socket')].slice(12, 15), [4.5, 3, 0])
  assert.equal(scene.sample(0.5).primitives[0].positions[0], 3.5)
  assert.equal(scene.sample(0, undefined, undefined, 0.75).primitives[0].positions[0], 4.5)
  const primary = createModelSceneSampler(projection, { clip: first })
  const primaryPose = primary.sample(0.25, undefined, undefined, 0.75)
  assert.equal(primaryPose.primitives[0].positions[0], 3)
  assert.deepEqual([...primaryPose.nodeTransforms.get('socket')].slice(12, 15), [3, 3, 0])
  assert.equal(primary.sample(0.25).primitives[0].positions[0], 1)
})

test('rigid pose blending offsets ordinary channels without shifting explicit global time', () => {
  const rest = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  const make = (id, scale) =>
    clip(id, [
      {
        ...channel('translation', [0, 0, 0], [scale, 0, 0], { concurrent: true, wrapSeconds: 1 }),
        target: 'parent',
      },
      { ...channel('translation', [0, 0, 0], [0, scale, 0]), target: 'child' },
    ])
  const scene = createModelSceneSampler(
    {
      nodes: [
        { id: 'parent', childIds: ['child'], meshIds: [], transform: identity },
        { id: 'child', childIds: [], meshIds: [], transform: identity },
      ],
      meshes: [],
      primitives: [],
      nodePoses: ['parent', 'child'].map(nodeId => ({ nodeId, localPose: rest })),
    },
    {
      poseSamples: [
        { clip: make('a', 4), time: 0.25, weight: 1 },
        { clip: make('b', 8), time: 0.75, weight: 1 },
      ],
      poseTime: 0.5,
    },
  )
  const position = (local, global) =>
    [...scene.sample(local, undefined, undefined, global).nodeTransforms.get('child')].slice(12, 15)
  assert.deepEqual(position(0.5, 0.75), [4.5, 3.5, 0])
  assert.deepEqual(position(0, 0.75), [4.5, 1, 0])
  assert.deepEqual(position(0.5), [3.5, 3.5, 0])
  assert.deepEqual(position(0), [1, 1, 0])
})
