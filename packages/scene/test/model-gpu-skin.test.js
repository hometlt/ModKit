import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import {
  animationSnapshotBudget,
  snapshotModelAnimations,
} from '@modkit/codec-kit/model/animation'
import { createModelSceneSampler } from '../src/model/sampler.js'

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
// Sparse bone indices, a child stored before its parent.
const bindings = [bone(3, 9, [0, 2, 0], inverse(10, 2)), bone(9, null, [10, 0, 0], inverse(10, 0))]
const turn = Math.SQRT1_2
// The root moves and turns a quarter about z, the child stays on it scaled: every vertex moves.
const clip = {
  id: 'stand',
  name: 'Stand',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels: [
    ['node-9', 'translation', [10, 0, 0], [12, 1, 0]],
    ['node-9', 'rotation', [0, 0, 0, 1], [0, 0, turn, turn]],
    ['node-3', 'scale', [1, 1, 1], [1.5, 0.5, 1]],
  ].map(([target, kind, a, b]) => ({
    target,
    kind,
    firstFrame: 0,
    lastFrame: 1,
    interpolation: kind === 'rotation' ? 'spherical-linear' : 'linear',
    samples: [
      { frame: 0, timeSeconds: 0, value: a },
      { frame: 1, timeSeconds: 1, value: b },
    ],
  })),
}
const nodes = createModelSkeletonNodes(bindings, 'rig').map(node => ({
  ...node,
  childIds: [...node.childIds],
  meshIds: node.id === 'node-9' ? ['mesh'] : [],
}))
// On the root alone, blended three to one, weights summing to 0.4 (the kernel divides by the sum),
// and a vertex without weight (the kernel leaves it where it is).
const primitive = (tangents = true) => ({
  id: 'quad',
  hierarchyId: 'rig',
  topology: 'triangles',
  positions: Float32Array.of(10, 0, 0, 10, 2, 0, 11, 1, 0, 12, 3, 1),
  normals: Float32Array.of(0, 0, 1, 0, 1, 0, 0.6, 0, 0.8, 1, 0, 0),
  ...(tangents
    ? { tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1, 1) }
    : {}),
  indices: Uint32Array.of(0, 1, 2, 1, 3, 2),
  boneIndices: Uint32Array.of(9, 9, 9, 9, 3, 9, 9, 9, 9, 3, 9, 9, 3, 9, 3, 9),
  boneWeights: Float32Array.of(1, 0, 0, 0, 0.25, 0.75, 0, 0, 0.2, 0.2, 0, 0, 0, 0, 0, 0),
})
const projection = source => ({
  nodes,
  meshes: [{ id: 'mesh', primitiveIds: ['quad'] }],
  primitives: [source],
  skeleton: bindings,
})
const normalize = ([x, y, z]) => {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}
const near = (actual, expected, label) =>
  expected.forEach((value, index) =>
    assert.ok(
      Math.abs(actual[index] - value) < 1e-5,
      `${label}[${index}]: ${actual[index]} != ${value}`,
    ),
  )

it('poses a skin on the GPU with the arithmetic of the CPU kernel', () => {
  const source = primitive()
  const cpu = createModelSceneSampler(projection(source), { clip }).sample(0.5).primitives[0]
  const sampler = createModelSceneSampler(projection(source), { clip, skinning: 'gpu' })
  const [gpu] = sampler.sample(0.5).primitives
  // The bind-pose arrays stay, without the skin buffers and bounds a posed primitive does not carry.
  assert.equal(gpu.positions, source.positions)
  assert.equal(gpu.normals, source.normals)
  assert.equal(gpu.tangents, source.tangents)
  assert.equal(gpu.indices, source.indices)
  for (const key of ['boneIndices', 'boneWeights', 'hierarchyId', 'bounds'])
    assert.ok(!(key in gpu))
  const { joints, weights, palette } = gpu.skin
  // Slots in binding order, the identity last; weightless influences name the identity.
  assert.equal(palette.length, 3 * 16)
  assert.deepEqual([...palette.subarray(32)], identity)
  assert.deepEqual([...joints], [1, 2, 2, 2, 0, 1, 2, 2, 1, 0, 2, 2, 2, 2, 2, 2])
  assert.deepEqual([...weights], [1, 0, 0, 0, 0.25, 0.75, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0])
  // What the vertex stage computes from them is the CPU kernel's pose.
  const matrix = slot => palette.subarray(slot * 16, slot * 16 + 16)
  for (let vertex = 0; vertex < 4; vertex++) {
    const blend = new Array(16).fill(0)
    for (let influence = 0; influence < 4; influence++) {
      const weight = weights[vertex * 4 + influence]
      const bone = matrix(joints[vertex * 4 + influence])
      for (let index = 0; index < 16; index++) blend[index] += bone[index] * weight
    }
    const apply = ([x, y, z], w) =>
      [0, 1, 2].map(
        row => blend[row] * x + blend[4 + row] * y + blend[8 + row] * z + blend[12 + row] * w,
      )
    const read = (array, width) => [...array.subarray(vertex * width, vertex * width + 3)]
    near(apply(read(source.positions, 3), 1), read(cpu.positions, 3), `position ${vertex}`)
    near(normalize(apply(read(source.normals, 3), 0)), read(cpu.normals, 3), `normal ${vertex}`)
    near(normalize(apply(read(source.tangents, 4), 0)), read(cpu.tangents, 4), `tangent ${vertex}`)
    assert.equal(cpu.tangents[vertex * 4 + 3], source.tangents[vertex * 4 + 3])
  }
  // The pose on the CPU, when asked for, is the CPU sampler's exactly.
  const deformed = gpu.skin.deformed()
  assert.deepEqual([...deformed.positions], [...cpu.positions])
  assert.deepEqual([...deformed.normals], [...cpu.normals])
  assert.deepEqual([...deformed.tangents], [...cpu.tangents])
  assert.equal(gpu.skin.deformed(), deformed)
  // Another clock: the same arrays and vertex slots, its own palette.
  const [later] = sampler.sample(0.75).primitives
  assert.equal(later.positions, gpu.positions)
  assert.equal(later.skin.joints, joints)
  assert.notEqual(later.skin.palette, palette)
  assert.notDeepEqual([...later.skin.palette], [...palette])
})

it('keeps a skin without authored tangents on the CPU', () => {
  const source = primitive(false)
  const cpu = createModelSceneSampler(projection(source), { clip }).sample(0.5).primitives[0]
  const [gpu] = createModelSceneSampler(projection(source), { clip, skinning: 'gpu' }).sample(
    0.5,
  ).primitives
  assert.equal(gpu.skin, undefined)
  assert.deepEqual([...gpu.positions], [...cpu.positions])
})

it('poses all eight influences on the CPU even when GPU skinning was requested', () => {
  const original = primitive()
  const source = {
    ...original,
    boneInfluences: 8,
    boneIndices: new Uint32Array(32),
    boneWeights: new Float32Array(32),
  }
  for (let vertex = 0; vertex < 4; vertex++) {
    source.boneIndices.fill(9, vertex * 8, vertex * 8 + 8)
    source.boneIndices[vertex * 8 + 7] = 3
    source.boneWeights[vertex * 8] = 0.5
    source.boneWeights[vertex * 8 + 7] = 0.5
  }
  const cpu = createModelSceneSampler(projection(source), { clip }).sample(0.5).primitives[0]
  const gpu = createModelSceneSampler(projection(source), { clip, skinning: 'gpu' }).sample(0.5)
    .primitives[0]
  assert.equal(gpu.skin, undefined)
  assert.deepEqual([...gpu.positions], [...cpu.positions])
  assert.deepEqual([...gpu.normals], [...cpu.normals])
  const truncated = {
    ...source,
    boneInfluences: 4,
    boneIndices: Uint32Array.from({ length: 16 }, () => 9),
    boneWeights: Float32Array.from({ length: 16 }, (_value, i) => (i % 4 === 0 ? 1 : 0)),
  }
  const lost = createModelSceneSampler(projection(truncated), { clip }).sample(0.5).primitives[0]
  assert.notDeepEqual([...cpu.positions], [...lost.positions])
})

it('poses a large channelled skin with a clip-sized node budget and a bounded byte budget', () => {
  const jointCount = 96
  const weightedCount = 50
  const sampleCount = 700
  const largeBindings = Array.from({ length: jointCount }, (_, index) =>
    bone(index, null, [0, 0, 0], identity),
  )
  const largeNodes = createModelSkeletonNodes(largeBindings, 'rig').map(node => ({
    ...node,
    meshIds: node.id === 'node-0' ? ['mesh'] : [],
  }))
  const samples = kind =>
    Array.from({ length: sampleCount }, (_, frame) => ({
      frame,
      timeSeconds: frame / (sampleCount - 1),
      value:
        kind === 'translation'
          ? [frame / (sampleCount - 1), 0, 0]
          : kind === 'rotation'
            ? [0, 0, 0, 1]
            : [1, 1, 1],
    }))
  const channelSamples = Object.fromEntries(
    ['translation', 'rotation', 'scale'].map(kind => [kind, samples(kind)]),
  )
  const largeClip = {
    id: 'large',
    name: 'Large rig',
    kind: 'animation',
    provenance: 'direct',
    frames: sampleCount,
    durationSeconds: 1,
    channels: largeBindings.flatMap(({ nodeId }) =>
      ['translation', 'rotation', 'scale'].map(kind => ({
        target: nodeId,
        kind,
        firstFrame: 0,
        lastFrame: sampleCount - 1,
        interpolation: kind === 'rotation' ? 'spherical-linear' : 'linear',
        samples: channelSamples[kind],
      })),
    ),
  }
  assert.equal(largeClip.channels.length, 288)
  assert.ok(animationSnapshotBudget([largeClip]).maxNodes > 1_000_000)
  assert.throws(() => snapshotModelAnimations([largeClip]), /JSON snapshot exceeds maxNodes/)
  const vertices = weightedCount * 3
  const positions = new Float32Array(vertices * 3)
  const indices = Uint32Array.from({ length: vertices }, (_, index) => index)
  const boneIndices = new Uint32Array(vertices * 4)
  const boneWeights = new Float32Array(vertices * 4)
  for (let vertex = 0; vertex < vertices; vertex++) {
    boneIndices[vertex * 4] = Math.floor(vertex / 3)
    boneWeights[vertex * 4] = 1
  }
  const largeProjection = {
    nodes: largeNodes,
    meshes: [{ id: 'mesh', primitiveIds: ['triangles'] }],
    primitives: [
      {
        id: 'triangles',
        hierarchyId: 'rig',
        topology: 'triangles',
        positions,
        indices,
        boneIndices,
        boneWeights,
      },
    ],
    skeleton: largeBindings,
  }
  const sampler = createModelSceneSampler(largeProjection, { clip: largeClip })
  assert.ok(!sampler.diagnostics.some(item => item.code === 'common.model/pose-unavailable'))
  const first = sampler.sample(0).primitives[0].positions
  const last = sampler.sample(1).primitives[0].positions
  for (let joint = 0; joint < weightedCount; joint++)
    assert.notEqual(first[joint * 9], last[joint * 9], `weighted joint ${joint} must move`)
  assert.throws(
    () => createModelSceneSampler(largeProjection, { clip: largeClip, maxBytes: 1024 }),
    /exceeds maxBytes|exceeds byte budget/,
  )
})
