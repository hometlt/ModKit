import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip, ModelBoneBinding } from '@modkit/sdk'
import { boundUvmRootFrame, expandRigBoundsRadius } from '../src/uvm/rig-bounds.js'

const budget = { maxNodes: 1000, spatialRoundoff: 2 ** -149 }
const root: ModelBoneBinding = {
  partId: 'mesh',
  boneIndex: 0,
  boneName: 'Root',
  provenance: 'direct',
  nodeId: 'root',
  parentBoneIndex: null,
  localPose: {
    translation: [3, 4, 0],
    rotation: [0, 0, 0, 1],
    scale: [0.25, 2, 3],
  },
}
function clip(
  values: readonly (readonly number[])[],
  interpolation: 'linear' | 'step',
): ModelAnimationClip {
  return {
    id: 'clip',
    name: 'Scale',
    kind: 'animation',
    provenance: 'direct',
    frames: values.length,
    durationSeconds: 1,
    channels: [
      {
        target: 'root',
        kind: 'scale',
        firstFrame: 0,
        lastFrame: values.length - 1,
        interpolation,
        samples: values.map((value, frame) => ({
          frame,
          timeSeconds: frame,
          value,
        })),
      },
    ],
  }
}

describe('root frame conservative bounds', () => {
  it('contains the global sphere transformed into the translated anisotropic root frame', () => {
    const clips = [
      clip(
        [
          [0.25, 2, 3],
          [0.5, 3, 4],
        ],
        'linear',
      ),
    ]
    const before = JSON.stringify({ root, clips })
    const result = boundUvmRootFrame(root, clips, 8, budget)
    expect(result.localRadius).toBeGreaterThan(52)
    for (const time of [0, 0.25, 0.5, 0.75, 1])
      for (const point of [
        [8, 0, 0],
        [-8, 0, 0],
        [0, 8, 0],
        [0, -8, 0],
        [0, 0, 8],
      ]) {
        const [x = 0, y = 0, z = 0] = point
        const local = [(x - 3) / (0.25 + time * 0.25), (y - 4) / (2 + time), z / (3 + time)]
        expect(Math.hypot(...local)).toBeLessThan(result.radius)
      }
    expect(JSON.stringify({ root, clips })).toBe(before)
  })
  it('retains the global radius when inverse root scaling makes local extents smaller', () => {
    const scaled: ModelBoneBinding = {
      ...root,
      localPose: {
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [10, 10, 10],
      },
    }
    const result = boundUvmRootFrame(scaled, [], 8, budget)
    expect(result.localRadius).toBeLessThan(1)
    expect(result.radius).toBe(8)
  })
  it('validates root visibility without changing geometric bounds', () => {
    const visibility: ModelAnimationClip = {
      id: 'visibility',
      name: 'Visibility',
      kind: 'animation',
      provenance: 'direct',
      frames: 2,
      durationSeconds: 1,
      channels: [
        {
          target: 'root',
          kind: 'visibility',
          firstFrame: 0,
          lastFrame: 1,
          interpolation: 'step',
          samples: [
            { frame: 0, timeSeconds: 0, value: [1] },
            { frame: 1, timeSeconds: 1, value: [0] },
          ],
        },
      ],
    }
    expect(boundUvmRootFrame(root, [visibility], 8, budget)).toEqual(
      boundUvmRootFrame(root, [], 8, budget),
    )
    expect(() =>
      boundUvmRootFrame(
        root,
        [
          {
            ...visibility,
            channels: [{ ...visibility.channels[0]!, samples: [{ frame: 0, timeSeconds: 0, value: [] }] }],
          },
        ],
        8,
        budget,
      ),
    ).toThrow(/finite declared vectors/)
  })
  it('distinguishes discontinuous STEP sign changes from singular LINEAR intervals', () => {
    const values = [
      [0.25, 2, 3],
      [-0.25, 2, 3],
    ]
    expect(() => boundUvmRootFrame(root, [clip(values, 'linear')], 8, budget)).toThrow(
      /crosses zero/,
    )
    expect(boundUvmRootFrame(root, [clip(values, 'step')], 8, budget).radius).toBeGreaterThan(52)
    expect(
      boundUvmRootFrame(
        root,
        [
          clip(
            [
              [-0.25, 2, 3],
              [-0.5, 2, 3],
            ],
            'linear',
          ),
        ],
        8,
        budget,
      ).radius,
    ).toBeGreaterThan(52)
  })
  it('refuses zero after native packing and finite values with an overflowing inverse', () => {
    for (const value of [0, 1e-46, 2 ** -149, 1e-39])
      expect(() => boundUvmRootFrame(root, [clip([[value, 2, 3]], 'step')], 8, budget)).toThrow()
    expect(() =>
      boundUvmRootFrame(
        root,
        [
          clip(
            [
              [1e-20, 2, 3],
              [1, 2, 3],
            ],
            'linear',
          ),
        ],
        8,
        budget,
      ),
    ).toThrow(/proven float32 range/)
  })
  it('checks ownership-independent root identity, work bounds and cancellation', () => {
    expect(() => boundUvmRootFrame({ ...root, parentBoneIndex: 1 }, [], 8, budget)).toThrow(
      /explicit root/,
    )
    expect(() => boundUvmRootFrame(root, [clip([[1, 2, 3]], 'step')], 8, { maxNodes: 1 })).toThrow(
      /work budget/,
    )
    const controller = new AbortController()
    controller.abort(new Error('bounds cancelled'))
    expect(() => boundUvmRootFrame(root, [], 8, budget, controller.signal)).toThrow(
      'bounds cancelled',
    )
  })
})

it('preserves every original box corner while expanding a native rig sphere', () => {
  expect(expandRigBoundsRadius([-30, -4, -2], [1, 5, 7], 8, 10)).toBe(Math.hypot(30, 5, 7))
  expect(expandRigBoundsRadius([-1, -1, -1], [1, 1, 1], 40, 10)).toBe(40)
  expect(expandRigBoundsRadius([-1, -1, -1], [1, 1, 1], 2, 50)).toBe(50)
  expect(() => expandRigBoundsRadius([1, 0, 0], [0, 1, 1], 1, 2)).toThrow(/min exceeds max/)
})
