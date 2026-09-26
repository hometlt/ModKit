import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CONTAINER_EXTRACT_HANDLER_ID, createInspectionCodec } from '../src/index.js'

// A tiny range container: a 4-byte magic, then three entries' bytes. The codec only maps its index
// to a ContainerEntryTable; listing and extraction come from codec-kit (S3 stage 1).
const encoder = new TextEncoder()
const stored = encoder.encode('hello, stored entry')
const plain = encoder.encode('zlib entry '.repeat(40))
const zlibbed = new Uint8Array(deflateSync(plain))
const custom = encoder.encode('decoded by the format itself')
const container = new Uint8Array(4 + stored.byteLength + zlibbed.byteLength)
container.set(encoder.encode('CNTR'))
container.set(stored, 4)
container.set(zlibbed, 4 + stored.byteLength)

const budget = { maxInputBytes: 1024n * 1024n, maxScalarBytes: 4096, maxDepth: 32, maxNodes: 1000, maxDiagnostics: 10 }
const revision = 'provider-token:container-entries'

function open() {
  const source = {
    kind: 'bytes',
    ref: { id: 'fixture', uri: 'memory:container' },
    revision,
    size: BigInt(container.byteLength),
    async read(offset: bigint, length: number) {
      if (offset < 0n || offset + BigInt(length) > BigInt(container.byteLength)) throw new RangeError('past the source')
      return container.slice(Number(offset), Number(offset) + length)
    },
  }
  const input = {
    originKind: 'single',
    primaryBindingId: 'content',
    revisions: { topology: 'single', revision },
    bindings: [{ bindingId: 'content', role: 'content', source: source.ref, sourceKind: 'candidate', ownership: 'owned', revision }],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
  const codec = createInspectionCodec({
    id: 'example/container',
    access: 'ranges',
    format: { id: 'example-container', label: 'Container' },
    operations: [
      {
        id: 'container.extract' as never,
        handlerId: CONTAINER_EXTRACT_HANDLER_ID,
        mutatesSource: false,
        requiredPermissions: ['read-source'],
        outputKinds: ['bytes'],
      },
    ],
    detect: async prefix => ({ confidence: String.fromCharCode(...prefix.subarray(0, 4)) === 'CNTR' ? 1 : 0, kind: 'magic' }),
    async inspect() {
      return {
        summary: {},
        metadata: [],
        traits: [],
        containerEntries: {
          caseSensitivity: 'insensitive',
          complete: true,
          entries: [
            { path: 'docs/Stored.txt', size: BigInt(stored.byteLength), storage: { kind: 'stored', offset: 4n, length: BigInt(stored.byteLength) } },
            {
              path: 'docs/zlib.txt',
              size: BigInt(plain.byteLength),
              storage: { kind: 'zlib', offset: BigInt(4 + stored.byteLength), compressedLength: BigInt(zlibbed.byteLength) },
            },
            {
              path: 'custom.bin',
              size: BigInt(custom.byteLength),
              storage: {
                kind: 'custom',
                async open() {
                  return (async function* () {
                    yield custom.subarray(0, 10)
                    yield custom.subarray(10)
                  })()
                },
              },
            },
          ],
        },
      }
    },
  } as never)
  return codec.open(input as never, 'full', budget as never)
}

describe('a container entry table gives listing and extraction for free', () => {
  it('lists entries by page and prefix, with stored size and compression', async () => {
    const session = await open()
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const first = await lease.value.list('', { limit: 2 })
    expect(first.items.map(item => item.path)).toEqual(['docs/Stored.txt', 'docs/zlib.txt'])
    expect(first.nextCursor).toBe('2')
    const rest = await lease.value.list('', { limit: 2, cursor: first.nextCursor })
    expect(rest.items.map(item => item.path)).toEqual(['custom.bin'])
    expect(rest.nextCursor).toBeUndefined()
    const docs = await lease.value.list('DOCS/', { limit: 10 })
    expect(docs.items.map(item => [item.path, item.compression, item.storedSize])).toEqual([
      ['docs/Stored.txt', 'stored', undefined],
      ['docs/zlib.txt', 'zlib', BigInt(zlibbed.byteLength)],
    ])
    await lease.release()
    const descriptor = await session.descriptor()
    expect(descriptor.constraints.maxDecodedBytes).toBe(String(stored.byteLength + plain.byteLength + custom.byteLength))
    await session.operations().dispose()
  })

  it('extracts stored, zlib and custom entries, decoded and bounded by their size', async () => {
    const session = await open()
    const extract = async (entryId: string) => {
      const result = await session.operations().invoke(CONTAINER_EXTRACT_HANDLER_ID, { entryId })
      if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error(JSON.stringify(result))
      return new TextDecoder().decode(result.output.value as Uint8Array)
    }
    expect(await extract('docs/stored.txt')).toBe('hello, stored entry')
    expect(await extract('docs/zlib.txt')).toBe('zlib entry '.repeat(40))
    expect(await extract('custom.bin')).toBe('decoded by the format itself')
    await expect(
      session.operations().invoke(CONTAINER_EXTRACT_HANDLER_ID, { entryId: 'missing' }),
    ).rejects.toThrow(/requires a known \{entryId\}/)
    await session.operations().dispose()
  })
})
