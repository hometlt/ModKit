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
import {
  DEFAULT_VFS_LIMITS,
  normalizeVfsPath,
  type VfsMount,
  type VfsOpenOptions,
} from '@modkit/vfs'

import {
  CONTRIBUTION_DISABLED_CODE,
  EXTENSION_DISABLED_CODE,
  inventoryRecordFor,
  type Inventory,
  type InventoryContribution,
  type InventoryExtension,
} from './inventory.js'
import { resolveContainedEntrypoint } from './security/entrypoint.js'

/** Security ceiling shared with the UI catalog wire parser. Hosts may request a lower value. */
export const LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES = 8 * 1024 * 1024

export interface LocalizationVfsPort {
  /** `VirtualFileSystem.openMount` satisfies this port without exposing a native filesystem path. */
  openMount(uri: string, options?: VfsOpenOptions): Promise<VfsMount>
}

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

const encoder = new TextEncoder()
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

function confinedResourcePath(candidate: Candidate, artifactRoot: URL): string {
  const authored = candidate.resource.path
  if (authored.startsWith('/') || authored.startsWith('\\') || authored.includes('\\')) {
    throw new TypeError('localization catalog path must be a portable relative POSIX path')
  }
  const normalized = normalizeVfsPath(authored)
  if (normalized === '' || !normalized.toLowerCase().endsWith('.json')) {
    throw new TypeError('localization catalog path must identify a JSON file')
  }
  // URL resolution catches encoded traversal (`%2e%2e`) in addition to normalizeVfsPath's
  // literal `..` refusal. The returned URL is deliberately not handed to the catalog parser.
  resolveContainedEntrypoint(artifactRoot, normalized)
  return normalized
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('WebCrypto SHA-256 is unavailable')
  const digest = new Uint8Array(await subtle.digest('SHA-256', copy.buffer))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
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

async function readCatalogBytes(
  candidate: Candidate,
  options: LoadLocalizationCatalogsOptions<LocalizationCatalogLike>,
  maxBytes: number,
): Promise<Uint8Array> {
  const record = inventoryRecordFor(candidate.contribution)
  if (record === undefined)
    throw new TypeError('localization contribution has no trusted inventory record')
  const path = confinedResourcePath(candidate, record.artifactRoot)
  const expectedDigest = record.fileDigests?.[path]
  if (expectedDigest === undefined) {
    throw new TypeError(
      `localization catalog ${path} is absent from the attested artifact file map`,
    )
  }
  const mount = await options.vfs.openMount(record.artifactRoot.href, {
    limits: {
      // Opening an artifact mount may account all of its files (a model pack can legitimately be
      // much larger than one catalog), so retain the platform's artifact ceilings here. Exact
      // catalog size and all bytes actually read remain capped to the localization ceiling.
      maxEntries: DEFAULT_VFS_LIMITS.maxEntries,
      maxMaterializedBytes: DEFAULT_VFS_LIMITS.maxMaterializedBytes,
      maxFileBytes: DEFAULT_VFS_LIMITS.maxFileBytes,
      maxReadBytes: BigInt(LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES),
      maxReadRangeBytes: LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES,
      maxStreamBytes: DEFAULT_VFS_LIMITS.maxStreamBytes,
      maxPathBytes: Math.max(256, encoder.encode(path).byteLength),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    const node = await mount.stat(path, options.signal)
    if (node?.kind !== 'file') throw new TypeError(`localization catalog ${path} is not a file`)
    if (node.size !== undefined && node.size > BigInt(maxBytes)) {
      throw new TypeError(`localization catalog ${path} exceeds the ${maxBytes}-byte raw limit`)
    }
    const source = await mount.open(path, options.signal)
    try {
      const size = await source.size(options.signal)
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
        throw new TypeError(`localization catalog ${path} exceeds the ${maxBytes}-byte raw limit`)
      }
      const bytes = await source.readAt(0, size, options.signal)
      const actualDigest = await (options.digest ?? sha256)(bytes)
      if (actualDigest !== expectedDigest) {
        throw new TypeError(`localization catalog ${path} does not match its attested SHA-256`)
      }
      return bytes
    } finally {
      await source.dispose()
    }
  } finally {
    await mount.dispose()
  }
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
