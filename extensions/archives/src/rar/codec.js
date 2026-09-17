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

const RAR5_SIGNATURE = Object.freeze([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
const utf8 = new TextDecoder('utf-8', { fatal: true })
const LONG_BLOCK = 0x8000
const FILE = Object.freeze({
  splitBefore: 0x01,
  splitAfter: 0x02,
  password: 0x04,
  solid: 0x10,
  directory: 0xe0,
  large: 0x100,
  unicode: 0x200,
})

function archiveError(code, message) {
  const error = new TypeError(`${code}: ${message}`)
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

function headerAt(bytes, offset) {
  if (offset + 7 > bytes.byteLength) throw new TypeError('RAR4 base header is truncated')
  const size = u16(bytes, offset + 5, 'header size')
  if (size < 7 || offset + size > bytes.byteLength)
    throw new TypeError('RAR4 header size is invalid')
  const expected = u16(bytes, offset, 'header CRC-16')
  const type = bytes[offset + 2] ?? 0
  // The file header CRC covers the whole header; old archives compute main/end CRCs the same way.
  const actual = crc32(bytes.subarray(offset + 2, offset + size)) & 0xffff
  if (actual !== expected) throw new TypeError('RAR4 header CRC-16 is invalid')
  const flags = u16(bytes, offset + 3, 'header flags')
  const addSize = flags & LONG_BLOCK && size >= 11 ? u32(bytes, offset + 7, 'block data size') : 0
  return Object.freeze({ offset, type, flags, size, end: offset + size, addSize })
}

function dosTimestamp(value) {
  const date = value >>> 16
  const time = value & 0xffff
  if (date === 0) return undefined
  const month = (date >> 5) & 0x0f
  const day = date & 0x1f
  if (month < 1 || month > 12 || day < 1) return undefined
  return Date.UTC(
    1980 + (date >> 9),
    month - 1,
    day,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  )
}

/** RAR 2.9+ Unicode names: `ascii NUL encoded-high-bytes` (unrar EncodeFileName::Decode). */
function decodeRarUnicode(raw) {
  const zero = raw.indexOf(0)
  if (zero < 0) return utf8.decode(raw)
  const name = raw.subarray(0, zero)
  const enc = raw.subarray(zero + 1)
  let encPos = 0
  const next = () => {
    if (encPos >= enc.byteLength) throw new TypeError('RAR4 Unicode name is truncated')
    return enc[encPos++]
  }
  const high = next()
  const out = []
  let flags = 0
  let flagBits = 0
  while (encPos < enc.byteLength) {
    if (flagBits === 0) {
      flags = next()
      flagBits = 8
    }
    flagBits -= 2
    switch ((flags >> flagBits) & 3) {
      case 0:
        out.push(next())
        break
      case 1:
        out.push(next() + (high << 8))
        break
      case 2:
        out.push(next() + (next() << 8))
        break
      default: {
        let length = next()
        if (length & 0x80) {
          const correction = next()
          for (length = (length & 0x7f) + 2; length > 0; length -= 1) {
            out.push((((name[out.length] ?? 0) + correction) & 0xff) + (high << 8))
          }
        } else {
          for (length += 2; length > 0; length -= 1) out.push(name[out.length] ?? 0)
        }
      }
    }
  }
  return String.fromCharCode(...out)
}

function parseRar(bytes, maxNodes, maximum) {
  if (RAR5_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw archiveError('archives/rar5-unsupported', 'RAR5 archives are not supported yet')
  }
  if (!matches(bytes) || bytes.byteLength < 20) throw new TypeError('RAR4 archive is invalid')
  let cursor = SIGNATURE.length
  const main = headerAt(bytes, cursor)
  if (main.type !== 0x73) throw new TypeError('RAR4 archive must begin with a main header')
  if (main.flags & 0x0080) {
    throw archiveError(
      'archives/password-required',
      'RAR4 headers are encrypted; a password is required',
    )
  }
  const archive = { volume: (main.flags & 0x0001) !== 0, solid: (main.flags & 0x0008) !== 0 }
  cursor = main.end
  const entries = []
  const paths = new Set()
  while (cursor < bytes.byteLength) {
    const header = headerAt(bytes, cursor)
    if (header.type === 0x7b) break
    if (header.type !== 0x74) {
      // Comments, recovery records, signatures and service blocks carry nothing we publish.
      cursor = header.end + header.addSize
      continue
    }
    if (entries.length >= maxNodes) throw new RangeError('RAR4 entry count exceeds maxNodes budget')
    const flags = header.flags
    const nameOffset = cursor + 32 + (flags & FILE.large ? 8 : 0)
    if (header.size < nameOffset - cursor) throw new TypeError('RAR4 file header is truncated')
    const high = offset =>
      flags & FILE.large ? u32(bytes, cursor + offset, 'large size') * 2 ** 32 : 0
    const packedSize = u32(bytes, cursor + 7, 'packed size') + high(32)
    const unpackedSize = u32(bytes, cursor + 11, 'unpacked size') + high(36)
    const fileCrc = u32(bytes, cursor + 16, 'file CRC-32')
    const method = bytes[cursor + 25] ?? 0
    const nameSize = u16(bytes, cursor + 26, 'file name size')
    if (nameOffset + nameSize > header.end) throw new TypeError('RAR4 file name is truncated')
    const raw = bytes.subarray(nameOffset, nameOffset + nameSize)
    const name = flags & FILE.unicode ? decodeRarUnicode(raw) : latin1.decode(raw)
    const directory = (flags & FILE.directory) === FILE.directory
    const path = safePath(name)
    const dataOffset = header.end
    const dataEnd = dataOffset + packedSize
    if (dataEnd > bytes.byteLength) throw new TypeError(`RAR4 entry ${path} data is truncated`)
    cursor = dataEnd
    if (flags & FILE.splitBefore) continue
    if (paths.has(path)) throw new TypeError(`RAR4 duplicate entry path: ${path}`)
    paths.add(path)
    let refusal
    if (flags & FILE.password)
      refusal = ['archives/password-required', 'is encrypted; a password is required']
    else if (flags & FILE.splitAfter)
      refusal = ['archives/rar-multivolume-unsupported', 'continues in another volume']
    else if (method !== 0x30)
      refusal = [
        'archives/rar-method-unsupported',
        `uses RAR compression method m${method - 0x30}, which is not supported yet`,
      ]
    else if (packedSize !== unpackedSize)
      throw new TypeError(`RAR4 stored entry ${path} sizes disagree`)
    if (!directory && unpackedSize > maximum && refusal === undefined) {
      throw new RangeError('RAR4 entry exceeds maxScalarBytes budget')
    }
    entries.push(
      Object.freeze({
        id: `file-${entries.length}`,
        path,
        kind: directory ? 'directory' : 'file',
        size: directory ? 0 : unpackedSize,
        packedSize,
        dataOffset,
        fileCrc,
        method: method === 0x30 ? 'stored' : `rar-m${method - 0x30}`,
        encrypted: (flags & FILE.password) !== 0,
        modifiedAt: dosTimestamp(u32(bytes, header.offset + 20, 'file time')),
        attributes: u32(bytes, header.offset + 28, 'file attributes'),
        refusal:
          refusal === undefined
            ? undefined
            : { code: refusal[0], message: `RAR4 entry ${path} ${refusal[1]}` },
      }),
    )
  }
  return Object.freeze({ ...archive, entries: Object.freeze(entries) })
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
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? {
                size: BigInt(entry.size),
                storedSize: BigInt(entry.packedSize),
                compression: entry.method,
                checksum: {
                  algorithm: 'crc-32',
                  value: entry.fileCrc.toString(16).padStart(8, '0'),
                },
              }
            : {}),
          ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
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
        throw new TypeError('unknown RAR4 file entry')
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
    label: 'RAR archive',
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
    const rar5 = RAR5_SIGNATURE.every((value, index) => prefix[index] === value)
    return matches(prefix) || rar5
      ? { confidence: 0.99, kind: 'magic', note: rar5 ? 'rar5-signature' : 'rar4-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    let archive
    try {
      archive = parseRar(bytes, context.budget.maxNodes, context.budget.maxScalarBytes)
    } catch (error) {
      if (error?.code === undefined) throw error
      return refusedInspection(bytes, error)
    }
    const { entries } = archive
    const files = entries.filter(entry => entry.kind === 'file')
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const totalBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    const methods = [...new Set(files.map(entry => entry.method))]
    const refusals = new Map()
    for (const entry of entries) {
      if (entry.refusal !== undefined && !refusals.has(entry.refusal.code)) {
        refusals.set(entry.refusal.code, entry.refusal.message)
      }
    }
    return {
      summary: {
        format: 'rar4',
        entries: entries.length,
        files: files.length,
        methods,
        solid: archive.solid,
        payloadBytes: totalBytes.toString(10),
      },
      metadata: [
        {
          id: 'rar4-archive',
          label: 'RAR4 archive',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'payloadBytes', value: totalBytes.toString(10) },
            { key: 'methods', value: methods.join(', ') || 'none' },
            { key: 'solid', value: archive.solid },
            { key: 'volume', value: archive.volume },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      diagnostics: [...refusals].map(([code, message]) => ({
        id: `rar-${code.split('/').at(-1)}`,
        category: 'fidelity',
        severity: 'error',
        code,
        message,
      })),
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'RAR4',
          preview: `${files.length} files, ${totalBytes.toString(10)} bytes`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview:
              entry.kind === 'file'
                ? `${entry.size} bytes, ${entry.method}, CRC ${entry.fileCrc.toString(16).padStart(8, '0')}`
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
          if (entry === undefined || entry.kind !== 'file') {
            throw new TypeError('RAR4 file entry was not found')
          }
          if (entry.refusal !== undefined)
            throw archiveError(entry.refusal.code, entry.refusal.message)
          const value = bytes.slice(entry.dataOffset, entry.dataOffset + entry.size)
          if (crc32(value) !== entry.fileCrc)
            throw new TypeError(`RAR4 entry ${entry.path} CRC-32 is invalid`)
          return { kind: 'bytes', value }
        },
      },
      maxDecodedBytes: totalBytes,
      unsupportedFeatures: [
        'rar5',
        'rar-compression',
        'rar-decryption',
        'multivolume-archives',
        'rar-writing',
        'archive-mutation',
      ],
    }
  },
})

/** An archive we recognise but cannot list (RAR5, encrypted headers): open it with a reason. */
function refusedInspection(bytes, error) {
  return {
    summary: { format: 'rar', entries: 0, refused: error.code },
    metadata: [
      { id: 'rar-archive', label: 'RAR archive', entries: [{ key: 'refused', value: error.code }] },
    ],
    traits: [
      { id: 'container.entries', parameters: { count: 0 } },
      { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
    ],
    diagnostics: [
      {
        id: `rar-${error.code.split('/').at(-1)}`,
        category: 'fidelity',
        severity: 'error',
        code: error.code,
        message: error.message,
      },
    ],
    dataSources: {
      'common.view/tree-data-source': createTreeDataSource({
        kind: 'archive',
        label: 'RAR',
        preview: error.message,
        children: [],
      }),
    },
    handlers: {
      'extract-entry': async () => {
        throw error
      },
    },
    unsupportedFeatures: ['rar5', 'rar-decryption'],
  }
}

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
