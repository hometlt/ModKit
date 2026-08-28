import { diagnostic } from '@modkitx-x3/core'
import type { OpenedSubject } from '@modkitx-x3/host'
import { describe, expect, it, vi } from 'vitest'

import { prepareWebMapPreview } from '../src/map-preview.js'

const budget = {
  maxInputBytes: 64n * 1024n * 1024n,
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: 64 * 1024 * 1024,
  maxDiagnostics: 10_000,
  deadlineMs: 30_000,
} as const

function opened(dispose: () => Promise<void>): OpenedSubject {
  return {
    state: 'opened',
    descriptor: { subjectUri: 'memory://map.sc2map' },
    session: { dispose },
    selected: { contributionId: 'archive', variantId: 'main', confidence: 1 },
    candidates: [],
    diagnostics: [],
  } as unknown as OpenedSubject
}

describe('Web map preview binding', () => {
  it('omits local installation resolution and reports permission-required without closing archive', async () => {
    const dispose = vi.fn(async () => undefined)
    const result = await prepareWebMapPreview({
      services: {} as never,
      opened: opened(dispose),
      grant: { id: 'web-map-test', classes: ['read-source'] },
      budgets: budget,
      coordinate: async request => {
        expect(request).not.toHaveProperty('resourcePlanResolver')
        return {
          state: 'unresolved',
          diagnostics: [
            diagnostic(
              'warning',
              'x3.host/map-preview-resource-resolver-required',
              'desktop installation resources are required',
            ),
          ],
        }
      },
    })

    expect(result.state).toBe('permission-required')
    expect(result.opened.diagnostics.map(item => item.code)).toContain(
      'x3.app/web-map-preview-permission-required',
    )
    expect(dispose).not.toHaveBeenCalled()
  })

  it('passes an explicit selectionId on continuation without selecting the first candidate', async () => {
    const seen: (string | undefined)[] = []
    const result = await prepareWebMapPreview({
      services: {} as never,
      opened: opened(async () => undefined),
      grant: { id: 'web-map-selection', classes: ['read-source'] },
      budgets: budget,
      selectionId: 'map:chosen',
      coordinate: async request => {
        seen.push(request.selectionId)
        return { state: 'not-applicable', diagnostics: [] }
      },
    })

    expect(seen).toEqual(['map:chosen'])
    expect(result.state).toBe('not-applicable')
  })
})
