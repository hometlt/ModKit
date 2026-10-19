/** Portable skin frames retain authored joints, inverse binds and keys through the common writer. */
import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { ModelBoneBinding, ModelNode, ModelAnimationClip } from '@modkit/sdk'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { createModelSceneSampler } from '@modkit/scene/model'
import { readUvmModel } from '@modkit/scene/uvm/model'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmContainer } from '../src/model/container.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const frame = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1]
const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:skin-frame',
  options: { assetId: 'fixture/skin-frame', sourceFormat: 'synthetic' },
} as never

/** Sparse source joint ordinals and a translated inverse bind expose renumbering or double frames. */
function fixture(external = frame, meshFrame = identity) {
  const skeleton: ModelBoneBinding[] = [
    {
      partId: 'mesh',
      hierarchyId: 'rig',
      boneIndex: 7,
      boneName: 'root',
      nodeId: 'joint',
      provenance: 'direct',
      parentBoneIndex: null,
      localPose: { translation: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      inverseBindMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, 0, 0, 1],
    },
  ]
  const nodes: ModelNode[] = [
    { id: 'frame', name: 'frame', childIds: ['joint'], meshIds: [], transform: external },
    ...createModelSkeletonNodes(skeleton, 'rig'),
    { id: 'body', childIds: [], meshIds: ['mesh'], transform: meshFrame },
  ]
  const animations: ModelAnimationClip[] = [
    {
      id: 'move',
      name: 'Move',
      kind: 'animation',
      provenance: 'direct',
      frames: 2,
      channels: [
        {
          target: 'joint',
          kind: 'translation',
          firstFrame: 0,
          lastFrame: 1,
          interpolation: 'linear',
          samples: [
            { frame: 0, timeSeconds: 0, value: [2, 0, 0] },
            { frame: 1, timeSeconds: 1, value: [4, 0, 0] },
          ],
        },
      ],
    },
  ]
  const projection = {
    info: {
      scenes: 1,
      nodes: nodes.length,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded' as const,
    },
    nodes,
    skeleton,
    animations,
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        hierarchyId: 'rig',
        topology: 'triangles' as const,
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
        indices: Uint32Array.of(0, 1, 2),
        boneIndices: Uint32Array.of(7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7),
        boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0),
      },
    ],
  }
  return projection
}

it('preserves the identity-frame bytes produced before static frame admission', () => {
  const bytes = materializeUvmCore(fixture(identity), request).bytes
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    'f9f01fb7883c53894b2cdc078e88d7ffa70b876325b01149eee73e3de17dce50',
  )
})

it('roundtrips noncommuting affine ancestors in parent-first order', () => {
  const inner = [1, 0, 0, 0, 0.5, 2, 0, 0, 0, 0, 3, 0, 1, 2, 3, 1]
  const outer = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
  const composed = [0, 1, 0, 0, -2, 0.5, 0, 0, 0, 0, 3, 0, 3, 7, 10, 1]
  const p = fixture(inner)
  p.nodes.push({ id: 'outer', childIds: ['frame'], meshIds: [], transform: outer })
  p.info.nodes = p.nodes.length
  const { document, binary } = readUvmContainer(materializeUvmCore(p, request).bytes)
  const model = readUvmModel(document, binary, { maxScalarBytes: 1 << 20 })
  expect(model.rig.incompleteBindings).toBe(0)
  expect(model.rig.bindings[0]!.inverseBindMatrix).toEqual(p.skeleton[0]!.inverseBindMatrix)
  for (const skinning of ['cpu', 'gpu'] as const) {
    const before = createModelSceneSampler(p, { clip: p.animations[0]!, skinning })
    const after = createModelSceneSampler(
      { ...model.scene, skeleton: model.rig.bindings, nodePoses: model.rig.nodePoses },
      { clip: model.rig.clips[0]!, skinning },
    )
    for (const time of [0, 0.25, 0.75, 1]) {
      const source = before.sample(time)
      const actual = after.sample(time)
      expect(actual.diagnostics).toEqual([])
      expect(actual.primitives[0]!.transform).toEqual(new Float32Array(composed))
      expect(actual.joints[0]!.position).toEqual([3, 9 + 2 * time, 10])
      const a = actual.primitives[0]!,
        b = source.primitives[0]!
      expect(a.skin?.deformed().positions ?? a.positions).toEqual(
        b.skin?.deformed().positions ?? b.positions,
      )
    }
  }
  // The second root obtains exactly the same frame through a distinct chain.
  const second: ModelBoneBinding = { ...p.skeleton[0]!, nodeId: 'second', boneIndex: 9 }
  p.skeleton.push(second)
  p.nodes.push(...createModelSkeletonNodes([second], 'rig'), {
    id: 'other-frame',
    childIds: ['second'],
    meshIds: [],
    transform: composed,
  })
  p.info.nodes = p.nodes.length
  expect(() => materializeUvmCore(p, request)).not.toThrow()
})

it.each([
  { meshFrame: identity },
  { meshFrame: [5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 5, 0, 99, 0, 0, 1] },
])('roundtrips a common static skin frame independently of the mesh frame %j', ({ meshFrame }) => {
  const projection = fixture(frame, meshFrame)
  const before = createModelSceneSampler(projection, { clip: projection.animations[0]! })
  const { document, binary } = readUvmContainer(materializeUvmCore(projection, request).bytes)
  const model = readUvmModel(document, binary, { maxScalarBytes: 1 << 20 })
  expect(model.rig.incompleteBindings).toBe(0)
  expect(model.rig.bindings[0]!.inverseBindMatrix).toEqual(
    projection.skeleton[0]!.inverseBindMatrix,
  )
  expect(document).toMatchObject({
    skins: [{ extensions: { UV_game_skeleton: { sourceOrder: [7] } } }],
  })
  expect(model.rig.clips[0]!.channels[0]!.samples?.map(s => s.value)).toEqual([
    [2, 0, 0],
    [4, 0, 0],
  ])
  for (const skinning of ['cpu', 'gpu'] as const) {
    const sampler = createModelSceneSampler(
      { ...model.scene, skeleton: model.rig.bindings, nodePoses: model.rig.nodePoses },
      { clip: model.rig.clips[0]!, skinning },
    )
    for (const time of [0, 0.25, 0.75, 1]) {
      const expected = before.sample(time),
        actual = sampler.sample(time)
      expect(actual.diagnostics).toEqual([])
      expect(actual.primitives[0]!.transform).toEqual(new Float32Array(frame))
      const primitive = actual.primitives[0]!
      const positions = primitive.skin?.deformed().positions ?? primitive.positions
      expect(positions).toEqual(expected.primitives[0]!.positions)
      expect(actual.joints[0]!.position).toEqual([7 + 4 * time, 4, 5])
    }
  }
  expect(projection.nodes[0]!.transform).toEqual(frame)
  expect(projection.skeleton[0]!.boneIndex).toBe(7)
})

it('allows equal external frames for independent roots but refuses different frames', () => {
  for (const same of [true, false]) {
    const p = fixture()
    const second: ModelBoneBinding = { ...p.skeleton[0]!, nodeId: 'second', boneIndex: 9 }
    p.skeleton.push(second)
    p.nodes.push(...createModelSkeletonNodes([second], 'rig'), {
      id: 'other-frame',
      childIds: ['second'],
      meshIds: [],
      transform: same ? frame : identity,
    })
    p.info.nodes = p.nodes.length
    if (same) expect(() => materializeUvmCore(p, request)).not.toThrow()
    else expect(() => materializeUvmCore(p, request)).toThrow(/same external frame/)
  }
})

it('keeps transformed intermediaries between joints explicitly unsupported', () => {
  const p = fixture()
  const child: ModelBoneBinding = {
    ...p.skeleton[0]!,
    nodeId: 'child',
    boneIndex: 9,
    parentBoneIndex: 7,
  }
  p.skeleton.push(child)
  const joint = p.nodes.findIndex(n => n.id === 'joint')
  p.nodes[joint] = { ...p.nodes[joint]!, childIds: ['between'] }
  p.nodes.push(
    createModelSkeletonNodes(p.skeleton, 'rig').find(n => n.id === 'child')!,
    { id: 'between', childIds: ['child'], meshIds: [], transform: frame },
  )
  p.info.nodes = p.nodes.length
  expect(() => materializeUvmCore(p, request)).toThrow(/between bones/)
})

it('refuses animation of a skin ancestor instead of losing its effect', () => {
  const p = fixture(identity)
  p.animations[0] = {
    ...p.animations[0]!,
    channels: [...p.animations[0]!.channels, { ...p.animations[0]!.channels[0]!, target: 'frame' }],
  }
  expect(() => materializeUvmCore(p, request)).toThrow(/non-joint skin ancestor/)
})

it('retains matrix validation, budgets and cancellation for external frames', () => {
  for (const at of [0, 3, 15]) {
    const invalid = [...frame]
    invalid[at] = at === 0 ? NaN : 2
    expect(() => materializeUvmCore(fixture(invalid), request)).toThrow()
  }
  expect(() => materializeUvmCore(fixture(), request, { signal: AbortSignal.abort() })).toThrow()
  expect(() =>
    materializeUvmCore(fixture(), request, {
      skeletonBudget: { maxBones: 0, maxBytes: 0, maxNodes: 0, maxDepth: 0 } as never,
    }),
  ).toThrow()
})
