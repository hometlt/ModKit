/** Browser policy around the common host-owned map preview coordinator. */

import { diagnostic, type Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import type { MapPreviewSelectionCandidate } from '@modkitx-x3/sdk/maps'
import type { OpenedSubject } from '@modkitx-x3/host'
import {
  coordinateMapPreviewAssetSession,
  type CoordinateMapPreviewAssetSessionRequest,
  type CoordinatedMapPreviewAssetSessionResult,
} from '@modkitx-x3/host/maps'

const COORDINATOR_LIMITS = Object.freeze({
  // Pinned mp.wz publishes 39 map candidates; 64 is the bounded product ceiling above that corpus.
  maxCandidates: 64,
  maxSubjectEntries: 4_096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  limits: Object.freeze({
    maxRequirements: 8,
    maxDocumentBytes: 1_000_000,
    maxTotalBytes: 4_000_000,
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
  readonly selectionId?: string
  readonly signal?: AbortSignal
  /** Test seam: product callers always use the common host coordinator. */
  readonly coordinate?: MapPreviewCoordinator
}

export interface PreparedWebMapPreview {
  readonly state: WebMapPreviewState
  readonly opened: OpenedSubject
  readonly candidates: readonly WebMapPreviewCandidate[]
}

const selectionDiagnostic = (): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/map-preview-selection-required',
    'Map preview needs an explicit selection; choose one of the returned map-preview candidates to continue.',
  )

const permissionDiagnostic = (): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/web-map-preview-permission-required',
    'This map needs installation resources that the browser cannot search for automatically; grant or select them in a desktop host.',
  )

/**
 * Browser map preparation deliberately has no host resource resolver. A host-resolved plan stays
 * unresolved/permission-required and the ordinary codec/archive session remains usable.
 */
export async function prepareWebMapPreview(
  request: PrepareWebMapPreviewRequest,
): Promise<PreparedWebMapPreview> {
  let result: CoordinatedMapPreviewAssetSessionResult
  try {
    result = await (request.coordinate ?? coordinateMapPreviewAssetSession)({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      original: request.opened.session,
      ...(request.selectionId === undefined ? {} : { selectionId: request.selectionId }),
      ...COORDINATOR_LIMITS,
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
    ...(result.state === 'selection-required' ? [selectionDiagnostic()] : []),
    ...(permissionRequired ? [permissionDiagnostic()] : []),
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
