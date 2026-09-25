/*
 * LZMA-alone streams whose 13-byte header declares a finite uncompressed size, so output is
 * budgeted up front. The decoder itself is the shared codec-kit owner.
 */

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'
import { lzmaDecode, parseLzmaProperties } from '@modkit/codec-kit/compression'

const ID = 'modkit/lzma'

function readU32le(bytes, offset) {
  return (
    (((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)) +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  )
}

function readU64le(bytes, offset) {
  return BigInt(readU32le(bytes, offset)) | (BigInt(readU32le(bytes, offset + 4)) << 32n)
}

function decodeLzma(bytes, budget) {
  if (bytes.byteLength < 18) throw new TypeError('LZMA-alone stream is truncated')
  const properties = parseLzmaProperties(bytes)
  const unpackedSize = readU64le(bytes, 5)
  if (unpackedSize === 0xffffffffffffffffn) {
    throw new TypeError('LZMA-alone streams with unknown output size are unsupported')
  }
  if (unpackedSize > BigInt(budget.maxScalarBytes)) {
    throw new RangeError('LZMA payload exceeds maxScalarBytes budget')
  }
  if (budget.maxNodes < 1) throw new RangeError('LZMA entry count exceeds maxNodes budget')
  const decoded = lzmaDecode(bytes.subarray(13), properties, {
    outputSize: Number(unpackedSize),
    allowEndMarker: false,
  })
  return Object.freeze({ ...properties, unpackedSize, decoded })
}

function prefixLooksSupported(prefix) {
  if (prefix.byteLength < 13 || (prefix[0] ?? 0) >= 225) return false
  const size = readU64le(prefix, 5)
  return size !== 0xffffffffffffffffn && size <= BigInt(Number.MAX_SAFE_INTEGER)
}

function namespaceSource(stream, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('LZMA namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid LZMA page cursor')
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: stream.unpackedSize,
                compression: 'lzma1',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown LZMA payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `lzma-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'lzma',
    label: 'LZMA compressed payload',
    mediaType: 'application/x-lzma',
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
      ? { confidence: 0.92, kind: 'structure', note: 'lzma-alone-known-size-header' }
      : { confidence: 0, kind: 'structure', note: 'unsupported-lzma-alone-header' }
  },
  async inspect(bytes, context) {
    const stream = decodeLzma(bytes, context.budget)
    return {
      summary: {
        format: 'lzma',
        decodedBytes: stream.decoded.byteLength,
        dictionaryBytes: stream.dictionarySize,
        properties: { lc: stream.lc, lp: stream.lp, pb: stream.pb },
      },
      metadata: [
        {
          id: 'lzma-stream',
          label: 'LZMA-alone stream',
          entries: [
            { key: 'decodedBytes', value: stream.decoded.byteLength },
            { key: 'dictionaryBytes', value: stream.dictionarySize },
            { key: 'literalContextBits', value: stream.lc },
            { key: 'literalPositionBits', value: stream.lp },
            { key: 'positionBits', value: stream.pb },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['lzma1'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'LZMA',
          preview: `${stream.decoded.byteLength} decoded bytes`,
          children: [
            {
              kind: 'file',
              label: 'payload.bin',
              preview: `${stream.decoded.byteLength} decoded bytes`,
            },
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
          return { kind: 'bytes', value: stream.decoded.slice() }
        },
      },
      maxDecodedBytes: stream.unpackedSize,
      unsupportedFeatures: [
        'lzma-alone-unknown-output-size',
        'lzma2-and-container-wrappers',
        'lzma-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
