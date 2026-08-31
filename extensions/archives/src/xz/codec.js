import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/xz'
const HEADER_MAGIC = Object.freeze([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])
const FOOTER_MAGIC = Object.freeze([0x59, 0x5a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

function u32(bytes, offset, label) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError(`XZ ${label} is truncated`)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

const matches = bytes => HEADER_MAGIC.every((value, index) => bytes[index] === value)

function readVli(bytes, offset, end, label) {
  let value = 0n
  let shift = 0n
  for (let index = 0; index < 9; index += 1) {
    if (offset + index >= end) throw new TypeError(`XZ ${label} VLI is truncated`)
    const byte = bytes[offset + index] ?? 0
    if (index === 8 && byte > 0x7f) throw new TypeError(`XZ ${label} VLI is invalid`)
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      if (index > 0 && byte === 0) throw new TypeError(`XZ ${label} VLI is not canonical`)
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`XZ ${label} VLI exceeds safe integers`)
      }
      return Object.freeze({ value: Number(value), next: offset + index + 1 })
    }
    shift += 7n
  }
  throw new TypeError(`XZ ${label} VLI is too long`)
}

function decodeLzma2Stored(data, expected, maximum) {
  if (expected > maximum) throw new RangeError('XZ payload exceeds maxScalarBytes budget')
  const chunks = []
  let cursor = 0
  let produced = 0
  let dictionaryReady = false
  let ended = false
  while (cursor < data.byteLength) {
    const control = data[cursor] ?? 0
    cursor += 1
    if (control === 0) {
      ended = true
      break
    }
    if (control !== 1 && control !== 2) {
      throw new TypeError('XZ compressed LZMA2 chunks are outside the supported subset')
    }
    if (control === 2 && !dictionaryReady) {
      throw new TypeError('XZ LZMA2 stream uses an uninitialized dictionary')
    }
    if (cursor + 2 > data.byteLength) throw new TypeError('XZ LZMA2 chunk header is truncated')
    const size = (((data[cursor] ?? 0) << 8) | (data[cursor + 1] ?? 0)) + 1
    cursor += 2
    if (cursor + size > data.byteLength) throw new TypeError('XZ LZMA2 chunk payload is truncated')
    if (size > expected - produced || produced + size > maximum) {
      throw new RangeError('XZ LZMA2 output exceeds its declared size or budget')
    }
    chunks.push(data.subarray(cursor, cursor + size))
    cursor += size
    produced += size
    dictionaryReady = true
  }
  if (!ended || cursor !== data.byteLength) {
    throw new TypeError('XZ LZMA2 end marker is missing or not final')
  }
  if (produced !== expected) throw new TypeError('XZ LZMA2 decoded size is invalid')
  return Object.freeze(chunks)
}

function parseBlock(bytes, offset, indexOffset, maximum) {
  const encodedHeaderSize = bytes[offset] ?? 0
  if (encodedHeaderSize === 0) throw new TypeError('XZ block header is missing')
  const headerSize = (encodedHeaderSize + 1) * 4
  const headerEnd = offset + headerSize
  if (headerEnd > indexOffset) throw new TypeError('XZ block header is truncated')
  const expectedHeaderCrc = u32(bytes, headerEnd - 4, 'block header CRC-32')
  if (crc32(bytes.subarray(offset, headerEnd - 4)) !== expectedHeaderCrc) {
    throw new TypeError('XZ block header CRC-32 is invalid')
  }
  const flags = bytes[offset + 1] ?? 0
  if ((flags & 0x3c) !== 0 || (flags & 0x03) !== 0) {
    throw new TypeError('XZ block must contain exactly one filter and no reserved flags')
  }
  if ((flags & 0xc0) !== 0xc0) {
    throw new TypeError('XZ block must declare compressed and uncompressed sizes')
  }
  let cursor = offset + 2
  const compressed = readVli(bytes, cursor, headerEnd - 4, 'compressed size')
  cursor = compressed.next
  const uncompressed = readVli(bytes, cursor, headerEnd - 4, 'uncompressed size')
  cursor = uncompressed.next
  if (compressed.value === 0) throw new TypeError('XZ compressed size must be positive')
  if (uncompressed.value > maximum) throw new RangeError('XZ block exceeds maxScalarBytes budget')
  const filterId = readVli(bytes, cursor, headerEnd - 4, 'filter ID')
  cursor = filterId.next
  const propertySize = readVli(bytes, cursor, headerEnd - 4, 'filter property size')
  cursor = propertySize.next
  if (filterId.value !== 0x21 || propertySize.value !== 1 || cursor >= headerEnd - 4) {
    throw new TypeError('XZ block is not a single LZMA2 filter')
  }
  const dictionaryProperty = bytes[cursor] ?? 0
  cursor += 1
  if (dictionaryProperty > 40) throw new TypeError('XZ LZMA2 dictionary property is invalid')
  while (cursor < headerEnd - 4) {
    if (bytes[cursor] !== 0) throw new TypeError('XZ block header padding is not zero')
    cursor += 1
  }

  const dataOffset = headerEnd
  const dataEnd = dataOffset + compressed.value
  if (dataEnd > indexOffset) throw new TypeError('XZ compressed data is truncated')
  const chunks = decodeLzma2Stored(bytes.subarray(dataOffset, dataEnd), uncompressed.value, maximum)
  const padding = (4 - (compressed.value % 4)) % 4
  const next = dataEnd + padding
  if (next > indexOffset) throw new TypeError('XZ block padding is truncated')
  for (let position = dataEnd; position < next; position += 1) {
    if (bytes[position] !== 0) throw new TypeError('XZ block padding is not zero')
  }
  return Object.freeze({
    next,
    headerSize,
    compressedSize: compressed.value,
    uncompressedSize: uncompressed.value,
    unpaddedSize: headerSize + compressed.value,
    dictionaryProperty,
    chunks,
  })
}

function parseIndex(bytes, offset, footerOffset, blocks) {
  if (bytes[offset] !== 0) throw new TypeError('XZ Index indicator is invalid')
  let cursor = offset + 1
  const count = readVli(bytes, cursor, footerOffset - 4, 'Index record count')
  cursor = count.next
  if (count.value !== blocks.length) throw new TypeError('XZ Index block count is invalid')
  for (let index = 0; index < count.value; index += 1) {
    const unpadded = readVli(bytes, cursor, footerOffset - 4, 'Index unpadded size')
    cursor = unpadded.next
    const uncompressed = readVli(bytes, cursor, footerOffset - 4, 'Index uncompressed size')
    cursor = uncompressed.next
    const block = blocks[index]
    if (block === undefined || unpadded.value !== block.unpaddedSize) {
      throw new TypeError(`XZ Index unpadded size for block ${index} is invalid`)
    }
    if (uncompressed.value !== block.uncompressedSize) {
      throw new TypeError(`XZ Index uncompressed size for block ${index} is invalid`)
    }
  }
  while (cursor < footerOffset - 4) {
    if (bytes[cursor] !== 0) throw new TypeError('XZ Index padding is not zero')
    cursor += 1
  }
  if (
    crc32(bytes.subarray(offset, footerOffset - 4)) !== u32(bytes, footerOffset - 4, 'Index CRC-32')
  ) {
    throw new TypeError('XZ Index CRC-32 is invalid')
  }
}

function parseXz(bytes, maximum, maxNodes) {
  if (!matches(bytes) || bytes.byteLength < 32 || bytes.byteLength % 4 !== 0) {
    throw new TypeError('XZ stream is invalid or truncated')
  }
  const flags = bytes.subarray(6, 8)
  if (flags[0] !== 0 || flags[1] !== 0) {
    throw new TypeError('XZ stream must use version zero and Check=None')
  }
  if (crc32(flags) !== u32(bytes, 8, 'stream header CRC-32')) {
    throw new TypeError('XZ stream header CRC-32 is invalid')
  }
  const footerOffset = bytes.byteLength - 12
  if (
    bytes[footerOffset + 10] !== FOOTER_MAGIC[0] ||
    bytes[footerOffset + 11] !== FOOTER_MAGIC[1]
  ) {
    throw new TypeError('XZ footer magic is invalid')
  }
  if (bytes[footerOffset + 8] !== flags[0] || bytes[footerOffset + 9] !== flags[1]) {
    throw new TypeError('XZ footer stream flags do not match the header')
  }
  if (
    crc32(bytes.subarray(footerOffset + 4, footerOffset + 10)) !==
    u32(bytes, footerOffset, 'footer CRC-32')
  ) {
    throw new TypeError('XZ footer CRC-32 is invalid')
  }
  const indexSize = (u32(bytes, footerOffset + 4, 'Backward Size') + 1) * 4
  const indexOffset = footerOffset - indexSize
  if (indexOffset < 12) throw new TypeError('XZ Backward Size points outside the stream')

  const blocks = []
  let cursor = 12
  let decodedSize = 0
  while (cursor < indexOffset) {
    if (blocks.length >= maxNodes) throw new RangeError('XZ block count exceeds maxNodes budget')
    const block = parseBlock(bytes, cursor, indexOffset, maximum - decodedSize)
    blocks.push(block)
    decodedSize += block.uncompressedSize
    if (decodedSize > maximum) throw new RangeError('XZ payload exceeds maxScalarBytes budget')
    cursor = block.next
  }
  if (cursor !== indexOffset || blocks.length === 0) {
    throw new TypeError('XZ block area does not end at the Index or contains no blocks')
  }
  parseIndex(bytes, indexOffset, footerOffset, blocks)
  return Object.freeze({ blocks: Object.freeze(blocks), decodedSize })
}

function decodedPayload(stream) {
  const output = new Uint8Array(stream.decodedSize)
  let offset = 0
  for (const block of stream.blocks) {
    for (const chunk of block.chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
  }
  return output
}

function namespaceSource(stream, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('XZ namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid XZ page cursor')
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: BigInt(stream.decodedSize),
                compression: 'lzma2-uncompressed',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown XZ payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `xz-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'xz',
    label: 'XZ compressed payload',
    mediaType: 'application/x-xz',
  }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'xz-stream' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const stream = parseXz(bytes, context.budget.maxScalarBytes, context.budget.maxNodes)
    return {
      summary: {
        format: 'xz',
        check: 'none',
        filters: ['lzma2'],
        blocks: stream.blocks.length,
        decodedBytes: stream.decodedSize,
      },
      metadata: [
        {
          id: 'xz-stream',
          label: 'XZ stream',
          entries: [
            { key: 'check', value: 'none' },
            { key: 'blocks', value: stream.blocks.length },
            { key: 'decodedBytes', value: stream.decodedSize },
            { key: 'lzma2Mode', value: 'uncompressed-chunks' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['lzma2-uncompressed'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'XZ',
          preview: `${stream.decodedSize} decoded bytes in ${stream.blocks.length} blocks`,
          children: [
            { kind: 'file', label: 'payload.bin', preview: `${stream.decodedSize} decoded bytes` },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(stream, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (
            input === null ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            input.entryId !== 'payload'
          ) {
            throw new TypeError('container.extract requires {entryId:"payload"}')
          }
          return { kind: 'bytes', value: decodedPayload(stream) }
        },
      },
      maxDecodedBytes: BigInt(stream.decodedSize),
      unsupportedFeatures: [
        'compressed-lzma2-chunks',
        'xz-checksums',
        'multi-filter-blocks',
        'concatenated-streams-and-stream-padding',
        'xz-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
