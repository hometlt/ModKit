// Portable Spring rapid .sdp manifest inventory. Pool blobs live outside the source and are
// intentionally represented as unresolved namespace entries.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/spring-rapid'

function safePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+/gu, '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    parts.some(part => part === '..')
  ) {
    throw new TypeError(`unsafe Spring rapid path: ${value}`)
  }
  return parts.filter(part => part.length > 0 && part !== '.').join('/')
}

function hex(bytes) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function gunzip(bytes, budget) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('Spring rapid gzip inspection is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  if (output.byteLength > budget.maxScalarBytes) {
    throw new RangeError('Spring rapid manifest exceeds maxScalarBytes')
  }
  return output
}

function parseRecords(bytes, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records = []
  let cursor = 0
  while (cursor < bytes.byteLength) {
    if (records.length >= budget.maxNodes)
      throw new RangeError('Spring rapid records exceed maxNodes')
    const nameLength = bytes[cursor] ?? 0
    cursor += 1
    if (nameLength === 0 || cursor + nameLength + 24 > bytes.byteLength) {
      throw new TypeError('Spring rapid record stream is truncated or desynchronised')
    }
    const path = safePath(
      new TextDecoder('ascii').decode(bytes.subarray(cursor, cursor + nameLength)),
    )
    cursor += nameLength
    const md5 = hex(bytes.subarray(cursor, cursor + 16))
    cursor += 16
    const crc32 = view.getUint32(cursor, false)
    cursor += 4
    const size = view.getUint32(cursor, false)
    cursor += 4
    records.push(
      Object.freeze({
        id: String(records.length),
        path,
        md5,
        crc32,
        size,
        poolPath: `${md5.slice(0, 2)}/${md5.slice(2)}.gz`,
      }),
    )
  }
  return Object.freeze(records)
}

function namespaceSource(entries, source) {
  const ids = new Set(entries.map(entry => entry.id))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('invalid Spring rapid page limit')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid Spring rapid cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          size: BigInt(entry.size),
          compression: 'external-gzip-pool',
          revision: source.revision,
        }),
      )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!ids.has(entryId)) throw new TypeError(`unknown Spring rapid entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `spring-rapid-pool:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'spring-rapid', label: 'Spring rapid package' }),
  async detect(prefix, uri) {
    const name = uri.toLowerCase().split(/[?#]/u, 1)[0] ?? uri.toLowerCase()
    const gzip = prefix.byteLength >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b
    return gzip && name.endsWith('.sdp')
      ? { confidence: 0.99, kind: 'magic', note: 'gzip-wrapped Spring rapid manifest' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
      throw new TypeError('Spring rapid manifest is not gzip')
    const records = parseRecords(await gunzip(bytes, context.budget), context.budget)
    return {
      summary: {
        format: 'spring-rapid',
        entries: records.length,
      },
      metadata: [
        {
          id: 'spring-rapid',
          label: 'Spring rapid package',
          entries: [
            { key: 'entries', value: records.length },
            { key: 'pool', value: 'external content-addressed gzip blobs' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: records.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Spring rapid package',
          preview: `${records.length} entries`,
          children: records.map(record => ({
            kind: 'file',
            label: record.path,
            preview: `${record.size} bytes, pool/${record.poolPath}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(records, context.source),
      },
      maxDecodedBytes: records.reduce((sum, record) => sum + BigInt(record.size), 0n),
      unsupportedFeatures: ['pool-blob-resolution', 'package-writing', 'missing-blob-download'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
