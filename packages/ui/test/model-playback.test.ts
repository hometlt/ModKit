import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip, ModelBoneBinding, ModelPrimitive } from '@modkit/sdk'
import { createModelSceneSampler } from '@modkit/scene/model'
import { createModelSkinDeformer } from '@modkit/codec-kit/model/skinning'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { renderHeadless } from '../../scene/src/render/headless.js'
import {
  createOrbitController,
  framePrimitives,
  modelCamera,
  modelAnimationPlaybackDuration,
  modelSceneRequest,
} from '@modkit/ui/model'
import { readModelRecords } from '../src/model/source.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const bones: readonly ModelBoneBinding[] = [
  {
    partId: 'part',
    boneIndex: 42,
    boneName: 'Tip',
    nodeId: 'tip',
    hierarchyId: 'rig',
    parentBoneIndex: 9,
    provenance: 'direct',
    localPose: { translation: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    inverseBindMatrix: [...identity.slice(0, 13), -1, 0, 1],
  },
  {
    partId: 'part',
    boneIndex: 9,
    boneName: 'Root',
    nodeId: 'root',
    hierarchyId: 'rig',
    parentBoneIndex: null,
    provenance: 'direct',
    localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    inverseBindMatrix: identity,
  },
]
function triangle(): ModelPrimitive {
  return {
    id: 'triangle',
    topology: 'triangles',
    hierarchyId: 'rig',
    positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    tangents: new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]),
    boneIndices: new Uint32Array([42, 9, 9, 9, 42, 9, 9, 9, 42, 9, 9, 9]),
    boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  }
}
const clip: ModelAnimationClip = {
  id: 'move',
  name: 'Move',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels: [
    {
      target: 'tip',
      kind: 'translation',
      firstFrame: 0,
      lastFrame: 1,
      interpolation: 'linear',
      samples: [
        { frame: 0, timeSeconds: 0, value: [0, 1, 0] },
        { frame: 1, timeSeconds: 1, value: [1, 1, 0] },
      ],
    },
  ],
}
function projection(primitive = triangle()) {
  return {
    nodes: createModelSkeletonNodes(bones, 'rig'),
    meshes: [{ id: 'mesh', primitiveIds: [primitive.id] }],
    primitives: [primitive],
    skeleton: bones,
  }
}

describe('common scene pose and the shipped renderer', () => {
  it('lets the generic player seek through finite independent channel cycles', () => {
    expect(modelAnimationPlaybackDuration({
      ...clip,
      durationSeconds: 0.3,
      channels: [{
        ...clip.channels[0]!,
        concurrent: true,
        wrapSeconds: 0.3,
        repeatCount: 3,
      }],
    })).toBeCloseTo(0.9)
    expect(modelAnimationPlaybackDuration({
      ...clip,
      durationSeconds: 0.3,
      channels: [{
        ...clip.channels[0]!,
        concurrent: true,
        wrapSeconds: 0.3,
        repeatCount: 0,
      }],
    })).toBe(0.3)
  })

  it('joins sparse bones, deforms all attributes and keeps independently owned output frames', () => {
    const source = triangle()
    const before = new Float32Array(source.positions)
    const sampler = createModelSceneSampler(projection(source), { clip })
    const first = sampler.sample(0)
    const half = sampler.sample(0.5)
    expect(first.diagnostics).toEqual([])
    expect(first.primitives[0]?.positions).toEqual(before)
    expect(half.primitives[0]?.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0]))
    expect(half.primitives[0]?.normals).toEqual(source.normals)
    expect(half.primitives[0]?.tangents).toEqual(source.tangents)
    expect(half.primitives[0]).not.toHaveProperty('boneIndices')
    expect(source.positions).toEqual(before)
    expect(half.joints.map(joint => [joint.boneIndex, joint.position, joint.parent])).toEqual([
      [9, [0, 0, 0], undefined],
      [42, [0.5, 1, 0], 0],
    ])
    sampler.sample(1)
    expect(first.primitives[0]?.positions).toEqual(before)
  })

  it('produces different actual RGBA frames at two animation times with a fixed camera', async () => {
    const sampler = createModelSceneSampler(projection(), { clip })
    const first = sampler.sample(0)
    const last = sampler.sample(1)
    const viewport = { width: 96, height: 96 }
    const camera = modelCamera(
      framePrimitives([...first.primitives, ...last.primitives]),
      createOrbitController().basis(),
      1,
      viewport,
    )
    const frames = []
    for (const scene of [first, last])
      frames.push(
        await renderHeadless(modelSceneRequest({ primitives: scene.primitives, camera, viewport })),
      )
    for (const frame of frames) {
      expect(frame.statistics.fragments).toBeGreaterThan(0)
      expect(frame.diagnostics).toEqual([])
    }
    expect(frames[0]!.rgba).not.toEqual(frames[1]!.rgba)
  })

  it('retains MK2 CPU zero-weight behavior and states its difference from the legacy GPU path', () => {
    const source = triangle()
    source.boneWeights!.fill(0, 0, 4)
    const sampler = createModelSceneSampler(projection(source), { clip })
    expect(sampler.diagnostics.map(item => item.code)).toEqual(['common.model/skin-zero-weights'])
    expect(sampler.sample(1).primitives[0]?.positions.slice(0, 3)).toEqual(
      source.positions.slice(0, 3),
    )
  })

  it('reports an unavailable skin without inventing inverse bind matrices', () => {
    const skeleton = bones.map(({ inverseBindMatrix: _matrix, ...bone }) => bone)
    const sampler = createModelSceneSampler({ ...projection(), skeleton }, { clip })
    expect(sampler.diagnostics.map(item => item.code)).toEqual(['common.model/skin-unavailable'])
    expect(sampler.sample(1).primitives[0]?.positions).toEqual(triangle().positions)
  })

  it('renders static mesh instances and rigid descendants using their node transforms', () => {
    const {
      boneIndices: _indices,
      boneWeights: _weights,
      hierarchyId: _hierarchy,
      ...plain
    } = triangle()
    const nodes = createModelSkeletonNodes(bones, 'rig').map(node =>
      node.id === 'tip' ? { ...node, childIds: ['instance'] } : node,
    )
    const transform = [...identity]
    transform[12] = 2
    const sampler = createModelSceneSampler(
      {
        ...projection(plain),
        nodes: [
          ...nodes,
          { id: 'instance', childIds: [], meshIds: ['mesh'], transform },
          { id: 'second', childIds: [], meshIds: ['mesh'], transform: identity },
        ],
      },
      { clip },
    )
    const scene = sampler.sample(1)
    expect(scene.primitives).toHaveLength(2)
    expect(Array.from(scene.primitives[0]!.transform!.slice(12, 15))).toEqual([3, 1, 0])
    expect(Array.from(scene.primitives[1]!.transform!)).toEqual(identity)
  })

  it('refuses malformed joins, exceeded working memory and cancellation', () => {
    const source = triangle()
    source.boneIndices![0] = 800
    expect(() => createModelSkinDeformer(source, [9, 42])).toThrow('absent bone')
    expect(() => createModelSceneSampler(projection(), { maxBytes: 700 })).toThrow('maxBytes')
    const abort = new AbortController()
    abort.abort()
    expect(() => createModelSceneSampler(projection()).sample(0, abort.signal)).toThrow('cancelled')
    expect(() =>
      createModelSceneSampler({
        ...projection(),
        nodes: [
          { id: 'a', childIds: ['b'], meshIds: [], transform: identity },
          { id: 'b', childIds: ['a'], meshIds: [], transform: identity },
        ],
      }),
    ).toThrow('cyclic')
  })

  it('keeps identical node ids separate across two skin palettes', () => {
    const sharedBones = bones.map(bone => ({
      ...bone,
      hierarchyId: 'second-rig',
      inverseBindMatrix: identity,
    }))
    const second = { ...triangle(), id: 'second', hierarchyId: 'second-rig' }
    const sampler = createModelSceneSampler(
      {
        ...projection(),
        skeleton: [...bones, ...sharedBones],
        meshes: [{ id: 'mesh', primitiveIds: ['triangle', 'second'] }],
        primitives: [triangle(), second],
      },
      { clip },
    )
    const frame = sampler.sample(1)
    expect(frame.diagnostics).toEqual([])
    expect(frame.joints).toHaveLength(4)
    expect(frame.primitives[0]?.positions[1]).toBe(0)
    expect(frame.primitives[1]?.positions[1]).toBe(1)
  })
})

describe('complete model facet pages', () => {
  it('reads beyond the old 64-record detail limit and detects repeated cursors', async () => {
    const values = Array.from({ length: 520 }, (_, id) => ({ id }))
    const records = await readModelRecords(async request => {
      const start = Number(request.cursor ?? 0)
      const end = Math.min(values.length, start + request.limit)
      return {
        items: values.slice(start, end),
        ...(end < values.length ? { nextCursor: String(end) } : {}),
      }
    }, 600)
    expect(records).toEqual(values)
    await expect(
      readModelRecords(async () => ({ items: [], nextCursor: 'same' }), 600),
    ).rejects.toThrow('cursor')
    await expect(
      readModelRecords(
        async request => ({ items: Array.from({ length: request.limit + 1 }, () => 1) }),
        600,
      ),
    ).rejects.toThrow('page limit')
  })
})
