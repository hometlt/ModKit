/** One bounded candidate path shared by schema-driven fields and language completion. */
import type {
  Page,
  SelectableSubject,
  SubjectSelectorSource,
  SubjectSelectorSummary,
} from '../asset-capabilities/data-sources.js'
import type { AssetReferenceFilter, SubjectFilter } from '../fields/index.js'

export type SubjectCandidateTarget =
  | Readonly<{
      kind: 'subject-ref'
      subjectKind: string
      filter?: SubjectFilter
    }>
  | Readonly<{
      kind: 'asset-ref'
      accepts: AssetReferenceFilter
    }>

export interface SubjectCandidateQuery {
  readonly target: SubjectCandidateTarget
  readonly text?: string
  readonly cursor?: string
  readonly limit: number
}

export interface SubjectCandidateProvider {
  summary(signal?: AbortSignal): Promise<SubjectSelectorSummary>
  candidates(query: SubjectCandidateQuery, signal?: AbortSignal): Promise<Page<SelectableSubject>>
}

export interface SubjectCandidatePageSnapshot {
  readonly summary: SubjectSelectorSummary
  readonly page: Page<SelectableSubject>
}

const nonEmptyStrings = (value: readonly string[] | undefined): boolean =>
  value === undefined ||
  (value.every(item => typeof item === 'string' && item.length > 0) &&
    new Set(value).size === value.length)

function validCandidate(candidate: SelectableSubject): boolean {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.subjectId === 'string' &&
    candidate.subjectId.length > 0 &&
    typeof candidate.label === 'string' &&
    candidate.label.length > 0 &&
    typeof candidate.kind === 'string' &&
    candidate.kind.length > 0 &&
    (candidate.type === undefined ||
      (typeof candidate.type === 'string' && candidate.type.length > 0)) &&
    nonEmptyStrings(candidate.tags) &&
    (candidate.asset === undefined ||
      (typeof candidate.asset === 'object' &&
        candidate.asset !== null &&
        typeof candidate.asset.formatId === 'string' &&
        candidate.asset.formatId.length > 0 &&
        nonEmptyStrings(candidate.asset.traits)))
  )
}

function validSummary(summary: SubjectSelectorSummary): boolean {
  return (
    typeof summary === 'object' &&
    summary !== null &&
    typeof summary.snapshotId === 'string' &&
    summary.snapshotId.length > 0 &&
    Number.isSafeInteger(summary.totalSubjects) &&
    summary.totalSubjects >= 0 &&
    (summary.completeness === 'complete' ||
      summary.completeness === 'partial' ||
      summary.completeness === 'capped') &&
    (summary.reason === undefined || typeof summary.reason === 'string')
  )
}

function validateQuery(query: SubjectCandidateQuery): void {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new RangeError('subject candidate limit must be a positive safe integer')
  }
  if (query.text !== undefined && typeof query.text !== 'string') {
    throw new TypeError('subject candidate text must be a string')
  }
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== 'string' || query.cursor.length === 0)
  ) {
    throw new TypeError('subject candidate cursor must be a non-empty string')
  }
  if (
    query.target.kind === 'subject-ref' &&
    (typeof query.target.subjectKind !== 'string' || query.target.subjectKind.length === 0)
  ) {
    throw new TypeError('subject candidate kind must be a non-empty string')
  }
  if (
    query.target.kind === 'asset-ref' &&
    (!nonEmptyStrings(query.target.accepts.formatIds) ||
      !nonEmptyStrings(query.target.accepts.traits))
  ) {
    throw new TypeError('asset candidate constraints must contain unique non-empty strings')
  }
}

/**
 * Validate one candidate page and its completeness metadata at the shared consumer boundary.
 * Both UI and language completion use this function, so malformed or over-limit providers fail
 * identically.
 */
export async function loadSubjectCandidatePage(
  provider: SubjectCandidateProvider,
  query: SubjectCandidateQuery,
  signal?: AbortSignal,
): Promise<SubjectCandidatePageSnapshot> {
  signal?.throwIfAborted()
  validateQuery(query)
  const [summary, page] = await Promise.all([
    provider.summary(signal),
    provider.candidates(query, signal),
  ])
  signal?.throwIfAborted()
  if (!validSummary(summary)) throw new TypeError('subject candidate summary is malformed')
  if (
    typeof page !== 'object' ||
    page === null ||
    !Array.isArray(page.items) ||
    page.items.length > query.limit ||
    !page.items.every(validCandidate) ||
    new Set(page.items.map(item => item.subjectId)).size !== page.items.length ||
    (page.nextCursor !== undefined &&
      (typeof page.nextCursor !== 'string' || page.nextCursor.length === 0))
  ) {
    throw new TypeError('subject candidate page is malformed or exceeds its requested limit')
  }
  return Object.freeze({ summary, page })
}

/** Adapt the admitted selector source to the consumer-facing candidate seam. */
export function createSubjectCandidateProvider(
  source: SubjectSelectorSource,
): SubjectCandidateProvider {
  return Object.freeze({
    summary: (signal?: AbortSignal) => source.summary(signal),
    candidates(query: SubjectCandidateQuery, signal?: AbortSignal) {
      const page = {
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.target.kind === 'subject-ref'
          ? {
              kind: query.target.subjectKind,
              ...(query.target.filter === undefined ? {} : { filter: query.target.filter }),
            }
          : { asset: query.target.accepts }),
      }
      return source.subjects(page, signal)
    },
  })
}
