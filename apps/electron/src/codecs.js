/**
 * Codec and stage registry for the desktop previewer.
 *
 * This is a host decision, not a library one: which formats this build ships, and which stages it
 * is willing to show for them. A different host can bundle a different set without touching the
 * explorer or any codec.
 *
 * Imports are by path because `examples/*` and app shells are not workspace members — the same
 * reason the gallery imports its extensions this way.
 */
import { boundedTextViewer, hexViewer, imageViewer, tableViewer, treeViewer } from '@modkitx-x3/ui'

import { createCodec as jsonCodec } from '../../../extensions/common/text-json/src/formats/json/codec.js'
import { createProvider as jsonProvider } from '../../../extensions/common/text-json/src/formats/json/provider.js'
import { createCodec as jsoncCodec } from '../../../extensions/common/text-json/src/formats/jsonc/codec.js'
import { createProvider as jsoncProvider } from '../../../extensions/common/text-json/src/formats/jsonc/provider.js'
import { createCodec as xmlCodec } from '../../../extensions/common/text-xml/src/formats/xml/codec.js'
import { createProvider as xmlProvider } from '../../../extensions/common/text-xml/src/formats/xml/provider.js'
import { createCodec as yamlCodec } from '../../../extensions/common/text-yaml/src/formats/yaml/codec.js'
import { createProvider as yamlProvider } from '../../../extensions/common/text-yaml/src/formats/yaml/provider.js'
import { createCodec as tomlCodec } from '../../../extensions/common/text-toml/src/formats/toml/codec.js'
import { createProvider as tomlProvider } from '../../../extensions/common/text-toml/src/formats/toml/provider.js'
import { createCodec as iniCodec } from '../../../extensions/common/text-ini/src/formats/ini/codec.js'
import { createProvider as iniProvider } from '../../../extensions/common/text-ini/src/formats/ini/provider.js'
import { createCodec as csvCodec } from '../../../extensions/common/text-delimited/src/formats/csv/codec.js'
import { createProvider as csvProvider } from '../../../extensions/common/text-delimited/src/formats/csv/provider.js'
import { createCodec as tsvCodec } from '../../../extensions/common/text-delimited/src/formats/tsv/codec.js'
import { createProvider as tsvProvider } from '../../../extensions/common/text-delimited/src/formats/tsv/provider.js'
import { createCodec as pngCodec } from '../../../extensions/common/images/src/formats/png/codec.js'
import { createCodec as jpegCodec } from '../../../extensions/common/images/src/formats/jpeg/codec.js'

const textFormat = (id, extensions, createCodec, createProvider) => ({
  extensions,
  createCodec,
  createProvider,
  providerContract: `common.text-data/${id}-syntax`,
})

export const PREVIEW_FORMATS = Object.freeze([
  textFormat('json', ['json'], jsonCodec, jsonProvider),
  textFormat('jsonc', ['jsonc'], jsoncCodec, jsoncProvider),
  textFormat('xml', ['xml'], xmlCodec, xmlProvider),
  textFormat('yaml', ['yaml', 'yml'], yamlCodec, yamlProvider),
  textFormat('toml', ['toml'], tomlCodec, tomlProvider),
  textFormat('ini', ['ini', 'cfg'], iniCodec, iniProvider),
  textFormat('csv', ['csv'], csvCodec, csvProvider),
  textFormat('tsv', ['tsv'], tsvCodec, tsvProvider),
  { extensions: ['png'], createCodec: pngCodec },
  { extensions: ['jpg', 'jpeg'], createCodec: jpegCodec },
])

/**
 * Stage order is the tab order. A stage appears only when the codec published its contract, so a
 * plain-text file shows Text and Hex while a JSON file also shows Tree.
 */
export const PREVIEW_STAGES = Object.freeze([
  { label: 'Tree', contract: 'common.view/tree-data-source', module: treeViewer },
  { label: 'Table', contract: 'common.view/table-data-source', module: tableViewer },
  { label: 'Image', contract: 'common.view/raster-image-source', module: imageViewer },
  { label: 'Text', contract: 'common.view/text-data-source', module: boundedTextViewer },
  { label: 'Hex', contract: 'common.view/byte-range-source', module: hexViewer },
])
