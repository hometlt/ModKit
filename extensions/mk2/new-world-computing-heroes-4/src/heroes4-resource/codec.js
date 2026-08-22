// Portable reader for the confirmed Heroes IV H4R named-record subset.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/heroes4-resource'
const HEADER_SIZE = 12
const RECORD_SIZE = 20

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function range(total, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > total ||
    length > total - offset
  ) {
    throw new RangeError(`Heroes IV ${label} is outside the source`)
  }
}

function u16(bytes, offset) {
  range(bytes.byteLength, offset, 2, '16-bit field')
  return viewOf(bytes).getUint16(offset, true)
}

function u32(bytes, offset) {
  range(bytes.byteLength, offset, 4, '32-bit field')
  return viewOf(bytes).getUint32(offset, true)
}

function safePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+/gu, '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    parts.some(part => part === '..')
  ) {
    throw new TypeError(`unsafe Heroes IV path: ${value}`)
  }
  return parts.filter(part => part.length > 0 && part !== '.').join('/')
}

function parseArchive(bytes, budget) {
  if (
    bytes.byteLength < HEADER_SIZE ||
    bytes[0] !== 0x48 ||
    bytes[1] !== 0x34 ||
    bytes[2] !== 0x52 ||
    bytes[3] !== 0
  ) {
    throw new TypeError('Heroes IV H4R signature is missing')
  }
  const version = u32(bytes, 4)
  const count = u32(bytes, 8)
  if (version > 1) throw new TypeError(`unsupported Heroes IV resource version ${version}`)
  if (count > budget.maxNodes) throw new RangeError('Heroes IV entries exceed maxNodes')
  range(bytes.byteLength, HEADER_SIZE, count * RECORD_SIZE, 'entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = HEADER_SIZE + index * RECORD_SIZE
    const nameOffset = u32(bytes, cursor)
    const nameLength = u16(bytes, cursor + 4)
    const recordType = u16(bytes, cursor + 6)
    const offset = u32(bytes, cursor + 8)
    const size = u32(bytes, cursor + 12)
    range(bytes.byteLength, nameOffset, nameLength, `entry ${index} name`)
    range(bytes.byteLength, offset, size, `entry ${index} payload`)
    if (size > budget.maxScalarBytes) throw new RangeError('Heroes IV entry exceeds maxScalarBytes')
    const raw = new TextDecoder()
      .decode(bytes.subarray(nameOffset, nameOffset + nameLength))
      .replace(/\0+$/gu, '')
    entries.push(
      Object.freeze({ id: String(index), path: safePath(raw), offset, size, recordType }),
    )
  }
  return Object.freeze({ version, entries: Object.freeze(entries) })
}

function namespaceSource(entries, source) {
  const ids = new Set(entries.map(entry => entry.id))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('invalid Heroes IV page limit')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid Heroes IV cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          storedSize: BigInt(entry.size),
          size: BigInt(entry.size),
          compression: 'stored',
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
      if (!ids.has(entryId)) throw new TypeError(`unknown Heroes IV entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `heroes4-entry:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'heroes4-resource', label: 'Heroes IV Resource' }),
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
    const magic =
      prefix.byteLength >= HEADER_SIZE &&
      prefix[0] === 0x48 &&
      prefix[1] === 0x34 &&
      prefix[2] === 0x52 &&
      prefix[3] === 0
    return magic
      ? { confidence: 0.99, kind: 'magic', note: 'H4R named-record resource' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const types = [...new Set(archive.entries.map(entry => entry.recordType))].sort((a, b) => a - b)
    return {
      summary: {
        format: 'heroes4-resource',
        version: archive.version,
        entries: archive.entries.length,
        recordTypes: types,
      },
      metadata: [
        {
          id: 'heroes4-resource',
          label: 'Heroes IV Resource',
          entries: [
            { key: 'version', value: archive.version },
            { key: 'entries', value: archive.entries.length },
            { key: 'recordTypes', value: types.map(type => `0x${type.toString(16)}`).join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Heroes IV Resource',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes, type 0x${entry.recordType.toString(16)}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('Heroes IV entry id was not found')
          return { kind: 'bytes', value: bytes.slice(entry.offset, entry.offset + entry.size) }
        },
      },
      maxDecodedBytes: archive.entries.reduce((total, entry) => total + BigInt(entry.size), 0n),
      unsupportedFeatures: ['compressed-payload-decoding', 'archive-writing', 'retail-layouts'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
