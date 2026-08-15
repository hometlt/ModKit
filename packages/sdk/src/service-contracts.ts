/**
 * Open, type-only service-contract registry.
 *
 * Optional packages add contracts and request facets through module augmentation. The maps are
 * deliberately separate: a resolved provider handle is runtime-only, while a request/offer facet
 * must remain JSON-safe inventory data.
 */

import { isQualifiedId, type OperationId } from '@modkitx-x3/core'
import type { JsonValue, TraitDefinitionRequirement } from './asset-capabilities/types.js'
import type { Lease } from './asset-capabilities/data-sources.js'

/** JSON object accepted at the opaque wire boundary. */
export type JsonObject = Readonly<Record<string, JsonValue>>
type IsAny<Value> = 0 extends 1 & Value ? true : false

/**
 * Recursively projects a declared facet to JSON-safe data. Functions, bigint, symbols and other
 * non-JSON leaves become `never`, so an invalid augmented facet fails at its use site.
 */
export type JsonSafe<Value> =
  IsAny<Value> extends true
    ? never
    : Value extends null | boolean | number | string
      ? Value
      : Value extends (...args: never[]) => unknown
        ? never
        : Value extends readonly unknown[]
          ? { readonly [Index in keyof Value]: JsonSafe<Value[Index]> }
          : Value extends object
            ? keyof Value extends never
              ? never
              : { readonly [Key in keyof Value]: Key extends string ? JsonSafe<Value[Key]> : never }
            : never

/** Runtime provider handles, versioned by contract major. Extended through module augmentation. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally open registry
export interface ContractMap {}

/** Resolver-visible, JSON-safe facets. Extended independently from provider handle types. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally open registry
export interface ContractRequestMap {}

/** Provider-offer facets may differ from the corresponding request facets. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentionally open registry
export interface ContractOfferMap {}

/** Major-indexed augmentation entry; mirrors the wire definition's three presence modes. */
export type FacetContractDeclaration<Facet = never> =
  | { readonly presence: 'forbidden' }
  | { readonly presence: 'optional'; readonly facet: Facet }
  | { readonly presence: 'required'; readonly facet: Facet }

export type KnownContractId = Extract<keyof ContractMap, string>
export type ContractMajor<Contract extends KnownContractId> = Extract<
  keyof ContractMap[Contract],
  number
>
export type ContractOf<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = ContractMap[Contract][Major]

declare const FOREIGN_SERVICE_CONTRACT_ID_BRAND: unique symbol

/** A nominal foreign ID cannot be forged with a raw or widened string. */
export type ForeignServiceContractId<Contract extends string = string> =
  Contract extends KnownContractId
    ? never
    : Contract & { readonly [FOREIGN_SERVICE_CONTRACT_ID_BRAND]: true }

/** Static authoring escape hatch. Runtime discovery performs the same check against its registry. */
export function foreignServiceContractId<const Contract extends string>(
  contract: string extends Contract ? never : Contract extends KnownContractId ? never : Contract,
): ForeignServiceContractId<Contract> {
  if (!isQualifiedId(contract)) throw new TypeError(`invalid foreign service contract: ${contract}`)
  return contract as unknown as ForeignServiceContractId<Contract>
}

/** Facet value associated with a known service contract. */
type FacetDeclarationAt<
  Map,
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = Contract extends keyof Map
  ? Major extends keyof Map[Contract]
    ? Map[Contract][Major]
    : { readonly presence: 'forbidden' }
  : { readonly presence: 'forbidden' }

type FacetValue<Declaration> = Declaration extends {
  readonly presence: 'optional' | 'required'
  readonly facet: infer Facet
}
  ? JsonSafe<Facet>
  : never

type FacetProperty<Declaration> = Declaration extends {
  readonly presence: 'required'
  readonly facet: infer Facet
}
  ? { readonly facet: JsonSafe<Facet> }
  : Declaration extends { readonly presence: 'optional'; readonly facet: infer Facet }
    ? { readonly facet?: JsonSafe<Facet> }
    : { readonly facet?: never }

export type ServiceContractFacet<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = FacetValue<FacetDeclarationAt<ContractRequestMap, Contract, Major>>

/** Known contracts with a registered request facet require it; facet-less contracts forbid it. */
export type ServiceContractRequestFacet<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = FacetProperty<FacetDeclarationAt<ContractRequestMap, Contract, Major>>

/** Common runtime request fields; this is not serialized into a contribution manifest. */
export interface ServiceContractRequest<Contract extends string = string> {
  readonly contract: Contract
  readonly major: number
  readonly requiredOutputs?: readonly TraitDefinitionRequirement[]
  readonly operation?: OperationId
  readonly signal?: AbortSignal
}

export type TypedServiceContractRequest<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = ServiceContractRequest<Contract> & {
  readonly major: Major
} & ServiceContractRequestFacet<Contract, Major>

/** Foreign requests stay intentionally opaque and their optional facet is JSON-only. */
export type OpaqueServiceContractRequest<Contract extends string = string> = ServiceContractRequest<
  ForeignServiceContractId<Contract>
> & { readonly facet?: JsonValue }

export type ResolveRequest<Contract extends string> = ServiceContractRequest<Contract>
export type ContractRequestFacet<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = ServiceContractRequestFacet<Contract, Major>
export type TypedResolveRequest<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = TypedServiceContractRequest<Contract, Major>

/** Runtime-only typed resolver seam. Selection/activation behavior belongs to A-2. */
export interface ContractResolverPort {
  resolve<Contract extends KnownContractId, Major extends ContractMajor<Contract>>(
    request: TypedResolveRequest<Contract, Major>,
  ): Promise<Lease<ContractOf<Contract, Major>>>
  resolveUnknown<const Contract extends string>(
    request: OpaqueServiceContractRequest<Contract>,
  ): Promise<Lease<unknown>>
}

/** Facet fields used by a known provider offer in a contribution spec. */
export type ServiceContractOfferFacet<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = FacetProperty<FacetDeclarationAt<ContractOfferMap, Contract, Major>>
