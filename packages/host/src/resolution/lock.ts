/**
 * Portable provider-policy lock emission (owner: MK3/23 §11). Byte-stable: canonical
 * JSON, unique UTF-8-sorted ID lists, normalized range, entries sorted by key —
 * independent of request/registration/shuffle order. The lock never contains
 * OS/architecture, runtime variants, artifacts, secrets or grants (23 §11).
 */

import {
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  isQualifiedId,
  isTraitId,
  ModkitError,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
} from '@modkit/core'
import type {
  ProviderLockKey,
  ProviderPolicyLockEntry,
  ProviderRequest,
  ResolutionResult,
  TraitDefinitionRequirement,
} from '@modkit/sdk'
import { isStandardTraitId } from '@modkit/sdk'
import { isResolutionForRequest, resolveProvider, RESOLVER_VERSION } from './resolver.js'

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

export interface ProviderPolicyLock {
  readonly schemaVersion: 1
  readonly entries: readonly ProviderPolicyLockEntry[]
}

function failLock(message: string, context?: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.host/invalid-policy-lock',
    message,
    ...(context === undefined ? {} : { context }),
  })
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failLock(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  if (
    required.some(key => !(key in record)) ||
    Object.keys(record).some(key => !allowed.has(key))
  ) {
    return failLock(`${label} has missing or unknown fields`)
  }
  return record
}

function lockString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return failLock(`${label} must be a non-blank string`)
  }
  return value
}

function lockMajor(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return failLock(`${label} must be a safe non-negative integer`)
  }
  return value as number
}

function parseLockedTrait(value: unknown, label: string): TraitDefinitionRequirement {
  const record = exactKeys(value, ['id'], ['definitionRange'], label)
  const idText = lockString(record.id, `${label}.id`)
  if (!isTraitId(idText)) return failLock(`${label}.id must be a trait id`)
  if (isStandardTraitId(idText)) {
    if (record.definitionRange !== undefined) {
      return failLock(`${label}: a standard trait cannot carry definitionRange`)
    }
    return Object.freeze({ id: idText })
  }
  const rangeText = lockString(record.definitionRange, `${label}.definitionRange`)
  const range = parseVersionRange(rangeText)
  if (range === undefined || range.normalized !== rangeText) {
    return failLock(`${label}.definitionRange is not canonical`)
  }
  return Object.freeze({ id: idText, definitionRange: rangeText })
}

function parseLockedTraits(value: unknown, label: string): readonly TraitDefinitionRequirement[] {
  if (!Array.isArray(value)) return failLock(`${label} must be an array`)
  const parsed = value.map((item, index) => parseLockedTrait(item, `${label}[${index}]`))
  const normalized = normalizeTraitRequirements(parsed)
  if (canonicalJsonStringify(parsed) !== canonicalJsonStringify(normalized)) {
    return failLock(`${label} must be unique and canonically sorted`)
  }
  return normalized
}

function parseLockKey(value: unknown, label: string): ProviderLockKey {
  const record = exactKeys(
    value,
    ['contract', 'major', 'normalizedRange', 'requiredOutputs', 'preferredOutputs'],
    ['contractSelectionKey', 'operation', 'workload'],
    label,
  )
  const contractText = lockString(record.contract, `${label}.contract`)
  if (!isQualifiedId(contractText)) return failLock(`${label}.contract must be qualified`)
  const rangeText = lockString(record.normalizedRange, `${label}.normalizedRange`)
  const range = parseVersionRange(rangeText)
  if (range === undefined || range.normalized !== rangeText) {
    return failLock(`${label}.normalizedRange is not canonical`)
  }
  const workload = record.workload
  if (
    workload !== undefined &&
    !['thumbnail', 'interactive', 'batch', 'lossless-edit', 'simulation', 'archival'].includes(
      String(workload),
    )
  ) {
    return failLock(`${label}.workload is invalid`)
  }
  return Object.freeze({
    contract: contractId(contractText),
    major: lockMajor(record.major, `${label}.major`),
    normalizedRange: rangeText,
    ...(record.contractSelectionKey === undefined
      ? {}
      : {
          contractSelectionKey: lockString(
            record.contractSelectionKey,
            `${label}.contractSelectionKey`,
          ),
        }),
    ...(record.operation === undefined
      ? {}
      : {
          operation: lockString(record.operation, `${label}.operation`) as NonNullable<
            ProviderLockKey['operation']
          >,
        }),
    requiredOutputs: parseLockedTraits(record.requiredOutputs, `${label}.requiredOutputs`),
    preferredOutputs: parseLockedTraits(record.preferredOutputs, `${label}.preferredOutputs`),
    ...(workload === undefined
      ? {}
      : { workload: workload as NonNullable<ProviderLockKey['workload']> }),
  })
}

function parseSelection(value: unknown, label: string): ProviderPolicyLockEntry['primary'] {
  const record = exactKeys(
    value,
    ['extension', 'contributionId', 'contractMajor', 'offerId'],
    ['releaseRange'],
    label,
  )
  const extension = lockString(record.extension, `${label}.extension`)
  const contributionId = lockString(record.contributionId, `${label}.contributionId`)
  if (!isQualifiedId(extension) || !isQualifiedId(contributionId)) {
    return failLock(`${label} coordinates must be qualified`)
  }
  let releaseRange: string | undefined
  if (record.releaseRange !== undefined) {
    releaseRange = lockString(record.releaseRange, `${label}.releaseRange`)
    const parsed = parseVersionRange(releaseRange)
    if (parsed === undefined || parsed.normalized !== releaseRange) {
      return failLock(`${label}.releaseRange is not canonical`)
    }
  }
  return Object.freeze({
    extension,
    ...(releaseRange === undefined ? {} : { releaseRange }),
    contributionId,
    contractMajor: lockMajor(record.contractMajor, `${label}.contractMajor`),
    offerId: lockString(record.offerId, `${label}.offerId`),
  })
}

/** Strict inert read: exact keys, brands, canonical ranges/order and duplicate-key rejection. */
export function parsePolicyLock(text: string): ProviderPolicyLock {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return failLock('policy lock is not valid JSON')
  }
  const root = exactKeys(value, ['schemaVersion', 'entries'], [], 'policy lock')
  if (root.schemaVersion !== 1 || !Array.isArray(root.entries)) {
    return failLock('policy lock schemaVersion/entries are invalid')
  }
  const entries = root.entries.map((raw, index) => {
    const item = exactKeys(
      raw,
      ['key', 'primary', 'resolverVersion'],
      ['allowedFallbacks'],
      `entries[${index}]`,
    )
    if (item.resolverVersion !== RESOLVER_VERSION) {
      return failLock(`entries[${index}].resolverVersion is unsupported`)
    }
    if (item.allowedFallbacks !== undefined && !Array.isArray(item.allowedFallbacks)) {
      return failLock(`entries[${index}].allowedFallbacks must be an array`)
    }
    return Object.freeze({
      key: parseLockKey(item.key, `entries[${index}].key`),
      primary: parseSelection(item.primary, `entries[${index}].primary`),
      ...(item.allowedFallbacks === undefined
        ? {}
        : {
            allowedFallbacks: Object.freeze(
              item.allowedFallbacks.map((entry, fallbackIndex) =>
                parseSelection(entry, `entries[${index}].allowedFallbacks[${fallbackIndex}]`),
              ),
            ),
          }),
      resolverVersion: RESOLVER_VERSION,
    }) satisfies ProviderPolicyLockEntry
  })
  const canonical = serializePolicyLock(entries)
  if (canonical !== text) return failLock('policy lock bytes are not canonical')
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) })
}

/** Replay one exact key and verify that current inventory still offers the locked selection. */
export function replayPolicyLock(
  request: ProviderRequest,
  offers: readonly import('@modkit/sdk').ProviderOffer[],
  text: string,
): ResolutionResult {
  const lock = parsePolicyLock(text)
  const requestKey = buildLockKey(request)
  const candidates = lock.entries.filter(entry => {
    const portable = Object.fromEntries(
      Object.entries(entry.key).filter(([field]) => field !== 'contractSelectionKey'),
    )
    return canonicalJsonStringify(portable) === canonicalJsonStringify(requestKey)
  })
  if (candidates.length !== 1) {
    throw new ModkitError({
      code: 'x3.host/lock-key-unresolved',
      message: `policy lock contains ${candidates.length} entries for the request key`,
    })
  }
  const locked = candidates[0] as ProviderPolicyLockEntry
  const available = offers.filter(offer => {
    if (
      offer.extensionId !== locked.primary.extension ||
      offer.providerId !== locked.primary.contributionId
    ) {
      return false
    }
    if (locked.primary.releaseRange !== undefined) {
      const version = parseSemver(offer.extensionVersion)
      const range = parseVersionRange(locked.primary.releaseRange)
      if (version === undefined || range === undefined || !satisfiesRange(version, range))
        return false
    }
    return offer.provides.some(
      provided =>
        provided.major === locked.primary.contractMajor &&
        provided.offerId === locked.primary.offerId,
    )
  })
  return resolveProvider(
    {
      ...request,
      pin: {
        providerId: locked.primary.contributionId,
        offerId: locked.primary.offerId,
      },
    },
    available,
  )
}
