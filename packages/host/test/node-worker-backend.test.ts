/**
 * Node worker backend (NXT-114) over a real `worker_threads` Worker: activation through the
 * backend SPI, the synchronous `createCodec` adapter, probe/open round trips with host-executed
 * inputs, verify-after-load, one-load/containment rules, policy ceilings and release semantics
 * (THREAT_MODEL_WORKER_BOUNDARY acc-1, acc-6, acc-7, acc-9, acc-11).
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkitx-x3/core'
import type {
  AssetInput,
  Codec,
  CodecCandidateSource,
  ContributionContext,
  DataSourceSurfaceV1Wire,
  ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  activateExecutionBackend,
  createExecutionBackendRegistry,
  type ExecutionBackendActivation,
  type ExecutionModuleLease,
} from '../src/execution/backend.js'
import { workerBackendPolicy } from '../src/execution/worker-policy.js'
import {
  createNodeWorkerBackend,
  WORKER_RESTARTED_DIAGNOSTIC,
  WORKER_SHARED_PROCESS_DIAGNOSTIC,
} from '../src/node/worker-backend.js'
import type { ActivationTicket } from '../src/security/gate.js'
import { loadExtensionDirectory } from '../src/node/loader.js'

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

const target = { environment: 'node-worker', os: 'any', arch: 'any' } as unknown as Parameters<
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
  it('supports worker-brokered variants for the node-worker realm only (the host process is where it lives, not where it runs code)', () => {
    const b = backend()
    expect(b.profile).toBe('worker-brokered')
    expect(b.supports(target, variant)).toBe(true)
    expect(
      b.supports({ ...target, environment: 'browser-worker' } as unknown as typeof target, variant),
    ).toBe(false)
    expect(
      b.supports({ ...target, environment: 'node' } as unknown as typeof target, variant),
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
      planInput: NonNullable<Codec['planInput']>
      open(
        input: AssetInput,
        intent: string,
        budget: ResourceBudget,
      ): Promise<Record<string, unknown>>
    }
    const codec = createCodec(context([]))
    expect(typeof codec.planInput).toBe('function')
    expect(
      await codec.planInput?.(byteSource([1]) as unknown as CodecCandidateSource, {
        codecId: 'demo',
        confidence: 1,
        evidence: [],
        requiredRanges: [],
      }),
    ).toEqual(
      expect.objectContaining({ candidate: expect.objectContaining({ bindingId: 'worker-plan' }) }),
    )
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
      operations(): {
        invoke(
          id: string,
          v: unknown,
          options?: { signal?: AbortSignal; onProgress?: (p: unknown) => void },
        ): Promise<unknown>
      }
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
    // operations().invoke placements: the signal and onProgress live inside the third argument,
    // stay a plain wire value on the way out, and are re-created in the worker
    const progress: unknown[] = []
    const controller = new AbortController()
    expect(
      await session
        .operations()
        .invoke('h', { a: 1 }, { signal: controller.signal, onProgress: p => progress.push(p) }),
    ).toEqual({
      kind: 'ok',
      handlerId: 'h',
      value: { a: 1 },
      sawSignal: true,
      aborted: false,
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(progress).toEqual([
      { completed: 1, total: 2, message: 'half' },
      { completed: 2, total: 2 },
    ])
    const events: unknown[] = []
    for await (const event of await session.events()) events.push(event)
    expect(events).toEqual([{ kind: 'state', state: 'live' }])
    await session.dispose()
    expect(session.state()).toBe('disposed')
  }, 20_000)

  it('opens a derived asset input: subjectsFor is derived locally, openSubject and openMaterialized run on the host (S2)', async () => {
    const lease = await activate([], new URL('derived.mjs', fixtureRoot))
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      open(
        input: AssetInput,
        intent: string,
        budget: ResourceBudget,
      ): Promise<Record<string, unknown>>
    }
    const codec = createCodec(context([]))
    const openedSubjects: string[] = []
    let materializedRead = false
    const innerSession = {
      revision: 'inner-rev',
      state: () => 'live',
      descriptor: async () => ({ id: 'inner' }),
      dataSource: async () => ({ value: {}, release: async () => undefined }),
      operations: () => ({ invoke: async () => ({ kind: 'ok' }), dispose: async () => undefined }),
      events: async function* () {
        yield* []
      },
      dispose: async () => undefined,
    }
    const input = {
      originKind: 'derived',
      subjects: [
        {
          bindingId: 's1',
          requirementId: 'a',
          role: 'primary',
          subjectUri: 'sub://a',
          revision: 'r',
          compositionFingerprint: 'f',
        },
        {
          bindingId: 's2',
          requirementId: 'b',
          role: 'aux',
          subjectUri: 'sub://b',
          revision: 'r',
          compositionFingerprint: 'f',
        },
      ],
      revisions: {
        topology: 'derived',
        revision: 'derived-rev',
        bindings: [],
        compositionFingerprint: 'f',
      },
      materialized: {
        bindingId: 'm',
        requirementId: 'mat',
        role: 'materialized',
        ownership: 'owned',
      },
      // host-executed openers (the surface's proxy methods)
      openSubject: async (bindingId: string) => {
        openedSubjects.push(bindingId)
        return { value: innerSession, release: async () => undefined }
      },
      openMaterialized: async () => ({
        value: {
          ref: { id: 'm', uri: 'file:///m.bin' },
          revision: 'r',
          kind: 'bytes',
          size: 3n,
          read: async (offset: bigint, length: number) => {
            materializedRead = true
            return new Uint8Array([7, 8, 9]).slice(Number(offset), Number(offset) + length)
          },
          stream: async function* () {
            yield new Uint8Array([7, 8, 9])
          },
        },
        release: async () => undefined,
      }),
    } as unknown as AssetInput
    const session = (await codec.open(input, 'inspect', budget)) as {
      revision: string
      descriptor(): Promise<Record<string, unknown>>
      dispose(): Promise<void>
    }
    expect(session.revision).toBe('derived-rev')
    expect(await session.descriptor()).toEqual({
      originKind: 'derived',
      subjectCount: 2,
      forA: 1, // subjectsFor('a') derived locally from the copied subjects
      innerDescriptor: { id: 'inner' }, // openSubject leased a real session on the host
      materializedHead: [7, 8, 9], // openMaterialized leased the host artifact source
    })
    expect(openedSubjects).toEqual(['s1'])
    expect(materializedRead).toBe(true)
    await session.dispose()
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

describe('node worker backend — restart is a new generation of the same session (acc-8)', () => {
  interface ProbeCodec {
    probe(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
  }
  const crashy = new URL('crashy.mjs', fixtureRoot)
  const sourceNamed = (path: string) => ({ ...byteSource([1, 2, 3]), ref: { kind: 'file', path } })

  it('after the worker died, the next createCodec brings up generation 2; the old codec stays dead and no handle travels', async () => {
    const diagnostics: Diagnostic[] = []
    const lease = await activate(diagnostics, crashy)
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => ProbeCodec
    const first = createCodec(context([]))
    const before = await first.probe({ source: sourceNamed('/ok'), plan: {} })
    expect(before['confidence']).toBe(1)

    // the worker dies mid-call: peer exit, deterministic rejection, crash reported
    await expect(first.probe({ source: sourceNamed('/crash'), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-peer-exited',
    })
    // the old codec belongs to the dead generation — it never migrates
    await expect(first.probe({ source: sourceNamed('/ok'), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-endpoint-closed',
    })

    // a fresh createCodec on the same lease → generation 2, same session, new thread
    const second = createCodec(context([]))
    const after = await second.probe({ source: sourceNamed('/ok'), plan: {} })
    expect(after['confidence']).toBe(1)
    expect(after['threadId']).not.toBe(before['threadId'])
    const restarted = diagnostics.filter(d => d.code === WORKER_RESTARTED_DIAGNOSTIC)
    expect(restarted).toHaveLength(1)
    expect(restarted[0]?.message).toContain('generation 2')
    // the shared-process diagnostic is per activation, not per generation
    expect(diagnostics.filter(d => d.code === WORKER_SHARED_PROCESS_DIAGNOSTIC)).toHaveLength(1)
    // the first generation was reported as exited by its own doing, not terminated by us
    expect(diagnostics.some(d => d.code === 'x3.host/worker-terminated')).toBe(false)
    // and the still-dead first codec is unaffected by the restart
    await expect(first.probe({ source: sourceNamed('/ok'), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-endpoint-closed',
    })
    await lease.release()
    // release after a restart shuts the live generation down cleanly
    await expect(second.probe({ source: sourceNamed('/ok'), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-endpoint-closed',
    })
  }, 30_000)

  it('concurrent callers after a death share one restart; the policy bounds restarts per lease', async () => {
    const diagnostics: Diagnostic[] = []
    const registry = createExecutionBackendRegistry([
      backend(diagnostics, { maxRestartsPerLease: 1 }),
    ])
    const lease = await activateExecutionBackend(registry, activation(crashy))
    leases.push(lease)
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => ProbeCodec
    await expect(
      createCodec(context([])).probe({ source: sourceNamed('/crash'), plan: {} }),
    ).rejects.toMatchObject({ code: 'x3.host/rpc-peer-exited' })

    // two codecs requested at once after the death: one restart, both served by generation 2
    const [a, b] = [createCodec(context([])), createCodec(context([]))]
    const [ra, rb] = await Promise.all([
      a.probe({ source: sourceNamed('/a'), plan: {} }),
      b.probe({ source: sourceNamed('/b'), plan: {} }),
    ])
    expect(ra['threadId']).toBe(rb['threadId'])
    expect(diagnostics.filter(d => d.code === WORKER_RESTARTED_DIAGNOSTIC)).toHaveLength(1)

    // generation 2 dies too: the policy allowed one restart, so the lease is now refused
    await expect(a.probe({ source: sourceNamed('/crash'), plan: {} })).rejects.toMatchObject({
      code: 'x3.host/rpc-peer-exited',
    })
    await expect(
      createCodec(context([])).probe({ source: sourceNamed('/ok'), plan: {} }),
    ).rejects.toMatchObject({ code: 'x3.host/worker-restart-limit', retryability: 'never' })
    expect(diagnostics.filter(d => d.code === WORKER_RESTARTED_DIAGNOSTIC)).toHaveLength(1)
    await lease.release()
  }, 30_000)

  it('a restart re-verifies the entrypoint: bytes changed since activation are refused, the lease reports why', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x3-restart-'))
    tempDirs.push(dir)
    copyFileSync(crashy, join(dir, 'crashy.mjs'))
    const root = pathToFileURL(`${dir}/`)
    const diagnostics: Diagnostic[] = []
    const lease = await activate(diagnostics, new URL('crashy.mjs', root), root)
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => ProbeCodec
    await expect(
      createCodec(context([])).probe({ source: sourceNamed('/crash'), plan: {} }),
    ).rejects.toMatchObject({ code: 'x3.host/rpc-peer-exited' })
    // tamper between generations
    writeFileSync(
      join(dir, 'crashy.mjs'),
      'export const abiVersion = 1\nexport function createCodec() { return { probe: async () => ({ confidence: 9 }) } }\n',
      'utf8',
    )
    await expect(
      createCodec(context([])).probe({ source: sourceNamed('/ok'), plan: {} }),
    ).rejects.toMatchObject({ code: 'x3.host/artifact-digest-mismatch' })
    expect(diagnostics.filter(d => d.code === WORKER_RESTARTED_DIAGNOSTIC)).toHaveLength(1)
    await lease.release()
  }, 30_000)
})

describe('node worker backend — verified multi-file loading through module hooks', () => {
  const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  function digestsOf(dir: string, files: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const file of files) out[file] = sha256(readFileSync(join(dir, file)))
    return out
  }
  function tempArtifact(files: Record<string, string | URL>): { root: URL; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'x3-worker-multi-'))
    tempDirs.push(dir)
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true })
      if (content instanceof URL) copyFileSync(content, join(dir, name))
      else writeFileSync(join(dir, name), content, 'utf8')
    }
    return { root: pathToFileURL(`${dir}/`), dir }
  }
  async function activateWith(
    root: URL,
    entrypoint: string,
    fileDigests: Record<string, string> | undefined,
  ): Promise<ExecutionModuleLease> {
    const registry = createExecutionBackendRegistry([backend()])
    const lease = await activateExecutionBackend(registry, {
      ...activation(new URL(entrypoint, root), root),
      ...(fileDigests === undefined ? {} : { fileDigests }),
    })
    leases.push(lease)
    return lease
  }
  const probeOf = (lease: ExecutionModuleLease) =>
    (
      lease.module['createCodec'] as (c: ContributionContext) => {
        probe(r: unknown): Promise<{ confidence: number }>
      }
    )(context([]))

  it('a multi-file entrypoint loads when every artifact file is verified against the inventory digests', async () => {
    const { root, dir } = tempArtifact({
      'entry.mjs': new URL('imports-neighbour.mjs', fixtureRoot),
      'helper.mjs': new URL('helper.mjs', fixtureRoot),
    })
    const lease = await activateWith(root, 'entry.mjs', digestsOf(dir, ['entry.mjs', 'helper.mjs']))
    expect((await probeOf(lease).probe({ source: byteSource([1]), plan: {} })).confidence).toBe(0)
  }, 20_000)

  it('a helper modified after the inventory is refused with a digest mismatch; a file the inventory never listed is refused too', async () => {
    const tampered = tempArtifact({
      'entry.mjs': new URL('imports-neighbour.mjs', fixtureRoot),
      'helper.mjs': new URL('helper.mjs', fixtureRoot),
    })
    const digests = digestsOf(tampered.dir, ['entry.mjs', 'helper.mjs'])
    writeFileSync(
      join(tampered.dir, 'helper.mjs'),
      'export const helper = () => ({ confidence: 9 })\n',
      'utf8',
    )
    await expect(activateWith(tampered.root, 'entry.mjs', digests)).rejects.toMatchObject({
      code: 'x3.host/artifact-digest-mismatch',
    })

    const unlisted = tempArtifact({
      'entry.mjs': new URL('imports-neighbour.mjs', fixtureRoot),
      'helper.mjs': new URL('helper.mjs', fixtureRoot),
    })
    await expect(
      activateWith(unlisted.root, 'entry.mjs', digestsOf(unlisted.dir, ['entry.mjs'])),
    ).rejects.toMatchObject({ code: 'x3.host/execution-load-rejected' })
  }, 20_000)

  it('dependencies resolved through the artifact node_modules load (unverified, SB-1); other escapes are refused', async () => {
    const { root, dir } = tempArtifact({
      'entry.mjs':
        "import { helper } from 'dep'\nexport const abiVersion = 1\nexport function createCodec() { return { probe: async () => helper() } }\n",
      'node_modules/dep/package.json':
        '{ "name": "dep", "type": "module", "exports": "./index.mjs" }\n',
      'node_modules/dep/index.mjs': 'export const helper = () => ({ confidence: 0.5 })\n',
    })
    const lease = await activateWith(root, 'entry.mjs', digestsOf(dir, ['entry.mjs']))
    expect((await probeOf(lease).probe({ source: byteSource([1]), plan: {} })).confidence).toBe(0.5)

    const escaping = tempArtifact({
      'entry.mjs':
        "import '../outside.mjs'\nexport const abiVersion = 1\nexport function createCodec() { return {} }\n",
    })
    writeFileSync(join(escaping.dir, '..', 'outside.mjs'), 'export const x = 1\n', 'utf8')
    await expect(
      activateWith(escaping.root, 'entry.mjs', digestsOf(escaping.dir, ['entry.mjs'])),
    ).rejects.toMatchObject({ code: 'x3.host/execution-load-rejected' })
    rmSync(join(escaping.dir, '..', 'outside.mjs'), { force: true })
  }, 20_000)
})

describe('node worker backend — a real bundled extension codec runs in the worker', () => {
  it('text-csv: inventoried through loadExtensionDirectory, its multi-file entrypoint and workspace dependencies load, probe detects CSV', async () => {
    const extensionDir = fileURLToPath(new URL('../../../extensions/data/', import.meta.url))
    const loaded = await loadExtensionDirectory(extensionDir)
    const artifact = loaded.artifact
    expect(artifact.fileDigests).toBeDefined()
    const registry = createExecutionBackendRegistry([backend()])
    const entrypoint = new URL(
      './src/families/delimited/entrypoints/csv-codec.js',
      artifact.artifactRoot,
    )
    const lease = await activateExecutionBackend(registry, {
      ...activation(entrypoint, artifact.artifactRoot),
      ...(artifact.fileDigests === undefined ? {} : { fileDigests: artifact.fileDigests }),
    })
    leases.push(lease)
    const codec = (
      lease.module['createCodec'] as (c: ContributionContext) => {
        probe(
          request: unknown,
          signal?: AbortSignal,
        ): Promise<{ codecId: string; confidence: number }>
      }
    )(context([]))
    const csv = new TextEncoder().encode('name,value\nhello,1\nworld,2\n')
    const source = {
      ref: { uri: 'file:///demo.csv' },
      revision: 'rev-1',
      kind: 'bytes',
      size: BigInt(csv.length),
      read: async (offset: bigint, length: number) =>
        csv.slice(Number(offset), Number(offset) + length),
      stream: async function* () {
        yield csv
      },
    }
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
    })
    expect(detection.codecId).toBe('org.modkitx/text-csv')
    expect(detection.confidence).toBeGreaterThan(0.5)
  }, 30_000)
})

describe('node worker backend — a real codec opens a session with a host-resolved provider', () => {
  it('text-csv open(): contracts.resolve crosses to the host and the provider data source runs on the host', async () => {
    const extensionDir = fileURLToPath(new URL('../../../extensions/data/', import.meta.url))
    const loaded = await loadExtensionDirectory(extensionDir)
    const artifact = loaded.artifact
    // the provider runs on the host, in-process (as the trusted-in-process path activates it)
    const providerModule = (await import(
      new URL('./src/families/delimited/entrypoints/csv-provider.js', artifact.artifactRoot).href
    )) as { createProvider(selection: unknown): { value: unknown; release(): Promise<void> } }
    // the JSON syntax contract definition (service arm) carries the provider's method surface
    const definition = JSON.parse(
      readFileSync(join(extensionDir, 'contributions', 'contract-csv-syntax.json'), 'utf8'),
    ) as { spec: { contract: string; major: number; surface: DataSourceSurfaceV1Wire } }
    const b = createNodeWorkerBackend({
      bootstrapUrl,
      policy: workerBackendPolicy({ loadDeadlineMs: 10_000, graceMs: 300 }),
      foreignSurfaces: [
        {
          contract: definition.spec.contract,
          major: definition.spec.major,
          surface: definition.spec.surface,
        },
      ],
    })
    const registry = createExecutionBackendRegistry([b])
    const entrypoint = new URL(
      './src/families/delimited/entrypoints/csv-codec.js',
      artifact.artifactRoot,
    )
    const lease = await activateExecutionBackend(registry, {
      ...activation(entrypoint, artifact.artifactRoot),
      ...(artifact.fileDigests === undefined ? {} : { fileDigests: artifact.fileDigests }),
    })
    leases.push(lease)
    const resolved: string[] = []
    const codec = (
      lease.module['createCodec'] as (c: ContributionContext) => {
        open(
          input: unknown,
          intent: string,
          budget: ResourceBudget,
          signal?: AbortSignal,
        ): Promise<Record<string, unknown>>
      }
    )({
      budgets: budget,
      diagnostics: { report: () => undefined },
      contracts: {
        resolve: async (request: { contract: string; major: number }) => {
          resolved.push(`${request.contract}@${request.major}`)
          return providerModule.createProvider({ contract: request.contract, major: request.major })
        },
        resolveUnknown: async () => {
          throw new Error('not expected')
        },
      } as unknown as ContributionContext['contracts'],
    })
    const csv = new TextEncoder().encode('greeting,n\nhello,1\nworld,2\n')
    const input = {
      originKind: 'single',
      primaryBindingId: 'content',
      bindings: [
        {
          bindingId: 'content',
          role: 'content',
          ownership: 'owned',
          sourceKind: 'candidate',
          source: { id: 'src-1', uri: 'file:///demo.csv' },
          revision: 'content-hash:demo',
        },
      ],
      revisions: {
        topology: 'single',
        revision: 'content-hash:demo',
        bindings: [],
        compositionFingerprint: 'f',
      },
      bindingsFor: () => [],
      openBinding: async () => ({
        value: {
          ref: { id: 'src-1', uri: 'file:///demo.csv' },
          revision: 'content-hash:demo',
          kind: 'bytes',
          size: BigInt(csv.length),
          read: async (offset: bigint, length: number) =>
            csv.slice(Number(offset), Number(offset) + length),
          stream: async function* () {
            yield csv
          },
        },
        release: async () => undefined,
      }),
    }
    const session = (await codec.open(input, 'inspect', budget)) as {
      revision: string
      descriptor(): Promise<Record<string, unknown>>
      dataSource(
        c: string,
        m: number,
      ): Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
      dispose(): Promise<void>
    }
    expect(resolved).toEqual(['common.text-data/csv-syntax@1'])
    expect(session.revision).toBe('content-hash:demo')
    const descriptor = await session.descriptor()
    expect(descriptor['schemaVersion']).toBe(2)
    const table = await session.dataSource('common.view/table-data-source', 1)
    const rows = await (table.value['rows'] as (request: unknown) => Promise<{ items: unknown[] }>)(
      { kind: 'range', from: 0, count: 10 },
    )
    expect(rows.items.length).toBeGreaterThan(0)
    await table.release()
    await session.dispose()
  }, 30_000)
})

describe('node worker backend — provider in one worker, codec in another, the host bridges them (S1b product path)', () => {
  it('text-csv: the provider leases in worker B and its codec in worker A crosses both boundaries', async () => {
    const extensionDir = fileURLToPath(new URL('../../../extensions/data/', import.meta.url))
    const loaded = await loadExtensionDirectory(extensionDir)
    const artifact = loaded.artifact
    const definition = JSON.parse(
      readFileSync(join(extensionDir, 'contributions', 'contract-csv-syntax.json'), 'utf8'),
    ) as { spec: { contract: string; major: number; surface: DataSourceSurfaceV1Wire } }
    // one backend, definitions late-bound (registered after the backend exists, like an app does)
    let definitions: { contract: string; major: number; surface: DataSourceSurfaceV1Wire }[] = []
    const diagnostics: Diagnostic[] = []
    const b = createNodeWorkerBackend({
      bootstrapUrl,
      policy: workerBackendPolicy({ loadDeadlineMs: 10_000, graceMs: 300 }),
      foreignSurfaces: () => definitions,
      onDiagnostic: d => void diagnostics.push(d),
    })
    definitions = [
      {
        contract: definition.spec.contract,
        major: definition.spec.major,
        surface: definition.spec.surface,
      },
    ]
    const registry = createExecutionBackendRegistry([b])
    const digests = artifact.fileDigests === undefined ? {} : { fileDigests: artifact.fileDigests }

    // worker B: the service-provider module
    const providerLease = await activateExecutionBackend(registry, {
      ...activation(
        new URL('./src/families/delimited/entrypoints/csv-provider.js', artifact.artifactRoot),
        artifact.artifactRoot,
      ),
      ...digests,
    })
    leases.push(providerLease)
    expect(providerLease.module['abiVersion']).toBe(1)
    expect(providerLease.module['provides']).toEqual([definition.spec.contract])
    const createProvider = providerLease.module['createProvider'] as (
      selection: unknown,
      context: ContributionContext,
    ) => Promise<{ value: Record<string, unknown>; release(): Promise<void> }>

    // worker A: the codec; its contracts.resolve runs on the host and hands back B's provider
    const codecLease = await activateExecutionBackend(registry, {
      ...activation(
        new URL('./src/families/delimited/entrypoints/csv-codec.js', artifact.artifactRoot),
        artifact.artifactRoot,
      ),
      ...digests,
    })
    leases.push(codecLease)
    const resolved: string[] = []
    const providerLeases: { release(): Promise<void> }[] = []
    const codec = (
      codecLease.module['createCodec'] as (c: ContributionContext) => {
        open(
          input: unknown,
          intent: string,
          budget: ResourceBudget,
        ): Promise<Record<string, unknown>>
      }
    )({
      budgets: budget,
      diagnostics: { report: () => undefined },
      contracts: {
        resolve: async (request: { contract: string; major: number }) => {
          resolved.push(`${request.contract}@${request.major}`)
          const lease = await createProvider(
            { offerId: 'csv-syntax-default-v1', contract: request.contract, major: request.major },
            { budgets: budget, diagnostics: { report: () => undefined }, contracts: {} as never },
          )
          providerLeases.push(lease)
          return lease
        },
        resolveUnknown: async () => {
          throw new Error('not expected')
        },
      } as unknown as ContributionContext['contracts'],
    })
    const csv = new TextEncoder().encode('greeting,n\nhello,1\nworld,2\n')
    const source = {
      ref: { id: 'src-1', uri: 'file:///demo.csv' },
      revision: 'content-hash:demo',
      kind: 'bytes',
      size: BigInt(csv.length),
      read: async (offset: bigint, length: number) =>
        csv.slice(Number(offset), Number(offset) + length),
      stream: async function* () {
        yield csv
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
          source: { id: 'src-1', uri: 'file:///demo.csv' },
          revision: 'content-hash:demo',
        },
      ],
      revisions: {
        topology: 'single',
        revision: 'content-hash:demo',
        bindings: [],
        compositionFingerprint: 'f',
      },
      bindingsFor: () => [],
      openBinding: async () => ({ value: source, release: async () => undefined }),
    }
    const session = (await codec.open(input, 'inspect', budget)) as {
      descriptor(): Promise<Record<string, unknown>>
      dataSource(
        c: string,
        m: number,
      ): Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
      dispose(): Promise<void>
    }
    expect(resolved).toEqual(['common.text-data/csv-syntax@1'])
    expect((await session.descriptor())['schemaVersion']).toBe(2)
    // A → host → B: the tree data source lives in worker B, leased through A's session
    const table = await session.dataSource('common.view/table-data-source', 1)
    const rows = await (table.value['rows'] as (request: unknown) => Promise<{ items: unknown[] }>)(
      { kind: 'range', from: 0, count: 10 },
    )
    expect(rows.items.length).toBeGreaterThan(0)
    await table.release()
    await session.dispose()
    for (const lease of providerLeases) await lease.release()
    // two activations → two shared-process notices, two workers, no crashes or restarts
    expect(diagnostics.filter(d => d.code === WORKER_SHARED_PROCESS_DIAGNOSTIC)).toHaveLength(2)
    expect(diagnostics.some(d => d.code === 'x3.host/worker-crashed')).toBe(false)
    expect(diagnostics.some(d => d.code === WORKER_RESTARTED_DIAGNOSTIC)).toBe(false)
  }, 40_000)
})
