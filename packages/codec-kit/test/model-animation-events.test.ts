import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { clipEventsBetween } from '../src/model/animation.js'

const clip = (extra: Partial<ModelAnimationClip> = {}): ModelAnimationClip => ({
  id: 'attack',
  name: 'Attack',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels: [],
  events: [
    { timeSeconds: 0.25, name: 'fire_weapon', nodeId: 'node-3' },
    { timeSeconds: 0.75, name: 'sound', payload: { cue: 'tank_fire' } },
  ],
  ...extra,
})
const names = (found: readonly { event: { name: string }; atSeconds: number }[]) =>
  found.map(item => `${item.event.name}@${item.atSeconds}`)

it('passes each event of a clip played once between two times, the start excluded', () => {
  expect(names(clipEventsBetween(clip(), 0, 0.5))).toEqual(['fire_weapon@0.25'])
  expect(names(clipEventsBetween(clip(), 0.25, 2))).toEqual(['sound@0.75'])
  expect(clipEventsBetween(clip(), 0.5, 0.5)).toEqual([])
})

it('repeats them every duration for a looping clip, and forth then back for ping-pong', () => {
  expect(names(clipEventsBetween(clip({ loop: 'loop' }), 0.5, 1.5))).toEqual([
    'sound@0.75',
    'fire_weapon@1.25',
  ])
  expect(names(clipEventsBetween(clip({ looping: true }), 1.9, 2.3))).toEqual(['fire_weapon@2.25'])
  // forth: 0.25, 0.75; back: 2 - 0.75 = 1.25, 2 - 0.25 = 1.75
  expect(names(clipEventsBetween(clip({ loop: 'ping-pong' }), 0, 2))).toEqual([
    'fire_weapon@0.25',
    'sound@0.75',
    'sound@1.25',
    'fire_weapon@1.75',
  ])
})
