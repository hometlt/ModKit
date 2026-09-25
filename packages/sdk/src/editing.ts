import { canonicalJsonStringify, deepFreeze, type Diagnostic, type UInt64String } from '@modkit/core'
import { revisionIdFromRef } from './asset-capabilities/types.js'
import type { SurfaceOf } from './asset-capabilities/data-source-surfaces.js'
import type { DataSourceSurfaceV1 } from './definitions.js'
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

/** Bytes accepted by a host-owned staging store without requiring one contiguous allocation. */
export type PayloadSource = Uint8Array | AsyncIterable<Uint8Array>

export interface StagePayloadOptions {
  readonly expiresAt?: string
}

/** Producer and lifecycle side of a host-owned staged-payload store. */
export interface PayloadStagingStore extends PayloadStore {
  stage(
    source: PayloadSource,
    options?: StagePayloadOptions,
    signal?: AbortSignal,
  ): Promise<StagedPayloadRef>
  verify(ref: StagedPayloadRef, signal?: AbortSignal): Promise<boolean>
  release(ref: StagedPayloadRef): Promise<void>
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
  /** Source snapshots used by this change. Targets without edits are read dependencies:
   * the host checks their revisions, but they add neither writes nor write guarantees. */
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
  /** Drop one undo/redo entry and release payloads retained only by that history entry. */
  discardHistory(transactionId: string): Promise<boolean>
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
  plan(change: ChangeSet, signal?: AbortSignal): Promise<AssetEditPlan>
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

// ---------------------------------------------------------------------------------------------
// ADR-HOST-002: `common.edit/writer@1` as a standard contract of the platform — its method
// surface (pinned to `Writer`) and the deterministic facet rule every host matcher applies.

export const WRITER_CONTRACT_ID = 'common.edit/writer' as const
export type WriterContractId = typeof WRITER_CONTRACT_ID

/** Matcher profile id the standard writer definition selects (host-trusted code, never injected). */
export const WRITER_FACET_MATCHER_PROFILE = 'modkit/writer-facet-matcher' as const

/**
 * How a writer object is called across an execution boundary: `validate`/`plan` carry the
 * change set by value with the signal appended; `identity` and `offer` travel as handle data so a
 * consumer can read them without a round trip. Pinned to the ABI interface at compile time.
 */
const writerSurface = {
  fields: ['identity', 'offer'],
  methods: {
    validate: { kind: 'value', signal: 'last', arity: 1 },
    plan: { kind: 'value', signal: 'last', arity: 1 },
  },
} as const satisfies SurfaceOf<Writer> & { readonly fields: readonly string[] }

export const WRITER_SURFACE: typeof writerSurface = deepFreeze(writerSurface)

export const STANDARD_EDITING_SURFACES: Readonly<Record<WriterContractId, DataSourceSurfaceV1>> =
  deepFreeze({ [WRITER_CONTRACT_ID]: WRITER_SURFACE })

/** Stronger round trips satisfy weaker requirements. */
export const ROUND_TRIP_RANK: Readonly<Record<RoundTrip, number>> = Object.freeze({
  'byte-identical': 3,
  semantic: 2,
  lossy: 1,
  none: 0,
})

/**
 * The writer facet rule (ADR-HOST-002 §3): same format and representation, an offer that
 * mutates also serves an export-only request, and the offer's round trip must be at least the
 * requested one. Pure and deterministic; the host matcher profile wraps it.
 */
export function writerOfferSatisfies(request: WriterRequirement, offer: WriterOffer): boolean {
  return (
    request.formatId === offer.formatId &&
    request.representationId === offer.representationId &&
    (request.mutationMode === 'export-only' || offer.mutationMode === 'mutate') &&
    ROUND_TRIP_RANK[offer.minimumRoundTrip] >= ROUND_TRIP_RANK[request.minimumRoundTrip]
  )
}

/** Canonical, non-secret selection key of a matched writer request (safe for policy locks). */
export function writerSelectionKey(request: WriterRequirement): string {
  return `writer:${request.formatId}:${request.representationId}:${request.mutationMode}:${request.minimumRoundTrip}`
}

/**
 * The revision of one entry of a container or directory namespace: the container's revision, the
 * entry and its size. A nested subject opened from the entry, an edit target naming it and the file
 * backend's conditional-write check all use this one rule.
 */
export function containerEntryRevision(
  containerRevision: RevisionId,
  entryId: string,
  byteLength: number | bigint,
): RevisionId {
  // through the ref builder, not by string concatenation: a revision id is a kind-tagged token
  // whose value is percent-encoded, and the container's own revision is itself one of those
  return revisionIdFromRef({
    kind: 'provider-token',
    value: `${String(containerRevision)}!${entryId}:${byteLength}`,
  })
}

/**
 * The edit target of one file inside a directory-namespace subject, at the namespace revision it
 * was opened at: `root.uri?vfs-path=<path>`, pinned by {@link containerEntryRevision}. The host
 * accepts it in a plan for that subject; the file backend re-derives the same revision at commit.
 */
export function namespaceEntryEditTarget(input: {
  readonly subjectUri: string
  readonly root: AssetSourceRef
  readonly namespaceRevision: RevisionId
  readonly entry: { readonly path: string; readonly size: number | bigint }
}): SubjectEditTarget {
  const url = new URL(input.root.uri)
  url.search = ''
  url.hash = ''
  url.searchParams.set('vfs-path', input.entry.path)
  const source: AssetSourceRef = { id: url.href, uri: url.href, parentIds: [input.root.id] }
  const revision = containerEntryRevision(input.namespaceRevision, input.entry.path, input.entry.size)
  return deepFreeze({
    targetId: source.id,
    subjectUri: input.subjectUri,
    ownerSource: source,
    semanticPath: [],
    expectedRevision: {
      bindings: { [source.id]: revision },
      namespaceRevision: input.namespaceRevision,
      compositionFingerprint: canonicalJsonStringify({
        topology: 'single',
        bindingId: source.id,
        source: { id: source.id, uri: source.uri },
        revision,
      }),
    },
  })
}
