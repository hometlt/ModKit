import {
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  type ExtensionSubjectCardWireDocument,
  type ExtensionSubjectProjection,
} from '@modkitx/extension-manager'
import type { LocalExtensionCandidate } from '@modkitx/extension-manager/node'
import type { Inventory } from '@modkitx-x3/host'
import type { ContributionManifestV1Wire, ExtensionManifest } from '@modkitx-x3/sdk'

export interface ExtensionCardCatalogEntry {
  readonly id: string
  readonly installed: boolean
  readonly root?: string
  readonly managedPackageId?: string
  readonly managedPackageEnabled?: boolean
  readonly projection: ExtensionSubjectProjection
}

export interface ExtensionCardBundle {
  readonly activeSubjectId: string
  readonly documents: readonly ExtensionSubjectCardWireDocument[]
  readonly extension: {
    readonly id: string
    readonly installed: boolean
    readonly enabled: boolean
    readonly linkable: boolean
    readonly managedPackageId?: string
    readonly managedPackageEnabled?: boolean
    readonly codecs: {
      readonly ids: readonly string[]
      readonly enabled: boolean
    }
  }
}

export interface CreateExtensionCardCatalogOptions {
  readonly inventory: Inventory
  readonly localCandidates: readonly LocalExtensionCandidate[]
  /** Coordinates whose local source is unique and may be linked from a card. */
  readonly linkableLocalExtensionIds: readonly string[]
  readonly managedPackageByExtension: ReadonlyMap<string, string>
  readonly disabledManagedExtensions: readonly string[]
  readonly disabledExtensions: readonly string[]
  readonly disabledContributions: readonly string[]
  readonly onDiagnostic?: (message: string) => void
}

const coordinate = (manifest: ExtensionManifest): string => `${manifest.publisher}/${manifest.id}`

function enablement(
  contributionIds: readonly string[],
  disabled: ReadonlySet<string>,
): Readonly<Record<string, boolean>> {
  return Object.freeze(
    Object.fromEntries(contributionIds.map(id => [id, !disabled.has(id)] as const)),
  )
}

/**
 * One subject catalog for loaded inventory roots and inert local candidates. Loaded inventory is
 * authoritative when the same coordinate is also declared by the local workspace catalog.
 */
export function createExtensionCardCatalog(
  options: CreateExtensionCardCatalogOptions,
): ReadonlyMap<string, ExtensionCardCatalogEntry> {
  const disabledExtensions = new Set(options.disabledExtensions)
  const disabledContributions = new Set(options.disabledContributions)
  const linkableLocalExtensions = new Set(options.linkableLocalExtensionIds)
  const disabledManagedExtensions = new Set(options.disabledManagedExtensions)
  const entries = new Map<string, ExtensionCardCatalogEntry>()
  const candidatesById = new Map(
    options.localCandidates.map(candidate => [candidate.id, candidate]),
  )

  for (const candidate of options.localCandidates) {
    if (candidate.license === undefined || candidate.contributions.length === 0) {
      options.onDiagnostic?.(
        `${candidate.id} has no ${candidate.license === undefined ? 'license' : 'contributions'}; ` +
          'its subject card was omitted.',
      )
      continue
    }
    const extension: ExtensionManifest = Object.freeze({
      schemaVersion: 1,
      publisher: candidate.publisher,
      id: candidate.extensionId,
      version: candidate.version,
      license: candidate.license,
      contributionManifests: candidate.contributionManifests,
    })
    const contributions = candidate.contributions.map(
      item => item.manifest,
    ) as unknown as readonly ContributionManifestV1Wire[]
    try {
      const projection = projectExtensionSubjects({
        extension,
        contributions,
        metadata: {
          displayName: candidate.displayName,
          ...(candidate.summary === undefined ? {} : { description: candidate.summary }),
          ...(candidate.homepage === undefined ? {} : { homepage: candidate.homepage }),
          source: `local:${candidate.sourceId}`,
          trusted: true,
        },
        enabled: false,
        contributionEnablement: enablement(
          candidate.contributions.map(item => item.id),
          disabledContributions,
        ),
      })
      entries.set(candidate.id, {
        id: candidate.id,
        installed: false,
        ...(candidate.root === undefined || !linkableLocalExtensions.has(candidate.id)
          ? {}
          : { root: candidate.root }),
        projection,
      })
    } catch (error) {
      options.onDiagnostic?.(
        `${candidate.id} could not be projected as subjects: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  for (const extension of options.inventory.extensions) {
    const id = coordinate(extension.manifest)
    const candidate = candidatesById.get(id)
    const managedPackageId = options.managedPackageByExtension.get(id)
    const contributions = extension.contributions.flatMap(item =>
      item.manifest === undefined ? [] : [item.manifest],
    )
    const projection = projectExtensionSubjects({
      extension: extension.manifest,
      contributions,
      metadata: {
        displayName: candidate?.displayName ?? id,
        ...(candidate?.summary === undefined ? {} : { description: candidate.summary }),
        ...(candidate?.homepage === undefined ? {} : { homepage: candidate.homepage }),
        source: extension.origin,
        trusted: extension.origin === 'bundled',
      },
      enabled: !disabledExtensions.has(id),
      contributionEnablement: enablement(
        contributions.map(item => item.id),
        disabledContributions,
      ),
    })
    entries.set(id, {
      id,
      installed: true,
      ...(managedPackageId === undefined
        ? {}
        : {
            managedPackageId,
            managedPackageEnabled: !disabledManagedExtensions.has(id),
          }),
      projection,
    })
  }

  return entries
}

/** Function-free payload consumed by the shared card renderer in a VS Code webview. */
export async function extensionCardBundle(
  entry: ExtensionCardCatalogEntry,
  contributionId?: string,
): Promise<ExtensionCardBundle> {
  const active =
    contributionId === undefined
      ? entry.projection.extension
      : entry.projection.contributions.find(item => item.id === contributionId)
  if (active === undefined) {
    throw new Error(`extension ${entry.id} has no contribution ${contributionId}`)
  }
  const documents = await Promise.all(
    entry.projection.records.map(record => extensionSubjectRecordToWire(record)),
  )
  const codecs = entry.projection.contributions.filter(
    contribution => contribution.contract.id === 'org.modkitx/codec-contribution',
  )
  return Object.freeze({
    activeSubjectId: active.subjectId,
    documents: Object.freeze(documents),
    extension: Object.freeze({
      id: entry.id,
      installed: entry.installed,
      enabled: entry.projection.extension.enabled,
      linkable: !entry.installed && entry.root !== undefined,
      codecs: Object.freeze({
        ids: Object.freeze(codecs.map(codec => codec.id)),
        enabled: codecs.length > 0 && codecs.every(codec => codec.enabled),
      }),
      ...(entry.managedPackageId === undefined
        ? {}
        : {
            managedPackageId: entry.managedPackageId,
            managedPackageEnabled: entry.managedPackageEnabled,
          }),
    }),
  })
}
