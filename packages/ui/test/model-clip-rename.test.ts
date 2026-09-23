import type {
  AnyDescriptor,
  CommitCoordinator,
  EditAuthorizationPort,
  ModelAnimationClip,
} from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { canRenameClips, clipNamePath } from '../src/model/index.js'

function descriptor(state: 'available' | 'disabled' | undefined): AnyDescriptor {
  return {
    operations:
      state === undefined
        ? []
        : [
            {
              id: 'edit.field',
              handlerId: 'set-uvm-field',
              mutatesSource: true,
              state,
            },
          ],
    metadata: [],
    diagnostics: [],
    revision: 'content-hash.sha256:model',
  } as unknown as AnyDescriptor
}

const commit = {} as CommitCoordinator
const authorization = {} as EditAuthorizationPort

function clip(overrides: Partial<ModelAnimationClip> = {}): ModelAnimationClip {
  return {
    id: 'clip-0',
    name: 'Walk',
    kind: 'animation',
    provenance: 'direct',
    frames: 10,
    ...overrides,
  } as ModelAnimationClip
}

describe('renaming a model animation clip', () => {
  it('addresses the clip by the sequence key its publisher stated', () => {
    // A publisher that keys clips itself — Warcraft III sequences, StarCraft II clips — is
    // addressed by that key, not by where the clip happens to sit in the published list.
    expect(clipNamePath(clip({ sequenceIndex: 3 }), 0)).toEqual(['animations', '3', 'name'])
  })

  it('falls back to the published order when no sequence key is stated', () => {
    expect(clipNamePath(clip(), 2)).toEqual(['animations', '2', 'name'])
  })

  it('offers renaming only when the codec declares the field write', () => {
    expect(canRenameClips({ descriptor: descriptor('available'), commit, authorization })).toBe(true)
    expect(canRenameClips({ descriptor: descriptor(undefined), commit, authorization })).toBe(false)
    expect(canRenameClips({ descriptor: descriptor('disabled'), commit, authorization })).toBe(false)
  })

  it('refuses to offer renaming without a route that can save it', () => {
    // The mount contract is explicit: a surface without a commit route must not pretend to edit.
    expect(canRenameClips({ descriptor: descriptor('available'), authorization })).toBe(false)
    expect(canRenameClips({ descriptor: descriptor('available'), commit })).toBe(false)
    expect(canRenameClips({ descriptor: descriptor('available') })).toBe(false)
  })
})
