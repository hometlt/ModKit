/** Inventory-backed, immutable knowledge catalog shared by UI, CLI, MCP and agent adapters. */

import { canonicalJsonStringify, compareUtf8 } from '@modkit/core'
import {
  KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT,
  KNOWLEDGE_PACK_FACT,
  isKnowledgeLocaleTag,
  isKnowledgeTarget,
  knowledgeLocaleFallbacks,
  knowledgeTargetKey,
  type KnowledgeCatalog,
  type KnowledgeClaimKind,
  type KnowledgeDiagnostic,
  type KnowledgeEntry,
  type KnowledgeHit,
  type KnowledgePackSpecV1,
  type KnowledgePage,
  type KnowledgeResolveQuery,
  type KnowledgeSearchQuery,
  type KnowledgeTarget,
  validateContributionManifest,
} from '@modkit/sdk'
import { readAttestedArtifactFile, type ArtifactVfsPort } from '../artifact-files.js'
import { createHostContributionContractRegistry } from '../contribution-registry.js'
import type { Inventory, InventoryContribution } from '../inventory.js'

const DEFAULT_PAGE_LIMIT = 20
const MAXIMUM_PAGE_LIMIT = 100
const MAXIMUM_SEARCH_TEXT_LENGTH = 1_024
const MAXIMUM_QUERY_LOCALES = 16
const MAXIMUM_LOCALE_LENGTH = 64
const MAXIMUM_TARGET_KEY_LENGTH = 8_192
const MAXIMUM_CURSOR_LENGTH = 65_536
const DEFAULT_MAXIMUM_INDEXED_ENTRIES = 50_000
const HARD_MAXIMUM_INDEXED_ENTRIES = 100_000
const DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS = 64 * 1024 * 1024
const HARD_MAXIMUM_SEARCHABLE_CHARACTERS = 128 * 1024 * 1024
const DEFAULT_SCAN_CHUNK_SIZE = 512
const MAXIMUM_SCAN_CHUNK_SIZE = 4_096
const KNOWLEDGE_CLAIM_KINDS = new Set<KnowledgeClaimKind>([
  'schema-derived-fact',
  'documented-interpretation',
  'community-note',
  'external-reference',
])
const UINT64_MASK = (1n << 64n) - 1n
const FNV64_PRIME = 0x100000001b3n

const fnv64 = (value: string, seed: bigint, reverse: boolean): string => {
  let hash = seed
  for (let step = 0; step < value.length; step += 1) {
    const index = reverse ? value.length - step - 1 : step
    const code = value.charCodeAt(index)
    hash ^= BigInt(code & 0xff)
    hash = (hash * FNV64_PRIME) & UINT64_MASK
    hash ^= BigInt(code >>> 8)
    hash = (hash * FNV64_PRIME) & UINT64_MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/** Fixed-size deterministic identity for cursor binding, never an authority or content digest. */
const opaqueFingerprint = (value: string): string =>
  `${fnv64(value, 0xcbf29ce484222325n, false)}${fnv64(value, 0x84222325cbf29ce4n, true)}`

export interface KnowledgeCatalogLimits {
  readonly maxIndexedEntries?: number
  readonly maxSearchableCharacters?: number
  readonly scanChunkSize?: number
}

interface ResolvedKnowledgeCatalogLimits {
  readonly maxIndexedEntries: number
  readonly maxSearchableCharacters: number
  readonly scanChunkSize: number
}

const positiveLimit = (
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return resolved
}

const resolveCatalogLimits = (limits: KnowledgeCatalogLimits): ResolvedKnowledgeCatalogLimits =>
  Object.freeze({
    maxIndexedEntries: positiveLimit(
      limits.maxIndexedEntries,
      DEFAULT_MAXIMUM_INDEXED_ENTRIES,
      HARD_MAXIMUM_INDEXED_ENTRIES,
      'maxIndexedEntries',
    ),
    maxSearchableCharacters: positiveLimit(
      limits.maxSearchableCharacters,
      DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS,
      HARD_MAXIMUM_SEARCHABLE_CHARACTERS,
      'maxSearchableCharacters',
    ),
    scanChunkSize: positiveLimit(
      limits.scanChunkSize,
      DEFAULT_SCAN_CHUNK_SIZE,
      MAXIMUM_SCAN_CHUNK_SIZE,
      'scanChunkSize',
    ),
  })

interface IndexedKnowledgeEntry {
  readonly entry: KnowledgeEntry
  readonly packId: string
  readonly sourceLocale: string
  readonly priority: number
  readonly provenance: KnowledgeHit['provenance']
  readonly searchable: string
}

interface CollectedKnowledge {
  readonly entries: readonly IndexedKnowledgeEntry[]
  readonly diagnostics: readonly KnowledgeDiagnostic[]
  readonly completeness: 'complete' | 'capped'
}

interface KnowledgeCandidate {
  readonly entry: KnowledgeEntry
  readonly packId: string
  readonly sourceLocale: string
  readonly priority: number
  readonly provenance: KnowledgeHit['provenance']
}

const comparePriority = (left: number, right: number): number =>
  left === right ? 0 : left > right ? -1 : 1

/** Negative means left is preferred and must survive a bounded top-N selection. */
const compareCandidate = (left: KnowledgeCandidate, right: KnowledgeCandidate): number =>
  comparePriority(left.priority, right.priority) ||
  compareUtf8(left.provenance.ownerExtensionId, right.provenance.ownerExtensionId) ||
  compareUtf8(left.packId, right.packId) ||
  compareUtf8(left.entry.id, right.entry.id) ||
  compareUtf8(lower(left.entry.locale), lower(right.entry.locale)) ||
  compareUtf8(knowledgeTargetKey(left.entry.target), knowledgeTargetKey(right.entry.target))

/** Root is the least preferred retained candidate. */
const retainCandidate = (
  heap: KnowledgeCandidate[],
  candidate: KnowledgeCandidate,
  maximum: number,
): void => {
  const siftDown = (): void => {
    let parent = 0
    while (true) {
      const left = parent * 2 + 1
      if (left >= heap.length) return
      const right = left + 1
      const leftCandidate = heap[left]
      const parentCandidate = heap[parent]
      if (leftCandidate === undefined || parentCandidate === undefined) {
        throw new Error('knowledge candidate heap invariant failed')
      }
      const rightCandidate = heap[right]
      const worseChild =
        rightCandidate !== undefined && compareCandidate(rightCandidate, leftCandidate) > 0
          ? right
          : left
      const childCandidate = heap[worseChild]
      if (childCandidate === undefined) throw new Error('knowledge candidate heap child is missing')
      if (compareCandidate(childCandidate, parentCandidate) <= 0) return
      heap[parent] = childCandidate
      heap[worseChild] = parentCandidate
      parent = worseChild
    }
  }
  if (heap.length >= maximum) {
    const worst = heap[0]
    if (worst === undefined) throw new Error('knowledge candidate heap root is missing')
    if (compareCandidate(candidate, worst) >= 0) return
    heap[0] = candidate
    siftDown()
    return
  }
  heap.push(candidate)
  let child = heap.length - 1
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2)
    const childCandidate = heap[child]
    const parentCandidate = heap[parent]
    if (childCandidate === undefined || parentCandidate === undefined) {
      throw new Error('knowledge candidate heap invariant failed')
    }
    if (compareCandidate(childCandidate, parentCandidate) <= 0) return
    heap[parent] = childCandidate
    heap[child] = parentCandidate
    child = parent
  }
}

const lower = (value: string): string => value.toLocaleLowerCase('en-US')

const searchableTarget = (target: KnowledgeTarget): string => {
  switch (target.kind) {
    case 'field':
      return `${target.ecosystem} ${target.schema.contract} ${target.typeId} ${target.canonicalPath.join(' ')}`
    case 'subject':
      return `${target.ecosystem} ${target.subjectKind} ${target.subjectId ?? ''}`
    case 'format':
      return `${target.ecosystem} ${target.formatId}`
    case 'diagnostic':
      return `${target.ecosystem} ${target.code}`
    case 'concept':
      return `${target.ecosystem} ${target.conceptId}`
  }
}

const targetRank = (entry: KnowledgeTarget, requested: KnowledgeTarget): number | undefined => {
  if (knowledgeTargetKey(entry) === knowledgeTargetKey(requested)) return 0
  if (
    entry.kind === 'subject' &&
    requested.kind === 'subject' &&
    entry.ecosystem === requested.ecosystem &&
    entry.subjectKind === requested.subjectKind &&
    entry.subjectId === undefined
  ) {
    return 1
  }
  return undefined
}

const pageLimit = (
  requested: number | undefined,
): { readonly value: number; readonly diagnostics: readonly KnowledgeDiagnostic[] } => {
  if (requested === undefined) return { value: DEFAULT_PAGE_LIMIT, diagnostics: [] }
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return {
      value: DEFAULT_PAGE_LIMIT,
      diagnostics: [
        {
          code: 'x3.knowledge/invalid-page-limit',
          message: `page limit must be a positive safe integer; using ${DEFAULT_PAGE_LIMIT}`,
          severity: 'warning',
        },
      ],
    }
  }
  if (requested > MAXIMUM_PAGE_LIMIT) {
    return {
      value: MAXIMUM_PAGE_LIMIT,
      diagnostics: [
        {
          code: 'x3.knowledge/page-limit-capped',
          message: `page limit was capped at ${MAXIMUM_PAGE_LIMIT}`,
          severity: 'information',
        },
      ],
    }
  }
  return { value: requested, diagnostics: [] }
}

const queryCursor = (snapshotId: string, queryKey: string, offset: number): string =>
  `${encodeURIComponent(snapshotId)}:${encodeURIComponent(queryKey)}:${offset}`

const decoded = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

const cursorOffset = (
  cursor: string | undefined,
  snapshotId: string,
  queryKey: string,
): number | undefined => {
  if (cursor === undefined) return 0
  const parts = cursor.split(':')
  if (parts.length !== 3) return undefined
  const [encodedSnapshot, encodedQuery, rawOffset] = parts
  if (
    encodedSnapshot === undefined ||
    encodedQuery === undefined ||
    rawOffset === undefined ||
    decoded(encodedSnapshot) !== snapshotId ||
    decoded(encodedQuery) !== queryKey ||
    !/^(?:0|[1-9][0-9]*)$/u.test(rawOffset)
  ) {
    return undefined
  }
  const parsed = Number(rawOffset)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/** Largest `entriesPath` file the catalog reads, before JSON decoding. */
export const KNOWLEDGE_ENTRIES_MAXIMUM_JSON_BYTES = 32 * 1024 * 1024

/** Where a catalog reads the entries a pack keeps in an `entriesPath` file of its artifact. */
export interface KnowledgeEntriesSource {
  readonly vfs: ArtifactVfsPort
  /** Injectable for non-WebCrypto environments; returns `sha256:<lowercase hex>`. */
  readonly digest?: (bytes: Uint8Array) => Promise<string>
}

interface KnowledgePack {
  readonly contribution: InventoryContribution
  readonly manifest: NonNullable<InventoryContribution['manifest']>
  readonly spec: KnowledgePackSpecV1
  readonly provenance: InventoryContribution['facts'][number]['provenance']
}

const knowledgePacks = (inventory: Inventory): readonly KnowledgePack[] => {
  const packs: KnowledgePack[] = []
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (
        manifest?.contract.id !== KNOWLEDGE_PACK_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1 ||
        !contribution.inventoryEligible
      ) {
        continue
      }
      const fact = contribution.facts.find(
        candidate =>
          candidate.contract.id === KNOWLEDGE_PACK_FACT && candidate.contract.major === 1,
      )
      if (fact === undefined) continue
      packs.push({
        contribution,
        manifest,
        spec: fact.value as unknown as KnowledgePackSpecV1,
        provenance: fact.provenance,
      })
    }
  }
  return packs
}

const snapshotComponentOf = (pack: KnowledgePack): string =>
  canonicalJsonStringify([
    pack.provenance.ownerExtensionId,
    pack.provenance.extensionVersion,
    pack.provenance.inventoryRecordId,
    pack.manifest.id,
    pack.provenance.manifestPath,
    pack.provenance.manifestDigest,
    pack.provenance.artifactDigest,
  ])

const entriesDecoder = new TextDecoder('utf-8', { fatal: true })

/**
 * A pack's entries: inline, or read from its `entriesPath` file.
 *
 * The file is admitted only as the attested bytes of the artifact, and its entries pass the very
 * validation an inline pack passes at inventory time — the manifest is validated again with them
 * in place — so moving entries out of a manifest never widens what a catalog accepts.
 */
async function packEntries(
  pack: KnowledgePack,
  source: KnowledgeEntriesSource | undefined,
): Promise<
  | { readonly entries: readonly KnowledgeEntry[] }
  | { readonly diagnostic: KnowledgeDiagnostic }
> {
  const { entriesPath, ...inline } = pack.spec
  if (entriesPath === undefined) return { entries: pack.spec.entries ?? [] }
  const refused = (message: string): { readonly diagnostic: KnowledgeDiagnostic } => ({
    diagnostic: Object.freeze({
      code: 'x3.knowledge/entries-file-refused',
      message: `knowledge pack ${pack.manifest.id}: ${message}`,
      severity: 'warning' as const,
    }),
  })
  if (source === undefined) {
    return refused(`its entries are in ${entriesPath}, and this catalog was given no way to read it`)
  }
  try {
    const bytes = await readAttestedArtifactFile(pack.contribution, entriesPath, {
      vfs: source.vfs,
      maxBytes: KNOWLEDGE_ENTRIES_MAXIMUM_JSON_BYTES,
      label: 'knowledge entries file',
      ...(source.digest === undefined ? {} : { digest: source.digest }),
    })
    const document = JSON.parse(entriesDecoder.decode(bytes)) as unknown
    const entries =
      document !== null && typeof document === 'object' && !Array.isArray(document)
        ? (document as { readonly entries?: unknown }).entries
        : undefined
    if (!Array.isArray(entries)) return refused(`${entriesPath} has no "entries" array`)
    const validated = await validateContributionManifest(
      { ...pack.manifest, spec: { ...inline, entries } },
      createHostContributionContractRegistry().validationRegistry(),
    )
    if (!validated.inventoryEligible || validated.manifest === undefined) {
      const first = validated.diagnostics.find(item => item.severity === 'error')
      return refused(
        `${entriesPath} does not validate${first === undefined ? '' : `: ${first.code} ${first.message}`}`,
      )
    }
    return {
      entries: (validated.manifest.spec as unknown as KnowledgePackSpecV1).entries ?? [],
    }
  } catch (error) {
    return refused(error instanceof Error ? error.message : String(error))
  }
}

const collect = async (
  packs: readonly KnowledgePack[],
  limits: ResolvedKnowledgeCatalogLimits,
  source: KnowledgeEntriesSource | undefined,
): Promise<CollectedKnowledge> => {
  const retained: KnowledgeCandidate[] = []
  const loadDiagnostics: KnowledgeDiagnostic[] = []
  let candidateCount = 0
  for (const pack of packs) {
    const { manifest, spec, provenance } = pack
    const loaded = await packEntries(pack, source)
    if ('diagnostic' in loaded) {
      loadDiagnostics.push(loaded.diagnostic)
      continue
    }
    for (const entry of loaded.entries) {
      candidateCount += 1
      retainCandidate(
        retained,
        Object.freeze({
          entry,
          packId: manifest.id,
          sourceLocale: spec.sourceLocale,
          priority: spec.priority,
          provenance: Object.freeze({
            packId: manifest.id,
            ownerExtensionId: provenance.ownerExtensionId,
            extensionVersion: provenance.extensionVersion,
            manifestPath: provenance.manifestPath,
            manifestDigest: provenance.manifestDigest,
            artifactDigest: provenance.artifactDigest,
          }),
        }),
        limits.maxIndexedEntries,
      )
    }
  }

  const items: IndexedKnowledgeEntry[] = []
  let searchableCharacters = 0
  let characterCapped = false
  for (const candidate of retained.sort(compareCandidate)) {
    const { entry } = candidate
    const searchable = lower(
      [
        entry.id,
        entry.title,
        entry.summary,
        ...(entry.aliases ?? []),
        ...(entry.keywords ?? []),
        searchableTarget(entry.target),
      ].join(' '),
    )
    if (searchableCharacters + searchable.length > limits.maxSearchableCharacters) {
      characterCapped = true
      continue
    }
    searchableCharacters += searchable.length
    items.push(
      Object.freeze({
        ...candidate,
        searchable,
      }),
    )
  }
  const capped = candidateCount > retained.length || characterCapped
  return Object.freeze({
    entries: Object.freeze(items),
    diagnostics: Object.freeze([
      ...loadDiagnostics,
      ...(capped
        ? [
            {
              code: 'x3.knowledge/catalog-index-capped',
              message: `knowledge indexing retained ${items.length} of ${candidateCount} entries and ${searchableCharacters} searchable characters by deterministic priority`,
              severity: 'warning' as const,
            },
          ]
        : []),
    ]),
    completeness: capped ? ('capped' as const) : ('complete' as const),
  })
}

interface RankedHit {
  readonly hit: KnowledgeHit
  readonly priority: number
  readonly targetRank: number
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 0)
  })

const resolvedHits = async (
  indexed: readonly IndexedKnowledgeEntry[],
  locales: readonly string[],
  scanChunkSize: number,
  signal?: AbortSignal,
  target?: KnowledgeTarget,
  text?: string,
  claimKinds?: KnowledgeSearchQuery['claimKinds'],
): Promise<readonly RankedHit[]> => {
  const terms = (text ?? '').trim().split(/\s+/u).map(lower).filter(Boolean)
  const selected = new Map<string, RankedHit>()
  for (let index = 0; index < indexed.length; index += 1) {
    if (index % scanChunkSize === 0) {
      signal?.throwIfAborted()
      if (index > 0) await yieldToEventLoop()
      signal?.throwIfAborted()
    }
    const item = indexed[index]
    if (item === undefined) continue
    const rank = target === undefined ? 0 : targetRank(item.entry.target, target)
    if (rank === undefined) continue
    if (claimKinds !== undefined && !claimKinds.includes(item.entry.claimKind)) continue
    if (!terms.every(term => item.searchable.includes(term))) continue
    const requested = locales[0] ?? item.sourceLocale
    const fallback = knowledgeLocaleFallbacks(requested, locales.slice(1), item.sourceLocale)
    const localeRank = fallback.findIndex(locale => lower(locale) === lower(item.entry.locale))
    if (localeRank < 0) continue
    const hit = Object.freeze({
      entry: item.entry,
      provenance: item.provenance,
      localeRank,
    })
    const ranked = Object.freeze({ hit, priority: item.priority, targetRank: rank })
    const logicalKey = `${item.provenance.ownerExtensionId}\u0000${item.packId}\u0000${item.entry.id}\u0000${knowledgeTargetKey(item.entry.target)}`
    const previous = selected.get(logicalKey)
    if (previous === undefined || localeRank < previous.hit.localeRank)
      selected.set(logicalKey, ranked)
  }
  signal?.throwIfAborted()
  return Object.freeze(
    [...selected.values()].sort(
      (left, right) =>
        left.targetRank - right.targetRank ||
        left.hit.localeRank - right.hit.localeRank ||
        right.priority - left.priority ||
        compareUtf8(left.hit.provenance.ownerExtensionId, right.hit.provenance.ownerExtensionId) ||
        compareUtf8(left.hit.provenance.packId, right.hit.provenance.packId) ||
        compareUtf8(left.hit.entry.id, right.hit.entry.id),
    ),
  )
}

const paginate = (
  snapshotId: string,
  ranked: readonly RankedHit[],
  queryKey: string,
  cursor: string | undefined,
  requestedLimit: number | undefined,
  catalogDiagnostics: readonly KnowledgeDiagnostic[],
  catalogCompleteness: 'complete' | 'capped',
): KnowledgePage => {
  const limit = pageLimit(requestedLimit)
  const offset = cursorOffset(cursor, snapshotId, queryKey)
  if (offset === undefined || offset > ranked.length) {
    return Object.freeze({
      snapshotId,
      total: ranked.length,
      items: Object.freeze([]),
      completeness: 'invalid' as const,
      diagnostics: Object.freeze([
        ...catalogDiagnostics,
        ...limit.diagnostics,
        {
          code: 'x3.knowledge/invalid-cursor',
          message: 'knowledge cursor is not a valid offset in this snapshot',
          severity: 'error' as const,
        },
      ]),
    })
  }
  const end = Math.min(ranked.length, offset + limit.value)
  return Object.freeze({
    snapshotId,
    total: ranked.length,
    items: Object.freeze(ranked.slice(offset, end).map(item => item.hit)),
    ...(end < ranked.length ? { nextCursor: queryCursor(snapshotId, queryKey, end) } : {}),
    completeness: catalogCompleteness,
    diagnostics: Object.freeze([...catalogDiagnostics, ...limit.diagnostics]),
  })
}

const rejectedQuery = (
  snapshotId: string,
  code: string,
  message: string,
  catalogDiagnostics: readonly KnowledgeDiagnostic[],
): KnowledgePage =>
  Object.freeze({
    snapshotId,
    total: 0,
    items: Object.freeze([]),
    completeness: 'invalid' as const,
    diagnostics: Object.freeze([
      ...catalogDiagnostics,
      { code, message, severity: 'error' as const },
    ]),
  })

const queryProblem = (
  text: string | undefined,
  locales: readonly string[],
  target: KnowledgeTarget | undefined,
  claimKinds: readonly KnowledgeClaimKind[] | undefined,
  cursor: string | undefined,
): { readonly code: string; readonly message: string } | undefined => {
  if (
    text !== undefined &&
    (typeof text !== 'string' || text.length > MAXIMUM_SEARCH_TEXT_LENGTH)
  ) {
    return {
      code: 'x3.knowledge/query-text-too-long',
      message: `knowledge search text exceeds ${MAXIMUM_SEARCH_TEXT_LENGTH} characters`,
    }
  }
  if (
    !Array.isArray(locales) ||
    locales.length > MAXIMUM_QUERY_LOCALES ||
    locales.some(locale => !isKnowledgeLocaleTag(locale))
  ) {
    return {
      code: 'x3.knowledge/query-locales-invalid',
      message: `knowledge query accepts at most ${MAXIMUM_QUERY_LOCALES} valid locale tags of ${MAXIMUM_LOCALE_LENGTH} characters`,
    }
  }
  if (target !== undefined && !isKnowledgeTarget(target)) {
    return {
      code: 'x3.knowledge/query-target-invalid',
      message: 'knowledge target is malformed or exceeds its runtime bounds',
    }
  }
  if (
    claimKinds !== undefined &&
    (!Array.isArray(claimKinds) ||
      claimKinds.length > KNOWLEDGE_CLAIM_KINDS.size ||
      new Set(claimKinds).size !== claimKinds.length ||
      claimKinds.some(kind => !KNOWLEDGE_CLAIM_KINDS.has(kind)))
  ) {
    return {
      code: 'x3.knowledge/query-claim-kinds-invalid',
      message: 'knowledge claim kinds must be a unique subset of the registered claim kinds',
    }
  }
  if (
    cursor !== undefined &&
    (typeof cursor !== 'string' || cursor.length > MAXIMUM_CURSOR_LENGTH)
  ) {
    return {
      code: 'x3.knowledge/query-cursor-too-large',
      message: `knowledge cursor exceeds ${MAXIMUM_CURSOR_LENGTH} characters`,
    }
  }
  if (target !== undefined && knowledgeTargetKey(target).length > MAXIMUM_TARGET_KEY_LENGTH) {
    return {
      code: 'x3.knowledge/query-target-too-large',
      message: `knowledge target exceeds ${MAXIMUM_TARGET_KEY_LENGTH} canonical characters`,
    }
  }
  return undefined
}

/**
 * Build a bounded query view from one immutable inventory snapshot.
 *
 * Entries are read and indexed on the first query, not here: a pack may keep them in an
 * `entriesPath` file, read through `entriesSource`, and a host builds its catalog long before
 * anyone asks it a question. The snapshot id is fixed now, from what pins every entry — manifest
 * and artifact digests — and the limits.
 */
export function createKnowledgeCatalog(
  inventory: Inventory,
  requestedLimits: KnowledgeCatalogLimits = {},
  entriesSource?: KnowledgeEntriesSource,
): KnowledgeCatalog {
  const limits = resolveCatalogLimits(requestedLimits)
  const packs = knowledgePacks(inventory)
  const snapshotId = `knowledge-v1:${opaqueFingerprint(
    canonicalJsonStringify([
      [...new Set(packs.map(snapshotComponentOf))].sort(compareUtf8),
      limits.maxIndexedEntries,
      limits.maxSearchableCharacters,
    ]),
  )}`
  let collecting: Promise<CollectedKnowledge> | undefined
  let settled: CollectedKnowledge | undefined
  const knowledge = (): Promise<CollectedKnowledge> => {
    collecting ??= collect(packs, limits, entriesSource).then(
      value => (settled = value),
      (error: unknown) => {
        collecting = undefined
        throw error
      },
    )
    return collecting
  }
  return Object.freeze({
    snapshotId,
    async search(query: KnowledgeSearchQuery, signal?: AbortSignal): Promise<KnowledgePage> {
      signal?.throwIfAborted()
      const problem = queryProblem(
        query.text,
        query.locales,
        query.target,
        query.claimKinds,
        query.cursor,
      )
      if (problem !== undefined) {
        return rejectedQuery(snapshotId, problem.code, problem.message, settled?.diagnostics ?? [])
      }
      const collected = await knowledge()
      signal?.throwIfAborted()
      const ranked = await resolvedHits(
        collected.entries,
        query.locales,
        limits.scanChunkSize,
        signal,
        query.target,
        query.text,
        query.claimKinds,
      )
      signal?.throwIfAborted()
      const queryKey = opaqueFingerprint(
        canonicalJsonStringify([
          'search',
          lower(query.text ?? ''),
          query.target === undefined ? null : knowledgeTargetKey(query.target),
          query.locales.map(lower),
          [...(query.claimKinds ?? [])].sort(compareUtf8),
        ]),
      )
      return paginate(
        snapshotId,
        ranked,
        queryKey,
        query.cursor,
        query.limit,
        collected.diagnostics,
        collected.completeness,
      )
    },
    async resolve(query: KnowledgeResolveQuery, signal?: AbortSignal): Promise<KnowledgePage> {
      signal?.throwIfAborted()
      const problem = queryProblem(undefined, query.locales, query.target, undefined, query.cursor)
      if (problem !== undefined) {
        return rejectedQuery(snapshotId, problem.code, problem.message, settled?.diagnostics ?? [])
      }
      const collected = await knowledge()
      signal?.throwIfAborted()
      const ranked = await resolvedHits(
        collected.entries,
        query.locales,
        limits.scanChunkSize,
        signal,
        query.target,
      )
      signal?.throwIfAborted()
      const queryKey = opaqueFingerprint(
        canonicalJsonStringify([
          'resolve',
          knowledgeTargetKey(query.target),
          query.locales.map(lower),
        ]),
      )
      const page = paginate(
        snapshotId,
        ranked,
        queryKey,
        query.cursor,
        query.limit,
        collected.diagnostics,
        collected.completeness,
      )
      if (ranked.length < 2) return page
      return Object.freeze({
        ...page,
        diagnostics: Object.freeze([
          ...page.diagnostics,
          {
            code: 'x3.knowledge/multiple-target-entries',
            message:
              'multiple entries describe this target; deterministic order is not schema authority',
            severity: 'information' as const,
          },
        ]),
      })
    },
  })
}
