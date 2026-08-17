export * from './viewer/index.js'
export { boundedTextViewer, BoundedTextModel } from './code/index.js'
export { virtualTextViewer, VirtualTextModel } from './text-virtual/index.js'
export { hexViewer, HexWindowModel } from './hex/index.js'
export { treeViewer, LazyTreeModel } from './tree/index.js'
export { tableViewer, LazyTableModel } from './table/index.js'
export { transportViewer, TransportModel } from './transport/index.js'
export { namespaceViewer, NamespaceModel, normalizeNamespacePath } from './namespace/index.js'
export { diagnosticsPanel, operationToolbar } from './panels/index.js'
export { metadataPanel, propertiesTable } from './metadata/index.js'
export {
  imageViewer,
  IMAGE_MAXIMUM_BYTES,
  type ImageBackground,
  type ImageChannel,
} from './image/index.js'
export {
  createImageEditor,
  IMAGE_UNDO_DEPTH,
  type ImageEditor,
  type ImageEditorOptions,
  type ImageRect,
  type ImageTool,
} from './image/edit.js'
export {
  audioViewer,
  computePeaks,
  AUDIO_MAXIMUM_BYTES,
  WAVEFORM_BUCKETS,
  type WaveformModel,
} from './audio/index.js'
export { vectorViewer, VECTOR_MAXIMUM_TEXT_BYTES } from './vector/index.js'
export { videoViewer, VIDEO_MAXIMUM_BYTES } from './video/index.js'
export {
  modelViewer,
  loadModelStage,
  MODEL_MAXIMUM_PRIMITIVE_BYTES,
  type ModelStageModel,
} from './model/index.js'
export {
  createOrbitController,
  type OrbitBasis,
  type OrbitController,
  type OrbitPose,
  type ViewAxis,
} from './model/orbit.js'
export {
  createViewGizmo,
  GIZMO_SIZE,
  type ViewGizmo,
  type ViewGizmoOptions,
} from './model/gizmo.js'
export { textEditor, createTextEditorModule, defineEditorModule } from './editor/index.js'
export {
  compileSearch,
  matches,
  matchRanges,
  createFilter,
  type CompiledSearch,
  type MatchRange,
  type SearchMode,
  type SearchOptions,
} from './search/matcher.js'
export {
  createFileTree,
  type FileTree,
  type FileTreeNode,
  type FileTreeOptions,
} from './primitives/file-tree.js'
export {
  createAccordion,
  accordionField,
  type Accordion,
  type AccordionOptions,
  type AccordionSectionSpec,
} from './primitives/accordion.js'
export {
  createSubjectCard,
  loadSubjectCardSections,
  type CardChip,
  type CardField,
  type CardGridCell,
  type CardRef,
  type CardSection,
  type CardStat,
  type CardSubcard,
  type SubjectCard,
  type SubjectCardOptions,
  type SubjectCardLoadOptions,
} from './card/index.js'
export {
  createRelationGraph,
  loadRelationGraphOptions,
  type GraphEdge,
  type GraphFooterGroup,
  type GraphNode,
  type GraphTypeBucket,
  type RelationGraph,
  type RelationGraphOptions,
  type RelationGraphLoadOptions,
} from './graph/index.js'
export {
  createShellHeader,
  createShellFooter,
  createViewPicker,
  type Crumb,
  type ShellHeader,
  type ShellFooter,
  type StatusItem,
  type ViewMode,
  type ViewPicker,
} from './shell/chrome.js'
export {
  createSearchField,
  type SearchField,
  type SearchFieldOptions,
  type SearchFieldState,
} from './primitives/search-field.js'
export {
  createWorkbench,
  type Workbench,
  type WorkbenchHostState,
  type WorkbenchOptions,
} from './workbench/index.js'

export const contributionManifests = Object.freeze(['./contributions/*.json'])
export {
  createExplorer,
  EXPLORER_MAXIMUM_BYTES,
  type Explorer,
  type ExplorerEntry,
  type ExplorerOptions,
  type FileAccess,
  type PreviewHandle,
  type PreviewResolver,
} from './explorer/index.js'
export {
  createCodecPreview,
  type CodecPreviewOptions,
  type PreviewFormat,
  type PreviewStage,
} from './explorer/preview.js'
