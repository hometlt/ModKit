// Hand-ported local catalog surface of org.modkitx/sc2-strings. Cross-locale fallback,
// reference resolution, and translation remain host/service concerns.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { createTableDataSource, decodeStructuredText, lineCount } from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-strings'
const ascii = new TextDecoder('ascii', { fatal: false })

function plausibleStrings(text) {
  return /^(?!\s*(?:\/\/|#))[^=\r\n]+=[^\r\n]*$/mu.test(text)
}

function parseStrings(text, budget) {
  const entries = []
  const seen = new Set()
  let duplicates = 0
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('//') || line.startsWith('#')) continue
    const separator = raw.indexOf('=')
    if (separator < 1)
      throw new TypeError('SC2 strings contains a non-empty line without a key/value separator')
    const key = raw.slice(0, separator).trim()
    const value = raw.slice(separator + 1)
    if (key === '') throw new TypeError('SC2 strings contains an empty key')
    if (entries.length >= budget.maxNodes)
      throw new RangeError('SC2 string entries exceed maxNodes budget')
    if (seen.has(key)) duplicates += 1
    seen.add(key)
    entries.push(Object.freeze({ key, value }))
  }
  if (entries.length === 0) throw new TypeError('SC2 strings contains no key/value entries')
  const references = entries.reduce(
    (sum, entry) => sum + [...entry.value.matchAll(/<d\s+ref\s*=\s*"[^"]+"\s*\/>/giu)].length,
    0,
  )
  return Object.freeze({ entries: Object.freeze(entries), duplicates, references })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'sc2-strings',
    label: 'StarCraft II Localization Strings',
    mediaType: 'text/x-sc2-strings',
  }),
  async detect(prefix, uri) {
    const text = ascii.decode(prefix)
    return /\.txt$/iu.test(uri) && plausibleStrings(text)
      ? { confidence: 0.96, kind: 'structure', note: 'sc2-key-value-lines' }
      : { confidence: 0, kind: 'structure', note: 'sc2-strings-mismatch' }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'SC2 strings')
    const catalog = parseStrings(text, context.budget)
    return {
      summary: {
        format: 'sc2-strings',
        lines: lineCount(text),
        entries: catalog.entries.length,
        duplicateKeys: catalog.duplicates,
        markupReferences: catalog.references,
      },
      metadata: [
        {
          id: 'sc2-string-catalog',
          label: 'SC2 localization catalog',
          entries: [
            { key: 'lines', value: lineCount(text) },
            { key: 'entries', value: catalog.entries.length },
            { key: 'duplicateKeys', value: catalog.duplicates },
            { key: 'markupReferences', value: catalog.references },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'sc2-strings', lines: lineCount(text) } },
        { id: 'game.localization', parameters: { entries: catalog.entries.length } },
      ],
      text: true,
      dataSources: {
        'common.view/table-data-source': createTableDataSource(
          ['Key', 'Value'],
          catalog.entries.map(entry => [entry.key, entry.value]),
        ),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'catalog',
          label: 'SC2 localization strings',
          preview: `${catalog.entries.length} entry/entries`,
          children: catalog.entries.map(entry => ({
            kind: 'string',
            label: entry.key,
            preview: entry.value.slice(0, 120),
          })),
        }),
      },
      unsupportedFeatures: [
        'cross-locale-fallback',
        'catalog-reference-resolution',
        'machine-translation',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
