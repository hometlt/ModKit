/**
 * Thin page model over the shared `@modkit/extension-manager` client.
 *
 * Trust, version selection, install eligibility, integrity matching and package/root validation
 * belong to the common client. This adapter only translates its snapshot into labels used by the
 * web view and tracks whether the user explicitly requested a registry refresh this session.
 */

import type {
  ExtensionManagerClient,
  ExtensionManagerEntry,
} from '@modkit/extension-manager/browser'

export interface ManagedExtensionPageRow {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly available: boolean
  readonly installed: boolean
  readonly enabled: boolean
  readonly updateAvailable: boolean
  readonly trusted: boolean
  readonly trustReason: string
  readonly availableVersion?: string
  readonly installedVersion?: string
}

export interface ManagedExtensionsPageModel {
  /** False until the user explicitly asked this session to refresh the registry. */
  readonly catalogLoaded: boolean
  readonly catalogLocation: string
  readonly rows: readonly ManagedExtensionPageRow[]
}

export interface ManagedExtensionsController {
  snapshot(): ManagedExtensionsPageModel
  /** Common-client snapshot: cached catalog + local stores only, never registry refresh. */
  refreshInstalled(): Promise<ManagedExtensionsPageModel>
  /** The only page action that invokes CatalogSource.refresh(). */
  refreshCatalog(): Promise<ManagedExtensionsPageModel>
  install(id: string): Promise<ManagedExtensionsPageModel>
  update(id: string): Promise<ManagedExtensionsPageModel>
  remove(id: string): Promise<ManagedExtensionsPageModel>
  enable(id: string, enabled: boolean): Promise<ManagedExtensionsPageModel>
}

export interface ManagedExtensionsControllerOptions {
  readonly client: ExtensionManagerClient
  readonly catalogLocation: string
}

function pageRow(entry: ExtensionManagerEntry): ManagedExtensionPageRow {
  const installed = entry.installedVersion !== undefined
  return Object.freeze({
    id: entry.id,
    name: entry.displayName,
    available: entry.availableVersion !== 'unknown',
    installed,
    enabled: installed && entry.enabled,
    updateAvailable: entry.updateAvailable,
    trusted: entry.trusted,
    trustReason: entry.trusted
      ? `Trust policy accepted ${entry.publisher} from ${entry.source}.`
      : `The common extension manager did not verify ${entry.publisher} from ${entry.source}.`,
    ...(entry.availableVersion === 'unknown' ? {} : { availableVersion: entry.availableVersion }),
    ...(entry.installedVersion === undefined ? {} : { installedVersion: entry.installedVersion }),
  })
}

export function createManagedExtensionsController(
  options: ManagedExtensionsControllerOptions,
): ManagedExtensionsController {
  let catalogLoaded = false
  let current: ManagedExtensionsPageModel = Object.freeze({
    catalogLoaded,
    catalogLocation: options.catalogLocation,
    rows: Object.freeze([]),
  })

  const readSnapshot = async (): Promise<ManagedExtensionsPageModel> => {
    const shared = await options.client.snapshot()
    current = Object.freeze({
      catalogLoaded,
      catalogLocation: options.catalogLocation,
      rows: Object.freeze(shared.entries.map(pageRow)),
    })
    return current
  }

  return {
    snapshot: () => current,
    refreshInstalled: readSnapshot,

    async refreshCatalog() {
      await options.client.refresh()
      catalogLoaded = true
      return readSnapshot()
    },

    async install(id) {
      await options.client.install(id)
      return readSnapshot()
    },

    async update(id) {
      await options.client.update(id)
      return readSnapshot()
    },

    async remove(id) {
      await options.client.remove(id)
      return readSnapshot()
    },

    async enable(id, enabled) {
      await options.client.setEnabled(id, enabled)
      return readSnapshot()
    },
  }
}
