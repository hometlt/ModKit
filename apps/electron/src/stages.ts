/**
 * The stage list one tab offers, assembled from two sources and one order.
 *
 *  - `../generated/viewer-catalog.js` — every stage the app policy in
 *    `scripts/emit-app-catalogs.mjs` selected from a real viewer contribution manifest. That
 *    generator is the authority for anything a contribution can describe: which module backs the
 *    slot, which data source it consumes, whether it is an editor.
 *  - `APP_STAGE_POLICY` — the two surfaces `@modkitx-x3/ui` ships without a `stage` contribution
 *    the generator could name: the image editing surface (a component, not a viewer module) and
 *    the namespace tree (a `tree` contribution). The application composes those itself.
 *
 * `orderStages` then puts the union in the app's fixed ranking. Nothing here discovers a viewer.
 */
import type { PreviewStage } from '@modkitx-x3/ui'
import type { OperationSession } from '@modkitx-x3/sdk'

import { PREVIEW_STAGES, PREVIEW_STAGES_READONLY } from '../generated/viewer-catalog.js'
import { createArchiveStage } from './archive-stage.js'
import { imageEditStage } from './image-edit-stage.js'
import { APP_STAGE_POLICY, orderStages, readOnlyStages } from './view-policy.js'

export interface ElectronStageOptions {
  /** Operation session for the subject a stage was mounted for, when the host has one. */
  operationsFor(descriptor: Record<string, unknown>): Promise<OperationSession | undefined>
}

function appStage(id: string, module: PreviewStage['module']): PreviewStage {
  const policy = APP_STAGE_POLICY.find(item => item.id === id)
  if (policy === undefined) throw new TypeError(`no app stage policy for ${id}`)
  return { id: policy.id, label: policy.label, contract: policy.contract, module }
}

export function createElectronStages(options: ElectronStageOptions): readonly PreviewStage[] {
  return orderStages<PreviewStage>([
    ...PREVIEW_STAGES,
    appStage('archive', createArchiveStage({ operationsFor: options.operationsFor })),
    appStage('image-edit', imageEditStage),
  ])
}

/** The same stages for a subject this host cannot write; see `readOnlyStages` for the rule. */
export function createElectronReadOnlyStages(
  options: ElectronStageOptions,
): readonly PreviewStage[] {
  return orderStages<PreviewStage>([
    ...readOnlyStages(PREVIEW_STAGES, PREVIEW_STAGES_READONLY),
    appStage('archive', createArchiveStage({ operationsFor: options.operationsFor })),
    appStage('image-edit', imageEditStage),
  ])
}
