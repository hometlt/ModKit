/**
 * Host-side consumer adapters over a remote worker module (shared by the Node and browser
 * worker backends): the module lease exposes the *synchronous* `createCodec(context)` /
 * `createProvider(selection, context)` the ABI promises, backed by the remote root; a codec is
 * bound to the realm generation that created it, sessions come back as ABI-shaped adapters and
 * the OperationSession lease carries the invoke placements. The watchdog policy stays with the
 * backend (`ConsumerWatch`); these adapters never spawn or terminate anything themselves.
 */

import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import type {
  AssetInput,
  AssetInputPlan,
  AssetSession,
  Codec,
  CodecCandidateSource,
  CodecProbeRequest,
  ContributionContext,
  DetectionResult,
  Lease,
  OpenIntent,
  ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  ABI_ARTIFACT_SOURCE,
  ABI_ASSET_INPUT,
  ABI_CONTRACT_RESOLVER,
  ABI_DIAGNOSTIC_SINK,
  ABI_SERVICE_PROVIDER_MODULE,
} from './abi-surfaces.js'
import type { Endpoint, RemoteCapability } from './endpoint.js'

/** Everything the consumer adapters need from one live realm. */
export interface ConsumerRealm {
  readonly endpoint: Endpoint
  readonly root: RemoteCapability
}

/** Runs a request under the backend's watchdog policy for the given realm. */
export type ConsumerWatch = <T>(realm: ConsumerRealm, request: () => Promise<T>) => Promise<T>

/** A codec is bound to the generation that created it; its calls never migrate. */
interface BoundCodec {
  readonly realm: ConsumerRealm
  readonly remote: RemoteCapability
}

export function moduleAdapter(
  contributionId: string,
  first: RemoteCapability,
  realm: () => Promise<ConsumerRealm>,
  watch: ConsumerWatch,
): Record<string, unknown> {
  const abiVersion = first.data['abiVersion']
  /** `context` crosses as data + two host capabilities (diagnostics sink, contract resolver). */
  const wireContext = (endpoint: Endpoint, context: ContributionContext) => ({
    budgets: context.budgets,
    diagnostics: endpoint.expose(
      { report: (diagnostic: Diagnostic) => context.diagnostics.report(diagnostic) },
      ABI_DIAGNOSTIC_SINK,
    ),
    // the host executes contract resolution; the worker gets a proxy whose leased providers
    // carry the surface of the requested contract's definition
    contracts: endpoint.expose(context.contracts, ABI_CONTRACT_RESOLVER),
  })
  if (first.contract === ABI_SERVICE_PROVIDER_MODULE.contract) {
    // ServiceProviderModule ABI v1: the provider is leased by the contract the selection names
    return Object.freeze({
      abiVersion,
      provides: first.data['provides'],
      createProvider: async (
        selection: { readonly contract: string; readonly major: number },
        context: ContributionContext,
      ): Promise<Lease<unknown>> => {
        const live = await realm()
        const outcome = await watch(live, () =>
          live.root.call('createProvider', [selection, wireContext(live.endpoint, context)]),
        )
        if (outcome.kind !== 'lease') {
          throw new ModkitError({
            code: 'x3.host/invalid-service-provider-lease',
            message: `createProvider of ${contributionId} did not lease a provider`,
          })
        }
        const remote = outcome.remote
        return {
          value: live.endpoint.materialize(remote),
          release: () => remote.release(),
        }
      },
    })
  }
  return Object.freeze({
    abiVersion,
    createCodec: (context: ContributionContext): Codec => {
      const bound = realm().then(async live => {
        const outcome = await watch(live, () =>
          live.root.call('createCodec', [wireContext(live.endpoint, context)]),
        )
        if (outcome.kind !== 'lease') {
          throw new ModkitError({
            code: 'x3.host/invalid-codec-module',
            message: `createCodec of ${contributionId} did not lease a codec`,
          })
        }
        return { realm: live, remote: outcome.remote } satisfies BoundCodec
      })
      bound.catch(() => undefined)
      return codecAdapter(bound, watch)
    },
  })
}

function codecAdapter(bound: Promise<BoundCodec>, watch: ConsumerWatch): Codec {
  return {
    async probe(request: CodecProbeRequest, signal?: AbortSignal): Promise<DetectionResult> {
      const { realm, remote } = await bound
      const source = realm.endpoint.expose(request.source as object, ABI_ARTIFACT_SOURCE)
      try {
        const outcome = await watch(realm, () =>
          remote.call(
            'probe',
            [{ source, plan: request.plan }],
            signal === undefined ? {} : { signal },
          ),
        )
        if (outcome.kind !== 'value') {
          throw new ModkitError({
            code: 'x3.host/rpc-bad-return',
            message: 'probe returned a handle',
          })
        }
        return outcome.value as unknown as DetectionResult
      } finally {
        await source.release()
      }
    },
    async planInput(
      source: CodecCandidateSource,
      evidence: DetectionResult,
      signal?: AbortSignal,
    ): Promise<AssetInputPlan> {
      const { realm, remote } = await bound
      if (remote.has !== undefined && !remote.has.includes('planInput')) {
        return source.kind === 'namespace'
          ? { originKind: 'namespace', requirements: [] }
          : {
              originKind: 'single',
              candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
              requirements: [],
            }
      }
      const exposedSource = realm.endpoint.expose(source as unknown as object, ABI_ARTIFACT_SOURCE)
      try {
        const outcome = await watch(realm, () =>
          remote.call(
            'planInput',
            [exposedSource, evidence],
            signal === undefined ? {} : { signal },
          ),
        )
        if (outcome.kind !== 'value') {
          throw new ModkitError({
            code: 'x3.host/rpc-bad-return',
            message: 'planInput returned a handle',
          })
        }
        return outcome.value as unknown as AssetInputPlan
      } finally {
        await exposedSource.release()
      }
    },
    async open(
      input: AssetInput,
      intent: OpenIntent,
      budget: ResourceBudget,
      signal?: AbortSignal,
    ) {
      const { realm, remote } = await bound
      const exposedInput = realm.endpoint.expose(input as unknown as object, ABI_ASSET_INPUT)
      const outcome = await watch(realm, () =>
        remote.call('open', [exposedInput, intent, budget], signal === undefined ? {} : { signal }),
      ).catch(async (error: unknown) => {
        await exposedInput.release()
        throw error
      })
      if (outcome.kind !== 'lease') {
        await exposedInput.release()
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: 'open did not lease a session',
        })
      }
      return sessionAdapter(realm, outcome.remote, exposedInput, watch) as unknown as AssetSession
    },
  }
}

function sessionAdapter(
  realm: ConsumerRealm,
  session: RemoteCapability,
  exposedInput: { release(): Promise<void> },
  watch: ConsumerWatch,
) {
  const endpoint = realm.endpoint
  const materialized = endpoint.materialize(session) as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >
  let state: 'live' | 'stale-revision' | 'disposed' = 'live'
  // one leased OperationSession, materialized once so its `invoke` carries the ABI placements
  // (`signal`/`onProgress` inside the third options argument are lifted by the RPC core and
  // re-created in the worker) and its `dispose` releases the lease
  let opsLease:
    | Promise<{ readonly proxy: Record<string, unknown>; readonly remote: RemoteCapability }>
    | undefined
  const operationsProxy = async () => {
    opsLease ??= (async () => {
      const outcome = await watch(realm, () => session.call('operations'))
      if (outcome.kind !== 'lease') {
        opsLease = undefined
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: 'operations did not lease',
        })
      }
      return { proxy: endpoint.materialize(outcome.remote), remote: outcome.remote }
    })()
    return opsLease
  }
  const operations = {
    // invoke(handlerId, value, { signal, onProgress }) — the options object stays a plain wire
    // value; the executor re-creates the signal and progress callback on its side
    invoke: async (...args: unknown[]) => {
      const { proxy } = await operationsProxy()
      return (proxy['invoke'] as ((...a: unknown[]) => Promise<unknown>) | undefined)?.(...args)
    },
    dispose: async () => {
      if (opsLease === undefined) return
      const lease = opsLease
      opsLease = undefined
      const { proxy, remote } = await lease
      try {
        await (proxy['dispose'] as (() => Promise<unknown>) | undefined)?.()
      } finally {
        await remote.release()
      }
    },
  }
  return {
    revision: session.data['revision'],
    state: () => state,
    descriptor: () => materialized['descriptor']?.(),
    dataSource: (contract: string, major: number) => materialized['dataSource']?.(contract, major),
    operations: () => operations,
    events: (signal?: AbortSignal) =>
      materialized['events']?.(...(signal === undefined ? [] : [signal])),
    dispose: async () => {
      state = 'disposed'
      try {
        await operations.dispose()
        await materialized['dispose']?.()
      } finally {
        await exposedInput.release()
      }
    },
  }
}
