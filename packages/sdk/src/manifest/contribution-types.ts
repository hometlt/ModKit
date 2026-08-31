/**
 * Hand-authored types for the contribution envelope; pinned to the schema consts by the
 * compile-time drift gate (test/schema-drift.ts).
 */

import type { ContractId } from '@modkit/core'
import type { ContributionId, JsonValue } from '../asset-capabilities/types.js'
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
export interface ScopedContractRequirementWire {
  readonly contract: string
  readonly major: number
  readonly range?: string
  readonly mode: RequirementMode
  readonly scope: RequirementScope
}

export interface ScopedContractRequirement extends Omit<ScopedContractRequirementWire, 'contract'> {
  readonly contract: ContractId
}

export interface ContractRefWire {
  readonly id: string
  readonly major: number
}

export interface ContractRef extends Omit<ContractRefWire, 'id'> {
  readonly id: ContractId
}

export type ContributionStatus = 'supported' | 'partial' | 'unsupported' | 'experimental'

/** MK3/27 §6 envelope with §0.5 simplifications (no version; status optional). */
type IsAny<Value> = 0 extends 1 & Value ? true : false
type PreviousDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
type JsonSafeSpec<Value, Depth extends number = 10> =
  IsAny<Value> extends true
    ? never
    : Value extends null | boolean | number | string
      ? Value
      : Value extends (...args: never[]) => unknown
        ? never
        : Value extends readonly unknown[]
          ? Depth extends 0
            ? JsonValue
            : { readonly [Index in keyof Value]: JsonSafeSpec<Value[Index], PreviousDepth[Depth]> }
          : Value extends object
            ? Depth extends 0
              ? JsonValue
              : {
                  readonly [Key in keyof Value]: Key extends string
                    ? JsonSafeSpec<Value[Key], PreviousDepth[Depth]>
                    : never
                }
            : never

type ContributionSpecValue<TSpec> = [TSpec] extends [never] ? JsonValue : JsonSafeSpec<TSpec>

export interface ContributionManifestV1<TSpec = never> {
  readonly schemaVersion: 1
  readonly contract: ContractRef
  readonly id: ContributionId
  readonly displayName: string
  readonly status?: ContributionStatus
  readonly runtimeVariants?: readonly RuntimeVariantDeclaration[]
  readonly dependsOn?: readonly ScopedContractRequirement[]
  readonly limitations?: readonly string[]
  readonly spec: ContributionSpecValue<TSpec>
}

/** Exact JSON DTO selected by the schema; validated IDs are branded in the normalized form. */
export interface ContributionManifestV1Wire<TSpec = never> extends Omit<
  ContributionManifestV1<TSpec>,
  'contract' | 'dependsOn' | 'id'
> {
  readonly contract: ContractRefWire
  readonly id: string
  readonly dependsOn?: readonly ScopedContractRequirementWire[]
}
