import type { RevisionId } from './asset-capabilities/types.js'
import type { InputSearchScope } from './runtime-abi.js'
import type {
  LogicalResourceRequirement,
  ResourceProvenanceRecord,
  ResourceResolution,
  ResourceRole,
  ResourceUnresolvedReason,
} from './resource-session.js'

/** Selects a host-registered discovery policy, never a directory or namespace. */
export interface LogicalResourceDiscoveryRequest {
  readonly role: ResourceRole
  /** A literal suffix including the leading dot; compared case-insensitively. */
  readonly extension: string
  /** Requested duration ceiling; the host may narrow it further. */
  readonly timeoutMs?: number
}

export interface LogicalResourceCandidate {
  readonly logicalId: string
  readonly expectedRevision: RevisionId
  readonly size: bigint
  /** Opaque identity for provenance; conveys no root or namespace authority. */
  readonly rootId: string
  /**
   * Host-selected ordered lookup hints, never an access grant. The resource session still
   * enforces its served scopes. Omission preserves the consumer's workspace scope default.
   */
  readonly scopes?: readonly InputSearchScope[]
}

export interface LogicalResourceDiscoveryReceipt {
  readonly complete: boolean
  readonly pages: number
  readonly entries: number
  readonly candidates: number
  readonly bytes: bigint
}

/** Host-attested naming context in the same logical namespace as the returned candidates. */
export interface LogicalResourceDiscoveryIdentity {
  readonly primaryLogicalId: string
  readonly rootId?: string
}

export type LogicalResourceDiscoveryRefusal =
  | 'budget-exceeded'
  | 'namespace-invalid'
  | 'size-unavailable'
  | 'request-invalid'
  | 'request-unsupported'
  | 'context-unavailable'
  | 'permission-missing'
  | 'deadline-exceeded'

export type LogicalResourceDiscoveryResult =
  | {
      readonly state: 'complete'
      readonly candidates: readonly LogicalResourceCandidate[]
      readonly receipt: LogicalResourceDiscoveryReceipt
      readonly context?: LogicalResourceDiscoveryIdentity
    }
  | {
      readonly state: 'refused'
      readonly reason: LogicalResourceDiscoveryRefusal
      readonly message: string
      /** Discovery is all-or-nothing; a refusal never publishes partial candidates. */
      readonly candidates: readonly []
      readonly receipt: LogicalResourceDiscoveryReceipt
    }

export interface LogicalResourceReadBatchItem {
  readonly requirement: LogicalResourceRequirement
  readonly expectedRevision?: RevisionId
  readonly size?: bigint
}

export interface LogicalResourceReadBatchRequest {
  readonly items: readonly LogicalResourceReadBatchItem[]
  readonly concurrency: number
  readonly readTimeoutMs: number
  readonly totalTimeoutMs: number
  /** Includes all returned buffers, not just concurrent reads. The host budget still applies. */
  readonly maxBytes: bigint
}

export type LogicalResourceReadOutcome =
  | {
      readonly state: 'read'
      readonly bytes: Uint8Array
      readonly revision: RevisionId
      readonly provenance: ResourceProvenanceRecord
    }
  | {
      readonly state: 'unresolved'
      readonly reason:
        ResourceUnresolvedReason | 'deadline-exceeded' | 'read-failed' | 'size-mismatch'
      readonly message: string
      readonly provenance?: ResourceProvenanceRecord
    }

export type LogicalResourceReadBatchResult =
  | {
      readonly state: 'complete'
      /** One terminal outcome per request, in request order rather than completion order. */
      readonly items: readonly LogicalResourceReadOutcome[]
      readonly bytes: bigint
    }
  | {
      readonly state: 'refused'
      readonly reason:
        ResourceUnresolvedReason | 'request-invalid' | 'context-unavailable' | 'deadline-exceeded'
      readonly message: string
      /** Stale authority or global limits discard the complete staged batch. */
      readonly items: readonly []
      readonly bytes: bigint
    }

/**
 * Optional subject-bound consumer port. Inactive during Codec.open; active before the first
 * descriptor is requested. Resolution leases expose bounded byte sources only. The host owns
 * resource-session disposal and discovery policy; neither crosses this boundary.
 */
export interface LogicalResourcePort {
  /**
   * Host-owned staged reads. The host clamps durations and concurrency, snapshots all input before
   * yielding and releases leases itself. Candidate revision/size mismatch, revoked authority or a
   * combined budget failure discards every staged source. Per-item failure/deadline stays indexed;
   * caller cancellation rejects. A timed-out backend may still run: its slot and allocation remain
   * reserved until cleanup actually settles, including across subsequent batches on this subject.
   */
  readBatch(
    request: LogicalResourceReadBatchRequest,
    signal?: AbortSignal,
  ): Promise<LogicalResourceReadBatchResult>
  discover(
    request: LogicalResourceDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<LogicalResourceDiscoveryResult>
  resolve(
    requirement: LogicalResourceRequirement,
    signal?: AbortSignal,
  ): Promise<ResourceResolution>
  provenance(signal?: AbortSignal): Promise<readonly ResourceProvenanceRecord[]>
  /**
   * Where the opened subject itself sits, attested by the host, in the namespace `resolve` reads:
   * for an entry of a container its path inside the container, for a loose file its name in its
   * directory. A codec whose references are engine paths (Unreal `/Game/...`) maps them onto that
   * naming itself; undefined when the subject has no readable origin.
   */
  identity?(signal?: AbortSignal): Promise<LogicalResourceDiscoveryIdentity | undefined>
}
