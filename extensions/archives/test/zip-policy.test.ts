import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { crc32 } from '@modkit/codec-kit/checksum'
import { assembleZipArchive, zipStoredEntry } from '@modkit/codec-kit/container/zip'
import { parseZipArchive, extractZipArchiveEntry, createCodec } from '../src/zip/codec.js'

const policy = { policy: 'strict-package' } as const
const integrity = { integrity: true } as const
const data = new TextEncoder().encode('package contents')
const budget = { maxNodes: 100, maxInputBytes: 1000000n }

function fixture(names = ['part.xml'], options: { deflate?: boolean; descriptor?: boolean; zip64?: boolean; localZip64?: boolean } = {}) {
  const entries = names.map(name => {
    const payload = options.deflate ? new Uint8Array(deflateRawSync(data)) : data
    const item = zipStoredEntry(name, payload)
    const header = new Uint8Array(item.local[0]!.length + (options.localZip64 ? 20 : 0))
    header.set(item.local[0]!)
    const central = item.central.slice()
    const localView = new DataView(header.buffer, header.byteOffset, header.byteLength)
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength)
    localView.setUint16(8, options.deflate ? 8 : 0, true)
    centralView.setUint16(10, options.deflate ? 8 : 0, true)
    localView.setUint32(14, options.descriptor ? 0 : crc32(data), true)
    centralView.setUint32(16, crc32(data), true)
    localView.setUint32(22, options.descriptor ? 0 : data.length, true)
    centralView.setUint32(24, data.length, true)
    const parts = [header, payload]
    if (options.descriptor) {
      localView.setUint16(6, localView.getUint16(6, true) | 8, true)
      centralView.setUint16(8, centralView.getUint16(8, true) | 8, true)
      localView.setUint32(18, 0, true)
      const descriptor = new Uint8Array(16)
      const view = new DataView(descriptor.buffer)
      view.setUint32(0, 0x08074b50, true)
      view.setUint32(4, crc32(data), true)
      view.setUint32(8, payload.length, true)
      view.setUint32(12, data.length, true)
      parts.push(descriptor)
    }
    if (options.localZip64) {
      localView.setUint16(4, 45, true)
      localView.setUint16(28, 20, true)
      localView.setUint32(18, 0xffffffff, true)
      localView.setUint32(22, 0xffffffff, true)
      const at = header.length - 20
      localView.setUint16(at, 1, true)
      localView.setUint16(at + 2, 16, true)
      localView.setBigUint64(at + 4, BigInt(data.length), true)
      localView.setBigUint64(at + 12, BigInt(payload.length), true)
    }
    return { ...item, local: parts, central }
  })
  return assembleZipArchive(entries, new Uint8Array(0), budget, options.zip64)
}

describe('opt-in ZIP package policy and integrity', () => {
  it.each([{}, {deflate:true}, {descriptor:true}, {deflate:true,descriptor:true}])('extracts valid entries %j', async options => {
    const bytes = fixture(undefined, options)
    const [entry] = parseZipArchive(bytes, 10, policy)
    expect(await extractZipArchiveEntry(bytes, entry!, integrity)).toEqual(data)
  })

  it('keeps general ZIP64 reading while the package policy refuses it', async () => {
    const bytes = fixture(undefined, {zip64:true})
    const [entry] = parseZipArchive(bytes, 10)
    expect(await extractZipArchiveEntry(bytes, entry!, integrity)).toEqual(data)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/ZIP64/)
  })

  it('preserves malformed local-only ZIP64 edit diagnostic classification', async () => {
    const bytes = fixture(undefined, {localZip64:true})
    const [entry] = parseZipArchive(bytes, 10)
    expect(await extractZipArchiveEntry(bytes, entry!, integrity)).toEqual(data)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/ZIP64/)
    new DataView(bytes.buffer).setUint16(8, 8, true)
    const revision = 'provider-token:zip-policy-diagnostic'
    const source = {
      kind:'bytes', ref:{id:'zip',uri:'memory:policy.zip'}, revision, size:BigInt(bytes.length),
      async read(offset:bigint,length:number) { return bytes.slice(Number(offset),Number(offset)+length) },
    }
    const input = {
      originKind:'single',primaryBindingId:'content',revisions:{topology:'single',revision},
      bindings:[{bindingId:'content',role:'content',source:source.ref,sourceKind:'candidate',ownership:'owned',revision}],
      async openBinding() { return {value:source,release:async()=>undefined} },
    }
    const codec = createCodec(undefined) as {
      open(...args:unknown[]):Promise<{descriptor():Promise<unknown>;operations():{dispose():Promise<void>}}>
    }
    const session = await codec.open(input,'full',{maxInputBytes:1000000n,maxScalarBytes:4096,maxDepth:32,maxNodes:100,maxDiagnostics:10})
    try {
      expect(JSON.stringify(await session.descriptor())).toContain('x3.codec/zip-edit-zip64')
    } finally {
      await session.operations().dispose()
    }
  })

  it('keeps duplicate directory records by default but refuses strict duplicates', () => {
    const bytes = fixture(['part.xml', 'part.xml'])
    expect(parseZipArchive(bytes, 10)).toHaveLength(2)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/duplicate/)
  })

  it('keeps case-sensitive distinct package paths', () => {
    expect(parseZipArchive(fixture(['A', 'a']), 10, policy)).toHaveLength(2)
  })

  it.each(['../', '/ab', 'a\0b', 'C:a'])('refuses unsafe paths: %s', name => {
    const bytes = fixture(['a/b'])
    const [entry] = parseZipArchive(bytes, 10)
    const encoded = new TextEncoder().encode(name)
    bytes.set(encoded, 30)
    bytes.set(encoded, entry!.centralOffset + 46)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/unsafe/)
  })

  it('refuses inconsistent decoded sizes', async () => {
    const bytes = fixture(undefined, {deflate:true})
    const [entry] = parseZipArchive(bytes, 10)
    const view = new DataView(bytes.buffer)
    view.setUint32(22, data.length + 1, true)
    view.setUint32(entry!.centralOffset + 24, data.length + 1, true)
    const [changed] = parseZipArchive(bytes, 10, policy)
    await expect(extractZipArchiveEntry(bytes, changed!, integrity)).rejects.toThrow(/size/)
  })

  it.each(['a\\b', 'a//b'])('does not normalize strict raw names: %s', name => {
    const bytes = fixture([name.replaceAll('\\', '/')])
    const [entry] = parseZipArchive(bytes, 10)
    const encoded = new TextEncoder().encode(name)
    bytes.set(encoded, 30)
    bytes.set(encoded, entry!.centralOffset + 46)
    expect(parseZipArchive(bytes, 10)[0]!.name).toBe('a/b')
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/normalization/)
  })

  it('requires UTF-8 even when the ZIP UTF-8 flag is absent', () => {
    const bytes = fixture(['x'])
    const [entry] = parseZipArchive(bytes, 10)
    bytes[30] = 0xff
    bytes[entry!.centralOffset + 46] = 0xff
    expect(parseZipArchive(bytes, 10)).toHaveLength(1)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow()
  })

  it('accepts valid unflagged UTF-8 without interpreting it as Latin-1', () => {
    const bytes = fixture(['é'])
    const [entry] = parseZipArchive(bytes, 10)
    const view = new DataView(bytes.buffer)
    view.setUint16(6, 0, true)
    view.setUint16(entry!.centralOffset + 8, 0, true)
    expect(parseZipArchive(bytes, 10, policy)[0]!.name).toBe('é')
    expect(parseZipArchive(bytes, 10)[0]!.name).not.toBe('é')
  })

  it.each([6, 8, 14, 18, 22, 30])('refuses local/central disagreements at local offset %i', async offset => {
    const bytes = fixture()
    const [entry] = parseZipArchive(bytes, 10)
    bytes[offset] = bytes[offset]! ^ 1
    await expect(extractZipArchiveEntry(bytes, entry!, integrity)).rejects.toThrow()
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow()
  })

  it('checks decoded CRC without changing the default extraction contract', async () => {
    const bytes = fixture()
    const [entry] = parseZipArchive(bytes, 10, policy)
    const payloadOffset = 30 + new TextEncoder().encode(entry!.name).length
    bytes[payloadOffset] = bytes[payloadOffset]! ^ 1
    expect(await extractZipArchiveEntry(bytes, entry!)).not.toEqual(data)
    await expect(extractZipArchiveEntry(bytes, entry!, integrity)).rejects.toThrow(/CRC/)
  })

  it('refuses a corrupted streaming descriptor', async () => {
    const bytes = fixture(undefined, {descriptor:true})
    const [entry] = parseZipArchive(bytes, 10)
    bytes[entry!.centralOffset - 1] = bytes[entry!.centralOffset - 1]! ^ 1
    await expect(extractZipArchiveEntry(bytes, entry!, integrity)).rejects.toThrow(/descriptor/)
  })

  it('strict framing rejects trailing bytes while the default remains compatible', () => {
    const source = fixture()
    const bytes = new Uint8Array(source.length + 1)
    bytes.set(source)
    expect(parseZipArchive(bytes, 10)).toHaveLength(1)
    expect(() => parseZipArchive(bytes, 10, policy)).toThrow(/end records/)
  })

  it('enforces node limits including empty and invalid budgets', () => {
    expect(() => parseZipArchive(fixture(), 0, policy)).toThrow(/maxNodes/)
    expect(() => parseZipArchive(fixture(), NaN, policy)).toThrow(/maxNodes/)
    const empty = assembleZipArchive([], new Uint8Array(0), budget)
    expect(parseZipArchive(empty, 0, policy)).toEqual([])
  })

  it('admits entries incrementally and stops before later directory records', () => {
    const bytes = fixture(['first', 'later'])
    const entries = parseZipArchive(bytes, 10)
    // A later malformed record must not hide an earlier caller budget refusal.
    bytes[entries[1]!.centralOffset] = 0
    const refusal = new RangeError('document aggregate budget')
    const visited: string[] = []
    expect(() => parseZipArchive(bytes, 10, {
      ...policy,
      admitEntry(entry) { visited.push(entry.name); throw refusal },
    })).toThrow(refusal)
    expect(visited).toEqual(['first'])
  })

  it('supplies frozen entries to the admission callback in directory order', () => {
    const visited: string[] = []
    const entries = parseZipArchive(fixture(['first', 'later']), 10, {
      ...policy,
      admitEntry(entry) { expect(Object.isFrozen(entry)).toBe(true); visited.push(entry.name) },
    })
    expect(visited).toEqual(entries.map(entry => entry.name))
  })

  it('refuses asynchronous admission instead of silently bypassing a caller budget', () => {
    expect(() => parseZipArchive(fixture(), 10, {
      ...policy,
      // @ts-expect-error admission must be synchronous
      async admitEntry() { return undefined },
    })).toThrow(/synchronous/)
  })

  it('refuses misspelled opt-ins instead of silently disabling checks', async () => {
    const bytes = fixture()
    const [entry] = parseZipArchive(bytes, 10)
    // @ts-expect-error exercise the JavaScript trust boundary
    expect(() => parseZipArchive(bytes, 10, {policy:'strcit-package'})).toThrow(/options/)
    // @ts-expect-error exercise the JavaScript trust boundary
    await expect(extractZipArchiveEntry(bytes, entry!, {integirty:true})).rejects.toThrow(/options/)
  })
})
