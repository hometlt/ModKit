// Hand-ported MK2 GAF header inspection. Frame/palette decoding was not present in the MK2
// implementation and remains an explicit limitation instead of being inferred from file names.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/gaf'
const HEADER_BYTES = 12
const VERSION = 0x00010100

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u32le(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError('GAF header is truncated')
  return view(bytes).getUint32(offset, true)
}

function header(bytes, maximumNodes) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('GAF header is truncated')
  const version = u32le(bytes, 0)
  if (version !== VERSION) throw new TypeError(`unsupported GAF version 0x${version.toString(16)}`)
  const entries = u32le(bytes, 4)
  if (entries > maximumNodes) throw new RangeError('GAF entries exceed maxNodes')
  const tableBytes = entries * 4
  if (!Number.isSafeInteger(tableBytes) || HEADER_BYTES + tableBytes > bytes.byteLength) {
    throw new TypeError('GAF entry-offset table is truncated')
  }
  const offsets = []
  for (let index = 0; index < entries; index += 1) {
    const offset = u32le(bytes, HEADER_BYTES + index * 4)
    if (offset < HEADER_BYTES + tableBytes || offset >= bytes.byteLength) {
      throw new RangeError(`GAF entry ${index} offset is outside the file`)
    }
    offsets.push(offset)
  }
  return Object.freeze({ version, entries, offsets: Object.freeze(offsets) })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'gaf', label: 'Total Annihilation GAF animation' }),
  async detect(prefix) {
    if (prefix.byteLength < HEADER_BYTES || u32le(prefix, 0) !== VERSION) {
      return { confidence: 0, kind: 'structure', note: 'gaf-header-mismatch' }
    }
    const entries = u32le(prefix, 4)
    const tableBytes = entries * 4
    return entries > 0 &&
      Number.isSafeInteger(tableBytes) &&
      HEADER_BYTES + tableBytes <= prefix.byteLength
      ? { confidence: 0.98, kind: 'structure', note: 'gaf-v1-entry-table' }
      : { confidence: 0, kind: 'structure', note: 'gaf-entry-table-invalid' }
  },
  async inspect(bytes, context) {
    const gaf = header(bytes, context.budget.maxNodes)
    return {
      summary: {
        format: 'gaf',
        version: `0x${gaf.version.toString(16).padStart(8, '0')}`,
        entries: gaf.entries,
        entryOffsets: gaf.offsets,
        frameDecoding: 'not-implemented',
      },
      metadata: [
        {
          id: 'gaf-header',
          label: 'GAF header',
          entries: [
            { key: 'version', value: `0x${gaf.version.toString(16).padStart(8, '0')}` },
            { key: 'entries', value: gaf.entries },
            { key: 'bytes', value: bytes.byteLength },
          ],
        },
      ],
      traits: [
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        { id: 'structure.hierarchy', parameters: { entries: gaf.entries } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'animation',
          label: 'Total Annihilation GAF',
          preview: `${gaf.entries} entry headers`,
          children: gaf.offsets.map((offset, index) => ({
            kind: 'entry',
            label: `Entry ${index}`,
            preview: `header at byte ${offset}`,
          })),
        }),
      },
      unsupportedFeatures: [
        'entry-name-decoding',
        'frame-header-decoding',
        'frame-pixel-decoding',
        'palette-resolution',
        'animation-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
