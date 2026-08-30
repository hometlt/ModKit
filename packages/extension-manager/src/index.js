export {
  ExtensionManagerError,
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
export {
  CONTRIBUTION_SUBJECT_KIND,
  EXTENSION_SUBJECT_KIND,
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  subjectFactsSourceFromWire,
} from './subjects.js'
export { createExtensionVfs, openRepositorySource, readMountBytes, readMountJson } from './vfs.js'
