import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/rar'
const SIGNATURE = Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
const latin1 = new TextDecoder('latin1')

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

function u16(bytes, offset, label) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new TypeError(`RAR4 ${label} is truncated`)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset, label) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError(`RAR4 ${label} is truncated`)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

const matches = bytes => SIGNATURE.every((value, index) => bytes[index] === value)

function safePath(name) {
  const normalized = name.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.length === 0 ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe RAR4 entry path: ${name}`)
  }
  return parts.join('/')
}

function headerAt(bytes, offset) {
  if (offset + 7 > bytes.byteLength) throw new TypeError('RAR4 base header is truncated')
  const size = u16(bytes, offset + 5, 'header size')
  if (size < 7 || offset + size > bytes.byteLength)
    throw new TypeError('RAR4 header size is invalid')
  const expected = u16(bytes, offset, 'header CRC-16')
  const actual = crc32(bytes.subarray(offset + 2, offset + size)) & 0xffff
  if (actual !== expected) throw new TypeError('RAR4 header CRC-16 is invalid')
  return Object.freeze({
    offset,
    type: bytes[offset + 2] ?? 0,
    flags: u16(bytes, offset + 3, 'header flags'),
    size,
    end: offset + size,
  })
}

function parseRar(bytes, maxNodes, maximum) {
  if (!matches(bytes) || bytes.byteLength < 27) throw new TypeError('RAR4 archive is invalid')
  let cursor = SIGNATURE.length
  const main = headerAt(bytes, cursor)
  if (main.type !== 0x73 || main.size !== 13 || main.flags !== 0) {
    throw new TypeError('RAR4 archive must begin with a plain non-volume main header')
  }
  cursor = main.end
  const entries = []
  const paths = new Set()
  let ended = false
  while (cursor < bytes.byteLength) {
    const header = headerAt(bytes, cursor)
    if (header.type === 0x7b) {
      if (header.size !== 7 || (header.flags !== 0 && header.flags !== 0x4000)) {
        throw new TypeError('RAR4 end-of-archive header is outside the supported subset')
      }
      cursor = header.end
      ended = true
      break
    }
    if (header.type !== 0x74) {
      throw new TypeError(`RAR4 header type 0x${header.type.toString(16)} is unsupported`)
    }
    if (entries.length >= maxNodes) throw new RangeError('RAR4 entry count exceeds maxNodes budget')
    if ((header.flags & 0x00e0) === 0x00e0) {
      throw new TypeError('RAR4 directory entries are outside the supported subset')
    }
    if (header.flags !== 0x8000) {
      throw new TypeError(
        'RAR4 split, encrypted, solid, Unicode, large, or extended files are unsupported',
      )
    }
    if (header.size < 32) throw new TypeError('RAR4 file header is truncated')
    const packedSize = u32(bytes, cursor + 7, 'packed size')
    const unpackedSize = u32(bytes, cursor + 11, 'unpacked size')
    const hostOs = bytes[cursor + 15] ?? 0
    const fileCrc = u32(bytes, cursor + 16, 'file CRC-32')
    const modifiedDos = u32(bytes, cursor + 20, 'file time')
    const unpackVersion = bytes[cursor + 24] ?? 0
    const method = bytes[cursor + 25] ?? 0
    const nameSize = u16(bytes, cursor + 26, 'file name size')
    const attributes = u32(bytes, cursor + 28, 'file attributes')
    if (method !== 0x30 || packedSize !== unpackedSize) {
      throw new TypeError('RAR4 compressed file entries are outside the supported subset')
    }
    if (unpackedSize > maximum) throw new RangeError('RAR4 entry exceeds maxScalarBytes budget')
    if (header.size !== 32 + nameSize) {
      throw new TypeError('RAR4 file header contains unsupported optional fields')
    }
    const path = safePath(latin1.decode(bytes.subarray(cursor + 32, header.end)))
    if (paths.has(path)) throw new TypeError(`RAR4 duplicate entry path: ${path}`)
    paths.add(path)
    const dataOffset = header.end
    const dataEnd = dataOffset + packedSize
    if (dataEnd > bytes.byteLength) throw new TypeError(`RAR4 entry ${path} data is truncated`)
    if (crc32(bytes.subarray(dataOffset, dataEnd)) !== fileCrc) {
      throw new TypeError(`RAR4 entry ${path} CRC-32 is invalid`)
    }
    entries.push(
      Object.freeze({
        id: `file-${entries.length}`,
        path,
        size: unpackedSize,
        dataOffset,
        fileCrc,
        hostOs,
        modifiedDos,
        unpackVersion,
        attributes,
      }),
    )
    cursor = dataEnd
  }
  if (!ended) throw new TypeError('RAR4 end-of-archive header is missing')
  if (cursor !== bytes.byteLength)
    throw new TypeError('RAR4 data after the end header is unsupported')
  if (entries.length === 0) throw new TypeError('RAR4 archive exposes no stored files')
  return Object.freeze(entries)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('RAR4 namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid RAR4 page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1),
          kind: 'file',
          size: BigInt(entry.size),
          storedSize: BigInt(entry.size),
          compression: 'stored',
          checksum: {
            algorithm: 'crc-32',
            value: entry.fileCrc.toString(16).padStart(8, '0'),
          },
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
      const entry = byId.get(entryId)
      if (entry === undefined) throw new TypeError('unknown RAR4 file entry')
      const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `rar4-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'rar',
    label: 'RAR4 stored archive',
    mediaType: 'application/vnd.rar',
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
      ? { confidence: 0.99, kind: 'magic', note: 'rar4-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const entries = parseRar(bytes, context.budget.maxNodes, context.budget.maxScalarBytes)
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const totalBytes = entries.reduce((total, entry) => total + BigInt(entry.size), 0n)
    return {
      summary: {
        format: 'rar4',
        entries: entries.length,
        storedFiles: entries.length,
        payloadBytes: totalBytes.toString(10),
      },
      metadata: [
        {
          id: 'rar4-archive',
          label: 'RAR4 stored archive',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'payloadBytes', value: totalBytes.toString(10) },
            { key: 'compressionMethod', value: 'stored' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'RAR4',
          preview: `${entries.length} stored files, ${totalBytes.toString(10)} bytes`,
          children: entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes, CRC ${entry.fileCrc.toString(16).padStart(8, '0')}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('RAR4 file entry was not found')
          return {
            kind: 'bytes',
            value: bytes.slice(entry.dataOffset, entry.dataOffset + entry.size),
          }
        },
      },
      maxDecodedBytes: totalBytes,
      unsupportedFeatures: [
        'rar5',
        'rar-compression',
        'encrypted-solid-split-and-multivolume-archives',
        'directories-and-extended-file-headers',
        'rar-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
