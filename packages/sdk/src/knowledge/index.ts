/**
 * Protocol-neutral knowledge-pack contracts.
 *
 * Knowledge is untrusted, data-only explanatory material. It can cite schema facts and source
 * code, but it never becomes schema authority and never grants an operation or permission.
 */

import { canonicalJsonStringify, compareUtf8, isQualifiedId } from '@modkit/core'
import type { JsonValue } from '../asset-capabilities/types.js'

export type KnowledgeClaimKind =
  'schema-derived-fact' | 'documented-interpretation' | 'community-note' | 'external-reference'

export type KnowledgeConfidence = 'verified' | 'high' | 'medium' | 'low'

export const KNOWLEDGE_LOCALE_PATTERN = '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$'
const knowledgeLocalePattern = new RegExp(KNOWLEDGE_LOCALE_PATTERN, 'u')

export const isKnowledgeLocaleTag = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && knowledgeLocalePattern.test(value)

export interface KnowledgeSchemaCoordinate {
  readonly contract: string
  readonly major: number
  /** Exact digest, build id or other codec-owned schema revision. */
  readonly revision: string
}

export type KnowledgeTarget =
  | {
      readonly kind: 'field'
      readonly ecosystem: string
      readonly schema: KnowledgeSchemaCoordinate
      readonly typeId: string
      readonly canonicalPath: readonly string[]
    }
  | {
      readonly kind: 'subject'
      readonly ecosystem: string
      readonly subjectKind: string
      readonly subjectId?: string
    }
  | {
      readonly kind: 'format'
      readonly ecosystem: string
      readonly formatId: string
    }
  | {
      readonly kind: 'diagnostic'
      readonly ecosystem: string
      readonly code: string
    }
  | {
      readonly kind: 'concept'
      readonly ecosystem: string
      readonly conceptId: string
    }

export interface KnowledgeSource {
  readonly kind:
    | 'schema'
    | 'official-documentation'
    | 'source-code'
    | 'community-wiki'
    | 'observed-corpus'
    | 'external-reference'
  readonly title: string
  /** Direct HTTPS link to the complete external material, when one exists. */
  readonly url?: string
  /** Exact schema coordinate when the source represents schema authority. */
  readonly schema?: KnowledgeSchemaCoordinate
  readonly revision?: string
  readonly license?: string
  readonly reviewedAt: string
}

export interface KnowledgeValueDetails {
  /** Advisory copy for display; the active schema remains authoritative when values differ. */
  readonly valueType?: string
  readonly units?: string
  readonly defaultValue?: JsonValue
  readonly allowedValues?: readonly JsonValue[]
  readonly deprecated?: boolean
  readonly formulaRole?: string
}

export interface KnowledgeRelationHint {
  readonly role: string
  readonly target: KnowledgeTarget
}

export interface KnowledgeExample {
  readonly title: string
  readonly text: string
}

export interface KnowledgeEntry {
  /** Stable publisher-qualified logical id. Translations reuse the same id with another locale. */
  readonly id: string
  readonly target: KnowledgeTarget
  readonly locale: string
  readonly title: string
  /** Own short summary; copied third-party article bodies do not belong here. */
  readonly summary: string
  readonly claimKind: KnowledgeClaimKind
  readonly confidence: KnowledgeConfidence
  readonly aliases?: readonly string[]
  readonly keywords?: readonly string[]
  readonly details?: KnowledgeValueDetails
  readonly relations?: readonly KnowledgeRelationHint[]
  readonly examples?: readonly KnowledgeExample[]
  readonly sources: readonly KnowledgeSource[]
}

export interface KnowledgePackSpecV1 {
  readonly schemaVersion: 1
  readonly sourceLocale: string
  /** Higher priority sorts first, but never silently erases another publisher's entry. */
  readonly priority: number
  readonly gameIds?: readonly string[]
  /** Entries carried in the manifest itself. Exactly one of `entries` and `entriesPath` is set. */
  readonly entries?: readonly KnowledgeEntry[]
  /**
   * A JSON file of this extension (`{ "entries": [...] }`, a portable relative path) that holds
   * the entries instead. The host reads, attests and validates it when knowledge is first
   * queried, so a large pack costs nothing while every window builds its inventory.
   */
  readonly entriesPath?: string
}

/** The external entries file named by `KnowledgePackSpecV1.entriesPath`. */
export interface KnowledgePackEntriesFileV1 {
  readonly entries: readonly KnowledgeEntry[]
}

/** Wire and runtime shapes coincide because the contribution is strictly JSON-only. */
export type KnowledgePackSpecV1Wire = KnowledgePackSpecV1

export interface KnowledgeEntryProvenance {
  readonly packId: string
  readonly ownerExtensionId: string
  readonly extensionVersion: string
  readonly manifestPath: string
  readonly manifestDigest: string
  readonly artifactDigest: string
}

export interface KnowledgeHit {
  readonly entry: KnowledgeEntry
  readonly provenance: KnowledgeEntryProvenance
  /** Zero is the requested locale; larger values are deterministic fallbacks. */
  readonly localeRank: number
}

export interface KnowledgePage {
  readonly snapshotId: string
  readonly total: number
  readonly items: readonly KnowledgeHit[]
  readonly nextCursor?: string
  readonly completeness: 'complete' | 'capped' | 'invalid'
  readonly diagnostics: readonly KnowledgeDiagnostic[]
}

export interface KnowledgeDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity: 'error' | 'warning' | 'information'
}

export interface KnowledgeSearchQuery {
  readonly text?: string
  readonly target?: KnowledgeTarget
  readonly locales: readonly string[]
  readonly claimKinds?: readonly KnowledgeClaimKind[]
  readonly limit?: number
  readonly cursor?: string
}

export interface KnowledgeResolveQuery {
  readonly target: KnowledgeTarget
  readonly locales: readonly string[]
  readonly limit?: number
  readonly cursor?: string
}

/** A snapshot view built from inventory facts; not a second stateful registry. */
export interface KnowledgeCatalog {
  readonly snapshotId: string
  search(query: KnowledgeSearchQuery, signal?: AbortSignal): Promise<KnowledgePage>
  resolve(query: KnowledgeResolveQuery, signal?: AbortSignal): Promise<KnowledgePage>
}

/** A denominator-backed metric. A missing denominator is unknown, never an implicit 100%. */
export interface KnowledgeCoverageMetric {
  readonly covered: number
  readonly total: number
  readonly percent: number | null
}

export interface KnowledgeLocaleCoverage {
  readonly locale: string
  readonly coverage: KnowledgeCoverageMetric
}

export interface KnowledgeStaleFieldTarget {
  readonly authorityTargetKey: string
  readonly knowledgeTargetKey: string
}

/**
 * Derived quality report over an owner-provided authority census and knowledge entries.
 * The census remains the denominator and schema authority; this report is not another registry.
 */
export interface KnowledgeCoverageReport {
  readonly authorityTargetCount: number
  readonly entryCount: number
  /** Any exact target entry exists, independent of the quality of its prose. */
  readonly structuralCoverage: KnowledgeCoverageMetric
  /** At least one exact target entry has a non-empty title and summary. */
  readonly descriptiveCoverage: KnowledgeCoverageMetric
  /** At least one interpretation cites evidence other than the schema itself. */
  readonly researchedSemanticCoverage: KnowledgeCoverageMetric
  readonly provenanceCoverage: KnowledgeCoverageMetric
  readonly exampleCoverage: KnowledgeCoverageMetric
  readonly localeCoverage: readonly KnowledgeLocaleCoverage[]
  readonly missingTargetKeys: readonly string[]
  readonly orphanTargetKeys: readonly string[]
  readonly duplicateAuthorityTargetKeys: readonly string[]
  readonly duplicateEntryLocales: readonly {
    readonly targetKey: string
    readonly locale: string
    readonly entryIds: readonly string[]
  }[]
  readonly staleFieldTargets: readonly KnowledgeStaleFieldTarget[]
}

export interface KnowledgeCoverageOptions {
  /** Exact documentation locales to measure independently. At most 16 validated locale tags. */
  readonly requiredLocales?: readonly string[]
}

const localeKey = (locale: string): string => locale.toLowerCase()

const isBoundedString = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const accepted = new Set(allowed)
  return Object.keys(value).every(key => accepted.has(key))
}

const isKnowledgeSchemaCoordinate = (value: unknown): value is KnowledgeSchemaCoordinate => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['contract', 'major', 'revision'])) return false
  return (
    isBoundedString(value['contract'], 256) &&
    isQualifiedId(value['contract']) &&
    typeof value['major'] === 'number' &&
    Number.isSafeInteger(value['major']) &&
    value['major'] >= 0 &&
    isBoundedString(value['revision'], 256)
  )
}

/** Runtime guard for JSON/MCP/UI boundaries; TypeScript types alone are not an input validator. */
export function isKnowledgeTarget(value: unknown): value is KnowledgeTarget {
  try {
    if (!isRecord(value) || !isBoundedString(value['ecosystem'], 128)) return false
    switch (value['kind']) {
      case 'field':
        return (
          hasOnlyKeys(value, ['kind', 'ecosystem', 'schema', 'typeId', 'canonicalPath']) &&
          isKnowledgeSchemaCoordinate(value['schema']) &&
          isBoundedString(value['typeId'], 128) &&
          Array.isArray(value['canonicalPath']) &&
          value['canonicalPath'].length >= 1 &&
          value['canonicalPath'].length <= 32 &&
          value['canonicalPath'].every(item => isBoundedString(item, 128))
        )
      case 'subject':
        return (
          hasOnlyKeys(value, ['kind', 'ecosystem', 'subjectKind', 'subjectId']) &&
          isBoundedString(value['subjectKind'], 128) &&
          (value['subjectId'] === undefined || isBoundedString(value['subjectId'], 512))
        )
      case 'format':
        return (
          hasOnlyKeys(value, ['kind', 'ecosystem', 'formatId']) &&
          isBoundedString(value['formatId'], 128)
        )
      case 'diagnostic':
        return (
          hasOnlyKeys(value, ['kind', 'ecosystem', 'code']) && isBoundedString(value['code'], 256)
        )
      case 'concept':
        return (
          hasOnlyKeys(value, ['kind', 'ecosystem', 'conceptId']) &&
          isBoundedString(value['conceptId'], 128)
        )
      default:
        return false
    }
  } catch {
    return false
  }
}

/** Exact locale → parent locale → user fallbacks → source locale, with stable de-duplication. */
export function knowledgeLocaleFallbacks(
  requested: string,
  userFallbacks: readonly string[],
  sourceLocale: string,
): readonly string[] {
  const candidates: string[] = []
  const append = (locale: string): void => {
    const trimmed = locale.trim()
    if (trimmed === '') return
    const subtags = trimmed.split('-')
    while (subtags.length > 0) {
      candidates.push(subtags.join('-'))
      subtags.pop()
      if (subtags.length > 1 && subtags[subtags.length - 1]?.length === 1) subtags.pop()
    }
  }
  append(requested)
  for (const locale of userFallbacks) append(locale)
  append(sourceLocale)
  const seen = new Set<string>()
  return Object.freeze(
    candidates.filter(locale => {
      const key = localeKey(locale)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  )
}

/** Canonical exact target key used by headless, UI and adapter layers alike. */
export function knowledgeTargetKey(target: KnowledgeTarget): string {
  if (!isKnowledgeTarget(target)) throw new TypeError('knowledge target is malformed or unbounded')
  return canonicalJsonStringify(target)
}

const coverageMetric = (covered: number, total: number): KnowledgeCoverageMetric => ({
  covered,
  total,
  percent: total === 0 ? null : Number(((covered / total) * 100).toFixed(2)),
})

const fieldTargetIdentityWithoutRevision = (target: KnowledgeTarget): string | undefined => {
  if (target.kind !== 'field') return undefined
  return canonicalJsonStringify({
    kind: target.kind,
    ecosystem: target.ecosystem,
    schema: { contract: target.schema.contract, major: target.schema.major },
    typeId: target.typeId,
    canonicalPath: target.canonicalPath,
  })
}

/**
 * Evaluate knowledge quality without copying, weakening, or interpreting the authority schema.
 * Targets and entries must come from already validated owner/knowledge contracts.
 */
export function evaluateKnowledgeCoverage(
  authorityTargets: readonly KnowledgeTarget[],
  entries: readonly KnowledgeEntry[],
  options: KnowledgeCoverageOptions = {},
): KnowledgeCoverageReport {
  const requestedLocales = options.requiredLocales ?? []
  if (
    requestedLocales.length > 16 ||
    requestedLocales.some(locale => !isKnowledgeLocaleTag(locale))
  ) {
    throw new TypeError('required knowledge coverage locales must be at most 16 valid locale tags')
  }
  const authorityByKey = new Map<string, KnowledgeTarget>()
  const duplicateAuthorityTargetKeys = new Set<string>()
  for (const target of authorityTargets) {
    const key = knowledgeTargetKey(target)
    if (authorityByKey.has(key)) duplicateAuthorityTargetKeys.add(key)
    else authorityByKey.set(key, target)
  }

  const entriesByTarget = new Map<string, KnowledgeEntry[]>()
  const entryLocales = new Map<string, { targetKey: string; locale: string; entryIds: string[] }>()
  for (const entry of entries) {
    const targetKey = knowledgeTargetKey(entry.target)
    const targetEntries = entriesByTarget.get(targetKey) ?? []
    targetEntries.push(entry)
    entriesByTarget.set(targetKey, targetEntries)

    const locale = entry.locale.toLowerCase()
    const coordinate = `${targetKey}\u0000${locale}`
    const group = entryLocales.get(coordinate) ?? { targetKey, locale, entryIds: [] }
    group.entryIds.push(entry.id)
    entryLocales.set(coordinate, group)
  }

  const authorityKeys = [...authorityByKey.keys()].sort(compareUtf8)
  const missingTargetKeys = authorityKeys.filter(key => !entriesByTarget.has(key))
  const orphanTargetKeys = [...entriesByTarget.keys()]
    .filter(key => !authorityByKey.has(key))
    .sort(compareUtf8)
  const coveredBy = (predicate: (entry: KnowledgeEntry) => boolean): number =>
    authorityKeys.filter(key => entriesByTarget.get(key)?.some(predicate) === true).length

  const localeCoverage = [...new Set(requestedLocales.map(localeKey))]
    .sort(compareUtf8)
    .map(locale => ({
      locale,
      coverage: coverageMetric(
        coveredBy(entry => localeKey(entry.locale) === locale),
        authorityKeys.length,
      ),
    }))

  const authorityFieldByIdentity = new Map<string, string>()
  for (const [key, target] of authorityByKey) {
    const identity = fieldTargetIdentityWithoutRevision(target)
    if (identity === undefined) continue
    const current = authorityFieldByIdentity.get(identity)
    if (current === undefined || compareUtf8(key, current) < 0)
      authorityFieldByIdentity.set(identity, key)
  }
  const staleFieldTargets = orphanTargetKeys.flatMap(knowledgeKey => {
    const target = entriesByTarget.get(knowledgeKey)?.[0]?.target
    if (target === undefined) return []
    const identity = fieldTargetIdentityWithoutRevision(target)
    const authorityTargetKey =
      identity === undefined ? undefined : authorityFieldByIdentity.get(identity)
    return authorityTargetKey === undefined
      ? []
      : [{ authorityTargetKey, knowledgeTargetKey: knowledgeKey }]
  })

  return {
    authorityTargetCount: authorityKeys.length,
    entryCount: entries.length,
    structuralCoverage: coverageMetric(
      authorityKeys.length - missingTargetKeys.length,
      authorityKeys.length,
    ),
    descriptiveCoverage: coverageMetric(
      coveredBy(entry => entry.title.trim() !== '' && entry.summary.trim() !== ''),
      authorityKeys.length,
    ),
    researchedSemanticCoverage: coverageMetric(
      coveredBy(
        entry =>
          entry.claimKind !== 'schema-derived-fact' &&
          entry.sources.some(source => source.kind !== 'schema'),
      ),
      authorityKeys.length,
    ),
    provenanceCoverage: coverageMetric(
      coveredBy(entry => entry.sources.length > 0),
      authorityKeys.length,
    ),
    exampleCoverage: coverageMetric(
      coveredBy(entry => entry.examples?.some(example => example.text.trim() !== '') === true),
      authorityKeys.length,
    ),
    localeCoverage,
    missingTargetKeys,
    orphanTargetKeys,
    duplicateAuthorityTargetKeys: [...duplicateAuthorityTargetKeys].sort(compareUtf8),
    duplicateEntryLocales: [...entryLocales.values()]
      .filter(group => group.entryIds.length > 1)
      .map(group => ({ ...group, entryIds: [...group.entryIds].sort(compareUtf8) }))
      .sort((left, right) =>
        compareUtf8(
          `${left.targetKey}\u0000${left.locale}`,
          `${right.targetKey}\u0000${right.locale}`,
        ),
      ),
    staleFieldTargets,
  }
}
