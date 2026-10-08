/**
 * [MK] Core facet-aware service resolution and ContractResolverPort adapter (A-2).
 * Registered definitions validate/match offers; the resolver owns compatibility, grants, pins
 * and deterministic placement preference. Host activation/leases own execution and cleanup;
 * extension facets cannot request the host's alternate-target preference or bypass the gate.
 */

import { ModkitError, contractId } from '@modkit/core'
import type {
  ContractMajor,
  ContractMap,
  ContractOf,
  ContractResolverPort,
  JsonValue,
  KnownContractId,
  Lease,
  OpaqueServiceContractRequest,
  ProviderOffer,
  ProviderRequest,
  ResolutionResult,
  RuntimeTarget,
  SelectedServiceOffer,
  ServiceContractDefinitionRegistry,
} from '@modkit/sdk'
import { resolveProvider } from './resolver.js'

export interface FacetAwareProviderRequest extends ProviderRequest {
  readonly requestFacet?: JsonValue
}

/** Contract definitions own request/offer validation, matching and the non-secret selection key. */
export async function resolveServiceProvider(
  request: FacetAwareProviderRequest,
  offers: readonly ProviderOffer[],
  definitions: ServiceContractDefinitionRegistry,
  targetFor?: (offer: ProviderOffer) => RuntimeTarget,
  preferAlternateTarget = false,
): Promise<ResolutionResult> {
  const accepted = new Set<object>()
  const selectionKeys = new Map<object, string>()
  for (const offer of offers) {
    for (const logical of offer.provides) {
      if (
        logical.contract !== request.contract.contract ||
        logical.major !== request.contract.major
      ) {
        continue
      }
      const result = await definitions.matchFacets({
        contract: logical.contract,
        major: logical.major,
        ownerExtensionId: offer.extensionId,
        offerFacet: logical.facet,
        requestFacet: request.requestFacet,
      })
      if (result.state === 'match') {
        accepted.add(logical)
        selectionKeys.set(logical, result.selectionKey)
      }
    }
  }
  return resolveProvider(request, offers, {
    accepts: (_offer, logical) => accepted.has(logical),
    selectionKey: (_offer, logical) => selectionKeys.get(logical),
    ...(targetFor === undefined ? {} : { targetFor }),
    ...(preferAlternateTarget ? { preferAlternateTarget: true } : {}),
  })
}

export interface ContractResolverRuntimeOptions {
  readonly offers: readonly ProviderOffer[]
  readonly definitions: ServiceContractDefinitionRegistry
  readonly target: RuntimeTarget
  /** The target an offer runs in when that is not `target` (in-process code of a worker-target host). */
  readonly targetFor?: (offer: ProviderOffer) => RuntimeTarget
  /** Host-owned preference among already admissible placements; never extension-supplied. */
  readonly preferAlternateTarget?: boolean
  /** Host-owned activation creates the selected runtime handle; extensions never receive facets. */
  readonly activate: (
    selection: SelectedServiceOffer,
    result: Extract<ResolutionResult, { state: 'resolved' }>,
    signal?: AbortSignal,
  ) => Promise<Lease<unknown>>
  /** Observe the exact resolver-owned request/result pair before activation (locks/audit). */
  readonly onResolved?: (
    request: FacetAwareProviderRequest,
    result: Extract<ResolutionResult, { state: 'resolved' }>,
  ) => void | Promise<void>
}

/** Runtime implementation of the A-1 interface; typed and opaque requests share one gate. */
export function createContractResolverPort(
  options: ContractResolverRuntimeOptions,
): ContractResolverPort {
  const resolve = async (request: {
    readonly contract: string
    readonly major: number
    readonly facet?: JsonValue
    readonly requiredOutputs?: ProviderRequest['requiredOutputs']
    readonly operation?: ProviderRequest['operation']
    readonly signal?: AbortSignal
  }): Promise<Lease<unknown>> => {
    const contract = contractId(request.contract)
    if (options.definitions.lookup(contract, request.major) === undefined) {
      throw new ModkitError({
        code: 'x3.host/service-contract-unregistered',
        message: `service contract ${request.contract}@${request.major} is not registered`,
      })
    }
    const providerRequest: FacetAwareProviderRequest = {
      contract: { contract, major: request.major },
      target: options.target,
      ...(request.facet === undefined ? {} : { requestFacet: request.facet }),
      ...(request.requiredOutputs === undefined
        ? {}
        : { requiredOutputs: request.requiredOutputs }),
      ...(request.operation === undefined ? {} : { operation: request.operation }),
    }
    const result = await resolveServiceProvider(
      providerRequest,
      options.offers,
      options.definitions,
      options.targetFor,
      options.preferAlternateTarget,
    )
    if (result.state !== 'resolved') {
      throw new ModkitError({
        code: 'x3.host/service-contract-unresolved',
        message: `service contract resolution failed: ${result.reason}`,
        context: { reason: result.reason },
      })
    }
    const selection = {
      offerId: result.selected.resolvedContract.offerId,
      contract: result.selected.resolvedContract.contract,
      major: result.selected.resolvedContract.major,
      ...(result.selected.contractSelectionKey === undefined
        ? {}
        : { contractSelectionKey: result.selected.contractSelectionKey }),
    } as SelectedServiceOffer
    await options.onResolved?.(providerRequest, result)
    return options.activate(selection, result, request.signal)
  }

  return {
    async resolve<Contract extends KnownContractId, Major extends ContractMajor<Contract>>(
      request: import('@modkit/sdk').TypedResolveRequest<Contract, Major>,
    ): Promise<Lease<ContractOf<Contract, Major>>> {
      return (await resolve(request as Parameters<typeof resolve>[0])) as Lease<
        ContractOf<Contract, Major>
      >
    },
    async resolveUnknown<const Contract extends string>(
      request: OpaqueServiceContractRequest<Contract>,
    ): Promise<Lease<unknown>> {
      return resolve(request as Parameters<typeof resolve>[0])
    },
  }
}

/** Compile-only proof that the open map remains the authority consumed by this host adapter. */
export type RuntimeServiceContractMap = ContractMap
