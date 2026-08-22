import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unity-ress'

function assertBudget(bytes, context) {
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('Unity input exceeds maxInputBytes')
  }
  if (context.budget.maxNodes < 1) throw new RangeError('Unity input exceeds maxNodes')
}

function namespaceSource(entries, source) {
  const entry = entries[0]
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Unity namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('invalid Unity namespace cursor')
      }
      const items =
        start === 0 && entry !== undefined && entry.path.startsWith(prefix)
          ? [
              Object.freeze({
                id: entry.id,
                path: entry.path,
                name: entry.name,
                kind: 'file',
                size: BigInt(entry.size),
                revision: source.revision,
              }),
            ]
          : []
      return Object.freeze({ items: Object.freeze(items) })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entry === undefined || entry.id !== entryId) {
        throw new TypeError(`unknown Unity entry ${entryId}`)
      }
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `unity-resource:${encodeURIComponent(source.ref.uri)}!/${entry.path}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'unity-ress', label: 'Unity Resource Stream' }),
  async detect(prefix) {
    return prefix.byteLength === 0
      ? { confidence: 0, kind: 'structure', note: 'empty-resource-stream' }
      : { confidence: 0.6, kind: 'structure', note: 'headerless-extension-routed-stream' }
  },
  async inspect(bytes, context) {
    if (bytes.byteLength === 0) throw new TypeError('Unity resource stream is empty')
    assertBudget(bytes, context, 1)
    const entries = [
      {
        id: 'resource-stream',
        path: 'resource-stream.bin',
        name: 'resource-stream.bin',
        offset: 0,
        size: bytes.byteLength,
      },
    ]
    return {
      summary: {
        format: 'unity-ress',
        entries: 1,
        bytes: bytes.byteLength,
        classAwareRanges: false,
      },
      metadata: [
        {
          id: 'unity-resource-stream',
          label: 'Unity resource stream',
          entries: [
            { key: 'bytes', value: bytes.byteLength },
            { key: 'header', value: 'none' },
            { key: 'classAwareRanges', value: false },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Unity resource stream',
          preview: `${bytes.byteLength} headerless bytes`,
          children: [
            {
              kind: 'entry',
              label: 'resource-stream.bin',
              preview: `${bytes.byteLength} bytes`,
            },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      unsupportedFeatures: ['class-aware-ranges-without-assets-companion', 'resource-repacking'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
