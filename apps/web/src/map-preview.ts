/** Browser policy around the common host-owned map preview coordinator. */

import { diagnostic, type Diagnostic } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import type { MapPreviewSelectionCandidate } from '@modkit/sdk/maps'
import type { OpenedSubject } from '@modkit/host'
import {
  coordinateMapPreviewAssetSession,
  type CoordinateMapPreviewAssetSessionRequest,
  type CoordinatedMapPreviewAssetSessionResult,
} from '@modkit/host/maps'
import type { UiLocalizer } from '@modkit/ui/localization'

import { createWebLocalizer } from './localization.js'

export const MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY: NonNullable<
  CoordinateMapPreviewAssetSessionRequest['catalogEnrichment']
> = Object.freeze({
  locales: Object.freeze(['enUS']),
  limits: Object.freeze({
    // A multi-root workspace may need hundreds of bounded reads across catalog families and locale.
    maxRequirements: 512,
    maxDocumentBytes: 16_777_216,
    maxTextBytes: 268_435_456,
    maxEntities: 100_000,
    maxDepth: 128,
    maxPageSize: 1_000,
  }),
})

const COORDINATOR_LIMITS = Object.freeze({
  // Pinned mp.wz publishes 39 map candidates; 64 is the bounded product ceiling above that corpus.
  maxCandidates: 64,
  maxSubjectEntries: 4_096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  catalogEnrichment: MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY,
  limits: Object.freeze({
    maxRequirements: 16,
    maxDocumentBytes: 33_554_432,
    maxTotalBytes: 67_108_864,
    maxObjects: 100_000,
    maxRegions: 10_000,
    maxTerrainCells: 100_000,
    maxTerrainSamples: 100_000,
    maxDepth: 64,
    maxPageSize: 4_096,
    maxDiagnostics: 100,
  }),
})

type MapPreviewCoordinator = (
  request: CoordinateMapPreviewAssetSessionRequest,
) => Promise<CoordinatedMapPreviewAssetSessionResult>

export interface WebMapPreviewCandidate extends MapPreviewSelectionCandidate {
  readonly kind: 'map-preview-selection'
}

export type WebMapPreviewState =
  CoordinatedMapPreviewAssetSessionResult['state'] | 'permission-required'

export interface PrepareWebMapPreviewRequest {
  readonly services: CoordinateMapPreviewAssetSessionRequest['services']
  readonly opened: OpenedSubject
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly catalog?: CoordinateMapPreviewAssetSessionRequest['catalog']
  readonly selectionId?: string
  readonly signal?: AbortSignal
  /** Host-selected UI language; defaults to the deterministic English application catalog. */
  readonly localizer?: UiLocalizer
  /** Test seam: product callers always use the common host coordinator. */
  readonly coordinate?: MapPreviewCoordinator
}

export interface PreparedWebMapPreview {
  readonly state: WebMapPreviewState
  readonly opened: OpenedSubject
  readonly candidates: readonly WebMapPreviewCandidate[]
}

const selectionDiagnostic = (localizer: UiLocalizer): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/map-preview-selection-required',
    localizer.text('web.map.diagnostic.selectionRequired'),
  )

const permissionDiagnostic = (localizer: UiLocalizer): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/web-map-preview-permission-required',
    localizer.text('web.map.diagnostic.permissionRequired'),
  )

/**
 * Browser map preparation deliberately has no host resource resolver. A host-resolved plan stays
 * unresolved/permission-required and the ordinary codec/archive session remains usable.
 */
export async function prepareWebMapPreview(
  request: PrepareWebMapPreviewRequest,
): Promise<PreparedWebMapPreview> {
  const localizer = request.localizer ?? createWebLocalizer('en')
  let result: CoordinatedMapPreviewAssetSessionResult
  try {
    result = await (request.coordinate ?? coordinateMapPreviewAssetSession)({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      original: request.opened.session,
      ...(request.selectionId === undefined ? {} : { selectionId: request.selectionId }),
      ...COORDINATOR_LIMITS,
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    await request.opened.session.dispose()
    throw error
  }

  const permissionRequired =
    result.state === 'unresolved' &&
    result.diagnostics.some(item => item.code === 'x3.host/map-preview-resource-resolver-required')
  const diagnostics = Object.freeze([
    ...request.opened.diagnostics,
    ...result.diagnostics,
    ...(result.state === 'selection-required' ? [selectionDiagnostic(localizer)] : []),
    ...(permissionRequired ? [permissionDiagnostic(localizer)] : []),
  ])
  const candidates =
    result.state === 'selection-required'
      ? Object.freeze(
          result.candidates.map(candidate =>
            Object.freeze({ kind: 'map-preview-selection' as const, ...candidate }),
          ),
        )
      : Object.freeze([])
  const opened = Object.freeze({
    ...request.opened,
    ...(result.state === 'opened'
      ? { descriptor: result.descriptor, session: result.session }
      : {}),
    diagnostics,
  })
  return Object.freeze({
    state: permissionRequired ? ('permission-required' as const) : result.state,
    opened,
    candidates,
  })
}
