import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OpenedSubject } from '@modkitx-x3/host'

import {
  MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY,
  prepareElectronMapPreview,
} from '../src/map-preview.js'
import {
  continueElectronMapPreviewSelection,
  electronMapPreviewSelectionRequest,
  parseElectronMapPreviewSelectionRequest,
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

describe('Electron map preview binding', () => {
  it('preserves all 39 pinned WZ choices under the bounded 64-candidate app policy', async () => {
    const dispose = vi.fn(async () => undefined)
    const candidates = Array.from({ length: 39 }, (_, index) => ({
      candidateId: `map:${String(index)}`,
      displayName: `Map ${String(index)}`,
    }))
    const ordinary = opened(dispose)
    const explicitCatalog = { schemaVersion: 1, workspaceId: 'explicit' } as never
    const resolveResourcePlan = vi.fn()
    const resourcePlanResolver = { resolve: resolveResourcePlan } as never
    const result = await prepareElectronMapPreview({
      services: {} as never,
      opened: ordinary,
      grant: { id: 'electron-map-test', classes: ['read-source'] },
      budgets: budget,
      resourcePlanResolver,
      catalog: explicitCatalog,
      coordinate: async request => {
        expect(request).toMatchObject({
          maxCandidates: 64,
          maxSubjectEntries: 4_096,
          maxSubjectPages: 64,
          maxRoots: 64,
          maxDepth: 16,
        })
        expect(request.catalogEnrichment).toBe(MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY)
        expect(request.catalog).toBe(explicitCatalog)
        expect(request.resourcePlanResolver).toBe(resourcePlanResolver)
        return { state: 'selection-required', candidates, diagnostics: [] }
      },
    })

    expect(result.state).toBe('selection-required')
    expect(result.candidates).toHaveLength(39)
    expect(result.candidates[0]).toMatchObject({ kind: 'map-preview-selection' })
    expect(result.opened.session).toBe(ordinary.session)
    expect(dispose).not.toHaveBeenCalled()
    expect(resolveResourcePlan).not.toHaveBeenCalled()
  })

  it('carries a chosen candidate into the second open and releases the first session first', async () => {
    const events: string[] = []
    const reopened = await continueElectronMapPreviewSelection({
      path: 'C:\\Games\\Warzone 2100\\mp.wz',
      selectionId: 'map:2c-highground',
      dispose: async () => void events.push('dispose:first'),
      open: async request => {
        events.push('open:second')
        return parseElectronMapPreviewSelectionRequest(request)
      },
    })

    expect(events).toEqual(['dispose:first', 'open:second'])
    expect(reopened).toEqual({
      path: 'C:\\Games\\Warzone 2100\\mp.wz',
      selectionId: 'map:2c-highground',
    })
    expect(electronMapPreviewSelectionRequest({ path: 'map.wz', selectionId: 'chosen' })).toMatch(
      /^x3-app-map-preview-selection:/u,
    )
    expect(() =>
      parseElectronMapPreviewSelectionRequest('x3-app-map-preview-selection:%7B'),
    ).toThrow(/malformed/u)
  })

  it('wires the coordinator and continuation parser into Electron main', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'electron', 'main.cjs'), 'utf8')
    expect(source).toContain('prepareElectronMapPreview({')
    expect(source).toContain('createNodeMapPreviewResourcePlanResolver({')
    expect(source).toContain('resourcePlanResolver: mapPreviewResourcePlanResolver')
    expect(source).toContain(
      'mapPreviewResourcePlanResolver = composedNow.mapPreviewResourcePlanResolver',
    )
    expect(source).toContain('parseElectronMapPreviewSelectionRequest(requestedPath)')
    expect(source).toContain('selectionId: mapSelection.selectionId')
    const factoryCall = /createNodeMapPreviewResourcePlanResolver\(\{[\s\S]*?\n {4}\}\)/u.exec(
      source,
    )?.[0]
    expect(factoryCall).toBeDefined()
    expect(factoryCall).toContain('subjects: services')
    expect(factoryCall).not.toContain('configuredPaths')
  })
})
