import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { extractZipEntry, parseZip } from '../docx/office-package.js'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const u32 = (bytes, offset) => view(bytes).getUint32(offset, true)

function decodeText(bytes, label) {
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError(`${label} is not well-formed UTF-8`)
  }
}

async function inflateRaw(bytes, budget) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('Figma schema deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([Uint8Array.from(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > budget.maxScalarBytes || length > Math.max(4096, bytes.byteLength * 100)) {
      await reader.cancel('Figma schema exceeds expansion budget')
      throw new RangeError('Figma schema exceeds maxScalarBytes or expansion budget')
    }
    chunks.push(result.value)
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function schemaReader(bytes) {
  let cursor = 0
  const readByte = label => {
    if (cursor >= bytes.byteLength) throw new TypeError(`Figma Kiwi schema ${label} is truncated`)
    return bytes[cursor++]
  }
  const readVarUint = label => {
    let value = 0
    let shift = 0
    for (let count = 0; count < 5; count += 1) {
      const byte = readByte(label)
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw new RangeError(`Figma Kiwi ${label} is too large`)
        return value
      }
      shift += 7
    }
    throw new TypeError(`Figma Kiwi ${label} varuint is overlong`)
  }
  const readVarInt = label => {
    const value = readVarUint(label)
    return (value & 1) === 1 ? ~(value >>> 1) : value >>> 1
  }
  const readString = label => {
    const start = cursor
    while (cursor < bytes.byteLength && bytes[cursor] !== 0) cursor += 1
    if (cursor >= bytes.byteLength)
      throw new TypeError(`Figma Kiwi ${label} string is unterminated`)
    const value = decodeText(bytes.subarray(start, cursor), `Figma Kiwi ${label}`)
    cursor += 1
    if (value === '') throw new TypeError(`Figma Kiwi ${label} string is empty`)
    return value
  }
  return { readByte, readVarUint, readVarInt, readString, position: () => cursor }
}

function parseKiwiSchema(bytes, budget) {
  const reader = schemaReader(bytes)
  const definitionCount = reader.readVarUint('definition count')
  if (definitionCount === 0 || definitionCount > budget.maxNodes) {
    throw new RangeError('Figma Kiwi definitions exceed maxNodes budget')
  }
  const definitions = []
  const names = new Set()
  let fields = 0
  let scalarBytes = 0
  for (let index = 0; index < definitionCount; index += 1) {
    const name = reader.readString('definition name')
    const kind = reader.readByte('definition kind')
    const fieldCount = reader.readVarUint('field count')
    if (kind > 2 || fields + fieldCount + definitionCount > budget.maxNodes) {
      throw new RangeError('Figma Kiwi schema kind or fields exceed the structural budget')
    }
    if (names.has(name)) throw new TypeError(`Figma Kiwi schema duplicates definition ${name}`)
    names.add(name)
    const fieldNames = new Set()
    const fieldIds = new Set()
    const definitionFields = []
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const fieldName = reader.readString('field name')
      const type = reader.readVarInt('field type')
      const isArray = reader.readByte('array flag')
      const value = reader.readVarUint('field value')
      if (type < -8 || type >= definitionCount || ![0, 1].includes(isArray)) {
        throw new TypeError(`Figma Kiwi field ${fieldName} has an invalid type or array flag`)
      }
      if (fieldNames.has(fieldName) || fieldIds.has(value)) {
        throw new TypeError(`Figma Kiwi definition ${name} duplicates a field name or id`)
      }
      fieldNames.add(fieldName)
      fieldIds.add(value)
      definitionFields.push({ name: fieldName, type, isArray: isArray === 1, value })
      scalarBytes += fieldName.length * 2 + 32
    }
    fields += fieldCount
    scalarBytes += name.length * 2 + 64
    definitions.push({ name, kind, fields: definitionFields })
  }
  if (reader.position() !== bytes.byteLength) {
    throw new TypeError('Figma Kiwi schema has trailing bytes')
  }
  if (!names.has('NodeChanges')) throw new TypeError('Figma Kiwi schema lacks NodeChanges')
  if (scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('Figma Kiwi schema metadata exceeds maxScalarBytes budget')
  }
  return { definitions, fields, scalarBytes }
}

function littleInteger(bytes, offset, length, label) {
  if (offset + length > bytes.byteLength)
    throw new TypeError(`Figma Zstandard ${label} is truncated`)
  let value = 0n
  for (let index = length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index])
  }
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined
}

function inspectZstandard(bytes, budget) {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0x28 ||
    bytes[1] !== 0xb5 ||
    bytes[2] !== 0x2f ||
    bytes[3] !== 0xfd
  ) {
    throw new TypeError('Figma data chunk is not a Zstandard frame')
  }
  const descriptor = bytes[4]
  if ((descriptor & 0x18) !== 0) throw new TypeError('Figma Zstandard descriptor is invalid')
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 0x03
  const sizeFlag = descriptor >>> 6
  let cursor = 5
  if (!singleSegment) cursor += 1
  const dictionaryBytes =
    dictionaryFlag === 0 ? 0 : dictionaryFlag === 1 ? 1 : dictionaryFlag === 2 ? 2 : 4
  cursor += dictionaryBytes
  const sizeBytes =
    sizeFlag === 0 ? (singleSegment ? 1 : 0) : sizeFlag === 1 ? 2 : sizeFlag === 2 ? 4 : 8
  const contentSize =
    sizeBytes === 0 ? undefined : littleInteger(bytes, cursor, sizeBytes, 'content size')
  cursor += sizeBytes
  let blocks = 0
  let rawBlocks = 0
  let rleBlocks = 0
  let compressedBlocks = 0
  let last = false
  while (!last) {
    if (blocks >= budget.maxNodes)
      throw new RangeError('Figma Zstandard blocks exceed maxNodes budget')
    if (cursor + 3 > bytes.byteLength)
      throw new TypeError('Figma Zstandard block header is truncated')
    const header = bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16)
    cursor += 3
    last = (header & 1) !== 0
    const type = (header >>> 1) & 3
    const size = header >>> 3
    if (size > 128 * 1024 || type === 3) {
      throw new TypeError('Figma Zstandard block type or size is invalid')
    }
    const stored = type === 1 ? 1 : size
    if (cursor + stored > bytes.byteLength)
      throw new TypeError('Figma Zstandard block is truncated')
    cursor += stored
    if (type === 0) rawBlocks += 1
    else if (type === 1) rleBlocks += 1
    else compressedBlocks += 1
    blocks += 1
  }
  if (checksum) cursor += 4
  if (cursor !== bytes.byteLength) throw new TypeError('Figma Zstandard frame has trailing bytes')
  return { blocks, rawBlocks, rleBlocks, compressedBlocks, contentSize }
}

async function parseCanvas(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('Figma Kiwi structure exceeds maxDepth budget')
  if (bytes.byteLength < 24 || latin1.decode(bytes.subarray(0, 8)) !== 'fig-kiwi') {
    throw new TypeError('Figma fig-kiwi header is missing')
  }
  const version = u32(bytes, 8)
  const schemaBytes = u32(bytes, 12)
  const schemaStart = 16
  const schemaEnd = schemaStart + schemaBytes
  if (schemaBytes === 0 || schemaEnd + 4 > bytes.byteLength) {
    throw new TypeError('Figma schema chunk is truncated')
  }
  const dataBytes = u32(bytes, schemaEnd)
  const dataStart = schemaEnd + 4
  const dataEnd = dataStart + dataBytes
  if (dataBytes === 0 || dataEnd !== bytes.byteLength) {
    throw new TypeError('Figma data chunk length is invalid')
  }
  const expandedSchema = await inflateRaw(bytes.subarray(schemaStart, schemaEnd), budget)
  const schema = parseKiwiSchema(expandedSchema, budget)
  const data = inspectZstandard(bytes.subarray(dataStart, dataEnd), budget)
  return {
    version,
    schemaBytes,
    schemaDecodedBytes: expandedSchema.byteLength,
    dataBytes,
    schema,
    data,
  }
}

function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

async function parseFigma(bytes, budget) {
  let canvas = bytes
  let entries = []
  let meta
  let packageScalarBytes = 0
  if (isZip(bytes)) {
    const zip = parseZip(bytes, budget)
    entries = zip.entries
    packageScalarBytes = zip.scalarBytes
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    const canvasEntry = byName.get('canvas.fig')
    if (canvasEntry === undefined) throw new TypeError('Figma ZIP package lacks canvas.fig')
    canvas = await extractZipEntry(bytes, canvasEntry)
    const metaEntry = byName.get('meta.json')
    if (metaEntry !== undefined) {
      const source = decodeText(await extractZipEntry(bytes, metaEntry), 'Figma meta.json')
      try {
        meta = JSON.parse(source)
      } catch {
        throw new TypeError('Figma meta.json is malformed')
      }
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
        throw new TypeError('Figma meta.json root must be an object')
      }
      packageScalarBytes += source.length * 2
    }
  }
  const parsed = await parseCanvas(canvas, budget)
  const summary = {
    format: 'figma',
    container: entries.length === 0 ? 'fig-kiwi' : 'zip',
    entries: entries.length,
    version: parsed.version,
    schemaBytes: parsed.schemaBytes,
    schemaDecodedBytes: parsed.schemaDecodedBytes,
    definitions: parsed.schema.definitions.length,
    fields: parsed.schema.fields,
    dataBytes: parsed.dataBytes,
    zstdBlocks: parsed.data.blocks,
    compressedBlocks: parsed.data.compressedBlocks,
  }
  return {
    summary,
    decodedBytes: packageScalarBytes + parsed.schema.scalarBytes + parsed.schemaDecodedBytes,
    root: {
      kind: entries.length === 0 ? 'document' : 'package',
      label: typeof meta?.name === 'string' ? meta.name : 'Figma document',
      preview: `${parsed.schema.definitions.length} Kiwi definition(s), ${parsed.data.blocks} data block(s)`,
      children: [
        ...(entries.length === 0
          ? []
          : entries.map(entry => ({
              kind: 'part',
              label: entry.name,
              preview: `${entry.uncompressedSize} bytes`,
            }))),
        {
          kind: 'schema',
          label: 'Embedded Kiwi schema',
          preview: `${parsed.schema.definitions.length} definitions, ${parsed.schema.fields} fields`,
          children: parsed.schema.definitions.map(definition => ({
            kind: definition.kind === 0 ? 'enum' : definition.kind === 1 ? 'struct' : 'message',
            label: definition.name,
            preview: `${definition.fields.length} field(s)`,
          })),
        },
      ],
    },
  }
}

function detect(prefix) {
  const kiwi = latin1.decode(prefix.subarray(0, 8)) === 'fig-kiwi'
  const zip = isZip(prefix)
  return {
    confidence: kiwi ? 0.995 : zip ? 0.75 : 0,
    kind: 'magic',
    note: kiwi ? 'fig-kiwi' : zip ? 'figma-zip-package' : 'figma-container-missing',
  }
}

export function createFigmaCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: 'org.modkitx/figma',
      format: Object.freeze({
        id: 'figma',
        label: 'Figma file',
        mediaType: 'application/octet-stream',
      }),
      async detect(prefix) {
        return detect(prefix)
      },
      async inspect(bytes, inspectionContext) {
        const parsed = await parseFigma(bytes, inspectionContext.budget)
        return {
          summary: parsed.summary,
          metadata: [
            {
              id: 'figma-document',
              label: 'Figma file',
              entries: Object.entries(parsed.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
            {
              id: 'content.metadata',
              parameters: {
                definitions: parsed.summary.definitions,
                version: parsed.summary.version,
              },
            },
            {
              id: 'structure.hierarchy',
              parameters: { definitions: parsed.summary.definitions, lazy: true },
            },
          ],
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(parsed.root) },
          maxDecodedBytes: parsed.decodedBytes,
          unsupportedFeatures: [
            'kiwi-document-message-decoding',
            'scene-graph-and-component-decoding',
            'layout-rendering',
            'external-resource-fetch',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
