/**
 * Data-only definition contracts consumed during inventory. They never load extension code.
 * Runtime registries are host-owned; A-2 supplies their implementations and atomic persistence.
 */

import type { ContractId, Diagnostic, TraitId } from '@modkitx-x3/core'
import type { JsonSchemaRef, JsonValue } from './asset-capabilities/types.js'

export type StandardTraitScope =
  | 'source'
  | 'asset'
  | 'subject'
  | 'workspace'
  | 'service'
  | 'operation'
  | 'view-session'
  | 'representation'

/** Standard scopes stay portable; extensions may add an explicit qualified scope. */
export type TraitScope = StandardTraitScope | ContractId
export type TraitTransport = 'json' | 'structured-clone'

export interface TraitDefinitionSpecV1Wire {
  readonly schemaVersion: 1
  readonly id: string
  readonly version: string
  readonly scope: string
  readonly parametersSchema: JsonSchemaRef
  readonly transport: TraitTransport
  readonly documentation?: string
  readonly imports?: readonly {
    readonly id: string
    readonly range: string
  }[]
}

export interface TraitDefinitionSpecV1 extends Omit<
  TraitDefinitionSpecV1Wire,
  'id' | 'scope' | 'imports'
> {
  readonly id: TraitId
  readonly scope: TraitScope
  readonly imports?: readonly {
    readonly id: TraitId
    readonly range: string
  }[]
}

export interface ServiceContractDefinitionSpecV1Wire {
  readonly schemaVersion: 1
  readonly kind: 'service'
  readonly contract: string
  readonly major: number
  readonly offerFacet: FacetDefinitionWire
  readonly requestFacet: FacetDefinitionWire
  /** Host-trusted deterministic matcher profile; definitions never inject matcher code. */
  readonly matching: {
    readonly profile: string
    readonly major: number
    readonly configuration?: JsonValue
  }
  readonly conformanceProfile: string
}

export type FacetDefinitionWire =
  | { readonly presence: 'forbidden' }
  | {
      readonly presence: 'optional' | 'required'
      readonly schema: JsonSchemaRef
    }

export interface DataSourceContractDefinitionSpecV1Wire {
  readonly schemaVersion: 1
  readonly kind: 'data-source'
  readonly contract: string
  readonly major: number
  readonly schema: JsonSchemaRef
  readonly conformanceProfile: string
}

export type ContractDefinitionSpecV1Wire =
  ServiceContractDefinitionSpecV1Wire | DataSourceContractDefinitionSpecV1Wire

export interface ServiceContractDefinitionSpecV1 extends Omit<
  ServiceContractDefinitionSpecV1Wire,
  'contract' | 'matching'
> {
  readonly contract: ContractId
  readonly matching: {
    readonly profile: ContractId
    readonly major: number
    readonly configuration?: JsonValue
  }
}

export interface DataSourceContractDefinitionSpecV1 extends Omit<
  DataSourceContractDefinitionSpecV1Wire,
  'contract'
> {
  readonly contract: ContractId
}

export type ContractDefinitionSpecV1 =
  ServiceContractDefinitionSpecV1 | DataSourceContractDefinitionSpecV1

export interface DefinitionInventoryProvenance {
  readonly ownerExtensionId: string
  readonly extensionVersion: string
  readonly inventoryRecordId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly artifactRoot: string
  readonly manifestPath: string
}

export type DefinitionRegistrationRejection =
  | 'duplicate'
  | 'version-conflict'
  | 'namespace-owner-mismatch'
  | 'schema-unavailable'
  | 'conformance-missing'
  | 'matcher-unavailable'
  | 'matcher-configuration-invalid'
  | 'dependency-cycle'
  | 'invalid-definition'

export type DefinitionInventoryResult =
  | { readonly state: 'committed' }
  | {
      readonly state: 'rejected'
      readonly reason: DefinitionRegistrationRejection
      readonly diagnostics: readonly Diagnostic[]
    }

export interface TraitDefinitionRegistration extends TraitDefinitionSpecV1 {
  readonly provenance: DefinitionInventoryProvenance
}

/** Exact-version resolution for portable custom-trait instances; ambiguity never routes. */
export type TraitDefinitionResolution =
  | { readonly state: 'resolved'; readonly definition: TraitDefinitionRegistration }
  | { readonly state: 'unregistered' }
  | {
      readonly state: 'ambiguous'
      readonly candidates: readonly TraitDefinitionRegistration[]
    }

export interface TraitDefinitionRegistry {
  replaceOwnerInventory(
    ownerExtensionId: string,
    definitions: readonly {
      readonly definition: TraitDefinitionSpecV1Wire
      readonly provenance: DefinitionInventoryProvenance
    }[],
  ): Promise<DefinitionInventoryResult>
  unregisterOwner(ownerExtensionId: string): void
  lookup(id: TraitId, version: string): TraitDefinitionRegistration | undefined
  /** Missing range means `*`; the registry returns ambiguity instead of guessing a version. */
  resolve(id: TraitId, range?: string): TraitDefinitionResolution
  list(): readonly TraitDefinitionRegistration[]
  /** Unknown/unregistered traits remain opaque and never satisfy a specialized route. */
  isRegistered(id: TraitId, version: string): boolean
  /** Validate parameters against the artifact-bound definition before specialized routing. */
  validateParameters(
    id: TraitId,
    version: string,
    parameters: JsonValue | undefined,
  ): Promise<readonly Diagnostic[]>
}

export interface ServiceContractDefinitionRegistration extends ServiceContractDefinitionSpecV1 {
  readonly provenance: DefinitionInventoryProvenance
}

export interface ServiceFacetValidationContext {
  readonly contract: ContractId
  readonly major: number
  readonly ownerExtensionId: string
  readonly facet: JsonValue | undefined
}

export interface ServiceFacetMatchContext {
  readonly contract: ContractId
  readonly major: number
  readonly ownerExtensionId: string
  readonly offerFacet: JsonValue | undefined
  readonly requestFacet: JsonValue | undefined
}

export type ServiceFacetMatchResult =
  | {
      readonly state: 'match'
      /** Contract-owned, canonical and explicitly non-secret; safe for policy locks. */
      readonly selectionKey: string
    }
  | { readonly state: 'no-match' }
  | { readonly state: 'invalid'; readonly diagnostics: readonly Diagnostic[] }

/** Host-trusted matcher implementation. Definition packages select it; they never inject code. */
export interface ServiceFacetMatcherProfile {
  readonly profile: ContractId
  readonly major: number
  readonly configurationSchema?: JsonSchemaRef
  match(
    context: ServiceFacetMatchContext,
    configuration: JsonValue | undefined,
  ): ServiceFacetMatchResult | Promise<ServiceFacetMatchResult>
}

export interface ServiceFacetMatcherProfileRegistry {
  lookup(profile: ContractId, major: number): ServiceFacetMatcherProfile | undefined
  list(): readonly ServiceFacetMatcherProfile[]
}

export interface ServiceContractDefinitionRegistry {
  replaceOwnerInventory(
    ownerExtensionId: string,
    definitions: readonly {
      readonly definition: ServiceContractDefinitionSpecV1Wire
      readonly provenance: DefinitionInventoryProvenance
    }[],
  ): Promise<DefinitionInventoryResult>
  unregisterOwner(ownerExtensionId: string): void
  lookup(contract: ContractId, major: number): ServiceContractDefinitionRegistration | undefined
  list(): readonly ServiceContractDefinitionRegistration[]
  validateOfferFacet(context: ServiceFacetValidationContext): Promise<readonly Diagnostic[]>
  validateRequestFacet(context: ServiceFacetValidationContext): Promise<readonly Diagnostic[]>
  matchFacets(context: ServiceFacetMatchContext): Promise<ServiceFacetMatchResult>
}
