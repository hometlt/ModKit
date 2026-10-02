/**
 * The ZIP writer (PKWARE APPNOTE): local headers, central records and the end of the central
 * directory. One writer: the core ZIP codec assembles its edits with it, and an archive made whole —
 * the single-file UVP (SPEC_UVP §2) — is written by it. Reading ZIP stays with that codec. No ZIP64:
 * an archive of more than 65 535 entries or 4 GiB is refused.
 */
import { crc32 } from '../checksum/index.js'

const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
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

/** The local-header offset (bytes 42..46) stays zero here; `assembleZipArchive` sets it. */
export function zipCentralRecord(fields: ZipCentralFields): Uint8Array {
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
): Uint8Array {
  if (entries.length > MAX_U16) {
    throw new RangeError('the archive would need ZIP64: more than 65535 entries')
  }
  if (entries.length > budget.maxNodes) {
    throw new RangeError('the archive exceeds the maxNodes budget')
  }
  let localTotal = 0
  let centralTotal = 0
  for (const item of entries) {
    for (const part of item.local) localTotal += part.byteLength
    centralTotal += item.central.byteLength
  }
  const total = localTotal + centralTotal + 22 + comment.byteLength
  if (total > MAX_U32) {
    throw new RangeError('the archive would need ZIP64: more than 4 GiB of output')
  }
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError('the archive exceeds the maxInputBytes budget')
  }
  const out = new Uint8Array(total)
  let cursor = 0
  for (const item of entries) {
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
  for (const item of entries) {
    out.set(item.central, cursor)
    cursor += item.central.byteLength
  }
  const view = new DataView(out.buffer)
  view.setUint32(cursor, ZIP_EOCD, true)
  view.setUint16(cursor + 4, 0, true)
  view.setUint16(cursor + 6, 0, true)
  view.setUint16(cursor + 8, entries.length, true)
  view.setUint16(cursor + 10, entries.length, true)
  view.setUint32(cursor + 12, centralTotal, true)
  view.setUint32(cursor + 16, centralStart, true)
  view.setUint16(cursor + 20, comment.byteLength, true)
  out.set(comment, cursor + 22)
  return out
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
