import type { VfsMount, VfsProvider, VirtualFileSystem } from '@modkitx-x3/vfs'
import type {
  ContractRefWire,
  ContributionManifestV1Wire,
  ExtensionManifest,
  RelatedSubjectFact,
  SubjectFact,
  SubjectFactGroup,
  SubjectFactsSource,
  SubjectFactsSummary,
} from '@modkitx-x3/sdk'
import type { SourceRef, SubjectRef } from '@modkitx-x3/sdk/subjects'

export const EXTENSION_SUBJECT_KIND: 'org.modkitx/extension'
export const CONTRIBUTION_SUBJECT_KIND: 'org.modkitx/contribution'

export interface ExtensionSubjectProjectionMetadata {
  readonly displayName?: string
  readonly description?: string
  readonly homepage?: string
  readonly source?: string
  readonly trusted?: boolean
}

export interface ExtensionSubjectProjectionInput {
  readonly extension: ExtensionManifest
  readonly contributions: readonly ContributionManifestV1Wire[]
  readonly metadata?: ExtensionSubjectProjectionMetadata
  /** Logical inventory source; paths are deliberately not subject identities. */
  readonly source?: SourceRef
  readonly workspace?: string
  readonly enabled?: boolean
  /** Direct contribution state. Effective state also includes the extension state. */
  readonly contributionEnablement?: Readonly<Record<string, boolean>>
}

export interface ExtensionSubjectRecord {
  readonly kind: typeof EXTENSION_SUBJECT_KIND
  readonly ref: SubjectRef
  readonly subjectId: string
  readonly id: string
  readonly displayName: string
  readonly version: string
  readonly enabled: boolean
  readonly manifest: ExtensionManifest
  /** Direct input for the host-owned generic subject card. */
  readonly facts: SubjectFactsSource
}

export interface ContributionSubjectRecord {
  readonly kind: typeof CONTRIBUTION_SUBJECT_KIND
  readonly ref: SubjectRef
  readonly subjectId: string
  readonly id: string
  readonly displayName: string
  readonly extensionId: string
  readonly contract: ContractRefWire
  /** Exact manifest contract coordinate (`id@major`), never a guessed category. */
  readonly contractKey: string
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
  readonly manifest: ContributionManifestV1Wire
  /** Direct input for the host-owned generic subject card. */
  readonly facts: SubjectFactsSource
}

export interface ExtensionContractGroup {
  readonly key: string
  readonly contract: ContractRefWire
  readonly contributions: readonly ContributionSubjectRecord[]
}

export interface ExtensionSubjectProjection {
  readonly extension: ExtensionSubjectRecord
  readonly contributions: readonly ContributionSubjectRecord[]
  readonly contractGroups: readonly ExtensionContractGroup[]
  readonly records: readonly (ExtensionSubjectRecord | ContributionSubjectRecord)[]
  subject(subjectId: string): ExtensionSubjectRecord | ContributionSubjectRecord | undefined
}

export interface ExtensionSubjectCardWireGroup extends SubjectFactGroup {
  readonly facts: readonly SubjectFact[]
}

export interface ExtensionSubjectCardWireDocument {
  readonly schemaVersion: 1
  readonly subject: {
    readonly kind: typeof EXTENSION_SUBJECT_KIND | typeof CONTRIBUTION_SUBJECT_KIND
    readonly subjectId: string
    readonly id: string
    readonly displayName: string
    readonly enabled: boolean
    readonly version?: string
    readonly extensionId?: string
    readonly contract?: ContractRefWire
    readonly contractKey?: string
    readonly effectiveEnabled?: boolean
  }
  readonly summary: SubjectFactsSummary
  readonly groups: readonly ExtensionSubjectCardWireGroup[]
  readonly relations: readonly RelatedSubjectFact[]
}

/**
 * Projects validated JSON manifests into presentation-neutral subjects and fact sources.
 * Contributions are grouped only by their exact declared contract; no codec entity is invented.
 */
export function projectExtensionSubjects(
  input: ExtensionSubjectProjectionInput,
): ExtensionSubjectProjection

/** Materializes one projected card as function-free JSON for Webview, worker and RPC boundaries. */
export function extensionSubjectRecordToWire(
  record: ExtensionSubjectRecord | ContributionSubjectRecord,
  signal?: AbortSignal,
): Promise<ExtensionSubjectCardWireDocument>

/** Restores the neutral facts ABI from an inert JSON card document. */
export function subjectFactsSourceFromWire(value: unknown): SubjectFactsSource

export interface ExtensionSourceDescriptor {
  readonly id: string
  readonly uri: string
  readonly environment?: string
  readonly descriptor?: string
  readonly publisher?: string
  readonly enabled: boolean
}

export interface ExtensionWorkspaceConfiguration {
  readonly schemaVersion: 1
  readonly sources: readonly ExtensionSourceDescriptor[]
  readonly profiles: Readonly<
    Record<
      string,
      {
        readonly sources?: readonly string[]
        readonly extensions?: readonly string[]
        readonly locked: boolean
      }
    >
  >
  readonly activeProfile?: string
  readonly lockFile?: string
  readonly legacyPaths: readonly {
    readonly prefix: readonly string[]
    readonly source: string
    readonly strip?: number
  }[]
}

export class ExtensionManagerError extends Error {
  readonly code: string
  readonly context: Readonly<Record<string, unknown>>
}

export interface ExtensionCatalogIssue {
  readonly path: string
  readonly message: string
}

export interface ExtensionCatalogSignature {
  readonly algorithm: 'Ed25519'
  readonly keyId: string
  readonly value: string
}

export interface ExtensionCatalogArtifactSource {
  readonly kind: 'repository' | 'bundle'
  readonly uri: string
  readonly integrity?: `sha256:${string}`
  readonly bytes?: number
  readonly trust: {
    readonly mode: 'local-user' | 'signed'
    readonly signature?: ExtensionCatalogSignature
  }
}

export interface ExtensionCatalogVersion {
  readonly version: string
  readonly channel: 'stable' | 'preview' | 'development'
  readonly source: ExtensionCatalogArtifactSource
  readonly extensions: readonly string[]
  readonly hostApi?: string
  readonly platforms?: readonly string[]
}

export interface ExtensionCatalogPackage {
  readonly id: string
  readonly publisher: string
  readonly displayName: string
  readonly summary: string
  readonly license?: string
  readonly homepage?: string
  readonly versions: readonly ExtensionCatalogVersion[]
}

export interface ExtensionRegistryCatalog {
  readonly $schema?: string
  readonly schemaVersion: 1
  readonly registryId: string
  readonly generatedAt: string
  readonly packages: readonly ExtensionCatalogPackage[]
  readonly signature?: ExtensionCatalogSignature
}

export function validateExtensionCatalog(value: unknown): readonly ExtensionCatalogIssue[]
export function parseExtensionCatalog(value: unknown): ExtensionRegistryCatalog
export function extensionCatalogSigningBytes(value: unknown): Uint8Array
export function compareCatalogVersions(left: string, right: string): -1 | 0 | 1
export function isRemoteCatalogUri(uri: unknown): boolean

export interface ExtensionCatalogCandidate {
  readonly id: string
  readonly displayName: string
  readonly publisher: string
  readonly version: string
  readonly channel: ExtensionCatalogVersion['channel']
  readonly summary: string
  readonly extensions: readonly string[]
  readonly source: ExtensionCatalogArtifactSource
  readonly catalogId: string
  readonly catalogSource: string
  readonly catalogSignature?: ExtensionCatalogSignature
  readonly signatureVerified: boolean
  readonly remote: boolean
  readonly trusted: boolean
}

export interface CatalogSourceResult {
  readonly catalog: unknown
  readonly source?: string
  /** True only after the adapter cryptographically verified catalog.signature. */
  readonly signatureVerified?: boolean
}

/** `cached` must be local and inert; only `refresh` may contact a registry. */
export interface CatalogSource {
  cached(): Promise<CatalogSourceResult | ExtensionRegistryCatalog | undefined>
  refresh(): Promise<CatalogSourceResult | ExtensionRegistryCatalog | undefined>
}

export interface AcquiredExtensionArtifact {
  readonly artifact: unknown
  /** Digest verified by the acquirer from the acquired bytes. */
  readonly integrity?: `sha256:${string}`
}

export interface ArtifactAcquirer {
  acquire(entry: ExtensionCatalogCandidate): Promise<AcquiredExtensionArtifact>
}

export interface InstalledExtensionRecord {
  readonly id: string
  readonly version: string
  readonly displayName?: string
  readonly publisher?: string
  readonly source?: string
  readonly trusted?: boolean
  readonly enabled?: boolean
  /** Every extension root contained in this installed distribution package. */
  readonly roots: readonly InstalledExtensionRoot[]
}

export interface InstalledExtensionRoot {
  /** Adapter-owned path, URL, OPFS key or browser handle. */
  readonly root: unknown
  readonly expectedId: string
}

export interface ArtifactStoreInstallRequest {
  readonly entry: ExtensionCatalogCandidate
  readonly artifact: unknown
  readonly integrity?: `sha256:${string}`
}

export interface ArtifactStore {
  list(): Promise<readonly InstalledExtensionRecord[]>
  install(request: ArtifactStoreInstallRequest): Promise<InstalledExtensionRecord>
  remove(id: string): Promise<void>
}

export interface ExtensionEnablementRecord {
  readonly id: string
  readonly enabled: boolean
}

export interface EnablementStore {
  list(): Promise<readonly ExtensionEnablementRecord[]>
  setEnabled(id: string, enabled: boolean): Promise<void>
  remove(id: string): Promise<void>
}

export interface ExtensionManagerEntry {
  readonly id: string
  readonly displayName: string
  readonly publisher: string
  readonly availableVersion: string
  readonly installedVersion?: string
  readonly enabled: boolean
  readonly updateAvailable: boolean
  readonly source: string
  readonly trusted: boolean
}

export interface ExtensionManagerSnapshot {
  readonly entries: readonly ExtensionManagerEntry[]
}

export interface ExtensionManagerClient {
  snapshot(): Promise<ExtensionManagerSnapshot>
  refresh(): Promise<void>
  install(id: string, version?: string): Promise<void>
  update(id: string): Promise<void>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
}

export interface CreateExtensionManagerClientOptions {
  readonly catalogSource: CatalogSource
  readonly artifactAcquirer: ArtifactAcquirer
  readonly artifactStore: ArtifactStore
  readonly enablementStore: EnablementStore
  readonly channels?: readonly ExtensionCatalogVersion['channel'][]
}

export function createExtensionManagerClient(
  options: CreateExtensionManagerClientOptions,
): ExtensionManagerClient

export function normalizeWorkspaceConfiguration(value: unknown): ExtensionWorkspaceConfiguration
export function normalizeRepositoryManifest(value: unknown): unknown
export function normalizeExtensionLock(value: unknown): unknown
export function createExtensionVfs(providers: readonly VfsProvider[]): {
  readonly vfs: VirtualFileSystem
  readonly protocols: readonly string[]
}
export function readMountBytes(
  mount: VfsMount,
  path?: string,
  signal?: AbortSignal,
): Promise<Uint8Array>
export function readMountJson(
  mount: VfsMount,
  path?: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; value: unknown }>
export function openRepositorySource(
  vfs: VirtualFileSystem,
  source: ExtensionSourceDescriptor,
  signal?: AbortSignal,
): Promise<unknown>
