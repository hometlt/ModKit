import { describe, expect, it } from 'vitest'
import { createInspectionCodec } from '../src/index.js'

describe('inspection session release', () => {
  it('releases what the codec holds for the session once, when the session is disposed', async () => {
    let released = 0
    const bytes = Uint8Array.of(0x52, 0x4e, 0x47, 0x45)
    const source = {
      kind: 'bytes',
      ref: { id: 'fixture', uri: 'memory:release' },
      revision: 'provider-token:release',
      size: BigInt(bytes.byteLength),
      async read(offset: bigint, length: number) {
        return bytes.slice(Number(offset), Number(offset) + length)
      },
    }
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      revisions: { topology: 'single', revision: source.revision },
      bindings: [
        {
          bindingId: 'content',
          role: 'content',
          source: source.ref,
          sourceKind: 'candidate',
          ownership: 'owned',
          revision: source.revision,
        },
      ],
      async openBinding() {
        return { value: source, release: async () => undefined }
      },
    }
    const codec = createInspectionCodec({
      id: 'example/release',
      access: 'ranges',
      format: { id: 'example/release', label: 'Release' },
      detect: async () => ({ confidence: 1, kind: 'magic' }),
      async inspect() {
        return { summary: null, metadata: [], traits: [], release: () => void (released += 1) }
      },
    } as never)
    const session = await codec.open(input as never, 'full', {
      maxInputBytes: 1024n,
      maxScalarBytes: 1024,
      maxDepth: 8,
      maxNodes: 100,
      maxDiagnostics: 10,
    } as never)
    expect(released).toBe(0)
    await session.dispose()
    await session.dispose()
    expect(released).toBe(1)
  })

  it('publishes the entry table nestedContext through the namespace', async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4)
    const source = {
      kind: 'bytes',
      ref: { id: 'fixture', uri: 'memory:nested' },
      revision: 'provider-token:nested',
      size: BigInt(bytes.byteLength),
      async read(offset: bigint, length: number) {
        return bytes.slice(Number(offset), Number(offset) + length)
      },
    }
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      revisions: { topology: 'single', revision: source.revision },
      bindings: [
        {
          bindingId: 'content',
          role: 'content',
          source: source.ref,
          sourceKind: 'candidate',
          ownership: 'owned',
          revision: source.revision,
        },
      ],
      async openBinding() {
        return { value: source, release: async () => undefined }
      },
    }
    const codec = createInspectionCodec({
      id: 'example/nested',
      access: 'ranges',
      format: { id: 'example/nested', label: 'Nested' },
      detect: async () => ({ confidence: 1, kind: 'magic' }),
      async inspect() {
        return {
          summary: null,
          metadata: [],
          traits: [],
          containerEntries: {
            entries: [
              { path: 'a.bin', size: 4n, storage: { kind: 'stored', offset: 0n, length: 4n } },
              {
                path: 'Assets/Crystal/model.m3',
                size: 4n,
                storage: { kind: 'stored', offset: 0n, length: 4n },
              },
              {
                path: 'Assets/Crystal_Death/model.m3',
                size: 4n,
                storage: { kind: 'stored', offset: 0n, length: 4n },
              },
            ],
            caseSensitivity: 'insensitive',
            complete: true,
            nestedContext: { names: ['A'] },
          },
        }
      },
    } as never)
    const session = await codec.open(input as never, 'full', {
      maxInputBytes: 1024n,
      maxScalarBytes: 1024,
      maxDepth: 8,
      maxNodes: 100,
      maxDiagnostics: 10,
    } as never)
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    expect(
      await (lease.value as { nestedContext?: () => Promise<unknown> }).nestedContext?.(),
    ).toEqual({ names: ['A'] })
    // a prefix selects a path and what is under it, never a sibling that shares its start
    const namespace = lease.value
    for (const prefix of ['assets/crystal', 'Assets/Crystal/'])
      expect((await namespace.list(prefix, { limit: 10 })).items.map(item => item.path)).toEqual([
        'Assets/Crystal/model.m3',
      ])
    await lease.release()
    await session.dispose()
  })

  it('publishes the entry table preamble through the namespace, bounded', async () => {
    const bytes = Uint8Array.of(1, 2, 3, 4)
    const source = {
      kind: 'bytes',
      ref: { id: 'fixture', uri: 'memory:nested' },
      revision: 'provider-token:nested',
      size: BigInt(bytes.byteLength),
      async read(offset: bigint, length: number) {
        return bytes.slice(Number(offset), Number(offset) + length)
      },
    }
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      revisions: { topology: 'single', revision: source.revision },
      bindings: [
        {
          bindingId: 'content',
          role: 'content',
          source: source.ref,
          sourceKind: 'candidate',
          ownership: 'owned',
          revision: source.revision,
        },
      ],
      async openBinding() {
        return { value: source, release: async () => undefined }
      },
    }
    const codec = createInspectionCodec({
      id: 'example/nested',
      access: 'ranges',
      format: { id: 'example/nested', label: 'Nested' },
      detect: async () => ({ confidence: 1, kind: 'magic' }),
      async inspect() {
        return {
          summary: null,
          metadata: [],
          traits: [],
          containerEntries: {
            entries: [
              { path: 'a.bin', size: 4n, storage: { kind: 'stored', offset: 0n, length: 4n } },
            ],
            caseSensitivity: 'insensitive',
            complete: true,
            async preamble(maxBytes: number) {
              return Uint8Array.of(0x4d, 0x50, 0x51, 0x1b, 9, 9).subarray(0, Math.max(maxBytes, 6))
            },
          },
        }
      },
    } as never)
    const session = await codec.open(input as never, 'full', {
      maxInputBytes: 1024n,
      maxScalarBytes: 1024,
      maxDepth: 8,
      maxNodes: 100,
      maxDiagnostics: 10,
    } as never)
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as { readPreamble?: (maxBytes: number) => Promise<Uint8Array> }
    // a table answering more than asked is refused rather than trusted
    await expect(namespace.readPreamble!(4)).rejects.toThrow(RangeError)
    expect(await namespace.readPreamble!(6)).toEqual(Uint8Array.of(0x4d, 0x50, 0x51, 0x1b, 9, 9))
    await lease.release()
    await session.dispose()
  })
})
