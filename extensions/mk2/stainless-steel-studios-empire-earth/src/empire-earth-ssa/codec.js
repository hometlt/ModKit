import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'
const ID = 'org.modkitx/empire-earth-ssa'
const matches = bytes =>
  bytes.byteLength >= 12 && new TextDecoder('latin1').decode(bytes.subarray(0, 4)) === 'SSA\0'
function parse(bytes, budget) {
  if (!matches(bytes)) throw new TypeError('SSA header is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  const count = view.getUint32(8, true)
  if (version > 1 || count > budget.maxNodes || 12 + count * 24 > bytes.byteLength)
    throw new TypeError('unsupported SSA version or entry count')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 24
    const nameOffset = view.getUint32(at, true)
    const nameLength = view.getUint16(at + 4, true)
    const flags = view.getUint16(at + 6, true)
    const offset = view.getUint32(at + 8, true)
    const packedSize = view.getUint32(at + 12, true)
    const size = view.getUint32(at + 16, true)
    const method = view.getUint32(at + 20, true)
    if (nameOffset + nameLength > bytes.byteLength || offset + packedSize > bytes.byteLength)
      throw new TypeError('SSA entry range is invalid')
    const path = new TextDecoder()
      .decode(bytes.subarray(nameOffset, nameOffset + nameLength))
      .replace(/\0+$/u, '')
      .replaceAll('\\', '/')
    entries.push(
      Object.freeze({ id: String(index), path, flags, offset, packedSize, size, method }),
    )
  }
  return Object.freeze({ version, entries: Object.freeze(entries) })
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
            compression: entry.method === 0 ? 'stored' : `ssa-${entry.method}`,
            revision: source.revision,
          }),
        )
      return Object.freeze({ items: Object.freeze(items) })
    },
    async openEntry(entryId) {
      if (!entries.some(entry => entry.id === entryId)) throw new TypeError('unknown SSA entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `empire-earth-ssa:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'empire-earth-ssa', label: 'Empire Earth SSA archive' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'SSA archive header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parse(bytes, context.budget)
    return {
      summary: {
        format: 'empire-earth-ssa',
        version: parsed.version,
        entries: parsed.entries.length,
      },
      metadata: [
        {
          id: 'empire-earth-ssa',
          label: 'Empire Earth SSA archive',
          entries: [
            { key: 'version', value: parsed.version },
            { key: 'entries', value: parsed.entries.length },
          ],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: parsed.entries.length } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Empire Earth SSA',
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
      unsupportedFeatures: ['entry-extraction', 'zlib-inflation', 'encryption', 'archive-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
