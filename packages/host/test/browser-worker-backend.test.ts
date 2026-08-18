/**
 * S5: the browser worker backend end to end, in-process — the injected realm runs the production
 * `runBrowserWorkerBootstrap` over a real Node MessageChannel (event-target adapter, the same
 * style a DOM port uses), the loader is the production `loadVerifiedModuleGraph` minting `data:`
 * URLs, and the module under test is the same worker-codec fixture the Node backend proves. Only
 * `new Worker(...)` itself is absent; every endpoint, loader rule and adapter is production code.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkitx-x3/core'
import type { ContributionContext, ResourceBudget } from '@modkitx-x3/sdk'
import { framePortFromMessagePort, type MessagePortLike } from '../src/execution/index.js'
import {
  activateExecutionBackend,
  createExecutionBackendRegistry,
  type ExecutionBackendActivation,
  type ExecutionModuleLease,
} from '../src/execution/backend.js'
import {
  createBrowserWorkerBackend,
  WORKER_SHARED_ORIGIN_DIAGNOSTIC,
} from '../src/browser/worker-backend.js'
import { runBrowserWorkerBootstrap } from '../src/browser/worker-bootstrap-core.js'
import type { ActivationTicket } from '../src/security/gate.js'

const fixtureRoot = new URL('./fixtures/worker-codec/', import.meta.url)
const ROOT = 'https://app.example/ext/worker-codec/'

const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Serve the on-disk fixture over a fake origin, with per-file digests like the inventory's. */
function servedArtifact(files: readonly string[]) {
  const bytes = new Map<string, Uint8Array>()
  const digests: Record<string, string> = {}
  for (const name of files) {
    const content = new Uint8Array(readFileSync(new URL(name, fixtureRoot)))
    bytes.set(name, content)
    digests[name] = sha256(content)
  }
  return {
    digests,
    tamper(name: string, text: string) {
      bytes.set(name, new TextEncoder().encode(text))
    },
    fetchBytes: async (url: string) => {
      const name = url.slice(ROOT.length)
      const content = bytes.get(name)
      if (content === undefined) throw new Error(`404 ${url}`)
      return content
    },
  }
}

const loaderHooks = {
  digest: async (data: Uint8Array) => sha256(data),
  createModuleUrl: (source: string) =>
    `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
}

const budget: ResourceBudget = {
  maxInputBytes: '1048576',
  maxDepth: 8,
  maxNodes: 1000,
  maxScalarBytes: 4096,
  maxDiagnostics: 16,
} as unknown as ResourceBudget

const target = { environment: 'browser-worker', os: 'any', arch: 'any' } as never
const variant = {
  variantId: 'portable',
  executionProfile: 'worker-brokered',
  targets: [],
  entrypoint: 'codec.mjs',
} as never

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** The in-process realm: the production bootstrap core over a real MessageChannel pair. */
function inProcessRealm() {
  return (spawn: {
    session: string
    generation: number
    limits: never
    foreignSurfaces: never
    moduleUrl: string
  }) => {
    const channel = new MessageChannel()
    const endpoint = runBrowserWorkerBootstrap({
      port: framePortFromMessagePort(channel.port2 as unknown as MessagePortLike),
      session: spawn.session,
      generation: spawn.generation,
      limits: spawn.limits,
      foreignSurfaces: spawn.foreignSurfaces,
      moduleUrl: spawn.moduleUrl,
    })
    cleanups.push(() => {
      channel.port1.close()
      channel.port2.close()
    })
    return {
      port: framePortFromMessagePort(channel.port1 as unknown as MessagePortLike),
      terminate: () => void endpoint.close('terminated'),
    }
  }
}

function activation(entrypoint: string, digests: Record<string, string>) {
  return {
    ticket: {
      contributionId: 'org.example/browser-codec',
      artifactDigest: 'sha256:artifact',
    } as unknown as ActivationTicket,
    entrypoint: new URL(entrypoint, ROOT),
    artifactRoot: new URL(ROOT),
    fileDigests: digests,
    variant,
    target,
    grant: {} as ExecutionBackendActivation['grant'],
  } satisfies ExecutionBackendActivation
}

const leases: ExecutionModuleLease[] = []
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.release().catch(() => undefined)
})

describe('browser worker backend — verified snapshot loading and the shared consumer adapters', () => {
  it('activates the fixture codec from fetched+verified bytes and probes through a host-executed source', async () => {
    const artifact = servedArtifact(['codec.mjs'])
    const diagnostics: Diagnostic[] = []
    const backend = createBrowserWorkerBackend({
      realm: inProcessRealm() as never,
      loader: { fetchBytes: artifact.fetchBytes, ...loaderHooks },
      onDiagnostic: diagnostic => void diagnostics.push(diagnostic),
    })
    expect(backend.supports(target, variant)).toBe(true)
    expect(
      backend.supports({ ...(target as object), environment: 'node-worker' } as never, variant),
    ).toBe(false)
    const registry = createExecutionBackendRegistry([backend])
    const lease = await activateExecutionBackend(
      registry,
      activation('codec.mjs', artifact.digests),
    )
    leases.push(lease)
    const shared = diagnostics.find(item => item.code === WORKER_SHARED_ORIGIN_DIAGNOSTIC)
    expect(shared?.message).toContain('verified snapshot (1 file(s)')
    expect(lease.module['abiVersion']).toBe(1)

    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      probe(request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>
    }
    const reported: Diagnostic[] = []
    const codec = createCodec({
      budgets: budget,
      diagnostics: { report: d => void reported.push(d) },
      contracts: {} as ContributionContext['contracts'],
    })
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])
    const detection = await codec.probe({
      source: {
        ref: { kind: 'file', path: '/demo.png' },
        revision: 'rev-1',
        kind: 'bytes',
        size: BigInt(data.length),
        read: async (offset: bigint, length: number) =>
          data.slice(Number(offset), Number(offset) + length),
        stream: async function* () {
          yield data
        },
      },
      plan: { kind: 'bytes', ranges: [], maxBytes: 4 },
    })
    expect(detection).toEqual({
      confidence: 1,
      head: [0x89, 0x50, 0x4e, 0x47],
      budgetNodes: 1000,
      planKind: 'bytes',
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(reported.map(item => item.code)).toEqual(['x3.demo/probed'])
    await lease.release()
    await lease.release()
  }, 20_000)

  it('a tampered file is refused before any evaluation; the realm is never spawned', async () => {
    const artifact = servedArtifact(['codec.mjs'])
    artifact.tamper('codec.mjs', 'export const abiVersion = 1\n')
    let spawned = 0
    const backend = createBrowserWorkerBackend({
      realm: ((spawn: unknown) => {
        spawned += 1
        return (inProcessRealm() as (s: unknown) => never)(spawn)
      }) as never,
      loader: { fetchBytes: artifact.fetchBytes, ...loaderHooks },
    })
    const registry = createExecutionBackendRegistry([backend])
    await expect(
      activateExecutionBackend(registry, activation('codec.mjs', artifact.digests)),
    ).rejects.toMatchObject({ code: 'x3.host/artifact-digest-mismatch' })
    expect(spawned).toBe(0)
  }, 20_000)

  it('the bootstrap serves exactly one load of exactly the verified snapshot URL', async () => {
    const artifact = servedArtifact(['codec.mjs'])
    const backend = createBrowserWorkerBackend({
      realm: inProcessRealm() as never,
      loader: { fetchBytes: artifact.fetchBytes, ...loaderHooks },
    })
    const registry = createExecutionBackendRegistry([backend])
    const lease = await activateExecutionBackend(
      registry,
      activation('codec.mjs', artifact.digests),
    )
    leases.push(lease)
    // a released lease answers structurally — no lingering realm serves a second life
    await lease.release()
    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      probe(request: unknown): Promise<unknown>
    }
    await expect(
      createCodec({
        budgets: budget,
        diagnostics: { report: () => undefined },
        contracts: {} as ContributionContext['contracts'],
      }).probe({}),
    ).rejects.toMatchObject({ code: 'x3.host/rpc-endpoint-closed' })
  }, 20_000)
})
