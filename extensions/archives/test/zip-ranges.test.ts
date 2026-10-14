import { crc32 } from '@modkit/codec-kit/checksum'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  createCodec,
  readZipByRanges,
  parseZipArchive,
  extractZipArchiveEntry,
} from '../src/zip/codec.js'

const MAX_U32 = 0xffffffff

/**
 * A ZIP64 archive: every size and offset saturated in the central directory and carried by the
 * ZIP64 extra field, a ZIP64 end record and locator, and local headers with an extra field the
 * central records do not have (so data offsets come from the local headers).
 */
function buildZip64(
  files: readonly {
    name: string
    data: Uint8Array
    deflate?: true
    descriptor?: 'signed' | 'unsigned'
    wide?: boolean
    localZip64?: boolean
    localZero?: boolean
    offsetOnly?: boolean
  }[],
  comment = new Uint8Array(0),
  footer = true,
) {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const path = encoder.encode(file.name)
    const payload = file.deflate ? deflateRawSync(file.data) : file.data
    const localExtra = new Uint8Array(file.localZip64 ? 29 : 9)
    new DataView(localExtra.buffer).setUint16(0, 0x5455, true)
    new DataView(localExtra.buffer).setUint16(2, 5, true)
    if (file.localZip64) {
      const extraView = new DataView(localExtra.buffer)
      extraView.setUint16(9, 1, true)
      extraView.setUint16(11, 16, true)
      extraView.setBigUint64(13, file.localZero ? 0n : BigInt(file.data.length), true)
      extraView.setBigUint64(21, file.localZero ? 0n : BigInt(payload.length), true)
    }
    const local = new Uint8Array(30 + path.byteLength + localExtra.byteLength)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 45, true)
    lv.setUint16(6, file.descriptor ? 8 : 0, true)
    lv.setUint16(8, file.deflate ? 8 : 0, true)
    lv.setUint32(14, crc32(file.data), true)
    lv.setUint32(18, file.localZip64 ? MAX_U32 : payload.byteLength, true)
    lv.setUint32(22, file.localZip64 ? MAX_U32 : file.data.byteLength, true)
    lv.setUint16(26, path.byteLength, true)
    lv.setUint16(28, localExtra.byteLength, true)
    local.set(path, 30)
    local.set(localExtra, 30 + path.byteLength)
    const entryComment = encoder.encode('entry-comment')
    const wide = file.wide !== false
    const zip64ExtraLength = wide ? (file.offsetOnly ? 12 : 28) : 0
    const extraLength = zip64ExtraLength + 7
    const central = new Uint8Array(46 + path.byteLength + extraLength + entryComment.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 45, true)
    cv.setUint16(6, 45, true)
    cv.setUint16(8, file.descriptor ? 8 : 0, true)
    cv.setUint16(10, file.deflate ? 8 : 0, true)
    cv.setUint32(16, crc32(file.data), true)
    cv.setUint32(20, wide && !file.offsetOnly ? MAX_U32 : payload.length, true)
    cv.setUint32(24, wide && !file.offsetOnly ? MAX_U32 : file.data.length, true)
    cv.setUint16(28, path.byteLength, true)
    cv.setUint16(30, extraLength, true)
    cv.setUint16(32, entryComment.length, true)
    cv.setUint32(42, wide ? MAX_U32 : offset, true)
    central.set(path, 46)
    const extra = 46 + path.byteLength
    if (wide) {
      cv.setUint16(extra, 0x0001, true)
      cv.setUint16(extra + 2, zip64ExtraLength - 4, true)
      if (!file.offsetOnly) {
        cv.setBigUint64(extra + 4, BigInt(file.data.byteLength), true)
        cv.setBigUint64(extra + 12, BigInt(payload.byteLength), true)
      }
      cv.setBigUint64(extra + (file.offsetOnly ? 4 : 20), BigInt(offset), true)
    }
    const unknown = extra + zip64ExtraLength
    cv.setUint16(unknown, 0xcafe, true)
    cv.setUint16(unknown + 2, 3, true)
    central.set([11, 22, 33], unknown + 4)
    central.set(entryComment, extra + extraLength)
    parts.push(local, payload)
    centrals.push(central)
    offset += local.byteLength + payload.byteLength
    if (file.descriptor) {
      const signature = file.descriptor === 'signed' ? 4 : 0
      const descriptor = new Uint8Array(signature + (wide || file.localZip64 ? 20 : 12))
      const dv = new DataView(descriptor.buffer)
      if (signature) dv.setUint32(0, 0x08074b50, true)
      dv.setUint32(signature, crc32(file.data), true)
      if (wide || file.localZip64) {
        dv.setBigUint64(signature + 4, BigInt(payload.length), true)
        dv.setBigUint64(signature + 12, BigInt(file.data.length), true)
      } else {
        dv.setUint32(signature + 4, payload.length, true)
        dv.setUint32(signature + 8, file.data.length, true)
      }
      parts.push(descriptor)
      offset += descriptor.length
    }
  }
  const centralOffset = offset
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0)
  const record = new Uint8Array(56)
  const rv = new DataView(record.buffer)
  rv.setUint32(0, 0x06064b50, true)
  rv.setBigUint64(4, 44n, true)
  rv.setUint16(12, 0x032d, true) // preserve the creator's OS as well as ZIP version
  rv.setUint16(14, 45, true)
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
  ev.setUint16(8, footer ? 0xffff : files.length, true)
  ev.setUint16(10, footer ? 0xffff : files.length, true)
  ev.setUint32(12, footer ? MAX_U32 : centralSize, true)
  ev.setUint32(16, footer ? MAX_U32 : centralOffset, true)
  ev.setUint16(20, comment.length, true)
  const all = [...parts, ...centrals, ...(footer ? [record, locator] : []), end, comment]
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
    expect(JSON.stringify(descriptor)).not.toContain('zip-edit-zip64')
    await small.session.operations().dispose()
    const large = await open(zip, 700n)
    expect(JSON.stringify(await large.session.descriptor())).toContain('zip-edit-too-large')
    await large.session.operations().dispose()
  })
})

describe('canonical ZIP64 editing corpus', () => {
  const text = (value: string) => new TextEncoder().encode(value)
  const comment = text('archive-comment')
  const first = text('first')
  const kept = text('deflated preserved payload '.repeat(20))

  async function edit(zip: Uint8Array, handler: string, request: object) {
    const { session } = await open(zip, 1n << 20n)
    try {
      const result = await session.operations().invoke(handler, request)
      expect(result, JSON.stringify(result)).toMatchObject({
        state: 'ok',
        output: { kind: 'edit-plan' },
      })
      expect(result.output.plan.fidelity.preservesUnknownData).toBe(true)
      return result.output.plan.edits[0].payload.bytes as Uint8Array
    } finally {
      await session.operations().dispose()
    }
  }

  it.each([
    { wide: true, descriptor: 'signed' as const },
    { wide: true, descriptor: 'unsigned' as const },
    { wide: false, descriptor: 'signed' as const },
    { wide: false, descriptor: 'unsigned' as const },
    { wide: true, localZip64: true },
    { wide: false, localZip64: true, descriptor: 'signed' as const },
    { wide: false, localZip64: true, descriptor: 'unsigned' as const },
    { wide: true, offsetOnly: true, descriptor: 'unsigned' as const },
    { wide: false, localZip64: true, localZero: true, descriptor: 'signed' as const },
  ])(
    'preserves untouched blocks/extras/comments and reopens after replace: %j',
    async options => {
      const zip = buildZip64(
        [
          { name: 'map', data: first, localZip64: true },
          { name: 'kept', data: kept, deflate: true, ...options },
        ],
        comment,
      )
      const source = parseZipArchive(zip, 10)
      const replacement = text('a much longer replacement map')
      const output = await edit(zip, 'edit-content', {
        path: 'map',
        bytes: Buffer.from(replacement).toString('base64'),
      })
      const entries = parseZipArchive(output, 10)
      expect(await extractZipArchiveEntry(output, entries[0]!)).toEqual(replacement)
      expect(await extractZipArchiveEntry(output, entries[1]!)).toEqual(kept)
      expect(output.subarray(entries[1]!.localOffset, entries[0]!.centralOffset)).toEqual(
        zip.subarray(source[1]!.localOffset, source[0]!.centralOffset),
      )
      // Only the offset in the kept central record may change.
      const originalCentral = zip.slice(
        source[1]!.centralOffset,
        source[1]!.centralOffset + source[1]!.centralLength,
      )
      const newCentral = output.slice(
        entries[1]!.centralOffset,
        entries[1]!.centralOffset + entries[1]!.centralLength,
      )
      const offsetAt = options.wide
        ? 46 + 4 + 4 + ('offsetOnly' in options && options.offsetOnly ? 0 : 16)
        : 42
      originalCentral.fill(0, offsetAt, offsetAt + (options.wide ? 8 : 4))
      newCentral.fill(0, offsetAt, offsetAt + (options.wide ? 8 : 4))
      expect(newCentral).toEqual(originalCentral)
      expect(output.slice(-comment.length)).toEqual(comment)
      const footerAt = output.length - comment.length - 22 - 76
      expect(new DataView(output.buffer).getUint16(footerAt + 12, true)).toBe(0x032d)
      const replacedCentral = new DataView(
        output.buffer,
        entries[0]!.centralOffset,
        entries[0]!.centralLength,
      )
      expect(replacedCentral.getUint16(30, true)).toBe(7) // only the unknown extra survives
      const reopened = await open(output, 1n << 20n)
      expect(JSON.stringify(await reopened.session.descriptor())).not.toMatch(
        /zip-edit-(?:zip64|layout)/u,
      )
      await reopened.session.operations().dispose()
    },
    30_000,
  )

  it('renames, adds and removes entries through the existing structural operation', async () => {
    const zip = buildZip64(
      [
        { name: 'map', data: first, localZip64: true },
        { name: 'kept', data: kept, deflate: true },
      ],
      comment,
    )
    const renamed = await edit(zip, 'edit-structure', {
      rename: [{ from: 'map', to: 'longer-map' }],
      add: [{ path: 'new', bytes: 'eA==' }],
    })
    const entries = parseZipArchive(renamed, 10)
    expect(entries.map(entry => entry.name)).toEqual(['longer-map', 'kept', 'new'])
    expect(await extractZipArchiveEntry(renamed, entries[0]!)).toEqual(first)
    const removed = await edit(renamed, 'edit-structure', { remove: ['kept', 'new'] })
    expect(parseZipArchive(removed, 10).map(entry => entry.name)).toEqual(['longer-map'])
    expect(removed.slice(-comment.length)).toEqual(comment)
  }, 30_000)

  it('uses the same ZIP64 assembly for container.pack', async () => {
    const zip = buildZip64(
      [
        { name: 'map', data: first },
        { name: 'kept', data: kept },
      ],
      comment,
    )
    const output = await edit(zip, 'container-pack', {
      replacements: [
        { entryId: 'map', expectedRevision: 'provider-token:zip-ranges', bytesBase64: 'eA==' },
      ],
    })
    expect(await extractZipArchiveEntry(output, parseZipArchive(output, 10)[0]!)).toEqual(text('x'))
  }, 30_000)

  it('edits local-header-only ZIP64 produced without a ZIP64 footer', async () => {
    const zip = buildZip64(
      [{ name: 'map', data: first, wide: false, localZip64: true, descriptor: 'unsigned' }],
      comment,
      false,
    )
    const output = await edit(zip, 'edit-structure', { rename: [{ from: 'map', to: 'renamed' }] })
    const entry = parseZipArchive(output, 10)[0]!
    expect(await extractZipArchiveEntry(output, entry)).toEqual(first)
    const reopened = await open(output, 1n << 20n)
    expect(JSON.stringify(await reopened.session.descriptor())).not.toMatch(
      /zip-edit-(?:zip64|layout)/u,
    )
    await reopened.session.operations().dispose()
  }, 30_000)

  it('round-trips an independent Python 3.14 zipfile force_zip64 corpus member', async () => {
    // zipfile.ZIP_DEFLATED; open('map', 'w', force_zip64=True), seekable output.
    const zip = Uint8Array.from(
      Buffer.from(
        'UEsDBC0AAAAIAAAAIQDKMdUi//////////8DABQAbWFwAQAQABcAAAAAAAAAGQAAAAAAAAArqCzJyM9TSMsvSk5NUYjyDDAzUchNLAAAUEsBAi0ALQAAAAgAAAAhAMox1SIZAAAAFwAAAAMAAAAAAAAAAAAAAIABAAAAAG1hcFBLBQYAAAAAAQABADEAAABOAAAAFgBweXRob24gYXJjaGl2ZSBjb21tZW50',
        'base64',
      ),
    )
    const expected = text('python forced ZIP64 map')
    const output = await edit(zip, 'edit-structure', { add: [{ path: 'new', bytes: 'eA==' }] })
    expect(await extractZipArchiveEntry(output, parseZipArchive(output, 10)[0]!)).toEqual(expected)
    expect(output.slice(-22)).toEqual(text('python archive comment'))
  }, 30_000)

  it('keeps classic descriptor editing, comments and noncanonical fidelity unchanged', async () => {
    const zip = buildZip64(
      [
        { name: 'map', data: first, wide: false, descriptor: 'signed' },
        { name: 'kept', data: kept, wide: false, descriptor: 'unsigned', deflate: true },
      ],
      comment,
      false,
    )
    const output = await edit(zip, 'edit-content', { path: 'map', bytes: 'eA==' })
    const entries = parseZipArchive(output, 10)
    expect(await extractZipArchiveEntry(output, entries[1]!)).toEqual(kept)
    expect(output.slice(-comment.length)).toEqual(comment)
    expect(
      new DataView(output.buffer).getUint32(output.length - comment.length - 42, true),
    ).not.toBe(0x07064b50)
    const noncanonical = Uint8Array.from([...zip, 99])
    const { session } = await open(noncanonical, 1n << 20n)
    try {
      const result = await session
        .operations()
        .invoke('edit-content', { path: 'map', bytes: 'eA==' })
      expect(result.output.plan.fidelity.preservesUnknownData).toBe(false)
    } finally {
      await session.operations().dispose()
    }
  }, 30_000)

  it.each([
    'locator-disk',
    'record-size',
    'entry-disk',
    'local-size',
    'encrypted',
    'trailing',
    'descriptor',
    'extra-length',
  ])(
    'refuses unsupported ZIP64 %s before producing an edit plan',
    async corruption => {
      const original = buildZip64([{ name: 'map', data: first, descriptor: 'signed' }], comment)
      const entry = parseZipArchive(original, 10)[0]!
      const zip = corruption === 'trailing' ? Uint8Array.from([...original, 99]) : original.slice()
      const view = new DataView(zip.buffer)
      const end = original.length - comment.length - 22
      const record = end - 76
      if (corruption === 'locator-disk') view.setUint32(end - 16, 1, true)
      if (corruption === 'record-size') view.setBigUint64(record + 4, 45n, true)
      if (corruption === 'entry-disk') view.setUint16(entry.centralOffset + 34, 1, true)
      if (corruption === 'local-size') view.setUint32(22, 999, true)
      if (corruption === 'encrypted') view.setUint16(entry.centralOffset + 8, 1, true)
      if (corruption === 'descriptor') view.setUint32(entry.centralOffset - 20, 999, true)
      if (corruption === 'extra-length') view.setUint16(entry.centralOffset + 46 + 3 + 2, 23, true)
      if (corruption === 'extra-length') {
        await expect(open(zip, 1n << 20n)).rejects.toThrow(/truncated ZIP u64/u)
        return
      }
      const { session } = await open(zip, 1n << 20n)
      try {
        expect(JSON.stringify(await session.descriptor())).toMatch(/zip-edit-(?:zip64|encrypted)/u)
        await expect(
          session.operations().invoke('edit-content', { path: 'map', bytes: 'eA==' }),
        ).rejects.toThrow(/failed/u)
      } finally {
        await session.operations().dispose()
      }
    },
    30_000,
  )
})
