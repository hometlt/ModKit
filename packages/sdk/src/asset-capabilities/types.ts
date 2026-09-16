/**
 * Read-only Asset Capabilities wire types for the MK3 descriptor-v2 slice.
 *
 * These are data contracts only. Runtime handlers, installed providers/viewers, DOM values,
 * workers, and source handles never enter a descriptor.
 */

import { isQualifiedId } from '@modkit/core'
import type {
  Diagnostic as CoreDiagnostic,
  OperationId,
  SourceSpan,
  SourceSpanWire,
  TraitId,
  UInt64String,
} from '@modkit/core'
import type {
  DataSourceOffer,
  DataSourceOfferWire,
  SubjectFactProvenanceFor,
} from './data-sources.js'
import type { FieldEditableFor, FieldType } from '../fields/index.js'
import type { KnowledgeTarget } from '../knowledge/index.js'
import {
  parseRevisionRef,
  serializeRevisionRef,
  type RevisionRef,
  type SourceRef,
} from '../subjects/refs.js'

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type AssetOperationId = OperationId

declare const CONTRIBUTION_ID_BRAND: unique symbol

/** Stable declared contribution coordinate; distinct from a logical ContractId. */
export type ContributionId = string & { readonly [CONTRIBUTION_ID_BRAND]: true }

export function contributionId<const Value extends string>(value: Value): ContributionId & Value {
  if (!isQualifiedId(value)) throw new TypeError(`invalid contribution id: ${value}`)
  return value as ContributionId & Value
}

/** Plain JSON decimal-u64 spelling. Validation/branding belongs to the later builder API. */
export type UInt64StringWire = string

declare const REVISION_ID_BRAND: unique symbol

/** Stable validated snapshot token. It is deliberately not the stable subject identity. */
export type RevisionId = string & { readonly [REVISION_ID_BRAND]: true }
export type RevisionIdWire = string

export function isRevisionId(value: string): value is RevisionId {
  return parseRevisionRef(value) !== undefined
}

export function revisionId<const Value extends string>(value: Value): RevisionId & Value {
  if (!isRevisionId(value)) throw new TypeError('revision id must be a canonical kind-tagged value')
  return value as RevisionId & Value
}

export function revisionIdFromRef(ref: RevisionRef): RevisionId {
  return revisionId(serializeRevisionRef(ref))
}

export function revisionRefFromId(value: RevisionId): RevisionRef {
  const parsed = parseRevisionRef(value)
  if (parsed === undefined) throw new TypeError('invalid branded revision id')
  return parsed
}

export type TraitState = 'available' | 'partial' | 'disabled' | 'dependency-required'

/** Version-aware trait selection used by input planning and provider requests. */
export interface TraitDefinitionRequirementFor<Id extends string> {
  readonly id: Id
  readonly definitionRange?: string
}

/** Exact trait definition selected for a provider output. */
export interface TraitDefinitionOfferFor<Id extends string> {
  readonly id: Id
  readonly definitionVersion?: string
}

/** Version-aware trait predicate; omitted states mean `['available']`. */
export interface TraitQueryRequirementFor<
  Id extends string,
> extends TraitDefinitionRequirementFor<Id> {
  readonly states?: readonly TraitState[]
}

export type TraitDefinitionRequirement = TraitDefinitionRequirementFor<TraitId>
export type TraitDefinitionRequirementWire = TraitDefinitionRequirementFor<string>
export type TraitDefinitionOffer = TraitDefinitionOfferFor<TraitId>
export type TraitDefinitionOfferWire = TraitDefinitionOfferFor<string>
export type TraitQueryRequirement = TraitQueryRequirementFor<TraitId>
export type TraitQueryRequirementWire = TraitQueryRequirementFor<string>

export type AssetDiagnosticCategory =
  | 'syntax'
  | 'structure'
  | 'fidelity'
  | 'dependency'
  | 'security'
  | 'performance'
  | 'operation'
  | 'io'
  | 'unknown'

export interface AssetDiagnosticSource {
  readonly extensionId?: string
  readonly contributionId?: string
}

/**
 * Wire refinement of core diagnostics. Core remains the owner of severity, code, message,
 * path, and source-coordinate semantics; Asset Capabilities adds stable cross-references and
 * a routing category. The range uses core's unbranded wire projection.
 */
export type AssetDiagnosticFor<Span extends SourceSpanWire> = Omit<
  CoreDiagnostic,
  'data' | 'range'
> & {
  readonly id: string
  readonly category: AssetDiagnosticCategory
  readonly source?: AssetDiagnosticSource
  readonly range?: Span
  readonly data?: JsonValue
  readonly relatedIds?: readonly string[]
}

export type AssetDiagnostic = AssetDiagnosticFor<SourceSpan>
export type AssetDiagnosticWire = AssetDiagnosticFor<SourceSpanWire>

export interface JsonSchemaRef {
  readonly $ref: string
  /**
   * Immutable, portable schema document published by the operation owner.
   *
   * A reference without a document is still valid for non-UI consumers. A schema-driven host
   * must fail closed when it cannot resolve the document rather than guessing an input shape.
   */
  readonly document?: JsonValue
}

/** Host-restorable source identity; never a live source handle. */
export interface AssetSourceRef {
  readonly id: string
  readonly uri: string
  /** Root-to-immediate-parent identity chain; omitted for a top-level source. */
  readonly parentIds?: readonly [string, ...string[]]
}

export function assetSourceRefFromSourceRef(source: SourceRef, uri: string): AssetSourceRef {
  const ancestors: string[] = []
  for (let current = source.parent; current !== undefined; current = current.parent) {
    ancestors.push(current.id)
  }
  ancestors.reverse()
  return Object.freeze({
    id: source.id,
    uri,
    ...(ancestors.length === 0
      ? {}
      : { parentIds: Object.freeze(ancestors) as readonly [string, ...string[]] }),
  })
}

export function sourceRefFromAssetSourceRef(ref: AssetSourceRef): SourceRef {
  let parent: SourceRef | undefined
  for (const id of ref.parentIds ?? []) {
    parent = Object.freeze({ id, ...(parent === undefined ? {} : { parent }) })
  }
  return Object.freeze({ id: ref.id, ...(parent === undefined ? {} : { parent }) })
}

export type SourceBindingOwnership = 'owned' | 'companion' | 'external'

/** One stable physical input in a single- or multi-source asset snapshot. */
export interface SourceBindingDescriptorFor<Revision extends string> {
  readonly id: string
  readonly role: string
  readonly source: AssetSourceRef
  readonly required: boolean
  readonly ownership: SourceBindingOwnership
  /** Revision of this binding, independent from the aggregate subject revision. */
  readonly revision: Revision
  readonly mediaType?: string
}

export type SourceBindingDescriptor = SourceBindingDescriptorFor<RevisionId>
export type SourceBindingDescriptorWire = SourceBindingDescriptorFor<RevisionIdWire>

/** Portable reference to the exact subject snapshot consumed by a derivation. */
export interface SubjectSnapshotRefFor<Revision extends string> {
  readonly bindingId: string
  readonly role: string
  readonly subjectUri: string
  readonly revision: Revision
  readonly compositionFingerprint: string
}

export type SubjectSnapshotRef = SubjectSnapshotRefFor<RevisionId>
export type SubjectSnapshotRefWire = SubjectSnapshotRefFor<RevisionIdWire>

export interface DerivationRecipeFor<Operation extends string, Contribution extends string> {
  /** Stable declared contribution coordinate, never a session-local provider handle. */
  readonly extensionId: string
  readonly extensionVersion: string
  readonly contributionId: Contribution
  readonly operation: Operation
  readonly parameters?: JsonValue
}

export type DerivationRecipe = DerivationRecipeFor<OperationId, ContributionId>
export type DerivationRecipeWire = DerivationRecipeFor<string, string>

export interface MaterializedAssetFor<Revision extends string> {
  readonly source: AssetSourceRef
  readonly revision: Revision
  readonly mediaType?: string
}

export type MaterializedAsset = MaterializedAssetFor<RevisionId>
export type MaterializedAssetWire = MaterializedAssetFor<RevisionIdWire>

/**
 * Portable physical/provenance shape. `bundle.primary` is only an optional hint; namespace and
 * derived assets deliberately have no synthetic primary source.
 */
export type AssetOriginDescriptorFor<
  Revision extends string,
  Operation extends string,
  Contribution extends string = string,
> =
  | {
      readonly kind: 'single'
      readonly binding: SourceBindingDescriptorFor<Revision>
    }
  | {
      readonly kind: 'bundle'
      readonly bindings: readonly SourceBindingDescriptorFor<Revision>[]
      readonly primary?: string
    }
  | {
      readonly kind: 'namespace'
      readonly root: AssetSourceRef
      readonly revision: Revision
    }
  | {
      readonly kind: 'derived'
      readonly inputs: readonly [
        SubjectSnapshotRefFor<Revision>,
        ...SubjectSnapshotRefFor<Revision>[],
      ]
      readonly recipe?: DerivationRecipeFor<Operation, Contribution>
      readonly materialization?: MaterializedAssetFor<Revision>
    }

export type AssetOriginDescriptor = AssetOriginDescriptorFor<
  RevisionId,
  OperationId,
  ContributionId
>
export type AssetOriginDescriptorWire = AssetOriginDescriptorFor<RevisionIdWire, string, string>

interface TraitInstanceBase<Id extends string, TParameters extends JsonValue> {
  readonly id: Id
  readonly descriptorVersion: 1
  /** Exact semantic definition for custom traits; standard traits are platform-owned. */
  readonly definitionVersion?: string
  readonly parameters?: TParameters
}

export type TraitInstanceFor<Id extends string, TParameters extends JsonValue = JsonValue> =
  | (TraitInstanceBase<Id, TParameters> & {
      readonly state: 'available'
      readonly diagnosticIds?: never
    })
  | (TraitInstanceBase<Id, TParameters> & {
      readonly state: Exclude<TraitState, 'available'>
      readonly diagnosticIds: readonly [string, ...string[]]
    })

export type TraitInstance<TParameters extends JsonValue = JsonValue> = TraitInstanceFor<
  TraitId,
  TParameters
>
export type TraitInstanceWire<TParameters extends JsonValue = JsonValue> = TraitInstanceFor<
  string,
  TParameters
>

interface AssetOperationDescriptorBase<Id extends string> {
  readonly id: Id
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly inputSchema?: JsonSchemaRef
}

export type AssetOperationDescriptorFor<Id extends string> =
  | (AssetOperationDescriptorBase<Id> & {
      readonly state: 'available'
      readonly reason?: never
    })
  | (AssetOperationDescriptorBase<Id> & {
      readonly state: 'disabled' | 'dependency-required'
      readonly reason: string
    })

export type AssetOperationDescriptor = AssetOperationDescriptorFor<AssetOperationId>
export type AssetOperationDescriptorWire = AssetOperationDescriptorFor<string>

export interface AssetConstraintsFor<MaxBytes extends string> {
  readonly readOnly: boolean
  readonly seekable: boolean
  readonly randomAccess: boolean
  readonly trusted: boolean
  /** Decimal unsigned-64 string; a JSON number cannot represent the full range. */
  readonly maxDecodedBytes?: MaxBytes
  readonly unsupportedFeatures?: readonly string[]
}

export type AssetConstraints = AssetConstraintsFor<UInt64String>
export type AssetConstraintsWire = AssetConstraintsFor<UInt64StringWire>

export interface MetadataEntryFor<Operation extends string, Span extends SourceSpanWire> {
  readonly key: string
  readonly value: JsonValue
  /**
   * One short sentence about what this value is, when the value alone misleads.
   *
   * A header field named «Header size» that is not an offset, two checksums that must agree, a
   * reserved run that is expected to be zero: the codec is the only side that knows, and a reader
   * looking at the number cannot tell. Kept to a sentence — a panel is not documentation.
   */
  readonly note?: string
  readonly type?: FieldType
  readonly unit?: string
  readonly diagnosticIds?: readonly string[]
  readonly provenance?: readonly SubjectFactProvenanceFor<Span>[]
  readonly knowledgeTarget?: KnowledgeTarget
  readonly editable?: FieldEditableFor<Operation>
}

export type MetadataEntry = MetadataEntryFor<OperationId, SourceSpan>
export type MetadataEntryWire = MetadataEntryFor<string, SourceSpanWire>

export interface MetadataGroupFor<Operation extends string, Span extends SourceSpanWire> {
  readonly id: string
  readonly label: string
  readonly entries: readonly MetadataEntryFor<Operation, Span>[]
  readonly order?: number
}

export type MetadataGroup = MetadataGroupFor<OperationId, SourceSpan>
export type MetadataGroupWire = MetadataGroupFor<string, SourceSpanWire>

interface CompanionDescriptorCore {
  /** Stable CompanionRule/AssetInputRequirement identity. */
  readonly id: string
  readonly role: string
}

interface RequiredCompanionCardinality {
  readonly cardinality: 'one' | 'one-or-more'
  readonly required: true
}

interface OptionalCompanionCardinality {
  readonly cardinality: 'zero-or-one' | 'many'
  readonly required: false
}

type CompanionCardinality = RequiredCompanionCardinality | OptionalCompanionCardinality

type SingularCompanionCardinality =
  | { readonly cardinality: 'one'; readonly required: true }
  | { readonly cardinality: 'zero-or-one'; readonly required: false }

export interface CompanionCandidateFor<Revision extends string> {
  readonly source: AssetSourceRef
  readonly revision: Revision
}

/**
 * Resolved/missing/ambiguous requirement state. Physical source identity and revision live only
 * in `origin.bundle.bindings`; a resolved companion refers to that authority by binding IDs.
 */
export type CompanionDescriptorFor<Revision extends string> =
  | (CompanionDescriptorCore &
      CompanionCardinality & {
        readonly state: 'resolved'
        readonly bindingIds: readonly [string, ...string[]]
        readonly diagnosticIds?: never
      })
  | (CompanionDescriptorCore &
      RequiredCompanionCardinality & {
        readonly state: 'missing'
        readonly bindingIds?: never
        readonly diagnosticIds: readonly [string, ...string[]]
      })
  | (CompanionDescriptorCore &
      OptionalCompanionCardinality & {
        readonly state: 'missing'
        readonly bindingIds?: never
        readonly diagnosticIds?: readonly string[]
      })
  | (CompanionDescriptorCore &
      SingularCompanionCardinality & {
        readonly state: 'ambiguous'
        readonly bindingIds?: never
        readonly candidates: readonly [
          CompanionCandidateFor<Revision>,
          CompanionCandidateFor<Revision>,
          ...CompanionCandidateFor<Revision>[],
        ]
        readonly diagnosticIds: readonly [string, ...string[]]
      })

export type CompanionCandidate = CompanionCandidateFor<RevisionId>
export type CompanionCandidateWire = CompanionCandidateFor<RevisionIdWire>
export type CompanionDescriptor = CompanionDescriptorFor<RevisionId>
export type CompanionDescriptorWire = CompanionDescriptorFor<RevisionIdWire>

export type DetectionEvidenceKind =
  'magic' | 'structure' | 'companion' | 'context' | 'extension' | 'user-override'

export interface DetectionEvidence {
  readonly kind: DetectionEvidenceKind
  readonly weight: number
  readonly note?: string
}

export interface DetectionResultFor<
  Span extends SourceSpanWire,
  Diagnostic extends AssetDiagnosticFor<Span>,
> {
  readonly codecId: string
  readonly confidence: number
  readonly evidence: readonly DetectionEvidence[]
  readonly requiredRanges: readonly Span[]
  readonly diagnostics?: readonly Diagnostic[]
}

export type DetectionResult = DetectionResultFor<SourceSpan, AssetDiagnostic>
export type DetectionResultWire = DetectionResultFor<SourceSpanWire, AssetDiagnosticWire>

/** Portable subject facts. Installed provider/viewer IDs and presentation plans are forbidden. */
export interface SubjectDescriptorBase<
  Trait extends TraitInstanceFor<string>,
  Operation extends AssetOperationDescriptorFor<string>,
  Revision extends string,
  Constraints extends AssetConstraintsFor<string>,
  Diagnostic extends AssetDiagnosticFor<SourceSpanWire>,
  Offer,
  Origin,
> {
  readonly schemaVersion: 2
  readonly subjectUri: string
  readonly origin: Origin
  readonly traits: readonly Trait[]
  readonly operations: readonly Operation[]
  readonly constraints: Constraints
  readonly dataSources: readonly Offer[]
  readonly diagnostics: readonly Diagnostic[]
  readonly revision: Revision
}

export type SubjectDescriptor = SubjectDescriptorBase<
  TraitInstance,
  AssetOperationDescriptor,
  RevisionId,
  AssetConstraints,
  AssetDiagnostic,
  DataSourceOffer,
  AssetOriginDescriptor
>
export type SubjectDescriptorWire = SubjectDescriptorBase<
  TraitInstanceWire,
  AssetOperationDescriptorWire,
  RevisionIdWire,
  AssetConstraintsWire,
  AssetDiagnosticWire,
  DataSourceOfferWire,
  AssetOriginDescriptorWire
>

/** A persistent source subject for which no codec interpretation was selected. */
export interface UnresolvedSourceDescriptor extends SubjectDescriptor {
  readonly interpretation: 'none'
  readonly candidates: readonly DetectionResult[]
}

export interface UnresolvedSourceDescriptorWire extends SubjectDescriptorWire {
  readonly interpretation: 'none'
  readonly candidates: readonly DetectionResultWire[]
}

/** A selected codec interpretation. Stable subject identity remains in the base descriptor. */
export interface ResolvedAssetDescriptor extends SubjectDescriptor {
  readonly interpretation: 'codec'
  readonly identity: {
    readonly codecId: string
    readonly codecVersion: string
    readonly formatId: string
    readonly formatLabel: string
    readonly mediaType?: string
    readonly confidence: number
    readonly detection: readonly DetectionEvidence[]
  }
  readonly metadata: readonly MetadataGroup[]
  readonly companions?: readonly CompanionDescriptor[]
}

export interface ResolvedAssetDescriptorWire extends SubjectDescriptorWire {
  readonly interpretation: 'codec'
  readonly identity: ResolvedAssetDescriptor['identity']
  readonly metadata: readonly MetadataGroupWire[]
  readonly companions?: readonly CompanionDescriptorWire[]
}

export type AnyDescriptor = UnresolvedSourceDescriptor | ResolvedAssetDescriptor
export type AnyDescriptorWire = UnresolvedSourceDescriptorWire | ResolvedAssetDescriptorWire
