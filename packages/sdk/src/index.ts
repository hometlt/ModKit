export {
  extensionManifestSchema,
  extensionRequirementSchema,
  modkitBlockSchema,
  requirementScopeSchema,
  REQUIREMENT_SCOPE_KINDS,
} from './schemas/extension-manifest.js'
export {
  contributionManifestSchema,
  runtimeVariantDeclarationSchema,
  runtimeTargetConstraintSchema,
  scopedContractRequirementSchema,
  EXECUTION_PROFILES,
  PERMISSION_CLASSES,
  RUNTIME_ENVIRONMENTS,
  OPERATING_SYSTEMS,
  ARCHITECTURES,
} from './schemas/contribution-manifest.js'
export type {
  Architecture,
  ContractRef,
  ContributionManifestV1,
  ContributionStatus,
  ExecutionProfile,
  OperatingSystem,
  PermissionClass,
  RuntimeEnvironment,
  RuntimeTargetConstraint,
  RuntimeVariantDeclaration,
  ScopedContractRequirement,
} from './manifest/contribution-types.js'
export {
  createSpecSchemaRegistry,
  validateContributionManifest,
  type ContributionValidationResult,
  type SpecSchemaEntry,
  type SpecSchemaRegistry,
  type SpecState,
} from './manifest/spec-registry.js'
export {
  DOTTED_PATTERN,
  QUALIFIED_PATTERN,
  SEGMENT_PATTERN,
  SEMVER_PATTERN,
} from './schemas/patterns.js'
export type {
  AuthoredContainerKind,
  ExtensionManifest,
  ExtensionRequirement,
  ModkitBlock,
  RequirementMode,
  RequirementScope,
  RequirementScopeKind,
} from './manifest/types.js'
export { validateWithSchema } from './manifest/validate.js'
export {
  expandContributionManifests,
  validateContributionPattern,
  type ContributionEntry,
  type ExpansionResult,
} from './manifest/patterns.js'
export {
  normalizeExtensionManifest,
  type AuthoredContainers,
  type NormalizationResult,
} from './manifest/normalize.js'
export {
  assertNotWider,
  grantValidity,
  narrowGrant,
  type CredentialGrantRef,
  type GrantValidity,
  type GrantedNetworkScope,
  type GrantedPathScope,
  type HostPolicy,
  type NarrowRequest,
  type PermissionGrant,
} from './security/grant.js'
export type {
  ContractOffer,
  ContractRequirement,
  OfferHeader,
  ProviderLockKey,
  ProviderOffer,
  ProviderOfferKind,
  ProviderPolicyLockEntry,
  ProviderPolicySelection,
  ProviderRequest,
  RejectedCandidate,
  ResolutionResult,
  ResolvedProvider,
  RuntimeTarget,
  UnresolvedReason,
  WorkloadIntent,
} from './resolution/types.js'
