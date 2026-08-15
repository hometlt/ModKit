/**
 * Provider resolution contracts v1 (owner: MK3/23 §8 — «единственное определение», every
 * other document refers here). `RuntimeTarget` deliberately aliases the concrete live
 * v1 target shape (23 §8 note), with permissions carried on the request side only.
 *
 * Lab note (gap G11, IMPLEMENTATION_NOTES): `RejectedCandidate.reason` additionally
 * allows 'unsupported-kind' — 23 §8 reserves augmentation/projection/operation kinds and
 * §15 names the unsupported-kind diagnostic, but §8's `UnresolvedReason` enum does not
 * list the value; proposed to the owner rather than silently merged into 'no-offer'.
 */

import type { ContractId, ExtensionId, OperationId, ProviderId } from '@modkitx-x3/core'
import type {
  Architecture,
  OperatingSystem,
  PermissionClass,
  RuntimeEnvironment,
  RuntimeTargetConstraint,
} from '../manifest/contribution-types.js'
import type {
  JsonValue,
  TraitDefinitionOffer,
  TraitDefinitionRequirement,
} from '../asset-capabilities/types.js'

export interface ContractRequirementWire {
  readonly contract: string
  readonly major: number
  /** Default '*'; must stay inside the major (MK3/23 §8). */
  readonly range?: string
}

export interface ContractRequirement extends Omit<ContractRequirementWire, 'contract'> {
  readonly contract: ContractId
}

export interface ContractOfferWire {
  readonly offerId: string
  readonly contract: string
  /** Explicit offered major; must equal the major parsed from `version`. */
  readonly major: number
  /** Exact SemVer of the offered contract implementation. */
  readonly version: string
  readonly facet?: JsonValue
}

export interface ContractOffer extends Omit<ContractOfferWire, 'contract' | 'facet'> {
  readonly contract: ContractId
  /** JSON-safe offer discriminator retained through resolution and locks. */
  readonly facet?: JsonValue
}

/** Concrete machine/session target (alias of the live v1 shape, 23 §8). */
export interface RuntimeTarget {
  readonly environment: RuntimeEnvironment
  readonly operatingSystem: Exclude<OperatingSystem, 'any'>
  readonly architecture: Exclude<Architecture, 'any'>
  readonly hostCapabilities?: readonly string[]
  readonly webApis?: readonly string[]
  readonly externalTools?: readonly string[]
  readonly grantedPermissions?: readonly PermissionClass[]
}

export type ProviderOfferKind =
  'primary' | 'replacement' | 'augmentation' | 'projection' | 'operation'

export interface OfferHeader {
  readonly extensionId: ExtensionId
  readonly extensionVersion: string
  readonly providerId: ProviderId
  readonly runtimeVariant: string
  readonly target: RuntimeTargetConstraint
  readonly requiredPermissions?: readonly PermissionClass[]
}

export interface ProviderOffer extends OfferHeader {
  readonly kind: ProviderOfferKind
  readonly provides: readonly ContractOffer[]
  readonly requires?: readonly ContractRequirement[]
  readonly outputs?: readonly TraitDefinitionOffer[]
  readonly operations?: readonly OperationId[]
  readonly augments?: ContractRequirement
  readonly replaces?: ContractRequirement
  readonly limitations?: readonly string[]
}

export type WorkloadIntent =
  'thumbnail' | 'interactive' | 'batch' | 'lossless-edit' | 'simulation' | 'archival'

export interface ProviderRequest {
  readonly contract: ContractRequirement
  readonly target: RuntimeTarget
  readonly operation?: OperationId
  readonly requiredOutputs?: readonly TraitDefinitionRequirement[]
  readonly preferredOutputs?: readonly TraitDefinitionRequirement[]
  readonly workload?: WorkloadIntent
  readonly optional?: boolean
  readonly pin?: {
    readonly providerId: ProviderId
    readonly runtimeVariant?: string
    /** Exact logical offer used by strict policy-lock replay. */
    readonly offerId?: string
  }
}

export type UnresolvedReason =
  | 'no-offer'
  | 'version-incompatible'
  | 'target-incompatible'
  | 'permission-required'
  | 'external-tool-required'
  | 'output-missing'
  | 'ambiguous'
  | 'pin-unsatisfied'

export interface ResolvedProvider {
  readonly offer: ProviderOffer
  readonly resolvedContract: ContractOffer
  /** Contract-owned, canonical and non-secret selector produced by a facet matcher. */
  readonly contractSelectionKey?: string
}

export interface RejectedCandidate {
  readonly providerId: ProviderId
  readonly runtimeVariant: string
  readonly offerId?: string
  readonly contractSelectionKey?: string
  readonly reason: UnresolvedReason | 'unsupported-kind'
  readonly detail?: string
}

export type ResolutionResult =
  | {
      readonly state: 'resolved'
      readonly selected: ResolvedProvider
      readonly alternatives: readonly ResolvedProvider[]
      readonly rejected: readonly RejectedCandidate[]
    }
  | {
      readonly state: 'unresolved'
      readonly reason: UnresolvedReason
      readonly rejected: readonly RejectedCandidate[]
    }

/** Portable provider-policy lock (owner: MK3/23 §11). */
export interface ProviderLockKey {
  readonly contract: ContractId
  readonly major: number
  readonly normalizedRange: string
  /** Contract-owned, canonical and non-secret facet selection; never the raw request facet. */
  readonly contractSelectionKey?: string
  readonly operation?: OperationId
  readonly requiredOutputs: readonly TraitDefinitionRequirement[]
  readonly preferredOutputs: readonly TraitDefinitionRequirement[]
  readonly workload?: WorkloadIntent
}

export interface ProviderPolicySelection {
  readonly extension: ExtensionId
  readonly releaseRange?: string
  readonly contributionId: string
  readonly contractMajor: number
  readonly offerId: string
}

export interface ProviderPolicyLockEntry {
  readonly key: ProviderLockKey
  readonly primary: ProviderPolicySelection
  readonly allowedFallbacks?: readonly ProviderPolicySelection[]
  readonly resolverVersion: number
}
