import {
  CONTAINER_EXTRACT_HANDLER_ID,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkit/codec-kit'
import {
  bcj2Decode,
  bcjX86Decode,
  bzip2Decompress,
  decompressBounded,
  lzma2Decode,
  lzma2DictionarySize,
  lzmaDecode,
  parseLzmaProperties,
} from '@modkit/codec-kit/compression'
import { crc32 } from '@modkit/codec-kit/checksum'

const ID = 'modkit/7z'
const SIGNATURE = Object.freeze([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
const utf16 = new TextDecoder('utf-16le', { fatal: true })
const MAX_CODERS = 32
const MAX_HEADER_NESTING = 4

/** Property ids from 7zFormat.txt. */
const K = Object.freeze({
  end: 0x00,
  header: 0x01,
  archiveProperties: 0x02,
  additionalStreams: 0x03,
  mainStreams: 0x04,
  filesInfo: 0x05,
  packInfo: 0x06,
  unpackInfo: 0x07,
  subStreamsInfo: 0x08,
  size: 0x09,
  crc: 0x0a,
  folder: 0x0b,
  codersUnpackSize: 0x0c,
  numUnpackStream: 0x0d,
  emptyStream: 0x0e,
  emptyFile: 0x0f,
  anti: 0x10,
  name: 0x11,
  mtime: 0x14,
  attributes: 0x15,
  encodedHeader: 0x17,
  dummy: 0x19,
})

const METHODS = Object.freeze({
  '00': 'Copy',
  '03': 'Delta',
  21: 'LZMA2',
  '030101': 'LZMA',
  '03030103': 'BCJ',
  '0303011b': 'BCJ2',
  '03030205': 'PPC',
  '03030401': 'IA64',
  '03030501': 'ARM',
  '03030701': 'ARMT',
  '03030805': 'SPARC',
  '0a': 'ARM64',
  '0b': 'RISCV',
  '030401': 'PPMD',
  '040108': 'Deflate',
  '040109': 'Deflate64',
  '040202': 'BZip2',
  '06f10701': 'AES-256',
})
const DECODABLE = new Set(['Copy', 'Delta', 'LZMA', 'LZMA2', 'BCJ', 'BCJ2', 'Deflate', 'BZip2'])

/** Errors a host or UI can branch on without parsing prose. */
function archiveError(code, message) {
  const error = new TypeError(`${code}: ${message}`)
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

const matches = bytes => SIGNATURE.every((value, index) => bytes[index] === value)

function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(`7z ${label} exceeds safe integers`)
  return Number(value)
}

function u32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function u64(bytes, offset, label) {
  return safeNumber(
    new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true),
    label,
  )
}

class Reader {
  constructor(bytes, start = 0, end = bytes.byteLength) {
    this.bytes = bytes
    this.cursor = start
    this.end = end
  }

  byte(label) {
    if (this.cursor >= this.end) throw new TypeError(`7z ${label} is truncated`)
    return this.bytes[this.cursor++] ?? 0
  }

  expect(value, label) {
    if (this.byte(label) !== value) throw new TypeError(`7z ${label} is unsupported or invalid`)
  }

  uint32(label) {
    if (this.cursor + 4 > this.end) throw new TypeError(`7z ${label} is truncated`)
    const value = u32(this.bytes, this.cursor)
    this.cursor += 4
    return value
  }

  uint64(label) {
    if (this.cursor + 8 > this.end) throw new TypeError(`7z ${label} is truncated`)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.cursor, 8)
    this.cursor += 8
    return value.getBigUint64(0, true)
  }

  number(label) {
    const first = this.byte(label)
    let mask = 0x80
    let value = 0n
    for (let index = 0; index < 8; index += 1) {
      if ((first & mask) === 0) {
        value |= BigInt(first & (mask - 1)) << BigInt(index * 8)
        return safeNumber(value, label)
      }
      value |= BigInt(this.byte(label)) << BigInt(index * 8)
      mask >>>= 1
    }
    return safeNumber(value, label)
  }

  /** A count whose items each take at least one header byte; rejects absurd allocations early. */
  count(label, limit = this.end - this.cursor) {
    const value = this.number(label)
    if (value > limit) throw new RangeError(`7z ${label} ${value} exceeds its bound`)
    return value
  }

  take(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || this.cursor + length > this.end) {
      throw new TypeError(`7z ${label} range is invalid`)
    }
    const value = this.bytes.subarray(this.cursor, this.cursor + length)
    this.cursor += length
    return value
  }

  skip(label) {
    this.take(this.number(`${label} size`), label)
  }
}

function readBits(reader, count, label) {
  const bits = new Array(count)
  let mask = 0
  let current = 0
  for (let index = 0; index < count; index += 1) {
    if (mask === 0) {
      current = reader.byte(label)
      mask = 0x80
    }
    bits[index] = (current & mask) !== 0
    mask >>>= 1
  }
  return bits
}

function readDefined(reader, count, label) {
  const all = reader.byte(`${label} all-defined flag`)
  return all === 0 ? readBits(reader, count, label) : new Array(count).fill(true)
}

function readDigests(reader, count) {
  const defined = readDefined(reader, count, 'CRC vector')
  return defined.map(isDefined => (isDefined ? reader.uint32('CRC-32') : undefined))
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

function readPackInfo(reader) {
  const packPos = reader.number('pack position')
  const count = reader.count('pack stream count')
  let sizes = new Array(count).fill(0)
  for (;;) {
    const id = reader.byte('PackInfo property')
    if (id === K.end) break
    if (id === K.size) sizes = sizes.map(() => reader.number('packed size'))
    else if (id === K.crc) readDigests(reader, count)
    else throw new TypeError(`7z PackInfo property 0x${id.toString(16)} is invalid`)
  }
  return { packPos, sizes }
}

function readFolder(reader) {
  const coderCount = reader.count('coder count', MAX_CODERS)
  if (coderCount === 0) throw new TypeError('7z folder has no coders')
  const coders = []
  let inTotal = 0
  let outTotal = 0
  for (let index = 0; index < coderCount; index += 1) {
    const flags = reader.byte('coder flags')
    if ((flags & 0xc0) !== 0) throw new TypeError('7z alternative coder methods are unsupported')
    const idBytes = reader.take(flags & 0x0f, 'coder method id')
    const methodId = Array.from(idBytes, byte => byte.toString(16).padStart(2, '0')).join('')
    const inStreams = flags & 0x10 ? reader.count('coder input count', MAX_CODERS) : 1
    const outStreams = flags & 0x10 ? reader.count('coder output count', MAX_CODERS) : 1
    if (outStreams !== 1) throw new TypeError('7z coders with several outputs are unsupported')
    const properties =
      flags & 0x20
        ? reader.take(reader.number('coder properties size'), 'coder properties')
        : undefined
    coders.push({
      methodId,
      method: METHODS[methodId] ?? `0x${methodId || '00'}`,
      properties,
      inIndex: inTotal,
      inStreams,
      outIndex: outTotal,
    })
    inTotal += inStreams
    outTotal += outStreams
  }
  const bindPairs = []
  for (let index = 0; index < outTotal - 1; index += 1) {
    const inIndex = reader.number('bind pair input')
    const outIndex = reader.number('bind pair output')
    if (inIndex >= inTotal || outIndex >= outTotal) throw new TypeError('7z bind pair is invalid')
    bindPairs.push({ inIndex, outIndex })
  }
  const packedCount = inTotal - bindPairs.length
  if (packedCount < 1) throw new TypeError('7z folder has no packed streams')
  const packedStreams = []
  if (packedCount === 1) {
    const free = [...Array(inTotal).keys()].find(i => !bindPairs.some(p => p.inIndex === i))
    if (free === undefined) throw new TypeError('7z folder packed stream is missing')
    packedStreams.push(free)
  } else {
    for (let index = 0; index < packedCount; index += 1) {
      const value = reader.number('packed stream index')
      if (value >= inTotal) throw new TypeError('7z packed stream index is invalid')
      packedStreams.push(value)
    }
  }
  const main = [...Array(outTotal).keys()].filter(i => !bindPairs.some(p => p.outIndex === i))
  if (main.length !== 1) throw new TypeError('7z folder output graph is invalid')
  return { coders, bindPairs, packedStreams, mainOut: main[0], unpackSizes: [], crc: undefined }
}

function readUnpackInfo(reader) {
  reader.expect(K.folder, 'Folder marker')
  const count = reader.count('folder count')
  reader.expect(0, 'external folders flag')
  const folders = Array.from({ length: count }, () => readFolder(reader))
  reader.expect(K.codersUnpackSize, 'CodersUnpackSize marker')
  for (const folder of folders) {
    folder.unpackSizes = folder.coders.map(() => reader.number('unpack size'))
  }
  for (;;) {
    const id = reader.byte('UnpackInfo property')
    if (id === K.end) break
    if (id !== K.crc) throw new TypeError(`7z UnpackInfo property 0x${id.toString(16)} is invalid`)
    readDigests(reader, count).forEach((crc, index) => {
      folders[index].crc = crc
    })
  }
  return folders
}

const folderSize = folder => folder.unpackSizes[folder.mainOut] ?? 0

function readSubStreams(reader, folders, maxNodes) {
  const counts = folders.map(() => 1)
  let id = reader.byte('SubStreamsInfo property')
  if (id === K.numUnpackStream) {
    let total = 0
    for (let index = 0; index < folders.length; index += 1) {
      counts[index] = reader.number('substream count')
      total += counts[index]
      if (total > maxNodes) throw new RangeError('7z entry count exceeds maxNodes budget')
    }
    id = reader.byte('SubStreamsInfo property')
  }
  const sizes = []
  folders.forEach((folder, index) => {
    const count = counts[index]
    if (count === 0) return
    let sum = 0
    for (let item = 1; item < count; item += 1) {
      if (id !== K.size) throw new TypeError('7z substream sizes are missing')
      const size = reader.number('substream size')
      sizes.push(size)
      sum += size
    }
    const last = folderSize(folder) - sum
    if (last < 0) throw new TypeError('7z substream sizes exceed their folder')
    sizes.push(last)
  })
  if (id === K.size) id = reader.byte('SubStreamsInfo property')
  const digests = []
  folders.forEach((folder, index) => {
    const known = counts[index] === 1 && folder.crc !== undefined
    digests.push(...Array(counts[index]).fill(known ? folder.crc : undefined))
  })
  for (; id !== K.end; id = reader.byte('SubStreamsInfo property')) {
    if (id !== K.crc)
      throw new TypeError(`7z SubStreamsInfo property 0x${id.toString(16)} is invalid`)
    const unknown = digests.filter(value => value === undefined).length
    const read = readDigests(reader, unknown)
    let next = 0
    for (let index = 0; index < digests.length; index += 1) {
      if (digests[index] === undefined) digests[index] = read[next++]
    }
  }
  return { counts, sizes, digests }
}

function readStreamsInfo(reader, maxNodes) {
  const info = { packPos: 0, packSizes: [], folders: [], substreams: undefined }
  for (;;) {
    const id = reader.byte('StreamsInfo property')
    if (id === K.end) break
    if (id === K.packInfo) {
      const pack = readPackInfo(reader)
      info.packPos = pack.packPos
      info.packSizes = pack.sizes
    } else if (id === K.unpackInfo) info.folders = readUnpackInfo(reader)
    else if (id === K.subStreamsInfo)
      info.substreams = readSubStreams(reader, info.folders, maxNodes)
    else throw new TypeError(`7z StreamsInfo property 0x${id.toString(16)} is invalid`)
  }
  info.substreams ??= {
    counts: info.folders.map(() => 1),
    sizes: info.folders.map(folderSize),
    digests: info.folders.map(folder => folder.crc),
  }
  let packIndex = 0
  let offset = 32 + info.packPos
  for (const folder of info.folders) {
    folder.packs = folder.packedStreams.map(() => {
      const size = info.packSizes[packIndex++]
      if (size === undefined) throw new TypeError('7z folder refers to a missing pack stream')
      const pack = { offset, size }
      offset += size
      return pack
    })
  }
  return info
}

function filetime(value) {
  const ms = Number(value / 10_000n) - 11_644_473_600_000
  return Number.isSafeInteger(ms) ? ms : undefined
}

function readFilesInfo(reader, maxNodes) {
  const count = reader.count('file count')
  if (count > maxNodes) throw new RangeError('7z entry count exceeds maxNodes budget')
  const files = Array.from({ length: count }, () => ({ emptyStream: false, emptyFile: false }))
  let emptyStreams = 0
  for (;;) {
    const id = reader.number('FilesInfo property')
    if (id === K.end) break
    const body = new Reader(
      reader.take(reader.number('FilesInfo property size'), 'FilesInfo property'),
    )
    if (id === K.emptyStream) {
      readBits(body, count, 'EmptyStream vector').forEach((value, index) => {
        files[index].emptyStream = value
      })
      emptyStreams = files.filter(file => file.emptyStream).length
    } else if (id === K.emptyFile || id === K.anti) {
      const bits = readBits(body, emptyStreams, 'EmptyFile vector')
      let next = 0
      for (const file of files) {
        if (!file.emptyStream) continue
        if (bits[next++]) file[id === K.emptyFile ? 'emptyFile' : 'anti'] = true
      }
    } else if (id === K.name) {
      if (body.byte('external names flag') !== 0)
        throw new TypeError('7z external names are unsupported')
      let start = body.cursor
      let index = 0
      for (let at = start; at + 1 < body.end; at += 2) {
        if (body.bytes[at] !== 0 || body.bytes[at + 1] !== 0) continue
        if (index >= count) throw new TypeError('7z has more names than files')
        files[index++].name = utf16.decode(body.bytes.subarray(start, at))
        start = at + 2
      }
      if (index !== count) throw new TypeError('7z names do not match the file count')
    } else if (id === K.mtime || id === K.attributes) {
      const defined = readDefined(body, count, 'FilesInfo vector')
      if (body.byte('external data flag') !== 0)
        throw new TypeError('7z external data is unsupported')
      defined.forEach((isDefined, index) => {
        if (!isDefined) return
        if (id === K.mtime) files[index].modifiedAt = filetime(body.uint64('modification time'))
        else files[index].attributes = body.uint32('file attributes')
      })
    }
    // Creation/access times, start positions, comments and padding carry nothing we publish.
  }
  return files
}

function readHeader(reader, maxNodes) {
  let main
  let files = []
  for (;;) {
    const id = reader.byte('Header property')
    if (id === K.end) break
    if (id === K.archiveProperties) {
      while (reader.byte('archive property') !== 0) reader.skip('archive property')
    } else if (id === K.additionalStreams) readStreamsInfo(reader, maxNodes)
    else if (id === K.mainStreams) main = readStreamsInfo(reader, maxNodes)
    else if (id === K.filesInfo) files = readFilesInfo(reader, maxNodes)
    else throw new TypeError(`7z Header property 0x${id.toString(16)} is invalid`)
  }
  return { main, files }
}

function methodsOf(folder) {
  return folder.coders.map(coder => coder.method)
}

/**
 * Decode one folder's main output, reading its pack streams by range. The caller has checked
 * methods and budgets.
 */
async function decodeFolder(read, folder, budget, signal) {
  const outOf = new Map()
  const coderByOut = new Map(folder.coders.map(coder => [coder.outIndex, coder]))
  const input = async inIndex => {
    const packed = folder.packedStreams.indexOf(inIndex)
    if (packed >= 0) {
      const pack = folder.packs[packed]
      return read(pack.offset, pack.size)
    }
    const pair = folder.bindPairs.find(item => item.inIndex === inIndex)
    if (pair === undefined) throw new TypeError('7z coder input is unbound')
    return output(pair.outIndex)
  }
  const output = async outIndex => {
    if (outOf.has(outIndex)) throw new TypeError('7z coder graph reuses a stream')
    outOf.set(outIndex, true)
    signal?.throwIfAborted()
    const coder = coderByOut.get(outIndex)
    const size = folder.unpackSizes[outIndex] ?? 0
    if (size > budget.maxScalarBytes) {
      throw new RangeError('7z folder exceeds maxScalarBytes budget')
    }
    const inputs = []
    for (let index = 0; index < coder.inStreams; index += 1)
      inputs.push(await input(coder.inIndex + index))
    const [first] = inputs
    const props = coder.properties ?? new Uint8Array(0)
    let result
    switch (coder.method) {
      case 'Copy':
        result = first.slice(0, size)
        break
      case 'LZMA':
        result = lzmaDecode(first, parseLzmaProperties(props), {
          outputSize: size,
          allowEndMarker: true,
        })
        break
      case 'LZMA2':
        result = lzma2Decode(first, lzma2DictionarySize(props[0] ?? 0xff), { outputSize: size })
        break
      case 'BCJ':
        result = bcjX86Decode(first.slice(0, size))
        break
      case 'BCJ2':
        result = bcj2Decode(inputs[0], inputs[1], inputs[2], inputs[3], size)
        break
      case 'Delta': {
        const distance = (props[0] ?? 0) + 1
        result = first.slice(0, size)
        for (let index = distance; index < result.byteLength; index += 1) {
          result[index] = (result[index] + result[index - distance]) & 0xff
        }
        break
      }
      case 'Deflate':
        result = await decompressBounded(first, 'deflate-raw', { maxOutputBytes: size, signal })
        break
      case 'BZip2':
        result = bzip2Decompress(first, { maxOutputBytes: size, signal })
        break
      default:
        throw archiveError(
          'archives/7z-method-unsupported',
          `7z method ${coder.method} is not supported`,
        )
    }
    if (result.byteLength !== size)
      throw new TypeError(`7z ${coder.method} decoded size is invalid`)
    return result
  }
  const decoded = await output(folder.mainOut)
  if (folder.crc !== undefined && crc32(decoded) !== folder.crc) {
    throw new TypeError('7z folder CRC-32 is invalid')
  }
  return decoded
}

function checkFolderBudget(folder, budget) {
  for (const size of folder.unpackSizes) {
    if (size > budget.maxScalarBytes)
      throw new RangeError('7z folder exceeds maxScalarBytes budget')
  }
  if (folder.coders.some(coder => coder.method === 'AES-256')) {
    throw archiveError('archives/password-required', '7z archive is encrypted and needs a password')
  }
  const unsupported = folder.coders.find(coder => !DECODABLE.has(coder.method))
  if (unsupported !== undefined) {
    throw archiveError(
      'archives/7z-method-unsupported',
      `7z method ${unsupported.method} is not supported`,
    )
  }
}

/** The archive's headers, read by range: the 32-byte start header, then the header it points at. */
async function parse7z(read, size, budget) {
  if (size < 32) throw new TypeError('7z signature header is invalid')
  const start = await read(0, 32)
  if (!matches(start)) throw new TypeError('7z signature header is invalid')
  const major = start[6] ?? 0
  const minor = start[7] ?? 0
  if (major !== 0) throw new TypeError(`7z version ${major}.${minor} is unsupported`)
  if (crc32(start.subarray(12, 32)) !== u32(start, 8)) {
    throw new TypeError('7z start header CRC-32 is invalid')
  }
  const nextOffset = u64(start, 12, 'next header offset')
  const nextSize = u64(start, 20, 'next header size')
  const nextStart = 32 + nextOffset
  const nextEnd = nextStart + nextSize
  if (!Number.isSafeInteger(nextEnd) || nextEnd > size) {
    throw new TypeError('7z next header range is invalid (truncated or multi-volume archive)')
  }
  if (nextSize === 0) return { major, minor, folders: [], entries: [], headerEncoded: false }
  let header = await read(nextStart, nextSize)
  if (crc32(header) !== u32(start, 28)) throw new TypeError('7z next header CRC-32 is invalid')
  let headerEncoded = false
  for (let depth = 0; ; depth += 1) {
    const reader = new Reader(header)
    const id = reader.byte('Header marker')
    if (id === K.header) {
      const { main, files } = readHeader(reader, budget.maxNodes)
      return { major, minor, headerEncoded, ...assemble(main, files) }
    }
    if (id !== K.encodedHeader || depth >= MAX_HEADER_NESTING) {
      throw new TypeError('7z Header marker is unsupported or invalid')
    }
    headerEncoded = true
    const streams = readStreamsInfo(reader, budget.maxNodes)
    const folder = streams.folders[0]
    if (folder === undefined) throw new TypeError('7z encoded header has no folder')
    checkFolderBudget(folder, budget)
    header = await decodeFolder(read, folder, budget)
  }
}

function assemble(main, files) {
  const folders = main?.folders ?? []
  const substreams = main?.substreams ?? { counts: [], sizes: [], digests: [] }
  const entries = []
  let stream = 0
  let folderIndex = 0
  let inFolder = 0
  let offset = 0
  files.forEach((file, index) => {
    if (file.name === undefined) throw new TypeError('7z file name is missing')
    const unixMode =
      file.attributes !== undefined && file.attributes & 0x8000 ? file.attributes >>> 16 : undefined
    const directory =
      (file.emptyStream && !file.emptyFile) ||
      (file.attributes !== undefined && (file.attributes & 0x10) !== 0)
    const entry = {
      id: `file-${index}`,
      path: safePath(file.name),
      kind: directory ? 'directory' : 'file',
      size: 0,
      modifiedAt: file.modifiedAt,
      attributes: file.attributes,
      unixMode,
      anti: file.anti === true,
    }
    if (!file.emptyStream) {
      while (folderIndex < folders.length && inFolder >= (substreams.counts[folderIndex] ?? 0)) {
        folderIndex += 1
        inFolder = 0
        offset = 0
      }
      const folder = folders[folderIndex]
      if (folder === undefined) throw new TypeError('7z has more file streams than folders provide')
      entry.folder = folderIndex
      entry.offset = offset
      entry.size = substreams.sizes[stream] ?? 0
      entry.crc = substreams.digests[stream]
      entry.method = methodsOf(folder).join('+')
      entry.solid = (substreams.counts[folderIndex] ?? 0) > 1
      entry.encrypted = methodsOf(folder).includes('AES-256')
      offset += entry.size
      inFolder += 1
      stream += 1
    }
    entries.push(entry)
  })
  if (stream !== substreams.sizes.length)
    throw new TypeError('7z stream count disagrees with files')
  return { folders, entries: entries.filter(entry => !entry.anti) }
}

/**
 * The archive's files as the host's entry table: listing, extraction and nested opens. A file in a
 * Copy folder is read in place by range, whatever its size; any other is decoded with its folder
 * (bounded by `maxScalarBytes`), one decoded folder kept, as solid archives are extracted in order.
 */
function entryTable(archive, read, budget) {
  let cached
  const decoded = (index, signal) => {
    if (cached?.index !== index) {
      const pending = decodeFolder(read, archive.folders[index], budget, signal)
      cached = { index, pending }
      pending.catch(() => {
        if (cached?.pending === pending) cached = undefined
      })
    }
    return cached.pending
  }
  const storage = entry => {
    const folder = entry.folder === undefined ? undefined : archive.folders[entry.folder]
    if (folder === undefined) return { kind: 'stored', offset: 0n, length: 0n }
    const [only] = folder.coders
    if (folder.coders.length === 1 && only.method === 'Copy' && folder.packs.length === 1) {
      return {
        kind: 'stored',
        offset: BigInt(folder.packs[0].offset + entry.offset),
        length: BigInt(entry.size),
      }
    }
    return {
      kind: 'custom',
      compression: entry.method,
      async open(signal) {
        checkFolderBudget(folder, budget)
        const bytes = await decoded(entry.folder, signal)
        // a buffer of its own: the worker boundary refuses a view into the decoded folder
        const value = bytes.slice(entry.offset, entry.offset + entry.size)
        if (value.byteLength !== entry.size)
          throw new TypeError(`7z entry ${entry.path} is truncated`)
        return (async function* () {
          yield value
        })()
      },
    }
  }
  return {
    entries: archive.entries
      .filter(entry => entry.kind === 'file')
      .map(entry => ({
        path: entry.path,
        size: BigInt(entry.size),
        storage: storage(entry),
        ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
        // the archive's own CRC-32, which the host checks after decoding
        ...(entry.crc === undefined
          ? {}
          : {
              checksum: { algorithm: 'crc-32', value: entry.crc.toString(16).padStart(8, '0') },
            }),
      })),
    directories: archive.entries
      .filter(entry => entry.kind === 'directory')
      .map(entry => ({ path: entry.path })),
    caseSensitivity: 'sensitive',
    complete: true,
  }
}

function folderDiagnostics(archive, budget) {
  const seen = new Set()
  const diagnostics = []
  for (const folder of archive.folders) {
    try {
      checkFolderBudget(folder, budget)
    } catch (error) {
      if (seen.has(error.code ?? error.message)) continue
      seen.add(error.code ?? error.message)
      diagnostics.push({
        id: `7z-${error.code === 'archives/password-required' ? 'encrypted' : 'folder-unreadable'}`,
        category: 'fidelity',
        severity: 'error',
        code: error.code ?? 'archives/7z-budget',
        message: error.message,
      })
    }
  }
  return diagnostics
}

function encryptedHeaderInspection(size) {
  return {
    summary: { format: '7z', entries: 0, encryptedHeader: true },
    metadata: [
      {
        id: '7z-archive',
        label: '7-Zip archive',
        entries: [{ key: 'encryptedHeader', value: true }],
      },
    ],
    traits: [
      { id: 'container.entries', parameters: { count: 0 } },
      { id: 'content.binary', parameters: { bytes: String(size) } },
    ],
    diagnostics: [
      {
        id: '7z-encrypted',
        category: 'fidelity',
        severity: 'error',
        code: 'archives/password-required',
        message: '7z archive headers are encrypted; a password is required to list its entries',
      },
    ],
    dataSources: {
      'common.view/tree-data-source': createTreeDataSource({
        kind: 'archive',
        label: '7-Zip',
        preview: 'encrypted, password required',
        children: [],
      }),
    },
    containerEntries: { entries: [], caseSensitivity: 'sensitive', complete: false },
    unsupportedFeatures: ['7z-decryption'],
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: '7z',
    label: '7-Zip archive',
    mediaType: 'application/x-7z-compressed',
  }),
  // any size: the headers and each member are read by range, a Copy member in place
  access: 'ranges',
  detectBytes: SIGNATURE.length,
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: CONTAINER_EXTRACT_HANDLER_ID,
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
  async inspect(context) {
    const budget = context.budget
    const size = Number(await context.byteSource.size())
    const maxRead = Number(budget.maxInputBytes)
    const read = async (offset, length) => {
      if (offset + length > size) throw new TypeError('7z pack stream is truncated')
      if (length > maxRead)
        throw new RangeError(`7z range of ${length} bytes exceeds the maxInputBytes budget`)
      const bytes = await context.byteSource.read(BigInt(offset), length, context.signal)
      if (bytes.byteLength !== length) throw new TypeError('7z archive is truncated')
      return bytes
    }
    let archive
    try {
      archive = await parse7z(read, size, budget)
    } catch (error) {
      if (error?.code === 'archives/password-required') return encryptedHeaderInspection(size)
      throw error
    }
    const { entries } = archive
    const files = entries.filter(entry => entry.kind === 'file')
    const directories = entries.length - files.length
    const methods = [...new Set(archive.folders.flatMap(methodsOf))]
    const payloadBytes = files.reduce((total, entry) => total + entry.size, 0)
    const solid = files.some(entry => entry.solid)
    return {
      containerEntries: entryTable(archive, read, budget),
      summary: {
        format: '7z',
        version: `${archive.major}.${archive.minor}`,
        entries: entries.length,
        files: files.length,
        directories,
        methods,
        solid,
        encodedHeader: archive.headerEncoded,
        payloadBytes,
      },
      metadata: [
        {
          id: '7z-archive',
          label: '7-Zip archive',
          entries: [
            { key: 'version', value: `${archive.major}.${archive.minor}` },
            { key: 'files', value: files.length },
            { key: 'directories', value: directories },
            { key: 'folders', value: archive.folders.length },
            { key: 'methods', value: methods.join(', ') || 'none' },
            { key: 'solid', value: solid },
            { key: 'encodedHeader', value: archive.headerEncoded },
            { key: 'payloadBytes', value: payloadBytes },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: directories } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'content.binary', parameters: { bytes: String(size) } },
      ],
      diagnostics: folderDiagnostics(archive, budget),
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: '7-Zip',
          preview: `${files.length} files, ${methods.join('+') || 'no streams'}`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview:
              entry.kind === 'file'
                ? `${entry.size} bytes, ${entry.method ?? 'empty'}`
                : 'directory',
          })),
        }),
      },
      unsupportedFeatures: [
        '7z-decryption',
        '7z-methods-ppmd-deflate64-arm-ppc-sparc-ia64-arm64-riscv',
        'multivolume-archives',
        '7z-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
