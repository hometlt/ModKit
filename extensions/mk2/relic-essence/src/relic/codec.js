import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ascii = (bytes, offset, length) =>
  new TextDecoder('latin1').decode(bytes.subarray(offset, offset + length)).replace(/\0+$/u, '')
const dataOffset = bytes => (ascii(bytes, 0, 12) === 'Relic Chunky' ? 24 : 0)
function parseChunks(bytes, budget) {
  const chunks = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = dataOffset(bytes)
  while (offset + 20 <= bytes.byteLength) {
    if (chunks.length >= budget.maxNodes) throw new RangeError('Relic chunks exceed maxNodes')
    const type = ascii(bytes, offset, 8)
    if (!type.startsWith('FOLD') && !type.startsWith('DATA')) break
    const version = view.getInt32(offset + 8, true)
    const size = view.getInt32(offset + 12, true)
    const nameLength = view.getInt32(offset + 16, true)
    const payloadOffset = offset + 20 + nameLength
    const end = payloadOffset + size
    if (size < 0 || nameLength < 0 || end > bytes.byteLength)
      throw new TypeError('Relic chunk exceeds its container')
    chunks.push(
      Object.freeze({
        type,
        version,
        size,
        name: ascii(bytes, offset + 20, nameLength),
        offset,
        payloadOffset,
      }),
    )
    offset = end
  }
  return Object.freeze(chunks)
}
export function createRelicChunkCodec({
  id,
  formatId,
  label,
  roots,
  confidence = 0.98,
  unsupported,
}) {
  const matches = bytes => {
    const offset = dataOffset(bytes)
    return roots.includes(ascii(bytes, offset, 8))
  }
  const definition = Object.freeze({
    id,
    version: '1.0.0',
    format: Object.freeze({ id: formatId, label }),
    async detect(prefix) {
      return matches(prefix)
        ? { confidence, kind: 'structure', note: 'Relic Chunky root' }
        : { confidence: 0, kind: 'structure', note: 'root-mismatch' }
    },
    async inspect(bytes, context) {
      if (!matches(bytes)) throw new TypeError(`${label} root is missing`)
      const chunks = parseChunks(bytes, context.budget)
      return {
        summary: {
          format: formatId,
          preamble: dataOffset(bytes) === 24,
          chunks: chunks.length,
          roots: chunks.map(chunk => chunk.type),
        },
        metadata: [
          {
            id: formatId,
            label,
            entries: [
              { key: 'chunks', value: chunks.length },
              { key: 'preamble', value: dataOffset(bytes) === 24 },
            ],
          },
        ],
        traits: [
          { id: 'structure.hierarchy', parameters: { chunks: chunks.length } },
          { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ],
        dataSources: {
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'chunk-container',
            label,
            preview: `${chunks.length} chunks`,
            children: chunks.map(chunk => ({
              kind: chunk.type.startsWith('FOLD') ? 'folder' : 'data',
              label: chunk.name || chunk.type,
              preview: `${chunk.size} bytes, version ${chunk.version}`,
            })),
          }),
        },
        maxDecodedBytes: bytes.byteLength,
        unsupportedFeatures: unsupported,
      }
    },
  })
  return Object.freeze({
    abiVersion: 1,
    createCodec: context => createInspectionCodec(definition, context),
  })
}
const codec = createRelicChunkCodec({
  id: 'org.modkitx/relic',
  formatId: 'relic',
  label: 'Relic Chunky container',
  roots: ['FOLDDATA'],
  unsupported: ['payload-extraction', 'recursive-chunk-decoding', 'container-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
