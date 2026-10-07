/**
 * Host-side consumer adapters over a remote worker module (shared by the Node and browser
 * worker backends): the module lease exposes the *synchronous* `createCodec(context)` /
 * `createProvider(selection, context)` the ABI promises, backed by the remote root; a codec is
 * bound to the realm generation that created it, sessions come back as ABI-shaped adapters and
 * the OperationSession lease carries the invoke placements. The watchdog policy stays with the
 * backend (`ConsumerWatch`); these adapters never spawn or terminate anything themselves.
 */

import { ModkitError, type Diagnostic } from '@modkit/core'
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
} from '@modkit/sdk'
import {
  ABI_ARTIFACT_SOURCE,
  ABI_ASSET_INPUT,
  ABI_CONTRACT_RESOLVER,
  ABI_DIAGNOSTIC_SINK,
  ABI_RASTER_RESOURCES,
  ABI_INSTALLATION_PROBES,
  ABI_VIDEO_FRAMES,
  ABI_INSTALLATION_FILES,
  ABI_SUBJECT_CATALOG,
  ABI_MOD_CONTEXT_QUERY,
  ABI_CREDENTIALS,
  ABI_MODEL_RESOURCES,
  ABI_LOGICAL_RESOURCES,
  ABI_SERVICE_PROVIDER_MODULE,
} from './abi-surfaces.js'
import type { Endpoint, LocalCapability, RemoteCapability } from './endpoint.js'
import { wireLogicalResources } from './logical-resources.js'

/*
 * A leased remote codec and the context ports exposed for it live as long as the realm unless
 * someone lets go. A realm is kept warm across opens, so every open used to leave one codec lease
 * and five ports behind; after ~800 opens (a map's models and their textures) the realm's 4096
 * handles were gone and every further open failed.
 */
const codecReleases = new WeakMap<Codec, () => Promise<void>>()

/** Let go of what `createCodec` leased across a worker boundary; a no-op for an in-process codec. */
export async function releaseCodec(codec: Codec): Promise<void> {
  const release = codecReleases.get(codec)
  codecReleases.delete(codec)
  await release?.()
}

async function releaseAll(capabilities: readonly LocalCapability[]): Promise<void> {
  await Promise.allSettled(capabilities.map(capability => capability.release()))
}

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
  /** Context data plus host capabilities: diagnostics, contract resolution and optional raster reads. */
  /** The context as it crosses; every port it exposes is recorded so its owner can revoke it. */
  const wireContext = (
    endpoint: Endpoint,
    context: ContributionContext,
    exposed: LocalCapability[],
  ) => {
    const expose = (
      target: object,
      surface: { readonly contract: string; readonly major: number },
    ) => {
      const capability = endpoint.expose(target, surface)
      exposed.push(capability)
      return capability
    }
    return {
      budgets: context.budgets,
      ...(context.providerIdentity === undefined
        ? {}
        : { providerIdentity: context.providerIdentity }),
      // Settings are plain data, so they cross as a copy rather than as an exposed surface.
      ...(context.settings === undefined ? {} : { settings: context.settings }),
      ...(context.containerContext === undefined
        ? {}
        : { containerContext: context.containerContext }),
      diagnostics: expose(
        { report: (diagnostic: Diagnostic) => context.diagnostics.report(diagnostic) },
        ABI_DIAGNOSTIC_SINK,
      ),
      // the host executes contract resolution; the worker gets a proxy whose leased providers
      // carry the surface of the requested contract's definition
      contracts: expose(context.contracts, ABI_CONTRACT_RESOLVER),
      ...(context.modelResources === undefined
        ? {}
        : { modelResources: expose(context.modelResources, ABI_MODEL_RESOURCES) }),
      ...(context.logicalResources === undefined
        ? {}
        : {
            logicalResources: expose(
              wireLogicalResources(context.logicalResources),
              ABI_LOGICAL_RESOURCES,
            ),
          }),
      ...(context.rasterResources === undefined
        ? {}
        : { rasterResources: expose(context.rasterResources, ABI_RASTER_RESOURCES) }),
      ...(context.installationProbes === undefined
        ? {}
        : { installationProbes: expose(context.installationProbes, ABI_INSTALLATION_PROBES) }),
      ...(context.videoFrames === undefined
        ? {}
        : { videoFrames: expose(context.videoFrames, ABI_VIDEO_FRAMES) }),
      ...(context.installationFiles === undefined
        ? {}
        : { installationFiles: expose(context.installationFiles, ABI_INSTALLATION_FILES) }),
      ...(context.catalog === undefined
        ? {}
        : { catalog: expose(context.catalog, ABI_SUBJECT_CATALOG) }),
      ...(context.modContexts === undefined
        ? {}
        : { modContexts: expose(context.modContexts, ABI_MOD_CONTEXT_QUERY) }),
      ...(context.credentials === undefined
        ? {}
        : { credentials: expose(context.credentials, ABI_CREDENTIALS) }),
    }
  }
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
        const exposed: LocalCapability[] = []
        const outcome = await watch(live, () =>
          live.root.call('createProvider', [
            selection,
            wireContext(live.endpoint, context, exposed),
          ]),
        ).catch(async error => {
          await releaseAll(exposed)
          throw error
        })
        if (outcome.kind !== 'lease') {
          await releaseAll(exposed)
          throw new ModkitError({
            code: 'x3.host/invalid-service-provider-lease',
            message: `createProvider of ${contributionId} did not lease a provider`,
          })
        }
        const remote = outcome.remote
        return {
          value: live.endpoint.materialize(remote),
          release: async () => {
            try {
              await remote.release()
            } finally {
              await releaseAll(exposed)
            }
          },
        }
      },
    })
  }
  return Object.freeze({
    abiVersion,
    createCodec: (context: ContributionContext): Codec => {
      const exposed: LocalCapability[] = []
      const bound = realm().then(async live => {
        const outcome = await watch(live, () =>
          live.root.call('createCodec', [wireContext(live.endpoint, context, exposed)]),
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
      const codec = codecAdapter(bound, watch)
      codecReleases.set(codec, async () => {
        try {
          await (await bound.catch(() => undefined))?.remote.release()
        } finally {
          await releaseAll(exposed)
        }
      })
      return codec
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
      return sessionAdapter(
        realm,
        outcome.remote,
        exposedInput,
        watch,
        signal,
      ) as unknown as AssetSession
    },
  }
}

function sessionAdapter(
  realm: ConsumerRealm,
  session: RemoteCapability,
  exposedInput: { release(): Promise<void> },
  watch: ConsumerWatch,
  openingSignal?: AbortSignal,
) {
  const endpoint = realm.endpoint
  const materialized = endpoint.materialize(session) as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >
  let state: 'live' | 'stale-revision' | 'disposed' = 'live'
  let disposal: Promise<void> | undefined
  let initialDescriptorSignal = openingSignal
  const sessionValue = (method: 'descriptor' | 'state', signal?: AbortSignal) =>
    watch(realm, async () => {
      const outcome = await session.call(method, [], signal === undefined ? {} : { signal })
      if (outcome.kind !== 'value')
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: `${method} returned a capability instead of a value`,
        })
      return outcome.value
    })
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
    descriptor: async () => {
      const signal = initialDescriptorSignal
      try {
        const descriptor = await sessionValue('descriptor', signal)
        if (disposal === undefined) {
          const remoteState = await sessionValue('state', signal)
          if (
            remoteState !== 'live' &&
            remoteState !== 'stale-revision' &&
            remoteState !== 'disposed'
          )
            throw new ModkitError({
              code: 'x3.host/invalid-session-state',
              message:
                'The worker session returned an invalid state after descriptor initialization.',
            })
          // A concurrent local dispose must never be undone by a late remote reply.
          if (disposal === undefined) state = remoteState
        }
        return descriptor
      } finally {
        initialDescriptorSignal = undefined
      }
    },
    dataSource: (contract: string, major: number) => materialized['dataSource']?.(contract, major),
    operations: () => operations,
    events: (signal?: AbortSignal) =>
      materialized['events']?.(...(signal === undefined ? [] : [signal])),
    dispose: () => {
      if (disposal !== undefined) return disposal
      state = 'disposed'
      disposal = (async () => {
        try {
          await operations.dispose()
          await watch(realm, async () => materialized['dispose']?.())
        } finally {
          await exposedInput.release()
        }
      })()
      return disposal
    },
  }
}
