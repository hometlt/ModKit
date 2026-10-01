/**
 * Catalog questions: a consumer names the resolved catalog entities it needs, the host answers from
 * wherever the merged catalog lives (a subject's mod context), and asks again with what each answer
 * names — so only the entities asked for ever cross a worker frame, never a whole catalog. Map
 * worlds and codec operations ask through the same loop.
 */
import {
  DATA_CATALOG_QUERIES_OUTPUT,
  type DataEntityRef,
  type DataLocalizedString,
  type DataResolvedEntity,
  type OperationResult,
} from '@modkit/sdk'
import {
  MOD_CONTEXT_MAX_QUERY_REFS,
  type ContentSources,
  type ModContext,
  type ModContextTarget,
} from '@modkit/vfs/content-sources'
import { subjectTarget } from './content-dependency-operations.js'

/** Resolved catalog entities by reference. */
export type CatalogEntities = (
  refs: readonly DataEntityRef[],
  signal?: AbortSignal,
) => Promise<readonly DataResolvedEntity[]>

/** Localized strings by key, in the first of `locales` that has each (see `SubjectCatalogPort`). */
export type CatalogStrings = (
  keys: readonly string[],
  locales?: readonly string[],
  signal?: AbortSignal,
) => Promise<readonly DataLocalizedString[]>

const key = (ref: DataEntityRef): string => JSON.stringify([ref.namespace, ref.entityId])

/**
 * Run, answer what the result names, and run again with every entity answered so far — until
 * nothing new is named or the rounds run out. Round 0 runs without entities.
 */
export async function answerCatalogQueries<Result>(options: {
  readonly run: (entities: readonly DataResolvedEntity[] | undefined, round: number) => Promise<Result>
  readonly queriesOf: (result: Result) => readonly DataEntityRef[]
  readonly catalogEntities: CatalogEntities
  readonly rounds: number
  /** The unanswered first run, when the caller already has it (a world shown before the answers). */
  readonly initial?: Result
  readonly signal?: AbortSignal
}): Promise<Result> {
  const asked = new Set<string>()
  const entities = new Map<string, DataResolvedEntity>()
  let result = options.initial ?? (await options.run(undefined, 0))
  for (let round = 1; round <= options.rounds; round += 1) {
    const refs = options.queriesOf(result).filter(ref => !asked.has(key(ref)))
    if (refs.length === 0) break
    for (const ref of refs) asked.add(key(ref))
    for (const entity of await options.catalogEntities(refs, options.signal)) {
      entities.set(key(entity), entity)
    }
    options.signal?.throwIfAborted()
    result = await options.run(Object.freeze([...entities.values()]), round)
  }
  return result
}

/** The context's `data.entities` query, a bounded batch at a time; undefined if it has none. */
export function modContextCatalogEntities(context: ModContext): CatalogEntities | undefined {
  const query = context.query?.bind(context)
  if (query === undefined) return undefined
  return async (refs, signal) => {
    const entities: DataResolvedEntity[] = []
    for (let start = 0; start < refs.length; start += MOD_CONTEXT_MAX_QUERY_REFS) {
      const answer = (await query(
        { kind: 'data.entities', refs: refs.slice(start, start + MOD_CONTEXT_MAX_QUERY_REFS) },
        signal,
      )) as { readonly entities?: unknown } | undefined
      if (!Array.isArray(answer?.entities)) throw new TypeError('data.entities answered no entity list')
      for (const entity of answer.entities as readonly Partial<DataResolvedEntity>[]) {
        if (typeof entity?.namespace === 'string' && typeof entity.entityId === 'string') {
          entities.push(entity as DataResolvedEntity)
        }
      }
    }
    return entities
  }
}

/** The context's `data.strings` query, a bounded batch at a time; undefined if it has none. */
export function modContextCatalogStrings(context: ModContext): CatalogStrings | undefined {
  const query = context.query?.bind(context)
  if (query === undefined) return undefined
  return async (keys, locales, signal) => {
    const strings: DataLocalizedString[] = []
    for (let start = 0; start < keys.length; start += MOD_CONTEXT_MAX_QUERY_REFS) {
      const answer = (await query(
        {
          kind: 'data.strings',
          keys: keys.slice(start, start + MOD_CONTEXT_MAX_QUERY_REFS),
          ...(locales === undefined ? {} : { locales }),
        },
        signal,
      )) as { readonly strings?: unknown } | undefined
      if (!Array.isArray(answer?.strings))
        throw new TypeError('data.strings answered no string list')
      for (const item of answer.strings as readonly Partial<DataLocalizedString>[])
        if (typeof item?.key === 'string' && typeof item.value === 'string')
          strings.push(item as DataLocalizedString)
    }
    return strings
  }
}

/** Where a host answers an opened subject's catalog questions from. */
export interface SubjectCatalogOptions {
  /** The product's source catalogue; its game's loader opens the subject's mod context. */
  readonly contentSources: () => Promise<ContentSources | undefined>
  /** Packages a subject in no package opens inside, as set now; the game's default when absent. */
  readonly baseMods?: (target: ModContextTarget) => readonly string[] | undefined
}

/**
 * A subject's catalog: its mod context, opened on the first question and closed by `release`. A
 * subject the sources cannot place, or sources without a loader, answer nothing.
 */
export function subjectCatalogEntities(
  options: SubjectCatalogOptions,
  subjectUri: () => Promise<string | undefined>,
): {
  readonly entities: CatalogEntities
  readonly strings: CatalogStrings
  release(): Promise<void>
} {
  let opened: Promise<{ readonly context?: ModContext }> | undefined
  const open = () =>
    (opened ??= (async () => {
      const [sources, uri] = await Promise.all([options.contentSources(), subjectUri()])
      const target = subjectTarget(uri)
      if (sources?.openModContext === undefined || target === undefined) return {}
      const baseMods = options.baseMods?.(target)
      const context = await sources.openModContext({
        schemaVersion: 1,
        target,
        ...(baseMods === undefined ? {} : { baseMods }),
      })
      return { context }
    })())
  return Object.freeze({
    async entities(refs: readonly DataEntityRef[], signal?: AbortSignal) {
      const { context } = await open()
      const entities = context === undefined ? undefined : modContextCatalogEntities(context)
      return entities === undefined ? [] : entities(refs, signal)
    },
    async strings(keys: readonly string[], locales?: readonly string[], signal?: AbortSignal) {
      const { context } = await open()
      const strings = context === undefined ? undefined : modContextCatalogStrings(context)
      return strings === undefined ? [] : strings(keys, locales, signal)
    },
    async release() {
      if (opened === undefined) return
      const { context } = await opened.catch(() => ({}) as { readonly context?: ModContext })
      await context?.dispose()
    },
  })
}

/** What an operation's JSON output asks for under `catalogQueries`; none for anything else. */
export function operationCatalogQueries(result: OperationResult): readonly DataEntityRef[] {
  if (result.state !== 'ok' || result.output.kind !== 'json') return []
  const value = result.output.value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const queries = (value as Readonly<Record<string, unknown>>)[DATA_CATALOG_QUERIES_OUTPUT]
  if (!Array.isArray(queries)) return []
  return queries.filter(
    (ref): ref is DataEntityRef =>
      typeof ref?.namespace === 'string' &&
      ref.namespace !== '' &&
      typeof ref.entityId === 'string' &&
      ref.entityId !== '',
  )
}
