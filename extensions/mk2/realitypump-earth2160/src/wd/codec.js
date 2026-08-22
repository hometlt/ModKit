import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/wd'
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function')
    throw new TypeError('WD zlib inspection is unavailable')
  return new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  )
}
async function parse(bytes, budget) {
  if (bytes.byteLength < 12) throw new TypeError('WD archive is truncated')
  const length = viewOf(bytes).getUint32(bytes.byteLength - 4, true)
  if (length < 5 || length > bytes.byteLength) throw new TypeError('WD directory footer is invalid')
  const directoryOffset = bytes.byteLength - length
  if (bytes[directoryOffset] !== 0x78) throw new TypeError('WD directory has no zlib header')
  const directory = await inflate(bytes.subarray(directoryOffset, bytes.byteLength - 4))
  if (directory.byteLength > budget.maxScalarBytes || directory.byteLength < 10)
    throw new RangeError('WD directory exceeds budget or is truncated')
  const view = viewOf(directory)
  const entries = []
  let cursor = 10
  while (cursor < directory.byteLength) {
    if (entries.length >= budget.maxNodes) throw new RangeError('WD entries exceed maxNodes')
    const nameLength = directory[cursor++] ?? 0
    if (nameLength === 0) break
    if (cursor + nameLength + 13 > directory.byteLength)
      throw new TypeError('WD directory record is truncated')
    const name = new TextDecoder('latin1')
      .decode(directory.subarray(cursor, cursor + nameLength))
      .replace(/\0+$/u, '')
      .replaceAll('\\', '/')
    cursor += nameLength
    const fileType = directory[cursor++] ?? 0
    const offset = view.getUint32(cursor, true)
    const packedSize = view.getUint32(cursor + 4, true)
    const size = view.getUint32(cursor + 8, true)
    cursor += 12
    if (fileType === 0xff || offset + packedSize > directoryOffset)
      throw new TypeError('unsupported or invalid WD entry')
    entries.push(
      Object.freeze({ id: String(entries.length), name, fileType, offset, packedSize, size }),
    )
  }
  return Object.freeze({ directoryOffset, entries: Object.freeze(entries) })
}
const namespaceSource = (entries, source) =>
  Object.freeze({
    async list(prefix, page) {
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const matching = entries.filter(entry => entry.name.startsWith(prefix))
      const items = matching
        .slice(start, start + page.limit)
        .map(entry =>
          Object.freeze({
            id: entry.id,
            path: entry.name,
            name: entry.name.split('/').at(-1) ?? entry.name,
            kind: 'file',
            size: BigInt(entry.size),
            compression: entry.packedSize === entry.size ? 'stored' : 'zlib',
            revision: source.revision,
          }),
        )
      return Object.freeze({ items: Object.freeze(items) })
    },
    async openEntry(entryId) {
      if (!entries.some(entry => entry.id === entryId)) throw new TypeError('unknown WD entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `wd:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'wd', label: 'Reality Pump WD archive' }),
  async detect(prefix, uri) {
    return uri.toLowerCase().endsWith('.wd') && prefix.byteLength >= 12
      ? { confidence: 0.8, kind: 'structure', note: 'WD extension and footer-sized input' }
      : { confidence: 0, kind: 'structure', note: 'filename-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = await parse(bytes, context.budget)
    return {
      summary: {
        format: 'wd',
        entries: parsed.entries.length,
        directoryOffset: parsed.directoryOffset,
      },
      metadata: [
        {
          id: 'wd',
          label: 'Reality Pump WD archive',
          entries: [
            { key: 'entries', value: parsed.entries.length },
            { key: 'directoryOffset', value: parsed.directoryOffset },
          ],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: parsed.entries.length } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Reality Pump WD',
          preview: `${parsed.entries.length} entries`,
          children: parsed.entries.map(entry => ({
            kind: 'file',
            label: entry.name,
            preview: `${entry.size} bytes`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(parsed.entries, context.source),
      },
      maxDecodedBytes: parsed.entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: ['entry-extraction', 'supplementary-record-types', 'archive-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
