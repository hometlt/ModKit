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
  parseSemver,
  parseVersionRange,
  uniqueSortedUtf8,
} from '@modkitx-x3/core'
import type {
  ProviderLockKey,
  ProviderPolicyLockEntry,
  ProviderRequest,
  ResolutionResult,
} from '@modkitx-x3/sdk'
import { RESOLVER_VERSION } from './resolver.js'

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
    requiredOutputs: uniqueSortedUtf8(request.requiredOutputs ?? []),
    preferredOutputs: uniqueSortedUtf8(request.preferredOutputs ?? []),
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
  const offer = result.selected.offer
  const major = parseSemver(result.selected.resolvedContract.version)?.major
  return {
    key: buildLockKey(request),
    primary: {
      extension: offer.extensionId,
      contributionId: offer.providerId,
      contractMajor: major ?? request.contract.major,
    },
    resolverVersion: RESOLVER_VERSION,
  }
}

function lockKeyString(key: ProviderLockKey): string {
  return canonicalJsonStringify(key)
}

/** Canonical byte-stable serialization of a whole policy lock. */
export function serializePolicyLock(entries: readonly ProviderPolicyLockEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    compareUtf8(lockKeyString(a.key), lockKeyString(b.key)),
  )
  return canonicalJsonStringify({ schemaVersion: 1, entries: sorted })
}
