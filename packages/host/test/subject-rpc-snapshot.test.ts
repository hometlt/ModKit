import { describe, expect, it } from 'vitest'
import { subjectOpenSnapshot } from '../src/subject-rpc.js'

describe('subject RPC opened snapshots', () => {
  it('preserves the actual selected extension and exposes a path-free direct route', () => {
    const snapshot = subjectOpenSnapshot({
      result: {
        state: 'opened' as const,
        descriptor: {
          subjectUri: 'file:///C:/private/fixture.dds',
          identity: { formatId: 'dds' },
        },
        selected: {
          extensionId: 'modkit/images',
          contributionId: 'modkit/dds',
          variantId: 'portable',
          confidence: 1,
        },
        candidates: [],
      },
      sessionId: () => 'session-1',
      diagnostics: [],
    })

    expect(snapshot.selected).toEqual({
      extensionId: 'modkit/images',
      contributionId: 'modkit/dds',
      variantId: 'portable',
      confidence: 1,
    })
    expect(snapshot.selectedRoute).toEqual([
      {
        formatId: 'dds',
        extensionId: 'modkit/images',
        contributionId: 'modkit/dds',
      },
    ])
    expect(JSON.stringify(snapshot.selectedRoute)).not.toContain('fixture.dds')
    expect(JSON.stringify(snapshot.selectedRoute)).not.toContain('file:')
  })

  it('keeps older structural producers valid when owner identity is unavailable', () => {
    const snapshot = subjectOpenSnapshot({
      result: {
        state: 'opened' as const,
        descriptor: { identity: { formatId: 'txt' } },
        selected: {
          contributionId: 'modkit/txt',
          variantId: 'legacy',
          confidence: 0.5,
        },
        candidates: [],
      },
      sessionId: () => 'session-legacy',
      diagnostics: [],
    })

    expect(snapshot.selected).not.toHaveProperty('extensionId')
    expect(snapshot).not.toHaveProperty('selectedRoute')
  })
})
