/**
 * Host-owned activation of resolved service providers (ADR-HOST-002 §3/§5; the A-2 seam).
 *
 * Two callers need the same four steps — issue the activation ticket from the resolver's result,
 * activate the contribution through the gate (execution boundary, narrowed grant, honest
 * diagnostics), check the module's `ServiceProviderModule` ABI, and lease the provider through
 * `createProvider` with a host-built `ContributionContext`: the codec open path (nested providers
 * a codec resolves while it runs) and a product that needs a provider directly — the first such
 * product need is a writer (`common.edit/writer@1`) for an edit session. This module is that
 * shared implementation plus `createHostServiceResolver`, the product-facing resolver port.
 */

import { ModkitError, type Diagnostic } from '@modkit/core'
import type {
  ContributionContext,
  ContributionSettings,
  ContractResolverPort,
  ExecutionProfile,
  HostPolicy,
  InstallationProbes,
  Lease,
  LogicalResourcePort,
  ModContextQueryPort,
  PermissionGrant,
  ProviderOffer,
  ProviderPolicyLockEntry,
  ResolutionResult,
  ResourceBudget,
  RuntimeTarget,
  SelectedServiceOffer,
  ServiceContractDefinitionRegistry,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import { inventoryRecordFor, type Inventory } from './inventory.js'
import { inventoryBindingForOffer, offersFromInventory } from './offers.js'
import { buildLockEntry } from './resolution/lock.js'
import {
  createContractResolverPort,
  type FacetAwareProviderRequest,
} from './resolution/service-resolver.js'
import { activateContribution, issueActivationTicket } from './security/gate.js'

export interface ProviderActivationOptions {
  readonly selection: SelectedServiceOffer
  readonly result: Extract<ResolutionResult, { state: 'resolved' }>
  readonly target: RuntimeTarget
  readonly grant: PermissionGrant
  readonly executionBackends: ExecutionBackendRegistry
  readonly policy?: HostPolicy
  readonly signal?: AbortSignal
  /** Builds the context the provider is created with, bound to its own narrowed grant. */
  readonly contextFor: (effectiveGrant: PermissionGrant) => ContributionContext
  /** Activation diagnostics (boundary statements, degraded classes) land here. */
  readonly diagnostics?: Diagnostic[]
}

export interface ProviderActivation {
  readonly lease: Lease<unknown>
  readonly effectiveGrant: PermissionGrant
  /** Exact gate-admitted execution profile; callers must not infer it from the host target. */
  readonly executionProfile: ExecutionProfile
  readonly attestation: Readonly<{
    readonly manifestDigest: string
    readonly artifactDigest: string
    readonly offerFingerprint: string
  }>
  /** Releases the provider lease and then the activation (realm); idempotent. */
  release(): Promise<void>
}

/**
 * The target a service offer is resolved and activated for. A trusted in-process variant of an
 * artifact allowed to run in-process runs in the process that owns the registry, not in the worker
 * realm codecs are activated for; every other offer runs in `target`.
 */
export function serviceTargetFor(
  executionBackends: ExecutionBackendRegistry,
  offer: ProviderOffer,
  target: RuntimeTarget,
): RuntimeTarget {
  const inProcess = executionBackends.inProcessTarget
  if (inProcess === undefined) return target
  const contribution = inventoryBindingForOffer(offer)?.contribution
  const variant = contribution?.manifest?.runtimeVariants?.find(
    item => item.variantId === offer.runtimeVariant,
  )
  if (
    contribution === undefined ||
    variant?.executionProfile !== 'trusted-in-process' ||
    inventoryRecordFor(contribution)?.execution.allowTrustedInProcess !== true
  ) {
    return target
  }
  return Object.freeze({
    ...inProcess,
    ...(target.grantedPermissions === undefined
      ? {}
      : { grantedPermissions: target.grantedPermissions }),
  })
}

/** Activate the contribution behind a resolved offer and lease the provider it creates. */
export async function activateServiceProvider(
  options: ProviderActivationOptions,
): Promise<ProviderActivation> {
  const ticket = issueActivationTicket(
    options.result,
    serviceTargetFor(options.executionBackends, options.result.selected.offer, options.target),
  )
  const activation = await activateContribution({
    ticket,
    grant: options.grant,
    executionBackends: options.executionBackends,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  options.diagnostics?.push(...activation.diagnostics)
  const providerId = options.result.selected.offer.providerId
  const fail = async (code: string, message: string): Promise<never> => {
    await activation.release()
    throw new ModkitError({ code, message })
  }
  if (
    activation.module['abiVersion'] !== 1 ||
    typeof activation.module['createProvider'] !== 'function'
  ) {
    return fail(
      'x3.host/invalid-service-provider-module',
      `provider ${providerId} does not implement ServiceProviderModule ABI v1`,
    )
  }
  const createProvider = activation.module['createProvider'] as (
    selected: SelectedServiceOffer,
    context: ContributionContext,
  ) => Promise<Lease<unknown>> | Lease<unknown>
  let lease: Lease<unknown>
  try {
    const baseContext = options.contextFor(activation.effectiveGrant)
    const context: ContributionContext = Object.freeze({
      ...baseContext,
      providerIdentity: Object.freeze({
        providerId,
        providerVersion: options.result.selected.offer.extensionVersion,
        artifactDigest: ticket.artifactDigest,
      }),
    })
    lease = await createProvider(options.selection, context)
  } catch (error) {
    await activation.release()
    throw error
  }
  if (
    typeof lease !== 'object' ||
    lease === null ||
    !('value' in lease) ||
    typeof lease.release !== 'function'
  ) {
    return fail(
      'x3.host/invalid-service-provider-lease',
      `provider ${providerId} returned an invalid lease`,
    )
  }
  let released = false
  return Object.freeze({
    lease,
    effectiveGrant: activation.effectiveGrant,
    executionProfile: activation.variant.executionProfile,
    attestation: Object.freeze({
      manifestDigest: ticket.manifestDigest,
      artifactDigest: ticket.artifactDigest,
      offerFingerprint: ticket.offerFingerprint,
    }),
    async release() {
      if (released) return
      released = true
      try {
        await lease.release()
      } finally {
        await activation.release()
      }
    },
  })
}

export interface HostServiceResolverOptions {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly definitions: ServiceContractDefinitionRegistry
  /** The caller's grant; every provider runs under a child narrowed from it. */
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly policy?: HostPolicy
  readonly signal?: AbortSignal
  /** Offers to resolve against; defaults to the inventory's projection. */
  readonly offers?: readonly ProviderOffer[]
  /** Root provider only; build authority from its gate-narrowed grant, never inherit into children. */
  readonly logicalResourcesFor?: (grant: PermissionGrant) => LogicalResourcePort
  /** Root provider only: where platforms installed games (installation discovery on a desktop host). */
  readonly installationProbes?: InstallationProbes
  /** The host's settings for a provider, asked for by its id when it is activated. */
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
  /** Root provider only: questions to the loaded mod servers its requests name (language providers). */
  readonly modContexts?: ModContextQueryPort
  /** Prefer already gate-eligible trusted services beside their owner; default keeps worker ties. */
  readonly preferTrustedInProcess?: boolean
}

export interface HostServiceResolver {
  /** Resolve + activate + lease; leases are tracked and released with the resolver. */
  readonly port: ContractResolverPort
  /** Provider-policy lock entries of every resolution made through this resolver (audit). */
  readonly locks: readonly ProviderPolicyLockEntry[]
  readonly diagnostics: readonly Diagnostic[]
  /** Immutable facts recorded for successfully activated providers, in activation order. */
  readonly activationFacts: readonly ProviderActivationFact[]
  release(): Promise<void>
}

export interface ProviderActivationFact {
  readonly providerId: string
  readonly contract: string
  readonly major: number
  readonly offerId: string
  readonly runtimeVariant: string
  readonly executionProfile: ExecutionProfile
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly offerFingerprint: string
  /** Gate-narrowed authority actually supplied to this provider instance. */
  readonly effectiveGrant: PermissionGrant
}

/**
 * A product-level resolver port: the same facet-aware resolution and gate activation a codec's
 * `ContributionContext.contracts` performs, for a host that needs a provider itself (a writer
 * for an edit session, a syntax provider for a tool). Nested providers resolved by a leased
 * provider share the chain, so activation cycles are refused.
 */
export function createHostServiceResolver(
  options: HostServiceResolverOptions,
): HostServiceResolver {
  const offers = options.offers ?? offersFromInventory(options.inventory)
  const target: RuntimeTarget = Object.freeze({
    ...options.target,
    grantedPermissions: [
      ...new Set([...(options.target.grantedPermissions ?? []), ...options.grant.classes]),
    ].sort(),
  })
  const activations: ProviderActivation[] = []
  const locks: ProviderPolicyLockEntry[] = []
  const diagnostics: Diagnostic[] = []
  const activationFacts: ProviderActivationFact[] = []
  const makePort = (grant: PermissionGrant, chain: readonly string[]): ContractResolverPort =>
    createContractResolverPort({
      offers,
      definitions: options.definitions,
      target,
      targetFor: offer => serviceTargetFor(options.executionBackends, offer, target),
      ...(options.preferTrustedInProcess === true ? { preferAlternateTarget: true } : {}),
      onResolved(request: FacetAwareProviderRequest, result) {
        locks.push(buildLockEntry(request, result))
      },
      async activate(selection, result, signal) {
        const key = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`
        if (chain.includes(key)) {
          throw new ModkitError({
            code: 'x3.host/service-dependency-cycle',
            message: `service activation cycle detected at ${key}`,
          })
        }
        const activation = await activateServiceProvider({
          selection,
          result,
          target,
          grant,
          executionBackends: options.executionBackends,
          ...(options.policy === undefined ? {} : { policy: options.policy }),
          ...(signal === undefined ? {} : { signal }),
          diagnostics,
          contextFor: effectiveGrant => {
            const settings = options.contributionSettings?.(result.selected.offer.providerId)
            return Object.freeze({
              contracts: makePort(effectiveGrant, [...chain, key]),
              budgets: options.budgets,
              ...(chain.length !== 0 || options.logicalResourcesFor === undefined
                ? {}
                : { logicalResources: options.logicalResourcesFor(effectiveGrant) }),
              ...(chain.length !== 0 || options.installationProbes === undefined
                ? {}
                : { installationProbes: options.installationProbes }),
              ...(chain.length !== 0 || options.modContexts === undefined
                ? {}
                : { modContexts: options.modContexts }),
              diagnostics: {
                report(item: Diagnostic) {
                  diagnostics.push(item)
                },
              },
              ...(settings === undefined ? {} : { settings }),
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            })
          },
        })
        activations.push(activation)
        activationFacts.push(
          Object.freeze({
            providerId: result.selected.offer.providerId,
            contract: selection.contract,
            major: selection.major,
            offerId: selection.offerId,
            runtimeVariant: result.selected.offer.runtimeVariant,
            executionProfile: activation.executionProfile,
            manifestDigest: activation.attestation.manifestDigest,
            artifactDigest: activation.attestation.artifactDigest,
            offerFingerprint: activation.attestation.offerFingerprint,
            effectiveGrant: activation.effectiveGrant,
          }),
        )
        return Object.freeze({ value: activation.lease.value, release: () => activation.release() })
      },
    })
  const port = makePort(options.grant, [])
  return Object.freeze({
    port,
    locks,
    diagnostics,
    get activationFacts(): readonly ProviderActivationFact[] {
      return Object.freeze([...activationFacts])
    },
    async release() {
      let firstError: unknown
      for (const activation of activations.splice(0).reverse()) {
        try {
          await activation.release()
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstError !== undefined) throw firstError
    },
  })
}
