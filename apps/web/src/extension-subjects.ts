/**
 * Browser projection of the composed extension inventory into ordinary Modkit subjects.
 *
 * The browser does not discover directories on its own. This module only projects roots the host
 * has already composed from its attested bundle, downloaded storage or a user-granted handle.
 * Every child is the authored contribution itself; contract nodes are visual grouping only.
 */
import {
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  type ExtensionSubjectCardWireDocument,
  type ExtensionSubjectProjection,
} from '@modkitx/extension-manager'
import type { Inventory, InventoryExtension } from '@modkitx-x3/host'
import type { ContributionManifestV1Wire } from '@modkitx-x3/sdk'

export interface WebExtensionSubjectEntry {
  readonly id: string
  readonly source: string
  readonly origin: InventoryExtension['origin']
  /** Distribution package id when this root came from browser-managed storage. */
  readonly managedPackageId?: string
  /** Direct portable setting, independent of whether a parent package is active. */
  readonly configuredEnabled: boolean
  readonly projection: ExtensionSubjectProjection
}

export interface WebExtensionSubjectCatalog {
  readonly entries: readonly WebExtensionSubjectEntry[]
  extension(id: string): WebExtensionSubjectEntry | undefined
  subject(
    subjectId: string,
  ):
    | ExtensionSubjectProjection['extension']
    | ExtensionSubjectProjection['contributions'][number]
    | undefined
}

export interface CreateWebExtensionSubjectCatalogOptions {
  readonly disabledExtensions?: readonly string[]
  readonly disabledContributions?: readonly string[]
  /** Distribution ownership supplied by the browser package loader, never inferred from paths. */
  readonly managedPackageByExtension?: Readonly<Record<string, string>>
  /** Live browser package state, keyed by distribution package id. */
  readonly managedPackageEnablement?: Readonly<Record<string, boolean>>
}

export interface WebExtensionSubjectCardBundle {
  readonly entry: WebExtensionSubjectEntry
  readonly activeSubjectId: string
  readonly documents: readonly ExtensionSubjectCardWireDocument[]
}

const coordinate = (extension: InventoryExtension): string =>
  `${extension.manifest.publisher}/${extension.manifest.id}`

/**
 * Build cards from the validated inventory. Raw folder contents and registry summaries never reach
 * this projection, so a browser cannot accidentally turn an ungranted directory into a catalog.
 */
export function createWebExtensionSubjectCatalog(
  inventory: Inventory,
  options: CreateWebExtensionSubjectCatalogOptions = {},
): WebExtensionSubjectCatalog {
  const disabledExtensions = new Set(options.disabledExtensions ?? [])
  const disabledContributions = new Set(options.disabledContributions ?? [])
  const entries = inventory.extensions.map(extension => {
    const id = coordinate(extension)
    const packageId = options.managedPackageByExtension?.[id]
    const contributionEnablement = Object.fromEntries(
      extension.contributions.flatMap(contribution =>
        contribution.manifest === undefined
          ? []
          : [
              [
                contribution.manifest.id,
                !disabledContributions.has(contribution.manifest.id),
              ] as const,
            ],
      ),
    )
    const configuredEnabled = !disabledExtensions.has(id)
    const enabled =
      configuredEnabled &&
      (packageId === undefined ? true : (options.managedPackageEnablement?.[packageId] ?? true))
    const projection = projectExtensionSubjects({
      extension: extension.manifest,
      contributions: extension.contributions.flatMap(contribution =>
        contribution.manifest === undefined
          ? []
          : [contribution.manifest as unknown as ContributionManifestV1Wire],
      ),
      metadata: {
        displayName: id,
        source: extension.source,
        trusted: extension.origin === 'bundled',
      },
      enabled,
      contributionEnablement: Object.freeze(contributionEnablement),
    })
    return Object.freeze({
      id,
      source: extension.source,
      origin: extension.origin,
      ...(packageId === undefined ? {} : { managedPackageId: packageId }),
      configuredEnabled,
      projection,
    })
  })
  const frozenEntries = Object.freeze(entries)
  const byExtension = new Map(frozenEntries.map(entry => [entry.id, entry]))
  const bySubject = new Map(
    frozenEntries.flatMap(entry =>
      entry.projection.records.map(record => [record.subjectId, record] as const),
    ),
  )
  return Object.freeze({
    entries: frozenEntries,
    extension: (id: string) => byExtension.get(id),
    subject: (subjectId: string) => bySubject.get(subjectId),
  })
}

/** Materialize the inert wire form used by every host-owned extension card renderer. */
export async function webExtensionSubjectCardBundle(
  entry: WebExtensionSubjectEntry,
  subjectId: string = entry.projection.extension.subjectId,
  signal?: AbortSignal,
): Promise<WebExtensionSubjectCardBundle> {
  if (entry.projection.subject(subjectId) === undefined) {
    throw new Error(`extension ${entry.id} has no subject ${subjectId}`)
  }
  return Object.freeze({
    entry,
    activeSubjectId: subjectId,
    documents: Object.freeze(
      await Promise.all(
        entry.projection.records.map(record => extensionSubjectRecordToWire(record, signal)),
      ),
    ),
  })
}
