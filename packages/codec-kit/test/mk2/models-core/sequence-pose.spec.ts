import { describe, expect, it } from 'vitest'
import {
  SequencePoseSampler,
  composeTrsMatrix,
  multiplyMat4,
  sampleMeshVisibility,
  sampleTrackValue,
  type RenderBone,
  type RenderScalarAnimationTrack,
  type RenderSequence,
} from '../../../src/legacy-model-support.js'

function track(
  keys: { frame: number; vector: number[] }[],
  lineType = 1,
): RenderScalarAnimationTrack {
  return { lineType, globalSeqId: null, keys }
}

function sequence(overrides: Partial<RenderSequence>): RenderSequence {
  return {
    name: 'Stand',
    durationSeconds: 1,
    looping: true,
    nodeTracks: [],
    ...overrides,
  }
}

function bone(index: number, parentIndex = -1, inverseBindMatrix?: Float32Array): RenderBone {
  return {
    index,
    name: `Bone_${index}`,
    parentIndex,
    ...(inverseBindMatrix ? { inverseBindMatrix } : {}),
  }
}

/** Column-major translation matrix. */
function translationMatrix(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

function worldPosition(result: Float32Array, boneIndex: number): [number, number, number] {
  return [result[boneIndex * 16 + 12]!, result[boneIndex * 16 + 13]!, result[boneIndex * 16 + 14]!]
}

describe('sampleTrackValue', () => {
  const t = track([
    { frame: 0, vector: [0, 0, 0] },
    { frame: 1, vector: [10, 0, 0] },
  ])

  it('lerps, clamps, and holds', () => {
    const out: number[] = []
    expect(sampleTrackValue(t, 0.5, out)).toEqual([5, 0, 0])
    expect(sampleTrackValue(t, -1, out)).toEqual([0, 0, 0])
    expect(sampleTrackValue(t, 9, out)).toEqual([10, 0, 0])
  })

  it('steps on lineType 0', () => {
    const stepped = track(t.keys as { frame: number; vector: number[] }[], 0)
    expect(sampleTrackValue(stepped, 0.99, [])).toEqual([0, 0, 0])
    expect(sampleTrackValue(stepped, 1, [])).toEqual([10, 0, 0])
  })

  it('wraps concurrent tracks', () => {
    const out: number[] = []
    expect(sampleTrackValue(t, 1.5, out, { wrapSeconds: 1 })).toEqual(sampleTrackValue(t, 0.5, []))
  })

  it('slerps quats along the shortest path', () => {
    const quatTrack = track([
      { frame: 0, vector: [0, 0, 0, 1] },
      { frame: 1, vector: [0, 0, -Math.SQRT1_2, -Math.SQRT1_2] },
    ])
    const out = sampleTrackValue(quatTrack, 0.5, [], { isQuat: true })
    expect(out[2]).toBeCloseTo(Math.sin(Math.PI / 8), 5)
    expect(out[3]).toBeCloseTo(Math.cos(Math.PI / 8), 5)
  })
})

describe('matrix helpers', () => {
  it('composes TRS and multiplies column-major', () => {
    const trs = new Float32Array(16)
    // 90° about Z, then translate (1,0,0), scale 2
    composeTrsMatrix(trs, 0, [1, 0, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2], [2, 2, 2])
    // Local X axis maps to +Y (rotated), scaled by 2.
    expect(trs[0]).toBeCloseTo(0, 5)
    expect(trs[1]).toBeCloseTo(2, 5)
    expect(trs[12]).toBe(1)

    const shift = translationMatrix(0, 0, 5)
    const out = new Float32Array(16)
    multiplyMat4(out, 0, shift, 0, trs, 0)
    expect(out[14]).toBeCloseTo(5, 5)
    expect(out[12]).toBeCloseTo(1, 5)
  })
})

describe('SequencePoseSampler', () => {
  it('chains parent transforms into world matrices', () => {
    const bones = [bone(0), bone(1, 0)]
    const seq = sequence({
      nodeTracks: [
        { boneIndex: 0, translation: track([{ frame: 0, vector: [1, 0, 0] }]) },
        { boneIndex: 1, translation: track([{ frame: 0, vector: [0, 2, 0] }]) },
      ],
    })
    const sampler = new SequencePoseSampler(bones)
    const { world } = sampler.samplePose(seq, 0)
    expect(worldPosition(world, 0)).toEqual([1, 0, 0])
    expect(worldPosition(world, 1)).toEqual([1, 2, 0])
  })

  it('rotating the root carries children around', () => {
    const bones = [bone(0), bone(1, 0)]
    const seq = sequence({
      nodeTracks: [
        // Root: 90° about Z. Child at local (1,0,0) → world (0,1,0).
        {
          boneIndex: 0,
          rotation: track([{ frame: 0, vector: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }]),
        },
        { boneIndex: 1, translation: track([{ frame: 0, vector: [1, 0, 0] }]) },
      ],
    })
    const { world } = new SequencePoseSampler(bones).samplePose(seq, 0)
    const [x, y] = worldPosition(world, 1)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(1, 5)
  })

  it('bind pose × IREF yields identity skinning (the P5 D8 convention)', () => {
    // Bind pose: bone at (3,0,0); IREF = inverse bind = translate(-3,0,0).
    const bones = [bone(0, -1, translationMatrix(-3, 0, 0))]
    const seq = sequence({
      nodeTracks: [{ boneIndex: 0, translation: track([{ frame: 0, vector: [3, 0, 0] }]) }],
    })
    const { skinning } = new SequencePoseSampler(bones).samplePose(seq, 0)
    const expected = new Float32Array(16)
    expected[0] = expected[5] = expected[10] = expected[15] = 1
    for (let i = 0; i < 16; i += 1) expect(skinning[i]).toBeCloseTo(expected[i]!, 5)
  })

  it('undriven bones (constant bind tracks) keep the bind pose mid-sequence', () => {
    const bones = [bone(0)]
    const seq = sequence({
      nodeTracks: [{ boneIndex: 0, translation: track([{ frame: 0, vector: [7, 8, 9] }]) }],
    })
    const sampler = new SequencePoseSampler(bones)
    expect(worldPosition(sampler.samplePose(seq, 0.5).world, 0)).toEqual([7, 8, 9])
  })

  it('reuses buffers across calls (allocation-free steady state)', () => {
    const bones = [bone(0)]
    const seq = sequence({
      nodeTracks: [
        {
          boneIndex: 0,
          translation: track([
            { frame: 0, vector: [0, 0, 0] },
            { frame: 1, vector: [10, 0, 0] },
          ]),
        },
      ],
    })
    const sampler = new SequencePoseSampler(bones)
    const first = sampler.samplePose(seq, 0)
    const second = sampler.samplePose(seq, 0.5)
    expect(second.world).toBe(first.world)
    expect(worldPosition(second.world, 0)).toEqual([5, 0, 0])
  })
})

describe('sampleMeshVisibility', () => {
  it('applies step visibility tracks per mesh', () => {
    const seq = sequence({
      nodeTracks: [],
      meshVisibility: [
        {
          meshIndex: 2,
          track: track(
            [
              { frame: 0, vector: [0] },
              { frame: 0.5, vector: [1] },
            ],
            0,
          ),
        },
      ],
    })
    expect(sampleMeshVisibility(seq, 2, 0.25)).toBe(false)
    expect(sampleMeshVisibility(seq, 2, 0.75)).toBe(true)
    expect(sampleMeshVisibility(seq, 0, 0.25)).toBe(true) // untracked meshes stay visible
  })
})
