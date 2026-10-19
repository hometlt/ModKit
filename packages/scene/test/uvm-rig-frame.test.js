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
function framedRig(frame = FRAME, { cubic } = {}) {
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
      {
        type: 'VEC3',
        // CUBICSPLINE keeps [in, value, out] per key; the ends' outer tangents are zero.
        values: cubic
          ? Float32Array.of(0, 0, 0, 0, 0, 1, ...cubic.leaving, ...cubic.arriving, 0, 0, 2, 0, 0, 0)
          : Float32Array.of(0, 0, 1, 0, 0, 2),
      },
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
      samplers: [{ input: times, output: rootTrack, interpolation: cubic ? 'CUBICSPLINE' : 'LINEAR' }],
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

test('identity skinned mesh below either joint keeps world positions without double ancestry', () => {
  for (const parent of [1, 2]) {
    const source = framedRig()
    source.document.nodes[3].children = [1]
    source.document.nodes[parent].children = [...(source.document.nodes[parent].children ?? []), 0]
    const result = projectUvmRigModel(source, budget)
    const sibling = projectUvmRigModel(framedRig(), budget)
    assert.deepEqual(result.restPoses, sibling.restPoses)
    assert.deepEqual(result.model.meshes[0].positions, sibling.model.meshes[0].positions)
    const [root, tip] = result.restPoses, mesh = result.model.meshes[0]
    const track = result.model.animations[0].nodeTracks.find(entry => entry.boneIndex === 0).translation
    for (const time of [0, .25, 1]) {
      const translation = track.keys[0].vector.map((v, i) => v * (1-time) + track.keys[1].vector[i] * time)
      const worlds = [trs({...root, translation})]
      worlds.push(multiplyMaterialFrames(worlds[0], trs(tip)))
      for (let vertex = 0; vertex < 3; vertex++) {
        const bone = mesh.boneIndices[vertex * 4], matrix = multiplyMaterialFrames(worlds[bone], result.restPoses[bone].inverseBindMatrix)
        const p = mesh.positions.slice(vertex * 3, vertex * 3 + 3)
        const actual = [0,1,2].map(axis => matrix[axis]*p[0]+matrix[axis+4]*p[1]+matrix[axis+8]*p[2]+matrix[axis+12])
        // Independent glTF skin expectation: F * (original vertex + animated root delta).
        const native = [[0,0,0],[1,0,0],[0,0,4]][vertex], q = [native[0], native[1], native[2]+time]
        const expected = [0,1,2].map(axis => FRAME[axis]*q[0]+FRAME[axis+4]*q[1]+FRAME[axis+8]*q[2]+FRAME[axis+12])
        close(actual, expected, `joint ${parent}, t ${time}, vertex ${vertex}`)
      }
    }
    source.document.nodes[0].translation = [1,0,0]
    assert.throws(() => projectUvmRigModel(source, budget), /frames must be identity/)
    source.document.nodes[0].translation = [0,0,0]
    const helper = source.document.nodes.length
    source.document.nodes.push({name:'Nonidentity mesh helper',translation:[1,0,0],children:[0]})
    source.document.nodes[parent].children = source.document.nodes[parent].children.map(id => id===0?helper:id)
    assert.throws(() => projectUvmRigModel(source, budget), /frames must be identity/)
  }
})

test('a cubic root track keeps its tangents, turned by the frame and not moved by it', () => {
  const cubic = { leaving: [0, 1, 0], arriving: [1, 0, 0] }
  const result = projectUvmRigModel(framedRig(FRAME, { cubic }), budget)
  const { translation } = result.model.animations[0].nodeTracks.find(entry => entry.boneIndex === 0)
  // The shared sampler's cubic line type: glTF CUBICSPLINE tangents, derivatives per second.
  assert.equal(translation.lineType, 4)
  close(translation.keys.flatMap(key => key.vector), [1, 4, 3, 1, 6, 3], 'values: F * t')
  // A derivative takes only the linear part (x, y, z) -> 2 * (x, z, -y); the offset (1, 2, 3) is
  // not added to it.
  close(translation.keys[0].outTan, [0, 0, -2], 'leaving tangent')
  close(translation.keys[1].inTan, [2, 0, 0], 'arriving tangent')
  close(translation.keys[0].inTan, [0, 0, 0], 'first arriving tangent')
})

test('the bounds cover a cubic track that overshoots both of its keys', () => {
  // Root z goes 1 -> 2 in one second, leaving at +6/s and arriving at -6/s: between the keys the
  // curve p(t) = -2t^3 - 3t^2 + 6t + 1 peaks near 3.09, past both of them.
  const cubic = { leaving: [0, 0, 6], arriving: [0, 0, -6] }
  const result = projectUvmRigModel(framedRig(translate(0, 0, 0), { cubic }), budget)
  const p = t => {
    const [h00, h10, h01, h11] = [
      2 * t ** 3 - 3 * t ** 2 + 1,
      t ** 3 - 2 * t ** 2 + t,
      -2 * t ** 3 + 3 * t ** 2,
      t ** 3 - t ** 2,
    ]
    return h00 * 1 + h10 * 6 + h01 * 2 + h11 * -6
  }
  let farthest = 0,
    peak = 0
  for (let step = 0; step <= 1000; step += 1) {
    const z = p(step / 1000)
    peak = Math.max(peak, z)
    // Skinned vertices: (0,0,0) and (1,0,0) ride the root at z - 1, (0,0,4) the tip at z + 3.
    farthest = Math.max(farthest, Math.abs(z - 1), Math.hypot(1, z - 1), Math.abs(z + 3))
  }
  assert.ok(peak > 3, `the curve overshoots its keys (${peak})`)
  // The keys alone would put the tip vertex at 5; the curve takes it past that, and the bound too.
  assert.ok(farthest > 5)
  assert.ok(result.bounds.radius >= farthest, `${result.bounds.radius} covers ${farthest}`)
})

test('a skin keeps the source joint order the materializer writes, nothing else', () => {
  const plain = projectUvmRigModel(framedRig(), budget)
  const ordered = framedRig()
  ordered.document.skins[0].extensions = { UV_game_skeleton: { sourceOrder: [0, 1] } }
  assert.deepEqual(projectUvmRigModel(ordered, budget).model.skeleton, plain.model.skeleton)
  const foreign = framedRig()
  foreign.document.skins[0].extensions = { OTHER: {} }
  assert.throws(() => projectUvmRigModel(foreign, budget), /skin\.extensions\.OTHER is outside/)
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

test('how a clip plays and its events ride on the rig clip, an event joint as its bone', () => {
  const container = framedRig(translate(0, 0, 0))
  container.document.animations[0].extensions = {
    UV_game_animation_clips: { loop: 'loop', priority: 20, blendInSeconds: 0.15 },
    UV_game_animation_events: {
      events: [
        { t: 0.5, name: 'fire_weapon', socket: 2, payload: { weapon: 'cannon' } },
        { t: 0.9, name: 'sound' },
      ],
    },
  }
  const [clip] = projectUvmRigModel(container, budget).model.animations
  assert.deepEqual(
    { loop: clip.loop, priority: clip.priority, blendInSeconds: clip.blendInSeconds },
    { loop: 'loop', priority: 20, blendInSeconds: 0.15 },
  )
  // node 2 is the skin's second joint: bone 1
  assert.deepEqual(clip.events, [
    { timeSeconds: 0.5, name: 'fire_weapon', boneIndex: 1, payload: { weapon: 'cannon' } },
    { timeSeconds: 0.9, name: 'sound' },
  ])
})

test('primitive affine correspondence preserves normals, winding and source arrays', async()=>{
  const {transformUvmPrimitiveGeometry}=await import('../src/uvm/static-model.js')
  const p={positions:Float32Array.of(0,0,0,1,0,0,0,1,0),indices:Uint16Array.of(0,1,2),
    normals:Float32Array.of(0,0,1,0,0,1,0,0,1),tangents:Float32Array.of(1,0,0,1,1,0,0,1,1,0,0,1)}
  const before=structuredClone(p)
  const r=transformUvmPrimitiveGeometry(p,[-2,0,0,0,0,3,0,0,0,0,4,0,5,6,7,1])
  assert.deepEqual(r.positions,[5,6,7,3,6,7,5,9,7]);assert.deepEqual(r.indices,[0,2,1])
  assert.deepEqual(r.normals,[0,0,1,0,0,1,0,0,1]);assert.deepEqual(r.tangents,[-1,0,0,-1,-1,0,0,-1,-1,0,0,-1])
  assert.deepEqual(p,before)
  assert.throws(()=>transformUvmPrimitiveGeometry(p,new Array(16).fill(0)))
  assert.throws(()=>transformUvmPrimitiveGeometry({...p,indices:[0,1,3]},translate(0,0,0)))
  assert.throws(()=>transformUvmPrimitiveGeometry({...p,normals:Float32Array.of(0,0,0)},translate(0,0,0)))
})

test('normal generation keeps one side of cancelling faces and refuses zero-area-only vertices',async()=>{
  const {generateUvmVertexNormals}=await import('../src/uvm/normals.js')
  assert.deepEqual([...generateUvmVertexNormals([0,0,0,1,0,0,0,1,0,9,9,9],[0,1,2])],[0,0,1,0,0,1,0,0,1,0,0,1])
  // double-sided pair sharing vertices: the first (largest) face's side wins
  assert.deepEqual([...generateUvmVertexNormals([0,0,0,1,0,0,0,1,0],[0,1,2,0,2,1])],[0,0,1,0,0,1,0,0,1])
  assert.throws(()=>generateUvmVertexNormals([0,0,0,1,0,0,2,0,0],[0,1,2]),/degenerate/)
})
