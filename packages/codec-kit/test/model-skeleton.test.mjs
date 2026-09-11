import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelSkeletonSource } from '../dist/index.js'
import {
  createModelSkeletonNodes,
  createModelPoseSampler,
  snapshotModelSkeleton,
} from '../dist/model/skeleton.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const bone = (boneIndex, parentBoneIndex, translation, inverseBindMatrix) => ({
  partId: `part/${boneIndex}`,
  nodeId: `joint/${boneIndex}`,
  hierarchyId: 'rig',
  boneIndex,
  parentBoneIndex,
  boneName: null,
  provenance: 'direct',
  localPose: { translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  ...(inverseBindMatrix === undefined ? {} : { inverseBindMatrix }),
})

test('pose follows explicit sparse topology, local defaults and inverse bind matrices', () => {
  const inverse = [...identity]
  inverse[12] = -10
  inverse[13] = -2
  const bindings = [bone(3, 9, [0, 2, 0], inverse), bone(9, null, [10, 0, 0])]
  const nodes = createModelSkeletonNodes(bindings, 'rig')
  assert.deepEqual(
    nodes.map(node => [node.id, node.childIds]),
    [
      ['joint/3', []],
      ['joint/9', ['joint/3']],
    ],
  )
  const rest = createModelPoseSampler({ bindings, hierarchyId: 'rig' }).sample(0)
  assert.deepEqual(rest.bones[0].worldMatrix.slice(12, 15), [10, 2, 0])
  assert.deepEqual(rest.bones[0].skinningMatrix, identity)
  assert.equal(rest.bones[1].skinningMatrix, undefined)
  const clip = {
    id: 'move',
    name: 'Move',
    kind: 'animation',
    provenance: 'direct',
    frames: 2,
    hierarchyId: 'rig',
    channels: [
      {
        target: 'joint/9',
        kind: 'translation',
        firstFrame: 0,
        lastFrame: 1,
        interpolation: 'linear',
        samples: [
          { frame: 0, timeSeconds: 0, value: [10, 0, 0] },
          { frame: 1, timeSeconds: 1, value: [20, 0, 0] },
        ],
      },
    ],
  }
  const sampler = createModelPoseSampler({ bindings, hierarchyId: 'rig', clip })
  const posed = sampler.sample(0.5)
  assert.deepEqual(posed.bones[0].worldMatrix.slice(12, 15), [15, 2, 0])
  assert.deepEqual(posed.bones[0].skinningMatrix.slice(12, 15), [5, 0, 0])
  sampler.sample(1)
  assert.deepEqual(posed.bones[0].worldMatrix.slice(12, 15), [15, 2, 0])
  assert.throws(() => {
    posed.bones[0].worldMatrix[12] = 999
  }, TypeError)
})

test('skeleton source and sampler own all authored pose and bind arrays', async () => {
  const bindings = [bone(0, null, [7, 0, 0], [...identity])]
  const source = createModelSkeletonSource({ bindings, hierarchies: 1 })
  const sampler = createModelPoseSampler({ bindings, hierarchyId: 'rig' })
  bindings[0].localPose.translation[0] = 99
  bindings[0].inverseBindMatrix[12] = 99
  const stored = (await source.bindings({ limit: 1 })).items[0]
  assert.equal(stored.localPose.translation[0], 7)
  assert.equal(stored.inverseBindMatrix[12], 0)
  assert.equal(sampler.sample(0).bones[0].skinningMatrix[12], 7)
})

test('unknown joins, cycles, malformed poses, limits and cancellation are refused', () => {
  const valid = [bone(0, null, [0, 0, 0], [...identity])]
  const compile = bindings => createModelPoseSampler({ bindings, hierarchyId: 'rig' })
  assert.throws(() => compile([bone(0, 1, [0, 0, 0])]), /parent/)
  assert.throws(() => compile([bone(0, 0, [0, 0, 0])]), /cyclic/)
  assert.throws(() => compile([...valid, ...valid]), /ambiguous/)
  assert.throws(() => compile([{ ...valid[0], localPose: undefined }]), /local pose/)
  assert.throws(() => compile([{ ...valid[0], inverseBindMatrix: [NaN] }]), TypeError)
  assert.throws(() => compile([{ ...valid[0], inverseBindMatrix: [1, 2] }]), /inverse bind/)
  assert.throws(
    () => snapshotModelSkeleton(valid, { maxDepth: 32, maxNodes: 2, maxBytes: 10000 }),
    /budget|maxNodes/,
  )
  assert.throws(() => snapshotModelSkeleton(valid, undefined, AbortSignal.abort()), /cancelled/)
  assert.throws(() => compile(valid).sample(0, AbortSignal.abort()), /cancelled/)
  assert.throws(() => compile(valid).sample(Infinity), /finite/)
  const clip = {
    id: 'bad',
    name: 'Bad',
    kind: 'rest-pose',
    provenance: 'direct',
    frames: 1,
    channels: [
      {
        target: 'missing',
        kind: 'translation',
        firstFrame: 0,
        lastFrame: 0,
        interpolation: 'step',
        samples: [{ frame: 0, timeSeconds: 0, value: [0, 0, 0] }],
      },
    ],
  }
  assert.throws(
    () => createModelPoseSampler({ bindings: valid, hierarchyId: 'rig', clip }).sample(0),
    /target/,
  )
})
