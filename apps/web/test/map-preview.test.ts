import { diagnostic } from '@modkitx-x3/core'
import type { OpenedSubject } from '@modkitx-x3/host'
import { describe, expect, it, vi } from 'vitest'

import { MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY, prepareWebMapPreview } from '../src/map-preview.js'
import { MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY as ELECTRON_CATALOG_POLICY } from '../../electron/src/map-preview.js'
import { MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY as VSCODE_CATALOG_POLICY } from '../../modkit-vscode/src/map-preview.js'

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
    const explicitCatalog = { schemaVersion: 1, workspaceId: 'explicit' } as never
    const result = await prepareWebMapPreview({
      services: {} as never,
      opened: opened(dispose),
      grant: { id: 'web-map-test', classes: ['read-source'] },
      budgets: budget,
      catalog: explicitCatalog,
      coordinate: async request => {
        expect(request).not.toHaveProperty('resourcePlanResolver')
        expect(request.catalogEnrichment).toBe(MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY)
        expect(request.catalog).toBe(explicitCatalog)
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

  it('keeps the explicit catalog enrichment policy identical in every production adapter', () => {
    expect(MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY).toEqual({
      locales: ['enUS'],
      limits: {
        maxRequirements: 512,
        maxDocumentBytes: 16_777_216,
        maxTextBytes: 268_435_456,
        maxEntities: 100_000,
        maxDepth: 128,
        maxPageSize: 1_000,
      },
    })
    expect(ELECTRON_CATALOG_POLICY).toEqual(MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY)
    expect(VSCODE_CATALOG_POLICY).toEqual(MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY)
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
