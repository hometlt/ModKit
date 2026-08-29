import type { KeyObject } from 'node:crypto'

import type { VirtualFileSystem, VfsLimits } from '@modkitx-x3/vfs'
import type {
  ArtifactAcquirer,
  ArtifactStore,
  CatalogSource,
  EnablementStore,
  ExtensionManagerClient,
  InstalledExtensionRoot,
} from './index.js'
export * from './index.js'

export interface DiscoveredExtensionRoot {
  readonly path: string
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly source: string
  readonly protocol: string
  readonly materialized: boolean
}

export interface NodeExtensionVfsOptions {
  readonly limits?: Partial<VfsLimits>
  readonly memoryEntries?: Readonly<Record<string, Uint8Array>>
  readonly memoryAuthority?: string
  readonly browserFiles?: Readonly<Record<string, unknown>>
  readonly browserFileResolve?: (uri: string) => unknown
  readonly fetch?: unknown
  readonly allowedOrigins?: readonly string[]
  readonly rapidPoolRoot?: string
}

export interface NodeExtensionDiscoveryOptions {
  readonly workspaceRoot?: string
  readonly configurationPath?: string
  readonly configuration?: unknown
  readonly environment?: Record<string, string | undefined>
  readonly profile?: string
  readonly cacheRoot?: string
  readonly lockPath?: string
  readonly enforceLock?: boolean
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
}

export function createNodeExtensionVfs(options?: NodeExtensionVfsOptions): {
  readonly vfs: VirtualFileSystem
  readonly protocols: readonly string[]
}
export function findWorkspaceConfigurationSync(
  start?: string,
  environment?: Record<string, string | undefined>,
): string
export function loadWorkspaceConfigurationSync(path: string): {
  readonly path: string
  readonly configuration: unknown
}
export function resolveConfiguredRepositoryRootSync(
  workspaceRoot: string,
  sourceId: string,
  environment?: Record<string, string | undefined>,
): string
export function configuredSourceDescriptorSync(
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
export function resolveLegacyExtensionDirectorySync(
  workspaceRoot: string,
  parts: readonly string[],
  environment?: Record<string, string | undefined>,
): string
export function discoverNodeExtensionRoots(options?: NodeExtensionDiscoveryOptions): Promise<{
  readonly configurationPath: string
  readonly profile?: string
  readonly protocols: readonly string[]
  readonly lockPath?: string
  readonly roots: readonly DiscoveredExtensionRoot[]
  readonly hostRoots: readonly {
    readonly root: string
    readonly expectedId: string
  }[]
}>
export function extensionLockDocument(discovery: {
  readonly roots: readonly DiscoveredExtensionRoot[]
}): unknown
export function writeExtensionLock(
  discovery: {
    readonly roots: readonly DiscoveredExtensionRoot[]
    readonly lockPath?: string
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
  readonly fetch?: typeof globalThis.fetch
  /** HTTP(S) catalog origins allowed for the initial request and every redirect hop. */
  readonly allowedOrigins?: readonly string[]
  readonly maxBytes?: number
}

export function verifyExtensionCatalogSignature(
  catalog: unknown,
  trustedPublicKeys?: NodeTrustedPublicKeys,
): boolean
export function createNodeCatalogSource(options: NodeCatalogSourceOptions): CatalogSource

export interface NodeArtifactAcquirerOptions {
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
  readonly fetch?: typeof globalThis.fetch
  readonly maxBytes?: number
}

export interface NodeArtifactAcquirer extends ArtifactAcquirer {
  dispose(): Promise<void>
}

export function createNodeArtifactAcquirer(
  options?: NodeArtifactAcquirerOptions,
): NodeArtifactAcquirer

export interface NodeArtifactStoreOptions {
  /** App-owned private state root. Must be absolute. */
  readonly root: string
  readonly maxEntries?: number
  readonly maxMaterializedBytes?: number
}

export function createNodeArtifactStore(options: NodeArtifactStoreOptions): ArtifactStore
export function createNodeEnablementStore(options: { readonly root: string }): EnablementStore

export interface CreateNodeExtensionManagerOptions {
  /** App-owned private state root. Must be absolute. */
  readonly root: string
  /** Required unless catalogSource is injected. */
  readonly catalog?: string
  readonly baseDirectory?: string
  readonly trustedPublicKeys?: NodeTrustedPublicKeys
  readonly fetch?: typeof globalThis.fetch
  readonly vfs?: VirtualFileSystem | { readonly vfs: VirtualFileSystem }
  readonly vfsOptions?: NodeExtensionVfsOptions
  readonly channels?: readonly ('stable' | 'preview' | 'development')[]
  readonly maxCatalogBytes?: number
  readonly maxArtifactBytes?: number
  readonly maxEntries?: number
  readonly maxMaterializedBytes?: number
  readonly catalogSource?: CatalogSource
  readonly artifactAcquirer?: ArtifactAcquirer
  readonly artifactStore?: ArtifactStore
  readonly enablementStore?: EnablementStore
}

export interface NodeExtensionManager extends ExtensionManagerClient {
  readonly client: ExtensionManagerClient
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

export function createNodeExtensionManager(
  options: CreateNodeExtensionManagerOptions,
): NodeExtensionManager
