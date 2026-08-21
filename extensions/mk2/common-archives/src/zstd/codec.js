import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/zstd'
const MAGIC = Object.freeze([0x28, 0xb5, 0x2f, 0xfd])
const MAX_BLOCK_BYTES = 128 * 1024

const matches = bytes => MAGIC.every((value, index) => bytes[index] === value)

function unsignedLittleEndian(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new TypeError(`Zstandard ${label} is truncated`)
  }
  let value = 0n
  for (let index = length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Zstandard ${label} exceeds safe integers`)
  }
  return Number(value)
}

function parseZstandard(bytes, maximum, maxNodes) {
  if (!matches(bytes) || bytes.byteLength < 9) throw new TypeError('Zstandard frame is invalid')
  const descriptor = bytes[4] ?? 0
  if ((descriptor & 0x18) !== 0) {
    throw new TypeError('Zstandard frame descriptor has a reserved bit set')
  }
  const singleSegment = (descriptor & 0x20) !== 0
  if (!singleSegment) {
    throw new TypeError('Zstandard multi-segment frames are outside the supported subset')
  }
  if ((descriptor & 0x04) !== 0) {
    throw new TypeError('Zstandard content checksums are outside the supported subset')
  }
  const dictionaryFlag = descriptor & 0x03
  if (dictionaryFlag !== 0) {
    throw new TypeError('Zstandard dictionaries are outside the supported subset')
  }
  const sizeFlag = descriptor >>> 6
  const sizeBytes = sizeFlag === 0 ? 1 : sizeFlag === 1 ? 2 : sizeFlag === 2 ? 4 : 8
  let cursor = 5
  let decodedSize = unsignedLittleEndian(bytes, cursor, sizeBytes, 'frame content size')
  if (sizeBytes === 2) decodedSize += 256
  cursor += sizeBytes
  if (decodedSize > maximum) {
    throw new RangeError('Zstandard payload exceeds maxScalarBytes budget')
  }

  const chunks = []
  let produced = 0
  let blocks = 0
  let rawBlocks = 0
  let rleBlocks = 0
  let last = false
  while (!last) {
    if (blocks >= maxNodes) {
      throw new RangeError('Zstandard block count exceeds maxNodes budget')
    }
    if (cursor + 3 > bytes.byteLength) throw new TypeError('Zstandard block header is truncated')
    const header =
      (bytes[cursor] ?? 0) | ((bytes[cursor + 1] ?? 0) << 8) | ((bytes[cursor + 2] ?? 0) << 16)
    cursor += 3
    last = (header & 1) !== 0
    const type = (header >>> 1) & 0x03
    const size = header >>> 3
    if (size > MAX_BLOCK_BYTES || size > decodedSize - produced) {
      throw new RangeError('Zstandard block exceeds its frame or block-size budget')
    }
    if (type === 0) {
      if (cursor + size > bytes.byteLength) throw new TypeError('Zstandard raw block is truncated')
      chunks.push(bytes.subarray(cursor, cursor + size))
      cursor += size
      produced += size
      rawBlocks += 1
    } else if (type === 1) {
      if (cursor >= bytes.byteLength) throw new TypeError('Zstandard RLE block byte is truncated')
      const chunk = new Uint8Array(size)
      chunk.fill(bytes[cursor] ?? 0)
      chunks.push(chunk)
      cursor += 1
      produced += size
      rleBlocks += 1
    } else if (type === 2) {
      throw new TypeError('Zstandard compressed blocks are outside the supported subset')
    } else {
      throw new TypeError('Zstandard reserved block type is invalid')
    }
    blocks += 1
  }
  if (produced !== decodedSize) {
    throw new TypeError('Zstandard decoded size does not match the frame content size')
  }
  if (cursor !== bytes.byteLength) {
    throw new TypeError(
      'Concatenated or trailing Zstandard frames are outside the supported subset',
    )
  }
  return Object.freeze({ decodedSize, chunks: Object.freeze(chunks), blocks, rawBlocks, rleBlocks })
}

function decodedPayload(frame) {
  const output = new Uint8Array(frame.decodedSize)
  let offset = 0
  for (const chunk of frame.chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function namespaceSource(frame, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Zstandard namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('invalid Zstandard page cursor')
      }
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: BigInt(frame.decodedSize),
                compression: frame.rleBlocks === 0 ? 'zstd-raw' : 'zstd-raw-rle',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown Zstandard payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `zstd-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'zstd',
    label: 'Zstandard compressed payload',
    mediaType: 'application/zstd',
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
      ? { confidence: 0.99, kind: 'magic', note: 'zstandard-frame' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const frame = parseZstandard(bytes, context.budget.maxScalarBytes, context.budget.maxNodes)
    const methods = [
      frame.rawBlocks > 0 ? 'raw' : undefined,
      frame.rleBlocks > 0 ? 'rle' : undefined,
    ].filter(Boolean)
    return {
      summary: {
        format: 'zstd',
        decodedBytes: frame.decodedSize,
        blocks: frame.blocks,
        rawBlocks: frame.rawBlocks,
        rleBlocks: frame.rleBlocks,
      },
      metadata: [
        {
          id: 'zstandard-frame',
          label: 'Zstandard frame',
          entries: [
            { key: 'decodedBytes', value: frame.decodedSize },
            { key: 'blocks', value: frame.blocks },
            { key: 'rawBlocks', value: frame.rawBlocks },
            { key: 'rleBlocks', value: frame.rleBlocks },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Zstandard',
          preview: `${frame.decodedSize} decoded bytes in ${frame.blocks} blocks`,
          children: [
            { kind: 'file', label: 'payload.bin', preview: `${frame.decodedSize} decoded bytes` },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(frame, context.source),
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
          return { kind: 'bytes', value: decodedPayload(frame) }
        },
      },
      maxDecodedBytes: BigInt(frame.decodedSize),
      unsupportedFeatures: [
        'compressed-zstandard-blocks',
        'zstandard-dictionaries',
        'content-checksums',
        'multi-segment-and-concatenated-frames',
        'zstandard-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
