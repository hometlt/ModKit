/** Host-owned A-2 contribution registrations and inert inventory projectors. */

import { contractId, type ContractId } from '@modkit/core'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  CODEC_CONTRIBUTION_CONTRACT,
  CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
  EDITOR_CONTRIBUTION_CONTRACT,
  EDITOR_CONTRIBUTION_FACT,
  KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT,
  LOCALIZATION_CONTRIBUTION_CONTRACT,
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
  VIEWER_CONTRIBUTION_CONTRACT,
  activationRequiredPermissionClasses,
  createContributionContractRegistry,
  type CodecContributionSpecV1Wire,
  type ContributionContractRegistration,
  type ContributionManifestV1,
  type ContributionProjectionContext,
  type InventoryFact,
  type JsonSchema,
  type JsonValue,
  type ServiceProviderContributionSpecV1Wire,
} from '@modkit/sdk'

/** Generic fact understood by the production offer catalog, not by individual contribution kinds. */
export const PROVIDER_OFFER_INVENTORY_FACT: ContractId = contractId(
  'modkit.inventory/provider-offer',
)
export const VIEWER_CONTRIBUTION_INVENTORY_FACT: ContractId = contractId(
  'modkit.inventory/viewer-contribution',
)

function fact(contract: ContractId, value: JsonValue, context: ContributionProjectionContext) {
  return Object.freeze({
    contract: Object.freeze({ id: contract, major: 1 }),
    value,
    provenance: Object.freeze({ ...context }),
  }) satisfies InventoryFact
}

function executableFacts(
  manifest: ContributionManifestV1,
  context: ContributionProjectionContext,
  valueForVariant: (variantId: string) => JsonValue,
  applicableVariants?: readonly string[],
): readonly InventoryFact[] {
  return Object.freeze(
    (manifest.runtimeVariants ?? [])
      .filter(
        variant =>
          applicableVariants === undefined || applicableVariants.includes(variant.variantId),
      )
      .map(variant =>
        fact(PROVIDER_OFFER_INVENTORY_FACT, valueForVariant(variant.variantId), context),
      ),
  )
}

function codecProjector(manifest: ContributionManifestV1, context: ContributionProjectionContext) {
  const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
  return executableFacts(manifest, context, variantId => {
    const variant = manifest.runtimeVariants?.find(item => item.variantId === variantId)
    if (variant === undefined) throw new TypeError(`unknown runtime variant ${variantId}`)
    return {
      kind: 'primary',
      extensionId: context.ownerExtensionId,
      extensionVersion: context.extensionVersion,
      providerId: manifest.id,
      runtimeVariant: variant.variantId,
      target: variant.target,
      // ADR-HOST-002 §2: operation-scoped classes are capabilities the host may degrade, not
      // preconditions of resolving the codec — the resolver sees only what opening needs
      requiredPermissions: activationRequiredPermissionClasses(
        variant.requestedPermissionClasses,
        spec.operations,
      ),
      provides: spec.representations.map(representation => ({
        offerId: representation.id,
        contract: representation.contract,
        major: representation.major,
        version: `${representation.major}.0.0`,
      })),
      requires: spec.requires ?? [],
      outputs: (spec.traitDeclarations ?? [])
        .filter(declaration => declaration.presence === 'will-expose')
        .map(declaration => ({
          id: declaration.id,
          ...(declaration.definitionVersion === undefined
            ? {}
            : { definitionVersion: declaration.definitionVersion }),
        })),
      operations: spec.operations.map(operation => operation.id),
    } as unknown as JsonValue
  })
}

function serviceProjector(
  manifest: ContributionManifestV1,
  context: ContributionProjectionContext,
) {
  const spec = manifest.spec as unknown as ServiceProviderContributionSpecV1Wire
  return executableFacts(
    manifest,
    context,
    variantId => {
      const variant = manifest.runtimeVariants?.find(item => item.variantId === variantId)
      if (variant === undefined) throw new TypeError(`unknown runtime variant ${variantId}`)
      return {
        kind: spec.replacement?.compatible === true ? 'replacement' : 'primary',
        extensionId: context.ownerExtensionId,
        extensionVersion: context.extensionVersion,
        providerId: manifest.id,
        runtimeVariant: variant.variantId,
        target: variant.target,
        requiredPermissions: variant.requestedPermissionClasses,
        provides: spec.provides,
        requires: spec.requires ?? [],
        outputs: (spec.outputs ?? [])
          .filter(declaration => declaration.presence === 'will-expose')
          .map(declaration => ({
            id: declaration.id,
            ...(declaration.definitionVersion === undefined
              ? {}
              : { definitionVersion: declaration.definitionVersion }),
          })),
        ...(spec.replacement === undefined ? {} : { replaces: spec.replacement.target }),
      } as unknown as JsonValue
    },
    spec.applicableVariants,
  )
}

interface HostSchemaEntry {
  readonly contract: ContractId
  readonly major: number
  readonly schema: JsonSchema
  readonly validateSemantics: NonNullable<
    (typeof A1_SPEC_SCHEMA_ENTRIES)[number]['validateSemantics']
  >
  readonly registration?: (typeof A1_SPEC_SCHEMA_ENTRIES)[number]['registration']
}

function entry(id: ContractId): HostSchemaEntry {
  const found = A1_SPEC_SCHEMA_ENTRIES.find(item => item.contract === id && item.major === 1)
  if (found === undefined || found.validateSemantics === undefined) {
    throw new TypeError(`missing A-1 schema/semantic authority for ${id}@1`)
  }
  return found as HostSchemaEntry
}

function builtins(): readonly ContributionContractRegistration[] {
  const codec = entry(CODEC_CONTRIBUTION_CONTRACT)
  const service = entry(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT)
  const viewer = entry(VIEWER_CONTRIBUTION_CONTRACT)
  const editor = entry(EDITOR_CONTRIBUTION_CONTRACT)
  const trait = entry(TRAIT_DEFINITION_CONTRIBUTION_CONTRACT)
  const definition = entry(CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT)
  const knowledge = entry(KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT)
  const localization = entry(LOCALIZATION_CONTRIBUTION_CONTRACT)
  if (
    trait.registration === undefined ||
    definition.registration === undefined ||
    knowledge.registration === undefined ||
    localization.registration === undefined
  ) {
    throw new TypeError('A-1 definition registrations are missing')
  }
  return [
    {
      contract: { id: codec.contract, major: codec.major },
      schema: codec.schema,
      mode: 'executable',
      project: codecProjector,
      validateSemantics: codec.validateSemantics,
      moduleAbi: { export: 'createCodec', abiVersion: 1 },
      conformanceProfile: 'modkit/codec-contribution-v1',
    },
    {
      contract: { id: service.contract, major: service.major },
      schema: service.schema,
      mode: 'executable',
      project: serviceProjector,
      validateSemantics: service.validateSemantics,
      moduleAbi: { export: 'createProvider', abiVersion: 1 },
      conformanceProfile: 'modkit/service-provider-contribution-v1',
    },
    {
      contract: { id: viewer.contract, major: viewer.major },
      schema: viewer.schema,
      mode: 'executable',
      project: (manifest, context) => [
        fact(VIEWER_CONTRIBUTION_INVENTORY_FACT, manifest.spec as JsonValue, context),
      ],
      validateSemantics: viewer.validateSemantics,
      moduleAbi: { export: 'default', abiVersion: 1 },
      conformanceProfile: 'modkit/viewer-contribution-v1',
    },
    {
      contract: { id: editor.contract, major: editor.major },
      schema: editor.schema,
      mode: 'executable',
      project: (manifest, context) => [
        fact(EDITOR_CONTRIBUTION_FACT, manifest.spec as JsonValue, context),
      ],
      validateSemantics: editor.validateSemantics,
      moduleAbi: { export: 'default', abiVersion: 1 },
      conformanceProfile: 'modkit/editor-contribution-v1',
    },
    {
      contract: { id: trait.contract, major: trait.major },
      schema: trait.schema,
      mode: 'data-only',
      project: trait.registration.project,
      validateSemantics: trait.validateSemantics,
      conformanceProfile: trait.registration.conformanceProfile,
    },
    {
      contract: { id: definition.contract, major: definition.major },
      schema: definition.schema,
      mode: 'data-only',
      project: definition.registration.project,
      validateSemantics: definition.validateSemantics,
      conformanceProfile: definition.registration.conformanceProfile,
    },
    {
      contract: { id: knowledge.contract, major: knowledge.major },
      schema: knowledge.schema,
      mode: 'data-only',
      project: knowledge.registration.project,
      validateSemantics: knowledge.validateSemantics,
      conformanceProfile: knowledge.registration.conformanceProfile,
    },
    {
      contract: { id: localization.contract, major: localization.major },
      schema: localization.schema,
      mode: 'data-only',
      project: localization.registration.project,
      validateSemantics: localization.validateSemantics,
      conformanceProfile: localization.registration.conformanceProfile,
    },
  ]
}

/** New contribution contracts are appended as complete registrations; host code stays unchanged. */
export function createHostContributionContractRegistry(
  additional: readonly ContributionContractRegistration[] = [],
) {
  return createContributionContractRegistry([...builtins(), ...additional])
}
