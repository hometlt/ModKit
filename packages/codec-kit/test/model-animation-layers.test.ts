import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { chooseByWeight, createModelAnimationSampler, layeredClip } from '../src/model/animation.js'

// a linear 0 → 1 move of one target over `seconds`
const move = (target: string, seconds: number) => ({
  target,
  kind: 'translation',
  firstFrame: 0,
  lastFrame: 1,
  interpolation: 'linear' as const,
  samples: [
    { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
    { frame: 1, timeSeconds: seconds, value: [1, 0, 0] },
  ],
})
const clip = (id: string, extra: Partial<ModelAnimationClip>): ModelAnimationClip => ({
  id,
  name: id,
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  channels: [],
  ...extra,
})
const at = (layered: ModelAnimationClip, time: number) =>
  Object.fromEntries(
    createModelAnimationSampler(layered)
      .sample(time)
      .map(value => [value.target, value.value[0]]),
  )

it('layers clips by priority per target, each on its own clock', () => {
  // a run moves the legs and the arms; a carry, on top, moves the arms only
  const run = clip('run', {
    durationSeconds: 0.8,
    looping: true,
    channels: [move('legs', 0.8), move('arms', 0.8)],
  })
  const carry = clip('carry', {
    durationSeconds: 1.2,
    loop: 'loop',
    priority: 10,
    channels: [move('arms', 1.2)],
  })
  const layered = layeredClip([carry, run])
  // the arms are the carry's, the legs the run's, each wrapping by its own length
  expect(at(layered, 0.4)).toEqual({ legs: 0.5, arms: expect.closeTo(1 / 3, 6) })
  expect(at(layered, 1.0)).toEqual({
    legs: expect.closeTo(0.25, 6),
    arms: expect.closeTo(5 / 6, 6),
  })
  // the set loops when both line up again: 2.4 s
  expect(layered.durationSeconds).toBeCloseTo(2.4, 9)
  expect(layered.looping).toBe(true)
})

it('plays a clip at its speed', () => {
  const fast = clip('fast', { durationSeconds: 1, channels: [move('arms', 1)], speedScale: 2 })
  const layered = layeredClip([
    fast,
    clip('idle', { durationSeconds: 1, channels: [move('legs', 1)] }),
  ])
  expect(at(layered, 0.25)['arms']).toBeCloseTo(0.5, 6)
})

it('chooses by weight, the same way for the same seed', () => {
  const candidates = [
    { value: 'stand 1', weight: 1 },
    { value: 'stand 2', weight: 3 },
  ]
  const chosen = Array.from({ length: 400 }, (_, index) =>
    chooseByWeight(candidates, `unit-${index}`),
  )
  expect(chooseByWeight(candidates, 'unit-7')).toBe(chosen[7])
  const second = chosen.filter(value => value === 'stand 2').length
  expect(second).toBeGreaterThan(250)
  expect(second).toBeLessThan(350)
  expect(() => chooseByWeight([{ value: 'x', weight: 0 }], 'seed')).toThrow()
})
