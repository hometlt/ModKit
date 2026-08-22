// Hand-ported Total Annihilation HPI-family reader. This keeps the MK2 classic HAPI cipher,
// recursive directory, stored/LZ77/zlib extraction, and compact regression layout browser-safe.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ta-hpi'
const CLASSIC_VERSION = 0x00010000
const HEADER_BYTES = 12
const COMPACT_RECORD_BYTES = 24
const METHOD_STORE = 0
const METHOD_LZ77 = 1
const METHOD_ZLIB = 2
const CHUNK_MAGIC = 0x48535153
const CHUNK_HEADER_BYTES = 19
const CHUNK_BYTES = 65536

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function checkedRange(total, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > total ||
    length > total - offset
  ) {
    throw new RangeError(`HPI ${label} is outside the archive`)
  }
}

function u16le(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 2, '16-bit field')
  return view(bytes).getUint16(offset, true)
}

function u32le(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 4, '32-bit field')
  return view(bytes).getUint32(offset, true)
}

function ascii(bytes, offset, length) {
  checkedRange(bytes.byteLength, offset, length, 'ASCII field')
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function checkedSlice(bytes, offset, length, label) {
  checkedRange(bytes.byteLength, offset, length, label)
  return bytes.slice(offset, offset + length)
}

function safePath(raw, label) {
  const value = raw.replaceAll('\\', '/')
  const parts = value.split('/')
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || parts.some(part => part === '..')) {
    throw new TypeError(`HPI ${label} has an unsafe path`)
  }
  const clean = parts.filter(part => part.length > 0 && part !== '.').join('/')
  if (clean.length === 0) throw new TypeError(`HPI ${label} has an empty path`)
  return clean
}

function cString(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 1, 'string')
  let end = offset
  while (end < bytes.byteLength && bytes[end] !== 0) end += 1
  if (end >= bytes.byteLength) throw new TypeError(`HPI string at ${offset} is not terminated`)
  return new TextDecoder().decode(bytes.subarray(offset, end))
}

function methodName(method) {
  if (method === METHOD_STORE) return 'stored'
  if (method === METHOD_LZ77) return 'lz77'
  if (method === METHOD_ZLIB) return 'zlib'
  return `unknown-${method}`
}

function parseCompact(bytes, budget) {
  const version = u32le(bytes, 4)
  const count = u32le(bytes, 8)
  if (version > 1) throw new TypeError(`unsupported compact HPI version ${version}`)
  if (count > budget.maxNodes) throw new RangeError('HPI entries exceed maxNodes')
  checkedRange(bytes.byteLength, HEADER_BYTES, count * COMPACT_RECORD_BYTES, 'entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = HEADER_BYTES + index * COMPACT_RECORD_BYTES
    const nameOffset = u32le(bytes, cursor)
    const nameLength = u16le(bytes, cursor + 4)
    const compressionMethod = u16le(bytes, cursor + 6)
    const offset = u32le(bytes, cursor + 8)
    const compressedSize = u32le(bytes, cursor + 12)
    const uncompressedSize = u32le(bytes, cursor + 16)
    const checksum = u32le(bytes, cursor + 20)
    checkedRange(bytes.byteLength, nameOffset, nameLength, `entry ${index} name`)
    checkedRange(bytes.byteLength, offset, compressedSize, `entry ${index} payload`)
    if (uncompressedSize > budget.maxScalarBytes) {
      throw new RangeError(`HPI entry ${index} exceeds maxScalarBytes`)
    }
    const rawName = new TextDecoder()
      .decode(bytes.subarray(nameOffset, nameOffset + nameLength))
      .replace(/\0+$/gu, '')
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(rawName, `entry ${index}`),
        offset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        checksum,
        classic: false,
      }),
    )
  }
  return Object.freeze({
    layout: 'compact',
    version,
    directoryOffset: HEADER_BYTES,
    directorySize: count * COMPACT_RECORD_BYTES,
    entries: Object.freeze(entries),
  })
}

function directoryRecord(directory, offset) {
  checkedRange(directory.byteLength, offset, 8, 'directory record')
  return Object.freeze({
    count: u32le(directory, offset),
    entryListOffset: u32le(directory, offset + 4),
  })
}

function collectClassic(archiveSize, directory, record, parent, out, visiting, budget, depth) {
  if (depth > budget.maxDepth) throw new RangeError('HPI directory tree exceeds maxDepth')
  if (record.count > budget.maxNodes - out.length)
    throw new RangeError('HPI entries exceed maxNodes')
  checkedRange(
    directory.byteLength,
    record.entryListOffset,
    record.count * 9,
    'directory entry list',
  )
  if (visiting.has(record.entryListOffset)) throw new TypeError('HPI directory cycle')
  visiting.add(record.entryListOffset)
  for (let index = 0; index < record.count; index += 1) {
    const cursor = record.entryListOffset + index * 9
    const nameOffset = u32le(directory, cursor)
    const dataOffset = u32le(directory, cursor + 4)
    const isDirectory = directory[cursor + 8] !== 0
    const name = cString(directory, nameOffset)
    const path = safePath(parent.length === 0 ? name : `${parent}/${name}`, `entry ${index}`)
    if (isDirectory) {
      collectClassic(
        archiveSize,
        directory,
        directoryRecord(directory, dataOffset),
        path,
        out,
        visiting,
        budget,
        depth + 1,
      )
      continue
    }
    checkedRange(directory.byteLength, dataOffset, 9, `file record ${path}`)
    const offset = u32le(directory, dataOffset)
    const uncompressedSize = u32le(directory, dataOffset + 4)
    const compressionMethod = directory[dataOffset + 8] ?? 0
    checkedRange(archiveSize, offset, 0, `payload ${path}`)
    if (uncompressedSize > budget.maxScalarBytes) {
      throw new RangeError(`HPI entry ${path} exceeds maxScalarBytes`)
    }
    if (out.length >= budget.maxNodes) throw new RangeError('HPI entries exceed maxNodes')
    out.push(
      Object.freeze({
        id: String(out.length),
        path,
        offset,
        compressedSize: compressionMethod === METHOD_STORE ? uncompressedSize : undefined,
        uncompressedSize,
        compressionMethod,
        checksum: 0,
        classic: true,
      }),
    )
  }
  visiting.delete(record.entryListOffset)
}

function transformKey(key) {
  return (((key << 2) & 0xff) | (key >>> 6)) & 0xff
}

function decrypt(bytes, key, absoluteOffset) {
  const output = new Uint8Array(bytes)
  if (key === 0) return output
  const seed = absoluteOffset & 0xff
  for (let index = 0; index < output.byteLength; index += 1) {
    output[index] = (((seed + index) & 0xff) ^ key ^ (output[index] ?? 0)) & 0xff
  }
  return output
}

function parseClassic(bytes, budget) {
  checkedRange(bytes.byteLength, 0, 20, 'classic header')
  const directorySize = u32le(bytes, 8)
  const directoryOffset = u32le(bytes, 16)
  if (directoryOffset >= directorySize) throw new RangeError('HPI directory offset is invalid')
  checkedRange(bytes.byteLength, directoryOffset, directorySize - directoryOffset, 'directory')
  const key = transformKey(u32le(bytes, 12) & 0xff)
  const directory = new Uint8Array(directorySize)
  directory.set(
    decrypt(bytes.subarray(directoryOffset, directorySize), key, directoryOffset),
    directoryOffset,
  )
  const entries = []
  collectClassic(
    bytes.byteLength,
    directory,
    directoryRecord(directory, directoryOffset),
    '',
    entries,
    new Set(),
    budget,
    0,
  )
  return Object.freeze({
    layout: 'classic',
    version: CLASSIC_VERSION,
    directoryOffset,
    directorySize,
    entries: Object.freeze(entries),
  })
}

function parseArchive(bytes, budget) {
  if (bytes.byteLength < HEADER_BYTES || ascii(bytes, 0, 4) !== 'HAPI') {
    throw new TypeError('HPI magic is missing')
  }
  return u32le(bytes, 4) === CLASSIC_VERSION
    ? parseClassic(bytes, budget)
    : parseCompact(bytes, budget)
}

function checksum(bytes) {
  let value = 0
  for (const byte of bytes) value = (value + byte) >>> 0
  return value
}

function decryptInner(bytes) {
  const output = new Uint8Array(bytes)
  for (let index = 0; index < output.byteLength; index += 1) {
    output[index] = (((output[index] ?? 0) - (index & 0xff)) ^ (index & 0xff)) & 0xff
  }
  return output
}

function decodeLz77(input, outputSize) {
  const window = new Uint8Array(4096)
  let windowPosition = 1
  let cursor = 0
  const output = new Uint8Array(outputSize)
  let outputOffset = 0
  while (cursor < input.byteLength && outputOffset < outputSize) {
    let tag = input[cursor] ?? 0
    cursor += 1
    for (let bit = 0; bit < 8 && outputOffset < outputSize; bit += 1) {
      if ((tag & 1) === 0) {
        if (cursor >= input.byteLength) throw new TypeError('HPI LZ77 literal is truncated')
        const value = input[cursor] ?? 0
        cursor += 1
        output[outputOffset] = value
        outputOffset += 1
        window[windowPosition] = value
        windowPosition = (windowPosition + 1) & 0xfff
      } else {
        if (cursor + 1 >= input.byteLength) throw new TypeError('HPI LZ77 pointer is truncated')
        const packed = (input[cursor] ?? 0) | ((input[cursor + 1] ?? 0) << 8)
        cursor += 2
        let readPosition = packed >>> 4
        if (readPosition === 0) return output.subarray(0, outputOffset)
        const count = (packed & 0x0f) + 2
        for (let index = 0; index < count && outputOffset < outputSize; index += 1) {
          const value = window[readPosition] ?? 0
          output[outputOffset] = value
          outputOffset += 1
          window[windowPosition] = value
          readPosition = (readPosition + 1) & 0xfff
          windowPosition = (windowPosition + 1) & 0xfff
        }
      }
      tag >>>= 1
    }
  }
  return output.subarray(0, outputOffset)
}

async function inflateZlib(bytes, expectedSize) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('HPI zlib extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  if (output.byteLength !== expectedSize) throw new TypeError('HPI zlib output size is invalid')
  return output
}

async function readClassicEntry(bytes, archive, entry, maximum) {
  if (entry.uncompressedSize > maximum) throw new RangeError('HPI entry exceeds maxScalarBytes')
  const key = transformKey(u32le(bytes, 12) & 0xff)
  if (entry.compressionMethod === METHOD_STORE) {
    return decrypt(
      checkedSlice(bytes, entry.offset, entry.uncompressedSize, `payload ${entry.path}`),
      key,
      entry.offset,
    )
  }
  if (entry.compressionMethod !== METHOD_LZ77 && entry.compressionMethod !== METHOD_ZLIB) {
    throw new TypeError(`unsupported HPI compression method ${entry.compressionMethod}`)
  }
  const output = new Uint8Array(entry.uncompressedSize)
  const chunkCount = Math.ceil(entry.uncompressedSize / CHUNK_BYTES)
  checkedRange(bytes.byteLength, entry.offset, chunkCount * 4, `chunk table ${entry.path}`)
  let cursor = entry.offset + chunkCount * 4
  let outputOffset = 0
  for (let index = 0; index < chunkCount; index += 1) {
    const encryptedHeader = checkedSlice(
      bytes,
      cursor,
      CHUNK_HEADER_BYTES,
      `chunk header ${entry.path}`,
    )
    const chunkHeader = decrypt(encryptedHeader, key, cursor)
    if (u32le(chunkHeader, 0) !== CHUNK_MAGIC) throw new TypeError('HPI chunk magic is invalid')
    const method = chunkHeader[5] ?? 0
    const innerEncrypted = chunkHeader[6] !== 0
    const compressedSize = u32le(chunkHeader, 7)
    const decompressedSize = u32le(chunkHeader, 11)
    const expectedChecksum = u32le(chunkHeader, 15)
    cursor += CHUNK_HEADER_BYTES
    let chunk = decrypt(
      checkedSlice(bytes, cursor, compressedSize, `chunk payload ${entry.path}`),
      key,
      cursor,
    )
    cursor += compressedSize
    if (checksum(chunk) !== expectedChecksum) throw new TypeError('HPI chunk checksum is invalid')
    if (innerEncrypted) chunk = decryptInner(chunk)
    let decoded
    if (method === METHOD_STORE) {
      if (compressedSize !== decompressedSize)
        throw new TypeError('HPI stored chunk size is invalid')
      decoded = chunk
    } else if (method === METHOD_LZ77) {
      decoded = decodeLz77(chunk, decompressedSize)
    } else if (method === METHOD_ZLIB) {
      decoded = await inflateZlib(chunk, decompressedSize)
    } else {
      throw new TypeError(`unsupported HPI chunk compression method ${method}`)
    }
    if (decoded.byteLength !== decompressedSize)
      throw new TypeError('HPI chunk output is truncated')
    if (outputOffset + decoded.byteLength > output.byteLength) {
      throw new TypeError('HPI chunks exceed the declared entry size')
    }
    output.set(decoded, outputOffset)
    outputOffset += decoded.byteLength
  }
  if (archive.version !== CLASSIC_VERSION || outputOffset !== output.byteLength) {
    throw new TypeError('HPI entry output size is invalid')
  }
  return output
}

async function readEntry(bytes, archive, entry, maximum) {
  if (entry.classic) return readClassicEntry(bytes, archive, entry, maximum)
  if (entry.compressionMethod !== METHOD_STORE) {
    throw new TypeError(`unsupported compact HPI compression method ${entry.compressionMethod}`)
  }
  if (entry.uncompressedSize !== entry.compressedSize) {
    throw new TypeError('compact HPI stored entry sizes do not match')
  }
  return checkedSlice(bytes, entry.offset, entry.compressedSize, `payload ${entry.path}`)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('HPI namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid HPI page cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          storedSize: entry.compressedSize === undefined ? undefined : BigInt(entry.compressedSize),
          size: BigInt(entry.uncompressedSize),
          compression: methodName(entry.compressionMethod),
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
      if (entry === undefined) throw new TypeError(`unknown HPI entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `hpi-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'ta-hpi', label: 'HPI Family (Total Annihilation)' }),
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
    return prefix.byteLength >= 4 && ascii(prefix, 0, 4) === 'HAPI'
      ? { confidence: 0.99, kind: 'magic', note: 'HAPI header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const methods = [...new Set(archive.entries.map(entry => methodName(entry.compressionMethod)))]
    const compressed = archive.entries.filter(
      entry => entry.compressionMethod !== METHOD_STORE,
    ).length
    return {
      summary: {
        format: 'ta-hpi',
        layout: archive.layout,
        version: archive.version,
        entries: archive.entries.length,
        compressed,
        compressionMethods: methods,
      },
      metadata: [
        {
          id: 'ta-hpi-archive',
          label: 'Total Annihilation HPI archive',
          entries: [
            { key: 'layout', value: archive.layout },
            { key: 'version', value: archive.version },
            { key: 'entries', value: archive.entries.length },
            { key: 'compressedEntries', value: compressed },
            { key: 'directoryOffset', value: archive.directoryOffset },
            { key: 'directorySize', value: archive.directorySize },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'structure.hierarchy', parameters: { entries: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Total Annihilation HPI',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.uncompressedSize} bytes, ${methodName(entry.compressionMethod)}`,
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
          if (entry === undefined) throw new TypeError('HPI entry id was not found')
          return {
            kind: 'bytes',
            value: await readEntry(bytes, archive, entry, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: archive.entries.reduce(
        (total, entry) => total + BigInt(entry.uncompressedSize),
        0n,
      ),
      unsupportedFeatures: ['hpi-writing', 'archive-mutation', 'multi-archive-load-order-overlay'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
