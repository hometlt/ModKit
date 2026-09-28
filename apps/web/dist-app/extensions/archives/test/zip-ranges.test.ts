import { crc32 } from '@modkit/codec-kit/checksum'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createCodec, readZipByRanges } from '../src/zip/codec.js'

const MAX_U32 = 0xffffffff

/**
 * A ZIP64 archive: every size and offset saturated in the central directory and carried by the
 * ZIP64 extra field, a ZIP64 end record and locator, and local headers with an extra field the
 * central records do not have (so data offsets come from the local headers).
 */
function buildZip64(files: readonly { name: string; data: Uint8Array; deflate?: true }[]) {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const path = encoder.encode(file.name)
    const payload = file.deflate ? deflateRawSync(file.data) : file.data
    const localExtra = new Uint8Array(9) // an extended timestamp only the local header carries
    new DataView(localExtra.buffer).setUint16(0, 0x5455, true)
    new DataView(localExtra.buffer).setUint16(2, 5, true)
    const local = new Uint8Array(30 + path.byteLength + localExtra.byteLength)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 45, true)
    lv.setUint16(8, file.deflate ? 8 : 0, true)
    lv.setUint32(14, crc32(file.data), true)
    lv.setUint32(18, payload.byteLength, true)
    lv.setUint32(22, file.data.byteLength, true)
    lv.setUint16(26, path.byteLength, true)
    lv.setUint16(28, localExtra.byteLength, true)
    local.set(path, 30)
    local.set(localExtra, 30 + path.byteLength)
    const central = new Uint8Array(46 + path.byteLength + 28)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 45, true)
    cv.setUint16(6, 45, true)
    cv.setUint16(10, file.deflate ? 8 : 0, true)
    cv.setUint32(16, crc32(file.data), true)
    cv.setUint32(20, MAX_U32, true)
    cv.setUint32(24, MAX_U32, true)
    cv.setUint16(28, path.byteLength, true)
    cv.setUint16(30, 28, true)
    cv.setUint32(42, MAX_U32, true)
    central.set(path, 46)
    const extra = 46 + path.byteLength
    cv.setUint16(extra, 0x0001, true)
    cv.setUint16(extra + 2, 24, true)
    cv.setBigUint64(extra + 4, BigInt(file.data.byteLength), true)
    cv.setBigUint64(extra + 12, BigInt(payload.byteLength), true)
    cv.setBigUint64(extra + 20, BigInt(offset), true)
    parts.push(local, payload)
    centrals.push(central)
    offset += local.byteLength + payload.byteLength
  }
  const centralOffset = offset
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0)
  const record = new Uint8Array(56)
  const rv = new DataView(record.buffer)
  rv.setUint32(0, 0x06064b50, true)
  rv.setBigUint64(4, 44n, true)
  rv.setBigUint64(24, BigInt(files.length), true)
  rv.setBigUint64(32, BigInt(files.length), true)
  rv.setBigUint64(40, BigInt(centralSize), true)
  rv.setBigUint64(48, BigInt(centralOffset), true)
  const locator = new Uint8Array(20)
  const lv = new DataView(locator.buffer)
  lv.setUint32(0, 0x07064b50, true)
  lv.setBigUint64(8, BigInt(centralOffset + centralSize), true)
  lv.setUint32(16, 1, true)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 0xffff, true)
  ev.setUint16(10, 0xffff, true)
  ev.setUint32(12, MAX_U32, true)
  ev.setUint32(16, MAX_U32, true)
  const all = [...parts, ...centrals, record, locator, end]
  const bytes = new Uint8Array(all.reduce((total, part) => total + part.byteLength, 0))
  let at = 0
  for (const part of all) {
    bytes.set(part, at)
    at += part.byteLength
  }
  return bytes
}

async function open(zip: Uint8Array, maxInputBytes: bigint) {
  const revision = 'provider-token:zip-ranges'
  const reads: number[] = []
  const source = {
    kind: 'bytes',
    ref: { id: 'zip', uri: 'memory:large.zip' },
    revision,
    size: BigInt(zip.byteLength),
    async read(offset: bigint, length: number) {
      reads.push(length)
      return zip.slice(Number(offset), Number(offset) + length)
    },
  }
  const input = {
    originKind: 'single',
    primaryBindingId: 'content',
    revisions: { topology: 'single', revision },
    bindings: [
      {
        bindingId: 'content',
        role: 'content',
        source: source.ref,
        sourceKind: 'candidate',
        ownership: 'owned',
        revision,
      },
    ],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
  const budget = {
    maxInputBytes,
    maxScalarBytes: 4096,
    maxDepth: 32,
    maxNodes: 1000,
    maxDiagnostics: 10,
  }
  return { session: await createCodec().open(input, 'full', budget), reads }
}

describe('ZIP by ranges', () => {
  const text = new TextEncoder().encode('stored text '.repeat(40))
  const packed = new TextEncoder().encode('deflated '.repeat(60))
  const zip = buildZip64([
    { name: 'docs/readme.txt', data: text },
    { name: 'data/packed.bin', data: packed, deflate: true },
  ])

  it('lists and extracts a ZIP64 archive larger than the read budget without holding it', async () => {
    const { session, reads } = await open(zip, 700n)
    expect(zip.byteLength).toBeGreaterThan(700)
    expect(Math.max(...reads)).toBeLessThanOrEqual(700)
    // opening reads the directory only (probe, tail, ZIP64 record, central directory), no local headers
    const opened = reads.length
    expect(opened).toBeLessThanOrEqual(4)
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const { items } = await lease.value.list('', { limit: 10 })
    expect(
      items.map((item: { path: string; size: bigint; compression?: string }) => [
        item.path,
        item.size,
        item.compression,
      ]),
    ).toEqual([
      ['docs/readme.txt', BigInt(text.byteLength), 'stored'],
      ['data/packed.bin', BigInt(packed.byteLength), 'deflate'],
    ])
    await lease.release()
    for (const [entryId, expected] of [
      ['docs/readme.txt', text],
      ['data/packed.bin', packed],
    ] as const) {
      const result = await session.operations().invoke('extract-entry', { entryId })
      expect(result).toMatchObject({ state: 'ok', output: { kind: 'bytes' } })
      expect([...result.output.value]).toEqual([...expected])
    }
    await session.operations().dispose()
  })

  it('gives a ZIP-based format codec the directory and the entry table by ranges', async () => {
    const byteSource = {
      size: async () => BigInt(zip.byteLength),
      read: async (offset: bigint, length: number) => {
        expect(length).toBeLessThanOrEqual(700)
        return zip.slice(Number(offset), Number(offset) + length)
      },
    }
    const { entries, containerEntries } = await readZipByRanges(byteSource, {
      maxInputBytes: 700n,
      maxNodes: 10,
    })
    expect(entries.map((entry: { name: string }) => entry.name)).toEqual([
      'docs/readme.txt',
      'data/packed.bin',
    ])
    expect(
      containerEntries.entries.map((entry: { storage: { kind: string } }) => entry.storage.kind),
    ).toEqual(['stored', 'deflate'])
  })

  it('keeps editing for an archive within the budget and refuses it beyond', async () => {
    const small = await open(zip, 1024n * 1024n)
    const descriptor = await small.session.descriptor()
    expect(JSON.stringify(descriptor)).toContain('zip-edit-zip64')
    await small.session.operations().dispose()
    const large = await open(zip, 700n)
    expect(JSON.stringify(await large.session.descriptor())).toContain('zip-edit-too-large')
    await large.session.operations().dispose()
  })
})
