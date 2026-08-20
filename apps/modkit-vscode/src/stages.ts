/**
 * The stage catalog: which shipped `@modkitx-x3/ui` module backs which slot id.
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
import { audioViewer } from '@modkitx-x3/ui/audio'
import { boundedTextViewer } from '@modkitx-x3/ui/code'
import { textEditor } from '@modkitx-x3/ui/editor'
import type { PreviewStage } from '@modkitx-x3/ui/explorer'
import { hexViewer } from '@modkitx-x3/ui/hex'
import { hexEditor } from '@modkitx-x3/ui/hex-editor'
import { imageViewer } from '@modkitx-x3/ui/image'
import { metadataPanel } from '@modkitx-x3/ui/metadata'
import { modelViewer } from '@modkitx-x3/ui/model'
import { tableViewer } from '@modkitx-x3/ui/table'
import { virtualTextViewer } from '@modkitx-x3/ui/text-virtual'
import { treeViewer } from '@modkitx-x3/ui/tree'
import { vectorViewer } from '@modkitx-x3/ui/vector'
import { videoViewer } from '@modkitx-x3/ui/video'

import { orderStages } from './view-policy.js'
import { vscodeArchiveStage } from './archive-stage.js'
import { createVsCodeEditPanel, type EditPanelOptions } from './edit-panel.js'

/**
 * Every first-party stage this host offers, in policy order.
 *
 * `orderStages` sorts and validates: the list below may be written in any order, and an id that
 * is not ranked is a composition error rather than a stage that silently never appears.
 */
export function createVsCodePreviewStages(context: EditPanelOptions): readonly PreviewStage[] {
  return orderStages<PreviewStage>([
    {
      id: 'image',
      label: 'Image',
      contract: 'common.view/raster-image-source',
      module: imageViewer,
    },
    {
      id: 'vector',
      label: 'Vector',
      contract: 'common.view/vector-scene-source',
      module: vectorViewer,
    },
    {
      id: 'model',
      label: 'Model',
      contract: 'common.view/model-scene-source',
      module: modelViewer,
    },
    {
      id: 'audio',
      label: 'Audio',
      contract: 'common.view/audio-media-source',
      module: audioViewer,
    },
    {
      id: 'video',
      label: 'Video',
      contract: 'common.view/video-media-source',
      module: videoViewer,
    },
    {
      id: 'entries',
      label: 'Entries',
      contract: 'common.view/namespace-entry-source',
      module: vscodeArchiveStage,
    },
    { id: 'table', label: 'Table', contract: 'common.view/table-data-source', module: tableViewer },
    { id: 'tree', label: 'Tree', contract: 'common.view/tree-data-source', module: treeViewer },
    {
      id: 'text',
      label: 'Text',
      contract: 'common.view/text-data-source',
      module: boundedTextViewer,
      trait: 'content.text',
    },
    {
      id: 'text-virtual',
      label: 'Text (streaming)',
      contract: 'common.view/text-data-source',
      module: virtualTextViewer,
      trait: 'content.text',
    },
    /*
     * Mounted only for a subject the extension host handed editing ports for. The ports come from
     * the subject RPC's editing arm, and the arm is refused for anything this host cannot write —
     * so the editors follow what the *host* can save, not what the file looks like.
     */
    {
      id: 'text-editor',
      label: 'Text (editor)',
      contract: 'common.view/text-data-source',
      module: textEditor,
      trait: 'content.text',
      editable: true,
    },
    {
      id: 'edit',
      label: 'Edit',
      contract: 'common.view/byte-range-source',
      module: createVsCodeEditPanel(context),
      editable: true,
    },
    /*
     * The metadata panel consumes no data source of its own — it renders the descriptor's metadata
     * groups — so it is bound to the byte-range source, which is the host's floor for an opened
     * subject. That makes "the subject opened" the condition, stated rather than implied.
     */
    {
      id: 'metadata',
      label: 'Metadata',
      contract: 'common.view/byte-range-source',
      module: metadataPanel,
    },
    { id: 'hex', label: 'Hex', contract: 'common.view/byte-range-source', module: hexViewer },
    {
      id: 'hex-editor',
      label: 'Hex (editor)',
      contract: 'common.view/byte-range-source',
      module: hexEditor,
      editable: true,
    },
  ])
}

/** Shown when no codec claims the file at all, so "unknown format" still means "look at it". */
export const VSCODE_PREVIEW_FALLBACK = Object.freeze({
  text: boundedTextViewer,
  hex: hexViewer,
})
