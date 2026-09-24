export { listFilesRecursive, loadExtensionDirectory } from './loader.js'
export {
  flushArtifactDigestCache,
  useArtifactDigestCache,
  type ArtifactDigestRecord,
} from './artifact-digest-cache.js'
export { openFileSource } from './file-source.js'
export {
  openFileArtifactSource,
  type FileArtifactReadTelemetry,
  type FileArtifactSourceOptions,
  type FileArtifactStreamTelemetry,
} from './file-artifact-source.js'
export {
  openDirectoryArtifactSource,
  openPathArtifactSource,
  type DirectoryArtifactSourceOptions,
} from './directory-artifact-source.js'
export {
  createFileEditingBackend,
  FILE_EDITING_BACKEND_CAPABILITY,
  type FileEditingBackend,
  type FileEditingBackendOptions,
} from './file-editing-backend.js'
export {
  createFilePayloadStore,
  type FilePayloadStore,
  type FilePayloadStoreOptions,
} from './file-payload-store.js'
export {
  createNodeSubjectServices,
  type NodeSubjectServices,
  type NodeSubjectServicesOptions,
} from './subject-services.js'
export {
  createNodeMapPreviewResourcePlanResolver,
  NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID,
  type NodeMapPreviewResourcePlanResolverOptions,
} from './map-preview-resource-resolver.js'
export {
  createContentSourceMapPreviewResourcePlanResolver,
  type ContentSourceMapPreviewResourcePlanResolverOptions,
} from './content-source-map-preview-resolver.js'
export {
  launchNodeGameResource,
  runningGameProcesses,
  spawnDetachedGameProcess,
  stopGameProcesses,
  watchGameLaunchLogs,
  type GameLaunchLogWatch,
  type WatchGameLaunchLogsRequest,
  type LaunchNodeGameResourceRequest,
  type NodeGameLaunchFilesystem,
  type NodeGameLaunchPathKind,
  type NodeGameLaunchReceipt,
  type NodeGameLaunchResult,
  type NodeGameProcessLease,
  type NodeGameProcessSpawner,
  type NodeGameProcessSpawnRequest,
} from './game-launch.js'
export {
  loadExtensionRoots,
  type ExtensionRootFailure,
  type ExtensionRootRequest,
  type LoadedExtensionRoots,
  type LoadExtensionRootsOptions,
} from './extension-roots.js'
export {
  createLocalExtensionArtifactStore,
  type ExtensionArtifactRecovery,
  type ExtensionQuarantineReason,
  type InstalledExtensionArtifact,
  type LocalExtensionArtifactStore,
  type LocalExtensionArtifactStoreOptions,
  type LocalExtensionCatalogEntry,
  type QuarantinedExtensionArtifact,
} from './extension-artifact-store.js'
export {
  createFilesystemInputResolver,
  createPathSubjectOpener,
  DEFAULT_SUBJECT_OPEN_BUDGET,
  type FilesystemInputResolverOptions,
  type PathSubjectOpenerOptions,
} from './subject-opener.js'
export {
  NODE_WORKER_LINK_TRANSPORTS,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  nodeWorkerRuntimeTargetBase,
  type NodeWorkerRealmOptions,
} from './profile.js'
export {
  createNodeExecutionBackends,
  type NodeExecutionBackendsOptions,
} from './execution-backends.js'
export type { DataSourceSurfaceSource } from '../execution/index.js'
export {
  WORKER_RESTARTED_DIAGNOSTIC,
  WORKER_SHARED_PROCESS_DIAGNOSTIC,
  createNodeWorkerBackend,
  type NodeWorkerBackendOptions,
} from './worker-backend.js'
export {
  spawnWorkerRealm,
  type WorkerRealm,
  type WorkerRealmExit,
  type WorkerRealmSpawn,
} from './worker-realm.js'
export {
  DEFAULT_WORKER_BACKEND_POLICY,
  WORKER_BACKEND_POLICY_CEILINGS,
  workerBackendPolicy,
  type WorkerBackendPolicy,
  type WorkerBackendPolicyInput,
  type WorkerResourceLimits,
} from '../execution/worker-policy.js'
export { createModkit, type Modkit, type ModkitOpened, type ModkitOptions } from './modkit.js'
/** Trusted desktop content-source configuration, re-exported so Node hosts need no direct vfs edge. */
export { loadContentSources } from '@modkit/vfs/content-sources/node'
export {
  openDirectoryResolvedDataWorkspace,
  RESOLVED_DATA_EDIT_UNAVAILABLE,
  type DirectoryResolvedDataWorkspace,
  type OpenDirectoryResolvedDataWorkspaceRequest,
  type ResolvedDataChangeRequest,
  type ResolvedDataEditingAuthority,
} from './resolved-data-directories.js'
