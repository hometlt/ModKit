/**
 * `AssetDescriptor` v1 — the normative, serializable result of resolution
 * (`ASSET_CAPABILITIES.md` section 2).
 *
 * A source becomes a UI only after resolution produces this value. It is serializable by
 * contract: "runtime functions, DOM objects, workers, file handles, and host APIs are
 * referenced by stable handler/contribution IDs and never embedded in it" (canonical
 * architecture, section 5, pipeline rule 4).
 *
 * The v1 field names `pluginId`/`pluginVersion` are retained for wire compatibility and
 * identify the selected codec or temporary legacy registry adapter; they do not preserve the
 * old `AssetPlugin` API as the target registration model.
 */

import {
  findCapability,
  type CapabilityId,
  type CapabilityInstance,
  type CapabilityState,
} from './capabilities.js'
import type { ViewerContributionDescriptor } from './contributions.js'
import type { DetectionEvidence } from './detection.js'
import type { AssetDiagnostic } from './diagnostics.js'
import { isJsonSerializable, type JsonValue } from './json.js'
import {
  findOperation,
  isOperationAvailable,
  type AssetOperationDescriptor,
  type AssetOperationId,
} from './operations.js'
import type { AssetSourceDescriptor } from './source.js'

export const ASSET_DESCRIPTOR_SCHEMA_VERSION = 1

/**
 * Discovery/default-routing categories from `ASSET_CAPABILITIES.md` section 3.1. "Categories
 * organize discovery and default routing. They do not restrict composition."
 */
export const ASSET_CATEGORIES = [
  'image',
  'design',
  'document',
  'table',
  'presentation',
  'model',
  'audio',
  'video',
  'container',
  'font',
  'code',
  'semantic-game-asset',
  'binary',
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export function isKnownAssetCategory(value: string): value is AssetCategory {
  return (ASSET_CATEGORIES as readonly string[]).includes(value)
}

/** What parser/format matched (`ASSET_CAPABILITIES.md` section 3.1). */
export interface AssetIdentity {
  /** Selected codec ID, or the legacy-registry adapter ID during migration. */
  readonly pluginId: string
  readonly pluginVersion: string
  /** Format ID such as `png`, `m3`, `docx`, `unreal-package`, `zip`. */
  readonly formatId: string
  readonly formatLabel: string
  readonly mediaType?: string
  readonly categories: readonly AssetCategory[]
  /** `0..1`, carried over from the winning {@link DetectionResult}. */
  readonly confidence: number
  readonly detection: readonly DetectionEvidence[]
}

/** Presentational value kinds so the shell can format a metadata row without parsing it. */
export type MetadataValueKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'bytes'
  | 'duration'
  | 'dimensions'
  | 'date'
  | 'path'
  | 'id'
  | 'color'
  | 'list'

/**
 * How a field is edited. `kind` says what the value *is*; this says what the control *is*, which
 * is not the same question: a texture path and a mod path are both `path`, but only one of them
 * is picked from the asset tree.
 */
export type MetadataEditorKind =
  'scalar' | 'enum' | 'assetRef' | 'subjectRef' | 'color' | 'vector' | 'flags'

/** One allowed value, when the set is known from the data rather than from a type. */
export interface MetadataEnumOption {
  readonly value: JsonValue
  readonly label: string
  readonly description?: string
}

/**
 * A field's write declaration.
 *
 * Reading is the codec's `describe()`. Writing is a codec operation named here — so an XML splice,
 * a binary patch, and a pixel operation are the same contract to a host and entirely different
 * implementations to their codecs. Without this a viewer can show a field but never change it,
 * which is why editing surfaces grew private side channels instead.
 */
export interface MetadataEditable {
  readonly editor: MetadataEditorKind
  /** Operation that performs the write. Defaults to `edit.field`. */
  readonly write?: AssetOperationId
  /** Allowed values for an `enum` editor, when the game's own data defines them. */
  readonly options?: readonly MetadataEnumOption[]
  /** What a reference editor may point at. */
  readonly accepts?: {
    /** Format or asset category, for `assetRef`. */
    readonly assetKind?: string
    /** Subject kind — a catalog namespace, for `subjectRef`. */
    readonly subjectKind?: string
  }
  /**
   * Why this field cannot be written right now — a read-only source, an inherited value. Presence
   * means the control is shown but disabled, which is strictly more useful than hiding it.
   */
  readonly readonlyReason?: string
}

/** What a host sends to the `write` operation. `null` clears the field. */
export interface FieldWriteRequest {
  readonly groupId: string
  readonly entryId: string
  readonly value: JsonValue | null
}

export interface MetadataEntry {
  /** Stable within its group; keys settings, tests, and copy actions. */
  readonly id: string
  readonly label: string
  readonly value: JsonValue
  readonly kind?: MetadataValueKind
  /** Unit suffix when `kind` alone is not enough, e.g. `px`, `Hz`. */
  readonly unit?: string
  readonly diagnosticIds?: readonly string[]
  /** Present when the field can be written. Absent means read-only with no explanation owed. */
  readonly editable?: MetadataEditable
}

/** One right-panel section of normalized metadata. Sections are data, never components. */
export interface MetadataGroup {
  readonly id: string
  readonly label: string
  /** Ascending display order; ties fall back to declaration order. */
  readonly order?: number
  readonly entries: readonly MetadataEntry[]
}

/**
 * Declared and resolved companion state (`ASSET_CAPABILITIES.md` design rule 7: companions are
 * declared and resolved through sources, never guessed from arbitrary global filesystem
 * scans). The declaration side is {@link import('./companions.js').CompanionSpec}; this is its
 * resolution outcome for one asset.
 */
export interface CompanionDescriptor {
  readonly role: string
  readonly required: boolean
  readonly state: 'resolved' | 'missing' | 'ambiguous' | 'unresolved'
  /** Patterns the codec searched, mirroring the originating `CompanionSpec`. */
  readonly patterns?: readonly string[]
  /** The chosen companion when `state` is `resolved`. */
  readonly source?: AssetSourceDescriptor
  /** Candidates when `state` is `ambiguous`, so the host can offer a picker. */
  readonly candidates?: readonly AssetSourceDescriptor[]
  readonly description?: string
  readonly diagnosticIds?: readonly string[]
}

/** Source permissions, trust, resource limits, and partial support (section 3.4). */
export interface AssetConstraints {
  readonly readOnly: boolean
  readonly seekable: boolean
  readonly randomAccess: boolean
  /** Whether embedded scripts/runtimes may execute. Never implied by a trait. */
  readonly trusted: boolean
  readonly maxDecodedBytes?: number
  /** Stable feature tokens the codec recognized but does not support for this asset. */
  readonly unsupportedFeatures?: readonly string[]
}

/**
 * What a viewed thing is, independent of whether it is a file.
 *
 * An asset gets this from its source and the detection that identified it. A catalog entity, a
 * mod, or a namespace has no single path and was never detected — it is assembled — so it
 * declares its identity directly instead.
 */
export interface SubjectIdentity {
  /** Stable, restorable address. URI-shaped by convention, compared by value. */
  readonly id: string
  /** Human title for the view header. */
  readonly title: string
  /** What kind of thing this is: a format ID for an asset, a catalog namespace for an entity. */
  readonly kindId: string
  readonly kindLabel: string
}

/**
 * A thing that can be viewed: traits to reason about, operations to offer, contributions to mount,
 * metadata to show, diagnostics to report.
 *
 * This is the contract the viewer shell composes. It deliberately says nothing about files —
 * {@link AssetDescriptor} adds the source and detection an asset also carries, and everything
 * else that can be viewed satisfies this directly. See
 * `docs/tasks-active/entity-cards-strings/PLAN_wiki_subject_model.md` (W1).
 */
export interface SubjectDescriptor {
  readonly schemaVersion: 1
  readonly subject: SubjectIdentity
  /** Observable data traits. A trait never implies an operation. */
  readonly traits: readonly CapabilityInstance[]
  readonly operations: readonly AssetOperationDescriptor[]
  readonly contributions: readonly ViewerContributionDescriptor[]
  readonly metadata: readonly MetadataGroup[]
  readonly diagnostics: readonly AssetDiagnostic[]
}

/**
 * A subject that came from a source and was identified by detection.
 *
 * The shape is unchanged: codecs keep describing assets exactly as before, and
 * {@link subjectOf} derives the narrower view when a consumer only needs that.
 */
export interface AssetDescriptor {
  readonly schemaVersion: 1
  readonly source: AssetSourceDescriptor
  readonly identity: AssetIdentity
  /** Observable data traits. A trait never implies an operation. */
  readonly traits: readonly CapabilityInstance[]
  readonly operations: readonly AssetOperationDescriptor[]
  readonly constraints: AssetConstraints
  readonly contributions: readonly ViewerContributionDescriptor[]
  readonly metadata: readonly MetadataGroup[]
  readonly diagnostics: readonly AssetDiagnostic[]
  readonly companions?: readonly CompanionDescriptor[]
}

/**
 * The subject view of an asset. The four identity fields are exactly what a shell needs for its
 * header — the source's path, origin, and detection confidence are asset facts a view never reads.
 */
export function subjectOf(descriptor: AssetDescriptor): SubjectDescriptor {
  return {
    schemaVersion: descriptor.schemaVersion,
    subject: {
      id: descriptor.source.id,
      title: descriptor.source.name || descriptor.identity.formatLabel,
      kindId: descriptor.identity.formatId,
      kindLabel: descriptor.identity.formatLabel,
    },
    traits: descriptor.traits,
    operations: descriptor.operations,
    contributions: descriptor.contributions,
    metadata: descriptor.metadata,
    diagnostics: descriptor.diagnostics,
  }
}

/** Either descriptor, for the helpers that only read what both carry. */
export type ViewableDescriptor = SubjectDescriptor | AssetDescriptor

export function hasTrait(
  descriptor: ViewableDescriptor,
  id: CapabilityId,
  states: readonly CapabilityState[] = ['available'],
): boolean {
  const trait = findCapability(descriptor.traits, id)
  return trait !== undefined && states.includes(trait.state)
}

export function getTrait(
  descriptor: ViewableDescriptor,
  id: CapabilityId,
): CapabilityInstance | undefined {
  return findCapability(descriptor.traits, id)
}

export function getOperation(
  descriptor: ViewableDescriptor,
  id: AssetOperationId,
): AssetOperationDescriptor | undefined {
  return findOperation(descriptor.operations, id)
}

export function canRunOperation(descriptor: ViewableDescriptor, id: AssetOperationId): boolean {
  return isOperationAvailable(descriptor.operations, id)
}

/**
 * Every diagnostic ID referenced anywhere in the descriptor, deduplicated in first-seen order.
 * Codec tests should assert this is a subset of `descriptor.diagnostics`.
 */
export function referencedDiagnosticIds(descriptor: ViewableDescriptor): readonly string[] {
  const ids: string[] = []
  const add = (values: readonly string[] | undefined): void => {
    for (const id of values ?? []) if (!ids.includes(id)) ids.push(id)
  }
  for (const trait of descriptor.traits) add(trait.diagnosticIds)
  for (const operation of descriptor.operations) {
    add(operation.diagnosticIds)
    add(operation.reason?.diagnosticIds)
  }
  // Companions are resolved from sources, so only an asset has them.
  if ('companions' in descriptor) {
    for (const companion of descriptor.companions ?? []) add(companion.diagnosticIds)
  }
  for (const group of descriptor.metadata) {
    for (const entry of group.entries) add(entry.diagnosticIds)
  }
  return ids
}

/**
 * Runtime enforcement of pipeline rule 4. `Uint8Array` payloads, workers, sessions, DOM nodes,
 * and functions all fail here, which is exactly the point: bytes belong in
 * {@link import('./editing.js').AssetOutput}, not in a descriptor.
 */
export function isSerializableDescriptor(descriptor: ViewableDescriptor): boolean {
  return isJsonSerializable(descriptor)
}
