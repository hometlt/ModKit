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

import type { ContractId, ExtensionId, ProviderId, TraitId } from '@modkitx-x3/core'
import type {
  Architecture,
  OperatingSystem,
  PermissionClass,
  RuntimeEnvironment,
  RuntimeTargetConstraint,
} from '../manifest/contribution-types.js'

export interface ContractRequirement {
  readonly contract: ContractId
  readonly major: number
  /** Default '*'; must stay inside the major (MK3/23 §8). */
  readonly range?: string
}

export interface ContractOffer {
  readonly contract: ContractId
  /** Exact SemVer of the offered contract implementation. */
  readonly version: string
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
  readonly outputs?: readonly TraitId[]
  readonly operations?: readonly string[]
  readonly augments?: ContractRequirement
  readonly replaces?: ContractRequirement
  readonly limitations?: readonly string[]
}

export type WorkloadIntent =
  'thumbnail' | 'interactive' | 'batch' | 'lossless-edit' | 'simulation' | 'archival'

export interface ProviderRequest {
  readonly contract: ContractRequirement
  readonly target: RuntimeTarget
  readonly operation?: string
  readonly requiredOutputs?: readonly TraitId[]
  readonly preferredOutputs?: readonly TraitId[]
  readonly workload?: WorkloadIntent
  readonly optional?: boolean
  readonly pin?: {
    readonly providerId: ProviderId
    readonly runtimeVariant?: string
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
}

export interface RejectedCandidate {
  readonly providerId: ProviderId
  readonly runtimeVariant: string
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
  readonly operation?: string
  readonly requiredOutputs: readonly TraitId[]
  readonly preferredOutputs: readonly TraitId[]
  readonly workload?: WorkloadIntent
}

export interface ProviderPolicySelection {
  readonly extension: ExtensionId
  readonly releaseRange?: string
  readonly contributionId: string
  readonly contractMajor: number
}

export interface ProviderPolicyLockEntry {
  readonly key: ProviderLockKey
  readonly primary: ProviderPolicySelection
  readonly allowedFallbacks?: readonly ProviderPolicySelection[]
  readonly resolverVersion: number
}
