/**
 * LevelDB reading over a database written here by the rules of LevelDB's own doc/table_format.md
 * and doc/log_format.md (no LevelDB library ships with the workspace): shared-prefix blocks with
 * restarts, raw-deflate blocks as Minecraft Bedrock writes them, an index block and the footer
 * magic; a manifest that adds and then deletes a table; a log whose record crosses a 32 KiB block
 * and ends in a torn tail. `node:zlib` only compresses the fixture's blocks.
 */
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32c } from '../src/checksum/index.js'
import { openLevelDb, type LevelDbDirectory } from '../src/storage/leveldb.js'

const text = (value: string) => new TextEncoder().encode(value)
const concat = (parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}
const varint = (value: number) => {
  const bytes: number[] = []
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  bytes.push(value)
  return Uint8Array.from(bytes)
}
const fixed32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}
const prefixed = (bytes: Uint8Array) => concat([varint(bytes.byteLength), bytes])
const mask = (crc: number) => ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0
const internal = (user: string, sequence: number, type: number) => {
  const tail = new Uint8Array(8)
  new DataView(tail.buffer).setBigUint64(0, (BigInt(sequence) << 8n) | BigInt(type), true)
  return concat([text(user), tail])
}

/** A block: entries sharing prefixes with their predecessor, a restart every `interval`. */
function block(entries: readonly (readonly [Uint8Array, Uint8Array])[], interval = 4) {
  const parts: Uint8Array[] = []
  const restarts: number[] = []
  let offset = 0
  let previous = new Uint8Array(0)
  entries.forEach(([key, value], index) => {
    let shared = 0
    if (index % interval === 0) restarts.push(offset)
    else
      while (shared < previous.length && shared < key.length && previous[shared] === key[shared])
        shared += 1
    const entry = concat([
      varint(shared),
      varint(key.length - shared),
      varint(value.length),
      key.subarray(shared),
      value,
    ])
    parts.push(entry)
    offset += entry.byteLength
    previous = key
  })
  if (restarts.length === 0) restarts.push(0)
  return concat([...parts, ...restarts.map(fixed32), fixed32(restarts.length)])
}

/** A table: data blocks of `perBlock` entries (raw deflate when `compress`), index, footer. */
function table(
  entries: readonly (readonly [Uint8Array, Uint8Array])[],
  perBlock: number,
  compress: boolean,
) {
  const parts: Uint8Array[] = []
  const index: [Uint8Array, Uint8Array][] = []
  let offset = 0
  const put = (contents: Uint8Array, type: number) => {
    const body = type === 4 ? new Uint8Array(deflateRawSync(contents)) : contents
    const handle = { offset, size: body.byteLength }
    const crc = mask(crc32c(concat([body, Uint8Array.of(type)])))
    parts.push(body, Uint8Array.of(type), fixed32(crc))
    offset += body.byteLength + 5
    return handle
  }
  for (let start = 0; start < entries.length; start += perBlock) {
    const slice = entries.slice(start, start + perBlock)
    const handle = put(block(slice), compress && start % (perBlock * 2) === 0 ? 4 : 0)
    index.push([slice.at(-1)![0], concat([varint(handle.offset), varint(handle.size)])])
  }
  const meta = put(block([]), 0)
  const indexHandle = put(block(index, 1), 0)
  const handles = concat([
    varint(meta.offset),
    varint(meta.size),
    varint(indexHandle.offset),
    varint(indexHandle.size),
  ])
  const footer = new Uint8Array(48)
  footer.set(handles)
  footer.set([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb], 40)
  return concat([...parts, footer])
}

/** A log-format file: records fragmented into 32 KiB blocks, short block tails zeroed. */
function log(records: readonly Uint8Array[]) {
  const parts: Uint8Array[] = []
  let left = 32768
  for (const record of records) {
    let at = 0
    let first = true
    do {
      if (left < 7) {
        parts.push(new Uint8Array(left))
        left = 32768
      }
      const length = Math.min(record.byteLength - at, left - 7)
      const last = at + length === record.byteLength
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3
      const data = record.subarray(at, at + length)
      const header = new Uint8Array(7)
      header.set(fixed32(mask(crc32c(concat([Uint8Array.of(type), data])))))
      header[4] = length & 0xff
      header[5] = length >> 8
      header[6] = type
      parts.push(header, data)
      left -= 7 + length
      at += length
      first = false
    } while (at < record.byteLength)
  }
  return concat(parts)
}

const newFile = (
  level: number,
  number: number,
  size: number,
  smallest: Uint8Array,
  largest: Uint8Array,
) =>
  concat([
    varint(7),
    varint(level),
    varint(number),
    varint(size),
    prefixed(smallest),
    prefixed(largest),
  ])

function batch(sequence: number, records: readonly (readonly [string, Uint8Array | undefined])[]) {
  const head = new Uint8Array(12)
  new DataView(head.buffer).setBigUint64(0, BigInt(sequence), true)
  new DataView(head.buffer).setUint32(8, records.length, true)
  return concat([
    head,
    ...records.map(([key, value]) =>
      value === undefined
        ? concat([Uint8Array.of(0), prefixed(text(key))])
        : concat([Uint8Array.of(1), prefixed(text(key)), prefixed(value)]),
    ),
  ])
}

const chunkKey = (index: number) => `chunk:${String(index).padStart(4, '0')}`
const chunkValue = (index: number) => text(`value ${index} `.repeat(1 + (index % 5)))
const big = new Uint8Array(40_000).map((_, index) => (index * 7) & 0xff)

function database(): Map<string, Uint8Array> {
  const chunks = Array.from(
    { length: 300 },
    (_, index) => [internal(chunkKey(index), index + 1, 1), chunkValue(index)] as const,
  )
  const level0 = table(chunks, 64, true)
  const level1 = table(
    [
      [internal('b', 3, 1), text('old b')],
      [internal('c', 2, 1), text('old c')],
    ],
    16,
    false,
  )
  // table 3 is added, then deleted by a later edit: its keys must not appear though the file stays
  const dropped = table([[internal('zzz', 1, 1), text('dropped')]], 16, false)
  const manifest = log([
    concat([
      varint(1),
      prefixed(text('leveldb.BytewiseComparator')),
      varint(2),
      varint(8),
      varint(3),
      varint(10),
      varint(4),
      varint(400),
    ]),
    concat([
      newFile(0, 5, level0.byteLength, chunks[0]![0], chunks[299]![0]),
      newFile(1, 7, level1.byteLength, internal('b', 3, 1), internal('c', 2, 1)),
    ]),
    newFile(0, 3, dropped.byteLength, internal('zzz', 1, 1), internal('zzz', 1, 1)),
    concat([varint(6), varint(0), varint(3), varint(9), varint(0)]),
  ])
  const journal = concat([
    log([
      batch(1000, [
        ['b', text('new b')],
        ['c', undefined],
        ['big', big],
      ]),
    ]),
    // a torn tail: a header promising more than was written
    Uint8Array.of(1, 2, 3, 4, 0xff, 0x7f, 1, 9, 9),
  ])
  return new Map([
    ['CURRENT', text('MANIFEST-000002\n')],
    ['MANIFEST-000002', manifest],
    ['000005.ldb', level0],
    ['000007.ldb', level1],
    ['000003.ldb', dropped],
    ['000008.log', journal],
    ['LOCK', new Uint8Array(0)],
  ])
}

function directory(files: Map<string, Uint8Array>): LevelDbDirectory {
  return {
    async list() {
      return [...files].map(([name, bytes]) => ({ name, size: bytes.byteLength }))
    },
    async read(name, offset, length) {
      const bytes = files.get(name)
      if (bytes === undefined || offset + length > bytes.byteLength)
        throw new RangeError(`read past ${name}`)
      return bytes.slice(offset, offset + length)
    },
  }
}

describe('LevelDB', () => {
  it('computes CRC-32C (Castagnoli) with its standard check value', () => {
    expect(crc32c(text('123456789'))).toBe(0xe3069283)
  })

  it('answers live keys and values after recovery: tables by level, manifest edits, the log', async () => {
    const db = await openLevelDb(directory(database()))
    const keys = db.keys.map(key => new TextDecoder().decode(key))
    expect(keys).toEqual([
      'b',
      'big',
      ...Array.from({ length: 300 }, (_, index) => chunkKey(index)),
    ])
    expect(new TextDecoder().decode(await db.get(text('b')))).toBe('new b')
    expect(await db.get(text('c'))).toBeUndefined()
    expect(await db.get(text('zzz'))).toBeUndefined()
    expect(Buffer.from((await db.get(text('big')))!).equals(Buffer.from(big))).toBe(true)
    expect(new TextDecoder().decode(await db.get(text(chunkKey(137))))).toBe(
      new TextDecoder().decode(chunkValue(137)),
    )
    const under: string[] = []
    for await (const entry of db.entries(text('chunk:02'))) {
      expect(
        Buffer.from(entry.value).equals(
          Buffer.from(chunkValue(Number(new TextDecoder().decode(entry.key).slice(6)))),
        ),
      ).toBe(true)
      under.push(new TextDecoder().decode(entry.key))
    }
    expect(under).toEqual(Array.from({ length: 100 }, (_, index) => chunkKey(200 + index)))
  })

  it('refuses a corrupt block, a missing live table, a foreign comparator and too many keys', async () => {
    const damaged = database()
    const level0 = damaged.get('000005.ldb')!.slice()
    level0[10] ^= 0xff
    damaged.set('000005.ldb', level0)
    await expect(openLevelDb(directory(damaged))).rejects.toThrow(/CRC-32C/u)
    const missing = database()
    missing.delete('000007.ldb')
    await expect(openLevelDb(directory(missing))).rejects.toThrow(/live table 7 is missing/u)
    const foreign = database()
    foreign.set(
      'MANIFEST-000002',
      log([concat([varint(1), prefixed(text('leveldb.OtherComparator'))])]),
    )
    await expect(openLevelDb(directory(foreign))).rejects.toThrow(/comparator/u)
    await expect(openLevelDb(directory(database()), { maxKeys: 100 })).rejects.toThrow(RangeError)
  })
})
