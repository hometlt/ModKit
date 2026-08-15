/**
 * Portable provider-policy lock emission (owner: MK3/23 §11). Byte-stable: canonical
 * JSON, unique UTF-8-sorted ID lists, normalized range, entries sorted by key —
 * independent of request/registration/shuffle order. The lock never contains
 * OS/architecture, runtime variants, artifacts, secrets or grants (23 §11).
 */

import {
  canonicalJsonStringify,
  compareUtf8,
  ModkitError,
  parseVersionRange,
} from '@modkitx-x3/core'
import type {
  ProviderLockKey,
  ProviderPolicyLockEntry,
  ProviderRequest,
  ResolutionResult,
  TraitDefinitionRequirement,
} from '@modkitx-x3/sdk'
import { isStandardTraitId } from '@modkitx-x3/sdk'
import { isResolutionForRequest, RESOLVER_VERSION } from './resolver.js'

function normalizeTraitRequirements(
  values: readonly TraitDefinitionRequirement[] | undefined,
): readonly TraitDefinitionRequirement[] {
  const normalized = new Map<string, TraitDefinitionRequirement>()
  for (const value of values ?? []) {
    let item: TraitDefinitionRequirement
    if (isStandardTraitId(value.id)) {
      if (value.definitionRange !== undefined) {
        throw new ModkitError({
          code: 'x3.host/invalid-trait-range',
          message: `standard trait ${value.id} must not declare a definition range`,
        })
      }
      item = { id: value.id }
    } else {
      const range =
        value.definitionRange === undefined ? undefined : parseVersionRange(value.definitionRange)
      if (range === undefined) {
        throw new ModkitError({
          code: 'x3.host/invalid-trait-range',
          message: `custom trait ${value.id} requires a parseable definition range`,
        })
      }
      item = { id: value.id, definitionRange: range.normalized }
    }
    normalized.set(canonicalJsonStringify(item), item)
  }
  return [...normalized.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([, item]) => item)
}

export function buildLockKey(request: ProviderRequest): ProviderLockKey {
  const range = parseVersionRange(request.contract.range ?? '*')
  if (range === undefined) {
    throw new ModkitError({
      code: 'x3.host/invalid-range',
      message: `unparseable range «${request.contract.range ?? ''}»`,
    })
  }
  return {
    contract: request.contract.contract,
    major: request.contract.major,
    normalizedRange: range.normalized,
    ...(request.operation === undefined ? {} : { operation: request.operation }),
    requiredOutputs: normalizeTraitRequirements(request.requiredOutputs),
    preferredOutputs: normalizeTraitRequirements(request.preferredOutputs),
    ...(request.workload === undefined ? {} : { workload: request.workload }),
  }
}

export function buildLockEntry(
  request: ProviderRequest,
  result: ResolutionResult,
): ProviderPolicyLockEntry {
  if (result.state !== 'resolved') {
    throw new ModkitError({
      code: 'x3.host/lock-of-unresolved',
      message: `cannot lock an unresolved result (${result.reason})`,
    })
  }
  if (!isResolutionForRequest(result, request)) {
    throw new ModkitError({
      code: 'x3.host/lock-request-mismatch',
      message: 'resolution result was not produced for this exact request',
    })
  }
  const offer = result.selected.offer
  return {
    key: {
      ...buildLockKey(request),
      ...(result.selected.contractSelectionKey === undefined
        ? {}
        : { contractSelectionKey: result.selected.contractSelectionKey }),
    },
    primary: {
      extension: offer.extensionId,
      contributionId: offer.providerId,
      contractMajor: result.selected.resolvedContract.major,
      offerId: result.selected.resolvedContract.offerId,
    },
    resolverVersion: RESOLVER_VERSION,
  }
}

function lockKeyString(key: ProviderLockKey): string {
  return canonicalJsonStringify(key)
}

/**
 * Canonical byte-stable serialization of a whole policy lock (MK3/23 §11, §16.5).
 *
 * Two guarantees, both needed for «lock round-trip deterministic, independent of
 * object/directory order»:
 *
 *  1. one key resolves to one selection — entries sharing a `ProviderLockKey` while
 *     selecting differently are refused loudly, because the same request cannot have two
 *     answers (the earlier version silently kept input order here);
 *  2. ties fall back to the full canonical entry, not just the key, so no pair of entries
 *     can depend on the input sequence.
 */
export function serializePolicyLock(entries: readonly ProviderPolicyLockEntry[]): string {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const key = lockKeyString(entry.key)
    const rendered = canonicalJsonStringify(entry)
    const prior = seen.get(key)
    if (prior !== undefined && prior !== rendered) {
      throw new ModkitError({
        code: 'x3.host/conflicting-lock-entries',
        message:
          'two policy-lock entries share one key but select differently — one request cannot have two answers',
        context: { key },
      })
    }
    seen.set(key, rendered)
  }
  const sorted = [...entries].sort((a, b) => {
    const byKey = compareUtf8(lockKeyString(a.key), lockKeyString(b.key))
    return byKey !== 0 ? byKey : compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b))
  })
  return canonicalJsonStringify({ schemaVersion: 1, entries: sorted })
}
