/**
 * Data-only localization catalog loading at the host/VFS boundary.
 *
 * Contribution manifests are already validated by the inventory. This module resolves only
 * enabled, inventory-eligible localization contributions, opens their declared JSON resources through
 * the application's registered VFS provider, verifies the exact attested bytes, and delegates
 * the decoded catalog shape to the UI-owned parser. No extension module is imported or executed.
 */

import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  LOCALIZATION_CONTRIBUTION_CONTRACT,
  type LocalizationCatalogResourceV1Wire,
  type LocalizationContributionSpecV1Wire,
} from '@modkit/sdk'
import { readAttestedArtifactFile, type ArtifactVfsPort } from './artifact-files.js'
import {
  CONTRIBUTION_DISABLED_CODE,
  EXTENSION_DISABLED_CODE,
  type Inventory,
  type InventoryContribution,
  type InventoryExtension,
} from './inventory.js'

/** Security ceiling shared with the UI catalog wire parser. Hosts may request a lower value. */
export const LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES = 8 * 1024 * 1024

/** `VirtualFileSystem.openMount` satisfies this port without exposing a native filesystem path. */
export type LocalizationVfsPort = ArtifactVfsPort

export interface LocalizationCatalogLike {
  readonly locale: string
  readonly namespace: string
}

export interface LocalizationCatalogParseOptions {
  readonly authorizedMessagePrefixes?: readonly string[]
  readonly fallbackCatalog?: Readonly<Record<string, string>>
}

export type LocalizationCatalogParser<Catalog extends LocalizationCatalogLike> = (
  value: unknown,
  options?: LocalizationCatalogParseOptions,
) => Catalog

export interface LocalizationMessagePrefixAuthorizationRequest {
  readonly ownerExtensionId: string
  readonly contributionId: string
  readonly catalogPath: string
  readonly locale: string
  /** Namespace read as an own JSON data property before the catalog parser is invoked. */
  readonly catalogNamespace: string
  /** Prefixes requested by the inert contribution manifest, never grants by themselves. */
  readonly requestedMessagePrefixes: readonly string[]
}

export type LocalizationMessagePrefixAuthorizer = (
  request: LocalizationMessagePrefixAuthorizationRequest,
) => readonly string[] | Promise<readonly string[]>

export interface LoadLocalizationCatalogsOptions<Catalog extends LocalizationCatalogLike> {
  readonly vfs: LocalizationVfsPort
  readonly parseCatalog: LocalizationCatalogParser<Catalog>
  /**
   * Optional host policy for broader namespaces. Its result is intersected with the manifest's
   * requested prefixes. Without a policy only the catalog namespace's own prefix is granted.
   */
  readonly authorizeMessagePrefixes?: LocalizationMessagePrefixAuthorizer
  readonly fallbackCatalog?: Readonly<Record<string, string>>
  readonly maxJsonBytes?: number
  /** Injectable for non-WebCrypto test/embedding environments; returns `sha256:<lowercase hex>`. */
  readonly digest?: (bytes: Uint8Array) => Promise<string>
  readonly signal?: AbortSignal
}

export interface LoadedLocalizationCatalogs<Catalog extends LocalizationCatalogLike> {
  readonly catalogs: readonly Catalog[]
  readonly diagnostics: readonly Diagnostic[]
}

interface Candidate {
  readonly extension: InventoryExtension
  readonly contribution: InventoryContribution
  readonly resource: LocalizationCatalogResourceV1Wire
}

const decoder = new TextDecoder('utf-8', { fatal: true })

function extensionCoordinate(extension: InventoryExtension): string {
  return `${extension.manifest.publisher}/${extension.manifest.id}`
}

function catalogPath(candidate: Candidate): readonly (string | number)[] {
  return Object.freeze([
    candidate.extension.source,
    candidate.contribution.path,
    candidate.resource.path,
  ])
}

function catalogDiagnostic(candidate: Candidate, message: string, data?: unknown): Diagnostic {
  return diagnostic(
    'warning',
    'x3.host/localization-catalog-refused',
    message,
    catalogPath(candidate),
    data,
  )
}

function candidatesFrom(inventory: Inventory): readonly Candidate[] {
  const candidates: Candidate[] = []
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      // Localization is deliberately data-only, so it is never executable/activationEligible.
      // The host's enable switches remain authoritative through their named inventory diagnostics.
      const disabled = contribution.diagnostics.some(
        item => item.code === CONTRIBUTION_DISABLED_CODE || item.code === EXTENSION_DISABLED_CODE,
      )
      if (!contribution.inventoryEligible || disabled) continue
      const manifest = contribution.manifest
      if (
        manifest?.contract.id !== LOCALIZATION_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1
      ) {
        continue
      }
      const spec = manifest.spec as unknown as LocalizationContributionSpecV1Wire
      for (const resource of spec.catalogs) candidates.push({ extension, contribution, resource })
    }
  }
  candidates.sort((left, right) => {
    const leftKey = `${extensionCoordinate(left.extension)}\0${left.contribution.manifest?.id ?? ''}\0${left.resource.path}\0${left.resource.locale}`
    const rightKey = `${extensionCoordinate(right.extension)}\0${right.contribution.manifest?.id ?? ''}\0${right.resource.path}\0${right.resource.locale}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  return Object.freeze(candidates)
}

function maximumJsonBytes(requested: number | undefined): number {
  if (requested === undefined) return LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new TypeError('localization maxJsonBytes must be a positive safe integer')
  }
  return Math.min(requested, LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES)
}

function namespaceOwnedMessagePrefix(namespace: string): string {
  const tail = namespace.split(/[./]/u).at(-1) ?? namespace
  const owner = tail.replace(/-(?:app|ui|localization|messages)$/u, '') || tail
  return `${owner}.`
}

function catalogNamespace(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, 'namespace')
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined
}

async function authorizedPrefixes(
  candidate: Candidate,
  document: unknown,
  authorizer: LocalizationMessagePrefixAuthorizer | undefined,
): Promise<readonly string[]> {
  const requested = Object.freeze([...candidate.resource.messagePrefixes])
  const namespace = catalogNamespace(document)
  if (namespace === undefined) {
    throw new TypeError('localization catalog namespace must be a string data property')
  }
  if (authorizer === undefined) {
    const owned = namespaceOwnedMessagePrefix(namespace)
    return Object.freeze(requested.filter(prefix => prefix === owned))
  }
  const contributionId = candidate.contribution.manifest?.id ?? candidate.contribution.path
  const granted = await authorizer(
    Object.freeze({
      ownerExtensionId: extensionCoordinate(candidate.extension),
      contributionId,
      catalogPath: candidate.resource.path,
      locale: candidate.resource.locale,
      catalogNamespace: namespace,
      requestedMessagePrefixes: requested,
    }),
  )
  if (!Array.isArray(granted)) throw new TypeError('message-prefix authorizer must return an array')
  const requestedSet = new Set(requested)
  return Object.freeze(
    [...new Set(granted)].filter(
      (prefix): prefix is string => typeof prefix === 'string' && requestedSet.has(prefix),
    ),
  )
}

function readCatalogBytes(
  candidate: Candidate,
  options: LoadLocalizationCatalogsOptions<LocalizationCatalogLike>,
  maxBytes: number,
): Promise<Uint8Array> {
  return readAttestedArtifactFile(candidate.contribution, candidate.resource.path, {
    vfs: options.vfs,
    maxBytes,
    label: 'localization catalog',
    ...(options.digest === undefined ? {} : { digest: options.digest }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * Load enabled localization catalogs through VFS, returning diagnostics instead of making one
 * broken optional language pack prevent the built-in English/Russian fallback from starting.
 */
export async function loadLocalizationCatalogs<Catalog extends LocalizationCatalogLike>(
  inventory: Inventory,
  options: LoadLocalizationCatalogsOptions<Catalog>,
): Promise<LoadedLocalizationCatalogs<Catalog>> {
  const maxBytes = maximumJsonBytes(options.maxJsonBytes)
  const catalogs: Catalog[] = []
  const diagnostics: Diagnostic[] = []
  for (const candidate of candidatesFrom(inventory)) {
    try {
      const bytes = await readCatalogBytes(
        candidate,
        options as LoadLocalizationCatalogsOptions<LocalizationCatalogLike>,
        maxBytes,
      )
      let document: unknown
      try {
        document = JSON.parse(decoder.decode(bytes)) as unknown
      } catch (error) {
        throw new TypeError(
          `localization catalog is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const prefixes = await authorizedPrefixes(
        candidate,
        document,
        options.authorizeMessagePrefixes,
      )
      if (prefixes.length === 0) {
        throw new TypeError('localization catalog was granted no requested message-key prefix')
      }
      const catalog = options.parseCatalog(document, {
        authorizedMessagePrefixes: prefixes,
        ...(options.fallbackCatalog === undefined
          ? {}
          : { fallbackCatalog: options.fallbackCatalog }),
      })
      if (catalog.locale.toLowerCase() !== candidate.resource.locale.toLowerCase()) {
        throw new TypeError(
          `catalog locale ${catalog.locale} does not match contribution locale ${candidate.resource.locale}`,
        )
      }
      catalogs.push(catalog)
    } catch (error) {
      diagnostics.push(
        catalogDiagnostic(
          candidate,
          `localization catalog «${candidate.resource.path}» was refused; built-in fallback remains active`,
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      )
    }
  }
  return Object.freeze({
    catalogs: Object.freeze(catalogs),
    diagnostics: Object.freeze(diagnostics),
  })
}
