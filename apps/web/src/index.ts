import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type Architecture,
  type HostFacilityId,
  type HostTopology,
  type OperatingSystem,
} from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { createWorkbench, type Workbench } from '@modkitx-x3/ui/workbench'
export {
  createBrowserFileHandleSource,
  createHttpRangeSource,
  openOpfsSource,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type HttpRangeSourceOptions,
} from '@modkitx-x3/host/browser'
export { createWorkbench, type Workbench } from '@modkitx-x3/ui/workbench'
export {
  createWebCommandProtocol,
  DEFAULT_WEB_COMMAND_MAX_AUTHORIZATIONS,
  DEFAULT_WEB_COMMAND_MAX_CONCURRENT_RUNS,
  type WebCommandProtocol,
  type WebCommandProtocolOptions,
  type WebCommandSubjectAuthorization,
  type WebCommandSubjectLease,
} from './commands.js'
export {
  catalogCoordinates,
  catalogToExtensionInputs,
  createWebSubjectServices,
  resolveModuleMap,
  WEB_WORKER_ENTRY,
  WEB_WORKER_MODULE_MAP,
  type WebDomGlobals,
  type WebExtensionCatalog,
  type WebExtensionCatalogEntry,
  type WebSubjectServices,
  type WebSubjectServicesOptions,
} from './subjects.js'
/*
 * User-granted extension folders (S12-web). The loader and the handle store are DOM-free and
 * belong to this package's library surface; `./extensions-ui.ts` is a page module and is imported
 * by the shell directly, the way `./settings.ts`'s panel is.
 */
export {
  containerCoordinate,
  DEFAULT_EXTENSION_ROOT_MAX_FILES,
  DEFAULT_EXTENSION_ROOT_MAX_TOTAL_BYTES,
  EXTENSION_ROOT_FAILURE_CODES,
  extensionCoordinate,
  isUserExtensionUrl,
  loadUserExtensionRoots,
  NO_USER_EXTENSION_ROOTS,
  queryUserExtensionPermission,
  requestUserExtensionPermission,
  USER_EXTENSION_ARTIFACT_ORIGIN,
  USER_EXTENSION_ORIGIN,
  userExtensionArtifactRoot,
  type LoadedUserExtensionRoots,
  type LoadUserExtensionRootsOptions,
  type UserExtensionRootFailure,
  type UserExtensionRootRequest,
  type WebExtensionDirectoryHandle,
  type WebGrantQueryable,
  type WebPermissionState,
} from './extension-roots.js'
export {
  createIndexedDbExtensionStore,
  createMemoryExtensionStore,
  USER_EXTENSION_DATABASE,
  USER_EXTENSION_STORE,
  type IdbFactoryLike,
  type IndexedDbExtensionStoreOptions,
  type StoredUserExtension,
  type UserExtensionStore,
} from './extension-store.js'
export {
  BROWSER_EXTENSION_CATALOG_CACHE,
  BROWSER_EXTENSION_LOCK_UNAVAILABLE,
  BROWSER_EXTENSION_MUTATION_LOCK,
  BrowserExtensionMutationLockUnavailableError,
  browserCatalogSigningBytes,
  createBrowserExtensionManager,
  DEFAULT_BROWSER_ARTIFACT_MAX_BYTES,
  DEFAULT_BROWSER_CATALOG_MAX_BYTES,
  type BrowserExtensionManagerFactoryOptions,
  type BrowserExtensionLockManager,
  type BrowserExtensionManagerRuntime,
  type BrowserExtensionRegistryConfiguration,
  type BrowserTrustedEd25519Key,
} from './browser-extension-manager.js'
export {
  createBrowserExtensionStorage,
  createCacheStorageExtensionResponseCache,
  createIndexedDbManagedExtensionMetadataStore,
  createLocalStorageExtensionUiPreferenceStore,
  createMemoryExtensionResponseCache,
  createMemoryManagedExtensionMetadataStore,
  MANAGED_EXTENSION_CACHE,
  MANAGED_EXTENSION_DATABASE,
  MANAGED_EXTENSION_METADATA_STORE,
  MANAGED_EXTENSION_UI_PREFERENCES,
  type BrowserCacheLike,
  type BrowserCacheStorageLike,
  type BrowserExtensionArtifactAdapter,
  type BrowserExtensionInstallRequest,
  type BrowserVerifiedExtensionInstallRequest,
  type BrowserExtensionMetadataStore,
  type BrowserExtensionResponseCache,
  type BrowserExtensionSettings,
  type BrowserExtensionSettingsValue,
  type BrowserExtensionStorage,
  type BrowserExtensionStorageOptions,
  type BrowserExtensionUiPreferences,
  type BrowserExtensionUiPreferenceStore,
  type BrowserLocalStorageLike,
  type BrowserSha256,
  type InstalledBrowserExtension,
  type ManagedExtensionIdbDatabaseLike,
  type ManagedExtensionIdbFactoryLike,
  type ManagedExtensionIdbObjectStoreLike,
  type ManagedExtensionIdbOpenRequestLike,
  type ManagedExtensionIdbRequestLike,
} from './managed-extension-storage.js'
export {
  createManagedExtensionsController,
  type ManagedExtensionPageRow,
  type ManagedExtensionsController,
  type ManagedExtensionsControllerOptions,
  type ManagedExtensionsPageModel,
} from './managed-extensions-controller.js'
export {
  createWebExtensionSubjectCatalog,
  webExtensionSubjectCardBundle,
  type CreateWebExtensionSubjectCatalogOptions,
  type WebExtensionSubjectCardBundle,
  type WebExtensionSubjectCatalog,
  type WebExtensionSubjectEntry,
} from './extension-subjects.js'
export {
  combineLoadedExtensionRoots,
  inspectPortableExtensionBundle,
  loadManagedExtensionRoots,
  MANAGED_EXTENSION_BUNDLE_FAILURE_CODES,
  type LoadManagedExtensionRootsOptions,
  type LoadedManagedExtensionRoots,
} from './managed-extension-roots.js'

export const WEB_MAIN_REALM = 'org.modkitx.app.web/main'
export const WEB_WORKER_REALM = 'org.modkitx.app.web/worker'

export interface WebRuntimeIdentity {
  readonly operatingSystem: Exclude<OperatingSystem, 'any'>
  readonly architecture: Exclude<Architecture, 'any'>
}

export interface WebFacilityProbe {
  readonly main: readonly HostFacilityId[]
  readonly worker: readonly HostFacilityId[]
  readonly sharedMemory: boolean
}

/** Conservative synchronous probe. Facilities that require permission are published only as APIs. */
export function probeWebFacilities(scope: typeof globalThis = globalThis): WebFacilityProbe {
  const main: HostFacilityId[] = []
  const worker: HostFacilityId[] = []
  const navigatorObject = scope.navigator
  const filePicker = (scope as typeof globalThis & { readonly showOpenFilePicker?: unknown })
    .showOpenFilePicker

  if (typeof scope.fetch === 'function') main.push('network.range-fetch')
  if (typeof scope.Worker === 'function') main.push('worker.module')
  if (typeof scope.SharedWorker === 'function') main.push('worker.shared')
  if (typeof filePicker === 'function') main.push('dialog.file-picker')
  if (typeof scope.Notification === 'function') main.push('notification.system')
  if (navigatorObject?.serviceWorker !== undefined) main.push('update.service-worker')
  if (navigatorObject?.storage?.estimate !== undefined) main.push('storage.quota')
  if ('getDirectory' in (navigatorObject?.storage ?? {})) main.push('storage.opfs')
  if (navigatorObject?.clipboard?.write !== undefined) main.push('clipboard.write')
  if ('gpu' in (navigatorObject ?? {})) {
    main.push('gpu.webgpu')
    worker.push('gpu.webgpu')
  }
  const canvas = scope.document?.createElement('canvas')
  if (canvas?.getContext('webgl2') !== null && canvas !== undefined) main.push('gpu.webgl2')

  const sharedMemory = scope.crossOriginIsolated && typeof scope.SharedArrayBuffer === 'function'
  if (sharedMemory) {
    main.push('wasm.threads')
    worker.push('wasm.threads')
  }
  return Object.freeze({
    main: Object.freeze(main),
    worker: Object.freeze(worker),
    sharedMemory,
  })
}

export function createWebTopology(
  identity: WebRuntimeIdentity,
  probe: WebFacilityProbe = probeWebFacilities(),
): HostTopology {
  const transports = probe.sharedMemory
    ? (['shared-memory-view', 'stream', 'structured-clone', 'transferable-buffer'] as const)
    : (['stream', 'structured-clone', 'transferable-buffer'] as const)
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/web',
    realms: [
      {
        schemaVersion: 1,
        realmId: WEB_MAIN_REALM,
        revision: '1',
        target: { environment: 'browser-main', ...identity },
        facilities: probe.main,
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('2147483648'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'org.modkitx.policy/web-default', revision: '1' },
      },
      {
        schemaVersion: 1,
        realmId: WEB_WORKER_REALM,
        revision: '1',
        target: { environment: 'browser-worker', ...identity },
        facilities: probe.worker,
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('1610612736'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'org.modkitx.policy/web-worker', revision: '1' },
      },
    ],
    links: [
      { fromRealm: WEB_MAIN_REALM, toRealm: WEB_WORKER_REALM, transports },
      { fromRealm: WEB_WORKER_REALM, toRealm: WEB_MAIN_REALM, transports },
    ],
  })
}

export interface WebApp {
  readonly topology: HostTopology
  readonly main: HostComposition
  readonly worker: HostComposition
}

export async function createWebApp(
  identity: WebRuntimeIdentity,
  extensions: readonly ExtensionInput[] = [],
  probe: WebFacilityProbe = probeWebFacilities(),
): Promise<WebApp> {
  const topology = createWebTopology(identity, probe)
  const [main, worker] = await Promise.all([
    createHostComposition({ topology, realmId: WEB_MAIN_REALM, extensions }),
    createHostComposition({ topology, realmId: WEB_WORKER_REALM, extensions }),
  ])
  return Object.freeze({ topology, main, worker })
}

export function mountWebWorkbench(
  document: Document,
  container: Element,
  app: WebApp,
  title = 'Modkit MK3',
): Workbench {
  const workbench = createWorkbench(document, {
    title,
    host: {
      label: app.main.profile.realmId,
      facilities: app.main.profile.facilities,
      degradedReasons: app.main.inventory.diagnostics
        .filter(item => item.severity === 'error')
        .map(item => item.message),
    },
  })
  container.replaceChildren(workbench.root)
  return workbench
}
