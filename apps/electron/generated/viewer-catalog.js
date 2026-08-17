/** Generated presentation catalog. It contains viewers, never codec implementations. */
import {
  boundedTextViewer,
  hexEditor,
  hexViewer,
  imageViewer,
  tableViewer,
  textEditor,
  treeViewer,
} from '@modkitx-x3/ui'
import { monacoEditor } from '../../../extensions/common/ui-monaco/src/index.js'

export const PREVIEW_STAGES = Object.freeze([
  { id: 'tree', label: 'Tree', contract: 'common.view/tree-data-source', module: treeViewer },
  { id: 'table', label: 'Table', contract: 'common.view/table-data-source', module: tableViewer },
  { id: 'image', label: 'Image', contract: 'common.view/raster-image-source', module: imageViewer },
  {
    id: 'code',
    label: 'Code',
    contract: 'common.view/text-data-source',
    module: monacoEditor,
    editable: true,
  },
  {
    id: 'text',
    label: 'Text',
    contract: 'common.view/text-data-source',
    module: textEditor,
    editable: true,
  },
  {
    id: 'hex',
    label: 'Hex',
    contract: 'common.view/byte-range-source',
    module: hexEditor,
    editable: true,
  },
])

export const PREVIEW_STAGES_READONLY = Object.freeze([
  { label: 'Tree', contract: 'common.view/tree-data-source', module: treeViewer },
  { label: 'Table', contract: 'common.view/table-data-source', module: tableViewer },
  { label: 'Image', contract: 'common.view/raster-image-source', module: imageViewer },
  { label: 'Text', contract: 'common.view/text-data-source', module: boundedTextViewer },
  { label: 'Hex', contract: 'common.view/byte-range-source', module: hexViewer },
])

export const PREVIEW_FALLBACK = Object.freeze({ text: boundedTextViewer, hex: hexViewer })
