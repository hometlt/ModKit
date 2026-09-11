import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelSceneSampler } from '../src/model/sampler.js'
import {
  applyModelFaceCameraBillboard,
  applyModelBillboards,
  billboardCameraRotation,
  snapshotModelBillboards,
} from '../src/model/billboards.js'
import { readUvmBillboards } from '../src/uvm/billboards.js'
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++)
    assert(
      Math.abs(actual[i] - expected[i]) < 1e-6,
      `component ${i}: ${actual[i]} != ${expected[i]}`,
    )
}
const root = {
  partId: 'skin',
  hierarchyId: 'skin',
  boneIndex: 0,
  boneName: 'root',
  nodeId: 'root',
  provenance: 'direct',
  parentBoneIndex: null,
  inverseBindMatrix: identity,
  localPose: {
    translation: [2, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [2, 3, 1],
  },
}
const child = {
  ...root,
  boneIndex: 1,
  boneName: 'child',
  nodeId: 'child',
  parentBoneIndex: 0,
  localPose: {
    translation: [1, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
}
const rootMatrix = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1],
  childMatrix = [...identity.slice(0, 12), 1, 0, 0, 1]
const projection = {
  nodes: [
    {
      id: 'root',
      name: 'root',
      childIds: ['child'],
      meshIds: [],
      transform: rootMatrix,
    },
    {
      id: 'child',
      name: 'child',
      childIds: [],
      meshIds: [],
      transform: childMatrix,
    },
  ],
  meshes: [],
  primitives: [],
  skeleton: [root, child],
}
test('common node constraint samples inverse camera rotation and propagates adjusted scaled parents', () => {
  const before = structuredClone(projection),
    s = Math.sin(Math.PI / 4),
    c = Math.cos(Math.PI / 4)
  const sampler = createModelSceneSampler(projection, {
    billboards: [{ nodeId: 'root', mode: 'inverse-camera', basisRotations: [] }],
    billboardCameraRotation: [0, 0, s, c],
  })
  const sampled = sampler.sample(0)
  close(sampled.nodeTransforms.get('root'), [0, -2, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])
  close(sampled.nodeTransforms.get('child'), [0, -2, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 2, -2, 0, 1])
  assert.deepEqual(
    sampled.joints.map(joint => joint.position.map(value => Math.round(value))),
    [
      [2, 0, 0],
      [2, -2, 0],
    ],
  )
  assert.deepEqual(projection, before)
})
test('billboard skin matrices use adjusted worlds and preserve the exact authored pose without a camera', () => {
  const worldChild = [...rootMatrix.slice(0, 12), 4, 0, 0, 1],
    pose = [
      {
        boneIndex: 0,
        nodeId: 'root',
        worldMatrix: rootMatrix,
        skinningMatrix: rootMatrix,
      },
      {
        boneIndex: 1,
        nodeId: 'child',
        worldMatrix: worldChild,
        skinningMatrix: worldChild,
      },
    ],
    constraints = [{ nodeId: 'root', mode: 'inverse-camera', basisRotations: [] }],
    before = structuredClone(pose),
    s = Math.SQRT1_2
  assert.equal(
    applyModelBillboards(pose, [root, child], constraints, undefined, identity, 100000),
    pose,
  )
  const result = applyModelBillboards(
    pose,
    [root, child],
    constraints,
    [0, 0, s, s],
    identity,
    100000,
  )
  close(result[0].skinningMatrix, [0, -2, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])
  close(result[1].skinningMatrix, [0, -2, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 2, -2, 0, 1])
  assert.deepEqual(pose, before)
  assert.throws(
    () => applyModelBillboards(pose, [root, child], constraints, [0, 0, s, s], identity, 1),
    /budget/,
  )
})
test('public UVM declaration validates ordered basis rotations and owns the source values', () => {
  const s = Math.sin(Math.PI / 4),
    c = Math.cos(Math.PI / 4),
    document = {
      asset: { version: '2.0' },
      nodes: [
        {
          extensions: {
            UV_node_billboard: {
              schemaVersion: 1,
              mode: 'inverse-camera',
              basisRotations: [
                [0, 0, s, c],
                [0, -s, 0, c],
              ],
            },
          },
        },
      ],
      extensionsUsed: ['UV_node_billboard'],
    }
  const constraints = readUvmBillboards(document, 100000),
    bone = {
      ...root,
      nodeId: 'node-0',
      localPose: {
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
    pose = [
      {
        boneIndex: 0,
        nodeId: 'node-0',
        worldMatrix: identity,
        skinningMatrix: identity,
      },
    ]
  const result = applyModelBillboards(pose, [bone], constraints, [0, 0, 0, 1], identity, 100000)
  close(result[0].worldMatrix, [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1])
  document.nodes[0].extensions.UV_node_billboard.basisRotations[0][2] = 0
  assert.equal(constraints[0].basisRotations[0][2], s)
  assert.throws(
    () =>
      snapshotModelBillboards(
        [
          {
            nodeId: 'root',
            mode: 'inverse-camera',
            basisRotations: [[0, 0, 0, 0]],
          },
        ],
        100000,
      ),
    /nonzero/,
  )
  assert.throws(() => readUvmBillboards({ ...document, extensionsUsed: [] }, 100000), /declaration/)
})
test('camera world orientation comes from inverse view and common frame is applied only once', () => {
  const view = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    rotation = billboardCameraRotation(view)
  close(rotation, [0, 0, Math.SQRT1_2, Math.SQRT1_2])
  const frame = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const framed = {
    ...projection,
    nodes: [
      {
        id: 'frame',
        name: 'frame',
        childIds: ['root'],
        meshIds: [],
        transform: frame,
      },
      ...projection.nodes,
    ],
  }
  const sampled = createModelSceneSampler(framed, {
    billboards: [{ nodeId: 'root', mode: 'inverse-camera', basisRotations: [] }],
    billboardCameraRotation: rotation,
  }).sample(0)
  close(sampled.nodeTransforms.get('root'), [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1])
  close(sampled.nodeTransforms.get('child'), [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, 1])
})

test('position-facing billboard rotates rigid nodes around a local pivot and propagates to children', () => {
  const rigid = {
    nodes: [
      { id: 'root', name: 'root', childIds: ['child'], meshIds: [], transform: identity },
      {
        id: 'child',
        name: 'child',
        childIds: [],
        meshIds: [],
        transform: [...identity.slice(0, 12), 2, 0, 0, 1],
      },
    ],
    meshes: [],
    primitives: [],
  }
  const sampled = createModelSceneSampler(rigid, {
    billboards: [
      { nodeId: 'root', mode: 'face-camera', rotationAxes: 'z', pivot: [1, 0, 0] },
    ],
    billboardCameraPosition: [2, 0, 0],
  }).sample(0)
  close(sampled.nodeTransforms.get('root'), [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1])
  close(sampled.nodeTransforms.get('child'), [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, -1, 0, 1])
  const pitched = applyModelFaceCameraBillboard(
    identity,
    { nodeId: 'root', mode: 'face-camera', rotationAxes: 'xz', pivot: [0, 0, 0] },
    [0, 1, 1],
  )
  close(pitched, [1, 0, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0, -Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 0, 1])
  assert.throws(
    () => createModelSceneSampler(
      {
        ...projection,
        nodes: [
          { id: 'frame', name: 'frame', childIds: ['root'], meshIds: [], transform: identity },
          ...projection.nodes,
        ],
      },
      {
        billboards: [
          { nodeId: 'frame', mode: 'face-camera', rotationAxes: 'z', pivot: [0, 0, 0] },
        ],
        billboardCameraPosition: [0, 1, 0],
      },
    ),
    /skinned hierarchy/,
  )
})

test('UVM schema 1 position-facing declaration is owned and rejects malformed pivots', () => {
  const document = {
    asset: { version: '2.0' },
    nodes: [{ extensions: { UV_node_billboard: {
      schemaVersion: 1,
      mode: 'face-camera',
      rotationAxes: 'xz',
      pivot: [2, 3, 5],
    } } }],
    extensionsUsed: ['UV_node_billboard'],
  }
  const constraints = readUvmBillboards(document, 100000)
  assert.deepEqual(constraints, [{
    nodeId: 'node-0',
    mode: 'face-camera',
    rotationAxes: 'xz',
    pivot: [2, 3, 5],
  }])
  document.nodes[0].extensions.UV_node_billboard.pivot[0] = 99
  assert.equal(constraints[0].pivot[0], 2)
  assert.throws(
    () => snapshotModelBillboards([
      { nodeId: 'root', mode: 'face-camera', rotationAxes: 'xz', pivot: [0, 0] },
    ], 100000),
    /three finite/,
  )
})
