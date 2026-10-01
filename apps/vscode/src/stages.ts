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
import { createArchiveViewer } from '@modkit/ui/archive'
import { createAudioViewer } from '@modkit/ui/audio'
import { createBoundedTextViewer } from '@modkit/ui/code'
import {
  createSubjectCardViewer,
  createSubjectWikiViewer,
  type SubjectCardViewerOptions,
} from '@modkit/ui/card'
import { createSubjectCalculationsViewer } from '@modkit/ui/calculations'
import { createTextEditorModule } from '@modkit/ui/editor'
import type { PreviewStage } from '@modkit/ui/explorer'
import { createRelationGraphViewer } from '@modkit/ui/graph'
import { createGameTemplateViewer } from '@modkit/ui/template'
import { createHexViewer } from '@modkit/ui/hex'
import { defineViewerModule, lazyViewerModule } from '@modkit/ui/viewer'
import { createHexEditor } from '@modkit/ui/hex-editor'
import { createFontViewer } from '@modkit/ui/font'
import { createImageViewer } from '@modkit/ui/image'
import { createMapLayersViewer } from '@modkit/ui/map-layers'
import { createModelViewer, MODEL_FACET_CONTRACTS } from '@modkit/ui/model'
import { createPlaybackViewer } from '@modkit/ui/transport'
import { createTableViewer } from '@modkit/ui/table'
import { createVirtualTextViewer } from '@modkit/ui/text-virtual'
import { createTreeViewer } from '@modkit/ui/tree'
import { createVectorViewer } from '@modkit/ui/vector'
import { createVideoViewer } from '@modkit/ui/video'
import { createExportSection } from '@modkit/ui/export'

import { orderStages } from './view-policy.js'
import {
  createVsCodeEditPanel,
  createVsCodePixelSaver,
  pixelSaveRefusal,
  type EditPanelOptions,
} from './edit-panel.js'
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
      ...(context.rasterResources === undefined
        ? {}
        : { rasterResources: context.rasterResources }),
      // Conversion writes a new file, so it needs the same host writer the image view uses.
      ...(context.exportFiles === undefined ? {} : { exportBytes: context.exportFiles }),
      exportBaseName: descriptor => context.exportBaseName?.(descriptor) ?? 'model',
      /*
       * The same sidebar the image stage has, for the same reason: MK2 showed a model's codec
       * operations, its document tree and its metadata as separate tabs, and here they are
       * sections of the render view. A model publishes more structure than an image, so the tree
       * is where Properties, Sections, Bounds and Codec Metadata are read.
       */
      sections: [
        {
          id: 'transform',
          title: context.localizer.text('stage.transform'),
          icon: 'tools',
          module: createVsCodeEditPanel({ ...context, omitEncoding: true }),
        },
        {
          id: 'structure',
          title: context.localizer.text('stage.tree'),
          icon: 'list-tree',
          module: createTreeViewer({ localizer: context.localizer }),
        },
      ],
    })
  /*
   * The codec's conversions, beside the player (plan 7.22): a WEM exports to WAV the way a DDS
   * exports to PNG. Image and model views draw their own; a subject with none gets no section.
   */
  const exportSections = [
    {
      id: 'export',
      title: context.localizer.text('stage.export'),
      icon: 'export',
      module: createExportSection({
        localizer: context.localizer,
        ...(context.exportFiles === undefined ? {} : { exportBytes: context.exportFiles }),
        exportBaseName: descriptor => context.exportBaseName?.(descriptor) ?? 'export',
      }),
    },
  ]
  const relationsStage = createRelationGraphViewer({
    localizer: context.localizer,
    ...(context.graphDepth === undefined ? {} : { depth: context.graphDepth }),
  })
  /** The subject card: a stage of its own, and the card each entity of the wiki opens in. */
  const cardOptions: SubjectCardViewerOptions = {
    localizer: context.localizer,
    // VS Code's tab and breadcrumb already name the subject; the card's own header repeated it.
    header: false,
    // The locale `modkit.locale` names; the header still switches it for this card.
    ...(context.gameLocale === undefined ? {} : { locale: context.gameLocale }),
    // The card's preview section mounts the same shaded, textured model stage.
    previews: { model: modelViewer() },
    ...(context.textures === undefined ? {} : { textures: context.textures }),
    // The subject's relations, walked from it, as a section of its card (MK2 had it there).
    graph: relationsStage,
    // A fact's source opens the declaring file at its line.
    ...(context.openSource === undefined ? {} : { openSource: context.openSource }),
    // A value written from the card changed the file: reopen at the new revision.
    onCommitted: descriptor => context.reopen(descriptor as unknown as Record<string, unknown>),
    // The embedded model opens as a subject of its own, found in the subject's mod chain.
    ...(context.openModel === undefined ? {} : { openModel: context.openModel }),
  }
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
        // The Edit section's Save: pixels → the codec's `replace` transform → the editing arm.
        savePixels: createVsCodePixelSaver(context),
        // Asked per subject, so the tools appear only where that Save can write.
        saveRefusal: descriptor => pixelSaveRefusal(context, descriptor),
        // The editor owns Undo, Redo, the dirty marker and Save; the section draws none of them.
        ...(context.registerPixelEditing === undefined
          ? {}
          : { registerEditing: context.registerPixelEditing }),
        ...(context.onPixelEdit === undefined ? {} : { onEdit: context.onPixelEdit }),
        // Extension-declared sections: the SC2 texture operations arrive this way, not from here.
        ...(context.pixelOperations === undefined
          ? {}
          : { pixelOperations: context.pixelOperations }),
        /*
         * MK2's separate Edit, Metadata and Tree tabs are sidebar sections of the render view now.
         * They are viewer modules like any other, which is also how an extension adds its own.
         */
        sections: [
          {
            // Not "Edit": that is the paint tools. This one runs the codec's own transforms.
            id: 'transform',
            title: context.localizer.text('stage.transform'),
            icon: 'tools',
            module: createVsCodeEditPanel({ ...context, omitEncoding: true }),
          },
          {
            id: 'structure',
            title: context.localizer.text('stage.tree'),
            icon: 'list-tree',
            module: createTreeViewer({ localizer: context.localizer }),
          },
        ],
      }),
    },
    {
      // the font set in text from its own bytes, ahead of the glyph sheet of a TrueType font
      id: 'font',
      label: context.localizer.text('stage.font'),
      contract: 'common.view/byte-range-source',
      trait: 'content.fonts',
      module: createFontViewer({ localizer: context.localizer }),
    },
    {
      id: 'vector',
      label: context.localizer.text('stage.vector'),
      contract: 'common.view/vector-scene-source',
      module: createVectorViewer({
        localizer: context.localizer,
        ...(context.exportFiles === undefined ? {} : { exportBytes: context.exportFiles }),
        exportBaseName: descriptor => context.exportBaseName?.(descriptor) ?? 'vector',
      }),
    },
    {
      id: 'playback',
      label: context.localizer.text('stage.playback'),
      contract: 'common.view/transport-source',
      module: createPlaybackViewer({
        localizer: context.localizer,
        // The same recording in the 3D world, which follows this transport (V switches back).
        ...(context.showStage === undefined
          ? {}
          : { openWorld: () => void context.showStage?.('world') }),
      }),
      optionalContracts: ['common.view/world-scene-source'],
    },
    {
      id: 'world',
      label: context.localizer.text('stage.world'),
      contract: 'common.view/world-scene-source',
      // Loaded on first mount: the world renderer is the one stage that brings three.js, and a
      // page that shows a texture or a table should not fetch or evaluate it.
      module: lazyViewerModule(async () =>
        (await import('@modkit/ui/world')).createWorldViewer({
          localizer: context.localizer,
          initialView: 'lattice',
          /*
           * A map's identity documents open the map, not themselves: MapInfo names the map and
           * carries little else, so a person who clicks it came for the terrain. Its facts would
           * be lost with the document view, so the subject card is a section of this sidebar.
           */
          sections: [
            {
              id: 'facts',
              title: context.localizer.text('stage.card'),
              icon: 'info',
              module: createSubjectCardViewer({
                localizer: context.localizer,
                ...(context.gameLocale === undefined ? {} : { locale: context.gameLocale }),
                ...(context.openSource === undefined ? {} : { openSource: context.openSource }),
              }),
            },
            {
              id: 'structure',
              title: context.localizer.text('stage.tree'),
              icon: 'list-tree',
              module: createTreeViewer({ localizer: context.localizer }),
            },
          ],
        }),
      ),
      // A timed world (a replay, a cutscene) follows its transport. The Card and Structure sections
      // mount on this stage's slot, so they get the subject's facts and tree only when it binds them.
      optionalContracts: [
        'common.view/transport-source',
        'common.view/subject-facts-source',
        'common.view/tree-data-source',
      ],
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
      // Materials, textures, bones, animations, lights…: bound when the codec publishes them.
      optionalContracts: MODEL_FACET_CONTRACTS,
    },
    {
      id: 'audio',
      label: context.localizer.text('stage.audio'),
      contract: 'common.view/audio-media-source',
      module: createAudioViewer({ localizer: context.localizer, sections: exportSections }),
    },
    {
      id: 'video',
      label: context.localizer.text('stage.video'),
      contract: 'common.view/video-media-source',
      module: createVideoViewer({ localizer: context.localizer, sections: exportSections }),
    },
    {
      id: 'archive',
      label: context.localizer.text('stage.entries'),
      contract: 'common.view/namespace-entry-source',
      module: createArchiveViewer({
        localizer: context.localizer,
        ...(context.openArchiveEntry === undefined
          ? {}
          : {
              openEntry: (entry, preview) =>
                context.openArchiveEntry?.(entry.path, preview === true),
            }),
        ...(context.archiveAction === undefined
          ? {}
          : {
              act: (action, target) =>
                context.archiveAction?.(action, target) ?? Promise.resolve(false),
            }),
        ...(context.archiveGallery === undefined ? {} : { gallery: context.archiveGallery }),
        ...(context.showHiddenEntries === undefined
          ? {}
          : { showHidden: context.showHiddenEntries }),
        reload: descriptor => context.reopen(descriptor as unknown as Record<string, unknown>),
      }),
    },
    {
      // Any map that declares the common layer operations: heights, cliffs, … as grey PNGs.
      id: 'map-layers',
      label: context.localizer.text('stage.mapLayers'),
      operation: 'map.layers',
      module: createMapLayersViewer({
        localizer: context.localizer,
        ...(context.exportFiles === undefined ? {} : { exportBytes: context.exportFiles }),
        exportBaseName: descriptor => context.exportBaseName?.(descriptor) ?? 'map',
        // The write is the ordinary one: the codec's plan through this subject's editing arm.
        applyPlan: async (descriptor, plan) =>
          (await context.portsFor(descriptor as unknown as Record<string, unknown>)?.applyPlan(plan)) ?? {
            failed: true,
            message: context.localizer.text('vscode.edit.noArm'),
          },
        reopen: descriptor => context.reopen(descriptor as unknown as Record<string, unknown>),
      }),
    },
    {
      id: 'template',
      label: context.localizer.text('stage.template'),
      operation: 'view.template',
      module: createGameTemplateViewer({
        localizer: context.localizer,
        // «Show in Text Editor» (plan 3.33): a node's declaration, as a card shows its source
        ...(context.openSource === undefined ? {} : { openSource: context.openSource }),
        // Pixels for the assets a template names, when this window can decode them.
        ...(context.templateImages === undefined ? {} : { images: context.templateImages }),
      }),
    },
    {
      id: 'card',
      label: context.localizer.text('stage.card'),
      contract: 'common.view/subject-facts-source',
      // On the subject, or on the subject of its selector a navigation named (plan 5.29).
      module: defineViewerModule({
        abiVersion: 1,
        mount(args) {
          const subject = context.cardSubject?.()
          return createSubjectCardViewer(
            subject === undefined ? cardOptions : { ...cardOptions, subject },
          ).mount(args)
        },
      }),
      // A writable fact edits in place through the subject's own editing arm, as a table cell does.
      usesEditorPorts: true,
      optionalContracts: [
        'common.view/raster-image-source',
        'common.view/model-scene-source',
        'common.view/video-media-source',
        'common.view/audio-media-source',
        'common.view/subject-selector-source',
        'common.view/relation-graph-source',
      ],
    },
    {
      id: 'wiki',
      label: context.localizer.text('stage.wiki'),
      contract: 'common.view/subject-selector-source',
      // A mod's entities by kind, each opening in the same card, started on it (plan 5.25).
      module: createSubjectWikiViewer({
        localizer: context.localizer,
        card: subject => createSubjectCardViewer({ ...cardOptions, subject }),
        ...(context.textures === undefined ? {} : { textures: context.textures }),
      }),
      optionalContracts: ['common.view/subject-facts-source'],
    },
    {
      id: 'calculations',
      label: context.localizer.text('stage.calculations'),
      contract: 'common.view/subject-calculations-source',
      module: createSubjectCalculationsViewer({ localizer: context.localizer }),
    },
    {
      // A table whose columns are locales (SC2 GameStrings and the like); ranked above the card.
      id: 'localization',
      label: context.localizer.text('stage.localization'),
      contract: 'common.view/table-data-source',
      // Keep the viewer available for read-only dependencies, but lend authorized host write
      // ports when present. A successful commit must reopen the revision-pinned table session.
      usesEditorPorts: true,
      module: createTableViewer({
        localizer: context.localizer,
        onCommitted: descriptor => context.reopen(descriptor as unknown as Record<string, unknown>),
        // Inline images of a value drawn as in game, through the template stage's raster port.
        ...(context.templateImages === undefined ? {} : { images: context.templateImages }),
      }),
    },
    {
      id: 'table',
      label: context.localizer.text('stage.table'),
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
      module: relationsStage,
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
