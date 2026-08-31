import { canonicalJsonStringify, compareUtf8 } from '@modkit/core'
import {
  algorithmQualifiedDigest,
  type JsonValue,
  type PresentationPlan,
  type ScopedSemanticHash,
  type SemanticScopeRef,
} from '@modkit/sdk'

export interface PresentationSemanticHashRequest {
  /** A scope name owns which semantic fields the caller supplied in `semantic`. */
  readonly scope: SemanticScopeRef
  /** The immutable host-selected plan consumed by the UI/headless surface. */
  readonly plan: PresentationPlan
  /** Renderer-neutral model/world value for the named scope; never pixels or app chrome. */
  readonly semantic: unknown
}

function jsonValue(value: unknown, path = '$'): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`)
    return value === 0 ? 0 : value
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]
    }
    return Array.from(value as unknown as ArrayLike<number>, item => jsonValue(item, `${path}[]`))
  }
  if (value instanceof ArrayBuffer) return [...new Uint8Array(value)]
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-record object`)
    }
    const record: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) record[key] = jsonValue(item, `${path}.${key}`)
    }
    return record
  }
  throw new TypeError(`${path} contains a non-JSON value`)
}

function selectedSlot(plan: PresentationPlan) {
  const slot =
    plan.activeStage === undefined
      ? plan.fallback
      : plan.slots.find(candidate => candidate.slotId === plan.activeStage)
  if (slot === undefined) throw new TypeError('presentation plan has no selected slot')
  return slot
}

/**
 * Hash only renderer-neutral presentation semantics.
 *
 * Subject URI, local paths, codec/game identity, app identity and pixel output are deliberately
 * absent. The selected common viewer slot and its versioned data-source bindings remain, so a
 * facet contract change cannot compare equal to the old meaning.
 */
export async function presentationSemanticHash(
  request: PresentationSemanticHashRequest,
): Promise<ScopedSemanticHash> {
  const slot = selectedSlot(request.plan)
  const bindings = [...slot.bindings]
    .sort((left, right) => compareUtf8(left.bindingId, right.bindingId))
    .map(binding => {
      const source = 'dataSource' in binding ? binding.dataSource : binding
      return {
        bindingId: binding.bindingId,
        contract: source.contract,
        major: source.major,
      }
    })
  const canonical = canonicalJsonStringify({
    schemaVersion: 1,
    scope: request.scope,
    presentation: {
      slotId: slot.slotId,
      contributionId: slot.contributionId,
      bindings,
    },
    semantic: jsonValue(request.semantic),
  })
  const bytes = new TextEncoder().encode(canonical)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  const hex = [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
  return Object.freeze({
    scope: Object.freeze({ ...request.scope }),
    hash: algorithmQualifiedDigest(`sha256:${hex}`),
  })
}
