/** Canonical codec-detection provenance, deliberately separate from provider policy locks. */

import { canonicalJsonStringify, isQualifiedId, ModkitError } from '@modkit/core'
import {
  contributionId,
  revisionId,
  type CodecContributionSpecV1Wire,
  type ContributionId,
  type DetectionEvidence,
  type DetectionEvidenceKind,
  type DetectionResult,
  type RevisionId,
} from '@modkit/sdk'
import { inventoryBindingForOffer, offersFromInventory } from './offers.js'
import type { Inventory } from './inventory.js'

const EVIDENCE_KINDS: readonly DetectionEvidenceKind[] = Object.freeze([
  'magic',
  'structure',
  'companion',
  'context',
  'extension',
  'user-override',
])

export type CodecSourceTopology = CodecContributionSpecV1Wire['sourceTopology']

export interface CodecDetectionSelection {
  readonly schemaVersion: 1
  /** Exact source revision against which detection ran. */
  readonly sourceRevision: RevisionId
  readonly selected: {
    readonly extensionId: string
    readonly contributionId: ContributionId
    readonly variantId: string
    readonly offerId: string
    /** Loader-attested provider artifact and manifest bytes. */
    readonly artifactDigest: string
    readonly manifestDigest: string
    readonly sourceTopology: CodecSourceTopology
    readonly confidence: number
    /** Bounded, non-secret evidence only; source bytes and arbitrary facets are forbidden. */
    readonly evidence: readonly DetectionEvidence[]
  }
}

export interface CodecDetectionSelectionInput {
  readonly sourceRevision: RevisionId
  readonly extensionId: string
  readonly contributionId: string
  readonly variantId: string
  readonly offerId: string
  readonly artifactDigest: string
  readonly manifestDigest: string
  readonly sourceTopology: CodecSourceTopology
  readonly detection: DetectionResult
}

function fail(code: string, message: string): never {
  throw new ModkitError({ code, message })
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('x3.host/invalid-detection-selection', `${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  if (
    required.some(key => !(key in record)) ||
    Object.keys(record).some(key => !allowed.has(key))
  ) {
    return fail('x3.host/invalid-detection-selection', `${label} has missing or unknown fields`)
  }
  return record
}

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail('x3.host/invalid-detection-selection', `${label} must be a non-blank string`)
  }
  return value
}

function evidence(value: unknown, label: string): readonly DetectionEvidence[] {
  if (!Array.isArray(value)) {
    return fail('x3.host/invalid-detection-selection', `${label} must be an array`)
  }
  return Object.freeze(
    value.map((raw, index) => {
      const item = exactObject(raw, ['kind', 'weight'], ['note'], `${label}[${index}]`)
      if (!EVIDENCE_KINDS.includes(item['kind'] as DetectionEvidenceKind)) {
        return fail('x3.host/invalid-detection-selection', `${label}[${index}].kind is invalid`)
      }
      if (typeof item['weight'] !== 'number' || !Number.isFinite(item['weight'])) {
        return fail(
          'x3.host/invalid-detection-selection',
          `${label}[${index}].weight must be finite`,
        )
      }
      if (item['note'] !== undefined && typeof item['note'] !== 'string') {
        return fail(
          'x3.host/invalid-detection-selection',
          `${label}[${index}].note must be a string`,
        )
      }
      return Object.freeze({
        kind: item['kind'] as DetectionEvidenceKind,
        weight: item['weight'],
        ...(item['note'] === undefined ? {} : { note: item['note'] }),
      })
    }),
  )
}

function normalize(value: unknown): CodecDetectionSelection {
  const root = exactObject(value, ['schemaVersion', 'sourceRevision', 'selected'], [], 'selection')
  if (root['schemaVersion'] !== 1) {
    return fail('x3.host/invalid-detection-selection', 'selection schemaVersion is unsupported')
  }
  const sourceRevision = revisionId(nonBlank(root['sourceRevision'], 'selection.sourceRevision'))
  const selected = exactObject(
    root['selected'],
    [
      'extensionId',
      'contributionId',
      'variantId',
      'offerId',
      'artifactDigest',
      'manifestDigest',
      'sourceTopology',
      'confidence',
      'evidence',
    ],
    [],
    'selection.selected',
  )
  const extensionId = nonBlank(selected['extensionId'], 'selection.selected.extensionId')
  const contributionText = nonBlank(selected['contributionId'], 'selection.selected.contributionId')
  if (!isQualifiedId(extensionId) || !isQualifiedId(contributionText)) {
    return fail(
      'x3.host/invalid-detection-selection',
      'selection extension and contribution coordinates must be qualified',
    )
  }
  const topology = selected['sourceTopology']
  if (!['single', 'bundle', 'namespace', 'derived'].includes(String(topology))) {
    return fail('x3.host/invalid-detection-selection', 'selection sourceTopology is invalid')
  }
  const confidence = selected['confidence']
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return fail('x3.host/invalid-detection-selection', 'selection confidence is invalid')
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    sourceRevision,
    selected: Object.freeze({
      extensionId,
      contributionId: contributionId(contributionText),
      variantId: nonBlank(selected['variantId'], 'selection.selected.variantId'),
      offerId: nonBlank(selected['offerId'], 'selection.selected.offerId'),
      artifactDigest: nonBlank(selected['artifactDigest'], 'selection.selected.artifactDigest'),
      manifestDigest: nonBlank(selected['manifestDigest'], 'selection.selected.manifestDigest'),
      sourceTopology: topology as CodecSourceTopology,
      confidence,
      evidence: evidence(selected['evidence'], 'selection.selected.evidence'),
    }),
  })
}

export function buildCodecDetectionSelection(
  input: CodecDetectionSelectionInput,
): CodecDetectionSelection {
  if (input.detection.codecId !== input.contributionId) {
    return fail(
      'x3.host/detection-selection-mismatch',
      'detection codecId does not match the selected contribution',
    )
  }
  return normalize({
    schemaVersion: 1,
    sourceRevision: input.sourceRevision,
    selected: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      variantId: input.variantId,
      offerId: input.offerId,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      sourceTopology: input.sourceTopology,
      confidence: input.detection.confidence,
      evidence: input.detection.evidence,
    },
  })
}

export function serializeCodecDetectionSelection(selection: CodecDetectionSelection): string {
  return canonicalJsonStringify(normalize(selection))
}

export function parseCodecDetectionSelection(text: string): CodecDetectionSelection {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return fail('x3.host/invalid-detection-selection', 'detection selection is not valid JSON')
  }
  const selection = normalize(raw)
  if (canonicalJsonStringify(selection) !== text) {
    return fail(
      'x3.host/invalid-detection-selection',
      'detection selection bytes are not canonical',
    )
  }
  return selection
}

/** Verify a persisted selection against the current attested inventory without rerunning probe. */
export function replayCodecDetectionSelection(
  inventory: Inventory,
  sourceRevision: RevisionId,
  text: string,
): CodecDetectionSelection {
  const selection = parseCodecDetectionSelection(text)
  if (selection.sourceRevision !== sourceRevision) {
    return fail(
      'x3.host/detection-source-mismatch',
      'codec detection selection belongs to a different source revision',
    )
  }
  const matches = offersFromInventory(inventory).filter(offer => {
    if (
      offer.extensionId !== selection.selected.extensionId ||
      offer.providerId !== selection.selected.contributionId ||
      offer.runtimeVariant !== selection.selected.variantId ||
      !offer.provides.some(logical => logical.offerId === selection.selected.offerId)
    ) {
      return false
    }
    const binding = inventoryBindingForOffer(offer)
    if (
      binding === undefined ||
      binding.record.artifactDigest !== selection.selected.artifactDigest ||
      binding.record.manifestDigest !== selection.selected.manifestDigest
    ) {
      return false
    }
    const spec = binding.contribution.manifest?.spec as CodecContributionSpecV1Wire | undefined
    return spec?.sourceTopology === selection.selected.sourceTopology
  })
  if (matches.length !== 1) {
    return fail(
      'x3.host/detection-selection-unavailable',
      `current inventory has ${matches.length} exact matches for the codec detection selection`,
    )
  }
  return selection
}
