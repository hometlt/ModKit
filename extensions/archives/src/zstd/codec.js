import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'
import { decodeZstd, isZstdFrame } from '@modkit/codec-kit/compression/zstd'

const ID = 'modkit/zstd'

function namespaceSource(payload, compressedBytes, source) {
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
                size: BigInt(payload.byteLength),
                storedSize: BigInt(compressedBytes),
                compression: 'zstd',
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
    return isZstdFrame(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'zstandard-frame' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    // The one Zstandard decoder of the workspace (codec-kit), bounded by the scalar budget.
    const payload = decodeZstd(bytes, { maxOutputBytes: context.budget.maxScalarBytes })
    return {
      summary: {
        format: 'zstd',
        decodedBytes: payload.byteLength,
        compressedBytes: bytes.byteLength,
      },
      metadata: [
        {
          id: 'zstandard-frame',
          label: 'Zstandard frame',
          entries: [
            { key: 'decodedBytes', value: payload.byteLength },
            { key: 'compressedBytes', value: bytes.byteLength },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['zstd'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Zstandard',
          preview: `${payload.byteLength} decoded bytes`,
          children: [
            { kind: 'file', label: 'payload.bin', preview: `${payload.byteLength} decoded bytes` },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(
          payload,
          bytes.byteLength,
          context.source,
        ),
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
          return { kind: 'bytes', value: payload }
        },
      },
      maxDecodedBytes: BigInt(payload.byteLength),
      unsupportedFeatures: ['zstandard-dictionaries', 'zstandard-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
