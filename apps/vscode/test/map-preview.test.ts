import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OpenedSubject } from '@modkit/host'

import { MAP_PREVIEW_COORDINATOR_LIMITS } from '@modkit/host/maps'
import { prepareVsCodeMapPreview } from '../src/map-preview.js'
import {
  continueVsCodeMapPreviewSelection,
  parseVsCodeMapPreviewSelectionRequest,
} from '../src/map-preview-selection.js'
import { createVscodeLocalizer } from '../src/localization.js'

const budget = {
  maxInputBytes: 64n * 1024n * 1024n,
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: 64 * 1024 * 1024,
  maxDiagnostics: 10_000,
  deadlineMs: 30_000,
} as const

/** The codec's own subject: an archive with nothing of a world. */
const codecDescriptor = {
  subjectUri: 'memory://map.wz',
  dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
  traits: [],
  diagnostics: [],
}

function opened(dispose: () => Promise<void>): OpenedSubject {
  return {
    state: 'opened',
    descriptor: codecDescriptor,
    session: { dispose, descriptor: async () => codecDescriptor },
    selected: { contributionId: 'archive', variantId: 'main', confidence: 1 },
    candidates: [],
    diagnostics: [],
  } as unknown as OpenedSubject
}

describe('VS Code map preview binding', () => {
  it('uses the common coordinator and transfers the derived session only on opened', async () => {
    const disposeOriginal = vi.fn(async () => undefined)
    const disposePreview = vi.fn(async () => undefined)
    const resolveResourcePlan = vi.fn()
    const resourcePlanResolver = { resolve: resolveResourcePlan } as never
    const explicitCatalog = { schemaVersion: 1, workspaceId: 'explicit' } as never
    const derived = {
      subjectUri: 'world://map',
      dataSources: [{ contract: 'common.view/world-scene-source', major: 1 }],
      traits: [{ id: 'model.geometry' }],
      diagnostics: [],
    } as never
    const result = await prepareVsCodeMapPreview({
      services: {} as never,
      opened: opened(disposeOriginal),
      grant: { id: 'vscode-map-test', classes: ['read-source'] },
      budgets: budget,
      resourcePlanResolver,
      catalog: explicitCatalog,
      coordinate: async request => {
        expect(request.maxCandidates).toBe(64)
        expect(request.catalogEnrichment).toBe(MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment)
        expect(request.catalog).toBe(explicitCatalog)
        expect(request.resourcePlanResolver).toBe(resourcePlanResolver)
        return {
          state: 'opened',
          session: { dispose: disposePreview, descriptor: async () => derived } as never,
          descriptor: derived,
          snapshot: {} as never,
          plan: {} as never,
          diagnostics: [],
        }
      },
    })

    expect(result.state).toBe('opened')
    // the world joins the codec's subject, whose archive stays beside it (plan 6.4)
    expect(result.opened.descriptor.subjectUri).toBe('memory://map.wz')
    expect(result.opened.descriptor.dataSources.map(offer => offer.contract)).toEqual([
      'common.view/namespace-entry-source',
      'common.view/world-scene-source',
    ])
    expect(result.opened.descriptor.traits.map(trait => trait.id)).toEqual(['model.geometry'])
    expect(disposeOriginal).not.toHaveBeenCalled()
    await result.opened.session.dispose()
    expect(disposePreview).toHaveBeenCalledOnce()
    expect(disposeOriginal).not.toHaveBeenCalled()
    expect(resolveResourcePlan).not.toHaveBeenCalled()
  })

  it('reads names in the chosen game locales and lets models reach the dependency layers', async () => {
    const contentSources = { snapshot: async () => ({}) } as never
    let seen:
      | Parameters<NonNullable<Parameters<typeof prepareVsCodeMapPreview>[0]['coordinate']>>[0]
      | undefined
    await prepareVsCodeMapPreview({
      services: {} as never,
      opened: opened(async () => undefined),
      grant: { id: 'vscode-map-sources', classes: ['read-source'] },
      budgets: budget,
      locales: ['ruRU', 'enUS'],
      contentSources,
      coordinate: async request => {
        seen = request
        return { state: 'selection-required', candidates: [], diagnostics: [] }
      },
    })
    expect(seen?.catalogEnrichment?.locales).toEqual(['ruRU', 'enUS'])
    // the limits stay those of the policy; only the locales follow the window
    expect(seen?.catalogEnrichment?.limits).toBe(
      MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment.limits,
    )
    expect(seen?.contentSources).toBe(contentSources)
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

  it('uses the selected VS Code locale for host-owned map diagnostics', async () => {
    const result = await prepareVsCodeMapPreview({
      services: {} as never,
      opened: opened(async () => undefined),
      grant: { id: 'vscode-map-locale', classes: ['read-source'] },
      budgets: budget,
      localizer: createVscodeLocalizer('ru-RU'),
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
  })

  it('wires one generic desktop resolver from the composed host into every served page', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'extension.ts'), 'utf8')
    const factoryCall = /createNodeMapPreviewResourcePlanResolver\(\{[\s\S]*?\n {2}\}\)/u.exec(
      source,
    )?.[0]
    expect(factoryCall).toBeDefined()
    expect(factoryCall).toContain('subjects: host.services')
    // installations come from the person's choice in Games and the folder search, never from a
    // path written into the code
    expect(factoryCall).toContain('selectedSources.map(')
    expect(factoryCall).toContain('searchedInstallationFolders()')
    expect(factoryCall).not.toMatch(/['"`][A-Za-z]:[\\/]/u)
    expect(source).toContain('mapPreviewResourcePlanResolver,')
    expect(source).toContain('localizer,')
  })
})
