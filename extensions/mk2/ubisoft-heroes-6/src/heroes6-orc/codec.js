import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'
const ID = 'org.modkitx/heroes6-orc'
const isZip = bytes =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
const zipOffset = bytes => {
  if (isZip(bytes)) return 0
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x52 &&
    bytes[2] === 0x43 &&
    bytes[3] === 0
  ) {
    const offset = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
    if (offset < bytes.byteLength && isZip(bytes.subarray(offset))) return offset
  }
  return -1
}
function parse(bytes, budget) {
  const start = zipOffset(bytes)
  if (start < 0) throw new TypeError('Heroes VI ORC has no ZIP payload')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = []
  let offset = start
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    if (entries.length >= budget.maxNodes) throw new RangeError('ORC entries exceed maxNodes')
    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    const packedSize = view.getUint32(offset + 18, true)
    const size = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    if ((flags & 8) !== 0 || offset + 30 + nameLength + extraLength + packedSize > bytes.byteLength)
      throw new TypeError('unsupported or truncated ORC ZIP entry')
    const path = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    entries.push(Object.freeze({ id: String(entries.length), path, method, size }))
    offset += 30 + nameLength + extraLength + packedSize
  }
  return Object.freeze({
    wrapper: start === 0 ? 'zip-compatible' : 'orc-wrapper',
    entries: Object.freeze(entries),
  })
}
const namespaceSource = (entries, source) =>
  Object.freeze({
    async list(prefix, page) {
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          size: BigInt(entry.size),
          compression: entry.method === 0 ? 'stored' : `zip-${entry.method}`,
          revision: source.revision,
        }),
      )
      return Object.freeze({ items: Object.freeze(items) })
    },
    async openEntry(entryId) {
      if (!entries.some(entry => entry.id === entryId)) throw new TypeError('unknown ORC entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `heroes6-orc:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'heroes6-orc', label: 'Heroes VI ORC archive' }),
  async detect(prefix) {
    return zipOffset(prefix) >= 0
      ? { confidence: 0.99, kind: 'magic', note: 'ZIP-compatible Heroes VI ORC' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parse(bytes, context.budget)
    return {
      summary: { format: 'heroes6-orc', wrapper: parsed.wrapper, entries: parsed.entries.length },
      metadata: [
        {
          id: 'heroes6-orc',
          label: 'Heroes VI ORC archive',
          entries: [
            { key: 'wrapper', value: parsed.wrapper },
            { key: 'entries', value: parsed.entries.length },
          ],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: parsed.entries.length } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Heroes VI ORC',
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
      unsupportedFeatures: ['entry-extraction', 'compressed-entry-decoding', 'archive-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
