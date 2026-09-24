import { describe, expect, it } from 'vitest'
import type { Codec, ContributionContext } from '@modkit/sdk'
import {
  createEndpoint,
  createSurfaceRegistry,
  protocolLimits,
  type FramePort,
} from '../src/execution/index.js'
import { ABI_CODEC_MODULE, RUNTIME_ABI_SURFACES } from '../src/execution/abi-surfaces.js'
import { moduleAdapter, releaseCodec } from '../src/execution/consumer-adapters.js'

/** Two ports joined back to back, delivered on the next microtask like a MessagePort. */
function wire(): { readonly host: FramePort; readonly worker: FramePort } {
  const handlers = { host: new Set<(frame: unknown) => void>(), worker: new Set<(frame: unknown) => void>() }
  const port = (side: 'host' | 'worker'): FramePort => ({
    post: frame => {
      const cloned = structuredClone(frame)
      queueMicrotask(() => {
        for (const handler of handlers[side === 'host' ? 'worker' : 'host']) handler(cloned)
      })
    },
    onFrame: handler => {
      handlers[side].add(handler)
      return () => handlers[side].delete(handler)
    },
  })
  return { host: port('host'), worker: port('worker') }
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5))

describe('a codec created across a worker boundary', () => {
  it('lets go of the leased codec and the context ports it was given', async () => {
    const ports = wire()
    const surfaces = createSurfaceRegistry(RUNTIME_ABI_SURFACES)
    const limits = protocolLimits({ defaultCallDeadlineMs: 2_000 })
    const codec: Codec = {
      probe: async () => ({ codecId: 'org.example/demo', confidence: 0, evidence: [] }) as never,
      open: async () => {
        throw new Error('not opened in this test')
      },
    }
    const host = createEndpoint({ role: 'host', port: ports.host, session: 's', generation: 1, surfaces, limits })
    const worker = createEndpoint({
      role: 'worker', port: ports.worker, session: 's', generation: 1, surfaces, limits,
      loader: async () => ({
        module: { abiVersion: 1, createCodec: () => codec },
        surface: ABI_CODEC_MODULE,
      }),
    })
    const loaded = await host.load({
      moduleUrl: 'file:///demo/codec.js', contributionId: 'org.example/demo',
      variantId: 'portable', artifactDigest: 'sha256:demo',
    })
    const module = moduleAdapter('org.example/demo', loaded.root, async () => ({ endpoint: host, root: loaded.root }),
      async (_realm, request) => request()) as unknown as { createCodec(context: ContributionContext): Codec }
    const context = {
      budgets: { maxInputBytes: 1n, maxDepth: 1, maxNodes: 1, maxScalarBytes: 1, maxDiagnostics: 1 },
      diagnostics: { report: () => undefined },
      contracts: { resolve: async () => { throw new Error('no contracts') } },
    } as unknown as ContributionContext
    const baseline = { worker: worker.counters(), host: host.counters() }

    // A realm is kept warm across opens: every created codec must be let go of again.
    for (let index = 0; index < 3; index += 1) {
      const created = module.createCodec(context)
      await created.probe({ source: { kind: 'bytes' }, plan: { kind: 'bytes' } } as never).catch(() => undefined)
      await releaseCodec(created)
    }
    await settle()
    expect(worker.counters().localHandles).toBe(baseline.worker.localHandles)
    expect(worker.counters().remoteHandles).toBe(baseline.worker.remoteHandles)
    expect(host.counters().localHandles).toBe(baseline.host.localHandles)
    expect(host.counters().remoteHandles).toBe(baseline.host.remoteHandles)
  })
})
