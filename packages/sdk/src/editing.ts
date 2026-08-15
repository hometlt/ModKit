import type { Diagnostic, UInt64String } from '@modkitx-x3/core'
import type { DataSourceRef, DataSourceRefWire, Lease } from './asset-capabilities/data-sources.js'
import type {
  AssetOperationId,
  AssetSourceRef,
  JsonValue,
  ResolvedAssetDescriptor,
  RevisionId,
} from './asset-capabilities/types.js'
import type { ConformanceProfileId } from './asset-capabilities/data-sources.js'
import type { HostId } from './manifest/contribution-spec-types.js'
import type { PermissionClass } from './manifest/contribution-types.js'
import type { ServiceProviderContributionSpecV1 } from './manifest/contribution-spec-types.js'
import type { ServiceProviderModule } from './runtime-abi.js'
import type { ViewerSources } from './asset-capabilities/presentation.js'

declare const DERIVED_WRITE_SET_BRAND: unique symbol
declare const GRANT_SNAPSHOT_BRAND: unique symbol
declare const PREPARED_COMMIT_BRAND: unique symbol

export interface AssetRevision {
  readonly bindings: Readonly<Record<string, RevisionId>>
  readonly namespaceRevision?: RevisionId
  readonly compositionFingerprint: string
}

export interface SubjectEditTarget {
  readonly targetId: string
  readonly subjectUri: string
  readonly ownerSource: AssetSourceRef
  readonly semanticPath: readonly string[]
  readonly expectedRevision: AssetRevision
}

export interface PayloadChunkRequest {
  readonly cursor?: string
  readonly maxBytes: number
}

export type PayloadChunk =
  | { readonly complete: true; readonly bytes: Uint8Array }
  | { readonly complete: false; readonly bytes: Uint8Array; readonly nextCursor: string }

export interface PayloadReader {
  read(request: PayloadChunkRequest, signal?: AbortSignal): Promise<PayloadChunk>
}

export interface StagedPayloadRef {
  readonly storeId: string
  readonly handleId: string
  readonly digest: string
  readonly bytes: bigint
  readonly replayable: true
  readonly expiresAt?: string
}

export interface PayloadStore {
  open(ref: StagedPayloadRef, signal?: AbortSignal): Promise<Lease<PayloadReader>>
}

export type EditPayload =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'inline'; readonly bytes: Uint8Array }
  | { readonly kind: 'staged'; readonly ref: StagedPayloadRef }

export type EditRange =
  | { readonly kind: 'bytes'; readonly offset: bigint; readonly length: bigint }
  | { readonly kind: 'utf16'; readonly offset: number; readonly length: number }

export type SourceEdit =
  | {
      readonly operation: 'replace'
      readonly targetId: string
      readonly source: AssetSourceRef
      readonly range?: EditRange
      readonly payload: EditPayload
      readonly label?: string
    }
  | {
      readonly operation: 'create'
      readonly targetId: string
      readonly source: AssetSourceRef
      readonly newPath: string
      readonly payload: EditPayload
      readonly label?: string
    }
  | {
      readonly operation: 'delete'
      readonly targetId: string
      readonly source: AssetSourceRef
      readonly label?: string
    }
  | {
      readonly operation: 'rename'
      readonly targetId: string
      readonly source: AssetSourceRef
      readonly newPath: string
      readonly label?: string
    }

export interface ChangeSet {
  readonly targets: readonly SubjectEditTarget[]
  readonly edits: readonly SourceEdit[]
  readonly semanticIntent?: JsonValue
  readonly provenance: {
    readonly actor: 'user' | 'automation' | 'agent'
    readonly note?: string
  }
}

export type MutationMode = 'export-only' | 'mutate'
export type CommitGuarantee = 'atomic' | 'transactional' | 'recoverable' | 'best-effort'

export interface TransactionSemantics {
  readonly mutationMode: MutationMode
  readonly minimumGuarantee: CommitGuarantee
}

export type RoundTrip = 'byte-identical' | 'semantic' | 'lossy' | 'none'

export type FidelityClaim =
  | {
      readonly roundTrip: 'byte-identical'
      readonly preservesUnknownData: true
      readonly notes?: readonly string[]
    }
  | {
      readonly roundTrip: 'semantic'
      readonly preservesUnknownData: boolean
      readonly notes?: readonly string[]
    }
  | {
      readonly roundTrip: 'lossy' | 'none'
      readonly preservesUnknownData: false
      readonly notes?: readonly string[]
    }

export interface WriterIdentity {
  readonly providerId: string
  readonly providerVersion: string
  readonly artifactDigest: string
  readonly formatId: string
  readonly representationId: string
}

export type FidelityEvidence = FidelityClaim & {
  readonly evidenceId: string
  readonly corpusId: string
  readonly corpusDigest: string
  readonly conformanceProfile: ConformanceProfileId
  readonly writer: WriterIdentity
  readonly optionsFingerprint: string
  readonly inputClass: string
  readonly provenAt: string
}

export interface AssetEditPlan {
  readonly planId: string
  readonly targets: readonly SubjectEditTarget[]
  readonly edits: readonly SourceEdit[]
  readonly semantics: TransactionSemantics
  readonly fidelity: FidelityClaim
  readonly diagnostics: readonly Diagnostic[]
}

export interface WriteSetEntry {
  readonly targetId: string
  readonly source: AssetSourceRef
  readonly backendId: string
  readonly mode: 'in-place' | 'create' | 'delete' | 'rename'
  readonly normalizedPath?: string
}

export interface DerivedWriteSet {
  readonly entries: readonly WriteSetEntry[]
  readonly digest: string
  readonly [DERIVED_WRITE_SET_BRAND]: true
}

export interface BackendCapability {
  readonly backendId: string
  readonly guarantees: readonly CommitGuarantee[]
  readonly supportsPrepare: boolean
  readonly supportsRollback: boolean
  readonly supportsJournal: boolean
  readonly supportsRename: boolean
}

export interface GrantSnapshot {
  readonly snapshotId: string
  readonly permissions: readonly PermissionClass[]
  readonly sourceIds: readonly string[]
  readonly [GRANT_SNAPSHOT_BRAND]: true
}

export interface CommitAuthorization {
  readonly requiredPermissions: readonly PermissionClass[]
  readonly granted: boolean
  readonly achievableGuarantee: CommitGuarantee
  readonly missing: readonly PermissionClass[]
  readonly scopeSatisfied: boolean
}

export interface PermissionDeriver {
  derive(args: {
    readonly edits: readonly SourceEdit[]
    readonly backends: ReadonlyMap<string, BackendCapability>
    readonly grant: GrantSnapshot
  }): { readonly writeSet: DerivedWriteSet; readonly authorization: CommitAuthorization }
}

export interface PreparedCommit {
  readonly preparedId: string
  readonly plan: AssetEditPlan
  readonly planDigest: string
  readonly writeSet: DerivedWriteSet
  readonly authorization: CommitAuthorization
  readonly preparedRevisionFingerprint: string
  readonly fidelity: FidelityEvidence
  readonly [PREPARED_COMMIT_BRAND]: true
}

export interface SourceConflict {
  readonly targetId: string
  readonly expected: AssetRevision
  readonly actual: AssetRevision
}

export type UndoGuarantee = 'inverse' | 'snapshot' | 'replay' | 'none'
export type TransactionStatus = 'committed' | 'partially-applied' | 'rolled-back' | 'not-applied'

export interface BindingWriteResult {
  readonly targetId: string
  readonly source: AssetSourceRef
  readonly state: 'applied' | 'failed' | 'rolled-back' | 'not-applied'
  readonly diagnosticIds: readonly string[]
}

export interface RecoveryRef {
  readonly kind: 'journal' | 'staging'
  readonly ref: string
  readonly digest: string
}

export interface CommitReceipt {
  readonly transactionId: string
  readonly committedAt: string
  readonly mutationMode: MutationMode
  readonly commitGuarantee: CommitGuarantee
  readonly status: TransactionStatus
  readonly undo: UndoGuarantee
  readonly before: readonly AssetRevision[]
  readonly after: readonly AssetRevision[]
  readonly writes: readonly BindingWriteResult[]
  readonly recovery?: RecoveryRef
  readonly fidelity: FidelityEvidence
}

export type CommitRejection =
  | 'stale-revision'
  | 'permission-missing'
  | 'write-scope-mismatch'
  | 'guarantee-unachievable'
  | 'fidelity-unproven'
  | 'confirmation-required'
  | 'payload-unavailable'
  | 'plan-invalid'
  | 'source-read-only'
  | 'cancelled'

export type PrepareCommitResult =
  | { readonly state: 'ready'; readonly prepared: PreparedCommit }
  | { readonly state: 'conflict'; readonly conflicts: readonly SourceConflict[] }
  | {
      readonly state: 'rejected'
      readonly reason: CommitRejection
      readonly diagnostics: readonly Diagnostic[]
    }

export type CommitResult =
  | {
      readonly state: 'committed'
      readonly receipt: CommitReceipt & { readonly status: 'committed' }
    }
  | {
      readonly state: 'not-applied'
      readonly reason: CommitRejection
      readonly conflicts?: readonly SourceConflict[]
      readonly diagnostics: readonly Diagnostic[]
    }
  | {
      readonly state: 'rolled-back'
      readonly receipt: CommitReceipt & { readonly status: 'rolled-back' }
    }
  | {
      readonly state: 'partially-applied'
      readonly receipt: CommitReceipt & {
        readonly status: 'partially-applied'
        readonly recovery: RecoveryRef
      }
    }

export interface CommitCoordinator {
  prepare(
    plan: AssetEditPlan,
    options: {
      readonly grant: GrantSnapshot
      readonly confirmationToken?: string
      readonly signal?: AbortSignal
    },
  ): Promise<PrepareCommitResult>
  commit(
    prepared: PreparedCommit,
    options: {
      readonly grant: GrantSnapshot
      readonly signal?: AbortSignal
      readonly onProgress?: (done: number) => void
    },
  ): Promise<CommitResult>
  undo(
    transactionId: string,
    options: { readonly grant: GrantSnapshot; readonly signal?: AbortSignal },
  ): Promise<CommitResult>
  redo(
    transactionId: string,
    options: { readonly grant: GrantSnapshot; readonly signal?: AbortSignal },
  ): Promise<CommitResult>
}

export interface WriterRequirement {
  readonly formatId: string
  readonly representationId: string
  readonly mutationMode: MutationMode
  readonly minimumRoundTrip: RoundTrip
}

export interface WriterOffer extends WriterRequirement {
  readonly providerId: string
  readonly fidelityEvidenceId: string
}

export interface ValidationResult {
  readonly valid: boolean
  readonly diagnostics: readonly Diagnostic[]
}

export interface Writer {
  readonly identity: WriterIdentity
  readonly offer: WriterOffer
  validate(change: ChangeSet, signal?: AbortSignal): Promise<ValidationResult>
  plan(change: ChangeSet, signal?: AbortSignal): Promise<AssetEditPlan>
}

declare module './service-contracts.js' {
  interface ContractMap {
    'common.edit/writer': { 1: Writer }
  }
  interface ContractRequestMap {
    'common.edit/writer': { 1: { presence: 'required'; facet: WriterRequirement } }
  }
  interface ContractOfferMap {
    'common.edit/writer': { 1: { presence: 'required'; facet: WriterOffer } }
  }
}

declare module './runtime-abi.js' {
  interface OperationOutputMap {
    'edit-plan': { readonly kind: 'edit-plan'; readonly plan: AssetEditPlan }
    transaction: { readonly kind: 'transaction'; readonly receipt: CommitReceipt }
  }
}

export type WriterProviderContributionSpec = ServiceProviderContributionSpecV1<'common.edit/writer'>
export type WriterModule = ServiceProviderModule<'common.edit/writer', 1>

export interface EditorContributionSpecV1Base<
  Operation extends string,
  Source extends DataSourceRef | DataSourceRefWire,
  MaximumBytes extends string,
> {
  readonly sessionModel: 'single-subject' | 'multi-subject' | 'workspace'
  readonly selectionKinds: readonly string[]
  readonly semanticLocationKinds: readonly string[]
  readonly requiresTransactions: boolean
  readonly requiresOperations: readonly Operation[]
  readonly consumesDataSources: readonly Source[]
  readonly writer: WriterRequirement
  readonly hosts?: readonly HostId[]
  readonly priority: number
  readonly scaleLimits?: {
    readonly maximumSubjects?: number
    readonly maximumRows?: number
    readonly maximumSourceBytes?: MaximumBytes
  }
}

export type EditorContributionSpecV1 = EditorContributionSpecV1Base<
  AssetOperationId,
  DataSourceRef,
  UInt64String
>
export type EditorContributionSpecV1Wire = EditorContributionSpecV1Base<
  string,
  DataSourceRefWire,
  string
>

export type EditSessionState = 'live' | 'stale-revision' | 'committing' | 'disposed'

export interface EditSession {
  readonly revision: AssetRevision
  readonly targets: readonly SubjectEditTarget[]
  state(): EditSessionState
  propose(change: ChangeSet): Promise<ValidationResult>
  plan(change: ChangeSet): Promise<AssetEditPlan>
  dispose(): Promise<void>
}

export interface EditAuthorization {
  readonly grant: GrantSnapshot
  readonly confirmationToken?: string
}

/** Host-owned user/automation authorization boundary used by editor UI modules. */
export interface EditAuthorizationPort {
  request(
    plan: AssetEditPlan,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EditAuthorization | undefined>
}

export interface EditorMount {
  update(args: {
    readonly descriptor: ResolvedAssetDescriptor
    readonly revision: AssetRevision
  }): Promise<void>
  unmount(): Promise<void>
}

export interface EditorModule {
  readonly abiVersion: 1
  mount(args: {
    readonly container: unknown
    readonly descriptor: ResolvedAssetDescriptor
    readonly edit: EditSession
    readonly commit: CommitCoordinator
    readonly payloads: PayloadStore
    readonly sources: ViewerSources
    readonly authorization: EditAuthorizationPort
    readonly signal?: AbortSignal
  }): Promise<EditorMount>
}
