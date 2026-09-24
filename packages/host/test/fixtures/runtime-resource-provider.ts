import type { ContributionContext, SelectedServiceOffer } from '@modkit/sdk'
import type {
  RuntimeProviderV2,
  RuntimeSessionCreateRequest,
  RuntimeSnapshot,
} from '@modkit/sdk/runtime'

export const abiVersion = 1
export const provides = ['common.runtime/provider']

export function createProvider(_selection: SelectedServiceOffer, context: ContributionContext) {
  const provider: RuntimeProviderV2 = {
    contract: 'common.runtime/provider',
    providerId: 'org.example/runtime-resources',
    runtimeIds: ['test.resources', 'test.legacy-resource'],
    ...(_selection.offerId === 'legacy' ? {} : { inputMode: 'logical-resources-v1' as const }),
    async createSession(request: RuntimeSessionCreateRequest) {
      const seed = (request as RuntimeSessionCreateRequest & { seed?: string }).seed
      if (_selection.offerId === 'runtime-v3' && seed === undefined)
        throw new Error('Provider v3 did not receive the replay seed')
      const input = request.inputs?.[0]
      if (input === undefined || context.logicalResources === undefined)
        throw new Error('Missing brokered runtime inputs')
      if ('resources' in request || 'providerInvocation' in request)
        throw new Error('Host resource session crossed the wire')
      const resource = await context.logicalResources.resolve(input, request.signal)
      if (resource.state !== 'resolved') throw new Error(resource.reason)
      if (resource.lease.value.kind !== 'bytes') throw new Error('Expected bytes')
      const bytes = await resource.lease.value.read(0n, 4, request.signal)
      // Deliberately retain this lease: the host must also reclaim it on failure or disposal.
      if (input.id === 'fail') throw new Error('Failure after opening a source')
      let disposed = false
      let tick = 0
      const status = async () => ({
        state: disposed ? ('disposed' as const) : ('ready' as const),
        executions: 0,
        ticks: tick,
        memoryBytes: bytes.length,
      })
      const identity = async () => ({
        contentDigest: seed === undefined
          ? `test:${tick.toString(16).padStart(2, '0')}`
          : `test:seed:${seed}:${tick.toString(16).padStart(2, '0')}`,
        schemaId: 'test-runtime-transport',
        schemaVersion: 1,
      })
      return {
        value: {
          contract: 'common.runtime/session' as const,
          sessionId: request.sessionId,
          providerId: provider.providerId,
          budget: request.budget,
          offers: ['step', 'events', 'snapshot', 'restore', 'state-hash'] as const,
          identity,
          async step(ticks: number, signal?: AbortSignal) {
            if (signal?.aborted)
              return { outcome: 'refused' as const, reason: 'cancelled' as const, diagnostics: [] }
            tick += ticks
            return { outcome: 'stepped' as const, status: await status(), diagnostics: [] }
          },
          async *events(afterSequence = 0) {
            for (let sequence = afterSequence + 1; sequence <= tick; sequence++)
              yield { sequence, tick: sequence, kind: 'test.step' }
          },
          async snapshot() {
            return {
              outcome: 'captured' as const,
              snapshot: { identity: await identity(), bytes: new Uint8Array([tick]) },
            }
          },
          async restore(snapshot: RuntimeSnapshot) {
            tick = snapshot.bytes[0] ?? 0
            return { outcome: 'restored' as const, status: await status() }
          },
          async stateHash() {
            return { outcome: 'hashed' as const, stateHash: (await identity()).contentDigest }
          },
          async execute() {
            return {
              state: 'completed' as const,
              value: [...bytes],
              usage: { wallTimeMs: 0, ticks: 0, memoryBytes: bytes.length },
              diagnostics: [],
            }
          },
          status,
        },
        async release() {
          disposed = true
          await resource.lease.release()
        },
      }
    },
  }
  return {
    value: provider,
    async release() {
      return undefined
    },
  }
}
