import { describe, expect, it, vi } from 'vitest'
import type { OpenedSubject } from '@modkitx-x3/host'

import { prepareVsCodeMapPreview } from '../src/map-preview.js'
import {
  continueVsCodeMapPreviewSelection,
  parseVsCodeMapPreviewSelectionRequest,
} from '../src/map-preview-selection.js'

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
    descriptor: { subjectUri: 'memory://map.wz' },
    session: { dispose },
    selected: { contributionId: 'archive', variantId: 'main', confidence: 1 },
    candidates: [],
    diagnostics: [],
  } as unknown as OpenedSubject
}

describe('VS Code map preview binding', () => {
  it('uses the common coordinator and transfers the derived session only on opened', async () => {
    const disposeOriginal = vi.fn(async () => undefined)
    const disposePreview = vi.fn(async () => undefined)
    const derived = { subjectUri: 'world://map' } as never
    const result = await prepareVsCodeMapPreview({
      services: {} as never,
      opened: opened(disposeOriginal),
      grant: { id: 'vscode-map-test', classes: ['read-source'] },
      budgets: budget,
      coordinate: async request => {
        expect(request.maxCandidates).toBe(64)
        return {
          state: 'opened',
          session: { dispose: disposePreview } as never,
          descriptor: derived,
          snapshot: {} as never,
          plan: {} as never,
          diagnostics: [],
        }
      },
    })

    expect(result.state).toBe('opened')
    expect(result.opened.descriptor).toBe(derived)
    expect(result.opened.session).not.toBeUndefined()
    expect(disposeOriginal).not.toHaveBeenCalled()
    await result.opened.session.dispose()
    expect(disposePreview).toHaveBeenCalledOnce()
    expect(disposeOriginal).not.toHaveBeenCalled()
  })

  it('turns a user-selected candidate into the host second-open request', async () => {
    const dispose = vi.fn(async () => undefined)
    const open = vi.fn(async request => parseVsCodeMapPreviewSelectionRequest(request))
    const result = await continueVsCodeMapPreviewSelection({
      path: 'C:\\workspace\\mp.wz',
      selectionId: 'map:2c-highground',
      dispose,
      open,
    })

    expect(dispose).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(result).toEqual({
      path: 'C:\\workspace\\mp.wz',
      selectionId: 'map:2c-highground',
    })
  })
})
