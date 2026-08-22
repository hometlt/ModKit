import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/petroglyph-meg'
const V3_ID = 0x3f7d70a4
const headerOf = bytes => {
  if (bytes.byteLength < 8) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const first = view.getUint32(0, true)
  const second = view.getUint32(4, true)
  if (second === V3_ID && bytes.byteLength >= 20)
    return {
      variant: bytes.byteLength >= 24 ? 3 : 2,
      headerSize: bytes.byteLength >= 24 ? 24 : 20,
      filenames: view.getUint32(12, true),
      files: view.getUint32(16, true),
      dataStart: view.getUint32(8, true),
      flags: first,
    }
  if (first > 0 && first <= 10_000_000 && second > 0 && second <= 10_000_000)
    return { variant: 1, headerSize: 8, filenames: first, files: second, dataStart: 0, flags: 0 }
  return undefined
}
function parse(bytes, budget) {
  const header = headerOf(bytes)
  if (header === undefined || header.filenames !== header.files || header.files > budget.maxNodes)
    throw new TypeError('unsupported or inconsistent MEG header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names = []
  let cursor = header.headerSize
  for (let index = 0; index < header.filenames; index += 1) {
    if (cursor + 4 > bytes.byteLength) throw new TypeError('MEG filename table is truncated')
    const length = view.getUint16(cursor, true)
    cursor += 4
    if (cursor + length > bytes.byteLength) throw new TypeError('MEG filename is truncated')
    names.push(
      new TextDecoder().decode(bytes.subarray(cursor, cursor + length)).replaceAll('\\', '/'),
    )
    cursor += length
  }
  const entries = []
  for (let index = 0; index < header.files; index += 1) {
    const base = cursor + index * 20
    if (base + 20 > bytes.byteLength) throw new TypeError('MEG file table is truncated')
    const nameIndex = view.getUint32(base + (header.variant === 3 ? 6 : 4), true)
    const size = view.getUint32(base + (header.variant === 3 ? 10 : 8), true)
    const offset = view.getUint32(base + (header.variant === 3 ? 14 : 12), true)
    if (offset + size > bytes.byteLength || names[nameIndex] === undefined)
      throw new TypeError('MEG file record is invalid')
    entries.push(Object.freeze({ id: String(index), path: names[nameIndex], size, offset }))
  }
  return Object.freeze({ header, entries: Object.freeze(entries) })
}
const namespaceSource = (entries, source) =>
  Object.freeze({
    async list(prefix, page) {
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching
        .slice(start, start + page.limit)
        .map(entry =>
          Object.freeze({
            id: entry.id,
            path: entry.path,
            name: entry.path.split('/').at(-1) ?? entry.path,
            kind: 'file',
            size: BigInt(entry.size),
            revision: source.revision,
          }),
        )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId) {
      if (!entries.some(entry => entry.id === entryId)) throw new TypeError('unknown MEG entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `petroglyph-meg:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'petroglyph-meg', label: 'Petroglyph MEG archive' }),
  async detect(prefix) {
    return headerOf(prefix) === undefined
      ? { confidence: 0, kind: 'structure', note: 'header-mismatch' }
      : { confidence: 0.98, kind: 'structure', note: 'Petroglyph MEG tables' }
  },
  async inspect(bytes, context) {
    const parsed = parse(bytes, context.budget)
    return {
      summary: {
        format: 'petroglyph-meg',
        variant: parsed.header.variant,
        entries: parsed.entries.length,
      },
      metadata: [
        {
          id: 'petroglyph-meg',
          label: 'Petroglyph MEG archive',
          entries: [
            { key: 'variant', value: parsed.header.variant },
            { key: 'entries', value: parsed.entries.length },
          ],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: parsed.entries.length } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Petroglyph MEG',
          preview: `${parsed.entries.length} entries`,
          children: parsed.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(parsed.entries, context.source),
      },
      maxDecodedBytes: parsed.entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: [
        'entry-extraction',
        'encrypted-tables',
        'compression',
        'archive-writing',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
