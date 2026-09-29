/**
 * 7z and RAR4 reading through the host's ordinary open path.
 *
 * The 7z fixtures were written by 7-Zip 26.01 from the tree that `expectedFiles` regenerates:
 *   lzma.7z          -m0=LZMA -ms=on          (encoded header, solid, empty file, empty dir)
 *   lzma2.7z         -m0=LZMA2 -ms=on
 *   plain-header.7z  -m0=LZMA -mhc=off
 *   copy.7z          -m0=Copy -mhc=off hello.txt docs
 *   deflate.7z       -m0=Deflate hello.txt docs      bzip2.7z  -m0=BZip2 hello.txt docs
 *   delta.7z         -m0=Delta:4 -m1=LZMA hello.txt
 *   bcj.7z           -m0=BCJ -m1=LZMA code.bin
 *   bcj2.7z          -m0=BCJ2 -m1=LZMA -m2=LZMA -m3=LZMA -mb0s0:1 -mb0s1:2 -mb0s2:3 code.bin
 *   encrypted.7z     -pSecret hello.txt              encrypted-header.7z  adds -mhe=on
 * RAR4 archives are assembled here because no RAR writer ships with the owner machine.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { crc32 } from '@modkit/codec-kit/checksum'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  type Inventory,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetSession,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkit/sdk'

const extensionRoot = join(import.meta.dirname, '..')
const fixtures = join(import.meta.dirname, 'fixtures', '7z')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'archives-7z-rar', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 16,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 32,
}

const text = (value: string) => new TextEncoder().encode(value)

function codeBin(): Uint8Array {
  const bytes = Buffer.alloc(6000)
  let seed = 7
  for (let index = 0; index < bytes.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    bytes[index] = (seed >> 16) & 0xff
  }
  for (let index = 0; index + 5 < bytes.length; index += 37) {
    bytes[index] = 0xe8
    bytes.writeInt32LE(((index * 7) % 4096) - 2048, index + 1)
  }
  for (let index = 11; index + 5 < bytes.length; index += 53) {
    bytes[index] = 0x0f
    bytes[index + 1] = 0x84
    bytes.writeInt32LE(((index * 3) % 2048) - 1024, index + 2)
  }
  return new Uint8Array(bytes)
}

const expectedFiles: Record<string, Uint8Array> = {
  'hello.txt': text('hello, 7z\n'.repeat(20)),
  'docs/deep/notes.md': text(
    `# notes\n${Array.from({ length: 200 }, (_, i) => `line ${i} of repeated text`).join('\n')}`,
  ),
  'empty.bin': new Uint8Array(0),
  'code.bin': codeBin(),
}

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let inventoryPromise: Promise<Inventory> | undefined
function inventory(): Promise<Inventory> {
  inventoryPromise ??= loadExtensionDirectory(extensionRoot).then(loaded =>
    buildInventory(
      [{ ...loaded, execution: { origin: 'bundled' as const, allowTrustedInProcess: true } }],
      createHostContributionContractRegistry(),
    ),
  )
  return inventoryPromise
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://archives-7z-rar/${name}`
  return Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}-${crc32(bytes)}`),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  })
}

async function open(bytes: Uint8Array, name: string, resource = budget) {
  const result = await openSubject({
    inventory: await inventory(),
    source: byteSource(bytes, name),
    path: name,
    intent: 'full',
    target,
    grant,
    budget: resource,
    executionBackends,
  })
  return result
}

async function opened(bytes: Uint8Array, name: string, resource = budget): Promise<AssetSession> {
  const result = await open(bytes, name, resource)
  if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
  return result.session
}

async function entries(session: AssetSession): Promise<readonly NamespaceEntry[]> {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  try {
    return (await (lease.value as NamespaceEntrySource).list('', { limit: 100 })).items
  } finally {
    await lease.release()
  }
}

/** The codec's own handler (RAR), or the host's entry-table extraction (7z). */
async function extractHandler(session: AssetSession): Promise<string> {
  const operation = (await session.descriptor()).operations.find(
    item => item.id === 'container.extract',
  )
  if (operation === undefined) throw new Error('the archive publishes no container.extract')
  return operation.handlerId
}

async function extract(session: AssetSession, entryId: string): Promise<Uint8Array> {
  const result = await session.operations().invoke(await extractHandler(session), { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('extract failed')
  return result.output.value
}

async function refusal(session: AssetSession, entryId: string): Promise<string | undefined> {
  try {
    const result = await session.operations().invoke(await extractHandler(session), { entryId })
    return result.state === 'ok' ? undefined : result.reason
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    return cause?.code ?? (error as { code?: string }).code
  }
}

const fixture = async (name: string) => new Uint8Array(await readFile(join(fixtures, name)))

async function expectContents(name: string, files: readonly string[], directories: string[] = []) {
  const session = await opened(await fixture(name), name)
  try {
    const listed = await entries(session)
    expect(
      listed
        .filter(item => item.kind === 'directory')
        // the host's entry table spells a directory with its slash, as a zip does
        .map(item => item.path.replace(/\/$/u, ''))
        .sort(),
    ).toEqual(directories.sort())
    expect(
      listed
        .filter(item => item.kind === 'file')
        .map(item => item.path)
        .sort(),
    ).toEqual([...files].sort())
    for (const item of listed.filter(entry => entry.kind === 'file')) {
      const expected = expectedFiles[item.path] as Uint8Array
      expect(item.size).toBe(BigInt(expected.byteLength))
      expect(Buffer.from(await extract(session, item.id)).equals(Buffer.from(expected))).toBe(true)
    }
    return (await session.descriptor()).diagnostics
  } finally {
    await session.dispose()
  }
}

// Loading the extension inventory and codec modules is a one-time cold cost.
beforeAll(() => inventory(), 120_000)

describe('7z archives', () => {
  it('reads a solid LZMA archive with an encoded header, an empty file and empty directories', async () => {
    const diagnostics = await expectContents(
      'lzma.7z',
      ['hello.txt', 'docs/deep/notes.md', 'empty.bin'],
      ['docs', 'docs/deep', 'emptydir'],
    )
    expect(diagnostics).toEqual([])
  })

  it('reads LZMA2, plain headers, Copy, Deflate, BZip2 and Delta+LZMA folders', async () => {
    const tree = ['hello.txt', 'docs/deep/notes.md', 'empty.bin']
    await expectContents('lzma2.7z', tree, ['docs', 'docs/deep', 'emptydir'])
    await expectContents('plain-header.7z', tree, ['docs', 'docs/deep', 'emptydir'])
    for (const name of ['copy.7z', 'deflate.7z', 'bzip2.7z']) {
      await expectContents(name, ['hello.txt', 'docs/deep/notes.md'], ['docs', 'docs/deep'])
    }
    await expectContents('delta.7z', ['hello.txt'])
  })

  it('reverses the x86 BCJ and four-stream BCJ2 branch filters', async () => {
    await expectContents('bcj.7z', ['code.bin'])
    await expectContents('bcj2.7z', ['code.bin'])
  })

  it('lists an encrypted archive and refuses extraction with password-required', async () => {
    const session = await opened(await fixture('encrypted.7z'), 'encrypted.7z')
    try {
      const [entry] = await entries(session)
      expect(entry?.path).toBe('hello.txt')
      const descriptor = await session.descriptor()
      expect(descriptor.diagnostics.map(item => item.code)).toContain('archives/password-required')
      expect(await refusal(session, entry?.id ?? '')).toBe('archives/password-required')
    } finally {
      await session.dispose()
    }
  })

  it('opens an archive with encrypted headers as an empty, diagnosed namespace', async () => {
    const session = await opened(await fixture('encrypted-header.7z'), 'encrypted-header.7z')
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.diagnostics.map(item => item.code)).toEqual(['archives/password-required'])
      expect(await entries(session)).toEqual([])
      expect(await refusal(session, 'hello.txt')).toBeDefined()
    } finally {
      await session.dispose()
    }
  })

  it('fails closed on corrupt payloads, truncation and unsafe paths', async () => {
    const good = await fixture('lzma.7z')
    const corrupt = good.slice()
    corrupt[40] ^= 0xff
    const damaged = await opened(corrupt, 'corrupt.7z')
    try {
      const file = (await entries(damaged)).find(item => item.path === 'hello.txt')
      await expect(extract(damaged, file?.id ?? '')).rejects.toThrow()
    } finally {
      await damaged.dispose()
    }
    expect((await open(good.subarray(0, good.byteLength - 10), 'truncated.7z')).state).not.toBe(
      'opened',
    )

    // copy.7z has a plain header: rename "docs/deep" parts to "../" and re-seal both CRCs.
    const unsafe = (await fixture('copy.7z')).slice()
    const view = new DataView(unsafe.buffer)
    const nextOffset = 32 + Number(view.getBigUint64(12, true))
    const header = Buffer.from(unsafe.buffer, nextOffset)
    const at = header.indexOf(Buffer.from('docs', 'utf16le'))
    expect(at).toBeGreaterThan(0)
    Buffer.from('../x', 'utf16le').copy(header, at)
    view.setUint32(28, crc32(header), true)
    view.setUint32(8, crc32(unsafe.subarray(12, 32)), true)
    const result = await open(unsafe, 'unsafe.7z')
    expect(result.state).not.toBe('opened')
    expect(JSON.stringify(result.diagnostics)).toContain('unsafe 7z entry path')
  })

  it('enforces the entry and scalar budgets', async () => {
    const bytes = await fixture('lzma.7z')
    expect((await open(bytes, 'nodes.7z', { ...budget, maxNodes: 2 })).state).not.toBe('opened')
    // The encoded header fits; the 5 KB solid folder does not, so it is listed but not decoded.
    const small = await opened(bytes, 'scalar.7z', { ...budget, maxScalarBytes: 1000 })
    try {
      expect((await small.descriptor()).diagnostics.map(item => item.code)).toEqual([
        'archives/7z-budget',
      ])
      const file = (await entries(small)).find(item => item.path === 'hello.txt')
      await expect(extract(small, file?.id ?? '')).rejects.toThrow(/maxScalarBytes/u)
    } finally {
      await small.dispose()
    }
  })
})

/** Minimal RAR4 writer: marker, main header, file headers with stored or declared methods, end. */
function rar4(
  files: readonly {
    name: Uint8Array
    data: Uint8Array
    flags?: number
    method?: number
  }[],
): Uint8Array {
  const block = (type: number, flags: number, body: Uint8Array) => {
    const header = Buffer.alloc(7 + body.byteLength)
    header[2] = type
    header.writeUInt16LE(flags, 3)
    header.writeUInt16LE(header.length, 5)
    Buffer.from(body).copy(header, 7)
    header.writeUInt16LE(crc32(header.subarray(2)) & 0xffff, 0)
    return header
  }
  const parts: Buffer[] = [
    Buffer.from('Rar!\x1a\x07\x00', 'latin1'),
    block(0x73, 0, Buffer.alloc(6)),
  ]
  for (const file of files) {
    const body = Buffer.alloc(25 + file.name.byteLength)
    body.writeUInt32LE(file.data.byteLength, 0)
    body.writeUInt32LE(file.data.byteLength, 4)
    body[8] = 3
    body.writeUInt32LE(crc32(file.data), 9)
    body.writeUInt32LE(0x5b2e5a00, 13)
    body[17] = 29
    body[18] = file.method ?? 0x30
    body.writeUInt16LE(file.name.byteLength, 19)
    body.writeUInt32LE((0x81a4 << 16) >>> 0, 21)
    Buffer.from(file.name).copy(body, 25)
    parts.push(block(0x74, 0x8000 | (file.flags ?? 0), body), Buffer.from(file.data))
  }
  parts.push(block(0x7b, 0x4000, new Uint8Array(0)))
  return new Uint8Array(Buffer.concat(parts))
}

describe('RAR archives', () => {
  it('reads stored RAR4 files with Unicode names, directories and extended flags', async () => {
    // "dir/ж.txt" in RAR's `ascii NUL encoded` form: high byte 0x04, then 2-bit flags per char
    // (0 = low byte only, 1 = low byte with the shared high byte).
    const unicode = new Uint8Array([
      ...text('dir/?.txt'),
      0,
      0x04,
      0b00000000,
      ...text('dir/'),
      0b01000000,
      0x36,
      ...text('.tx'),
      0b00000000,
      ...text('t'),
    ])
    const archive = rar4([
      { name: text('dir'), data: new Uint8Array(0), flags: 0xe0 },
      { name: unicode, data: text('unicode payload'), flags: 0x200 | 0x1000 },
      { name: text('plain.txt'), data: text('stored payload') },
      { name: text('packed.bin'), data: text('xxxx'), method: 0x33 },
      { name: text('secret.bin'), data: text('yyyy'), flags: 0x04 },
    ])
    const session = await opened(archive, 'stored.rar')
    try {
      const listed = await entries(session)
      expect(listed.map(item => [item.path, item.kind])).toEqual([
        ['dir', 'directory'],
        ['dir/ж.txt', 'file'],
        ['plain.txt', 'file'],
        ['packed.bin', 'file'],
        ['secret.bin', 'file'],
      ])
      const byPath = new Map(listed.map(item => [item.path, item.id]))
      expect(new TextDecoder().decode(await extract(session, byPath.get('plain.txt') ?? ''))).toBe(
        'stored payload',
      )
      expect(new TextDecoder().decode(await extract(session, byPath.get('dir/ж.txt') ?? ''))).toBe(
        'unicode payload',
      )
      expect(await refusal(session, byPath.get('packed.bin') ?? '')).toBe(
        'archives/rar-method-unsupported',
      )
      expect(await refusal(session, byPath.get('secret.bin') ?? '')).toBe(
        'archives/password-required',
      )
      const codes = (await session.descriptor()).diagnostics.map(item => item.code).sort()
      expect(codes).toEqual(['archives/password-required', 'archives/rar-method-unsupported'])
    } finally {
      await session.dispose()
    }
  })

  it('opens RAR5 as a diagnosed, empty namespace and rejects unsafe or damaged RAR4', async () => {
    const rar5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 1, 2, 3, 4])
    const session = await opened(rar5, 'new.rar')
    try {
      expect((await session.descriptor()).diagnostics.map(item => item.code)).toEqual([
        'archives/rar5-unsupported',
      ])
    } finally {
      await session.dispose()
    }
    const unsafe = rar4([{ name: text('../evil.txt'), data: text('x') }])
    expect((await open(unsafe, 'unsafe.rar')).state).not.toBe('opened')
    const damaged = rar4([{ name: text('a.txt'), data: text('abc') }])
    damaged[25] ^= 0xff
    expect((await open(damaged, 'damaged.rar')).state).not.toBe('opened')
  })
})
