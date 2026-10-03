import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { createModelSkinDeformer } from '@modkit/codec-kit/model/skinning'
import { decodeUvmGeometry } from '../src/uvm/geometry.js'
import { boundUvmRig } from '../src/uvm/rig-bounds.js'
import { projectUvmRigModel } from '../src/uvm/rig-model.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const bones = Array.from({ length: 8 }, (_value, index) => ({
  boneIndex: index,
  parentBoneIndex: null,
  hierarchyId: 'h',
  partId: `p${index}`,
  nodeId: `n${index}`,
  provenance: 'direct',
  boneName: `joint${index}`,
  inverseBindMatrix: identity,
  localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
}))
const primitive = {
  id: 'triangle',
  topology: 'triangles',
  hierarchyId: 'h',
  boneInfluences: 8,
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  indices: Uint32Array.of(0, 1, 2),
  boneIndices: Uint32Array.from({ length: 24 }, (_value, i) => i % 8),
  boneWeights: Float32Array.from({ length: 24 }, (_value, i) =>
    i % 8 === 7 ? 0.5 : i % 8 === 0 ? 0.5 : 0,
  ),
}
const nodes = [
  ...createModelSkeletonNodes(bones, 'h'),
  { id: 'mesh', childIds: [], meshIds: ['m'], transform: identity },
]
const projection = {
  info: {
    scenes: 1,
    nodes: nodes.length,
    meshes: 1,
    primitives: 1,
    materials: 0,
    textures: 0,
    animations: 0,
    geometryAccess: 'decoded',
  },
  nodes,
  meshes: [{ id: 'm', primitiveIds: ['triangle'] }],
  primitives: [primitive],
  skeleton: bones,
}
const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:eight',
  options: { assetId: 'eight', sourceFormat: 'fixture' },
}

test('roundtrips both UVM weight sets without normalization or truncation', () => {
  const exported = materializeUvmCore(projection, request)
  const container = readUvmContainer(exported.bytes)
  assert.throws(
    () =>
      projectUvmRigModel(container, {
        maxInputBytes: 1n << 30n,
        maxDepth: 64,
        maxNodes: 10000,
        maxScalarBytes: 1 << 24,
        maxDiagnostics: 100,
      }),
    /native rig authoring supports at most four/,
  )
  const attributes = container.document.meshes[0].primitives[0].attributes
  assert.ok(Number.isInteger(attributes.JOINTS_1))
  assert.ok(Number.isInteger(attributes.WEIGHTS_1))
  const decode = document =>
    decodeUvmGeometry(document, container.binary, { maxScalarBytes: 1 << 24 })
  const reopened = decode(container.document).primitives[0]
  assert.equal(reopened.boneInfluences, 8)
  assert.deepEqual([...reopened.boneWeights], [...primitive.boneWeights])
  assert.deepEqual([...reopened.boneIndices], [...primitive.boneIndices])
  const poses = bones.map((bone, i) => ({
    boneIndex: i,
    skinningMatrix: [...identity.slice(0, 12), i === 7 ? 8 : 0, 0, 0, 1],
  }))
  const moved = createModelSkinDeformer(
    primitive,
    bones.map(bone => bone.boneIndex),
  ).deform(poses)
  assert.deepEqual([...moved.positions], [4, 0, 0, 5, 0, 0, 4, 1, 0])
  const broken = structuredClone(container.document)
  delete broken.meshes[0].primitives[0].attributes.WEIGHTS_1
  assert.throws(() => decode(broken), /paired/)
  assert.throws(
    () => decodeUvmGeometry(container.document, container.binary, { maxScalarBytes: 32 }),
    /budget|maxScalarBytes/,
  )
})

test('bounds include a distant joint in the second weight set', () => {
  const far = bones.map((bone, i) => ({
    ...bone,
    localPose: { ...bone.localPose, translation: [i === 7 ? 100 : 0, 0, 0] },
  }))
  const bounded = boundUvmRig(far, [primitive], [], { maxNodes: 10000 })
  assert.ok(bounded.radius >= 100)
})
