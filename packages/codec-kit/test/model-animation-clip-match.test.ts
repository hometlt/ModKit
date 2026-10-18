import { expect, it } from 'vitest'
import { matchModelClip } from '../src/model/animation.js'

type Target = Parameters<typeof matchModelClip>[1][number]

it('picks only a target with the same role and reports none otherwise', () => {
  const targets: Target[] = [{ role: 'idle' }, { role: 'move' }]
  expect(matchModelClip({ role: 'move' }, targets)).toBe(1)
  expect(matchModelClip({ role: 'attack' }, targets)).toBeUndefined()
  // no role is never matched, not even against a role-less target or by position
  expect(matchModelClip({}, [{}, { role: 'idle' }])).toBeUndefined()
  expect(matchModelClip({ role: 'idle' }, [{}])).toBeUndefined()
})

it('prefers more shared tags, then fewer unshared canonical tags', () => {
  const source = { role: 'move', tags: ['left', 'fast'] }
  expect(matchModelClip(source, [{ role: 'move' }, { role: 'move', tags: ['left'] }])).toBe(1)
  expect(
    matchModelClip(source, [
      { role: 'move', tags: ['left', 'damaged'] },
      { role: 'move', tags: ['left'] },
    ]),
  ).toBe(1)
  // a plain clip beats one carrying a canonical tag the source lacks
  expect(matchModelClip({ role: 'idle' }, [{ role: 'idle', tags: ['ready'] }, { role: 'idle' }])).toBe(1)
})

it('counts a publisher tag only between identical words and never penalises it', () => {
  const source = { role: 'attack', tags: ['sage:suppressed'] }
  expect(
    matchModelClip(source, [
      { role: 'attack', tags: ['sc2:suppressed'] },
      { role: 'attack', tags: ['sage:suppressed'] },
    ]),
  ).toBe(1)
  // an unshared publisher tag is not an unshared canonical tag
  expect(
    matchModelClip({ role: 'attack' }, [{ role: 'attack', tags: ['ready'] }, { role: 'attack', tags: ['sc2:Slow'] }]),
  ).toBe(1)
})

it('breaks ties by higher priority (absent zero), then lower sequence index, then position', () => {
  const source = { role: 'death' }
  expect(matchModelClip(source, [{ role: 'death' }, { role: 'death', priority: 5 }])).toBe(1)
  expect(matchModelClip(source, [{ role: 'death', priority: -1 }, { role: 'death' }])).toBe(1)
  expect(
    matchModelClip(source, [
      { role: 'death', sequenceIndex: 9 },
      { role: 'death', sequenceIndex: 3 },
    ]),
  ).toBe(1)
  expect(matchModelClip(source, [{ role: 'death' }, { role: 'death' }])).toBe(0)
})
