/**
 * The post-open, host-owned resource session (block 11, slice 11C0, plan item 13).
 *
 * Block 9 froze the *pre-open* input seam: a codec declares `AssetInputRequirement`s, the host
 * resolves them before `Codec.open`, and the resulting `AssetInput` is immutable for the life of
 * the session. That seam is deliberately not reopened here. What it cannot serve is the reference
 * a projection only discovers *after* opening — a texture named inside a model's own data, whose
 * name nobody knew when the input plan was written.
 *
 * This port serves exactly that, and is a different thing from `AssetInput` in the way that
 * matters: it has its own lease and revision lifecycle. An `AssetInput` binding is pinned for the
 * session; a resource lease is taken, held and released independently, many times, while the
 * session stays open. Making it an alias of `openBinding` would have forced one of the two
 * lifetimes onto the other.
 *
 * What it is *not*: a second resolver control plane. It reuses the same host resolver, VFS and
 * provider primitives, the same confinement rules and the same provenance discipline as block 9 —
 * a codec, projector, viewer or renderer still publishes logical requirements and still never
 * constructs a URI, opens an ambient path or reaches around the host.
 *
 * Interface-only, as the rest of the runtime ABI is. `packages/host` owns the implementation, its
 * budgets and its diagnostic codes.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type { RevisionId } from './asset-capabilities/types.js'
import type { Lease } from './asset-capabilities/data-sources.js'
import type { ModelResourceRole } from './asset-capabilities/model-facet-sources.js'
import type { ArtifactSource, InputSearchScope } from './runtime-abi.js'

/**
 * What kind of thing is being asked for.
 *
 * Deliberately the model facet vocabulary plus `buffer`, rather than a third spelling of the same
 * idea: a texture reference published by `common.view/model-resource-refs-source@1` is resolved by
 * this port under the same word it was published with.
 */
export type ResourceRole = ModelResourceRole | 'buffer'

/**
 * One lazily discovered reference, published as a *logical requirement*.
 *
 * `logicalId` is the name the native document spells, verbatim and unresolved. The host normalises
 * and confines it; the publisher neither may nor needs to.
 */
export interface LogicalResourceRequirement {
  /** Caller-side handle for this request; it appears in the provenance record. */
  readonly id: string
  readonly logicalId: string
  readonly role: ResourceRole
  /** Where the host may look, in the block-9 scope vocabulary. */
  readonly scopes: readonly InputSearchScope[]
  /**
   * The resource whose contents named this one, when there is one.
   *
   * A resource may reference another — a material naming a texture naming an atlas — so the chain
   * is real and so is the possibility of a loop. Naming the parent is what lets the session detect
   * one instead of following it.
   */
  readonly parentResourceId?: string
}

/**
 * Why a requirement did not resolve. Every one of these is a named outcome, never an exception and
 * never a silent empty result.
 */
export type ResourceUnresolvedReason =
  /** Nothing in any served scope matched the logical id. */
  | 'not-found'
  /** The session's allowlist does not admit this logical id. */
  | 'not-allowlisted'
  /** The logical id is not a confined name (traversal, absolute, drive, UNC, NUL). */
  | 'path-refused'
  /** Every scope the requirement asked for is one this origin cannot serve. */
  | 'scope-unsupported'
  /** A resource, byte, depth or entry limit of the session was reached. */
  | 'budget-exceeded'
  /** The requirement's parent chain already contains this logical id. */
  | 'cycle-detected'
  /** The session was disposed; its leases are gone and it resolves nothing further. */
  | 'session-disposed'

/**
 * What the session did about one requirement — recorded whether it succeeded or not.
 *
 * An unresolved resource is provenance too. A receipt that only listed successes would describe a
 * model as complete when half its textures live in another archive.
 */
export interface ResourceProvenanceRecord {
  readonly requirementId: string
  readonly logicalId: string
  readonly role: ResourceRole
  readonly state: 'resolved' | 'unresolved'
  readonly reason?: ResourceUnresolvedReason
  /** Revision of the resolved resource; its own, derived from the origin snapshot. */
  readonly revision?: RevisionId
  readonly bytes?: bigint
  /** True when the session answered from its cache instead of enumerating again. */
  readonly cached: boolean
  readonly scopes: readonly InputSearchScope[]
}

export type ResourceResolution =
  | {
      readonly state: 'resolved'
      /** Released by the caller, or by `dispose()` if the caller does not. */
      readonly lease: Lease<ArtifactSource>
      readonly revision: RevisionId
      readonly provenance: ResourceProvenanceRecord
    }
  | {
      readonly state: 'unresolved'
      readonly reason: ResourceUnresolvedReason
      readonly diagnostic: Diagnostic
      readonly provenance: ResourceProvenanceRecord
    }

export type ResourceSessionState = 'live' | 'disposed'

/**
 * The host-owned port a projection resolves its lazy references through.
 *
 * `revision` pins the resource plane the whole session resolves against, so two resolutions inside
 * one session cannot silently straddle a change in the underlying container.
 */
export interface ResourceSessionPort {
  readonly sessionId: string
  readonly revision: RevisionId
  state(): ResourceSessionState
  resolve(
    requirement: LogicalResourceRequirement,
    signal?: AbortSignal,
  ): Promise<ResourceResolution>
  /** Everything this session attempted, in resolution order, for the projection receipt. */
  provenance(): readonly ResourceProvenanceRecord[]
  /** Releases every lease the session still holds. Idempotent. */
  dispose(): Promise<void>
}
