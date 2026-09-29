/**
 * LevelDB, read only (owner decision D3 of the Minecraft plan): the database directory as its
 * live keys and their values, as the database itself would answer after recovery.
 *
 * Files: `CURRENT` names the `MANIFEST-*` whose version edits list the live tables per level and
 * the log numbers still unflushed; tables (`*.ldb`, `*.sst`) are sorted blocks of internal keys
 * (user key + 8-byte sequence and type) behind an index block and a 48-byte footer; logs
 * (`*.log`) and the manifest are 32 KiB blocks of checksummed records, a log's records being write
 * batches. Every block and record is checked against its masked CRC-32C. Block compression: none,
 * and zlib (2) and raw deflate (4) as Mojang's LevelDB for Minecraft Bedrock writes them.
 *
 * Opening reads every live table and log once to learn which version of each key is newest; values
 * are then read block by block on request. Memory is the key index, not the values.
 */

import { crc32c } from '../checksum/index.js'

export interface LevelDbFile {
  readonly name: string
  readonly size: number
}

/** The database directory: its file names and byte ranges of each file. */
export interface LevelDbDirectory {
  list(signal?: AbortSignal): Promise<readonly LevelDbFile[]>
  read(name: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
}

export interface LevelDbOptions {
  /** Live keys at most. Default 10 000 000. */
  readonly maxKeys?: number
  /** A decoded block at most. Default 16 MiB. */
  readonly maxBlockBytes?: number
  /** The manifest and each log, read whole, at most. Default 256 MiB. */
  readonly maxLogBytes?: number
  readonly signal?: AbortSignal
}

export interface LevelDbEntry {
  readonly key: Uint8Array
  readonly value: Uint8Array
}

export interface LevelDb {
  /** Live keys in bytewise order. */
  readonly keys: readonly Uint8Array[]
  get(key: Uint8Array, signal?: AbortSignal): Promise<Uint8Array | undefined>
  /** Live entries whose key starts with `prefix`, in key order. */
  entries(prefix?: Uint8Array, signal?: AbortSignal): AsyncGenerator<LevelDbEntry>
}

const TABLE_MAGIC = [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb] // 0xdb4775248b80fb57 LE
const FOOTER_BYTES = 48
const BLOCK_TRAILER_BYTES = 5
const LOG_BLOCK_BYTES = 32768
const LOG_HEADER_BYTES = 7

function corrupt(message: string): TypeError {
  return new TypeError(`LevelDB ${message}`)
}

/** LevelDB stores CRC-32C rotated and offset, so a CRC of data holding CRCs stays meaningful. */
function unmask(masked: number): number {
  const rotated = (masked - 0xa282ead8) >>> 0
  return ((rotated >>> 17) | (rotated << 15)) >>> 0
}

const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)) +
  (bytes[at + 3] ?? 0) * 0x1000000

class Reader {
  constructor(
    readonly bytes: Uint8Array,
    public at = 0,
    readonly end = bytes.byteLength,
  ) {}

  get done(): boolean {
    return this.at >= this.end
  }

  byte(): number {
    if (this.at >= this.end) throw corrupt('record is truncated')
    return this.bytes[this.at++] ?? 0
  }

  /** A varint of up to 64 bits, within safe integers. */
  varint(): number {
    let value = 0
    for (let shift = 0; shift < 64; shift += 7) {
      const byte = this.byte()
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw corrupt('varint exceeds safe integers')
        return value
      }
    }
    throw corrupt('varint is too long')
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.at + length > this.end) throw corrupt('record is truncated')
    const value = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return value
  }

  lengthPrefixed(): Uint8Array {
    return this.take(this.varint())
  }
}

/** The records of a log-format file (a log or the manifest), whole records reassembled. */
function logRecords(bytes: Uint8Array, tolerateTail: boolean): Uint8Array[] {
  const records: Uint8Array[] = []
  let pending: Uint8Array[] | undefined
  for (let block = 0; block < bytes.byteLength; block += LOG_BLOCK_BYTES) {
    const end = Math.min(bytes.byteLength, block + LOG_BLOCK_BYTES)
    let at = block
    while (end - at >= LOG_HEADER_BYTES) {
      const length = (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8)
      const type = bytes[at + 6] ?? 0
      // a zero type is preallocated space: the rest of the block holds nothing
      if (type === 0 && length === 0) break
      const dataEnd = at + LOG_HEADER_BYTES + length
      const valid =
        type >= 1 &&
        type <= 4 &&
        dataEnd <= end &&
        unmask(u32(bytes, at)) === crc32c(bytes, at + 6, dataEnd)
      if (!valid) {
        // a writer that stopped mid-record leaves a torn tail; recovery drops it
        if (tolerateTail) return records
        throw corrupt(`log record at ${at} is corrupt`)
      }
      const data = bytes.subarray(at + LOG_HEADER_BYTES, dataEnd)
      if (type === 1) {
        records.push(data)
        pending = undefined
      } else if (type === 2) pending = [data]
      else if (pending !== undefined) {
        pending.push(data)
        if (type === 4) {
          const whole = new Uint8Array(pending.reduce((total, part) => total + part.byteLength, 0))
          let offset = 0
          for (const part of pending) {
            whole.set(part, offset)
            offset += part.byteLength
          }
          records.push(whole)
          pending = undefined
        }
      } else if (!tolerateTail) throw corrupt(`log record at ${at} continues nothing`)
      at = dataEnd
    }
  }
  return records
}

interface TableFile {
  readonly level: number
  readonly number: number
}

interface Version {
  readonly tables: readonly TableFile[]
  readonly logNumber: number
  readonly prevLogNumber: number
}

/** Apply the manifest's version edits in order: the live tables and the unflushed log numbers. */
function currentVersion(manifest: Uint8Array): Version {
  const tables = new Map<string, TableFile>()
  let logNumber = 0
  let prevLogNumber = 0
  for (const record of logRecords(manifest, false)) {
    const edit = new Reader(record)
    while (!edit.done) {
      const tag = edit.varint()
      switch (tag) {
        case 1: {
          const comparator = new TextDecoder().decode(edit.lengthPrefixed())
          if (comparator !== 'leveldb.BytewiseComparator')
            throw corrupt(`comparator ${comparator} is not supported`)
          break
        }
        case 2:
          logNumber = edit.varint()
          break
        case 3: // next file number
        case 4: // last sequence
          edit.varint()
          break
        case 5: // compaction pointer
          edit.varint()
          edit.lengthPrefixed()
          break
        case 6: {
          const level = edit.varint()
          tables.delete(`${level}:${edit.varint()}`)
          break
        }
        case 7: {
          const level = edit.varint()
          const number = edit.varint()
          edit.varint() // size
          edit.lengthPrefixed() // smallest key
          edit.lengthPrefixed() // largest key
          tables.set(`${level}:${number}`, { level, number })
          break
        }
        case 9:
          prevLogNumber = edit.varint()
          break
        default:
          throw corrupt(`manifest tag ${tag} is unknown`)
      }
    }
  }
  return { tables: [...tables.values()], logNumber, prevLogNumber }
}

type Location =
  | { readonly kind: 'log'; readonly value: Uint8Array }
  | {
      readonly kind: 'table'
      readonly file: string
      readonly block: BlockHandle
      readonly valueOffset: number
      readonly valueLength: number
    }

interface KeyVersion {
  readonly sequence: number
  readonly deleted: boolean
  readonly location?: Location
}

interface BlockHandle {
  readonly offset: number
  readonly size: number
}

function blockHandle(reader: Reader): BlockHandle {
  return { offset: reader.varint(), size: reader.varint() }
}

/** Each entry of a decoded block: the whole key rebuilt from shared prefixes, and the value. */
function* blockEntries(
  block: Uint8Array,
): Generator<{ key: Uint8Array; valueOffset: number; valueLength: number }> {
  if (block.byteLength < 4) throw corrupt('block is truncated')
  const restarts = u32(block, block.byteLength - 4)
  const dataEnd = block.byteLength - 4 - restarts * 4
  if (restarts < 1 || dataEnd < 0) throw corrupt('block restart array is invalid')
  const reader = new Reader(block, 0, dataEnd)
  let key = new Uint8Array(0)
  while (!reader.done) {
    const shared = reader.varint()
    const unshared = reader.varint()
    const valueLength = reader.varint()
    if (shared > key.byteLength) throw corrupt('block key shares more than the previous key')
    const next = new Uint8Array(shared + unshared)
    next.set(key.subarray(0, shared))
    next.set(reader.take(unshared), shared)
    key = next
    const valueOffset = reader.at
    reader.take(valueLength)
    yield { key, valueOffset, valueLength }
  }
}

const latin1 = (bytes: Uint8Array) => {
  let out = ''
  for (let at = 0; at < bytes.byteLength; at += 4096)
    out += String.fromCharCode(...bytes.subarray(at, at + 4096))
  return out
}

const bytesOf = (key: string) => {
  const bytes = new Uint8Array(key.length)
  for (let at = 0; at < key.length; at += 1) bytes[at] = key.charCodeAt(at)
  return bytes
}

/** An internal key's trailer: sequence (56 bits) and type, 1 value or 0 deletion. */
function trailer(key: Uint8Array): { user: Uint8Array; sequence: number; type: number } {
  if (key.byteLength < 8) throw corrupt('internal key is shorter than its trailer')
  const at = key.byteLength - 8
  const low = u32(key, at)
  const high = u32(key, at + 4)
  return {
    user: key.subarray(0, at),
    sequence: high * 2 ** 24 + Math.floor(low / 256),
    type: low & 0xff,
  }
}

export async function openLevelDb(
  directory: LevelDbDirectory,
  options: LevelDbOptions = {},
): Promise<LevelDb> {
  const maxKeys = options.maxKeys ?? 10_000_000
  const maxBlockBytes = options.maxBlockBytes ?? 16 * 1024 * 1024
  const maxLogBytes = options.maxLogBytes ?? 256 * 1024 * 1024
  const signal = options.signal
  const files = new Map((await directory.list(signal)).map(file => [file.name, file.size]))
  const whole = async (name: string) => {
    const size = files.get(name)
    if (size === undefined) throw corrupt(`${name} is missing`)
    if (size > maxLogBytes)
      throw new RangeError(`LevelDB ${name} exceeds the ${maxLogBytes}-byte budget`)
    return size === 0 ? new Uint8Array(0) : directory.read(name, 0, size, signal)
  }
  if (!files.has('CURRENT')) throw corrupt('directory has no CURRENT file')
  const current = new TextDecoder().decode(await whole('CURRENT')).replace(/\r?\n$/u, '')
  if (!/^MANIFEST-\d+$/u.test(current)) throw corrupt(`CURRENT names ${JSON.stringify(current)}`)
  const version = currentVersion(await whole(current))

  const decoded = new Map<string, Promise<Uint8Array>>()
  const readBlock = (file: string, handle: BlockHandle): Promise<Uint8Array> => {
    const key = `${file}@${handle.offset}`
    let pending = decoded.get(key)
    if (pending === undefined) {
      pending = decodeBlock(file, handle)
      // a small cache: entries are asked for in key order, which is block order within a table
      if (decoded.size >= 16) decoded.delete(decoded.keys().next().value as string)
      decoded.set(key, pending)
      pending.catch(() => decoded.delete(key))
    }
    return pending
  }
  const decodeBlock = async (file: string, handle: BlockHandle): Promise<Uint8Array> => {
    const size = files.get(file) ?? 0
    if (handle.offset + handle.size + BLOCK_TRAILER_BYTES > size)
      throw corrupt(`block of ${file} runs past the file`)
    if (handle.size > maxBlockBytes)
      throw new RangeError(`LevelDB block exceeds the ${maxBlockBytes}-byte budget`)
    const raw = await directory.read(file, handle.offset, handle.size + BLOCK_TRAILER_BYTES, signal)
    const type = raw[handle.size] ?? 0
    if (unmask(u32(raw, handle.size + 1)) !== crc32c(raw, 0, handle.size + 1))
      throw corrupt(`block at ${handle.offset} of ${file} fails its CRC-32C`)
    const body = raw.subarray(0, handle.size)
    if (type === 0) return body
    if (type !== 2 && type !== 4)
      // ponytail: snappy (1) and zstd are not read; Bedrock writes zlib, add them with a user
      throw corrupt(`block compression ${type} is not supported`)
    const { decompressBounded } = await import('../compression/bounded.js')
    return decompressBounded(body, type === 2 ? 'deflate' : 'deflate-raw', {
      maxOutputBytes: maxBlockBytes,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  const newest = new Map<string, KeyVersion>()
  const note = (user: Uint8Array, entry: KeyVersion) => {
    const key = latin1(user)
    const known = newest.get(key)
    if (known !== undefined && known.sequence >= entry.sequence) return
    if (known === undefined && newest.size >= maxKeys)
      throw new RangeError(`LevelDB holds more than ${maxKeys} keys`)
    newest.set(key, entry)
  }
  const tableNames = new Map<number, string>()
  for (const name of files.keys()) {
    const match = /^(\d+)\.(ldb|sst)$/u.exec(name)
    if (match !== null) tableNames.set(Number(match[1]), name)
  }
  for (const table of version.tables) {
    signal?.throwIfAborted()
    const file = tableNames.get(table.number)
    if (file === undefined) throw corrupt(`live table ${table.number} is missing`)
    const size = files.get(file) ?? 0
    if (size < FOOTER_BYTES) throw corrupt(`table ${file} is shorter than its footer`)
    const footer = await directory.read(file, size - FOOTER_BYTES, FOOTER_BYTES, signal)
    if (!TABLE_MAGIC.every((value, at) => footer[40 + at] === value))
      throw corrupt(`table ${file} has no table magic`)
    const handles = new Reader(footer, 0, 40)
    blockHandle(handles) // metaindex: filters only
    const index = await readBlock(file, blockHandle(handles))
    for (const item of blockEntries(index)) {
      const handle = blockHandle(
        new Reader(index, item.valueOffset, item.valueOffset + item.valueLength),
      )
      const block = await readBlock(file, handle)
      for (const entry of blockEntries(block)) {
        const { user, sequence, type } = trailer(entry.key)
        note(
          user,
          type === 1
            ? {
                sequence,
                deleted: false,
                location: {
                  kind: 'table',
                  file,
                  block: handle,
                  valueOffset: entry.valueOffset,
                  valueLength: entry.valueLength,
                },
              }
            : { sequence, deleted: true },
        )
      }
    }
  }
  const logs = [...files.keys()]
    .map(name => /^(\d+)\.log$/u.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => Number(match[1]))
    .filter(number => number >= version.logNumber || number === version.prevLogNumber)
    .sort((a, b) => a - b)
  for (const number of logs) {
    signal?.throwIfAborted()
    const name = `${String(number).padStart(6, '0')}.log`
    for (const record of logRecords(await whole(name), true)) {
      const batch = new Reader(record)
      const low = u32(record, 0)
      const high = u32(record, 4)
      batch.take(8)
      let sequence = high * 2 ** 32 + low
      const count = u32(record, 8)
      batch.take(4)
      for (let index = 0; index < count; index += 1, sequence += 1) {
        const type = batch.byte()
        const user = batch.lengthPrefixed()
        if (type === 1)
          note(user, {
            sequence,
            deleted: false,
            location: { kind: 'log', value: batch.lengthPrefixed().slice() },
          })
        else if (type === 0) note(user, { sequence, deleted: true })
        else throw corrupt(`write batch record type ${type} is unknown`)
      }
    }
  }

  const live = [...newest.entries()].filter(([, entry]) => !entry.deleted).map(([key]) => key)
  live.sort()
  const keys = Object.freeze(live.map(bytesOf))
  const get = async (key: Uint8Array, readSignal?: AbortSignal) => {
    readSignal?.throwIfAborted()
    const location = newest.get(latin1(key))?.location
    if (location === undefined) return undefined
    if (location.kind === 'log') return location.value.slice()
    const block = await readBlock(location.file, location.block)
    return block.slice(location.valueOffset, location.valueOffset + location.valueLength)
  }
  return Object.freeze({
    keys,
    get,
    async *entries(prefix = new Uint8Array(0), readSignal?: AbortSignal) {
      const start = latin1(prefix)
      for (let index = lowerBound(live, start); index < live.length; index += 1) {
        const key = live[index] as string
        if (!key.startsWith(start)) break
        const value = await get(keys[index] as Uint8Array, readSignal)
        if (value !== undefined) yield { key: keys[index] as Uint8Array, value }
      }
    },
  })
}

function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((sorted[middle] as string) < value) low = middle + 1
    else high = middle
  }
  return low
}
