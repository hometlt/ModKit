import {
  CONTAINER_EXTRACT_HANDLER_ID,
  createInspectionCodec,
  createTreeDataSource,
  editPlanFromInput,
} from '@modkit/codec-kit'
import { containerEntryRevision, revisionId } from '@modkit/sdk'
import { crc32 } from '@modkit/codec-kit/checksum'
import { decompressBounded } from '@modkit/codec-kit/compression/bounded'

const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const ZIP_DESCRIPTOR = 0x08074b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
/** Local headers closer together than this are read in one range. */
const LOCAL_HEADER_WINDOW = 64 * 1024
const FLAG_ENCRYPTED = 0x0001
const FLAG_COMPRESSION_OPTIONS = 0x0006
const FLAG_DESCRIPTOR = 0x0008
const FLAG_STRONG_ENCRYPTION = 0x0040
const FLAG_UTF8_NAMES = 0x0800
const EXTRA_ZIP64 = 0x0001
const EXTRA_UNICODE_PATH = 0x7075
const MAX_U16 = 0xffff
const MAX_U32 = 0xffffffff
/** 1980-01-01, the DOS epoch: new entries carry a deterministic timestamp, never a clock read. */
const DOS_EPOCH_DATE = 0x0021
const STORED = 0
const VERSION_STORED = 10
const VERSION_MADE_BY = 20
const EMPTY = new Uint8Array(0)
const utf8 = new TextDecoder('utf-8', { fatal: true })
const legacy = new TextDecoder('latin1')
const encoder = new TextEncoder()

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('truncated ZIP u16')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated ZIP u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

/**
 * ZIP's method numbers, for the ones a reader can name honestly.
 *
 * The contract asks for the container's own vocabulary rather than an enumeration, so an unknown
 * method is reported as its number instead of being flattened into "unknown" — a user looking at
 * `method 14` can search for it; a user looking at "unknown" cannot.
 */
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

/**
 * MS-DOS date/time → epoch milliseconds.
 *
 * The fields carry no zone, and ZIP's own definition is local time on the machine that wrote the
 * archive; there is no way to recover which zone that was. Reading it as UTC is the one choice that
 * is stable everywhere and never silently shifts a listing by the reader's own offset. Seconds have
 * two-second resolution because the format stores them halved — an entry's stamp is not more
 * precise than that, and rounding it up would invent precision.
 *
 * A zero date field means "not recorded", which is different from 1980-01-01, so it answers
 * `undefined` rather than a date nobody set.
 */
function dosTimestamp(dosDate, dosTime) {
  if (dosDate === 0) return undefined
  const year = 1980 + ((dosDate >> 9) & 0x7f)
  const month = (dosDate >> 5) & 0x0f
  const day = dosDate & 0x1f
  const hour = (dosTime >> 11) & 0x1f
  const minute = (dosTime >> 5) & 0x3f
  const second = (dosTime & 0x1f) * 2
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  if (hour > 23 || minute > 59 || second > 59) return undefined
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

function findEocd(bytes) {
  const first = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (u32(bytes, offset) === ZIP_EOCD) return offset
  }
  return -1
}

function u64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new RangeError('truncated ZIP u64')
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('ZIP64 value is too large')
  return Number(value)
}

/**
 * The directory's place from the archive's tail (its last 64 KiB + 22 bytes at most, starting at
 * `tailStart`): the classic EOCD, and where the ZIP64 record lives when the archive has one.
 */
function eocdOf(tail, tailStart) {
  const eocd = findEocd(tail)
  if (eocd < 0) throw new TypeError('ZIP end-of-central-directory record is missing')
  if (u16(tail, eocd + 4) !== 0 || u16(tail, eocd + 6) !== 0) {
    throw new TypeError('multi-disk ZIP archives are unsupported')
  }
  const count = u16(tail, eocd + 10)
  const centralSize = u32(tail, eocd + 12)
  const centralOffset = u32(tail, eocd + 16)
  const saturated = count === MAX_U16 || centralSize === MAX_U32 || centralOffset === MAX_U32
  const locator = eocd >= 20 && u32(tail, eocd - 20) === ZIP64_LOCATOR
  if (saturated && !locator)
    throw new TypeError('ZIP64 end-of-central-directory locator is missing')
  return Object.freeze({
    eocd: tailStart + eocd,
    count,
    centralSize,
    centralOffset,
    ...(locator ? { zip64RecordOffset: u64(tail, eocd - 20 + 8) } : {}),
  })
}

/** The ZIP64 end-of-central-directory record (56 bytes) replaces the classic fields. */
function zip64DirectoryOf(record) {
  if (u32(record, 0) !== ZIP64_EOCD)
    throw new TypeError('ZIP64 end-of-central-directory record is invalid')
  if (u32(record, 16) !== 0 || u32(record, 20) !== 0) {
    throw new TypeError('multi-disk ZIP archives are unsupported')
  }
  return { count: u64(record, 32), centralSize: u64(record, 40), centralOffset: u64(record, 48) }
}

/** Sizes and offset a central record saturated, from its ZIP64 extended-information field. */
function withZip64Extra(extra, fields) {
  for (let at = 0; at + 4 <= extra.byteLength;) {
    const id = u16(extra, at)
    const length = u16(extra, at + 2)
    if (id === EXTRA_ZIP64) {
      const field = extra.subarray(at + 4, at + 4 + length)
      let read = 0
      const next = () => {
        const value = u64(field, read)
        read += 8
        return value
      }
      return {
        size: fields.size === MAX_U32 ? next() : fields.size,
        compressedSize: fields.compressedSize === MAX_U32 ? next() : fields.compressedSize,
        localOffset: fields.localOffset === MAX_U32 ? next() : fields.localOffset,
      }
    }
    at += 4 + length
  }
  if (
    fields.size === MAX_U32 ||
    fields.compressedSize === MAX_U32 ||
    fields.localOffset === MAX_U32
  )
    throw new TypeError('ZIP entry saturates a size or offset without a ZIP64 field')
  return fields
}

/** Central-directory records starting at absolute `centralOffset`, parsed from their bytes. */
function parseCentralDirectory(central, centralOffset, count, maxEntries) {
  if (count > maxEntries) throw new RangeError('ZIP entry count exceeds maxNodes budget')
  const entries = []
  let offset = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > central.byteLength || u32(central, offset) !== ZIP_CENTRAL) {
      throw new TypeError(`invalid ZIP central-directory entry ${index}`)
    }
    const flags = u16(central, offset + 8)
    const method = u16(central, offset + 10)
    const dosTime = u16(central, offset + 12)
    const dosDate = u16(central, offset + 14)
    const crc = u32(central, offset + 16)
    const nameLength = u16(central, offset + 28)
    const extraLength = u16(central, offset + 30)
    const commentLength = u16(central, offset + 32)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > central.byteLength) throw new TypeError('ZIP central-directory name is truncated')
    const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength)
    const name = safePath(
      (flags & FLAG_UTF8_NAMES) !== 0 ? utf8.decode(nameBytes) : legacy.decode(nameBytes),
    )
    if (name === '') throw new TypeError('ZIP entries must have non-empty paths')
    const { size, compressedSize, localOffset } = withZip64Extra(
      central.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
      {
        compressedSize: u32(central, offset + 20),
        size: u32(central, offset + 24),
        localOffset: u32(central, offset + 42),
      },
    )
    entries.push(
      Object.freeze({
        id: `entry-${index}`,
        name,
        kind: name.endsWith('/') ? 'directory' : 'file',
        flags,
        method,
        dosTime,
        dosDate,
        crc,
        compressedSize,
        size,
        localOffset,
        centralOffset: centralOffset + offset,
        centralLength: next - offset,
      }),
    )
    offset = next
  }
  if (offset !== central.byteLength) {
    throw new TypeError('ZIP central-directory size does not match its entries')
  }
  return Object.freeze(entries)
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
    throw new TypeError(`unsafe ZIP entry path: ${value}`)
  }
  return `${parts.join('/')}${normalized.endsWith('/') && parts.length > 0 ? '/' : ''}`
}

export function parseZipArchive(bytes, maxEntries) {
  const tail = eocdOf(bytes, 0)
  const directory =
    tail.zip64RecordOffset === undefined
      ? tail
      : zip64DirectoryOf(bytes.subarray(tail.zip64RecordOffset, tail.zip64RecordOffset + 56))
  if (directory.centralOffset + directory.centralSize > bytes.byteLength) {
    throw new TypeError('ZIP central directory is truncated')
  }
  return parseCentralDirectory(
    bytes.subarray(directory.centralOffset, directory.centralOffset + directory.centralSize),
    directory.centralOffset,
    directory.count,
    maxEntries,
  )
}

/**
 * The directory of an archive of any size, read by ranges: the tail, the ZIP64 record when there
 * is one, then the central directory (at most `maxRead` bytes).
 */
async function readZipDirectory(read, size, maxEntries, maxRead) {
  const tailStart = Math.max(0, size - Math.min(65_557, maxRead))
  const tail = eocdOf(await read(tailStart, size - tailStart), tailStart)
  const directory =
    tail.zip64RecordOffset === undefined
      ? tail
      : zip64DirectoryOf(await read(tail.zip64RecordOffset, 56))
  if (directory.count > maxEntries) throw new RangeError('ZIP entry count exceeds maxNodes budget')
  if (directory.centralSize > maxRead)
    throw new RangeError(
      `ZIP central directory (${directory.centralSize} bytes) exceeds the read budget of ${maxRead}`,
    )
  if (directory.centralOffset + directory.centralSize > size) {
    throw new TypeError('ZIP central directory is truncated')
  }
  return parseCentralDirectory(
    await read(directory.centralOffset, directory.centralSize),
    directory.centralOffset,
    directory.count,
    maxEntries,
  )
}

/**
 * Where each file's data starts: past its local header, whose name and extra lengths may differ
 * from the central record's. Headers within LOCAL_HEADER_WINDOW of each other share one read.
 */
async function localDataOffsets(files, read, size) {
  const sorted = [...files].sort((left, right) => left.localOffset - right.localOffset)
  const offsets = new Map()
  for (let first = 0; first < sorted.length;) {
    const start = sorted[first].localOffset
    let last = first
    while (
      last + 1 < sorted.length &&
      sorted[last + 1].localOffset + 30 - start <= LOCAL_HEADER_WINDOW
    )
      last += 1
    const end = sorted[last].localOffset + 30
    if (end > size) throw new TypeError(`the local header of «${sorted[last].name}» is truncated`)
    const window = await read(start, end - start)
    for (let index = first; index <= last; index += 1) {
      const entry = sorted[index]
      const at = entry.localOffset - start
      if (u32(window, at) !== ZIP_LOCAL)
        throw new TypeError(`the local header of «${entry.name}» is invalid`)
      const dataOffset = entry.localOffset + 30 + u16(window, at + 26) + u16(window, at + 28)
      if (dataOffset + entry.compressedSize > size)
        throw new TypeError(`the data of «${entry.name}» is truncated`)
      offsets.set(entry.id, dataOffset)
    }
    first = last + 1
  }
  return offsets
}

/** ZIP entries as the host's entry table: listing, extraction and in-place nested opens. */
async function zipEntryTable(entries, read, size) {
  const files = entries.filter(entry => entry.kind === 'file')
  const offsets = await localDataOffsets(files, read, size)
  // a name the directory repeats: the last record wins, as extractors do
  const byPath = new Map()
  for (const entry of files) {
    const offset = BigInt(offsets.get(entry.id))
    const compressedLength = BigInt(entry.compressedSize)
    const unreadable =
      (entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0
        ? 'encrypted ZIP entries are unsupported'
        : ![STORED, 8, 93].includes(entry.method)
          ? `unsupported ZIP compression method ${entry.method}`
          : undefined
    const modifiedAt = dosTimestamp(entry.dosDate, entry.dosTime)
    byPath.set(entry.name, {
      path: entry.name,
      size: BigInt(entry.size),
      storage:
        unreadable !== undefined
          ? {
              kind: 'custom',
              compression: compressionName(entry.method),
              async open() {
                throw new TypeError(unreadable)
              },
            }
          : entry.method === STORED
            ? { kind: 'stored', offset, length: compressedLength }
            : { kind: entry.method === 8 ? 'deflate' : 'zstd', offset, compressedLength },
      ...(modifiedAt === undefined ? {} : { modifiedAt }),
      // the container's own CRC-32, not a digest this codec computed
      checksum: { algorithm: 'crc-32', value: entry.crc.toString(16).padStart(8, '0') },
      ...(hiddenZipPath(entry.name) ? { hidden: true } : {}),
    })
  }
  return {
    entries: [...byPath.values()],
    directories: entries
      .filter(entry => entry.kind === 'directory')
      .map(entry => ({
        path: entry.name.slice(0, -1),
        ...(hiddenZipPath(entry.name) ? { hidden: true } : {}),
      })),
    caseSensitivity: 'sensitive',
    complete: true,
  }
}

export async function extractZipArchiveEntry(bytes, entry) {
  if (entry.kind !== 'file') throw new TypeError('directories have no byte payload')
  if ((entry.flags & FLAG_ENCRYPTED) !== 0)
    throw new TypeError('encrypted ZIP entries are unsupported')
  const offset = entry.localOffset
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== ZIP_LOCAL) {
    throw new TypeError('ZIP local entry header is invalid')
  }
  const dataOffset = offset + 30 + u16(bytes, offset + 26) + u16(bytes, offset + 28)
  const end = dataOffset + entry.compressedSize
  if (end > bytes.byteLength) throw new TypeError('ZIP entry data is truncated')
  const compressed = bytes.slice(dataOffset, end)
  const result =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? await decompressBounded(compressed, 'deflate-raw', { maxOutputBytes: entry.size })
        : (() => {
            throw new TypeError(`unsupported ZIP compression method ${entry.method}`)
          })()
  if (result.byteLength !== entry.size)
    throw new TypeError('ZIP entry size does not match metadata')
  return result
}

// ---------------------------------------------------------------------------------------------
// ADR-HOST-002 Path A — re-assembly. The codec never writes: `edit.structure` and `edit.content`
// return a whole-source `replace` edit plan carrying a freshly assembled archive, and the host
// commits it under `write-source`. Nothing here recompresses: every surviving entry's local
// header, compressed data and central-directory record are copied byte for byte, and only the
// local-header offset inside the central record is rewritten.

/** The bytes of one entry in the original archive: local header, data, optional descriptor. */
function localBlockRange(bytes, entry) {
  const start = entry.localOffset
  if (start + 30 > bytes.byteLength || u32(bytes, start) !== ZIP_LOCAL) {
    throw new TypeError(`the local header of «${entry.name}» is invalid`)
  }
  const nameLength = u16(bytes, start + 26)
  const extraLength = u16(bytes, start + 28)
  const dataOffset = start + 30 + nameLength + extraLength
  const dataEnd = dataOffset + entry.compressedSize
  if (dataEnd > bytes.byteLength) throw new TypeError(`the data of «${entry.name}» is truncated`)
  return Object.freeze({
    start,
    nameLength,
    extraLength,
    dataOffset,
    dataEnd,
    end: dataEnd + descriptorLength(bytes, entry, dataEnd),
  })
}

/**
 * Length of the streaming data descriptor that follows an entry written with flag bit 3. Its
 * values must agree with the central directory, otherwise the archive is not safely copyable.
 */
function descriptorLength(bytes, entry, dataEnd) {
  if ((entry.flags & FLAG_DESCRIPTOR) === 0) return 0
  const signed = dataEnd + 4 <= bytes.byteLength && u32(bytes, dataEnd) === ZIP_DESCRIPTOR
  const at = signed ? dataEnd + 4 : dataEnd
  if (at + 12 > bytes.byteLength)
    throw new TypeError(`the data descriptor of «${entry.name}» is truncated`)
  if (
    u32(bytes, at) !== entry.crc ||
    u32(bytes, at + 4) !== entry.compressedSize ||
    u32(bytes, at + 8) !== entry.size
  ) {
    throw new TypeError(
      `the data descriptor of «${entry.name}» disagrees with the central directory`,
    )
  }
  return (signed ? 4 : 0) + 12
}

/** Every field of one central-directory record, so a rebuild reproduces it byte for byte. */
function centralFieldsOf(bytes, entry) {
  const at = entry.centralOffset
  const nameAt = at + 46
  const extraAt = nameAt + u16(bytes, at + 28)
  const commentAt = extraAt + u16(bytes, at + 30)
  return Object.freeze({
    versionMadeBy: u16(bytes, at + 4),
    versionNeeded: u16(bytes, at + 6),
    flags: u16(bytes, at + 8),
    method: u16(bytes, at + 10),
    dosTime: u16(bytes, at + 12),
    dosDate: u16(bytes, at + 14),
    crc: u32(bytes, at + 16),
    compressedSize: u32(bytes, at + 20),
    size: u32(bytes, at + 24),
    diskStart: u16(bytes, at + 34),
    internalAttributes: u16(bytes, at + 36),
    externalAttributes: u32(bytes, at + 38),
    nameBytes: bytes.subarray(nameAt, extraAt),
    extraBytes: bytes.subarray(extraAt, commentAt),
    commentBytes: bytes.subarray(commentAt, at + entry.centralLength),
  })
}

/** Header ids of a well-formed extra field; a malformed field is a refusal, never a guess. */
function extraFieldIds(extra) {
  const ids = []
  let cursor = 0
  while (cursor + 4 <= extra.byteLength) {
    ids.push(u16(extra, cursor))
    cursor += 4 + u16(extra, cursor + 2)
  }
  if (cursor !== extra.byteLength) throw new TypeError('a ZIP extra field is malformed')
  return ids
}

function localHeaderFor(fields) {
  const header = new Uint8Array(30 + fields.nameBytes.byteLength + fields.extraBytes.byteLength)
  const view = new DataView(header.buffer)
  view.setUint32(0, ZIP_LOCAL, true)
  view.setUint16(4, fields.versionNeeded, true)
  view.setUint16(6, fields.flags, true)
  view.setUint16(8, fields.method, true)
  view.setUint16(10, fields.dosTime, true)
  view.setUint16(12, fields.dosDate, true)
  view.setUint32(14, fields.crc, true)
  view.setUint32(18, fields.compressedSize, true)
  view.setUint32(22, fields.size, true)
  view.setUint16(26, fields.nameBytes.byteLength, true)
  view.setUint16(28, fields.extraBytes.byteLength, true)
  header.set(fields.nameBytes, 30)
  header.set(fields.extraBytes, 30 + fields.nameBytes.byteLength)
  return header
}

/** The local-header offset (bytes 42..46) stays zero here; `assembleArchive` patches it. */
function centralRecordFor(fields) {
  const nameLength = fields.nameBytes.byteLength
  const extraLength = fields.extraBytes.byteLength
  const commentLength = fields.commentBytes.byteLength
  const record = new Uint8Array(46 + nameLength + extraLength + commentLength)
  const view = new DataView(record.buffer)
  view.setUint32(0, ZIP_CENTRAL, true)
  view.setUint16(4, fields.versionMadeBy, true)
  view.setUint16(6, fields.versionNeeded, true)
  view.setUint16(8, fields.flags, true)
  view.setUint16(10, fields.method, true)
  view.setUint16(12, fields.dosTime, true)
  view.setUint16(14, fields.dosDate, true)
  view.setUint32(16, fields.crc, true)
  view.setUint32(20, fields.compressedSize, true)
  view.setUint32(24, fields.size, true)
  view.setUint16(28, nameLength, true)
  view.setUint16(30, extraLength, true)
  view.setUint16(32, commentLength, true)
  view.setUint16(34, fields.diskStart, true)
  view.setUint16(36, fields.internalAttributes, true)
  view.setUint32(38, fields.externalAttributes, true)
  record.set(fields.nameBytes, 46)
  record.set(fields.extraBytes, 46 + nameLength)
  record.set(fields.commentBytes, 46 + nameLength + extraLength)
  return record
}

function encodedName(name) {
  const nameBytes = encoder.encode(name)
  if (nameBytes.byteLength === 0) throw new TypeError('a ZIP entry path cannot be empty')
  if (nameBytes.byteLength > MAX_U16)
    throw new RangeError(`the ZIP entry path «${name}» is too long`)
  return nameBytes
}

const needsUtf8Flag = nameBytes => nameBytes.some(byte => byte >= 0x80)

/** An untouched entry: local block and central record copied verbatim. */
function verbatimEntry(bytes, entry, range) {
  return Object.freeze({
    name: entry.name,
    local: Object.freeze([bytes.subarray(range.start, range.end)]),
    central: bytes.slice(entry.centralOffset, entry.centralOffset + entry.centralLength),
  })
}

/** A renamed entry: data verbatim, name bytes rewritten in both headers, everything else kept. */
function renamedEntry(bytes, entry, range, newName) {
  const nameBytes = encodedName(newName)
  const fields = centralFieldsOf(bytes, entry)
  const localExtra = bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset)
  if (
    extraFieldIds(fields.extraBytes).includes(EXTRA_UNICODE_PATH) ||
    extraFieldIds(localExtra).includes(EXTRA_UNICODE_PATH)
  ) {
    throw new TypeError(
      `«${entry.name}» carries an Info-ZIP Unicode Path extra field; renaming it would leave stale metadata behind`,
    )
  }
  const utf8Needed = needsUtf8Flag(nameBytes)
  if (utf8Needed && (entry.flags & FLAG_UTF8_NAMES) === 0 && fields.commentBytes.byteLength > 0) {
    throw new TypeError(
      `renaming «${entry.name}» to a non-ASCII path would reinterpret its entry comment as UTF-8`,
    )
  }
  const flags = utf8Needed ? entry.flags | FLAG_UTF8_NAMES : entry.flags
  const header = localHeaderFor({
    versionNeeded: u16(bytes, range.start + 4),
    flags,
    method: u16(bytes, range.start + 8),
    dosTime: u16(bytes, range.start + 10),
    dosDate: u16(bytes, range.start + 12),
    crc: u32(bytes, range.start + 14),
    compressedSize: u32(bytes, range.start + 18),
    size: u32(bytes, range.start + 22),
    nameBytes,
    extraBytes: localExtra,
  })
  return Object.freeze({
    name: newName,
    local: Object.freeze([header, bytes.subarray(range.dataOffset, range.end)]),
    central: centralRecordFor({ ...fields, flags, nameBytes }),
  })
}

/** `edit.content`: new bytes stored (method 0); timestamps, extra fields and comment survive. */
function restoredEntry(bytes, entry, range, data) {
  const fields = centralFieldsOf(bytes, entry)
  const flags = entry.flags & ~(FLAG_DESCRIPTOR | FLAG_COMPRESSION_OPTIONS)
  const crc = crc32(data)
  const header = localHeaderFor({
    versionNeeded: u16(bytes, range.start + 4),
    flags,
    method: STORED,
    dosTime: u16(bytes, range.start + 10),
    dosDate: u16(bytes, range.start + 12),
    crc,
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes: bytes.subarray(range.start + 30, range.start + 30 + range.nameLength),
    extraBytes: bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset),
  })
  return Object.freeze({
    name: entry.name,
    local: Object.freeze([header, data]),
    central: centralRecordFor({
      ...fields,
      flags,
      method: STORED,
      crc,
      compressedSize: data.byteLength,
      size: data.byteLength,
    }),
  })
}

/** A new entry: stored (method 0), CRC-32 over the payload, DOS-epoch timestamp. */
function storedEntry(name, data) {
  const directory = name.endsWith('/')
  if (directory && data.byteLength > 0)
    throw new TypeError(`«${name}» is a directory entry and carries no bytes`)
  const nameBytes = encodedName(name)
  const shared = {
    versionNeeded: VERSION_STORED,
    flags: needsUtf8Flag(nameBytes) ? FLAG_UTF8_NAMES : 0,
    method: STORED,
    dosTime: 0,
    dosDate: DOS_EPOCH_DATE,
    crc: directory ? 0 : crc32(data),
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes,
    extraBytes: EMPTY,
  }
  return Object.freeze({
    name,
    local: Object.freeze([localHeaderFor(shared), data]),
    central: centralRecordFor({
      ...shared,
      versionMadeBy: VERSION_MADE_BY,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: directory ? 0x10 : 0,
      commentBytes: EMPTY,
    }),
  })
}

function assembleArchive(planned, comment, budget) {
  if (planned.length > MAX_U16) {
    throw new RangeError('the edited archive would need ZIP64: more than 65535 entries')
  }
  if (planned.length > budget.maxNodes) {
    throw new RangeError('the edited archive exceeds the maxNodes budget')
  }
  let localTotal = 0
  let centralTotal = 0
  for (const item of planned) {
    for (const part of item.local) localTotal += part.byteLength
    centralTotal += item.central.byteLength
  }
  const total = localTotal + centralTotal + 22 + comment.byteLength
  if (total > MAX_U32) {
    throw new RangeError('the edited archive would need ZIP64: more than 4 GiB of output')
  }
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError('the edited archive exceeds the maxInputBytes budget')
  }
  const out = new Uint8Array(total)
  let cursor = 0
  for (const item of planned) {
    new DataView(item.central.buffer, item.central.byteOffset, item.central.byteLength).setUint32(
      42,
      cursor,
      true,
    )
    for (const part of item.local) {
      out.set(part, cursor)
      cursor += part.byteLength
    }
  }
  const centralStart = cursor
  for (const item of planned) {
    out.set(item.central, cursor)
    cursor += item.central.byteLength
  }
  const view = new DataView(out.buffer)
  view.setUint32(cursor, ZIP_EOCD, true)
  view.setUint16(cursor + 4, 0, true)
  view.setUint16(cursor + 6, 0, true)
  view.setUint16(cursor + 8, planned.length, true)
  view.setUint16(cursor + 10, planned.length, true)
  view.setUint32(cursor + 12, centralTotal, true)
  view.setUint32(cursor + 16, centralStart, true)
  view.setUint16(cursor + 20, comment.byteLength, true)
  out.set(comment, cursor + 22)
  return out
}

const refusal = (code, message) => Object.freeze({ code, message })
const messageOf = error => (error instanceof Error ? error.message : String(error))

/**
 * What re-assembly needs, decided once per open. A `refusal` means the archive is not safely
 * copyable — the mutating operations throw it and the descriptor carries it as a diagnostic;
 * `canonical` records whether the original layout is exactly "entries, directory, EOCD" with no
 * unreferenced bytes, which is what makes `preservesUnknownData: true` provable.
 */
function archiveEditModel(bytes, entries) {
  try {
    const eocd = findEocd(bytes)
    if (eocd < 0) throw new TypeError('the end-of-central-directory record is missing')
    const commentLength = u16(bytes, eocd + 20)
    if (eocd + 22 + commentLength > bytes.byteLength) {
      throw new TypeError('the archive comment is truncated')
    }
    if (eocd >= 20 && u32(bytes, eocd - 20) === ZIP64_LOCATOR) {
      return refusal(
        'x3.codec/zip-edit-zip64',
        'this archive carries a ZIP64 end-of-central-directory locator; editing it needs a dedicated ZIP64 codec profile',
      )
    }
    const ranges = new Map()
    const names = new Set()
    for (const entry of entries) {
      if ((entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
        return refusal(
          'x3.codec/zip-edit-encrypted',
          `«${entry.name}» is encrypted; this codec never re-assembles an archive it cannot read`,
        )
      }
      if (
        entry.compressedSize === MAX_U32 ||
        entry.size === MAX_U32 ||
        entry.localOffset === MAX_U32
      ) {
        return refusal(
          'x3.codec/zip-edit-zip64',
          `«${entry.name}» stores its size or offset in a ZIP64 extended-information field; editing it needs a dedicated ZIP64 codec profile`,
        )
      }
      if (names.has(entry.name)) {
        return refusal(
          'x3.codec/zip-edit-layout',
          `«${entry.name}» appears twice in the central directory; editing by path would be ambiguous`,
        )
      }
      names.add(entry.name)
      const range = localBlockRange(bytes, entry)
      const fields = centralFieldsOf(bytes, entry)
      const localExtra = bytes.subarray(range.start + 30 + range.nameLength, range.dataOffset)
      if (
        extraFieldIds(fields.extraBytes).includes(EXTRA_ZIP64) ||
        extraFieldIds(localExtra).includes(EXTRA_ZIP64)
      ) {
        return refusal(
          'x3.codec/zip-edit-zip64',
          `«${entry.name}» carries a ZIP64 extended-information extra field; editing it needs a dedicated ZIP64 codec profile`,
        )
      }
      ranges.set(entry.id, range)
    }
    const centralOffset = u32(bytes, eocd + 16)
    const centralSize = u32(bytes, eocd + 12)
    let prefix = centralOffset
    for (const entry of entries) prefix = Math.min(prefix, ranges.get(entry.id)?.start ?? 0)
    if (prefix !== 0) {
      return refusal(
        'x3.codec/zip-edit-layout',
        'this archive has data before its first entry (a self-extracting stub); re-assembling it would invalidate the offsets embedded in that prefix',
      )
    }
    let cursor = 0
    let contiguous = true
    for (const entry of entries) {
      const range = ranges.get(entry.id)
      if (range === undefined) continue
      if (range.start !== cursor) contiguous = false
      cursor = range.end
    }
    const canonical =
      contiguous &&
      cursor === centralOffset &&
      centralOffset + centralSize === eocd &&
      eocd + 22 + commentLength === bytes.byteLength
    return Object.freeze({
      ranges,
      canonical,
      comment: bytes.slice(eocd + 22, eocd + 22 + commentLength),
    })
  } catch (error) {
    return refusal(
      'x3.codec/zip-edit-layout',
      `this archive cannot be re-assembled safely: ${messageOf(error)}`,
    )
  }
}

const PRESERVED_NOTES = Object.freeze([
  'untouched entries keep their local header, compressed data and central-directory record byte for byte; only the local-header offset inside the central record is rewritten',
  'compression method, CRC-32, sizes, timestamps, extra fields, entry comments and the archive comment are preserved; nothing is recompressed',
  'added and replaced entries are stored (method 0) with a freshly computed CRC-32 and the DOS-epoch timestamp',
])
const NON_CANONICAL_NOTE =
  'this archive is not a canonical ZIP layout (gaps between entries, reordered entries or trailing bytes): re-assembly keeps only what the central directory references'

function fidelityFor(canonical) {
  return {
    roundTrip: 'semantic',
    preservesUnknownData: canonical,
    notes: canonical ? [...PRESERVED_NOTES] : [...PRESERVED_NOTES, NON_CANONICAL_NOTE],
  }
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

function decodeBase64(value, limit, label) {
  if (typeof value !== 'string' || !BASE64.test(value)) {
    throw new TypeError(`${label} must be standard base64 without padding errors or whitespace`)
  }
  if ((value.length / 4) * 3 > limit) {
    throw new RangeError(`${label} exceeds the maxScalarBytes budget`)
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  if (bytes.byteLength > limit) throw new RangeError(`${label} exceeds the maxScalarBytes budget`)
  return bytes
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} expects an object`)
  }
  return value
}

function requireList(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value
}

/** Refuses before any bytes are produced, so an unsupported archive never yields a plan. */
function usable(model) {
  if ('code' in model) throw new TypeError(model.message)
  return model
}

const EDIT_STRUCTURE_OPERATION = Object.freeze({
  id: 'edit.structure',
  handlerId: 'edit-structure',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  inputSchema: Object.freeze({
    $ref: 'modkit://archive-zip/edit-structure.v1',
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: 'zip-add-entry',
          label: 'Add an entry to the archive',
          summary: 'Adds one stored entry and repacks; kept entries retain their bytes.',
          fields: Object.freeze([
            Object.freeze({
              key: 'path',
              label: 'Entry path',
              type: Object.freeze({ kind: 'path' }),
              inputPath: Object.freeze(['add', 0, 'path']),
              required: true,
              initial: 'added/hello.txt',
            }),
            Object.freeze({
              key: 'content',
              label: 'Contents',
              type: Object.freeze({ kind: 'text' }),
              inputPath: Object.freeze(['add', 0, 'bytes']),
              initial: 'added from the Modkit inspector',
              encoding: 'utf8-base64',
            }),
          ]),
        }),
        Object.freeze({
          id: 'zip-remove-entry',
          label: 'Remove an entry from the archive',
          summary: 'Removes one entry and repacks; other entries retain their bytes.',
          fields: Object.freeze([
            Object.freeze({
              key: 'path',
              label: 'Entry path',
              type: Object.freeze({ kind: 'path' }),
              inputPath: Object.freeze(['remove', 0]),
              required: true,
              initial: 'readme.txt',
            }),
          ]),
        }),
        Object.freeze({
          id: 'zip-rename-entry',
          label: 'Rename an entry in the archive',
          summary: 'Renames one entry without touching its payload or compression.',
          fields: Object.freeze([
            Object.freeze({
              key: 'from',
              label: 'From',
              type: Object.freeze({ kind: 'path' }),
              inputPath: Object.freeze(['rename', 0, 'from']),
              required: true,
              initial: 'readme.txt',
            }),
            Object.freeze({
              key: 'to',
              label: 'To',
              type: Object.freeze({ kind: 'path' }),
              inputPath: Object.freeze(['rename', 0, 'to']),
              required: true,
              initial: 'docs/readme.txt',
            }),
          ]),
        }),
      ]),
    }),
  }),
  outputKinds: Object.freeze(['edit-plan']),
})

const EDIT_CONTENT_OPERATION = Object.freeze({
  id: 'edit.content',
  handlerId: 'edit-content',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  inputSchema: Object.freeze({
    $ref: 'modkit://archive-zip/edit-content.v1',
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: 'zip-replace-entry',
          label: "Replace an entry's contents",
          summary: "Replaces one file entry's payload; nothing else moves.",
          fields: Object.freeze([
            Object.freeze({
              key: 'path',
              label: 'Entry path',
              type: Object.freeze({ kind: 'path' }),
              inputPath: Object.freeze(['path']),
              required: true,
              initial: 'readme.txt',
            }),
            Object.freeze({
              key: 'content',
              label: 'Contents',
              type: Object.freeze({ kind: 'text' }),
              inputPath: Object.freeze(['bytes']),
              initial: 'replaced from the Modkit inspector',
              encoding: 'utf8-base64',
            }),
          ]),
        }),
      ]),
    }),
  }),
  outputKinds: Object.freeze(['edit-plan']),
})

function editPlanOutput(input, assembled, model, planId, label) {
  return {
    kind: 'edit-plan',
    plan: editPlanFromInput(input, {
      planId,
      edits: [{ operation: 'replace', payload: { kind: 'inline', bytes: assembled }, label }],
      fidelity: fidelityFor(model.canonical),
    }),
  }
}

/** `edit.structure`: `{ add: [{path, bytes}], remove: [path], rename: [{from, to}] }`. */
function editStructureHandler(bytes, entries, model, budget, input) {
  return async value => {
    const usableModel = usable(model)
    const request = requireRecord(value, 'edit.structure')
    const additions = requireList(request.add, 'edit.structure add')
    const removals = requireList(request.remove, 'edit.structure remove')
    const renames = requireList(request.rename, 'edit.structure rename')
    if (additions.length + removals.length + renames.length === 0) {
      throw new TypeError('edit.structure needs at least one of add, remove or rename')
    }
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    const removed = new Set()
    for (const item of removals) {
      const path = safePath(String(item))
      if (!byName.has(path)) throw new TypeError(`ZIP entry «${path}» was not found`)
      if (removed.has(path)) throw new TypeError(`«${path}» is removed twice`)
      removed.add(path)
    }
    const renamed = new Map()
    for (const item of renames) {
      const change = requireRecord(item, 'edit.structure rename')
      const from = safePath(String(change.from ?? ''))
      const to = safePath(String(change.to ?? ''))
      const entry = byName.get(from)
      if (entry === undefined) throw new TypeError(`ZIP entry «${from}» was not found`)
      if (removed.has(from)) throw new TypeError(`«${from}» is both removed and renamed`)
      if (renamed.has(from)) throw new TypeError(`«${from}» is renamed twice`)
      if (to === '') throw new TypeError('a rename target cannot be empty')
      if (entry.name.endsWith('/') !== to.endsWith('/')) {
        throw new TypeError(
          `renaming «${from}» to «${to}» would change it between file and directory`,
        )
      }
      renamed.set(from, to)
    }
    const added = []
    for (const item of additions) {
      const change = requireRecord(item, 'edit.structure add')
      const path = safePath(String(change.path ?? ''))
      if (path === '') throw new TypeError('an added entry needs a path')
      added.push({
        path,
        bytes: decodeBase64(change.bytes, budget.maxScalarBytes, `add «${path}»`),
      })
    }
    const planned = []
    const finalNames = new Set()
    const claim = name => {
      if (finalNames.has(name)) throw new TypeError(`«${name}» would appear twice in the archive`)
      finalNames.add(name)
    }
    for (const entry of entries) {
      if (removed.has(entry.name)) continue
      const range = usableModel.ranges.get(entry.id)
      if (range === undefined) throw new TypeError(`«${entry.name}» has no readable local block`)
      const to = renamed.get(entry.name)
      claim(to ?? entry.name)
      planned.push(
        to === undefined
          ? verbatimEntry(bytes, entry, range)
          : renamedEntry(bytes, entry, range, to),
      )
    }
    for (const item of added) {
      claim(item.path)
      planned.push(storedEntry(item.path, item.bytes))
    }
    if (planned.length === 0) throw new TypeError('edit.structure would leave an empty archive')
    const assembled = assembleArchive(planned, usableModel.comment, budget)
    return editPlanOutput(
      input,
      assembled,
      usableModel,
      `zip-edit-structure:+${added.length}-${removed.size}~${renamed.size}`,
      `add ${added.length}, remove ${removed.size}, rename ${renamed.size}`,
    )
  }
}

/** `edit.content`: `{ path, bytes }` replaces one file entry's payload, stored. */
function editContentHandler(bytes, entries, model, budget, input) {
  return async value => {
    const usableModel = usable(model)
    const request = requireRecord(value, 'edit.content')
    const path = safePath(String(request.path ?? ''))
    const target = entries.find(entry => entry.name === path)
    if (target === undefined) throw new TypeError(`ZIP entry «${path}» was not found`)
    if (target.kind !== 'file') throw new TypeError(`«${path}» is a directory entry, not content`)
    const data = decodeBase64(
      request.bytes,
      budget.maxScalarBytes,
      `edit.content bytes for «${path}»`,
    )
    const planned = entries.map(entry => {
      const range = usableModel.ranges.get(entry.id)
      if (range === undefined) throw new TypeError(`«${entry.name}» has no readable local block`)
      return entry.id === target.id
        ? restoredEntry(bytes, entry, range, data)
        : verbatimEntry(bytes, entry, range)
    })
    const assembled = assembleArchive(planned, usableModel.comment, budget)
    return editPlanOutput(
      input,
      assembled,
      usableModel,
      `zip-edit-content:${path}`,
      `replace ${path} (${data.byteLength} bytes, stored)`,
    )
  }
}

/**
 * `container.pack`: the host's standard way to write a member back — entries named by id, pinned
 * to the revision the host read them at — so an application saves an edited entry without knowing
 * this codec's own `edit.content` input. The assembly is the one `edit.content` uses: every other
 * entry is copied verbatim, which is what the verbatim-reassembly evidence proves.
 */
const CONTAINER_PACK_OPERATION = Object.freeze({
  id: 'container.pack',
  handlerId: 'container-pack',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  outputKinds: Object.freeze(['edit-plan']),
})

function containerPackHandler(bytes, entries, model, budget, input, source) {
  return async value => {
    const usableModel = usable(model)
    const request = requireRecord(value, 'container.pack')
    if (request.mode === 'create') {
      throw new TypeError('container.pack creates no ZIP archive here; it edits an existing one')
    }
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const touched = new Set()
    /** A listed member, pinned to the revision the host read, named at most once per request. */
    const member = (item, label) => {
      const change = requireRecord(item, label)
      // the listing names members by path; `entry-N` ids stay accepted
      const entry = byId.get(change.entryId) ?? entries.find(item => item.name === change.entryId)
      if (entry === undefined) {
        throw new TypeError(`ZIP entry id «${String(change.entryId)}» was not found`)
      }
      // the listing pins each member by its own revision (older callers: the archive's)
      const current =
        entry.kind === 'file'
          ? containerEntryRevision(
              revisionId(String(source.revision)),
              entry.name,
              BigInt(entry.size),
            )
          : source.revision
      if (change.expectedRevision !== current && change.expectedRevision !== source.revision) {
        throw new TypeError(`«${entry.name}» changed since it was read`)
      }
      if (touched.has(entry.id)) throw new TypeError(`«${entry.name}» is changed twice`)
      touched.add(entry.id)
      return { change, entry }
    }
    const replaced = new Map()
    for (const item of requireList(request.replacements, 'container.pack replacements')) {
      const { change, entry } = member(item, 'container.pack replacement')
      if (entry.kind !== 'file') throw new TypeError(`«${entry.name}» is a folder, not content`)
      replaced.set(
        entry.id,
        decodeBase64(change.bytesBase64, budget.maxScalarBytes, `bytes for «${entry.name}»`),
      )
    }
    const removed = new Set()
    for (const item of requireList(request.remove, 'container.pack remove')) {
      removed.add(member(item, 'container.pack remove').entry.id)
    }
    const renamed = new Map()
    for (const item of requireList(request.rename, 'container.pack rename')) {
      const { change, entry } = member(item, 'container.pack rename')
      const name = safePath(String(change.name ?? ''))
      if (name === '') throw new TypeError('a rename target cannot be empty')
      if (entry.name.endsWith('/') !== name.endsWith('/')) {
        throw new TypeError(`renaming «${entry.name}» to «${name}» would change its kind`)
      }
      renamed.set(entry.id, name)
    }
    const added = requireList(request.add, 'container.pack add').map(item => {
      const change = requireRecord(item, 'container.pack add')
      const name = safePath(String(change.name ?? ''))
      if (name === '') throw new TypeError('an added member needs a name')
      return {
        name,
        bytes: decodeBase64(change.bytesBase64, budget.maxScalarBytes, `bytes for «${name}»`),
      }
    })
    if (touched.size + added.length === 0) throw new TypeError('container.pack names no change')

    const names = new Set()
    const claim = name => {
      if (names.has(name)) throw new TypeError(`«${name}» would appear twice in the archive`)
      names.add(name)
    }
    const planned = []
    for (const entry of entries) {
      if (removed.has(entry.id)) continue
      const range = usableModel.ranges.get(entry.id)
      if (range === undefined) throw new TypeError(`«${entry.name}» has no readable local block`)
      const data = replaced.get(entry.id)
      const to = renamed.get(entry.id)
      claim(to ?? entry.name)
      planned.push(
        data !== undefined
          ? restoredEntry(bytes, entry, range, data)
          : to !== undefined
            ? renamedEntry(bytes, entry, range, to)
            : verbatimEntry(bytes, entry, range),
      )
    }
    for (const item of added) {
      claim(item.name)
      planned.push(storedEntry(item.name, item.bytes))
    }
    if (planned.length === 0) throw new TypeError('container.pack would leave an empty archive')
    const summary = [
      ...[...replaced.keys()].map(id => `replace ${byId.get(id).name}`),
      ...added.map(item => `add ${item.name}`),
      ...[...removed].map(id => `remove ${byId.get(id).name}`),
      ...[...renamed].map(([id, name]) => `rename ${byId.get(id).name} → ${name}`),
    ]
    return editPlanOutput(
      input,
      assembleArchive(planned, usableModel.comment, budget),
      usableModel,
      `zip-container-pack:${summary.join(';')}`,
      summary.join(', '),
    )
  }
}

/**
 * Hidden by convention: macOS resource forks (`__MACOSX/`), dot names (`.DS_Store`, `.git/`) and
 * Windows thumbnails; any hidden folder hides what is under it.
 */
function hiddenZipPath(name) {
  return name
    .replace(/\/$/u, '')
    .split('/')
    .some(part => part === '__MACOSX' || part.startsWith('.') || part.toLowerCase() === 'thumbs.db')
}

const definition = Object.freeze({
  id: 'modkit/archive-zip',
  format: Object.freeze({ id: 'zip', label: 'ZIP archive', mediaType: 'application/zip' }),
  // any size: the directory is read by ranges; an archive within the budget is also editable
  access: 'ranges',
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: CONTAINER_EXTRACT_HANDLER_ID,
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
    EDIT_STRUCTURE_OPERATION,
    EDIT_CONTENT_OPERATION,
    CONTAINER_PACK_OPERATION,
  ]),
  async detect(bytes) {
    const signature = bytes.byteLength >= 4 ? u32(bytes, 0) : 0
    const match = signature === ZIP_LOCAL || signature === ZIP_EOCD
    /*
     * 0.95, not 0.99, and the four hundredths are the whole point.
     *
     * ZIP is a *carrier*: ODF, OOXML, Warzone `.wz`, JAR, EPUB and a dozen game packages are all
     * "a ZIP plus something". Every one of those reads the same four magic bytes this does and then
     * reads more — an uncompressed `mimetype` entry, a manifest, a declared layout. A carrier that
     * scored as high as its passengers produced an exact tie, and the host's untie rule refuses to
     * guess between equals: before block 12 slice 12-2 an `.odt` and a `.wz` did not open at all in
     * any host that loaded this extension beside theirs.
     *
     * So the generic container sits one step below anything that matched this magic *and* its own
     * structure. This is a floor for the whole class rather than a tweak for two formats: the next
     * ZIP-backed format is protected without editing this line again.
     */
    return { confidence: match ? 0.95 : 0.01, note: match ? 'zip-signature' : 'signature-mismatch' }
  },
  async inspect(context) {
    const size = Number(await context.byteSource.size())
    const maxRead = Number(context.budget.maxInputBytes)
    const read = async (offset, length) => {
      const bytes = await context.byteSource.read(BigInt(offset), length, context.signal)
      if (bytes.byteLength !== length) throw new TypeError('ZIP archive is truncated')
      return bytes
    }
    // Within the budget the whole archive is held, as re-assembly needs; beyond it, only ranges.
    const whole = size <= maxRead ? await read(0, size) : undefined
    const bytes = whole ?? EMPTY
    const entries =
      whole === undefined
        ? await readZipDirectory(read, size, context.budget.maxNodes, maxRead)
        : parseZipArchive(whole, context.budget.maxNodes)
    const containerEntries = await zipEntryTable(
      entries,
      whole === undefined
        ? read
        : async (offset, length) => whole.subarray(offset, offset + length),
      size,
    )
    const files = entries.filter(entry => entry.kind === 'file')
    const directories = entries.length - files.length
    const uncompressedBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    const model =
      whole === undefined
        ? refusal(
            'x3.codec/zip-edit-too-large',
            `the archive (${size} bytes) is larger than the edit budget of ${maxRead} bytes`,
          )
        : archiveEditModel(whole, entries)
    const editable = !('code' in model)
    const tree = createTreeDataSource({
      kind: 'archive',
      label: 'ZIP',
      preview: `${files.length} files`,
      children: entries.map(entry => ({
        kind: entry.kind,
        label: entry.name,
        preview:
          entry.kind === 'file' ? `${entry.size} bytes, method ${entry.method}` : 'directory',
      })),
    })
    return {
      containerEntries,
      summary: {
        format: 'zip',
        entries: entries.length,
        files: files.length,
        directories,
        uncompressedBytes: uncompressedBytes.toString(10),
        editable,
        preservesUnknownData: editable && model.canonical,
      },
      metadata: [
        {
          id: 'zip-directory',
          label: 'ZIP directory',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'files', value: files.length },
            { key: 'directories', value: directories },
            { key: 'uncompressedBytes', value: uncompressedBytes.toString(10) },
            { key: 'editable', value: editable },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: directories } },
        {
          id: 'container.compression',
          parameters: { methods: [...new Set(files.map(item => item.method))] },
        },
        { id: 'content.binary', parameters: { bytes: String(size) } },
      ],
      diagnostics: editable
        ? []
        : [
            {
              id: 'zip-not-editable',
              category: 'fidelity',
              severity: 'warning',
              code: model.code,
              message: `this archive cannot be edited: ${model.message}`,
            },
          ],
      dataSources: {
        'common.view/tree-data-source': tree,
      },
      handlers: {
        'edit-structure': editStructureHandler(
          bytes,
          entries,
          model,
          context.budget,
          context.input,
        ),
        'edit-content': editContentHandler(bytes, entries, model, context.budget, context.input),
        'container-pack': containerPackHandler(
          bytes,
          entries,
          model,
          context.budget,
          context.input,
          context.source,
        ),
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
