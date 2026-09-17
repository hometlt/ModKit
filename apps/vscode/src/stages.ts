/**
 * The stage catalog: which shipped `@modkit/ui` module backs which slot id.
 *
 * The *rules* — order, applicability, which ids are editable — are in `./view-policy.js`, which is
 * DOM-free and therefore testable in Node. This file is only the binding, exactly as the Electron
 * host splits `view-policy.ts` from `stages.ts`. Adding a viewer here without ranking its id in
 * `STAGE_ORDER` throws at composition rather than dropping the stage out of every picker.
 *
 * Monaco is not here and will not be: it needs a relaxed `style-src` and a trusted in-process
 * editor, and a VS Code webview gets neither. The bounded and virtual text viewers cover reading;
 * the text editor stage covers writing.
 */
import { createAudioViewer } from '@modkit/ui/audio'
import { createBoundedTextViewer } from '@modkit/ui/code'
import { createSubjectCardViewer } from '@modkit/ui/card'
import { createSubjectCalculationsViewer } from '@modkit/ui/calculations'
import { createTextEditorModule } from '@modkit/ui/editor'
import type { PreviewStage } from '@modkit/ui/explorer'
import { createRelationGraphViewer } from '@modkit/ui/graph'
import { createGameTemplateViewer } from '@modkit/ui/template'
import { createHexViewer } from '@modkit/ui/hex'
import { createHexEditor } from '@modkit/ui/hex-editor'
import { createImageViewer } from '@modkit/ui/image'
import { createMetadataPanel } from '@modkit/ui/metadata'
import { createModelViewer } from '@modkit/ui/model'
import { createTableViewer } from '@modkit/ui/table'
import { createVirtualTextViewer } from '@modkit/ui/text-virtual'
import { createTreeViewer } from '@modkit/ui/tree'
import { createVectorViewer } from '@modkit/ui/vector'
import { createVideoViewer } from '@modkit/ui/video'
import { createWorldViewer } from '@modkit/ui/world'

import { orderStages } from './view-policy.js'
import { createVsCodeArchiveStage } from './archive-stage.js'
import { createVsCodeEditPanel, type EditPanelOptions } from './edit-panel.js'
import type { UiLocalizer } from '@modkit/ui/localization'

/**
 * Every first-party stage this host offers, in policy order.
 *
 * `orderStages` sorts and validates: the list below may be written in any order, and an id that
 * is not ranked is a composition error rather than a stage that silently never appears.
 */
export function createVsCodePreviewStages(context: EditPanelOptions): readonly PreviewStage[] {
  const modelViewer = () =>
    createModelViewer({
      localizer: context.localizer,
      ...(context.renderer === undefined ? {} : { renderer: context.renderer }),
      ...(context.textures === undefined ? {} : { textures: context.textures }),
    })
  return orderStages<PreviewStage>([
    {
      id: 'image',
      label: context.localizer.text('stage.image'),
      contract: 'common.view/raster-image-source',
      module: createImageViewer({
        localizer: context.localizer,
        /*
         * Export is a host capability, not a viewer one: only the extension host knows where this
         * window may write. When the shell offers no writer the viewer disables its export
         * controls and says why, instead of pretending.
         */
        ...(context.exportFiles === undefined ? {} : { exportBytes: context.exportFiles }),
        exportBaseName: descriptor => context.exportBaseName?.(descriptor) ?? 'image',
      }),
    },
    {
      id: 'vector',
      label: context.localizer.text('stage.vector'),
      contract: 'common.view/vector-scene-source',
      module: createVectorViewer({ localizer: context.localizer }),
    },
    {
      id: 'world',
      label: context.localizer.text('stage.world'),
      contract: 'common.view/world-scene-source',
      module: createWorldViewer({ localizer: context.localizer }),
    },
    {
      id: 'model',
      label: context.localizer.text('stage.model'),
      contract: 'common.view/model-scene-source',
      /*
       * Shaded through the provider the extension host selected for this page's realm, and through
       * this stage's own 2D wireframe where it selected none. The page never resolves: it is handed
       * a port or it is not, exactly as the image stage is handed an export writer or not.
       */
      module: modelViewer(),
    },
    {
      id: 'audio',
      label: context.localizer.text('stage.audio'),
      contract: 'common.view/audio-media-source',
      module: createAudioViewer({ localizer: context.localizer }),
    },
    {
      id: 'video',
      label: context.localizer.text('stage.video'),
      contract: 'common.view/video-media-source',
      module: createVideoViewer({ localizer: context.localizer }),
    },
    {
      id: 'archive',
      label: context.localizer.text('stage.entries'),
      contract: 'common.view/namespace-entry-source',
      module: createVsCodeArchiveStage(context.localizer),
    },
    {
      id: 'template',
      label: context.localizer.text('stage.template'),
      operation: 'view.template',
      module: createGameTemplateViewer({
        localizer: context.localizer,
        // Pixels for the assets a template names, when this window can decode them.
        ...(context.templateImages === undefined ? {} : { images: context.templateImages }),
      }),
    },
    {
      id: 'card',
      label: context.localizer.text('stage.card'),
      contract: 'common.view/subject-facts-source',
      // The card's preview section mounts the same shaded, textured model stage.
      module: createSubjectCardViewer({
        localizer: context.localizer,
        previews: { model: modelViewer() },
      }),
    },
    {
      id: 'calculations',
      label: context.localizer.text('stage.calculations'),
      contract: 'common.view/subject-calculations-source',
      module: createSubjectCalculationsViewer({ localizer: context.localizer }),
    },
    {
      id: 'table',
        ...(context.textures === undefined ? {} : { textures: context.textures }),
      label: context.localizer.text('stage.table'),
      optionalContracts: [
        'common.view/raster-image-source',
        'common.view/model-scene-source',
        'common.view/video-media-source',
        'common.view/audio-media-source',
        'common.view/subject-selector-source',
      ],
      contract: 'common.view/table-data-source',
      module: createTableViewer({ localizer: context.localizer }),
    },
    {
      id: 'tree',
      label: context.localizer.text('stage.tree'),
      contract: 'common.view/tree-data-source',
      module: createTreeViewer({ localizer: context.localizer }),
    },
    {
      id: 'relations',
      label: context.localizer.text('stage.relations'),
      contract: 'common.view/relation-graph-source',
      module: createRelationGraphViewer({ localizer: context.localizer }),
    },
    {
      id: 'text',
      label: context.localizer.text('stage.text'),
      contract: 'common.view/text-data-source',
      module: createBoundedTextViewer({ localizer: context.localizer }),
      trait: 'content.text',
    },
    {
      id: 'virtual-text',
      label: context.localizer.text('stage.textStreaming'),
      contract: 'common.view/text-data-source',
      module: createVirtualTextViewer({ localizer: context.localizer }),
      trait: 'content.text',
    },
    /*
     * Mounted only for a subject the extension host handed editing ports for. The ports come from
     * the subject RPC's editing arm, and the arm is refused for anything this host cannot write —
     * so the editors follow what the *host* can save, not what the file looks like.
     */
    {
      id: 'text-editor',
      label: context.localizer.text('stage.textEditor'),
      contract: 'common.view/text-data-source',
      module: createTextEditorModule({ localizer: context.localizer }),
      trait: 'content.text',
      editable: true,
      appLocal: true,
    },
    {
      id: 'edit',
      label: context.localizer.text('stage.edit'),
      contract: 'common.view/byte-range-source',
      module: createVsCodeEditPanel(context),
      editable: true,
      appLocal: true,
    },
    /*
     * The metadata panel consumes no data source of its own — it renders the descriptor's metadata
     * groups — so it is bound to the byte-range source, which is the host's floor for an opened
     * subject. That makes "the subject opened" the condition, stated rather than implied.
     */
    {
      id: 'metadata',
      label: context.localizer.text('stage.metadata'),
      contract: 'common.view/byte-range-source',
      module: createMetadataPanel({ localizer: context.localizer }),
      appLocal: true,
    },
    {
      id: 'hex',
      label: context.localizer.text('stage.hex'),
      contract: 'common.view/byte-range-source',
      module: createHexViewer({ localizer: context.localizer }),
    },
    {
      id: 'hex-editor',
      label: context.localizer.text('stage.hexEditor'),
      contract: 'common.view/byte-range-source',
      module: createHexEditor({ localizer: context.localizer }),
      editable: true,
      appLocal: true,
    },
  ])
}

/** Shown when no codec claims the file at all, so "unknown format" still means "look at it". */
export const createVsCodePreviewFallback = (localizer: UiLocalizer) =>
  Object.freeze({
    text: createBoundedTextViewer({ localizer }),
    hex: createHexViewer({ localizer }),
  })
