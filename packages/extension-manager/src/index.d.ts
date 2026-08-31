import type { VfsMount, VfsProvider, VirtualFileSystem } from '@modkit/vfs'
import type {
  ContractRefWire,
  ContributionManifestV1Wire,
  ExtensionPresentation,
  ExtensionManifest,
  RelatedSubjectFact,
  SubjectFact,
  SubjectFactGroup,
  SubjectFactsSource,
  SubjectFactsSummary,
} from '@modkit/sdk'
import type { SourceRef, SubjectRef } from '@modkit/sdk/subjects'

export const EXTENSION_SUBJECT_KIND: 'modkit/extension'
export const CONTRIBUTION_SUBJECT_KIND: 'modkit/contribution'

export interface ExtensionSubjectProjectionMetadata {
  readonly displayName?: string
  readonly description?: string
  readonly homepage?: string
  readonly source?: string
  readonly trusted?: boolean
  /** Structured presentation overrides; direct legacy fields above remain supported. */
  readonly presentation?: ExtensionPresentation
}

export interface ExtensionContributionCardLink extends RelatedSubjectFact {
  readonly role: 'owns'
  readonly id: string
  readonly contract: ContractRefWire
  readonly contractKey: string
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
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
  readonly presentation?: ExtensionPresentation
  /** Function-free navigation records for the extension card's explicit contribution list. */
  readonly contributions: readonly ExtensionContributionCardLink[]
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
    readonly presentation?: ExtensionPresentation
    readonly contributions?: readonly ExtensionContributionCardLink[]
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
  readonly presentation?: ExtensionPresentation
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
  readonly presentation?: ExtensionPresentation
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
  readonly presentation?: ExtensionPresentation
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
  readonly presentation?: ExtensionPresentation
}

export interface ExtensionManagerSnapshot {
  readonly entries: readonly ExtensionManagerEntry[]
}

export interface GameSupportTarget {
  readonly packageId: string
  readonly displayName: string
  readonly availableVersion: string
  readonly installedVersion?: string
  readonly enabled: boolean
  readonly updateAvailable: boolean
  readonly trusted: boolean
  readonly desiredEnabled: true
}

export interface GameSupportInstallAction {
  readonly kind: 'install'
  readonly packageId: string
  readonly version: string
  readonly reversible: true
}

export interface GameSupportEnableAction {
  readonly kind: 'enable'
  readonly packageId: string
  readonly reversible: true
}

export interface GameSupportUpdateAction {
  readonly kind: 'update'
  readonly packageId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly reversible: false
}

export type GameSupportAction =
  GameSupportInstallAction | GameSupportEnableAction | GameSupportUpdateAction

export interface GameSupportBlocker {
  readonly packageId: string
  readonly code: string
  readonly message: string
}

export interface GameSupportPlan {
  readonly schemaVersion: 1
  readonly game: { readonly id: string; readonly displayName: string }
  readonly targets: readonly GameSupportTarget[]
  readonly actions: readonly GameSupportAction[]
  readonly blocked: readonly GameSupportBlocker[]
  readonly ready: boolean
}

export interface GameSupportErrorRecord {
  readonly name: string
  readonly message: string
  readonly code?: string
}

export interface GameSupportRollbackRecord {
  readonly packageId: string
  readonly kind: GameSupportAction['kind']
  readonly status: 'rolled-back' | 'not-reversible' | 'rollback-failed'
  readonly error?: GameSupportErrorRecord
}

export interface GameSupportApplyResult {
  readonly schemaVersion: 1
  readonly game: GameSupportPlan['game']
  readonly status: 'applied' | 'rolled-back' | 'partial'
  readonly applied: readonly GameSupportAction[]
  readonly failed?:
    | (GameSupportAction & { readonly error: GameSupportErrorRecord })
    | {
        readonly error: GameSupportErrorRecord
      }
  readonly rollback: readonly GameSupportRollbackRecord[]
}

/** Pure, deterministic projection over a snapshot; it never mutates or refreshes the catalog. */
export function createGameSupportPlan(
  snapshot: ExtensionManagerSnapshot,
  gameId: string,
): GameSupportPlan

export function gameSupportPlansEqual(left: unknown, right: unknown): boolean

export interface ExtensionManagerClient {
  snapshot(): Promise<ExtensionManagerSnapshot>
  refresh(): Promise<void>
  install(id: string, version?: string): Promise<void>
  update(id: string): Promise<void>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
}

/** Optional manager capability implemented by the shared client and usable by any application. */
export interface GameSupportExtensionManagerClient extends ExtensionManagerClient {
  planGameSupport(gameId: string): Promise<GameSupportPlan>
  applyGameSupport(plan: GameSupportPlan): Promise<GameSupportApplyResult>
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
): GameSupportExtensionManagerClient

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
