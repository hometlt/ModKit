import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/7z'
const SIGNATURE = Object.freeze([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
const utf16 = new TextDecoder('utf-16le', { fatal: true })

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

const matches = bytes => SIGNATURE.every((value, index) => bytes[index] === value)

function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(`7z ${label} exceeds safe integers`)
  return Number(value)
}

function u32(bytes, offset, label) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError(`7z ${label} is truncated`)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function u64(bytes, offset, label) {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new TypeError(`7z ${label} is truncated`)
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return safeNumber(value, label)
}

class Reader {
  constructor(bytes, start, end, label) {
    this.bytes = bytes
    this.cursor = start
    this.end = end
    this.label = label
  }

  readByte(label) {
    if (this.cursor >= this.end) throw new TypeError(`7z ${label} is truncated`)
    const value = this.bytes[this.cursor] ?? 0
    this.cursor += 1
    return value
  }

  expect(value, label) {
    if (this.readByte(label) !== value) throw new TypeError(`7z ${label} is unsupported or invalid`)
  }

  readUint32(label) {
    if (this.cursor + 4 > this.end) throw new TypeError(`7z ${label} is truncated`)
    const value = u32(this.bytes, this.cursor, label)
    this.cursor += 4
    return value
  }

  readNumber(label) {
    const first = this.readByte(label)
    let mask = 0x80
    let value = 0n
    for (let index = 0; index < 8; index += 1) {
      if ((first & mask) === 0) {
        value |= BigInt(first & (mask - 1)) << BigInt(index * 8)
        return safeNumber(value, label)
      }
      value |= BigInt(this.readByte(label)) << BigInt(index * 8)
      mask >>>= 1
    }
    return safeNumber(value, label)
  }

  subReader(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || this.cursor + length > this.end) {
      throw new TypeError(`7z ${label} range is invalid`)
    }
    const child = new Reader(this.bytes, this.cursor, this.cursor + length, label)
    this.cursor += length
    return child
  }

  done(label = this.label) {
    if (this.cursor !== this.end) throw new TypeError(`7z ${label} contains trailing data`)
  }
}

function safePath(name) {
  const normalized = name.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (
    normalized === '' ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.length === 0 ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe 7z entry path: ${name}`)
  }
  return parts.join('/')
}

function parseFilesInfo(reader) {
  reader.expect(0x05, 'FilesInfo marker')
  if (reader.readNumber('file count') !== 1) {
    throw new TypeError('7z archive must contain exactly one regular file')
  }
  let path
  let attributes
  while (true) {
    const property = reader.readByte('FilesInfo property')
    if (property === 0) break
    const size = reader.readNumber('FilesInfo property size')
    const data = reader.subReader(size, 'FilesInfo property')
    if (property === 0x11) {
      if (path !== undefined) throw new TypeError('7z duplicate Name property is invalid')
      data.expect(0, 'external Name flag')
      const length = data.end - data.cursor
      if (length < 2 || length % 2 !== 0) throw new TypeError('7z UTF-16LE name is invalid')
      if (data.bytes[data.end - 2] !== 0 || data.bytes[data.end - 1] !== 0) {
        throw new TypeError('7z file name is not NUL-terminated')
      }
      path = safePath(utf16.decode(data.bytes.subarray(data.cursor, data.end - 2)))
      data.cursor = data.end
    } else if (property === 0x15) {
      data.expect(1, 'attribute defined vector')
      data.expect(0, 'external attribute flag')
      attributes = data.readUint32('file attributes')
    } else {
      throw new TypeError(`7z FilesInfo property 0x${property.toString(16)} is unsupported`)
    }
    data.done()
  }
  if (path === undefined) throw new TypeError('7z file name is missing')
  return Object.freeze({ path, attributes })
}

function parseNextHeader(bytes, start, end, expectedPackSize, maximum) {
  const reader = new Reader(bytes, start, end, 'next header')
  reader.expect(0x01, 'Header marker')
  reader.expect(0x04, 'MainStreamsInfo marker')
  reader.expect(0x06, 'PackInfo marker')
  if (reader.readNumber('pack position') !== 0)
    throw new TypeError('7z nonzero pack position is unsupported')
  if (reader.readNumber('pack stream count') !== 1) {
    throw new TypeError('7z archive must contain exactly one pack stream')
  }
  reader.expect(0x09, 'pack Size marker')
  const packedSize = reader.readNumber('packed size')
  if (packedSize !== expectedPackSize)
    throw new TypeError('7z packed size disagrees with the start header')
  reader.expect(0, 'PackInfo end marker')

  reader.expect(0x07, 'UnpackInfo marker')
  reader.expect(0x0b, 'Folder marker')
  if (reader.readNumber('folder count') !== 1)
    throw new TypeError('7z archive must contain one folder')
  reader.expect(0, 'external Folder flag')
  if (reader.readNumber('coder count') !== 1)
    throw new TypeError('7z archive must contain one coder')
  reader.expect(1, 'Copy coder flags')
  reader.expect(0, 'Copy method id')
  reader.expect(0x0c, 'CodersUnpackSize marker')
  const unpackedSize = reader.readNumber('unpacked size')
  if (unpackedSize !== packedSize) throw new TypeError('7z Copy sizes do not match')
  if (unpackedSize > maximum) throw new RangeError('7z entry exceeds maxScalarBytes budget')
  reader.expect(0, 'UnpackInfo end marker')

  reader.expect(0x08, 'SubStreamsInfo marker')
  reader.expect(0x0a, 'substream CRC marker')
  reader.expect(1, 'substream CRC defined vector')
  const payloadCrc = reader.readUint32('substream CRC-32')
  reader.expect(0, 'SubStreamsInfo end marker')
  reader.expect(0, 'MainStreamsInfo end marker')
  const file = parseFilesInfo(reader)
  reader.expect(0, 'Header end marker')
  reader.done()
  return Object.freeze({ packedSize, unpackedSize, payloadCrc, ...file })
}

function parse7z(bytes, budget) {
  if (!matches(bytes) || bytes.byteLength < 32)
    throw new TypeError('7z signature header is invalid')
  const major = bytes[6] ?? 0
  const minor = bytes[7] ?? 0
  if (major !== 0 || minor > 4) throw new TypeError(`7z version ${major}.${minor} is unsupported`)
  if (crc32(bytes.subarray(12, 32)) !== u32(bytes, 8, 'start header CRC-32')) {
    throw new TypeError('7z start header CRC-32 is invalid')
  }
  const nextOffset = u64(bytes, 12, 'next header offset')
  const nextSize = u64(bytes, 20, 'next header size')
  const nextStart = 32 + nextOffset
  const nextEnd = nextStart + nextSize
  if (!Number.isSafeInteger(nextEnd) || nextStart < 32 || nextEnd !== bytes.byteLength) {
    throw new TypeError('7z next header range is invalid')
  }
  if (crc32(bytes.subarray(nextStart, nextEnd)) !== u32(bytes, 28, 'next header CRC-32')) {
    throw new TypeError('7z next header CRC-32 is invalid')
  }
  if (budget.maxNodes < 1) throw new RangeError('7z entry count exceeds maxNodes budget')
  const archive = parseNextHeader(bytes, nextStart, nextEnd, nextOffset, budget.maxScalarBytes)
  if (crc32(bytes.subarray(32, nextStart)) !== archive.payloadCrc) {
    throw new TypeError(`7z entry ${archive.path} CRC-32 is invalid`)
  }
  return Object.freeze({ major, minor, dataOffset: 32, ...archive })
}

function namespaceSource(archive, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('7z namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid 7z page cursor')
      const items =
        archive.path.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'file-0',
                path: archive.path,
                name: archive.path.split('/').at(-1),
                kind: 'file',
                size: BigInt(archive.unpackedSize),
                storedSize: BigInt(archive.packedSize),
                compression: 'copy',
                checksum: {
                  algorithm: 'crc-32',
                  value: archive.payloadCrc.toString(16).padStart(8, '0'),
                },
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'file-0') throw new TypeError('unknown 7z file entry')
      const encoded = archive.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${archive.path}`,
          uri: `7z-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: '7z',
    label: '7-Zip archive',
    mediaType: 'application/x-7z-compressed',
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
      ? { confidence: 0.99, kind: 'magic', note: '7z-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parse7z(bytes, context.budget)
    return {
      summary: {
        format: '7z',
        version: `${archive.major}.${archive.minor}`,
        entries: 1,
        method: 'Copy',
        payloadBytes: archive.unpackedSize,
      },
      metadata: [
        {
          id: '7z-archive',
          label: '7-Zip archive',
          entries: [
            { key: 'version', value: `${archive.major}.${archive.minor}` },
            { key: 'files', value: 1 },
            { key: 'method', value: 'Copy' },
            { key: 'payloadBytes', value: archive.unpackedSize },
            { key: 'fileAttributes', value: archive.attributes ?? 'not-declared' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['copy'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: '7-Zip',
          preview: `1 Copy file, ${archive.unpackedSize} bytes`,
          children: [
            { kind: 'file', label: archive.path, preview: `${archive.unpackedSize} stored bytes` },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(archive, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (
            input === null ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            input.entryId !== 'file-0'
          ) {
            throw new TypeError('container.extract requires {entryId:"file-0"}')
          }
          return {
            kind: 'bytes',
            value: bytes.slice(archive.dataOffset, archive.dataOffset + archive.unpackedSize),
          }
        },
      },
      maxDecodedBytes: BigInt(archive.unpackedSize),
      unsupportedFeatures: [
        '7z-compression-and-encryption-coders',
        'encoded-headers-and-multiple-folders-or-files',
        'solid-multivolume-and-anti-items',
        '7z-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
