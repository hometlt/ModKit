/**
 * Executor-side ABI re-assembly, shared by every worker bootstrap (Node `worker_threads`, the
 * browser worker): the raw evaluated module is wrapped so the ABI's synchronous shapes survive
 * the boundary — `createCodec(context)`/`createProvider(selection, context)` receive a real
 * `ContributionContext` (budgets copied; diagnostics and contract resolution are host-executed
 * proxies), and `open(input, …)` receives an `AssetInput` whose sync helpers
 * (`bindingsFor`/`subjectsFor`) are derived locally from the copied fields while the async
 * openers stay the host-executed proxy methods. Runtime-agnostic on purpose: no `node:` imports.
 */

import { ModkitError, type Diagnostic } from '@modkit/core'
import type { ContributionContext, ContributionProviderIdentity, ResourceBudget } from '@modkit/sdk'
import { ABI_CODEC_MODULE, ABI_SERVICE_PROVIDER_MODULE } from './abi-surfaces.js'

export interface WireContext {
  readonly budgets: ResourceBudget
  readonly providerIdentity?: ContributionProviderIdentity
  readonly diagnostics?: { report(diagnostic: Diagnostic): Promise<unknown> }
  /** Host-executed contract resolver (materialized proxy of `x3.abi/contract-resolver@1`). */
  readonly contracts?: ContributionContext['contracts']
}

const unavailableResolver = {
  resolve: () =>
    Promise.reject(
      new ModkitError({
        code: 'x3.host/execution-backend-unavailable',
        message: 'the host did not hand this worker a contract resolver',
      }),
    ),
  resolveUnknown: () =>
    Promise.reject(
      new ModkitError({
        code: 'x3.host/execution-backend-unavailable',
        message: 'the host did not hand this worker a contract resolver',
      }),
    ),
} as ContributionContext['contracts']

export function contributionContext(wire: WireContext): ContributionContext {
  const sink = wire.diagnostics
  return {
    budgets: wire.budgets,
    diagnostics: {
      report(diagnostic) {
        if (sink !== undefined) void sink.report(diagnostic).catch(() => undefined)
      },
    },
    contracts: wire.contracts ?? unavailableResolver,
    ...(wire.providerIdentity === undefined
      ? {}
      : { providerIdentity: Object.freeze({ ...wire.providerIdentity }) }),
  }
}

export interface WireInput extends Record<string, unknown> {
  readonly bindings?: readonly { readonly sourceKind?: string; readonly requirementId?: string }[]
  readonly subjects?: readonly { readonly requirementId?: string }[]
}

/**
 * Derives the sync helpers the ABI declares from the copied fields, so a codec sees a real
 * `AssetInput`: `bindingsFor` over the physical bindings and `subjectsFor` over a derived
 * input's subject list. The async openers (`openBinding`/`openNamespace`/`openSubject`/
 * `openMaterialized`) are the host-executed proxy methods already on `wire`.
 */
export function assetInput(wire: WireInput): Record<string, unknown> {
  const bindings = wire.bindings ?? []
  const subjects = wire.subjects ?? []
  return Object.assign(Object.create(null) as Record<string, unknown>, wire, {
    bindingsFor: (requirementId: string) =>
      bindings.filter(
        binding => binding.sourceKind === 'requirement' && binding.requirementId === requirementId,
      ),
    subjectsFor: (requirementId: string) =>
      subjects.filter(subject => subject.requirementId === requirementId),
  })
}

/** `ServiceProviderModule`: `createProvider(selection, context)` with the context re-assembled. */
export function wrapServiceModule(module: Record<string, unknown>): Record<string, unknown> {
  const createProvider = module['createProvider'] as (
    selection: unknown,
    context: ContributionContext,
  ) => unknown
  return {
    abiVersion: module['abiVersion'],
    provides: module['provides'],
    createProvider: (selection: unknown, wire: WireContext) =>
      createProvider.call(module, selection, contributionContext(wire)),
  }
}

export function wrapCodecModule(module: Record<string, unknown>): Record<string, unknown> {
  const createCodec = module['createCodec']
  return {
    abiVersion: module['abiVersion'],
    createCodec:
      typeof createCodec !== 'function'
        ? undefined
        : (wire: WireContext) => {
            const codec = (
              createCodec as (context: ContributionContext) => Record<string, unknown>
            )(contributionContext(wire))
            const open = codec['open']
            return {
              ...codec,
              ...(typeof open !== 'function'
                ? {}
                : {
                    open: (input: WireInput, ...rest: unknown[]) =>
                      (open as (...args: unknown[]) => unknown).call(
                        codec,
                        assetInput(input),
                        ...rest,
                      ),
                  }),
            }
          },
  }
}

/**
 * The root the endpoint exposes: a service-provider module leases providers by the contract the
 * selection names; anything else is exposed as a codec module.
 */
export function wrapLoadedModule(module: Record<string, unknown>): {
  readonly module: Record<string, unknown>
  readonly surface: { readonly contract: string; readonly major: number }
} {
  const isServiceModule =
    typeof module['createProvider'] === 'function' && typeof module['createCodec'] !== 'function'
  return {
    module: isServiceModule ? wrapServiceModule(module) : wrapCodecModule(module),
    surface: isServiceModule ? ABI_SERVICE_PROVIDER_MODULE : ABI_CODEC_MODULE,
  }
}
