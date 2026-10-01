/** VS Code policy around the common host-owned map preview coordinator. */

import { diagnostic, type Diagnostic } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import type { MapPreviewSelectionCandidate } from '@modkit/sdk/maps'
import type { OpenedSubject, SubjectOpener } from '@modkit/host'
import {
  coordinateMapPreviewAssetSession,
  MAP_PREVIEW_COORDINATOR_LIMITS,
  withMapPreviewSources,
  type CoordinateMapPreviewAssetSessionRequest,
  type CoordinatedMapPreviewAssetSessionResult,
  type MapPreviewResourcePlanResolver,
} from '@modkit/host/maps'
import type { UiLocalizer } from '@modkit/ui/localization'

import { createVscodeLocalizer } from './localization.js'

type MapPreviewCoordinator = (
  request: CoordinateMapPreviewAssetSessionRequest,
) => Promise<CoordinatedMapPreviewAssetSessionResult>

export interface VsCodeMapPreviewCandidate extends MapPreviewSelectionCandidate {
  readonly kind: 'map-preview-selection'
}

export interface PrepareVsCodeMapPreviewRequest {
  readonly services: CoordinateMapPreviewAssetSessionRequest['services']
  readonly opened: OpenedSubject
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly resourcePlanResolver?: MapPreviewResourcePlanResolver
  readonly catalog?: CoordinateMapPreviewAssetSessionRequest['catalog']
  readonly selectionId?: string
  readonly signal?: AbortSignal
  /** Host-selected UI language; defaults to the deterministic English application catalog. */
  readonly localizer?: UiLocalizer
  /** Game-string locales the map's names are read in, preferred first (`modkit.locale`). */
  readonly locales?: readonly string[]
  /** The window's content sources: the world's models also reach the subject's dependency layers. */
  readonly contentSources?: CoordinateMapPreviewAssetSessionRequest['contentSources']
  /** Test seam: product callers always use the common host coordinator. */
  readonly coordinate?: MapPreviewCoordinator
}

export interface PreparedVsCodeMapPreview {
  readonly state: CoordinatedMapPreviewAssetSessionResult['state']
  readonly opened: OpenedSubject
  readonly candidates: readonly VsCodeMapPreviewCandidate[]
}

const selectionDiagnostic = (localizer: UiLocalizer): Diagnostic =>
  diagnostic(
    'information',
    'x3.app/map-preview-selection-required',
    localizer.text('vscode.map.diagnostic.selectionRequired'),
  )

/** Preserve the ordinary live session unless the common coordinator returns `opened`. */
export async function prepareVsCodeMapPreview(
  request: PrepareVsCodeMapPreviewRequest,
): Promise<PreparedVsCodeMapPreview> {
  const localizer = request.localizer ?? createVscodeLocalizer('en')
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
      ...MAP_PREVIEW_COORDINATOR_LIMITS,
      ...(request.locales === undefined
        ? {}
        : {
            catalogEnrichment: {
              ...MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment,
              locales: Object.freeze([...request.locales]),
            },
          }),
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      ...(request.contentSources === undefined ? {} : { contentSources: request.contentSources }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    await request.opened.session.dispose()
    throw error
  }

  const diagnostics = Object.freeze([
    ...request.opened.diagnostics,
    ...result.diagnostics,
    ...(result.state === 'selection-required' ? [selectionDiagnostic(localizer)] : []),
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

export interface VsCodeMapWorldInputs {
  readonly services: CoordinateMapPreviewAssetSessionRequest['services']
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly resourcePlanResolver?: MapPreviewResourcePlanResolver
  /** Game-string locales the map's names are read in (`modkit.locale`). */
  readonly locales?: () => readonly string[]
  readonly contentSources?: () => Promise<
    CoordinateMapPreviewAssetSessionRequest['contentSources'] | undefined
  >
  /** Which of a package's maps; undefined cancels the open. */
  readonly choose: (
    candidates: readonly MapPreviewSelectionCandidate[],
  ) => Promise<string | undefined>
  /** What the coordinator said when it built no world. */
  readonly report?: (diagnostics: readonly Diagnostic[]) => void
  /** Test seam: product callers always use the common host coordinator. */
  readonly coordinate?: MapPreviewCoordinator
}

/**
 * An opener whose maps come with the world their preview builds (П24), so `subject.convert` with
 * target `uvw` finds it: the CLI's way, with this window's locales and sources. A package of
 * several maps (a campaign, `mp.wz`) asks which one; anything that is no map opens as before. The
 * subject keeps its own operations beside the world, and disposing it releases both.
 */
export function withVsCodeMapWorld(
  opener: SubjectOpener,
  inputs: VsCodeMapWorldInputs,
): SubjectOpener {
  return async (path, signal) => {
    const opened = await opener(path, signal)
    const original = opened.session
    if (opened.snapshot.state !== 'opened' || original === undefined) return opened
    const contentSources = await inputs.contentSources?.()
    const locales = inputs.locales?.()
    const coordinate = (selectionId?: string) =>
      (inputs.coordinate ?? coordinateMapPreviewAssetSession)({
        services: inputs.services,
        grant: inputs.grant,
        budgets: inputs.budgets,
        original,
        ...MAP_PREVIEW_COORDINATOR_LIMITS,
        ...(locales === undefined
          ? {}
          : {
              catalogEnrichment: {
                ...MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment,
                locales: Object.freeze([...locales]),
              },
            }),
        ...(inputs.resourcePlanResolver === undefined
          ? {}
          : { resourcePlanResolver: inputs.resourcePlanResolver }),
        ...(contentSources === undefined ? {} : { contentSources }),
        ...(selectionId === undefined ? {} : { selectionId }),
        ...(signal === undefined ? {} : { signal }),
      })
    let preview: CoordinatedMapPreviewAssetSessionResult
    try {
      preview = await coordinate()
      if (preview.state === 'selection-required') {
        const chosen = await inputs.choose(preview.candidates)
        if (chosen === undefined) throw new DOMException('no map was chosen', 'AbortError')
        preview = await coordinate(chosen)
      }
    } catch (error) {
      await original.dispose()
      throw error
    }
    if (preview.state === 'opened') {
      return { ...opened, session: withMapPreviewSources(original, preview.session) }
    }
    if (preview.state !== 'not-applicable') inputs.report?.(preview.diagnostics)
    return opened
  }
}
