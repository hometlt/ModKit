/**
 * The executable UV Projection ABI (block 11, slice 11C0, plan items 10 and 12).
 *
 * This module owns the *executable* half of the projection seam: what a caller asks for, what an
 * adapter promises, and the three separate receipts that say what actually happened. It does not
 * own wire semantics, canonical encoding, facet value shapes or hash rules — those live in
 * `multiverse/specs` and are referenced here by scope id and version only. Duplicating them would
 * make X3 a second authority, which §2.5 forbids; referencing them by id keeps exactly one.
 *
 * Three receipts, three boundaries, deliberately not one type:
 *
 * - `ProjectionReceipt` — native subject → live faceted projection;
 * - `MaterializationReceipt` — live projection → portable UV artifact;
 * - `NativeExportReceipt` — UV or live → some target native format.
 *
 * They are not interchangeable and a provenance chain references all three rather than merging
 * them, because the three adapters are different owners with different failure modes. The phrase
 * "the hash matched within losses" has no representation here: what a materializer did not carry
 * is enumerated in `MaterializationReceipt`, never absorbed into a tolerance.
 *
 * Interface-only, like the rest of the runtime ABI. Implementations land in the host and in the
 * materializer contribution of slice 11C1.
 */

import type { JsonValue, RevisionId } from './types.js'
import type { DataSourceRefWire } from './data-source-ids.js'

// ---------------------------------------------------------------------------------------------
// digests: algorithm-qualified, never bare hex

declare const UV_DIGEST_BRAND: unique symbol

/**
 * `<algorithm>:<lowercase hex>` — a digest that names the algorithm that produced it.
 *
 * A bare hex string is refused rather than assumed to be SHA-256. The cost is one prefix; the
 * benefit is that the day the algorithm changes, every artifact that carries a digest says which
 * one it used instead of silently meaning something new.
 */
export type AlgorithmQualifiedDigest = string & { readonly [UV_DIGEST_BRAND]: true }

const QUALIFIED_DIGEST = /^[a-z][a-z0-9-]*:[0-9a-f]{32,128}$/u

export function isAlgorithmQualifiedDigest(value: string): value is AlgorithmQualifiedDigest {
  return QUALIFIED_DIGEST.test(value)
}

export function algorithmQualifiedDigest<const Value extends string>(
  value: Value,
): AlgorithmQualifiedDigest & Value {
  if (!isAlgorithmQualifiedDigest(value)) {
    throw new TypeError(
      'a UV digest must be algorithm-qualified as «<algorithm>:<lowercase hex>»; a bare hex string is refused',
    )
  }
  return value as AlgorithmQualifiedDigest & Value
}

/**
 * How much of the source a digest actually covers.
 *
 * Plan item 12: a content digest is *optional* evidence and must not require a hidden full read.
 * A projector that has only read a bounded prefix says `prefix` and stays honest; it does not
 * quietly stream a 300 MB archive to decorate a receipt.
 */
export type DigestCoverage = 'full' | 'prefix' | 'provider-supplied'

export interface ContentDigestEvidence {
  readonly kind: 'content-digest'
  readonly digest: AlgorithmQualifiedDigest
  readonly coverage: DigestCoverage
  /** Bytes the digest covers, when coverage is `prefix`. */
  readonly bytes?: bigint
}

// ---------------------------------------------------------------------------------------------
// semantic scope: referenced by id, never redefined here

/**
 * Reference to a registered `SemanticScopeDescriptor` in `multiverse/specs`.
 *
 * The descriptor owns facet ids, canonical encoding, ordering, numeric rules, missing/null
 * semantics, resource-closure policy and the hash algorithm. This reference owns none of them: it
 * says *which* scope a hash belongs to, so two hashes are never compared across scopes or across
 * scope versions.
 */
export interface SemanticScopeRef {
  readonly scopeId: string
  readonly version: string
}

/** A hash taken over a named semantic scope. The scope travels with the value, always. */
export interface ScopedSemanticHash {
  readonly scope: SemanticScopeRef
  readonly hash: AlgorithmQualifiedDigest
}

// ---------------------------------------------------------------------------------------------
// adapter coordinates

/**
 * Which adapter ran, at which version, with which options.
 *
 * Options are part of identity, not decoration: the same adapter at the same version with
 * different options is a different projection, and a receipt that omitted them could not explain
 * why two runs differ.
 */
export interface UvAdapterCoordinate {
  readonly id: string
  readonly version: string
  readonly options?: JsonValue
}

// ---------------------------------------------------------------------------------------------
// request and plan

export type ProjectionIntent = 'inspect' | 'preview' | 'materialize'

/**
 * What a caller wants projected.
 *
 * `facets` names the facet data sources the caller wants published — the base
 * `common.view/model-scene-source@1` and any optional facet beside it. Naming them is what keeps
 * the ABI a set of small versioned facets rather than one giant document DTO.
 */
export interface ProjectionRequest {
  readonly subjectRevision: RevisionId
  readonly intent: ProjectionIntent
  readonly facets: readonly DataSourceRefWire[]
  /** Present when the caller intends to compare hashes; absent for a plain preview. */
  readonly scope?: SemanticScopeRef
}

/** Why a requested facet will not be published. Never "it is empty". */
export type ProjectionFacetRefusal =
  /** The adapter does not implement this facet at all. */
  | 'not-implemented'
  /** The native subject genuinely carries no such plane. */
  | 'absent-in-source'
  /** The facet exists but needs a resource the host has not resolved (see `ResourceSessionPort`). */
  | 'resource-unresolved'
  /** Publishing it would exceed the declared budget. */
  | 'budget-exceeded'
  /** The caller did not grant what reading it requires. */
  | 'permission-missing'

export type ProjectionFacetBinding =
  | { readonly ref: DataSourceRefWire; readonly state: 'published'; readonly reason?: never }
  | {
      readonly ref: DataSourceRefWire
      readonly state: 'refused'
      readonly reason: ProjectionFacetRefusal
      /** Free-text detail for a diagnostic; never a substitute for the coded reason. */
      readonly note?: string
    }

/**
 * What the adapter commits to before any facet is read.
 *
 * A plan is a promise about the *set* of facets, not about their content. A caller can therefore
 * decide whether the projection is worth opening without paying for it, and a facet that will not
 * appear is named as refused here rather than turning up empty later.
 */
export interface ProjectionPlan {
  readonly adapter: UvAdapterCoordinate
  readonly subjectRevision: RevisionId
  readonly facets: readonly ProjectionFacetBinding[]
  /** The scope this plan can satisfy, when the request named one and the adapter can meet it. */
  readonly scope?: SemanticScopeRef
}

// ---------------------------------------------------------------------------------------------
// ProjectionReceipt — native → live (plan item 12)

/** Axis convention of the projected space. Recorded so an exporter reproduces, not re-derives. */
export interface ProjectionBasis {
  readonly handedness: 'right' | 'left'
  readonly upAxis: 'x' | 'y' | 'z'
  readonly forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
  /** The unit the projected values are in. */
  readonly unit: 'meter' | 'source-unit'
  /** Physical scale, when the source states or implies one. */
  readonly metersPerUnit?: number
  /** The source's own unit name, preserved verbatim (`sc2-game-unit`, `elmo`, `inch`, …). */
  readonly sourceUnit?: string
  /** Grid relationship an RTS source authored against, where the format carries it. */
  readonly unitsPerCell?: number
}

/**
 * What happened to one semantic plane, in the four states §2.6 distinguishes.
 *
 * `inferred` is deliberately separate from `normalized`: a value the adapter computed because the
 * source did not state it is not the same fact as a value the adapter converted, and a consumer
 * deciding whether to trust a bind pose needs to know which it is looking at.
 */
export type ProjectionPlaneState = 'normalized' | 'preserved' | 'inferred' | 'lost'

export interface ProjectionPlaneRecord {
  /** Plane identifier in the adapter's own vocabulary (`geometry`, `skeleton`, `effects`, …). */
  readonly planeId: string
  readonly state: ProjectionPlaneState
  readonly note?: string
}

export type ProjectionCompanionState = 'bound' | 'absent' | 'refused'

export interface ProjectionCompanionRecord {
  readonly requirementId: string
  readonly role: string
  readonly state: ProjectionCompanionState
  /** Host-minted binding id, present exactly when the companion was bound. */
  readonly bindingId?: string
  readonly revision?: RevisionId
}

/**
 * Evidence behind the projection, discriminated so a reader can tell proof from assertion.
 *
 * `declared` is what the format says about itself, `observed` is what the adapter actually read,
 * `content-digest` is a digest with its coverage stated, and `diagnostic` is a named problem. A
 * receipt made of `declared` entries alone is a claim, and it reads as one.
 */
export type ProjectionEvidence =
  | { readonly kind: 'declared'; readonly statement: string; readonly source?: string }
  | { readonly kind: 'observed'; readonly statement: string; readonly bytesRead?: bigint }
  | ContentDigestEvidence
  | { readonly kind: 'diagnostic'; readonly code: string; readonly message: string }

/**
 * How much the adapter stands behind the projection.
 *
 * `exact` means the adapter reproduced the source plane with no conversion decision of its own;
 * `heuristic` means it guessed and says so. There is no unlabelled middle.
 */
export type ProjectionConfidence = 'exact' | 'high' | 'partial' | 'heuristic'

interface ProjectionReceiptBase {
  readonly adapter: UvAdapterCoordinate
  /** The subject revision and every companion revision the projection was taken against. */
  readonly subjectRevision: RevisionId
  readonly companions: readonly ProjectionCompanionRecord[]
  readonly basis: ProjectionBasis
  readonly planes: readonly ProjectionPlaneRecord[]
  readonly evidence: readonly ProjectionEvidence[]
  readonly confidence: ProjectionConfidence
  /** Present when the adapter published a scope-bearing projection and hashed it. */
  readonly semanticHash?: ScopedSemanticHash
}

/**
 * The local receipt: it may name where the subject actually came from.
 *
 * Local means local. `sourceUri` is an ambient absolute URI and is allowed *only* here and in a
 * `LocalEvidenceReport`; serializing it into a portable artifact would leak the machine that
 * produced the artifact into every copy of it.
 */
export interface ProjectionReceipt extends ProjectionReceiptBase {
  readonly form: 'local'
  readonly sourceUri?: string
  readonly sourceIdentity?: never
}

/**
 * The portable receipt: it carries an opaque or redacted source identity and no URI.
 *
 * The distinction is structural rather than a rule in prose — `sourceUri?: never` means a portable
 * receipt with an ambient path does not compile, and `toPortableProjectionReceipt` is the only
 * supported way to get one.
 */
export interface PortableProjectionReceipt extends ProjectionReceiptBase {
  readonly form: 'portable'
  readonly sourceUri?: never
  readonly sourceIdentity: PortableSourceIdentity
}

export type PortableSourceIdentity =
  /** A stable token that identifies the source without describing where it lives. */
  | { readonly kind: 'opaque'; readonly token: string }
  /** Identity withheld on purpose, with the reason named. */
  | { readonly kind: 'redacted'; readonly reason: string }

/**
 * External, local-only evidence report.
 *
 * This is the one place an ambient absolute URI may be written down alongside the receipt, and it
 * is by construction not part of any artifact: it names the receipt it explains rather than being
 * embedded in it.
 */
export interface LocalEvidenceReport {
  readonly adapter: UvAdapterCoordinate
  readonly subjectRevision: RevisionId
  /** Ambient absolute URIs live here and nowhere else. */
  readonly sourceUri: string
  readonly companionUris: readonly string[]
  readonly evidence: readonly ProjectionEvidence[]
}

/**
 * Strip a local receipt down to its portable form.
 *
 * Pure and total: it drops the ambient URI and substitutes the identity the caller chose. Anything
 * that would need a machine-local path to be understood is not portable, and losing it here is the
 * intended outcome rather than a limitation.
 */
export function toPortableProjectionReceipt(
  receipt: ProjectionReceipt,
  identity: PortableSourceIdentity,
): PortableProjectionReceipt {
  const { form, sourceUri, ...rest } = receipt
  void form
  void sourceUri
  return { ...rest, form: 'portable', sourceIdentity: identity }
}

// ---------------------------------------------------------------------------------------------
// MaterializationReceipt — live → portable UV artifact

/**
 * What a caller asks a materializer to write.
 *
 * The scope is required, not optional: a materialization whose semantic scope is unnamed cannot be
 * compared with anything afterwards, which defeats the purpose of materializing it.
 */
export interface MaterializationRequest {
  readonly scope: SemanticScopeRef
  /** Target profile identifier owned by the specs repository, e.g. `UVM/core@1.0`. */
  readonly profile: string
  readonly subjectRevision: RevisionId
  readonly options?: JsonValue
}

export type MaterializationDiffChange =
  'absent-in-artifact' | 'absent-in-live' | 'value-differs' | 'order-differs'

export interface MaterializationDiffEntry {
  readonly facetId: string
  readonly change: MaterializationDiffChange
  /** Path inside the facet value, in the facet's own addressing. */
  readonly path?: string
  readonly note?: string
}

/**
 * What a materializer carried, what it did not, and how the two sides differ.
 *
 * `lostFacetIds` and `excludedFacetIds` are different statements and are kept apart: excluded means
 * the profile never promised to carry it, lost means it was in the live projection and did not
 * survive. Collapsing them would hide the only one of the two that is a defect.
 */
export interface MaterializationReceipt {
  readonly materializer: UvAdapterCoordinate
  readonly scope: SemanticScopeRef
  readonly profile: string
  readonly subjectRevision: RevisionId
  readonly lostFacetIds: readonly string[]
  readonly excludedFacetIds: readonly string[]
  readonly diff: readonly MaterializationDiffEntry[]
  /** The scope hash of the live projection this artifact was written from. */
  readonly semanticHash?: ScopedSemanticHash
  /** Digest of the canonical artifact bytes, where the profile promises canonical bytes. */
  readonly artifactDigest?: AlgorithmQualifiedDigest
}

// ---------------------------------------------------------------------------------------------
// NativeExportReceipt — UV or live → target native format

/**
 * The four independent fidelity axes of §2.6. The bare word `lossless` does not exist here.
 *
 * A result may be view-equivalent and not semantically round-tripping, or byte-preserving for the
 * chunks it did not understand while being lossy for the ones it did. One boolean could not say
 * either of those things.
 */
export type NativeExportFidelityAxis =
  'view-equivalent' | 'semantic-round-trip' | 'native-byte-preserving' | 'cross-format-export'

export type NativeExportFidelityState = 'claimed' | 'partial' | 'not-claimed'

export interface NativeExportFidelity {
  readonly axis: NativeExportFidelityAxis
  readonly state: NativeExportFidelityState
  readonly note?: string
}

export interface NativeExportLoss {
  /** Stable loss code owned by the exporting codec. */
  readonly code: string
  readonly planeId?: string
  readonly message: string
}

/**
 * What the target codec's exporter produced, and what it could not.
 *
 * The verdict belongs to the *target* codec: only it knows what its format can hold. A source-side
 * claim that data was "preserved" proves the source is recoverable, not that the target understood
 * it.
 */
export interface NativeExportReceipt {
  readonly exporter: UvAdapterCoordinate
  /** Format id of the target native format, as its codec declares it. */
  readonly targetFormatId: string
  readonly sourceRevision: RevisionId
  readonly fidelity: readonly NativeExportFidelity[]
  readonly losses: readonly NativeExportLoss[]
  readonly artifactDigest?: AlgorithmQualifiedDigest
}

// ---------------------------------------------------------------------------------------------
// provenance chain

/**
 * The three receipts of one pipeline, referenced rather than merged.
 *
 * Every step is optional because pipelines legitimately stop early: a live preview has only a
 * projection receipt, and it should not have to fabricate the other two to be describable.
 */
export interface UvProvenanceChain {
  readonly projection?: ProjectionReceipt | PortableProjectionReceipt
  readonly materialization?: MaterializationReceipt
  readonly nativeExport?: NativeExportReceipt
}
