// Hand-ported from org.modkitx/fla. Flash authoring projects are either ZIP containers holding
// DOMDocument.xml, loose XFL XML, or opaque legacy binary FLA files. This port inventories and
// extracts the two documented container forms without executing ActionScript or rendering them.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/fla'
const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800
const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('truncated FLA ZIP u16')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated FLA ZIP u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function isZip(bytes) {
  return bytes.byteLength >= 4 && u32(bytes, 0) === ZIP_LOCAL
}

function xflHeader(bytes) {
  const text = latin1
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)))
    .replace(/^\ufeff/u, '')
    .trimStart()
    .toLowerCase()
  return text.startsWith('<xfl') || text.startsWith('<domdocument') ||
    (text.startsWith('<?xml') && text.includes('<domdocument'))
}

function safePath(value) {
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (
    value.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe FLA project path: ${value}`)
  }
  const path = `${parts.join('/')}${normalized.endsWith('/') && parts.length > 0 ? '/' : ''}`
  if (path === '') throw new TypeError('FLA project entries must have non-empty paths')
  return path
}

function findEocd(bytes) {
  const first = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (u32(bytes, offset) === ZIP_EOCD) return offset
  }
  return -1
}

function parseZip(bytes, budget) {
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new TypeError('FLA ZIP end-of-central-directory record is missing')
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new TypeError('multi-disk FLA ZIP projects are unsupported')
  }
  const count = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  if (count > budget.maxNodes) throw new RangeError('FLA entry count exceeds maxNodes budget')
  if (centralOffset + centralSize > eocd) throw new TypeError('FLA ZIP central directory is truncated')
  const entries = []
  const names = new Set()
  let offset = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || u32(bytes, offset) !== ZIP_CENTRAL) {
      throw new TypeError(`invalid FLA ZIP central-directory entry ${index}`)
    }
    const flags = u16(bytes, offset + 8)
    const method = u16(bytes, offset + 10)
    const crc = u32(bytes, offset + 16)
    const compressedSize = u32(bytes, offset + 20)
    const size = u32(bytes, offset + 24)
    const nameLength = u16(bytes, offset + 28)
    const extraLength = u16(bytes, offset + 30)
    const commentLength = u16(bytes, offset + 32)
    const localOffset = u32(bytes, offset + 42)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > bytes.byteLength) throw new TypeError('FLA ZIP entry name is truncated')
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const path = safePath((flags & FLAG_UTF8) !== 0 ? utf8.decode(nameBytes) : latin1.decode(nameBytes))
    if (names.has(path)) throw new TypeError(`duplicate FLA project path: ${path}`)
    names.add(path)
    entries.push(Object.freeze({
      id: path,
      path,
      kind: path.endsWith('/') ? 'directory' : 'file',
      flags,
      method,
      crc,
      compressedSize,
      size,
      localOffset,
    }))
    offset = next
  }
  if (offset !== centralOffset + centralSize) {
    throw new TypeError('FLA ZIP central-directory size does not match its entries')
  }
  if (!entries.some(entry => entry.path.toLowerCase() === 'domdocument.xml')) {
    throw new TypeError('FLA ZIP project does not contain DOMDocument.xml')
  }
  return Object.freeze(entries)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
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

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function extractZipEntry(bytes, entry, budget) {
  if (entry.kind !== 'file') throw new TypeError('FLA directories have no byte payload')
  if ((entry.flags & FLAG_ENCRYPTED) !== 0) throw new TypeError('encrypted FLA entries are unsupported')
  if (entry.size > budget.maxScalarBytes) throw new RangeError('FLA entry exceeds maxScalarBytes budget')
  const offset = entry.localOffset
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== ZIP_LOCAL) {
    throw new TypeError('FLA ZIP local entry header is invalid')
  }
  const dataOffset = offset + 30 + u16(bytes, offset + 26) + u16(bytes, offset + 28)
  const end = dataOffset + entry.compressedSize
  if (end > bytes.byteLength) throw new TypeError('FLA ZIP entry data is truncated')
  const compressed = bytes.slice(dataOffset, end)
  const result = entry.method === 0
    ? compressed
    : entry.method === 8
      ? await inflateRaw(compressed)
      : (() => { throw new TypeError(`unsupported FLA ZIP compression method ${entry.method}`) })()
  if (result.byteLength !== entry.size) throw new TypeError('FLA ZIP entry size does not match metadata')
  if (crc32(result) !== entry.crc) throw new TypeError('FLA ZIP entry CRC-32 mismatch')
  return result
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('invalid FLA namespace page')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry => Object.freeze({
        id: entry.id,
        path: entry.path,
        name: entry.path.replace(/\/$/u, '').split('/').at(-1) ?? entry.path,
        kind: entry.kind,
        ...(entry.kind === 'file' ? { size: BigInt(entry.size) } : {}),
        revision: source.revision,
      }))
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length ? { nextCursor: String(start + items.length) } : {}),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const entry = byId.get(entryId)
      if (entry === undefined || entry.kind !== 'file') throw new TypeError('FLA file entry was not found')
      const path = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(Object.freeze({
        id: `${source.ref.id}!/${entry.path}`,
        uri: `fla-entry:${encodeURIComponent(source.ref.uri)}!/${path}`,
        parentIds: Object.freeze([source.ref.id]),
      }))
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'fla', label: 'Flash / Animate Project' }),
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
    if (xflHeader(prefix)) return { confidence: 0.98, kind: 'structure', note: 'xfl-domdocument' }
    if (isZip(prefix)) {
      const names = latin1.decode(prefix).toLowerCase()
      return names.includes('domdocument.xml')
        ? { confidence: 0.98, kind: 'structure', note: 'fla-zip-domdocument' }
        : { confidence: 0.7, kind: 'structure', note: 'zip-container-needs-directory' }
    }
    return { confidence: 0.2, kind: 'structure', note: 'opaque-legacy-fla' }
  },
  async inspect(bytes, context) {
    const kind = isZip(bytes) ? 'zip' : xflHeader(bytes) ? 'xfl' : 'opaque'
    const entries = kind === 'zip'
      ? parseZip(bytes, context.budget)
      : kind === 'xfl'
        ? Object.freeze([Object.freeze({ id: 'DOMDocument.xml', path: 'DOMDocument.xml', kind: 'file', size: bytes.byteLength, inline: bytes })])
        : Object.freeze([])
    const files = entries.filter(entry => entry.kind === 'file')
    const tree = createTreeDataSource({
      kind: 'archive',
      label: 'FLA project',
      preview: kind === 'opaque' ? 'opaque legacy authoring project' : `${kind.toUpperCase()}, ${files.length} file(s)`,
      children: entries.map(entry => ({
        kind: entry.kind,
        label: entry.path,
        preview: entry.kind === 'file' ? `${entry.size} bytes` : 'directory',
      })),
    })
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    return {
      summary: {
        format: 'fla',
        container: kind === 'zip' ? 'zip/fla' : kind,
        entries: entries.length,
        files: files.length,
        extractable: kind !== 'opaque',
      },
      metadata: [{
        id: 'fla-project',
        label: 'Flash / Animate project',
        entries: [
          { key: 'container', value: kind === 'zip' ? 'zip/fla' : kind },
          { key: 'entries', value: entries.length },
          { key: 'files', value: files.length },
          { key: 'extractable', value: kind !== 'opaque' },
        ],
      }],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        ...(kind === 'opaque' ? {} : { 'common.view/namespace-entry-source': namespaceSource(entries, context.source) }),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined || entry.kind !== 'file') throw new TypeError('FLA file entry was not found')
          const value = 'inline' in entry ? entry.inline.slice() : await extractZipEntry(bytes, entry, context.budget)
          return { kind: 'bytes', value }
        },
      },
      unsupportedFeatures: [
        'actionscript-execution',
        'authoring-project-rendering',
        'encrypted-zip-entries',
        'zip64',
        'project-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
