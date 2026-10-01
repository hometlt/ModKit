import { diagnostic } from '@modkit/core'
import type { OpenedSubject } from '@modkit/host'
import { describe, expect, it, vi } from 'vitest'

import { MAP_PREVIEW_COORDINATOR_LIMITS } from '@modkit/host/maps'
import { prepareWebMapPreview } from '../src/map-preview.js'
import { createWebLocalizer } from '../src/localization.js'
import { MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY as ELECTRON_CATALOG_POLICY } from '../../electron/src/map-preview.js'

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
    descriptor: { subjectUri: 'memory://map.samplemap' },
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
      localizer: createWebLocalizer('ru-RU'),
      catalog: explicitCatalog,
      coordinate: async request => {
        expect(request).not.toHaveProperty('resourcePlanResolver')
        expect(request.catalogEnrichment).toBe(MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment)
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
    expect(
      result.opened.diagnostics.find(
        item => item.code === 'x3.app/web-map-preview-permission-required',
      )?.message,
    ).toContain('Для этой карты нужны ресурсы установленной игры')
    expect(dispose).not.toHaveBeenCalled()
  })

  it('localizes selection diagnostics and shell status copy in English and Russian', async () => {
    const result = await prepareWebMapPreview({
      services: {} as never,
      opened: opened(async () => undefined),
      grant: { id: 'web-map-locale', classes: ['read-source'] },
      budgets: budget,
      localizer: createWebLocalizer('ru'),
      coordinate: async () => ({
        state: 'selection-required',
        candidates: [{ candidateId: 'map:one', displayName: 'One' }],
        diagnostics: [],
      }),
    })

    expect(
      result.opened.diagnostics.find(item => item.code === 'x3.app/map-preview-selection-required')
        ?.message,
    ).toContain('нужно явно выбрать вариант')
    expect(
      createWebLocalizer('en').text('web.map.selectionRequired', {
        name: 'map.wz',
        candidates: 'One',
      }),
    ).toContain('map preview needs a choice')
    expect(
      createWebLocalizer('ru').text('web.map.selectionRequired', {
        name: 'map.wz',
        candidates: 'One',
      }),
    ).toContain('нужно выбрать вариант')
  })

  it('keeps the explicit catalog enrichment policy identical in every production adapter', () => {
    // VS Code and the PWA take the host's set; Electron keeps its copy until it is touched again
    const MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY = MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment
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
