import { describe, expect, it } from 'vitest'
import {
  assembleZipArchive,
  createZipArchive,
  zipStoredEntry,
  zipLocalHeader,
  zipCentralRecord,
} from '../src/container/zip.js'
// the host's ZIP codec reads what the writer writes: the reader is the oracle
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from '../../../extensions/archives/src/zip/codec.js'

const budget = { maxNodes: 100, maxInputBytes: 1n << 20n }
const text = (value: string) => new TextEncoder().encode(value)

describe('the ZIP writer', () => {
  it.each([65534, 65535, 65536])(
    'round-trips %i entries across the ZIP64 count sentinel',
    count => {
      const files = Array.from({ length: count }, (_, i) => [`f${i}`, new Uint8Array(0)] as const)
      const archive = createZipArchive(files, { maxNodes: count, maxInputBytes: 1n << 26n })
      expect(parseZipArchive(archive, count)).toHaveLength(count)
      const view = new DataView(archive.buffer)
      expect(view.getUint16(archive.length - 12, true)).toBe(Math.min(count, 65535))
      if (count >= 65535) expect(view.getUint32(archive.length - 42, true)).toBe(0x07064b50)
      expect(() =>
        createZipArchive(files, { maxNodes: count - 1, maxInputBytes: 1n << 26n }),
      ).toThrow(/maxNodes/u)
    },
  )

  it('retains a requested ZIP64 footer and comment without mutating input records', () => {
    const entry = zipStoredEntry('a', text('payload'))
    const original = entry.central.slice()
    const archive = assembleZipArchive([entry], text('comment'), budget, true)
    expect(parseZipArchive(archive, 10)[0]?.name).toBe('a')
    expect(entry.central).toEqual(original)
    expect(archive.slice(-7)).toEqual(text('comment'))
    const classic = assembleZipArchive([entry], text('comment'), budget)
    expect(() =>
      assembleZipArchive(
        [entry],
        text('comment'),
        { ...budget, maxInputBytes: BigInt(classic.length) },
        true,
      ),
    ).toThrow(/maxInputBytes/u)
    expect(() => assembleZipArchive([entry], new Uint8Array(65536), budget)).toThrow(/too long/u)
  })

  it.each([0xffffffff, 0x100000000])('encodes ZIP64 size %i without truncation', size => {
    const fields = {
      versionNeeded: 10,
      flags: 0,
      method: 0,
      dosTime: 0,
      dosDate: 0,
      crc: 0,
      compressedSize: 1,
      size,
      nameBytes: text('a'),
      extraBytes: new Uint8Array(0),
    }
    const local = zipLocalHeader(fields)
    const central = zipCentralRecord({
      ...fields,
      versionMadeBy: 20,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: 0,
      commentBytes: text('c'),
    })
    const lv = new DataView(local.buffer)
    expect(lv.getUint32(18, true)).toBe(0xffffffff)
    expect(lv.getUint32(22, true)).toBe(0xffffffff)
    expect(lv.getBigUint64(35, true)).toBe(BigInt(size))
    const cv = new DataView(central.buffer)
    expect(cv.getUint32(24, true)).toBe(0xffffffff)
    expect(cv.getUint32(20, true)).toBe(1)
    expect(cv.getBigUint64(51, true)).toBe(BigInt(size))
    expect(() =>
      zipCentralRecord({
        ...fields,
        versionMadeBy: 20,
        diskStart: 0,
        internalAttributes: 0,
        externalAttributes: 0,
        commentBytes: text('c'),
        localOffset: 0x100000000,
      }),
    ).toThrow(/sentinel/u)
  })
  it('writes files the ZIP codec reads back, in order, stored, with a UTF-8 name', async () => {
    const files: [string, Uint8Array][] = [
      ['uvp.manifest.json', text('{"uv":{"format":"UVP"}}')],
      ['worlds/', new Uint8Array(0)],
      ['worlds/дюна.uvw', text('{"format":"UVW"}')],
      ['media/empty.bin', new Uint8Array(0)],
    ]
    const archive = createZipArchive(files, budget)
    const entries = parseZipArchive(archive, 100)
    expect(entries.map(entry => [entry.name, entry.kind, entry.method])).toEqual([
      ['uvp.manifest.json', 'file', 0],
      ['worlds/', 'directory', 0],
      ['worlds/дюна.uvw', 'file', 0],
      ['media/empty.bin', 'file', 0],
    ])
    for (const [index, [, bytes]] of files.entries()) {
      const entry = entries[index]!
      if (entry.kind === 'file') expect(await extractZipArchiveEntry(archive, entry)).toEqual(bytes)
    }
    // a deterministic archive: the same files write the same bytes
    expect(createZipArchive(files, budget)).toEqual(archive)
  })

  it('refuses a path given twice, an empty path and an archive past its budget', () => {
    expect(() =>
      createZipArchive(
        [
          ['a.txt', text('1')],
          ['a.txt', text('2')],
        ],
        budget,
      ),
    ).toThrow(/twice/u)
    expect(() => createZipArchive([['', text('1')]], budget)).toThrow(/cannot be empty/u)
    expect(() =>
      createZipArchive([['big.bin', new Uint8Array(64)]], { maxNodes: 100, maxInputBytes: 32n }),
    ).toThrow(/maxInputBytes/u)
  })
})
