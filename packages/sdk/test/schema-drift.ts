/**
 * Compile-time drift gate (DoR §3, workflow step 3): the hand-written public types must
 * be structurally identical (modulo readonly) to what the schema consts define. Any
 * divergence fails `pnpm typecheck` — this file has no runtime behaviour.
 */

import type { FromSchema } from 'json-schema-to-ts'
import type { SourceSpanWire, sourceSpanSchema } from '@modkit/core'
import type {
  extensionManifestSchema,
  extensionAssetReferenceSchema,
  extensionGameDescriptorSchema,
  extensionPresentationSchema,
  extensionRequirementSchema,
  extensionSourceDetailsSchema,
  extensionVendorDescriptorSchema,
  modkitBlockSchema,
} from '../src/schemas/extension-manifest.js'
import type {
  contributionManifestSchema,
  runtimeVariantDeclarationSchema,
  scopedContractRequirementSchema,
} from '../src/schemas/contribution-manifest.js'
import type {
  codecContributionSpecV1Schema,
  contractDefinitionSpecV1Schema,
  dataSourceContributionSpecV1Schema,
  dataSourceMethodSurfaceV1Schema,
  dataSourceSurfaceV1Schema,
  editorContributionSpecV1Schema,
  knowledgePackSpecV1Schema,
  localizationContributionSpecV1Schema,
  serviceProviderContributionSpecV1Schema,
  traitDefinitionSpecV1Schema,
  viewerContributionSpecV1Schema,
} from '../src/schemas/contribution-specs.js'
import type { subjectDescriptorV2InferenceSchema } from '../src/schemas/subject-descriptor.js'
import type {
  ExtensionAssetReference,
  ExtensionGameDescriptor,
  ExtensionManifest,
  ExtensionPresentation,
  ExtensionRequirement,
  ExtensionSourceDetails,
  ExtensionVendorDescriptor,
  ModkitBlock,
} from '../src/manifest/types.js'
import type {
  ContributionManifestV1Wire,
  RuntimeVariantDeclaration,
  ScopedContractRequirementWire,
} from '../src/manifest/contribution-types.js'
import type {
  CodecContributionSpecV1Wire,
  ServiceProviderContributionSpecV1Wire,
  ViewerContributionSpecV1Wire,
  LocalizationContributionSpecV1Wire,
} from '../src/manifest/contribution-spec-types.js'
import type { DataSourceContributionSpecV1 } from '../src/asset-capabilities/data-sources.js'
import type { AnyDescriptorWire, JsonValue } from '../src/asset-capabilities/types.js'
import type {
  ContractDefinitionSpecV1Wire,
  DataSourceMethodSurfaceV1Wire,
  DataSourceSurfaceV1Wire,
  TraitDefinitionSpecV1Wire,
} from '../src/definitions.js'
import type { EditorContributionSpecV1Wire } from '../src/editing.js'
import type { KnowledgePackSpecV1Wire } from '../src/knowledge/index.js'
import type { FieldType } from '../src/fields/index.js'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type KeysOfUnion<T> = T extends unknown ? keyof T : never
type Simplify<T> = { [K in keyof T]: T[K] }
type ExclusiveUnion<T, Whole = T> = T extends unknown
  ? Simplify<T & Partial<Record<Exclude<KeysOfUnion<Whole>, keyof T>, never>>>
  : never

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T

/** Avoid recursively expanding JsonValue while normalizing descriptor readonly fields. */
type DeepMutableDescriptor<T> = T extends FieldType
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutableDescriptor<U>[]
    : T extends object
      ? {
          -readonly [K in keyof T]: K extends 'parameters' | 'data' | 'value' | 'params'
            ? JsonValue
            : DeepMutableDescriptor<T[K]>
        }
      : T

/** Published core schema: the three exclusive coordinate branches must track the wire DTO. */
export type SourceSpanWireDriftGate = Expect<
  Equal<DeepMutable<SourceSpanWire>, ExclusiveUnion<FromSchema<typeof sourceSpanSchema>>>
>

export type ExtensionManifestDriftGate = Expect<
  Equal<DeepMutable<ExtensionManifest>, FromSchema<typeof extensionManifestSchema>>
>
export type ExtensionRequirementDriftGate = Expect<
  Equal<DeepMutable<ExtensionRequirement>, FromSchema<typeof extensionRequirementSchema>>
>
export type ExtensionVendorDescriptorDriftGate = Expect<
  Equal<DeepMutable<ExtensionVendorDescriptor>, FromSchema<typeof extensionVendorDescriptorSchema>>
>
export type ExtensionGameDescriptorDriftGate = Expect<
  Equal<DeepMutable<ExtensionGameDescriptor>, FromSchema<typeof extensionGameDescriptorSchema>>
>
export type ExtensionAssetReferenceDriftGate = Expect<
  Equal<DeepMutable<ExtensionAssetReference>, FromSchema<typeof extensionAssetReferenceSchema>>
>
type ExtensionSourceDetailsFromSchema = FromSchema<typeof extensionSourceDetailsSchema>
export type ExtensionSourceDetailsDriftGate = Expect<
  DeepMutable<ExtensionSourceDetails> extends ExtensionSourceDetailsFromSchema
    ? ExtensionSourceDetailsFromSchema extends DeepMutable<ExtensionSourceDetails>
      ? true
      : false
    : false
>
export type ExtensionPresentationDriftGate = Expect<
  Equal<DeepMutable<ExtensionPresentation>, FromSchema<typeof extensionPresentationSchema>>
>
export type ModkitBlockDriftGate = Expect<
  Equal<DeepMutable<ModkitBlock>, FromSchema<typeof modkitBlockSchema>>
>

export type ContributionManifestDriftGate = Expect<
  Equal<
    DeepMutable<ContributionManifestV1Wire>,
    FromSchema<
      typeof contributionManifestSchema,
      { deserialize: [{ pattern: { title: 'JsonValue' }; output: DeepMutable<JsonValue> }] }
    >
  >
>
export type RuntimeVariantDriftGate = Expect<
  Equal<DeepMutable<RuntimeVariantDeclaration>, FromSchema<typeof runtimeVariantDeclarationSchema>>
>
export type ScopedContractRequirementDriftGate = Expect<
  Equal<
    DeepMutable<ScopedContractRequirementWire>,
    FromSchema<typeof scopedContractRequirementSchema>
  >
>

/** `FromSchema` omits absent branch keys; runtime `additionalProperties: false` makes them exclusive. */
export type CodecContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<CodecContributionSpecV1Wire>,
    ExclusiveUnion<FromSchema<typeof codecContributionSpecV1Schema>>
  >
>
export type ServiceProviderContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<ServiceProviderContributionSpecV1Wire>,
    FromSchema<
      typeof serviceProviderContributionSpecV1Schema,
      { deserialize: [{ pattern: { title: 'JsonValue' }; output: DeepMutable<JsonValue> }] }
    >
  >
>
export type ViewerContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<ViewerContributionSpecV1Wire>,
    FromSchema<typeof viewerContributionSpecV1Schema>
  >
>
export type EditorContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<EditorContributionSpecV1Wire>,
    FromSchema<typeof editorContributionSpecV1Schema>
  >
>
export type KnowledgePackSpecDriftGate = Expect<
  Equal<
    DeepMutable<KnowledgePackSpecV1Wire>,
    FromSchema<
      typeof knowledgePackSpecV1Schema,
      { deserialize: [{ pattern: { title: 'JsonValue' }; output: DeepMutable<JsonValue> }] }
    >
  >
>
export type LocalizationContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<LocalizationContributionSpecV1Wire>,
    FromSchema<typeof localizationContributionSpecV1Schema>
  >
>
export type DataSourceContributionSpecDriftGate = Expect<
  Equal<
    DeepMutable<DataSourceContributionSpecV1>,
    FromSchema<typeof dataSourceContributionSpecV1Schema>
  >
>
/**
 * NXT-103: the method-surface schema is a `oneOf` of two arms and the hand-written wire type is
 * the same two-arm union — `lease` carries `result`/`wrapper`, nothing else does — so the
 * kind ↔ result correlation is a structural fact on both sides, not a comment.
 */
export type DataSourceMethodSurfaceDriftGate = Expect<
  Equal<
    DeepMutable<DataSourceMethodSurfaceV1Wire>,
    FromSchema<typeof dataSourceMethodSurfaceV1Schema>
  >
>
export type DataSourceSurfaceDriftGate = Expect<
  Equal<DeepMutable<DataSourceSurfaceV1Wire>, FromSchema<typeof dataSourceSurfaceV1Schema>>
>
export type TraitDefinitionSpecDriftGate = Expect<
  Equal<DeepMutable<TraitDefinitionSpecV1Wire>, FromSchema<typeof traitDefinitionSpecV1Schema>>
>
export type ContractDefinitionSpecDriftGate = Expect<
  Equal<
    DeepMutable<ContractDefinitionSpecV1Wire>,
    FromSchema<
      typeof contractDefinitionSpecV1Schema,
      { deserialize: [{ pattern: { title: 'JsonValue' }; output: DeepMutable<JsonValue> }] }
    >
  >
>
type SubjectDescriptorV2FromSchema = FromSchema<
  typeof subjectDescriptorV2InferenceSchema,
  {
    deserialize: [
      { pattern: { title: 'JsonValue' }; output: JsonValue },
      { pattern: { title: 'FieldType' }; output: FieldType },
    ]
  }
>
type SubjectDescriptorV2PublicType = DeepMutableDescriptor<AnyDescriptorWire>
/** Two-way structural equivalence; union/intersection normalization makes `Equal` too strict. */
export type SubjectDescriptorV2DriftGate = Expect<
  SubjectDescriptorV2PublicType extends SubjectDescriptorV2FromSchema
    ? SubjectDescriptorV2FromSchema extends SubjectDescriptorV2PublicType
      ? true
      : false
    : false
>
