/** Format-neutral, bounded subject and root-asset selector. */
import type {
  FieldType,
  Lease,
  PresentationSlot,
  SelectableSubject,
  SubjectCandidateProvider,
  SubjectCandidateTarget,
  SubjectSelectorCompleteness,
  SubjectSelectorSource,
  SubjectSelectorSummary,
  ViewerSources,
} from '@modkit/sdk'
// the subpath, not the root: a viewer that imports the selector must not carry every sdk schema
import { createSubjectCandidateProvider, loadSubjectCandidatePage } from '@modkit/sdk/subjects'
import { unknownSourceLease } from '../viewer/index.js'
import { setPart } from '../parts.js'

/** Translate a portable reference field into the shared selector query without format branches. */
export function candidateTargetForField(type: FieldType): SubjectCandidateTarget | undefined {
  if (type.kind === 'subject-ref') {
    return Object.freeze({
      kind: 'subject-ref',
      subjectKind: type.subjectKind,
      ...(type.filter === undefined ? {} : { filter: type.filter }),
    })
  }
  if (type.kind === 'asset-ref') {
    return Object.freeze({ kind: 'asset-ref', accepts: type.accepts })
  }
  return undefined
}

export interface SubjectSelectorOptions {
  readonly candidates: SubjectCandidateProvider
  readonly target: SubjectCandidateTarget
  readonly initial?: string
  readonly pageSize?: number
  readonly maximum?: number
  readonly signal?: AbortSignal
  readonly labels?: Readonly<{
    search?: string
    candidates?: string
    loadMore?: string
  }>
  readonly onSelect?: (candidate: SelectableSubject | undefined) => void
}

export interface SubjectSelectorSnapshot {
  readonly summary?: SubjectSelectorSummary
  readonly candidates: readonly SelectableSubject[]
  readonly text: string
  readonly nextCursor?: string
  readonly completeness?: SubjectSelectorCompleteness
  readonly loading: boolean
}

const positive = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return value
}

/** Headless paging model used by every DOM host and directly testable without a browser. */
export class SubjectSelectorModel {
  readonly #provider: SubjectCandidateProvider
  readonly #target: SubjectCandidateTarget
  readonly #pageSize: number
  readonly #maximum: number
  readonly #signal: AbortSignal | undefined
  #generation = 0
  #summary: SubjectSelectorSummary | undefined
  #items: readonly SelectableSubject[] = Object.freeze([])
  #text = ''
  #nextCursor: string | undefined
  #loading = false
  readonly #seenCursors = new Set<string>()

  constructor(options: SubjectSelectorOptions) {
    this.#provider = options.candidates
    this.#target = options.target
    this.#pageSize = positive(options.pageSize ?? 64, 'pageSize')
    this.#maximum = positive(options.maximum ?? 512, 'maximum')
    this.#signal = options.signal
  }

  snapshot(): SubjectSelectorSnapshot {
    const locallyCapped = this.#items.length >= this.#maximum && this.#nextCursor !== undefined
    return Object.freeze({
      ...(this.#summary === undefined ? {} : { summary: this.#summary }),
      candidates: this.#items,
      text: this.#text,
      ...(this.#nextCursor === undefined ? {} : { nextCursor: this.#nextCursor }),
      ...(this.#summary === undefined
        ? {}
        : {
            completeness: locallyCapped ? ('capped' as const) : this.#summary.completeness,
          }),
      loading: this.#loading,
    })
  }

  async search(text: string): Promise<SubjectSelectorSnapshot> {
    if (typeof text !== 'string') throw new TypeError('selector search text must be a string')
    this.#generation += 1
    this.#text = text
    this.#summary = undefined
    this.#items = Object.freeze([])
    this.#nextCursor = undefined
    this.#seenCursors.clear()
    return this.#load(this.#generation, undefined)
  }

  async loadMore(): Promise<SubjectSelectorSnapshot> {
    const cursor = this.#nextCursor
    if (cursor === undefined || this.#items.length >= this.#maximum) return this.snapshot()
    if (this.#seenCursors.has(cursor)) throw new Error('subject selector repeated a page cursor')
    this.#seenCursors.add(cursor)
    return this.#load(this.#generation, cursor)
  }

  async #load(generation: number, cursor: string | undefined): Promise<SubjectSelectorSnapshot> {
    this.#signal?.throwIfAborted()
    const remaining = this.#maximum - (cursor === undefined ? 0 : this.#items.length)
    if (remaining < 1) return this.snapshot()
    this.#loading = true
    try {
      const result = await loadSubjectCandidatePage(
        this.#provider,
        {
          target: this.#target,
          text: this.#text,
          ...(cursor === undefined ? {} : { cursor }),
          limit: Math.min(this.#pageSize, remaining),
        },
        this.#signal,
      )
      if (generation !== this.#generation) return this.snapshot()
      if (this.#summary !== undefined && this.#summary.snapshotId !== result.summary.snapshotId) {
        throw new Error('subject selector snapshot changed between pages')
      }
      const prior = cursor === undefined ? [] : this.#items
      const ids = new Set(prior.map(item => item.subjectId))
      if (result.page.items.some(item => ids.has(item.subjectId))) {
        throw new Error('subject selector repeated a candidate between pages')
      }
      if (result.page.nextCursor !== undefined && result.page.nextCursor === cursor) {
        throw new Error('subject selector repeated a page cursor')
      }
      this.#summary = result.summary
      this.#items = Object.freeze([...prior, ...result.page.items])
      this.#nextCursor = result.page.nextCursor
      this.#loading = false
      return this.snapshot()
    } finally {
      if (generation === this.#generation) this.#loading = false
    }
  }
}

/** Resolve the current presentation slot's selector source and retain its lease for the caller. */
export async function subjectCandidateProviderLease(
  sources: ViewerSources,
  slot: PresentationSlot,
): Promise<Lease<SubjectCandidateProvider> | undefined> {
  const lease = await unknownSourceLease(sources, slot, 'common.view/subject-selector-source')
  if (lease === undefined) return undefined
  return Object.freeze({
    value: createSubjectCandidateProvider(lease.value as SubjectSelectorSource),
    release: () => lease.release(),
  })
}

export interface SubjectSelectorControl {
  readonly root: HTMLElement
  readonly model: SubjectSelectorModel
  read(): string
  validate(): string | undefined
  search(text: string): Promise<SubjectSelectorSnapshot>
  loadMore(): Promise<SubjectSelectorSnapshot>
  destroy(): void
}

/** Mount an accessible search + dropdown picker over the headless selector model. */
export async function mountSubjectSelector(
  container: HTMLElement,
  options: SubjectSelectorOptions,
): Promise<SubjectSelectorControl> {
  const document = container.ownerDocument
  const root = document.createElement('div')
  setPart(root, 'selector')
  const search = document.createElement('input')
  search.type = 'search'
  setPart(search, 'selector.search')
  search.setAttribute('aria-label', options.labels?.search ?? 'Search candidates')
  const select = document.createElement('select')
  setPart(select, 'selector.candidates')
  select.setAttribute('aria-label', options.labels?.candidates ?? 'Candidates')
  const more = document.createElement('button')
  more.type = 'button'
  setPart(more, 'selector.more')
  more.textContent = options.labels?.loadMore ?? 'Load more'
  const status = document.createElement('output')
  setPart(status, 'selector.status')
  root.append(search, select, more, status)
  container.append(root)

  const model = new SubjectSelectorModel(options)
  let problem: string | undefined
  let destroyed = false

  const draw = (snapshot: SubjectSelectorSnapshot): void => {
    if (destroyed) return
    const selected = select.value || options.initial || snapshot.candidates[0]?.subjectId || ''
    select.replaceChildren()
    if (selected.length > 0 && !snapshot.candidates.some(item => item.subjectId === selected)) {
      const initial = document.createElement('option')
      initial.value = selected
      initial.textContent = selected
      select.append(initial)
    }
    for (const candidate of snapshot.candidates) {
      const option = document.createElement('option')
      option.value = candidate.subjectId
      option.textContent =
        candidate.label === candidate.subjectId
          ? candidate.label
          : `${candidate.label} (${candidate.subjectId})`
      select.append(option)
    }
    select.value = selected
    more.hidden = snapshot.nextCursor === undefined
    more.disabled = snapshot.loading || snapshot.completeness === 'capped'
    const state = snapshot.completeness ?? 'partial'
    status.textContent = `${snapshot.candidates.length}/${snapshot.summary?.totalSubjects ?? '?'} · ${state}`
  }

  const run = async (operation: () => Promise<SubjectSelectorSnapshot>) => {
    problem = undefined
    try {
      const snapshot = await operation()
      draw(snapshot)
      return snapshot
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error)
      status.textContent = problem
      throw error
    }
  }
  const searchCandidates = () => run(() => model.search(search.value))
  const loadMore = () => run(() => model.loadMore())
  const changed = () => {
    options.onSelect?.(model.snapshot().candidates.find(item => item.subjectId === select.value))
  }
  const searched = () => void searchCandidates().catch(() => undefined)
  const moreRequested = () => void loadMore().catch(() => undefined)
  search.addEventListener('input', searched)
  select.addEventListener('change', changed)
  more.addEventListener('click', moreRequested)

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    options.signal?.removeEventListener('abort', aborted)
    search.removeEventListener('input', searched)
    select.removeEventListener('change', changed)
    more.removeEventListener('click', moreRequested)
    root.remove()
  }
  const aborted = () => destroy()
  options.signal?.addEventListener('abort', aborted, { once: true })
  await searchCandidates()

  const control: SubjectSelectorControl = Object.freeze({
    root,
    model,
    read: () => select.value,
    validate: () => problem,
    search: (text: string) => {
      search.value = text
      return searchCandidates()
    },
    loadMore,
    destroy,
  })
  return control
}
