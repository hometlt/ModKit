/**
 * A range-mode inspection codec in a real node worker opens a 4.5 GiB container: every read
 * crosses the worker boundary as a range of the host-side source, and none of them is the file.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionBackendActivation, ExecutionModuleLease } from '@modkit/host'
import { createNodeWorkerBackend, workerBackendPolicy } from '@modkit/host/node'
import type { AssetInput, ContributionContext, ResourceBudget } from '@modkit/sdk'

const bootstrapUrl = pathToFileURL(
  createRequire(import.meta.url).resolve('@modkit/host/node/worker-bootstrap'),
)
const fixtureRoot = new URL('./fixtures/range-inspection-worker/', import.meta.url)

const GiB = 1024n ** 3n
const size = 4n * GiB + GiB / 2n + 4096n
const entryOffset = 4n * GiB + 12_345n
const entryLength = 4096
const header = new Uint8Array(16)
header.set([0x52, 0x4e, 0x47, 0x45])
new DataView(header.buffer).setBigUint64(4, entryOffset, true)
new DataView(header.buffer).setUint32(12, entryLength, true)
const byteAt = (position: bigint): number =>
  position < 16n
    ? (header[Number(position)] as number)
    : Number(((position * 2_654_435_761n) >> 13n) & 0xffn)
const expected = (offset: bigint, length: number): number[] =>
  Array.from({ length }, (_, index) => byteAt(offset + BigInt(index)))

const budget: ResourceBudget = {
  maxInputBytes: 1024n * 1024n,
  maxDepth: 8,
  maxNodes: 1000,
  maxScalarBytes: 4096,
  maxDiagnostics: 16,
}

const leases: ExecutionModuleLease[] = []
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.release().catch(() => undefined)
})

async function activate(): Promise<ExecutionModuleLease> {
  const backend = createNodeWorkerBackend({
    bootstrapUrl,
    policy: workerBackendPolicy({ loadDeadlineMs: 10_000, graceMs: 300 }),
    onDiagnostic: () => undefined,
  })
  const lease = await backend.activate({
    ticket: { contributionId: 'org.example/ranges', artifactDigest: 'sha256:artifact' },
    entrypoint: new URL('codec.mjs', fixtureRoot),
    artifactRoot: fixtureRoot,
    variant: {
      variantId: 'portable',
      executionProfile: 'worker-brokered',
      targets: [],
      entrypoint: 'codec.mjs',
    },
    target: { environment: 'node-worker', os: 'any', arch: 'any' },
    grant: {},
  } as unknown as ExecutionBackendActivation)
  leases.push(lease)
  return lease
}

describe('range inspection codec in a node worker', () => {
  it('opens a 4.5 GiB host-side source by ranges and reads an entry past 4 GiB exactly', async () => {
    const reads: { offset: bigint; length: number }[] = []
    const source = {
      ref: { id: 'fixture', uri: 'memory:range-fixture' },
      revision: 'provider-token:range-fixture',
      kind: 'bytes',
      size,
      read: async (offset: bigint, length: number) => {
        if (offset < 0n || offset + BigInt(length) > size) throw new RangeError('past the source')
        reads.push({ offset, length })
        return Uint8Array.from(expected(offset, length))
      },
      stream: async function* () {
        throw new Error('a range codec never streams the whole source')
      },
    }
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      bindings: [
        {
          bindingId: 'content',
          role: 'content',
          ownership: 'owned',
          sourceKind: 'candidate',
          source: source.ref,
          revision: 'provider-token:range-fixture',
        },
      ],
      revisions: {
        topology: 'single',
        revision: 'provider-token:range-fixture',
        bindings: [],
        compositionFingerprint: 'f',
      },
      bindingsFor: () => [],
      openBinding: async () => ({ value: source, release: async () => undefined }),
    }
    const lease = await activate()
    const createCodec = lease.module['createCodec'] as (context: ContributionContext) => {
      open(input: AssetInput, intent: string, budget: ResourceBudget): Promise<Session>
    }
    type Session = {
      descriptor(): Promise<{
        operations: { id: string }[]
        constraints: { seekable: boolean; randomAccess: boolean; maxDecodedBytes: string }
      }>
      dataSource(
        contract: string,
        major: number,
      ): Promise<{
        value: {
          size(): Promise<bigint>
          read(offset: bigint, length: number): Promise<Uint8Array>
        }
        release(): Promise<void>
      }>
      operations(): {
        invoke(
          id: string,
          value: unknown,
        ): Promise<{ state: string; output: { value: { offset: string; entry: number[] } } }>
      }
      dispose(): Promise<void>
    }
    const codec = createCodec({
      budgets: budget,
      diagnostics: { report: () => undefined },
      contracts: {} as ContributionContext['contracts'],
    })
    const session = await codec.open(input as unknown as AssetInput, 'full', budget)
    const opened = reads.reduce((total, read) => total + read.length, 0)
    expect(opened).toBeLessThanOrEqual(64 * 1024 + 16 + entryLength)

    const inspected = await session.operations().invoke('inspect', null)
    expect(inspected.state).toBe('ok')
    expect(inspected.output.value.offset).toBe(String(entryOffset))
    expect(inspected.output.value.entry).toEqual(expected(entryOffset, entryLength))
    const descriptor = await session.descriptor()
    expect(descriptor.operations.map(operation => operation.id)).not.toContain('export.raw')
    expect(descriptor.constraints).toMatchObject({
      seekable: true,
      randomAccess: true,
      maxDecodedBytes: String(size),
    })

    const bytes = await session.dataSource('common.view/byte-range-source', 1)
    expect(await bytes.value.size()).toBe(size)
    expect([...(await bytes.value.read(entryOffset + 7n, 64))]).toEqual(
      expected(entryOffset + 7n, 64),
    )
    await expect(bytes.value.read(size + 1n, 1)).rejects.toThrow(/outside the source/)
    await expect(bytes.value.read(0n, Number(budget.maxInputBytes) + 1)).rejects.toThrow(
      /inspection budget/,
    )
    await bytes.release()
    await session.dispose()
  }, 30_000)
})
