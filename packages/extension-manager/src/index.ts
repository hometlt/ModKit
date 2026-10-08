export type * from './public-types.js'
export {
  ExtensionManagerError,
  compactRepositoryManifest,
  normalizeExtensionLock,
  normalizeRepositoryManifest,
  normalizeWorkspaceConfiguration,
} from './schema.js'
export {
  compareCatalogVersions,
  extensionCatalogSigningBytes,
  isRemoteCatalogUri,
  parseExtensionCatalog,
  validateExtensionCatalog,
} from './catalog.js'
export { createExtensionManagerClient } from './client.js'
export { createGameSupportPlan, gameSupportPlansEqual } from './game-support.js'
export {
  CONTRIBUTION_SUBJECT_KIND,
  EXTENSION_SUBJECT_KIND,
  GAME_SUBJECT_KIND,
  VENDOR_SUBJECT_KIND,
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  projectVendorGameSubjects,
  subjectRecordToWire,
  subjectFactsSourceFromWire,
} from './subjects.js'
export { normalizeGameSubjectProfile, normalizeVendorSubjectProfile } from './subject-profiles.js'
export {
  createExtensionVfs,
  loadRepositorySubjectProfiles,
  openRepositorySource,
  readMountBytes,
  readMountJson,
} from './vfs.js'
