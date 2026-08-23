// Hand-ported structural authored-text surface of org.modkitx/sc2-layout. Resolved visual
// rendering and cross-file reference navigation remain renderer/language-service concerns.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  createTableDataSource,
  decodeStructuredText,
  lineCount,
  parseXmlElements,
} from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-layout'
const ascii = new TextDecoder('ascii', { fatal: false })

function rootDesc(text) {
  return /^\s*(?:<\?xml[^>]*>\s*)?<Desc(?:\s|>)/iu.test(text)
}

function layoutRecords(elements) {
  return Object.freeze(
    elements.flatMap(element => {
      if (element.name === 'Frame') {
        return [
          Object.freeze({
            kind: 'Frame',
            name: element.attributes.name ?? '',
            detail: element.attributes.type ?? '',
          }),
        ]
      }
      if (element.name === 'Include') {
        return [Object.freeze({ kind: 'Include', name: element.attributes.path ?? '', detail: '' })]
      }
      if (element.name === 'Constant') {
        return [
          Object.freeze({
            kind: 'Constant',
            name: element.attributes.name ?? '',
            detail: element.attributes.val ?? '',
          }),
        ]
      }
      return []
    }),
  )
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'sc2-layout',
    label: 'StarCraft II Layout',
    mediaType: 'application/x-sc2layout+xml',
  }),
  async detect(prefix, uri) {
    const text = ascii.decode(prefix)
    return /\.sc2layout$/iu.test(uri) && rootDesc(text)
      ? { confidence: 0.98, kind: 'structure', note: 'desc-root' }
      : { confidence: 0, kind: 'structure', note: 'sc2layout-desc-root-missing' }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'SC2Layout')
    if (!rootDesc(text)) throw new TypeError('SC2Layout root must be Desc')
    const elements = parseXmlElements(text, context.budget, 'Desc', 'SC2Layout')
    const records = layoutRecords(elements)
    const frames = records.filter(record => record.kind === 'Frame')
    const includes = records.filter(record => record.kind === 'Include')
    const constants = records.filter(record => record.kind === 'Constant')
    return {
      summary: {
        format: 'sc2-layout',
        lines: lineCount(text),
        elements: elements.length,
        frames: frames.length,
        frameNames: frames.map(frame => frame.name),
        includes: includes.map(include => include.name),
        constants: constants.length,
      },
      metadata: [
        {
          id: 'sc2-layout-document',
          label: 'SC2 layout document',
          entries: [
            { key: 'lines', value: lineCount(text) },
            { key: 'elements', value: elements.length },
            { key: 'frames', value: frames.length },
            { key: 'includes', value: includes.length },
            { key: 'constants', value: constants.length },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'sc2-layout', lines: lineCount(text) } },
        {
          id: 'structure.hierarchy',
          parameters: { elements: elements.length, frames: frames.length },
        },
      ],
      text: true,
      dataSources: {
        'common.view/table-data-source': createTableDataSource(
          ['Kind', 'Name', 'Type / Value'],
          records.map(record => [record.kind, record.name, record.detail]),
        ),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'layout',
          label: 'SC2 Desc layout',
          preview: `${frames.length} frame(s), ${includes.length} include(s)`,
          children: records.map(record => ({
            kind: record.kind.toLowerCase(),
            label: record.name || record.kind,
            preview: record.detail || undefined,
          })),
        }),
      },
      unsupportedFeatures: [
        'dependency-workspace-resolution',
        'schema-validation',
        'language-provider-navigation',
        'resolved-visual-rendering',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
