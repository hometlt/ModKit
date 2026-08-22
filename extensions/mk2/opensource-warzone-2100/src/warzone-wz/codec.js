import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/warzone-wz'
const signature = bytes =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))

function entriesOf(bytes, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = []
  let offset = 0
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    if (entries.length >= budget.maxNodes) throw new RangeError('Warzone package exceeds maxNodes')
    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    const packedSize = view.getUint32(offset + 18, true)
    const size = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    if ((flags & 8) !== 0)
      throw new TypeError('streamed ZIP entries are outside the portable WZ subset')
    const dataOffset = offset + 30 + nameLength + extraLength
    if (dataOffset + packedSize > bytes.byteLength)
      throw new TypeError('Warzone package entry is truncated')
    const path = new TextDecoder()
      .decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
      .replaceAll('\\', '/')
    entries.push(Object.freeze({ id: String(entries.length), path, method, packedSize, size }))
    offset = dataOffset + packedSize
  }
  if (entries.length === 0 && !(bytes[2] === 5 && bytes[3] === 6))
    throw new TypeError('Warzone package contains no readable local entries')
  return Object.freeze(entries)
}

function namespaceSource(entries, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(page.limit) ||
        page.limit <= 0
      )
        throw new TypeError('invalid WZ page')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: entry.path.endsWith('/') ? 'directory' : 'file',
          size: BigInt(entry.size),
          compression: entry.method === 0 ? 'stored' : `zip-${entry.method}`,
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
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!entries.some(entry => entry.id === entryId)) throw new TypeError('unknown WZ entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `warzone-wz:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'warzone-wz', label: 'Warzone 2100 package' }),
  async detect(prefix, uri) {
    return signature(prefix) && uri.toLowerCase().endsWith('.wz')
      ? { confidence: 0.99, kind: 'magic', note: 'ZIP-backed Warzone package' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (!signature(bytes)) throw new TypeError('Warzone package is not ZIP')
    const entries = entriesOf(bytes, context.budget)
    return {
      summary: { format: 'warzone-wz', entries: entries.length },
      metadata: [
        {
          id: 'warzone-wz',
          label: 'Warzone 2100 package',
          entries: [{ key: 'entries', value: entries.length }],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: entries.length } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Warzone 2100 package',
          preview: `${entries.length} entries`,
          children: entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      maxDecodedBytes: entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: [
        'compressed-entry-extraction',
        'ruleset-classification',
        'package-writing',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
