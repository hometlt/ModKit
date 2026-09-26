import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { projectUvmRigModel } from '../src/uvm/rig-model.js'
import { multiplyMaterialFrames } from '../src/materials/frame.js'

const budget = {
  maxInputBytes: 1n << 30n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1 << 24,
  maxDiagnostics: 100,
}
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
// z-up -> y-up (x, y, z) -> (x, -z, y), times 2, then moved: a source coordinate frame with units.
const FRAME = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 1, 2, 3, 1]
// The smallest common render program static authoring accepts: one constant white diffuse layer.
const renderModel = {
  version: 1,
  standard: {
    layers: {
      diffuse: {
        slot: 'diffuse',
        texturePath: null,
        uvSource: 0,
        channels: 0,
        op: 6,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: false,
        wrapY: false,
        constantColor: { value: [1, 1, 1, 1] },
      },
    },
    blendMode: 0,
    priority: 0,
    specularity: 0,
    specMult: 0,
    emisMult: 0,
    environmentMultipliers: [1, 0, 0],
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: false,
    unshaded: true,
    depthPrepass: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
  },
}

/**
 * A two-joint rig under a source coordinate frame, the shape a z-up game exports: vertices,
 * inverse binds and the root track in native axes, the tip joint also an attachment point.
 */
function framedRig(frame = FRAME) {
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [4] }],
    nodes: [
      { name: 'Body' },
      {
        name: 'Root',
        translation: [0, 0, 1],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        children: [2],
      },
      {
        name: 'Tip',
        translation: [0, 0, 2],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        extensions: { UV_game_socket: { role: 'attach', sourceName: 'Tip' } },
      },
      { name: 'Model', children: [0, 1] },
      { name: 'Source coordinate frame', matrix: frame, children: [3] },
    ],
    materials: [
      {
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
        extensions: {
          UV_game_material: { shader: 'modkit.render-material.v1', params: { renderModel } },
        },
      },
    ],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_socket', 'UV_game_material'],
    extensions: {
      UV_asset: { id: 'rig-frame', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
    },
  }
  const written = appendUvmAccessors(
    { format: 'glb', document, binary: new Uint8Array(), extraChunks: [] },
    [
      { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, 4) },
      { type: 'VEC4', values: Uint16Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0) },
      { type: 'VEC4', values: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0) },
      { type: 'MAT4', values: Float32Array.from([...translate(0, 0, -1), ...translate(0, 0, -3)]) },
      { type: 'SCALAR', values: Float32Array.of(0, 1) },
      { type: 'VEC3', values: Float32Array.of(0, 0, 1, 0, 0, 2) },
    ],
  )
  const container = structuredClone(written.container)
  const [positions, joints, weights, inverseBinds, times, rootTrack] = written.accessors
  const d = container.document
  Object.assign(d.nodes[0], { mesh: 0, skin: 0 })
  d.meshes = [
    {
      primitives: [
        {
          attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights },
          material: 0,
          mode: 4,
        },
      ],
    },
  ]
  d.skins = [{ joints: [1, 2], inverseBindMatrices: inverseBinds }]
  d.animations = [
    {
      name: 'Stand',
      extras: { uv: { sourceSequenceIndex: 0, sourceDurationSeconds: 1 } },
      samplers: [{ input: times, output: rootTrack, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
    },
  ]
  return container
}

/** Column-major TRS, the matrix a rest pose stands for. */
function trs({ translation: [tx, ty, tz], rotation: [x, y, z, w], scale: [sx, sy, sz] }) {
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]
}
const close = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label)
  for (const [index, value] of expected.entries())
    assert.ok(
      Math.abs(actual[index] - value) < 1e-5,
      `${label}[${index}]: ${actual[index]} != ${value}`,
    )
}

test('a source coordinate frame over the skeleton is baked, keeping every world pose', () => {
  const result = projectUvmRigModel(framedRig(), budget)
  const [root, tip] = result.restPoses
  const rootWorld = trs(root)
  const tipWorld = multiplyMaterialFrames(rootWorld, trs(tip))
  // The same world poses the document states through its node chain: F * native pose.
  close(rootWorld, multiplyMaterialFrames(FRAME, translate(0, 0, 1)), 'root world')
  close(tipWorld, multiplyMaterialFrames(FRAME, translate(0, 0, 3)), 'tip world')

  // IBM' = IBM * F^-1 is reversible, and the bind pose is now the identity in mesh space.
  for (const [pose, world, native] of [
    [root, rootWorld, translate(0, 0, -1)],
    [tip, tipWorld, translate(0, 0, -3)],
  ]) {
    close(multiplyMaterialFrames(pose.inverseBindMatrix, FRAME), native, `${pose.name} IBM' * F`)
    close(
      multiplyMaterialFrames(world, pose.inverseBindMatrix),
      translate(0, 0, 0),
      `${pose.name} bind`,
    )
  }

  // Vertices are in the baked mesh space: F * v.
  const mesh = result.model.meshes[0]
  close([...mesh.positions], [1, 2, 3, 3, 2, 3, 1, 10, 3], 'positions')

  // The root track moves in the parent space it now has: F * t.
  const track = result.model.animations[0].nodeTracks.find(entry => entry.boneIndex === 0)
  close(
    track.translation.keys.flatMap(key => key.vector),
    [1, 4, 3, 1, 6, 3],
    'root translation keys',
  )
})

test('an identity frame changes nothing', () => {
  const result = projectUvmRigModel(framedRig(translate(0, 0, 0)), budget)
  close(result.restPoses[0].translation, [0, 0, 1], 'root translation')
  close(result.restPoses[0].inverseBindMatrix, translate(0, 0, -1), 'root IBM')
  close([...result.model.meshes[0].positions], [0, 0, 0, 1, 0, 0, 0, 0, 4], 'positions')
})

test('a mirrored or non-uniform frame is refused, not baked', () => {
  assert.throws(
    () => projectUvmRigModel(framedRig([-2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 0, 0, 0, 1]), budget),
    /must not mirror/,
  )
  assert.throws(
    () => projectUvmRigModel(framedRig([2, 0, 0, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0, 0, 0, 1]), budget),
    /uniform scale, rotation and translation/,
  )
})
