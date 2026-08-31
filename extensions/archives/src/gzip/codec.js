import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/gzip'
const latin1 = new TextDecoder('latin1')

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('GZip u16 is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('GZip u32 is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

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

const matches = bytes => bytes[0] === 0x1f && bytes[1] === 0x8b

function terminatedField(bytes, offset, end, label) {
  for (let cursor = offset; cursor < end; cursor += 1) {
    if (bytes[cursor] === 0) {
      return Object.freeze({
        value: latin1.decode(bytes.subarray(offset, cursor)),
        next: cursor + 1,
      })
    }
  }
  throw new TypeError(`GZip ${label} is not NUL-terminated`)
}

function payloadName(originalName) {
  const leaf = originalName?.split(/[\\/]/u).at(-1)?.trim()
  if (leaf === undefined || leaf === '' || leaf === '.' || leaf === '..' || leaf.includes('\0')) {
    return 'payload.bin'
  }
  return leaf
}

function parseGzip(bytes, maxScalarBytes) {
  if (!matches(bytes) || bytes.byteLength < 18) throw new TypeError('GZip header is invalid')
  if (bytes[2] !== 8 || ((bytes[3] ?? 0) & 0xe0) !== 0) {
    throw new TypeError('GZip compression method or flags are invalid')
  }
  const flags = bytes[3] ?? 0
  const trailerOffset = bytes.byteLength - 8
  let cursor = 10
  if ((flags & 0x04) !== 0) {
    const extraLength = u16(bytes, cursor)
    cursor += 2
    if (cursor + extraLength > trailerOffset) throw new TypeError('GZip extra field is truncated')
    cursor += extraLength
  }
  let originalName
  if ((flags & 0x08) !== 0) {
    const field = terminatedField(bytes, cursor, trailerOffset, 'original filename')
    originalName = field.value
    cursor = field.next
  }
  let comment
  if ((flags & 0x10) !== 0) {
    const field = terminatedField(bytes, cursor, trailerOffset, 'comment')
    comment = field.value
    cursor = field.next
  }
  if (cursor - 10 > maxScalarBytes)
    throw new RangeError('GZip header exceeds maxScalarBytes budget')
  if ((flags & 0x02) !== 0) {
    if (cursor + 2 > trailerOffset) throw new TypeError('GZip header checksum is truncated')
    if (u16(bytes, cursor) !== (crc32(bytes.subarray(0, cursor)) & 0xffff)) {
      throw new TypeError('GZip header checksum is invalid')
    }
    cursor += 2
  }
  if (cursor >= trailerOffset) throw new TypeError('GZip compressed payload is missing')
  const decodedCrc = u32(bytes, trailerOffset)
  const decodedSize = u32(bytes, trailerOffset + 4)
  return Object.freeze({
    flags,
    modifiedAt: u32(bytes, 4),
    extraFlags: bytes[8] ?? 0,
    operatingSystem: bytes[9] ?? 0,
    originalName,
    comment,
    name: payloadName(originalName),
    payloadOffset: cursor,
    compressedBytes: trailerOffset - cursor,
    decodedCrc,
    decodedSize,
  })
}

async function extractGzip(bytes, gzip, maximum) {
  if (gzip.decodedSize > maximum) throw new RangeError('GZip payload exceeds maxScalarBytes budget')
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('GZip extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > gzip.decodedSize || total > maximum) {
      await reader.cancel('GZip decoded output exceeded its declared size')
      throw new RangeError('GZip decoded output exceeds its declared size or budget')
    }
    chunks.push(result.value)
  }
  if (total !== gzip.decodedSize) {
    throw new TypeError('GZip decoded size does not match the trailer')
  }
  const decoded = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    decoded.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (crc32(decoded) !== gzip.decodedCrc) throw new TypeError('GZip decoded CRC-32 is invalid')
  return decoded
}

function namespaceSource(gzip, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('GZip namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid GZip page cursor')
      const matching = gzip.name.startsWith(prefix) ? 1 : 0
      const items =
        matching === 1 && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: gzip.name,
                name: gzip.name,
                kind: 'file',
                size: BigInt(gzip.decodedSize),
                storedSize: BigInt(gzip.compressedBytes),
                compression: 'deflate',
                checksum: {
                  algorithm: 'crc-32',
                  value: gzip.decodedCrc.toString(16).padStart(8, '0'),
                },
                ...(gzip.modifiedAt === 0 ? {} : { modifiedAt: gzip.modifiedAt * 1000 }),
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown GZip payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `gzip-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'gzip',
    label: 'GZip single-payload stream',
    mediaType: 'application/gzip',
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
      ? { confidence: 0.99, kind: 'magic', note: 'gzip-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const gzip = parseGzip(bytes, context.budget.maxScalarBytes)
    return {
      summary: {
        format: 'gzip',
        entries: 1,
        originalName: gzip.originalName,
        decodedBytes: gzip.decodedSize,
        compressedBytes: gzip.compressedBytes,
      },
      metadata: [
        {
          id: 'gzip-member',
          label: 'GZip member',
          entries: [
            { key: 'originalName', value: gzip.originalName ?? null },
            { key: 'comment', value: gzip.comment ?? null },
            { key: 'modifiedAtSeconds', value: gzip.modifiedAt },
            { key: 'extraFlags', value: gzip.extraFlags },
            { key: 'operatingSystem', value: gzip.operatingSystem },
            { key: 'compressedBytes', value: gzip.compressedBytes },
            { key: 'decodedBytesModulo2Pow32', value: gzip.decodedSize },
            { key: 'decodedCrc32', value: gzip.decodedCrc.toString(16).padStart(8, '0') },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['deflate'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'GZip',
          preview: `${gzip.name}, ${gzip.decodedSize} decoded bytes`,
          children: [
            {
              kind: 'file',
              label: gzip.name,
              preview: `${gzip.compressedBytes} stored bytes, CRC ${gzip.decodedCrc.toString(16).padStart(8, '0')}`,
            },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(gzip, context.source),
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
          return {
            kind: 'bytes',
            value: await extractGzip(bytes, gzip, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: BigInt(gzip.decodedSize),
      unsupportedFeatures: ['concatenated-gzip-members', 'gzip-writing', 'archive-mutation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
