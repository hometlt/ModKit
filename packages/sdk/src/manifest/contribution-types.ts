/**
 * Hand-authored types for the contribution envelope; pinned to the schema consts by the
 * compile-time drift gate (test/schema-drift.ts).
 */

import type { ContractId } from '@modkitx-x3/core'
import type { RequirementMode, RequirementScope } from './types.js'

export type ExecutionProfile =
  | 'browser-sandbox'
  | 'worker-brokered'
  | 'process-brokered'
  | 'wasm-brokered'
  | 'trusted-in-process'
  | 'remote-provider'

export type PermissionClass =
  | 'read-source'
  | 'write-source'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'network'
  | 'process-launch'
  | 'native-code'
  | 'credentials'
  | 'clipboard'
  | 'persistent-storage'

export type RuntimeEnvironment =
  'browser-main' | 'browser-worker' | 'node' | 'node-worker' | 'wasm' | 'native' | 'external-tool'

export type OperatingSystem = 'any' | 'windows' | 'linux' | 'darwin' | 'android' | 'ios'

export type Architecture = 'any' | 'x86' | 'x64' | 'arm32' | 'arm64' | 'wasm32'

export interface RuntimeTargetConstraint {
  readonly environments?: readonly RuntimeEnvironment[]
  readonly operatingSystems?: readonly OperatingSystem[]
  readonly architectures?: readonly Architecture[]
  readonly requiredHostCapabilities?: readonly string[]
  readonly requiredWebApis?: readonly string[]
  readonly externalTools?: readonly string[]
}

/** MK3/24 §3: the single authored owner of requested permissions and profiles. */
export interface RuntimeVariantDeclaration {
  readonly variantId: string
  readonly entrypoint: string
  readonly target: RuntimeTargetConstraint
  readonly executionProfile: ExecutionProfile
  readonly requestedPermissionClasses: readonly PermissionClass[]
}

/** MK3/23 §8. */
export interface ScopedContractRequirement {
  readonly contract: ContractId
  readonly major: number
  readonly range?: string
  readonly mode: RequirementMode
  readonly scope: RequirementScope
}

export interface ContractRef {
  readonly id: ContractId
  readonly major: number
}

export type ContributionStatus = 'supported' | 'partial' | 'unsupported' | 'experimental'

/** MK3/27 §6 envelope with §0.5 simplifications (no version; status optional). */
export interface ContributionManifestV1<TSpec = unknown> {
  readonly schemaVersion: 1
  readonly contract: ContractRef
  readonly id: string
  readonly displayName: string
  readonly status?: ContributionStatus
  readonly runtimeVariants?: readonly RuntimeVariantDeclaration[]
  readonly dependsOn?: readonly ScopedContractRequirement[]
  readonly limitations?: readonly string[]
  readonly spec: TSpec
}
