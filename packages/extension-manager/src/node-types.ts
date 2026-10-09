import type { KeyObject } from 'node:crypto'

import type { VirtualFileSystem } from '@modkit/vfs'
import type { NodeExtensionVfsOptions as ProviderNodeExtensionVfsOptions } from './providers-node.js'
import type {
  ArtifactAcquirer,
  ArtifactStore,
  CatalogSource,
  EnablementStore,
  ExtensionManagerClient,
  GameSupportExtensionManagerClient,
  InstalledExtensionRoot,
} from './index.js'
import type { ExtensionPresentation } from '@modkit/sdk'
export type * from './index.js'

export interface DiscoveredExtensionRoot {
  readonly path: string
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly source: string
  readonly protocol: string
  readonly materialized: boolean
}

export type NodeExtensionVfsOptions = ProviderNodeExtensionVfsOptions

export interface NodeExtensionDiscoveryOptions {
  readonly workspaceRoot?: string
  readonly configurationPath?: string
  readonly configuration?: unknown
  readonly environment?: Record<string, string | undefined>
  readonly profile?: string | undefined
  readonly cacheRoot?: string
  readonly lockPath?: string | undefined
  readonly enforceLock?: boolean
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
}

export interface LocalExtensionCandidateDiscoveryOptions {
  /** Directory below, at, or beside the nearest modkit.workspace.json. */
  readonly workspaceRoot?: string
  /** Explicit modkit.workspace.json path; takes precedence over workspaceRoot. */
  readonly configurationPath?: string
  readonly environment?: Record<string, string | undefined>
  readonly profile?: string | undefined
  readonly maxWorkspaceBytes?: number
  readonly maxSources?: number
  readonly maxExtensionsPerRepository?: number
  readonly maxDescriptorBytes?: number
  readonly maxPackageBytes?: number
  readonly maxContributionManifests?: number
  readonly maxContributionFileBytes?: number
  readonly maxContributionBytes?: number
}

export interface LocalExtensionCandidateDiagnostic {
  readonly severity: 'info' | 'error'
  readonly code: string
  readonly message: string
  readonly sourceId: string
  readonly path?: string
  readonly uri?: string
  readonly conflictingSourceId?: string
}

export interface LocalExtensionCandidate {
  readonly id: string
  readonly publisher: string
  readonly extensionId: string
  readonly version: string
  readonly packageName?: string
  readonly displayName: string
  readonly summary?: string
  readonly license?: string
  readonly homepage?: string
  readonly presentation?: ExtensionPresentation
  readonly contributionManifests: readonly string[]
  readonly contributions: readonly LocalContributionCandidate[]
  /** Non-fatal contribution inspection failures scoped to this extension. */
  readonly diagnostics: readonly LocalExtensionCandidateDiagnostic[]
  readonly sourceId: string
  readonly sourcePublisher?: string
  readonly enabled: boolean
  /** True when the source, entry and selected profile all include this extension. */
  readonly selected: boolean
  readonly embedded: boolean
  readonly relativePath?: string
  /** Confined local root. Missing for a portable embedded entry. */
  readonly root?: string
}

export interface LocalContributionCandidate {
  readonly id: string
  readonly displayName: string
  readonly contract: {
    readonly id: string
    readonly major: number
  }
  /** Confined extension-relative manifest path. */
  readonly path: string
  /** Frozen JSON document; extension code is never imported or evaluated. */
  readonly manifest: Readonly<Record<string, unknown>>
}

export interface LocalExtensionRepositoryCandidate {
  readonly sourceId: string
  readonly uri: string
  readonly root: string
  readonly descriptorPath: string
  readonly publisher?: string
  readonly enabled: boolean
  /** True when the source is included by the selected workspace profile. */
  readonly selected: boolean
  readonly packageName?: string
  readonly displayName: string
  readonly summary?: string
  readonly version?: string
  readonly license?: string
  readonly homepage?: string
  readonly extensions: readonly LocalExtensionCandidate[]
}

export interface LocalExtensionCandidateDiscovery {
  readonly configurationPath: string
  readonly workspaceRoot: string
  readonly profile?: string | undefined
  readonly repositories: readonly LocalExtensionRepositoryCandidate[]
  /** Flat deterministic view of every valid local extension candidate. */
  readonly extensions: readonly LocalExtensionCandidate[]
  readonly diagnostics: readonly LocalExtensionCandidateDiagnostic[]
}

/**
 * Inspect only local file repositories from the nearest workspace configuration. This function is
 * inert: it neither scans sibling directories recursively, executes extensions, materializes
 * artifacts, nor contacts network sources.
 */
export declare function discoverLocalExtensionCandidates(
  options?: LocalExtensionCandidateDiscoveryOptions,
): Promise<LocalExtensionCandidateDiscovery>

export declare function createNodeExtensionVfs(options?: NodeExtensionVfsOptions): {
  readonly vfs: VirtualFileSystem
  readonly protocols: readonly string[]
}
export declare function findWorkspaceConfigurationSync(
  start?: string,
  environment?: Record<string, string | undefined>,
): string
export declare function loadWorkspaceConfigurationSync(path: string): {
  readonly path: string
  readonly configuration: unknown
}
export declare function resolveConfiguredRepositoryRootSync(
  workspaceRoot: string,
  sourceId: string,
  environment?: Record<string, string | undefined>,
): string
export declare function configuredSourceDescriptorSync(
  workspaceRoot: string,
  sourceId: string,
  environment?: Record<string, string | undefined>,
): {
  readonly id: string
  readonly environment?: string
  readonly publisher?: string
  readonly root: string
  readonly sibling: string
}
export declare function resolveLegacyExtensionDirectorySync(
  workspaceRoot: string,
  parts: readonly string[],
  environment?: Record<string, string | undefined>,
): string
export declare function discoverNodeExtensionRoots(
  options?: NodeExtensionDiscoveryOptions,
): Promise<{
  readonly configurationPath: string
  readonly profile?: string | undefined
  readonly protocols: readonly string[]
  readonly lockPath?: string | undefined
  readonly roots: readonly DiscoveredExtensionRoot[]
  readonly hostRoots: readonly {
    readonly root: string
    readonly expectedId: string
  }[]
}>
export declare function extensionLockDocument(discovery: {
  readonly roots: readonly DiscoveredExtensionRoot[]
}): unknown
export declare function writeExtensionLock(
  discovery: {
    readonly roots: readonly DiscoveredExtensionRoot[]
    readonly lockPath?: string | undefined
  },
  path?: string,
): Promise<string>

export type NodeTrustedPublicKey = string | Uint8Array | KeyObject
export type NodeTrustedPublicKeys =
  Readonly<Record<string, NodeTrustedPublicKey>> | ReadonlyMap<string, NodeTrustedPublicKey>

export interface NodeCatalogSourceOptions {
  /** App-owned private state root. Must be absolute. */
  readonly root: string
  /** Local path, file URL, or HTTP(S) URL. */
  readonly source: string
  readonly baseDirectory?: string
  readonly trustedPublicKeys?: NodeTrustedPublicKeys
  /** Reject cached and refreshed catalogs unless their Ed25519 signature verifies against a trusted key. */
  readonly requireSignature?: boolean
  readonly fetch?: typeof globalThis.fetch
  /** HTTP(S) catalog origins allowed for the initial request and every redirect hop. */
  readonly allowedOrigins?: readonly string[]
  readonly maxBytes?: number
}

export declare function verifyExtensionCatalogSignature(
  catalog: unknown,
  trustedPublicKeys?: NodeTrustedPublicKeys,
): boolean
export declare function createNodeCatalogSource(options: NodeCatalogSourceOptions): CatalogSource

export interface NodeArtifactAcquirerOptions {
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
  readonly fetch?: typeof globalThis.fetch
  readonly maxBytes?: number
}

export interface NodeArtifactAcquirer extends ArtifactAcquirer {
  dispose(): Promise<void>
}

export declare function createNodeArtifactAcquirer(
  options?: NodeArtifactAcquirerOptions,
): NodeArtifactAcquirer

export interface NodeArtifactStoreOptions {
  /** App-owned private state root. Must be absolute. */
  readonly root: string
  readonly maxEntries?: number
  readonly maxMaterializedBytes?: number
  /** Decoded JSON ceiling, independent of transport and expanded embedded-file limits. */
  readonly maxRepositoryDocumentBytes?: number
}

export declare function createNodeArtifactStore(options: NodeArtifactStoreOptions): ArtifactStore
export declare function createNodeEnablementStore(options: {
  readonly root: string
}): EnablementStore

export interface CreateNodeExtensionManagerOptions {
  /** App-owned private state root. Must be absolute. */
  readonly root: string
  /** Required unless catalogSource is injected. */
  readonly catalog?: string
  readonly baseDirectory?: string
  readonly trustedPublicKeys?: NodeTrustedPublicKeys
  /** Forwarded to the default Node catalog source; ignored when catalogSource is injected. */
  readonly requireSignature?: boolean
  readonly fetch?: typeof globalThis.fetch
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
  readonly channels?: readonly ('stable' | 'preview' | 'development')[]
  readonly maxCatalogBytes?: number
  readonly maxArtifactBytes?: number
  /** Forwarded to the default managed store; custom stores own their decoding policy. */
  readonly maxRepositoryDocumentBytes?: number
  readonly maxEntries?: number
  readonly maxMaterializedBytes?: number
  readonly catalogSource?: CatalogSource
  readonly artifactAcquirer?: ArtifactAcquirer
  readonly artifactStore?: ArtifactStore
  readonly enablementStore?: EnablementStore
}

export interface NodeExtensionManager extends ExtensionManagerClient {
  readonly client: GameSupportExtensionManagerClient
  readonly catalogSource: CatalogSource
  readonly artifactAcquirer: ArtifactAcquirer
  readonly artifactStore: ArtifactStore
  readonly enablementStore: EnablementStore
  /** Flattened roots of installed packages whose package-level enablement is not false. */
  installedRoots(): Promise<readonly NodeInstalledExtensionRoot[]>
  dispose(): Promise<void>
}

export interface NodeInstalledExtensionRoot extends InstalledExtensionRoot {
  readonly root: string
}

export declare function createNodeExtensionManager(
  options: CreateNodeExtensionManagerOptions,
): NodeExtensionManager
