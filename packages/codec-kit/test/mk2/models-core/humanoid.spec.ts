import { describe, expect, it } from 'vitest'
import {
  retargetHumanoidSequence,
  sampleHumanoidMusclePose,
  solveTwoBoneIk,
  type RenderHumanoidRig,
} from '../../../src/model-math/humanoid.js'

const sourceRig: RenderHumanoidRig = {
  humanScale: 1,
  bones: [
    {
      humanBone: 0,
      humanBoneName: 'Hips',
      boneIndex: 0,
      restPosition: [0, 1, 0],
      restRotation: [0, 0, 0, 1],
      restScale: [1, 1, 1],
    },
  ],
}

describe('humanoid retargeting', () => {
  it('maps rest-relative hips translation using human scale', () => {
    const targetRig: RenderHumanoidRig = {
      humanScale: 2,
      bones: [
        {
          humanBone: 0,
          humanBoneName: 'Hips',
          boneIndex: 5,
          restPosition: [0, 2, 0],
          restRotation: [0, 0, 0, 1],
          restScale: [1, 1, 1],
        },
      ],
    }
    const result = retargetHumanoidSequence(
      {
        name: 'Walk',
        durationSeconds: 1,
        looping: true,
        nodeTracks: [
          {
            boneIndex: 0,
            translation: {
              lineType: 1,
              globalSeqId: null,
              keys: [{ frame: 0, vector: [0, 1.5, 0] }],
            },
          },
        ],
      },
      sourceRig,
      targetRig,
    )
    expect(result.nodeTracks[0]?.boneIndex).toBe(5)
    expect(result.nodeTracks[0]?.translation?.keys[0]?.vector).toEqual([0, 3, 0])
  })

  it('samples and blends normalized muscle curves independently of transform tracks', () => {
    const sequence = {
      name: 'Muscles',
      durationSeconds: 1,
      looping: true,
      nodeTracks: [],
      humanoidMuscleTracks: [
        {
          bindingId: 42,
          track: {
            lineType: 1,
            globalSeqId: null,
            keys: [
              { frame: 0, vector: [-1] },
              { frame: 1, vector: [1] },
            ],
          },
        },
      ],
    }
    expect(
      sampleHumanoidMusclePose([
        { sequence, timeSeconds: 0.75, weight: 0.5 },
        { sequence, timeSeconds: 0.5, weight: 0.25, additive: true },
      ]),
    ).toEqual([{ bindingId: 42, value: 0.25 }])
  })
})

describe('solveTwoBoneIk', () => {
  it('preserves limb lengths and follows the pole plane', () => {
    const result = solveTwoBoneIk({
      root: [0, 0, 0],
      joint: [1, 0, 0],
      end: [2, 0, 0],
      target: [1, 1, 0],
      pole: [0, 0, 1],
    })
    expect(Math.hypot(...result.joint)).toBeCloseTo(1)
    expect(
      Math.hypot(
        result.end[0] - result.joint[0],
        result.end[1] - result.joint[1],
        result.end[2] - result.joint[2],
      ),
    ).toBeCloseTo(1)
    expect(result.end).toEqual(expect.arrayContaining([expect.closeTo(1), expect.closeTo(1)]))
    expect(result.reachedTarget).toBe(true)
    expect(result.stretchScale).toBe(1)
  })

  it('uniformly stretches both segments up to the configured limit', () => {
    const result = solveTwoBoneIk({
      root: [0, 0, 0],
      joint: [1, 0, 0],
      end: [2, 0, 0],
      target: [3, 0, 0],
      pole: [0, 0, 1],
      maxStretch: 1.25,
    })
    expect(result.stretchScale).toBeCloseTo(1.25)
    expect(Math.hypot(...result.joint)).toBeCloseTo(1.25)
    expect(
      Math.hypot(
        result.end[0] - result.joint[0],
        result.end[1] - result.joint[1],
        result.end[2] - result.joint[2],
      ),
    ).toBeCloseTo(1.25)
    expect(result.end[0]).toBeCloseTo(2.5)
    expect(result.reachedTarget).toBe(false)
  })
})
