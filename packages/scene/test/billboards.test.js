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
test('common node constraint turns the node by the camera rotation and propagates adjusted scaled parents', () => {
  const before = structuredClone(projection),
    s = Math.sin(Math.PI / 4),
    c = Math.cos(Math.PI / 4)
  const sampler = createModelSceneSampler(projection, {
    billboards: [{ nodeId: 'root', mode: 'inverse-camera', basisRotations: [] }],
    billboardCameraRotation: [0, 0, s, c],
  })
  const sampled = sampler.sample(0)
  close(sampled.nodeTransforms.get('root'), [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])
  close(sampled.nodeTransforms.get('child'), [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 2, 2, 0, 1])
  assert.deepEqual(
    sampled.joints.map(joint => joint.position.map(value => Math.round(value))),
    [
      [2, 0, 0],
      [2, 2, 0],
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
  close(result[0].skinningMatrix, [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])
  close(result[1].skinningMatrix, [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 2, 2, 0, 1])
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

test('an inverse-camera billboard faces the camera from every side, as mdx-m3-viewer turns it', () => {
  // A look-at view from an eye onto the origin, z up (mdx-m3-viewer's Warcraft III and StarCraft II
  // worlds), column-major like every view the renderers pass.
  const lookAt = eye => {
    const length = Math.hypot(...eye),
      forward = eye.map(value => -value / length),
      up = Math.abs(forward[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1]
    let side = [
      forward[1] * up[2] - forward[2] * up[1],
      forward[2] * up[0] - forward[0] * up[2],
      forward[0] * up[1] - forward[1] * up[0],
    ]
    const sideLength = Math.hypot(...side)
    side = side.map(value => value / sideLength)
    const above = [
      side[1] * forward[2] - side[2] * forward[1],
      side[2] * forward[0] - side[0] * forward[2],
      side[0] * forward[1] - side[1] * forward[0],
    ]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    return [
      side[0], above[0], -forward[0], 0,
      side[1], above[1], -forward[1], 0,
      side[2], above[2], -forward[2], 0,
      -dot(side, eye), -dot(above, eye), dot(forward, eye), 1,
    ]
  }
  const s = Math.SQRT1_2,
    bone = {
      ...root,
      nodeId: 'node-0',
      localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    pose = [{ boneIndex: 0, nodeId: 'node-0', worldMatrix: identity, skinningMatrix: identity }]
  // Warcraft III (mdx-m3-viewer mdx/node.ts: rotateY(-π/2), rotateX(-π/2)) and StarCraft II
  // (m3/node.ts: rotateZ(π/2), rotateY(-π/2)) both turn the node's +X toward the viewer.
  const bases = {
    mdx: [
      [0, -s, 0, s],
      [-s, 0, 0, s],
    ],
    m3: [
      [0, 0, s, s],
      [0, -s, 0, s],
    ],
  }
  for (const [format, basisRotations] of Object.entries(bases))
    for (const eye of [
      [5, 0, 0],
      [0, 5, 0],
      [-5, 0, 0],
      [0, -5, 0],
      [3, 3, 3],
      [-2, 4, -1],
    ]) {
      const [world] = applyModelBillboards(
        pose,
        [bone],
        [{ nodeId: 'node-0', mode: 'inverse-camera', basisRotations }],
        billboardCameraRotation(lookAt(eye)),
        identity,
        100000,
      )
      const toCamera = eye.map(value => value / Math.hypot(...eye)),
        x = world.worldMatrix.slice(0, 3)
      assert(
        Math.abs(x[0] * toCamera[0] + x[1] * toCamera[1] + x[2] * toCamera[2] - 1) < 1e-6,
        `${format} from ${eye}: +X ${x} does not face the camera`,
      )
      // A Warcraft III card stands upright for a level camera.
      if (format === 'mdx' && eye[2] === 0) close(world.worldMatrix.slice(8, 11), [0, 0, 1])
    }
})

test('a node declares its own camera rule, and a viewer hands the camera to every sample', () => {
  const s = Math.SQRT1_2,
    declared = {
      ...projection,
      nodes: projection.nodes.map(node =>
        node.id === 'root' ? { ...node, billboard: { mode: 'inverse-camera', basisRotations: [] } } : node,
      ),
    }
  const sampler = createModelSceneSampler(declared, { billboardCameraPerSample: true })
  // A camera that comes with every sample is not missing at creation.
  assert.deepEqual(sampler.diagnostics, [])
  close(sampler.sample(0).nodeTransforms.get('root'), rootMatrix)
  close(sampler.sample(0, undefined, { rotation: [0, 0, s, s] }).nodeTransforms.get('root'), [
    0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1,
  ])
  // The same sampler follows the camera round without being rebuilt.
  close(sampler.sample(0, undefined, { rotation: [0, 0, -s, s] }).nodeTransforms.get('root'), [
    0, -2, 0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1,
  ])
  // A rule the caller states for the node wins over the node's own.
  const stated = createModelSceneSampler(declared, {
    billboards: [{ nodeId: 'root', mode: 'inverse-camera', basisRotations: [[0, 0, 1, 0]] }],
    billboardCameraRotation: [0, 0, 0, 1],
  })
  close(stated.sample(0).nodeTransforms.get('root'), [-2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])
  // A camera rule on a node no binding poses is reported, not fatal.
  const rigid = createModelSceneSampler(
    { ...declared, skeleton: [] },
    { billboardCameraPerSample: true },
  )
  assert.deepEqual(
    rigid.diagnostics.map(item => item.code),
    ['common.model/billboard-node-unsupported'],
  )
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

// BBSC billboards as the engine builds them (CBBSolver::ApplyBillboard, as WhiteoutFlakes reads
// it): rows of the basis are the joint's local axes in the skeleton's frame.
const aimBindings = [
  { ...root, localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  child,
]
const aimPose = rootWorld => [
  { boneIndex: 0, nodeId: 'root', worldMatrix: rootWorld },
  { boneIndex: 1, nodeId: 'child', worldMatrix: [...rootWorld.slice(0, 12), 1, 0, 0, 1] },
]
const s = Math.SQRT1_2
test('a free aim billboard lays local +Y along the view, local +X across the camera up', () => {
  const posed = applyModelBillboards(
    aimPose(identity),
    aimBindings,
    [{ nodeId: 'child', mode: 'aim', aim: 'view', lock: 'free' }],
    [0, 0, 0, 1],
    identity,
    1 << 20,
  )
  // camera looks along -Z with +Y up: X = d × up = +X, Y = d = -Z, Z = X × d = +Y
  close(posed[1].worldMatrix, [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
})
test('a frame-Z aim billboard stays upright under a tilted camera', () => {
  const posed = applyModelBillboards(
    aimPose(identity),
    aimBindings,
    [{ nodeId: 'child', mode: 'aim', aim: 'view', lock: 'frame-z' }],
    [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)],
    identity,
    1 << 20,
  )
  close(posed[1].worldMatrix.slice(8, 11), [0, 0, 1])
  close(posed[1].worldMatrix.slice(4, 7), [0, 1, 0])
})
test('a root aim billboard keeps its sampled spin and takes its root correction after it', () => {
  // sampled spin: 90° about local Z
  const rootWorld = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const posed = applyModelBillboards(
    aimPose(rootWorld),
    aimBindings,
    [{ nodeId: 'root', mode: 'aim', aim: 'view', lock: 'free', rootCorrection: [0, 0, 0, 1] }],
    [0, 0, 0, 1],
    identity,
    1 << 20,
  )
  // basis [+X, -Z, +Y] times the spin: columns -Z, -X, +Y
  close(posed[0].worldMatrix.slice(0, 11), [0, 0, -1, 0, -1, 0, 0, 0, 0, 1, 0])
})
test('an eye aim billboard points local +Y from the eye to the joint', () => {
  const posed = applyModelBillboards(
    aimPose(identity),
    aimBindings,
    [{ nodeId: 'child', mode: 'aim', aim: 'eye', lock: 'frame-z' }],
    [0, 0, 0, 1],
    identity,
    1 << 20,
    undefined,
    [1, -5, 0],
  )
  // the joint sits at (1, 0, 0): from the eye it is +Y, so the upright card keeps its axes
  close(posed[1].worldMatrix.slice(4, 7), [0, 1, 0])
  close(posed[1].worldMatrix.slice(0, 3), [1, 0, 0])
})
test('an aim constraint round-trips through UV_node_billboard and its snapshot', () => {
  const constraint = { nodeId: 'node-0', mode: 'aim', aim: 'eye', lock: 'own-y', correction: [0, 0, s, s] }
  assert.deepEqual(snapshotModelBillboards([constraint], 4096), [constraint])
  const document = {
    extensionsUsed: ['UV_node_billboard'],
    nodes: [{ extensions: { UV_node_billboard: { schemaVersion: 1, mode: 'aim', aim: 'eye', lock: 'own-y', correction: [0, 0, s, s] } } }],
  }
  assert.deepEqual(readUvmBillboards(document, 4096), [constraint])
  assert.throws(() => snapshotModelBillboards([{ ...constraint, lock: 'sideways' }], 4096))
})
