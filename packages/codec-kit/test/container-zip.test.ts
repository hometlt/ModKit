import { describe, expect, it } from 'vitest'
import { createZipArchive } from '../src/container/zip.js'
// the host's ZIP codec reads what the writer writes: the reader is the oracle
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from '../../../extensions/archives/src/zip/codec.js'

const budget = { maxNodes: 100, maxInputBytes: 1n << 20n }
const text = (value: string) => new TextEncoder().encode(value)

describe('the ZIP writer', () => {
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
