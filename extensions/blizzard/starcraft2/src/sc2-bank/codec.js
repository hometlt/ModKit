// Hand-ported read-only inspection surface of org.modkitx/sc2-bank. Signing and raw-preserving
// edits remain outside the X3 codec contract and are reported as unsupported features.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  createTableDataSource,
  decodeStructuredText,
  lineCount,
  parseXmlElements,
} from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-bank'
const ascii = new TextDecoder('ascii', { fatal: false })

function attribute(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(source)
  return match?.[1] ?? match?.[2] ?? ''
}

function decodeXmlValue(value) {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
}

function parseBank(text, budget) {
  const elements = parseXmlElements(text, budget, 'Bank', 'SC2 bank')
  const root = /<Bank\b([^>]*)>/u.exec(text)
  const sections = []
  for (const sectionMatch of text.matchAll(/<Section\b([^>]*)>([\s\S]*?)<\/Section\s*>/gu)) {
    const keys = []
    for (const keyMatch of sectionMatch[2].matchAll(/<Key\b([^>]*)>([\s\S]*?)<\/Key\s*>/gu)) {
      const valueMatch = /<Value\b([^>]*)\/?\s*>/u.exec(keyMatch[2])
      let value
      if (valueMatch !== null) {
        const typed = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(valueMatch[1])
        if (typed !== null) {
          value = Object.freeze({
            type: typed[1],
            value: decodeXmlValue(typed[2] ?? typed[3] ?? ''),
          })
        }
      }
      keys.push(
        Object.freeze({
          name: decodeXmlValue(attribute(keyMatch[1], 'name')),
          ...(value === undefined ? {} : { value }),
        }),
      )
    }
    sections.push(
      Object.freeze({
        name: decodeXmlValue(attribute(sectionMatch[1], 'name')),
        keys: Object.freeze(keys),
      }),
    )
  }
  const signature = /<Signature\b([^>]*)\/?\s*>/u.exec(text)
  return Object.freeze({
    version: root === null ? '' : decodeXmlValue(attribute(root[1], 'version')),
    sections: Object.freeze(sections),
    signature: signature === null ? '' : decodeXmlValue(attribute(signature[1], 'value')),
    elementCount: elements.length,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'sc2-bank',
    label: 'StarCraft II bank',
    mediaType: 'application/xml',
  }),
  async detect(prefix, uri) {
    const text = ascii.decode(prefix)
    const structural = /^\s*(?:<\?xml\b[^>]*>\s*)?<Bank(?:\s|>)/u.test(text)
    if (!structural) return { confidence: 0, kind: 'structure', note: 'bank-root-missing' }
    return {
      confidence: /\.sc2bank$/iu.test(uri) ? 0.995 : 0.99,
      kind: 'structure',
      note: 'bank-root',
    }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'SC2 bank')
    const bank = parseBank(text, context.budget)
    const keys = bank.sections.flatMap(section => section.keys)
    const valueTypes = [
      ...new Set(keys.flatMap(key => (key.value === undefined ? [] : [key.value.type]))),
    ].sort()
    return {
      summary: {
        format: 'sc2-bank',
        version: bank.version,
        lines: lineCount(text),
        sections: bank.sections.length,
        keys: keys.length,
        valueTypes,
        signaturePresent: bank.signature !== '',
      },
      metadata: [
        {
          id: 'sc2-bank',
          label: 'SC2 bank',
          entries: [
            { key: 'version', value: bank.version },
            { key: 'sections', value: bank.sections.length },
            { key: 'keys', value: keys.length },
            { key: 'signaturePresent', value: bank.signature !== '' },
            { key: 'elements', value: bank.elementCount },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'xml', lines: lineCount(text) } },
        {
          id: 'structure.hierarchy',
          parameters: { sections: bank.sections.length, keys: keys.length },
        },
        {
          id: 'content.metadata',
          parameters: { version: bank.version, signature: bank.signature !== '' },
        },
      ],
      text: true,
      dataSources: {
        'common.view/table-data-source': createTableDataSource(
          ['Section', 'Key', 'Type', 'Value'],
          bank.sections.flatMap(section =>
            section.keys.map(key => [
              section.name,
              key.name,
              key.value?.type ?? '',
              key.value?.value ?? '',
            ]),
          ),
        ),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'bank',
          label: 'StarCraft II bank',
          preview: `${bank.sections.length} section(s), ${keys.length} key(s)`,
          children: bank.sections.map(section => ({
            kind: 'section',
            label: section.name,
            preview: `${section.keys.length} key(s)`,
            children: section.keys.map(key => ({
              kind: 'key',
              label: key.name,
              preview:
                key.value === undefined ? undefined : `${key.value.type}: ${key.value.value}`,
            })),
          })),
        }),
      },
      unsupportedFeatures: [
        'bank-signature-verification-and-signing',
        'raw-preserving-value-editing',
        'bank-serialization',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
