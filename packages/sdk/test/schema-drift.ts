/**
 * Compile-time drift gate (DoR §3, workflow step 3): the hand-written public types must
 * be structurally identical (modulo readonly) to what the schema consts define. Any
 * divergence fails `pnpm typecheck` — this file has no runtime behaviour.
 */

import type { FromSchema } from 'json-schema-to-ts'
import type {
  extensionManifestSchema,
  extensionRequirementSchema,
  modkitBlockSchema,
} from '../src/schemas/extension-manifest.js'
import type {
  contributionManifestSchema,
  runtimeVariantDeclarationSchema,
  scopedContractRequirementSchema,
} from '../src/schemas/contribution-manifest.js'
import type { ExtensionManifest, ExtensionRequirement, ModkitBlock } from '../src/manifest/types.js'
import type {
  ContributionManifestV1,
  RuntimeVariantDeclaration,
  ScopedContractRequirement,
} from '../src/manifest/contribution-types.js'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T

export type ExtensionManifestDriftGate = Expect<
  Equal<DeepMutable<ExtensionManifest>, FromSchema<typeof extensionManifestSchema>>
>
export type ExtensionRequirementDriftGate = Expect<
  Equal<DeepMutable<ExtensionRequirement>, FromSchema<typeof extensionRequirementSchema>>
>
export type ModkitBlockDriftGate = Expect<
  Equal<DeepMutable<ModkitBlock>, FromSchema<typeof modkitBlockSchema>>
>

export type ContributionManifestDriftGate = Expect<
  Equal<DeepMutable<ContributionManifestV1>, FromSchema<typeof contributionManifestSchema>>
>
export type RuntimeVariantDriftGate = Expect<
  Equal<DeepMutable<RuntimeVariantDeclaration>, FromSchema<typeof runtimeVariantDeclarationSchema>>
>
export type ScopedContractRequirementDriftGate = Expect<
  Equal<DeepMutable<ScopedContractRequirement>, FromSchema<typeof scopedContractRequirementSchema>>
>
