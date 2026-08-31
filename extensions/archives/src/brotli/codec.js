import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/brotli'
const EMPTY_STREAM = 0x06
const UNCOMPRESSED_STREAM = 0x0c
const LAST_EMPTY_META_BLOCK = 0x03
const MAX_META_BLOCK_BYTES = 65_536

function prefixLooksSupported(bytes) {
  if (bytes[0] === EMPTY_STREAM) return true
  if (bytes[0] !== UNCOMPRESSED_STREAM || bytes.byteLength < 4) return false
  const first = bytes[1] ?? 0
  const third = bytes[3] ?? 0
  return (first & 0x07) === 0 && third >= 8 && third <= 15
}

function metaBlockSize(bytes, offset) {
  if (offset + 3 > bytes.byteLength) throw new TypeError('Brotli meta-block header is truncated')
  const first = bytes[offset] ?? 0
  const second = bytes[offset + 1] ?? 0
  const third = bytes[offset + 2] ?? 0
  if ((first & 0x07) !== 0 || third < 8 || third > 15) {
    throw new TypeError('Brotli stream is not in the canonical uncompressed meta-block subset')
  }
  const size = (first >>> 3) | (second << 5) | ((third - 8) << 13)
  if (size >= MAX_META_BLOCK_BYTES) {
    throw new TypeError('Brotli uncompressed meta-block length is invalid')
  }
  return size + 1
}

function parseBrotli(bytes, maximum, maxNodes) {
  if (bytes.byteLength === 1 && bytes[0] === EMPTY_STREAM) {
    return Object.freeze({ decodedSize: 0, chunks: Object.freeze([]), blocks: 0 })
  }
  if (bytes[0] !== UNCOMPRESSED_STREAM) {
    throw new TypeError('Brotli stream uses an unsupported window or compressed first meta-block')
  }
  let cursor = 1
  let decodedSize = 0
  const chunks = []
  while (true) {
    if (cursor >= bytes.byteLength) throw new TypeError('Brotli last empty meta-block is missing')
    if (bytes[cursor] === LAST_EMPTY_META_BLOCK) {
      cursor += 1
      break
    }
    if (chunks.length >= maxNodes) {
      throw new RangeError('Brotli meta-block count exceeds maxNodes budget')
    }
    const size = metaBlockSize(bytes, cursor)
    cursor += 3
    if (decodedSize + size > maximum) {
      throw new RangeError('Brotli payload exceeds maxScalarBytes budget')
    }
    if (cursor + size > bytes.byteLength) {
      throw new TypeError('Brotli uncompressed meta-block payload is truncated')
    }
    chunks.push(bytes.subarray(cursor, cursor + size))
    cursor += size
    decodedSize += size
  }
  if (cursor !== bytes.byteLength) {
    throw new TypeError('Brotli trailing or concatenated streams are outside the supported subset')
  }
  return Object.freeze({ decodedSize, chunks: Object.freeze(chunks), blocks: chunks.length })
}

function decodedPayload(stream) {
  const output = new Uint8Array(stream.decodedSize)
  let offset = 0
  for (const chunk of stream.chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function namespaceSource(stream, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Brotli namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('invalid Brotli page cursor')
      }
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: BigInt(stream.decodedSize),
                compression: 'brotli-uncompressed',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown Brotli payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `brotli-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'brotli',
    label: 'Brotli compressed payload',
    mediaType: 'application/brotli',
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
    return prefixLooksSupported(prefix)
      ? { confidence: 0.92, kind: 'structure', note: 'rfc7932-uncompressed-meta-block' }
      : { confidence: 0, kind: 'structure', note: 'unsupported-brotli-prefix' }
  },
  async inspect(bytes, context) {
    const stream = parseBrotli(bytes, context.budget.maxScalarBytes, context.budget.maxNodes)
    return {
      summary: {
        format: 'brotli',
        decodedBytes: stream.decodedSize,
        metaBlocks: stream.blocks,
        encoding: 'uncompressed',
      },
      metadata: [
        {
          id: 'brotli-stream',
          label: 'Brotli stream',
          entries: [
            { key: 'decodedBytes', value: stream.decodedSize },
            { key: 'metaBlocks', value: stream.blocks },
            { key: 'encoding', value: 'RFC 7932 uncompressed meta-blocks' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['brotli-uncompressed'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Brotli',
          preview: `${stream.decodedSize} decoded bytes in ${stream.blocks} meta-blocks`,
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
        'compressed-and-metadata-brotli-meta-blocks',
        'non-default-brotli-window-encodings',
        'concatenated-brotli-streams',
        'brotli-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
