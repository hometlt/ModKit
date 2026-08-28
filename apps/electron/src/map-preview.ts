/** Electron policy around the common host-owned map preview coordinator. */

import { diagnostic, type Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import type { MapPreviewSelectionCandidate } from '@modkitx-x3/sdk/maps'
import type { OpenedSubject } from '@modkitx-x3/host'
import {
  coordinateMapPreviewAssetSession,
  type CoordinateMapPreviewAssetSessionRequest,
  type CoordinatedMapPreviewAssetSessionResult,
  type MapPreviewResourcePlanResolver,
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

export interface ElectronMapPreviewCandidate extends MapPreviewSelectionCandidate {
  readonly kind: 'map-preview-selection'
}

export interface PrepareElectronMapPreviewRequest {
  readonly services: CoordinateMapPreviewAssetSessionRequest['services']
  readonly opened: OpenedSubject
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly resourcePlanResolver?: MapPreviewResourcePlanResolver
  readonly selectionId?: string
  readonly signal?: AbortSignal
  /** Test seam: product callers always use the common host coordinator. */
  readonly coordinate?: MapPreviewCoordinator
}

export interface PreparedElectronMapPreview {
  readonly state: CoordinatedMapPreviewAssetSessionResult['state']
  readonly opened: OpenedSubject
  readonly candidates: readonly ElectronMapPreviewCandidate[]
}

const selectionDiagnostic = (): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/map-preview-selection-required',
    'Map preview needs an explicit selection; choose one of the returned map-preview candidates to continue.',
  )

/**
 * Try to replace an ordinary codec/archive session with the shared world preview session.
 *
 * Only `opened` transfers ownership. Every other coordinator state returns the original live
 * session, with its findings preserved for the RPC snapshot; no candidate is selected implicitly.
 */
export async function prepareElectronMapPreview(
  request: PrepareElectronMapPreviewRequest,
): Promise<PreparedElectronMapPreview> {
  let result: CoordinatedMapPreviewAssetSessionResult
  try {
    result = await (request.coordinate ?? coordinateMapPreviewAssetSession)({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      original: request.opened.session,
      ...(request.resourcePlanResolver === undefined
        ? {}
        : { resourcePlanResolver: request.resourcePlanResolver }),
      ...(request.selectionId === undefined ? {} : { selectionId: request.selectionId }),
      ...COORDINATOR_LIMITS,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    // The coordinator did not return `opened`, so ownership has not transferred anywhere.
    await request.opened.session.dispose()
    throw error
  }

  const diagnostics = Object.freeze([
    ...request.opened.diagnostics,
    ...result.diagnostics,
    ...(result.state === 'selection-required' ? [selectionDiagnostic()] : []),
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
  return Object.freeze({ state: result.state, opened, candidates })
}
