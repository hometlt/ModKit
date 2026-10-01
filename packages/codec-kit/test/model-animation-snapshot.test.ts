import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip, ModelAnimationSample } from '@modkit/sdk'
import {
  DEFAULT_MODEL_ANIMATION_BUDGET,
  animationSnapshotBudget,
  createModelAnimationSampler,
  withoutHeldSamples,
} from '../src/model/animation.js'

const keys = (values: readonly number[][], extra: Partial<ModelAnimationSample> = {}) =>
  values.map((value, frame) => ({ frame, timeSeconds: frame, value, ...extra }))

const clip = (
  samples: readonly ModelAnimationSample[],
  interpolation: 'linear' | 'step' | 'cubic-spline' = 'linear',
): ModelAnimationClip => ({
  id: 'walk',
  name: 'walk',
  kind: 'animation',
  provenance: 'direct',
  frames: samples.length,
  channels: [{ target: 'bone', kind: 'translation', interpolation, samples }],
})

describe('animation snapshot helpers', () => {
  it('drops keys equal to both neighbours and plays the same', () => {
    const full = keys([[0], [1], [1], [1], [1], [2], [2], [2]])
    const thin = withoutHeldSamples(full)
    expect(thin.map(sample => [sample.frame, sample.timeSeconds, sample.value[0]])).toEqual([
      [0, 0, 0],
      [1, 1, 1],
      [2, 4, 1],
      [3, 5, 2],
      [4, 7, 2],
    ])
    for (const interpolation of ['linear', 'step'] as const) {
      const before = createModelAnimationSampler(clip(full, interpolation))
      const after = createModelAnimationSampler(clip(thin, interpolation))
      for (let time = 0; time <= 7; time += 0.25)
        expect(after.sample(time)[0]!.value).toEqual(before.sample(time)[0]!.value)
    }
  })

  it('keeps cubic-spline keys with a tangent and short tracks whole', () => {
    const moving = keys([[1], [1], [1]], { inTangent: [0], outTangent: [0.5] })
    expect(withoutHeldSamples(moving)).toHaveLength(3)
    const still = keys([[1], [1], [1]], { inTangent: [0], outTangent: [0] })
    expect(withoutHeldSamples(still)).toHaveLength(2)
    expect(withoutHeldSamples(keys([[3]]))).toHaveLength(1)
    expect(withoutHeldSamples([])).toEqual([])
  })

  it('sizes the budget by decoded keys and never goes below the default', () => {
    expect(animationSnapshotBudget([clip(keys([[0]]))])).toEqual(DEFAULT_MODEL_ANIMATION_BUDGET)
    const many = clip(keys(Array.from({ length: 200_000 }, (_, index) => [index])))
    const budget = animationSnapshotBudget([many])
    expect(budget.maxNodes).toBe(16 * 200_000 + 64 + 64)
    expect(budget.maxBytes).toBe(
      Math.max(DEFAULT_MODEL_ANIMATION_BUDGET.maxBytes, 256 * 200_000 + 1024),
    )
  })
})
