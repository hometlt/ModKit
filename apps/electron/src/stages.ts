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
import type { UiLocalizer } from '@modkitx-x3/ui/localization'
import type { OperationSession } from '@modkitx-x3/sdk'

import {
  createPreviewStages,
  createPreviewStagesReadonly,
  PREVIEW_STAGES,
  PREVIEW_STAGES_READONLY,
} from '../generated/viewer-catalog.js'
import { createArchiveStage } from './archive-stage.js'
import { createImageEditStage } from './image-edit-stage.js'
import { APP_STAGE_POLICY, orderStages, readOnlyStages } from './view-policy.js'

export interface ElectronStageOptions {
  readonly localizer?: UiLocalizer
  /** Operation session for the subject a stage was mounted for, when the host has one. */
  operationsFor(descriptor: Record<string, unknown>): Promise<OperationSession | undefined>
  /** Include the pixel editor only for a subject whose PNG/RGBA8 writer resolved in main. */
  readonly imageEditing?: boolean
  /** Reopen a PNG after the semantic encoder commits its new bytes. */
  readonly onImageCommitted?: (descriptor: Record<string, unknown>) => Promise<boolean>
}

const VIEW_KEYS: Readonly<Record<string, string>> = Object.freeze({
  code: 'code',
  video: 'video',
  image: 'image',
  'image-edit': 'imageEdit',
  audio: 'audio',
  world: 'world',
  model: 'model',
  vector: 'vector',
  archive: 'archive',
  template: 'template',
  card: 'card',
  calculations: 'calculations',
  table: 'table',
  tree: 'tree',
  relations: 'relations',
  text: 'text',
  'virtual-text': 'virtualText',
  hex: 'hex',
})

const localizedLabel = (stage: PreviewStage, localizer?: UiLocalizer): PreviewStage => {
  const key = stage.id === undefined ? undefined : VIEW_KEYS[stage.id]
  return localizer === undefined || key === undefined
    ? stage
    : { ...stage, label: localizer.text(`electron.view.${key}`) }
}

function appStage(
  id: string,
  module: PreviewStage['module'],
  editable = false,
  localizer?: UiLocalizer,
): PreviewStage {
  const policy = APP_STAGE_POLICY.find(item => item.id === id)
  if (policy === undefined) throw new TypeError(`no app stage policy for ${id}`)
  return {
    id: policy.id,
    label:
      localizer === undefined
        ? policy.label
        : localizer.text(`electron.view.${VIEW_KEYS[id] ?? id}`),
    contract: policy.contract,
    module,
    ...(editable ? { editable: true } : {}),
    ...(id === 'image-edit' ? { appLocal: true } : {}),
  }
}

export function createElectronStages(options: ElectronStageOptions): readonly PreviewStage[] {
  const generated =
    options.localizer === undefined ? PREVIEW_STAGES : createPreviewStages(options.localizer)
  return orderStages<PreviewStage>([
    ...generated.map(stage => localizedLabel(stage, options.localizer)),
    appStage(
      'archive',
      createArchiveStage({
        operationsFor: options.operationsFor,
        ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
      }),
      false,
      options.localizer,
    ),
    ...(options.imageEditing === true
      ? [
          appStage(
            'image-edit',
            createImageEditStage({
              ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
              ...(options.onImageCommitted === undefined
                ? {}
                : { onCommitted: options.onImageCommitted }),
            }),
            true,
            options.localizer,
          ),
        ]
      : []),
  ])
}

/** The same stages for a subject this host cannot write; see `readOnlyStages` for the rule. */
export function createElectronReadOnlyStages(
  options: ElectronStageOptions,
): readonly PreviewStage[] {
  const editableGenerated =
    options.localizer === undefined ? PREVIEW_STAGES : createPreviewStages(options.localizer)
  const readonlyGenerated =
    options.localizer === undefined
      ? PREVIEW_STAGES_READONLY
      : createPreviewStagesReadonly(options.localizer)
  const generated = readOnlyStages(editableGenerated, readonlyGenerated)
  return orderStages<PreviewStage>([
    ...generated.map(stage => localizedLabel(stage, options.localizer)),
    appStage(
      'archive',
      createArchiveStage({
        operationsFor: options.operationsFor,
        ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
      }),
      false,
      options.localizer,
    ),
  ])
}
