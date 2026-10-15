/**
 * Regression coverage for consuming owned animation snapshots without retaining completed clips.
 * All clips are validated before encoding; order, catalog, source ownership and repeated bytes
 * remain stable. Small synthetic inputs prove semantics, not GC timing or native heap acceptance.
 */
import { expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { writeUvmAnimations, type RigStorage } from '../src/model/rig.js'
import { BufferBuilder } from '../src/model/legacy/rig-kernels.js'

/** Makes 93 independently identified clips, including explicit non-default sequence indices. */
function clips(): ModelAnimationClip[] {
  return Array.from({ length: 93 }, (_, index) => ({
    id: `clip-${index}`,
    name: `Clip ${index}`,
    kind: 'animation',
    provenance: 'direct',
    frames: 2,
    sequenceIndex: index + 10,
    looping: true,
    channels: [
      {
        target: 'body',
        kind: 'translation',
        interpolation: 'linear',
        firstFrame: 0,
        lastFrame: 1,
        samples: [
          { frame: 0, timeSeconds: 0, value: [index, 0, 0] },
          { frame: 1, timeSeconds: 1, value: [index + 1, 0, 0] },
        ],
      },
    ],
  }))
}

/** Allocates writer-owned binary storage, independent for each attempted export. */
function storage(): RigStorage {
  return { buffer: new BufferBuilder(), views: [], accessors: [] }
}

/** Calls the production writer, with a single explicitly representable rigid TRS node. */
function write(
  source: readonly ModelAnimationClip[],
  target: RigStorage,
  budget?: Parameters<typeof writeUvmAnimations>[4],
  signal?: AbortSignal,
) {
  return writeUvmAnimations(
    source,
    new Map([['body', 0]]),
    new Map(),
    target,
    budget,
    signal,
    new Map(),
    new Set(['body']),
  )
}

it('keeps all clips, sequence indices and source keys across repeated exports', () => {
  const source = clips()
  for (const clip of source) {
    for (const channel of clip.channels) {
      for (const sample of channel.samples!) {
        Object.freeze(sample.value)
        Object.freeze(sample)
      }
      Object.freeze(channel.samples)
      Object.freeze(channel)
    }
    Object.freeze(clip.channels)
    Object.freeze(clip)
  }
  Object.freeze(source)
  const before = JSON.stringify(source)
  const first = storage(),
    second = storage()
  const result = write(source, first)
  expect(result.animations).toHaveLength(93)
  expect(result.catalog.map(item => item['sourceId'])).toEqual(source.map(clip => clip.id))
  expect(result.catalog.map(item => item['sourceSequenceIndex'])).toEqual(
    source.map(clip => clip.sequenceIndex),
  )
  expect(result.losses).toEqual([])
  expect(write(source, second)).toEqual(result)
  expect(second.buffer.finish()).toEqual(first.buffer.finish())
  expect(second.accessors).toEqual(first.accessors)
  expect(second.views).toEqual(first.views)
  expect(JSON.stringify(source)).toBe(before)
})

it.each(['nonfinite', 'duplicate-id', 'budget', 'cancel'] as const)(
  'validates the complete snapshot before encoding: %s',
  mode => {
    const source = clips(),
      target = storage()
    if (mode === 'nonfinite')
      source[92] = {
        ...source[92]!,
        channels: [
          {
            ...source[92]!.channels[0]!,
            samples: [
              { frame: 0, timeSeconds: 0, value: [NaN, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [1, 0, 0] },
            ],
          },
        ],
      }
    if (mode === 'duplicate-id') source[92] = { ...source[92]!, id: source[0]!.id }
    const controller = new AbortController()
    if (mode === 'cancel') controller.abort()
    const budget = mode === 'budget' ? { maxDepth: 64, maxNodes: 1, maxBytes: 128 } : undefined
    expect(() => write(source, target, budget, controller.signal)).toThrow()
    expect(target.buffer.length).toBe(0)
    expect(target.accessors).toEqual([])
    expect(target.views).toEqual([])
  },
)

it('still refuses a repeated sequence index in the last clip', () => {
  const source = clips()
  source[92] = { ...source[92]!, sequenceIndex: source[0]!.sequenceIndex! }
  expect(() => write(source, storage())).toThrow(/distinct material sequence indices/)
})
