/** Browser policy around the common host-owned map preview coordinator. */

import { diagnostic, type Diagnostic } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import type { MapPreviewSelectionCandidate } from '@modkit/sdk/maps'
import type { OpenedSubject } from '@modkit/host'
import {
  coordinateMapPreviewAssetSession,
  MAP_PREVIEW_COORDINATOR_LIMITS,
  withMapPreviewSources,
  type CoordinateMapPreviewAssetSessionRequest,
  type CoordinatedMapPreviewAssetSessionResult,
} from '@modkit/host/maps'
import type { UiLocalizer } from '@modkit/ui/localization'

import { createWebLocalizer } from './localization.js'

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
      ...MAP_PREVIEW_COORDINATOR_LIMITS,
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
  const joined = result.state === 'opened' ? await joinWorld(request.opened, result.session) : {}
  const opened = Object.freeze({ ...request.opened, ...joined, diagnostics })
  return Object.freeze({
    state: permissionRequired ? ('permission-required' as const) : result.state,
    opened,
    candidates,
  })
}

/**
 * The subject with the world its preview built joined to it (plan 6.4): the codec's archive, layers,
 * card and edits stay beside the world, whose sources and traits the codec lacks are added.
 */
async function joinWorld(
  opened: OpenedSubject,
  preview: OpenedSubject['session'],
): Promise<Pick<OpenedSubject, 'descriptor' | 'session'>> {
  const session = withMapPreviewSources(opened.session, preview)
  try {
    return { descriptor: await session.descriptor(), session }
  } catch (error) {
    // the preview owns the opened session: releasing it releases both
    await session.dispose()
    throw error
  }
}
