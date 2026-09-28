import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { createModelAnimationSampler } from '@modkit/codec-kit/model/animation'
import { readUvmContainer } from '../src/model/container.js'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:cubic',
  options: { assetId: 'fixture/cubic', sourceFormat: 'test' },
} as never

// A translation eased in and out: zero slope at both keys, so the middle is exactly halfway and a
// quarter of the way it is 0.15625 (Hermite h01(0.25)) — linear sampling would give 0.25.
const clip: ModelAnimationClip = {
  id: 'walk',
  name: 'Walk',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  channels: [
    {
      target: 'body',
      kind: 'translation',
      firstFrame: 0,
      lastFrame: 1,
      interpolation: 'cubic-spline',
      samples: [
        { frame: 0, timeSeconds: 0, value: [0, 0, 0], inTangent: [0, 0, 0], outTangent: [0, 0, 0] },
        { frame: 1, timeSeconds: 1, value: [1, 0, 0], inTangent: [0, 0, 0], outTangent: [0, 0, 0] },
      ],
    },
  ],
}

const projection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 0,
    textures: 0,
    animations: 1,
    geometryAccess: 'decoded',
  },
  nodes: [
    {
      id: 'body',
      childIds: [],
      meshIds: ['mesh'],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      trs: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
  primitives: [
    {
      id: 'tri',
      topology: 'triangles',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    },
  ],
  animations: [clip],
} as never

interface Written {
  readonly bytes: Uint8Array
  readonly document: {
    readonly animations: readonly {
      samplers: readonly { output: number; interpolation: string }[]
    }[]
    readonly accessors: readonly { count: number; type: string }[]
  }
}

describe('cubic-spline animation channels', () => {
  it('are written as glTF CUBICSPLINE and read back with their tangents', () => {
    const written = materializeUvmCore(projection, request) as unknown as Written
    const sampler = written.document.animations[0]!.samplers[0]!
    expect(sampler.interpolation).toBe('CUBICSPLINE')
    expect(written.document.accessors[sampler.output]).toMatchObject({ count: 6, type: 'VEC3' })

    const container = readUvmContainer(written.bytes)
    const model = readUvmModel(container.document as never, container.binary, {
      maxScalarBytes: 1 << 20,
    })
    const channel = model.rig.clips[0]!.channels[0]!
    expect(channel.interpolation).toBe('cubic-spline')
    expect(channel.samples?.[1]).toMatchObject({
      value: [1, 0, 0],
      inTangent: [0, 0, 0],
      outTangent: [0, 0, 0],
    })
  })

  it('sample as a Hermite curve, not linearly', () => {
    const sampler = createModelAnimationSampler(clip)
    expect(sampler.sample(0.5)[0]!.value[0]).toBeCloseTo(0.5, 6)
    expect(sampler.sample(0.25)[0]!.value[0]).toBeCloseTo(0.15625, 6)
  })

  it('need both tangents on every key', () => {
    const channel = clip.channels[0]!
    const broken = {
      ...clip,
      channels: [{ ...channel, samples: [{ frame: 0, timeSeconds: 0, value: [0, 0, 0] }] }],
    }
    expect(() => createModelAnimationSampler(broken)).toThrow(/tangents/)
  })
})
