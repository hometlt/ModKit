/**
 * Node worker backend (NXT-114) over a real `worker_threads` Worker: activation through the
 * backend SPI, the synchronous `createCodec` adapter, probe/open round trips with host-executed
 * inputs, verify-after-load, one-load/containment rules, policy ceilings and release semantics
 * (THREAT_MODEL_WORKER_BOUNDARY acc-1, acc-6, acc-7, acc-9, acc-11).
 */
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkitx-x3/core'
import type { AssetInput, ContributionContext, ResourceBudget } from '@modkitx-x3/sdk'
import {
  activateExecutionBackend,
  createExecutionBackendRegistry,
  type ExecutionBackendActivation,
  type ExecutionModuleLease,
} from '../src/execution/backend.js'
import { workerBackendPolicy } from '../src/execution/worker-policy.js'
import {
  createNodeWorkerBackend,
  WORKER_SHARED_PROCESS_DIAGNOSTIC,
} from '../src/node/worker-backend.js'
import type { ActivationTicket } from '../src/security/gate.js'

// the bootstrap is a published entry: tests run the backend from source but the worker needs the
// built file (pnpm build), exactly like the testkit demo-worker fixture
const bootstrapUrl = new URL('../dist/node/worker-bootstrap.js', import.meta.url)
const fixtureRoot = new URL('./fixtures/worker-codec/', import.meta.url)

const budget: ResourceBudget = {
  maxInputBytes: '1048576',
  maxDepth: 8,
  maxNodes: 1000,
  maxScalarBytes: 4096,
  maxDiagnostics: 16,
} as unknown as ResourceBudget

const target = { environment: 'node', os: 'any', arch: 'any' } as unknown as Parameters<
  ReturnType<typeof createNodeWorkerBackend>['supports']
>[0]
const variant = {
  variantId: 'portable',
  executionProfile: 'worker-brokered',
  targets: [],
  entrypoint: 'codec.mjs',
} as unknown as Parameters<ReturnType<typeof createNodeWorkerBackend>['supports']>[1]

function activation(
  entrypoint: URL,
  artifactRoot: URL = fixtureRoot,
  signal?: AbortSignal,
): ExecutionBackendActivation {
  return {
    ticket: {
      contributionId: 'org.example/worker-codec',
      artifactDigest: 'sha256:artifact',
    } as unknown as ActivationTicket,
    entrypoint,
    artifactRoot,
    variant,
    target,
    grant: {} as ExecutionBackendActivation['grant'],
    ...(signal === undefined ? {} : { signal }),
  }
}

const leases: ExecutionModuleLease[] = []
const tempDirs: string[] = []
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.release().catch(() => undefined)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function backend(
  diagnostics: Diagnostic[] = [],
  overrides: Parameters<typeof workerBackendPolicy>[0] = {},
) {
  return createNodeWorkerBackend({
    bootstrapUrl,
    policy: workerBackendPolicy({ loadDeadlineMs: 10_000, graceMs: 300, ...overrides }),
    onDiagnostic: diagnostic => void diagnostics.push(diagnostic),
  })
}

async function activate(
  diagnostics: Diagnostic[] = [],
  entrypoint = new URL('codec.mjs', fixtureRoot),
  artifactRoot = fixtureRoot,
): Promise<ExecutionModuleLease> {
  const registry = createExecutionBackendRegistry([backend(diagnostics)])
  const lease = await activateExecutionBackend(registry, activation(entrypoint, artifactRoot))
  leases.push(lease)
  return lease
}

function context(sink: Diagnostic[]): ContributionContext {
  return {
    budgets: budget,
    diagnostics: { report: d => void sink.push(d) },
    contracts: {} as ContributionContext['contracts'],
  }
}

/** A host-side byte source shaped like `ArtifactByteSource`: data fields + methods. */
function byteSource(bytes: number[]) {
  const data = new Uint8Array(bytes)
  return {
    ref: { kind: 'file', path: '/demo.png' },
    revision: 'rev-1',
    kind: 'bytes',
    size: BigInt(data.length),
    read: async (offset: bigint, length: number) =>
      data.slice(Number(offset), Number(offset) + length),
    stream: async function* () {
      yield data
    },
  }
}

describe('node worker backend — activation, probe and open through the backend SPI', () => {
  it('supports worker-brokered variants on the node target only', () => {
    const b = backend()
    expect(b.profile).toBe('worker-brokered')
    expect(b.supports(target, variant)).toBe(true)
    expect(
      b.supports({ ...target, environment: 'browser' } as unknown as typeof target, variant),
    ).toBe(false)
    expect(
      b.supports(target, { ...variant, executionProfile: 'trusted-in-process' } as typeof variant),
    ).toBe(false)
  })

  it('activates a single-file codec in a real worker, reports the shared-process diagnostic, and probes through a host-executed source', async () => {
    const diagnostics: Diagnostic[] = []
    const lease = await activate(diagnostics)
    expect(diagnostics.map(d => d.code)).toContain(WORKER_SHARED_PROCESS_DIAGNOSTIC)
    expect(lease.module['abiVersion']).toBe(1)
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      probe(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
    }
    const reported: Diagnostic[] = []
    const codec = createCodec(context(reported)) // synchronous, like the ABI promises
    const source = byteSource([0x89, 0x50, 0x4e, 0x47, 0x0d])
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [], maxBytes: 4 },
    })
    expect(detection).toEqual({
      confidence: 1,
      head: [0x89, 0x50, 0x4e, 0x47],
      budgetNodes: 1000,
      planKind: 'bytes',
    })
    // the codec's diagnostic came back through the host sink capability
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(reported.map(d => d.code)).toEqual(['x3.demo/probed'])
    expect(reported[0]?.message).toContain('size=5')
    expect(reported[0]?.message).toContain('/demo.png') // a data field of the exposed source
    await lease.release()
    await lease.release()
  }, 20_000)

  it('opens a session: the asset input crosses with its fields and host-executed openers, the session comes back as an ABI-shaped adapter', async () => {
    const lease = await activate()
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      open(
        input: AssetInput,
        intent: string,
        budget: ResourceBudget,
      ): Promise<Record<string, unknown>>
    }
    const codec = createCodec(context([]))
    const opened: string[] = []
    const input = {
      originKind: 'single',
      primaryBindingId: 'b1',
      bindings: [
        {
          bindingId: 'b1',
          role: 'primary',
          ownership: 'owned',
          sourceKind: 'candidate',
          source: { kind: 'file', path: '/a' },
          revision: 'r1',
        },
        {
          bindingId: 'b2',
          role: 'x',
          ownership: 'owned',
          sourceKind: 'requirement',
          requirementId: 'x',
          source: { kind: 'file', path: '/b' },
          revision: 'r1',
        },
      ],
      revisions: {
        topology: 'single',
        revision: 'rev-7',
        bindings: [],
        compositionFingerprint: 'f',
      },
      bindingsFor: () => [],
      openBinding: async (bindingId: string) => {
        opened.push(bindingId)
        return { value: byteSource([104, 105, 106]), release: async () => undefined }
      },
    }
    const session = (await codec.open(input as unknown as AssetInput, 'inspect', budget)) as {
      revision: string
      state(): string
      descriptor(): Promise<Record<string, unknown>>
      dataSource(
        c: string,
        m: number,
      ): Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
      operations(): { invoke(id: string, v: unknown): Promise<unknown> }
      events(): Promise<AsyncIterable<unknown>>
      dispose(): Promise<void>
    }
    expect(session.revision).toBe('rev-7') // a field copied with the session handle
    expect(session.state()).toBe('live')
    expect(await session.descriptor()).toEqual({
      id: 'demo',
      intent: 'inspect',
      budgetNodes: 1000,
      originKind: 'single',
      requirementBindings: 1, // derived locally in the worker from the copied bindings
      first: [104, 105], // read through the host-executed openBinding lease
    })
    expect(opened).toEqual(['b1'])
    const text = await session.dataSource('common.view/text-data-source', 1)
    expect(await (text.value['slice'] as (r: unknown) => Promise<string>)({ from: 1, to: 4 })).toBe(
      'ell',
    )
    await text.release()
    expect(await session.operations().invoke('h', { a: 1 })).toEqual({
      kind: 'ok',
      handlerId: 'h',
      value: { a: 1 },
    })
    const events: unknown[] = []
    for await (const event of await session.events()) events.push(event)
    expect(events).toEqual([{ kind: 'state', state: 'live' }])
    await session.dispose()
    expect(session.state()).toBe('disposed')
  }, 20_000)
})

describe('node worker backend — verify-after-load, containment and policy', () => {
  function tempArtifact(files: Record<string, string | URL>): { root: URL; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'x3-worker-codec-'))
    tempDirs.push(dir)
    for (const [name, content] of Object.entries(files)) {
      if (content instanceof URL) copyFileSync(content, join(dir, name))
      else writeFileSync(join(dir, name), content, 'utf8')
    }
    return { root: pathToFileURL(`${dir}/`), dir }
  }

  it('an entrypoint changed between the host digest and the worker evaluation is refused (acc-6) and leaves no worker behind', async () => {
    const { root, dir } = tempArtifact({ 'codec.mjs': new URL('codec.mjs', fixtureRoot) })
    const entrypoint = new URL('codec.mjs', root)
    const diagnostics: Diagnostic[] = []
    const b = createNodeWorkerBackend({
      bootstrapUrl,
      policy: workerBackendPolicy({ loadDeadlineMs: 10_000, graceMs: 300 }),
      onDiagnostic: d => void diagnostics.push(d),
      // tamper inside the window: after the host took the digest, before the worker reads
      afterEntrypointDigest: () =>
        writeFileSync(
          join(dir, 'codec.mjs'),
          [
            'export const abiVersion = 1',
            'export function createCodec() { return { probe: async () => ({ confidence: 9 }) } }',
            '',
          ].join('\n'),
          'utf8',
        ),
    })
    const registry = createExecutionBackendRegistry([b])
    await expect(
      activateExecutionBackend(registry, activation(entrypoint, root)),
    ).rejects.toMatchObject({
      code: 'x3.host/artifact-digest-mismatch',
    })
    // the rejected activation released its worker; nothing crashed, nothing lingers
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(diagnostics.some(d => d.code === 'x3.host/worker-crashed')).toBe(false)
    expect(diagnostics.some(d => d.code === WORKER_SHARED_PROCESS_DIAGNOSTIC)).toBe(true)
  }, 20_000)

  it('refuses an entrypoint outside the artifact root and a module that needs relative imports (not pinned)', async () => {
    const outside = new URL('../../execution-endpoint.test.ts', fixtureRoot)
    await expect(activate([], outside, fixtureRoot)).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
    })
    await expect(activate([], new URL('imports-neighbour.mjs', fixtureRoot))).rejects.toMatchObject(
      {
        code: 'x3.host/artifact-not-pinned',
      },
    )
  }, 20_000)

  it('refuses non-file entrypoints before spawning anything', async () => {
    const registry = createExecutionBackendRegistry([backend()])
    await expect(
      activateExecutionBackend(registry, activation(new URL('https://example.invalid/codec.mjs'))),
    ).rejects.toMatchObject({ code: 'x3.host/execution-load-rejected' })
  })

  it('policy is validated against hard ceilings and never clamped', () => {
    expect(() => workerBackendPolicy({ graceMs: 999_999 })).toThrow(/exceeds the host ceiling/)
    expect(() => workerBackendPolicy({ resourceLimits: { stackSizeMb: 0 } })).toThrow(/integer ≥ 1/)
    expect(workerBackendPolicy({ loadDeadlineMs: 500 }).loadDeadlineMs).toBe(500)
    expect(workerBackendPolicy().graceMs).toBe(1_000)
  })

  it('release is idempotent and a released module answers structurally', async () => {
    const lease = await activate()
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      probe(request: unknown): Promise<unknown>
    }
    const codec = createCodec(context([]))
    await Promise.all([lease.release(), lease.release()])
    await lease.release()
    await expect(codec.probe({ source: byteSource([1]), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-endpoint-closed',
    })
  }, 20_000)
})
