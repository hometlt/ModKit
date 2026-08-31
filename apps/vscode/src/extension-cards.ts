import {
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  type ExtensionSubjectCardWireDocument,
  type ExtensionSubjectProjection,
} from '@modkit/extension-manager'
import type { LocalExtensionCandidate } from '@modkit/extension-manager/node'
import type { Inventory } from '@modkit/host'
import type {
  ContributionManifestV1Wire,
  ExtensionManifest,
  ExtensionPresentation,
} from '@modkit/sdk'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * A resource a card is allowed to ask the VS Code adapter to open.
 *
 * This object is deliberately kept on the extension-host side. The webview only receives the
 * matching view below (an opaque id, role and display text), never this target.
 */
export interface ExtensionCardResourceTarget {
  readonly id: string
  readonly role: 'source' | 'license' | 'icon'
  readonly kind: 'folder' | 'file' | 'url'
  readonly target: string
}

/** Function-free, non-authoritative description the webview may render. */
export interface ExtensionCardResourceView {
  readonly id: string
  readonly role: Extract<ExtensionCardResourceTarget['role'], 'source' | 'license'>
  readonly label: string
  /** A real local path or a validated HTTP(S) URL. It is display-only, never an open target. */
  readonly display: string
}

/** Server-side registry passed from the adapter to the host for one opened card. */
export type ExtensionCardResourceTargets = ReadonlyMap<
  string,
  readonly ExtensionCardResourceTarget[]
>

export interface ExtensionCardCatalogEntry {
  readonly id: string
  readonly installed: boolean
  readonly root?: string
  /** Local extension root used for read-only source and license actions, if host-discovered. */
  readonly sourceRoot?: string
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
    /** The extension subject owns source/license resources even when a contribution is open. */
    readonly subjectId: string
    readonly resources: readonly ExtensionCardResourceView[]
    /** VS Code adapter may replace this with a panel-scoped `vscode-resource:` URI. */
    readonly iconUri?: string
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/** Resolve a manifest asset only when it stays beneath a host-discovered extension root. */
function confinedPath(root: string, child: string): string | undefined {
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, child)
  const fromRoot = relative(absoluteRoot, target)
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return fromRoot === '' ? target : undefined
  }
  return target
}

function resourceTargets(entry: ExtensionCardCatalogEntry): readonly ExtensionCardResourceTarget[] {
  const presentation: ExtensionPresentation | undefined = entry.projection.extension.presentation
  const targets: ExtensionCardResourceTarget[] = []
  const source = presentation?.source
  if (source?.kind === 'url') {
    if (isHttpUrl(source.url)) {
      targets.push({ id: 'source', role: 'source', kind: 'url', target: source.url })
    }
  } else if (entry.sourceRoot !== undefined) {
    const target =
      source?.kind === 'root'
        ? confinedPath(entry.sourceRoot, source.root)
        : resolve(entry.sourceRoot)
    if (target !== undefined) targets.push({ id: 'source', role: 'source', kind: 'folder', target })
  }
  if (entry.sourceRoot !== undefined) {
    const icon = presentation?.icon
    if (
      icon !== undefined &&
      /\.(?:png|svg)$/iu.test(icon.path) &&
      (icon.mediaType === undefined ||
        icon.mediaType === 'image/png' ||
        icon.mediaType === 'image/svg+xml')
    ) {
      const target = confinedPath(entry.sourceRoot, icon.path)
      if (target !== undefined) targets.push({ id: 'icon', role: 'icon', kind: 'file', target })
    }
    for (const [index, asset] of (presentation?.licenseFiles ?? []).entries()) {
      const target = confinedPath(entry.sourceRoot, asset.path)
      if (target !== undefined) {
        targets.push({ id: `license-${index}`, role: 'license', kind: 'file', target })
      }
    }
  }
  return Object.freeze(targets)
}

function resourceViews(entry: ExtensionCardCatalogEntry): readonly ExtensionCardResourceView[] {
  const presentation: ExtensionPresentation | undefined = entry.projection.extension.presentation
  const licenseFiles = presentation?.licenseFiles ?? []
  return Object.freeze(
    resourceTargets(entry)
      .filter(
        (target): target is ExtensionCardResourceTarget & { readonly role: 'source' | 'license' } =>
          target.role !== 'icon',
      )
      .map(target =>
        Object.freeze({
          id: target.id,
          role: target.role,
          label:
            target.role === 'source'
              ? 'Source'
              : (licenseFiles[Number(target.id.slice('license-'.length))]?.displayName ??
                'License'),
          display: target.target,
        }),
      ),
  )
}

/** Safe local SVG/PNG path for a native tree icon or a panel-scoped webview URI. */
export function extensionCardIconTarget(entry: ExtensionCardCatalogEntry): string | undefined {
  const target = resourceTargets(entry).find(item => item.role === 'icon')
  return target?.target
}

/**
 * Builds the server-side resource authority for one card. Its values must never cross the bridge.
 */
export function extensionCardResourceTargets(
  entry: ExtensionCardCatalogEntry,
): ExtensionCardResourceTargets {
  return new Map([[entry.projection.extension.subjectId, resourceTargets(entry)]])
}

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
      ...(candidate.presentation === undefined ? {} : { presentation: candidate.presentation }),
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
          source:
            candidate.root === undefined ? `local:${candidate.sourceId}` : resolve(candidate.root),
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
        ...(candidate.root === undefined ? {} : { sourceRoot: resolve(candidate.root) }),
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
        source: candidate?.root === undefined ? extension.origin : resolve(candidate.root),
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
      ...(candidate?.root === undefined ? {} : { sourceRoot: resolve(candidate.root) }),
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
    contribution => contribution.contract.id === 'modkit/codec-contribution',
  )
  return Object.freeze({
    activeSubjectId: active.subjectId,
    documents: Object.freeze(documents),
    extension: Object.freeze({
      id: entry.id,
      installed: entry.installed,
      enabled: entry.projection.extension.enabled,
      linkable: !entry.installed && entry.root !== undefined,
      subjectId: entry.projection.extension.subjectId,
      resources: resourceViews(entry),
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
