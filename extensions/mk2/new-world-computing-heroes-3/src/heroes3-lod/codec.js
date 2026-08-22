// Portable Heroes III LOD/SND/VID reader with bounded tables and extraction.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/heroes3-lod'
const LOD_HEADER = 92
const LOD_RECORD = 32
const SND_H3_RECORD = 48
const SND_MM_RECORD = 52
const VID_RECORD = 44

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
    throw new RangeError(`Heroes III ${label} is outside the source`)
  }
}

function u32(bytes, offset) {
  range(bytes.byteLength, offset, 4, '32-bit field')
  return viewOf(bytes).getUint32(offset, true)
}

function fixed(bytes, offset, length) {
  range(bytes.byteLength, offset, length, 'fixed string')
  let end = offset
  while (end < offset + length && bytes[end] !== 0) end += 1
  return new TextDecoder().decode(bytes.subarray(offset, end))
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
    throw new TypeError(`unsafe Heroes III resource path: ${value}`)
  }
  return parts.filter(part => part.length > 0 && part !== '.').join('/')
}

function extensionOf(uri) {
  const clean = uri.toLowerCase().split(/[?#]/u, 1)[0] ?? uri.toLowerCase()
  return clean.endsWith('.snd') ? 'snd' : clean.endsWith('.vid') ? 'vid' : 'lod'
}

function parseLod(bytes, budget) {
  if (bytes.byteLength < LOD_HEADER || fixed(bytes, 0, 4) !== 'LOD') {
    throw new TypeError('Heroes III LOD header is missing')
  }
  const version = u32(bytes, 4)
  const count = u32(bytes, 8)
  if (version > 0xffff) throw new TypeError('Might & Magic LOD layout is not claimed by this port')
  if (count > budget.maxNodes) throw new RangeError('Heroes III LOD entries exceed maxNodes')
  range(bytes.byteLength, LOD_HEADER, count * LOD_RECORD, 'LOD entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = LOD_HEADER + index * LOD_RECORD
    const path = safePath(fixed(bytes, cursor, 16))
    const offset = u32(bytes, cursor + 16)
    const unpacked = u32(bytes, cursor + 20)
    const packed = u32(bytes, cursor + 28)
    const storedSize = packed === 0 ? unpacked : packed
    const decodedSize = packed === 0 ? unpacked : unpacked
    range(bytes.byteLength, offset, storedSize, `LOD entry ${index}`)
    if (decodedSize > budget.maxScalarBytes)
      throw new RangeError('LOD entry exceeds maxScalarBytes')
    entries.push(
      Object.freeze({
        id: String(index),
        path,
        offset,
        storedSize,
        decodedSize,
        compression: packed === 0 || packed === unpacked ? 'stored' : 'zlib',
      }),
    )
  }
  return Object.freeze({ kind: 'lod', version: String(version), entries: Object.freeze(entries) })
}

function plausibleSnd(bytes, count, recordSize, dataStart) {
  if (dataStart > bytes.byteLength) return false
  for (let index = 0; index < count; index += 1) {
    const cursor = 4 + index * recordSize
    if (cursor + recordSize > bytes.byteLength) return false
    const offset = u32(bytes, cursor + 40)
    const size = u32(bytes, cursor + 44)
    if (offset < dataStart || offset > bytes.byteLength || size > bytes.byteLength - offset)
      return false
  }
  return true
}

function parseSnd(bytes, budget) {
  if (bytes.byteLength < 4) throw new TypeError('Heroes III SND is truncated')
  const count = u32(bytes, 0)
  if (count > budget.maxNodes) throw new RangeError('Heroes III SND entries exceed maxNodes')
  const mm = plausibleSnd(bytes, count, SND_MM_RECORD, 4 + count * SND_MM_RECORD)
  const recordSize = mm ? SND_MM_RECORD : SND_H3_RECORD
  if (!plausibleSnd(bytes, count, recordSize, 4 + count * recordSize)) {
    throw new TypeError('Heroes III SND table is invalid')
  }
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = 4 + index * recordSize
    let path = fixed(bytes, cursor, 40)
    if (!/\.[^/.]+$/u.test(path)) path += '.wav'
    const offset = u32(bytes, cursor + 40)
    const storedSize = u32(bytes, cursor + 44)
    const unpacked = mm ? u32(bytes, cursor + 48) : storedSize
    if (unpacked > budget.maxScalarBytes) throw new RangeError('SND entry exceeds maxScalarBytes')
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(path),
        offset,
        storedSize,
        decodedSize: unpacked || storedSize,
        compression: mm && unpacked !== storedSize ? 'zlib' : 'stored',
      }),
    )
  }
  return Object.freeze({
    kind: mm ? 'snd-mm' : 'snd',
    version: mm ? 'MM' : 'H3',
    entries: Object.freeze(entries),
  })
}

function parseVid(bytes, budget) {
  if (bytes.byteLength < 4) throw new TypeError('Heroes III VID is truncated')
  const count = u32(bytes, 0)
  if (count > budget.maxNodes) throw new RangeError('Heroes III VID entries exceed maxNodes')
  range(bytes.byteLength, 4, count * VID_RECORD, 'VID entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = 4 + index * VID_RECORD
    let path = fixed(bytes, cursor, 40)
    if (!/\.[^/.]+$/u.test(path)) path += '.smk'
    const offset = u32(bytes, cursor + 40)
    const next = index + 1 < count ? u32(bytes, cursor + VID_RECORD + 40) : bytes.byteLength
    if (next < offset) throw new TypeError('Heroes III VID offsets are not ordered')
    range(bytes.byteLength, offset, next - offset, `VID entry ${index}`)
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(path),
        offset,
        storedSize: next - offset,
        decodedSize: next - offset,
        compression: 'stored',
      }),
    )
  }
  return Object.freeze({ kind: 'vid', version: 'H3', entries: Object.freeze(entries) })
}

function parseArchive(bytes, budget, kind) {
  if (kind === 'snd') return parseSnd(bytes, budget)
  if (kind === 'vid') return parseVid(bytes, budget)
  return parseLod(bytes, budget)
}

async function inflate(bytes, expected) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('Heroes III zlib extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  if (output.byteLength !== expected) throw new TypeError('Heroes III zlib output size is invalid')
  return output
}

async function extract(bytes, entry) {
  const payload = bytes.slice(entry.offset, entry.offset + entry.storedSize)
  return entry.compression === 'stored' ? payload : inflate(payload, entry.decodedSize)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('invalid Heroes III page limit')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid Heroes III cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          storedSize: BigInt(entry.storedSize),
          size: BigInt(entry.decodedSize),
          compression: entry.compression,
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
      if (!byId.has(entryId)) throw new TypeError(`unknown Heroes III entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `heroes3-entry:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'heroes3-lod', label: 'LOD/SND/VID (Heroes III)' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(prefix, uri) {
    const kind = extensionOf(uri)
    if (kind === 'lod') {
      const magic =
        prefix.byteLength >= 4 &&
        prefix[0] === 0x4c &&
        prefix[1] === 0x4f &&
        prefix[2] === 0x44 &&
        prefix[3] === 0
      return magic
        ? { confidence: 0.99, kind: 'magic', note: 'Heroes III LOD header' }
        : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
    }
    if (prefix.byteLength < 4) return { confidence: 0, kind: 'structure', note: 'truncated' }
    return {
      confidence: 0.78,
      kind: 'structure',
      note: `extension-routed Heroes III ${kind.toUpperCase()}`,
    }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget, extensionOf(context.source.ref.uri))
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const compressed = archive.entries.filter(entry => entry.compression !== 'stored').length
    return {
      summary: {
        format: 'heroes3-lod',
        resourceKind: archive.kind,
        version: archive.version,
        entries: archive.entries.length,
        compressed,
      },
      metadata: [
        {
          id: 'heroes3-lod',
          label: 'Heroes III resource archive',
          entries: [
            { key: 'resourceKind', value: archive.kind },
            { key: 'version', value: archive.version },
            { key: 'entries', value: archive.entries.length },
            { key: 'compressedEntries', value: compressed },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored', 'zlib'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Heroes III resources',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.decodedSize} bytes, ${entry.compression}`,
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
          if (entry === undefined) throw new TypeError('Heroes III entry id was not found')
          return { kind: 'bytes', value: await extract(bytes, entry) }
        },
      },
      maxDecodedBytes: archive.entries.reduce(
        (total, entry) => total + BigInt(entry.decodedSize),
        0n,
      ),
      unsupportedFeatures: ['archive-writing', 'archive-mutation', 'might-and-magic-lod-decoding'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
