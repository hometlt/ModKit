import { describe, expect, it } from 'vitest'
import { revisionId, type AssetSession, type ByteRangeSource, type NamespaceEntry } from '@modkit/sdk'
import {
  commandRequest,
  createSubjectCommandRuntime,
  executeCommandRequest,
  type CommandSubject,
} from '../src/index.js'

// A container of 10 MiB whose members are read by range: one stored in place, one the container
// decodes block by block. Neither may be extracted whole when the host can stream.
const CARRIER = new Uint8Array(10 * 1024 * 1024).map((_, index) => index % 251)
const stored: NamespaceEntry = {
  id: 'big.bin',
  path: 'big.bin',
  name: 'big.bin', revision: revisionId('provider-token:extract'),
  kind: 'file',
  storedRange: { offset: 7n, length: BigInt(CARRIER.byteLength - 7) },
}
const decoded: NamespaceEntry = {
  id: 'packed.bin',
  path: 'packed.bin',
  name: 'packed.bin', revision: revisionId('provider-token:extract'),
  kind: 'file',
  rangeAccess: true,
}
const small: NamespaceEntry = { id: 'small.txt', path: 'small.txt', name: 'small.txt',
  revision: revisionId('provider-token:extract'), kind: 'file' }

const carrierSource: ByteRangeSource = {
  size: async () => BigInt(CARRIER.byteLength),
  read: async (offset, length) => CARRIER.slice(Number(offset), Number(offset) + length),
}

function subject(extracted: string[]): CommandSubject {
  const lease = <T>(value: T) => ({ value, release: async () => undefined })
  const session = {
    async descriptor() {
      return {
        operations: [{ id: 'container.extract', handlerId: 'extract', state: 'available' }],
        dataSources: [
          { contract: 'common.view/namespace-entry-source', major: 1 },
          { contract: 'common.view/byte-range-source', major: 1 },
        ],
      }
    },
    async dataSource(contract: string) {
      if (contract === 'common.view/byte-range-source') return lease(carrierSource)
      return lease({
        async lookup(path: string) {
          return [stored, decoded, small].find(entry => entry.path === path)
        },
        async list() {
          return { items: [stored, decoded, small] }
        },
        async openEntrySource() {
          return lease({ size: async () => 5_000_000n, read: carrierSource.read })
        },
      })
    },
    operations: () => ({
      async invoke(_handler: string, input: { readonly entryId: string }) {
        extracted.push(input.entryId)
        return {
          state: 'ok',
          diagnostics: [],
          output: { kind: 'bytes', value: new Uint8Array([1, 2, 3]) },
        }
      },
    }),
  } as unknown as AssetSession
  return {
    ref: 'archive.pak',
    snapshot: { state: 'opened', diagnostics: [] } as unknown as CommandSubject['snapshot'],
    session,
    dispose: async () => undefined,
  }
}

async function extract(entry: string, stream: boolean) {
  const extracted: string[] = []
  const chunks: number[] = []
  let total = 0
  let first: Uint8Array | undefined
  const receipt = await executeCommandRequest(
    createSubjectCommandRuntime(),
    commandRequest('subject.extract', { subject: 'archive.pak', entry }),
    {
      openSubject: async () => subject(extracted),
      writeOutput: async (name, bytes) => {
        total = bytes.byteLength
        return `whole:${name}`
      },
      ...(stream
        ? {
            writeOutputStream: async (name: string, parts: AsyncIterable<Uint8Array>) => {
              for await (const part of parts) {
                first ??= part
                chunks.push(part.byteLength)
                total += part.byteLength
              }
              return `stream:${name}`
            },
          }
        : {}),
    },
  )
  return { result: receipt.result, extracted, chunks, total, first }
}

describe('subject.extract streams a member the container reads by range', () => {
  it('reads a stored member from its range of the carrier, in bounded chunks', async () => {
    const run = await extract('big.bin', true)
    expect(run.result).toMatchObject({
      state: 'ok',
      data: { byteLength: CARRIER.byteLength - 7, wroteTo: 'stream:big.bin' },
    })
    expect(run.extracted).toEqual([])
    expect(run.total).toBe(CARRIER.byteLength - 7)
    expect(Math.max(...run.chunks)).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(run.first?.[0]).toBe(CARRIER[7])
  })

  it('reads a decoded member through its own range source', async () => {
    const run = await extract('packed.bin', true)
    expect(run.result).toMatchObject({ state: 'ok', data: { byteLength: 5_000_000 } })
    expect(run.extracted).toEqual([])
    expect(run.total).toBe(5_000_000)
  })

  it('extracts whole a member without range access, or when the host cannot stream', async () => {
    const plain = await extract('small.txt', true)
    expect(plain.result).toMatchObject({ state: 'ok', data: { wroteTo: 'whole:small.txt' } })
    expect(plain.extracted).toEqual(['small.txt'])
    const noStream = await extract('big.bin', false)
    expect(noStream.result).toMatchObject({ state: 'ok', data: { wroteTo: 'whole:big.bin' } })
    expect(noStream.extracted).toEqual(['big.bin'])
  })
})
