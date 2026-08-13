export {
  extensionManifestSchema,
  extensionRequirementSchema,
  modkitBlockSchema,
  REQUIREMENT_SCOPE_KINDS,
} from './schemas/extension-manifest.js'
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
