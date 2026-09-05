/** Expand declarative language references through the shared bounded candidate provider. */
import { loadSubjectCandidatePage, type SubjectCandidateProvider } from '@modkit/sdk'
import type {
  LanguageCompletionItem,
  LanguageCompletionList,
  LanguageProviderCompletionList,
} from '@modkit/sdk/language'

const candidateCompletion = (candidate: {
  readonly subjectId: string
  readonly label: string
  readonly kind: string
  readonly type?: string
}): LanguageCompletionItem =>
  Object.freeze({
    label: candidate.label,
    kind: 'text',
    detail: candidate.type === undefined ? candidate.kind : `${candidate.kind} · ${candidate.type}`,
    insertText: candidate.subjectId,
    insertTextFormat: 'plain-text',
    sortText: candidate.subjectId,
  })

/**
 * Preserve provider ordering while replacing each subject-ref marker with selector candidates.
 * The caller bound is never exceeded and every omitted or incomplete selector page propagates to
 * `isIncomplete`.
 */
export async function expandSubjectReferenceCompletions(
  list: LanguageProviderCompletionList,
  candidates: SubjectCandidateProvider | undefined,
  maxResults: number,
  signal?: AbortSignal,
): Promise<LanguageCompletionList> {
  if (!Number.isSafeInteger(maxResults) || maxResults < 1) {
    throw new RangeError('language completion maxResults must be a positive safe integer')
  }
  const items: LanguageCompletionItem[] = []
  let isIncomplete = list.isIncomplete
  for (const item of list.items) {
    signal?.throwIfAborted()
    if (items.length >= maxResults) {
      isIncomplete = true
      break
    }
    if (item.kind !== 'subject-ref') {
      items.push(item)
      continue
    }
    if (candidates === undefined) {
      isIncomplete = true
      continue
    }
    const result = await loadSubjectCandidatePage(
      candidates,
      {
        target: {
          kind: 'subject-ref',
          subjectKind: item.subjectKind,
          ...(item.filter === undefined ? {} : { filter: item.filter }),
        },
        limit: maxResults - items.length,
      },
      signal,
    )
    items.push(...result.page.items.map(candidateCompletion))
    if (result.page.nextCursor !== undefined || result.summary.completeness !== 'complete') {
      isIncomplete = true
    }
  }
  return Object.freeze({ items: Object.freeze(items), isIncomplete })
}
