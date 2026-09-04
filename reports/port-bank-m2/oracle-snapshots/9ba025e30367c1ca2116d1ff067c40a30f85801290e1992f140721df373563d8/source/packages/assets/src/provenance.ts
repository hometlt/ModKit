/**
 * Serializable provenance for an asset source.
 *
 * Provenance is deliberately a sidecar rather than a field on `AssetDescriptor` v1. The
 * descriptor wire contract therefore stays unchanged while hosts can retain the ordered source,
 * container, mount, dependency, and transformation history that produced an asset.
 */

import { ModkitError } from '@modkitx/core/errors'
import { isJsonSerializable, type JsonValue } from './json.js'
import type { AssetSourceDescriptor } from './source.js'

export const ASSET_PROVENANCE_SCHEMA_VERSION = 1 as const

export const ASSET_PROVENANCE_STEP_KINDS = [
  'source',
  'container',
  'mount',
  'overlay',
  'dependency',
  'transform',
  'generated',
] as const

export type AssetProvenanceStepKind = (typeof ASSET_PROVENANCE_STEP_KINDS)[number]

/** One edge in a deterministic, linear source history. */
export interface AssetProvenanceStep {
  /** Stable and unique within one provenance value. */
  readonly id: string
  readonly kind: AssetProvenanceStepKind
  /** Omitted only when this is the first step and no input source is known. */
  readonly inputSourceId?: string
  readonly outputSourceId: string
  /** Stable provider, codec, mount, or host ID responsible for the step. */
  readonly actorId?: string
  /** Optional serializable metadata; runtime handles and byte payloads are forbidden. */
  readonly detail?: JsonValue
}

/** Schema-v1 linear provenance sidecar for one final source. */
export interface AssetProvenance {
  readonly schemaVersion: typeof ASSET_PROVENANCE_SCHEMA_VERSION
  /** Must equal the final step's `outputSourceId`. */
  readonly sourceId: string
  readonly steps: readonly AssetProvenanceStep[]
}

interface ProvenanceValidationFailure {
  readonly reason: string
  readonly stepIndex?: number
  readonly stepId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isKnownStepKind(value: unknown): value is AssetProvenanceStepKind {
  return (
    typeof value === 'string' && (ASSET_PROVENANCE_STEP_KINDS as readonly string[]).includes(value)
  )
}

function validationFailure(value: unknown): ProvenanceValidationFailure | undefined {
  if (!isRecord(value)) return { reason: 'provenance-not-object' }
  if (value['schemaVersion'] !== ASSET_PROVENANCE_SCHEMA_VERSION) {
    return { reason: 'schema-version-invalid' }
  }
  if (!isNonEmptyString(value['sourceId'])) return { reason: 'source-id-empty' }
  if (!Array.isArray(value['steps']) || value['steps'].length === 0) {
    return { reason: 'steps-empty' }
  }

  const stepIds = new Set<string>()
  let previousOutputSourceId: string | undefined
  for (let stepIndex = 0; stepIndex < value['steps'].length; stepIndex += 1) {
    const step = value['steps'][stepIndex]
    if (!isRecord(step)) return { reason: 'step-not-object', stepIndex }
    const stepId = typeof step['id'] === 'string' ? step['id'] : undefined
    const atStep = (reason: string): ProvenanceValidationFailure => ({
      reason,
      stepIndex,
      ...(stepId === undefined ? {} : { stepId }),
    })

    if (!isNonEmptyString(step['id'])) return atStep('step-id-empty')
    if (stepIds.has(step['id'])) return atStep('step-id-duplicate')
    stepIds.add(step['id'])
    if (!isKnownStepKind(step['kind'])) return atStep('step-kind-invalid')
    if (!isNonEmptyString(step['outputSourceId'])) return atStep('output-source-id-empty')
    if (step['inputSourceId'] !== undefined && !isNonEmptyString(step['inputSourceId'])) {
      return atStep('input-source-id-empty')
    }
    if (step['actorId'] !== undefined && !isNonEmptyString(step['actorId'])) {
      return atStep('actor-id-empty')
    }
    if (step['detail'] !== undefined && !isJsonSerializable(step['detail'])) {
      return atStep('step-detail-not-json-serializable')
    }
    if (stepIndex > 0 && step['inputSourceId'] !== previousOutputSourceId) {
      return atStep('step-chain-disconnected')
    }
    if (!isJsonSerializable(step)) return atStep('step-not-json-serializable')
    previousOutputSourceId = step['outputSourceId']
  }

  if (previousOutputSourceId !== value['sourceId']) {
    return { reason: 'final-output-source-id-mismatch', stepIndex: value['steps'].length - 1 }
  }
  if (!isJsonSerializable(value)) return { reason: 'provenance-not-json-serializable' }
  return undefined
}

/** Runtime structural validator. Invalid input is reported as `false`, never thrown. */
export function isAssetProvenance(value: unknown): value is AssetProvenance {
  try {
    return validationFailure(value) === undefined
  } catch {
    return false
  }
}

function invalidProvenance(
  operation: 'from-source-descriptor' | 'append',
  failure: ProvenanceValidationFailure,
  sourceId?: string,
): ModkitError {
  return new ModkitError({
    code: 'CONFIG_INVALID',
    message: 'Asset provenance is invalid.',
    context: {
      operation,
      reason: failure.reason,
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(failure.stepIndex === undefined ? {} : { stepIndex: failure.stepIndex }),
      ...(failure.stepId === undefined ? {} : { stepId: failure.stepId }),
    },
  })
}

function descriptorStepKind(descriptor: AssetSourceDescriptor): AssetProvenanceStepKind {
  if (descriptor.kind === 'archive-entry') return 'container'
  if (descriptor.kind === 'vfs-root') return 'mount'
  return 'source'
}

/**
 * Projects a descriptor's parent chain into an outermost-parent-to-leaf provenance history.
 * Descriptor objects are read only; no links are reversed or otherwise mutated.
 */
export function assetProvenanceFromSourceDescriptor(
  descriptor: AssetSourceDescriptor,
): AssetProvenance {
  const descriptors: AssetSourceDescriptor[] = []
  const visited = new Set<AssetSourceDescriptor>()
  let current: AssetSourceDescriptor | undefined = descriptor
  while (current !== undefined) {
    if (visited.has(current)) {
      throw invalidProvenance(
        'from-source-descriptor',
        { reason: 'source-parent-cycle' },
        descriptor.id,
      )
    }
    visited.add(current)
    descriptors.push(current)
    current = current.parent
  }
  descriptors.reverse()

  const steps: AssetProvenanceStep[] = descriptors.map((source, stepIndex) => ({
    id: `source-chain:${stepIndex}`,
    kind: descriptorStepKind(source),
    ...(stepIndex === 0 ? {} : { inputSourceId: descriptors[stepIndex - 1]!.id }),
    outputSourceId: source.id,
    ...(source.providerId === undefined ? {} : { actorId: source.providerId }),
  }))
  const provenance: AssetProvenance = {
    schemaVersion: ASSET_PROVENANCE_SCHEMA_VERSION,
    sourceId: descriptor.id,
    steps,
  }
  const failure = validationFailure(provenance)
  if (failure !== undefined) {
    throw invalidProvenance('from-source-descriptor', failure, descriptor.id)
  }
  return provenance
}

/** Returns a new provenance value with one continuous final step appended. */
export function appendAssetProvenanceStep(
  provenance: AssetProvenance,
  step: AssetProvenanceStep,
): AssetProvenance {
  const existingFailure = validationFailure(provenance)
  if (existingFailure !== undefined) {
    throw invalidProvenance('append', existingFailure, provenance.sourceId)
  }
  const next: AssetProvenance = {
    schemaVersion: ASSET_PROVENANCE_SCHEMA_VERSION,
    sourceId: step.outputSourceId,
    steps: [...provenance.steps, { ...step }],
  }
  const failure = validationFailure(next)
  if (failure !== undefined) throw invalidProvenance('append', failure, next.sourceId)
  return next
}
