import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/zip'
const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const FLAG_ENCRYPTED = 0x0001
const FLAG_DESCRIPTOR = 0x0008
const FLAG_UTF8_NAMES = 0x0800
const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('ZIP u16 is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('ZIP u32 is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

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

const matches = bytes => {
  if (bytes.byteLength < 4) return false
  const signature = u32(bytes, 0)
  return signature === ZIP_LOCAL || signature === ZIP_EOCD
}

function compressionName(method) {
  if (method === 0) return 'stored'
  if (method === 8) return 'deflate'
  if (method === 9) return 'deflate64'
  if (method === 12) return 'bzip2'
  if (method === 14) return 'lzma'
  if (method === 93) return 'zstd'
  if (method === 95) return 'xz'
  return `method ${method}`
}

function dosTimestamp(date, time) {
  if (date === 0) return undefined
  const year = 1980 + ((date >>> 9) & 0x7f)
  const month = (date >>> 5) & 0x0f
  const day = date & 0x1f
  const hour = (time >>> 11) & 0x1f
  const minute = (time >>> 5) & 0x3f
  const second = (time & 0x1f) * 2
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return undefined
  }
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

function safePath(value) {
  const normalized = value.replaceAll('\\', '/')
  const directory = normalized.endsWith('/')
  const parts = normalized.split('/').filter(Boolean)
  if (
    value.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.length === 0 ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe ZIP entry path: ${value}`)
  }
  return `${parts.join('/')}${directory ? '/' : ''}`
}

function findEocd(bytes) {
  if (bytes.byteLength < 22) return -1
  const first = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (u32(bytes, offset) !== ZIP_EOCD) continue
    if (offset + 22 + u16(bytes, offset + 20) === bytes.byteLength) return offset
  }
  return -1
}

function parseZip(bytes, maxNodes) {
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new TypeError('ZIP end-of-central-directory record is missing')
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new TypeError('multi-disk ZIP archives are unsupported')
  }
  const diskCount = u16(bytes, eocd + 8)
  const count = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  if (diskCount !== count) throw new TypeError('ZIP entry counts disagree')
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TypeError('ZIP64 requires a dedicated codec profile')
  }
  if (count === 0) throw new TypeError('ZIP archive exposes no entries')
  if (count > maxNodes) throw new RangeError('ZIP entry count exceeds maxNodes budget')
  if (centralOffset + centralSize !== eocd) {
    throw new TypeError('ZIP central directory range is invalid')
  }
  const entries = []
  const paths = new Set()
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || u32(bytes, cursor) !== ZIP_CENTRAL) {
      throw new TypeError(`ZIP central-directory entry ${index} is invalid`)
    }
    const flags = u16(bytes, cursor + 8)
    const method = u16(bytes, cursor + 10)
    const dosTime = u16(bytes, cursor + 12)
    const dosDate = u16(bytes, cursor + 14)
    const crc = u32(bytes, cursor + 16)
    const compressedSize = u32(bytes, cursor + 20)
    const size = u32(bytes, cursor + 24)
    const nameLength = u16(bytes, cursor + 28)
    const extraLength = u16(bytes, cursor + 30)
    const commentLength = u16(bytes, cursor + 32)
    const localOffset = u32(bytes, cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > eocd) throw new TypeError('ZIP central-directory entry fields are truncated')
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const path = safePath(
      (flags & FLAG_UTF8_NAMES) !== 0 ? utf8.decode(nameBytes) : latin1.decode(nameBytes),
    )
    if (paths.has(path)) throw new TypeError(`ZIP repeats entry path ${path}`)
    paths.add(path)
    entries.push(
      Object.freeze({
        id: `entry-${index}`,
        path,
        kind: path.endsWith('/') ? 'directory' : 'file',
        flags,
        method,
        dosTime,
        dosDate,
        crc,
        compressedSize,
        size,
        localOffset,
        directoryOffset: centralOffset,
      }),
    )
    cursor = next
  }
  if (cursor !== eocd) throw new TypeError('ZIP central-directory size does not match its entries')
  return Object.freeze(entries)
}

async function inflateRaw(bytes, expectedSize, maximum) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('ZIP deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > expectedSize || total > maximum) {
      await reader.cancel('ZIP decoded output exceeded its declared size')
      throw new RangeError('ZIP decoded output exceeds its declared size or budget')
    }
    chunks.push(result.value)
  }
  const decoded = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    decoded.set(chunk, offset)
    offset += chunk.byteLength
  }
  return decoded
}

async function extract(bytes, entry, maximum) {
  if (entry.kind !== 'file') throw new TypeError('ZIP directories have no byte payload')
  if ((entry.flags & FLAG_ENCRYPTED) !== 0)
    throw new TypeError('encrypted ZIP entries are unsupported')
  if (entry.size > maximum) throw new RangeError('ZIP entry exceeds maxScalarBytes budget')
  const offset = entry.localOffset
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== ZIP_LOCAL) {
    throw new TypeError('ZIP local entry header is invalid')
  }
  if (u16(bytes, offset + 6) !== entry.flags || u16(bytes, offset + 8) !== entry.method) {
    throw new TypeError('ZIP local entry header disagrees with the central directory')
  }
  const localNameLength = u16(bytes, offset + 26)
  const localExtraLength = u16(bytes, offset + 28)
  const dataOffset = offset + 30 + localNameLength + localExtraLength
  const end = dataOffset + entry.compressedSize
  if (end > entry.directoryOffset) throw new TypeError('ZIP entry payload overlaps the directory')
  const localNameBytes = bytes.subarray(offset + 30, offset + 30 + localNameLength)
  const localPath = safePath(
    (entry.flags & FLAG_UTF8_NAMES) !== 0
      ? utf8.decode(localNameBytes)
      : latin1.decode(localNameBytes),
  )
  if (localPath !== entry.path)
    throw new TypeError('ZIP local entry path disagrees with the directory')
  if (
    (entry.flags & FLAG_DESCRIPTOR) === 0 &&
    (u32(bytes, offset + 14) !== entry.crc ||
      u32(bytes, offset + 18) !== entry.compressedSize ||
      u32(bytes, offset + 22) !== entry.size)
  ) {
    throw new TypeError('ZIP local entry sizes or CRC disagree with the directory')
  }
  const compressed = bytes.subarray(dataOffset, end)
  const decoded =
    entry.method === 0
      ? bytes.slice(dataOffset, end)
      : entry.method === 8
        ? await inflateRaw(compressed, entry.size, maximum)
        : (() => {
            throw new TypeError(`unsupported ZIP compression method ${entry.method}`)
          })()
  if (decoded.byteLength !== entry.size)
    throw new TypeError('ZIP entry size does not match metadata')
  if (crc32(decoded) !== entry.crc) throw new TypeError('ZIP entry CRC-32 is invalid')
  return decoded
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('ZIP namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid ZIP page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.replace(/\/$/u, '').split('/').at(-1),
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? {
                size: BigInt(entry.size),
                storedSize: BigInt(entry.compressedSize),
                compression: compressionName(entry.method),
                checksum: {
                  algorithm: 'crc-32',
                  value: entry.crc.toString(16).padStart(8, '0'),
                },
              }
            : {}),
          ...(dosTimestamp(entry.dosDate, entry.dosTime) === undefined
            ? {}
            : { modifiedAt: dosTimestamp(entry.dosDate, entry.dosTime) }),
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
      if (entry === undefined || entry.kind !== 'file')
        throw new TypeError('ZIP entry is not a file')
      const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `zip-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'zip', label: 'ZIP archive', mediaType: 'application/zip' }),
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
      ? { confidence: 0.99, kind: 'magic', note: 'zip-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const entries = parseZip(bytes, context.budget.maxNodes)
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const files = entries.filter(entry => entry.kind === 'file')
    const decodedBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    const methods = [...new Set(files.map(entry => compressionName(entry.method)))]
    return {
      summary: {
        format: 'zip',
        entries: entries.length,
        files: files.length,
        directories: entries.length - files.length,
        decodedBytes: decodedBytes.toString(10),
      },
      metadata: [
        {
          id: 'zip-directory',
          label: 'ZIP central directory',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'files', value: files.length },
            { key: 'directories', value: entries.length - files.length },
            { key: 'compressionMethods', value: methods },
            { key: 'decodedBytes', value: decodedBytes.toString(10) },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: entries.length - files.length } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'ZIP',
          preview: `${files.length} files, ${entries.length - files.length} directories`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview:
              entry.kind === 'file'
                ? `${entry.compressedSize} stored / ${entry.size} decoded bytes, ${compressionName(entry.method)}`
                : 'directory',
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
          if (entry === undefined || entry.kind !== 'file')
            throw new TypeError('ZIP file entry was not found')
          return {
            kind: 'bytes',
            value: await extract(bytes, entry, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: decodedBytes,
      unsupportedFeatures: [
        'zip64-and-multidisk',
        'encrypted-entries',
        'compression-methods-other-than-store-or-deflate',
        'zip-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
