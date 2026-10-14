/**
 * The ZIP writer (PKWARE APPNOTE): local headers, central records and the end of the central
 * directory. One writer: the core ZIP codec assembles its edits with it, and an archive made whole —
 * the single-file UVP (SPEC_UVP §2) — is written by it. Reading ZIP stays with that codec.
 * ZIP64 records use the same bounded, whole-byte assembly as classic ZIP.
 */
import { crc32 } from '../checksum/index.js'

const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const ZIP64_EOCD = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const EXTRA_ZIP64 = 1
/** General-purpose flag bit 11: the entry's name and comment are UTF-8. */
export const ZIP_FLAG_UTF8_NAMES = 0x0800
const MAX_U16 = 0xffff
const MAX_U32 = 0xffffffff
/** 1980-01-01, the DOS epoch: new entries carry a deterministic timestamp, never a clock read. */
const DOS_EPOCH_DATE = 0x0021
const STORED = 0
const VERSION_STORED = 10
const VERSION_MADE_BY = 20
const EMPTY = new Uint8Array(0)
const encoder = new TextEncoder()

/** Locate the single ZIP64 extra without discarding any other extra field. */
function zip64Field(extra: Uint8Array): number | undefined {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength)
  let found: number | undefined
  let at = 0
  while (at + 4 <= extra.byteLength) {
    const length = view.getUint16(at + 2, true)
    if (at + 4 + length > extra.byteLength) throw new TypeError('a ZIP extra field is truncated')
    if (view.getUint16(at, true) === EXTRA_ZIP64) {
      if (found !== undefined) throw new TypeError('duplicate ZIP64 extra fields')
      found = at
    }
    at += 4 + length
  }
  if (at !== extra.byteLength) throw new TypeError('a ZIP extra field is malformed')
  return found
}

function checkedSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid ZIP size or offset')
  return value
}

function sizeExtra(fields: ZipLocalFields, local: boolean): Uint8Array {
  checkedSize(fields.size)
  checkedSize(fields.compressedSize)
  const at = zip64Field(fields.extraBytes)
  // Existing sentinels refer to preserved raw extra values, not to a 4 GiB payload.
  if (at !== undefined && fields.size <= MAX_U32 && fields.compressedSize <= MAX_U32)
    return fields.extraBytes
  if (fields.size < MAX_U32 && fields.compressedSize < MAX_U32) return fields.extraBytes
  if (at !== undefined) throw new TypeError('new ZIP64 sizes require fresh ZIP64 metadata')
  const values = local
    ? [fields.size, fields.compressedSize]
    : [
        ...(fields.size >= MAX_U32 ? [fields.size] : []),
        ...(fields.compressedSize >= MAX_U32 ? [fields.compressedSize] : []),
      ]
  const extra = new Uint8Array(fields.extraBytes.byteLength + 4 + values.length * 8)
  extra.set(fields.extraBytes)
  const view = new DataView(extra.buffer)
  const start = fields.extraBytes.byteLength
  view.setUint16(start, EXTRA_ZIP64, true)
  view.setUint16(start + 2, values.length * 8, true)
  values.forEach((value, index) => view.setBigUint64(start + 4 + index * 8, BigInt(value), true))
  return extra
}

function headerLengths(...fields: Uint8Array[]): void {
  if (fields.some(field => field.byteLength > MAX_U16))
    throw new RangeError('ZIP name, extra field or comment is too long')
}

/** The fields of a local file header. */
export interface ZipLocalFields {
  readonly versionNeeded: number
  readonly flags: number
  readonly method: number
  readonly dosTime: number
  readonly dosDate: number
  readonly crc: number
  readonly compressedSize: number
  readonly size: number
  readonly nameBytes: Uint8Array
  readonly extraBytes: Uint8Array
}

/** The fields of a central-directory record. */
export interface ZipCentralFields extends ZipLocalFields {
  readonly localOffset?: number
  readonly versionMadeBy: number
  readonly diskStart: number
  readonly internalAttributes: number
  readonly externalAttributes: number
  readonly commentBytes: Uint8Array
}

/** One entry as written: its local header and data, and its central record. */
export interface ZipWrittenEntry {
  readonly name: string
  readonly local: readonly Uint8Array[]
  readonly central: Uint8Array
}

export interface ZipWriteBudget {
  readonly maxNodes: number
  readonly maxInputBytes: bigint
}

export function zipLocalHeader(fields: ZipLocalFields): Uint8Array {
  fields = { ...fields, extraBytes: sizeExtra(fields, true) }
  headerLengths(fields.nameBytes, fields.extraBytes)
  const header = new Uint8Array(30 + fields.nameBytes.byteLength + fields.extraBytes.byteLength)
  const view = new DataView(header.buffer)
  view.setUint32(0, ZIP_LOCAL, true)
  view.setUint16(
    4,
    fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32
      ? Math.max(45, fields.versionNeeded)
      : fields.versionNeeded,
    true,
  )
  view.setUint16(6, fields.flags, true)
  view.setUint16(8, fields.method, true)
  view.setUint16(10, fields.dosTime, true)
  view.setUint16(12, fields.dosDate, true)
  view.setUint32(14, fields.crc, true)
  const zip64Sizes = fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32
  view.setUint32(18, zip64Sizes ? MAX_U32 : fields.compressedSize, true)
  view.setUint32(22, zip64Sizes ? MAX_U32 : fields.size, true)
  view.setUint16(26, fields.nameBytes.byteLength, true)
  view.setUint16(28, fields.extraBytes.byteLength, true)
  header.set(fields.nameBytes, 30)
  header.set(fields.extraBytes, 30 + fields.nameBytes.byteLength)
  return header
}

/** Preserve an existing offset sentinel; `assembleZipArchive` sets its resolved value. */
export function zipCentralRecord(fields: ZipCentralFields): Uint8Array {
  if (fields.localOffset !== undefined && checkedSize(fields.localOffset) > MAX_U32)
    throw new RangeError('a ZIP central header offset must be a classic value or ZIP64 sentinel')
  fields = { ...fields, extraBytes: sizeExtra(fields, false) }
  headerLengths(fields.nameBytes, fields.extraBytes, fields.commentBytes)
  const nameLength = fields.nameBytes.byteLength
  const extraLength = fields.extraBytes.byteLength
  const commentLength = fields.commentBytes.byteLength
  const record = new Uint8Array(46 + nameLength + extraLength + commentLength)
  const view = new DataView(record.buffer)
  view.setUint32(0, ZIP_CENTRAL, true)
  view.setUint16(4, fields.versionMadeBy, true)
  view.setUint16(
    6,
    fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32
      ? Math.max(45, fields.versionNeeded)
      : fields.versionNeeded,
    true,
  )
  view.setUint16(8, fields.flags, true)
  view.setUint16(10, fields.method, true)
  view.setUint16(12, fields.dosTime, true)
  view.setUint16(14, fields.dosDate, true)
  view.setUint32(16, fields.crc, true)
  view.setUint32(20, Math.min(MAX_U32, fields.compressedSize), true)
  view.setUint32(24, Math.min(MAX_U32, fields.size), true)
  view.setUint16(28, nameLength, true)
  view.setUint16(30, extraLength, true)
  view.setUint16(32, commentLength, true)
  view.setUint16(34, fields.diskStart, true)
  view.setUint16(36, fields.internalAttributes, true)
  view.setUint32(38, fields.externalAttributes, true)
  view.setUint32(42, fields.localOffset ?? 0, true)
  record.set(fields.nameBytes, 46)
  record.set(fields.extraBytes, 46 + nameLength)
  record.set(fields.commentBytes, 46 + nameLength + extraLength)
  return record
}

/** An entry path as its name bytes: UTF-8, not empty, within a header's 16-bit length. */
export function zipEntryName(name: string): Uint8Array {
  const nameBytes = encoder.encode(name)
  if (nameBytes.byteLength === 0) throw new TypeError('a ZIP entry path cannot be empty')
  if (nameBytes.byteLength > MAX_U16)
    throw new RangeError(`the ZIP entry path «${name}» is too long`)
  return nameBytes
}

/** Whether name bytes need the UTF-8 flag: any byte past ASCII. */
export const zipNeedsUtf8Flag = (nameBytes: Uint8Array): boolean =>
  nameBytes.some(byte => byte >= 0x80)

/** A new entry: stored (method 0), CRC-32 over the payload, DOS-epoch timestamp. */
export function zipStoredEntry(name: string, data: Uint8Array): ZipWrittenEntry {
  const directory = name.endsWith('/')
  if (directory && data.byteLength > 0)
    throw new TypeError(`«${name}» is a directory entry and carries no bytes`)
  const nameBytes = zipEntryName(name)
  const shared = {
    versionNeeded: VERSION_STORED,
    flags: zipNeedsUtf8Flag(nameBytes) ? ZIP_FLAG_UTF8_NAMES : 0,
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
    local: Object.freeze([zipLocalHeader(shared), data]),
    central: zipCentralRecord({
      ...shared,
      versionMadeBy: VERSION_MADE_BY,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: directory ? 0x10 : 0,
      commentBytes: EMPTY,
    }),
  })
}

/**
 * The archive of these entries in order: their local blocks, the central directory (each record
 * pointed at its block) and the end record with `comment`.
 */
export function assembleZipArchive(
  entries: readonly ZipWrittenEntry[],
  comment: Uint8Array,
  budget: ZipWriteBudget,
  forceZip64 = false,
  zip64EndRecord?: Uint8Array,
): Uint8Array {
  headerLengths(comment)
  if (zip64EndRecord !== undefined) {
    const view = new DataView(
      zip64EndRecord.buffer,
      zip64EndRecord.byteOffset,
      zip64EndRecord.byteLength,
    )
    if (
      zip64EndRecord.byteLength !== 56 ||
      view.getUint32(0, true) !== ZIP64_EOCD ||
      view.getBigUint64(4, true) !== 44n ||
      view.getUint32(16, true) !== 0 ||
      view.getUint32(20, true) !== 0
    )
      throw new TypeError('unsupported ZIP64 end record')
  }
  if (entries.length > budget.maxNodes) {
    throw new RangeError('the archive exceeds the maxNodes budget')
  }
  let localTotal = 0
  let centralTotal = 0
  const centrals: Uint8Array[] = []
  let zip64 = forceZip64 || zip64EndRecord !== undefined || entries.length >= MAX_U16
  for (const item of entries) {
    const central = centralAtOffset(item.central, localTotal)
    centrals.push(central)
    const view = new DataView(central.buffer)
    const extraAt = 46 + view.getUint16(28, true)
    if (zip64Field(central.subarray(extraAt, extraAt + view.getUint16(30, true))) !== undefined)
      zip64 = true
    for (const part of item.local) localTotal += part.byteLength
    checkedSize(localTotal)
    centralTotal += central.byteLength
  }
  zip64 ||= localTotal >= MAX_U32 || centralTotal >= MAX_U32
  const total = checkedSize(localTotal + centralTotal + (zip64 ? 76 : 0) + 22 + comment.byteLength)
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError('the archive exceeds the maxInputBytes budget')
  }
  const out = new Uint8Array(total)
  let cursor = 0
  for (const item of entries) {
    for (const part of item.local) {
      out.set(part, cursor)
      cursor += part.byteLength
    }
  }
  const centralStart = cursor
  for (const central of centrals) {
    out.set(central, cursor)
    cursor += central.byteLength
  }
  const view = new DataView(out.buffer)
  if (zip64) {
    const recordOffset = cursor
    if (zip64EndRecord !== undefined) out.set(zip64EndRecord, cursor)
    view.setUint32(cursor, ZIP64_EOCD, true)
    view.setBigUint64(cursor + 4, 44n, true)
    if (zip64EndRecord === undefined) {
      view.setUint16(cursor + 12, 45, true)
      view.setUint16(cursor + 14, 45, true)
    }
    view.setBigUint64(cursor + 24, BigInt(entries.length), true)
    view.setBigUint64(cursor + 32, BigInt(entries.length), true)
    view.setBigUint64(cursor + 40, BigInt(centralTotal), true)
    view.setBigUint64(cursor + 48, BigInt(centralStart), true)
    cursor += 56
    view.setUint32(cursor, ZIP64_LOCATOR, true)
    view.setBigUint64(cursor + 8, BigInt(recordOffset), true)
    view.setUint32(cursor + 16, 1, true)
    cursor += 20
  }
  view.setUint32(cursor, ZIP_EOCD, true)
  view.setUint16(cursor + 4, 0, true)
  view.setUint16(cursor + 6, 0, true)
  view.setUint16(cursor + 8, Math.min(MAX_U16, entries.length), true)
  view.setUint16(cursor + 10, Math.min(MAX_U16, entries.length), true)
  view.setUint32(cursor + 12, Math.min(MAX_U32, centralTotal), true)
  view.setUint32(cursor + 16, Math.min(MAX_U32, centralStart), true)
  view.setUint16(cursor + 20, comment.byteLength, true)
  out.set(comment, cursor + 22)
  return out
}

/** Rewrite the offset where it actually lives; never mutate a caller's preserved record. */
function centralAtOffset(record: Uint8Array, offset: number): Uint8Array {
  checkedSize(offset)
  const result = record.slice()
  const view = new DataView(result.buffer)
  if (result.byteLength < 46 || view.getUint32(0, true) !== ZIP_CENTRAL)
    throw new TypeError('invalid ZIP central record')
  const nameEnd = 46 + view.getUint16(28, true)
  const extraEnd = nameEnd + view.getUint16(30, true)
  if (extraEnd + view.getUint16(32, true) !== result.byteLength)
    throw new TypeError('invalid ZIP central record length')
  const extra = result.subarray(nameEnd, extraEnd)
  const field = zip64Field(extra)
  if (view.getUint16(34, true) !== 0) throw new TypeError('multi-disk ZIP is unsupported')
  const saturated = view.getUint32(42, true) === MAX_U32
  if (saturated) {
    if (field === undefined) throw new TypeError('ZIP64 offset extra is missing')
    const sizeBytes =
      (view.getUint32(24, true) === MAX_U32 ? 8 : 0) +
      (view.getUint32(20, true) === MAX_U32 ? 8 : 0)
    if (view.getUint16(nameEnd + field + 2, true) < sizeBytes + 8)
      throw new TypeError('ZIP64 offset extra is truncated')
    view.setBigUint64(nameEnd + field + 4 + sizeBytes, BigInt(offset), true)
  } else if (offset >= MAX_U32) {
    // Insert after the existing size values and before any unrelated extra fields/comments.
    const insert =
      field === undefined
        ? extraEnd
        : nameEnd + field + 4 + view.getUint16(nameEnd + field + 2, true)
    const added = field === undefined ? 12 : 8
    if (extra.byteLength + added > MAX_U16) throw new RangeError('ZIP64 extra field is too long')
    const expanded = new Uint8Array(result.byteLength + added)
    expanded.set(result.subarray(0, insert))
    expanded.set(result.subarray(insert), insert + added)
    const ev = new DataView(expanded.buffer)
    if (field === undefined) {
      ev.setUint16(insert, EXTRA_ZIP64, true)
      ev.setUint16(insert + 2, 8, true)
    } else ev.setUint16(nameEnd + field + 2, view.getUint16(nameEnd + field + 2, true) + 8, true)
    ev.setBigUint64(insert + (field === undefined ? 4 : 0), BigInt(offset), true)
    ev.setUint16(30, extra.byteLength + added, true)
    ev.setUint16(6, Math.max(45, ev.getUint16(6, true)), true)
    ev.setUint32(42, MAX_U32, true)
    return expanded
  } else view.setUint32(42, offset, true)
  return result
}

/** A new archive of these files, each stored, in this order; a path given twice is refused. */
export function createZipArchive(
  files: Iterable<readonly [string, Uint8Array]>,
  budget: ZipWriteBudget,
): Uint8Array {
  const seen = new Set<string>()
  const entries: ZipWrittenEntry[] = []
  for (const [name, data] of files) {
    if (seen.has(name)) throw new TypeError(`«${name}» would be in the archive twice`)
    seen.add(name)
    entries.push(zipStoredEntry(name, data))
  }
  return assembleZipArchive(entries, EMPTY, budget)
}
