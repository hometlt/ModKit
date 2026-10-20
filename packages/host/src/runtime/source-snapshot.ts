/** Bounded source evidence and owned finite input namespaces for Runtime preparation.
 * Every game still reads through its own canonical loader. The host records consumed
 * bytes, directory pages and path resolutions, then replays them before admission.
 * A supplied plan can be sealed without native I/O; this does not qualify its native coverage.
 */
import { sha256 } from '../artifact-files.js'
import { canonicalJsonStringify, throwIfAborted } from '@modkit/core'
import type { ResourceBudget } from '@modkit/sdk'
import { createMemorySource, normalizeVfsPath, type RandomAccessSource } from '@modkit/vfs'
import { layeredModContext, type LayeredContextLayer, type ModContextLayer, type ModContext } from '@modkit/vfs/content-sources'

const MAX_FILES = 4_096
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_PATH_LENGTH = 4_096
const MAX_LIST_PAGES = 4_096
const MAX_LIST_ITEMS = 262_144
const MAX_LIST_BYTES = 64 * 1024 * 1024
const encoder = new TextEncoder()

/** Supplied finite namespace plan; native planners own coverage. This is not a persistent format or launch authority. */
export interface RuntimeInputPlanLayer {
  readonly layer: ModContextLayer
  /** Closed logical prefixes: the path itself and descendants. First profile requires the same prefixes in case-insensitive layers. */
  readonly scopes: readonly string[]
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[]
}

/** Own bytes and metadata before awaiting; expose one closed path-prefix namespace through the existing VFS. No live fallback. */
export async function sealRuntimeInputPlan(
  gameId: string, contextId: string, plan: readonly RuntimeInputPlanLayer[],
  budget: ResourceBudget, signal?: AbortSignal,
): Promise<ModContext> {
  throwIfAborted(signal)
  if (!gameId || !contextId || !Array.isArray(plan) || plan.length === 0 ||
    typeof budget.maxInputBytes !== 'bigint' || budget.maxInputBytes < 1n ||
    !Number.isSafeInteger(budget.maxNodes) || budget.maxNodes < 1 ||
    !Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 1 ||
    !Number.isSafeInteger(budget.maxDepth) || budget.maxDepth < 1 ||
    budget.deadlineMs !== undefined && (!Number.isSafeInteger(budget.deadlineMs) ||
      budget.deadlineMs < 1 || budget.deadlineMs > 2_147_483_647))
    throw new TypeError('Invalid runtime input plan or budget')
  const lifetime = new AbortController()
  const selectedSignal = AbortSignal.any([lifetime.signal,
    ...(signal === undefined ? [] : [signal]),
    ...(budget.deadlineMs === undefined ? [] : [AbortSignal.timeout(budget.deadlineMs)])])
  let active = true, nodes = 0, bytes = 0, nameBytes = 0, fileCount = 0
  const live = () => { throwIfAborted(selectedSignal); if (!active) throw new Error('Captured inputs disposed') }
  const charge = () => {
    if (++nodes > Math.min(budget.maxNodes, MAX_LIST_ITEMS))
      throw new RangeError('Runtime input node budget exceeded')
  }
  const pathOf = (path: string, ownName = false) => {
    if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH ||
      path !== normalizeVfsPath(path) || /^[a-z]:/iu.test(path) ||
      path.split('/').length > budget.maxDepth || encoder.encode(path).length > budget.maxScalarBytes)
      throw new TypeError('Runtime input path is not canonical and bounded')
    if (ownName) nameBytes += encoder.encode(path).length
    if (nameBytes > MAX_LIST_BYTES) throw new RangeError('Runtime input name budget exceeded')
    return path
  }
  const metadata = (value: string) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > budget.maxScalarBytes)
      throw new TypeError('Runtime metadata must be a bounded string')
    const size = encoder.encode(value).length
    nameBytes += size
    if (size > budget.maxScalarBytes || nameBytes > MAX_LIST_BYTES)
      throw new RangeError('Runtime input metadata budget exceeded')
  }
  metadata(gameId); metadata(contextId)
  const scopes = new Map<string, readonly string[]>()
  const layers: LayeredContextLayer[] = []
  const identities: {layer: ModContextLayer; scopes: readonly string[]; files: Map<string, Uint8Array>}[] = []
  const ranges = new Set<RandomAccessSource>()
  try {
    // Own all caller bytes and metadata before the first await; later hashing cannot race mutations.
    for (const supplied of plan) {
      live(); charge()
      const layer = Object.freeze({ ...supplied.layer })
      if (!layer.id || scopes.has(layer.id) || layer.caseSensitive === true || layer.sourceId === 'host' ||
        !Array.isArray(supplied.scopes) || supplied.scopes.length === 0 || !Array.isArray(supplied.files))
        throw new TypeError('Runtime layers require unique ids and portable case-insensitive scopes')
      for (const value of Object.values(layer)) {
        if (typeof value === 'string') metadata(value)
        else if (typeof value !== 'boolean' && value !== undefined)
          throw new TypeError('Runtime layer metadata must contain only immutable scalar fields')
      }
      const prefixes: readonly string[] = Object.freeze(supplied.scopes.map((prefix: string) => {
        charge(); return pathOf(prefix, true).toLowerCase()
      }))
      if (new Set(prefixes).size !== prefixes.length) throw new TypeError('Repeated runtime scope')
      if (identities.length && canonicalJsonStringify(prefixes) !== canonicalJsonStringify(identities[0]!.scopes))
        throw new TypeError('Runtime input plan requires the same closed scopes in every layer')
      scopes.set(layer.id, prefixes)
      const owned = new Map<string, Uint8Array>()
      const keys = new Set<string>()
      for (const file of supplied.files) {
        live(); charge()
        const path = pathOf(file.path, true), key = path.toLowerCase()
        if (keys.has(key) || !prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}/`)) ||
          !(file.bytes instanceof Uint8Array)) throw new TypeError('Duplicate or out-of-scope runtime member')
        keys.add(key)
        bytes += file.bytes.byteLength
        if (++fileCount > MAX_FILES ||
          file.bytes.byteLength > budget.maxScalarBytes || bytes > MAX_TOTAL_BYTES ||
          BigInt(bytes) > budget.maxInputBytes) throw new RangeError('Runtime input byte budget exceeded')
        owned.set(path, Uint8Array.from(file.bytes))
      }
      identities.push({ layer, scopes: prefixes, files: owned })
      layers.push(Object.freeze({ ...layer, content: { archive: {
        id: layer.id,
        entries: Object.freeze([...owned].map(([path, value]) => Object.freeze({ path, size: value.length }))),
        async read(path: string, maxBytes: number) {
          live()
          const value = owned.get(path)
          if (!value || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || value.length > maxBytes)
            throw new RangeError('Captured member missing or exceeds read budget')
          return value.slice()
        },
        async openRange(path: string, rangeSignal?: AbortSignal) {
          live(); throwIfAborted(rangeSignal); charge()
          const value = owned.get(path)
          if (!value) throw new RangeError('Captured member missing')
          const memory = createMemorySource(`${contextId}/${layer.id}/${path}`, value)
          // Each acquisition owns a separate source lease over the same unexposed fixed bytes.
          const combined = AbortSignal.any([selectedSignal, ...(rangeSignal ? [rangeSignal] : [])])
          return { revision: revision, source: observedFacade(memory, new Map<PropertyKey, unknown>([
            ['dispose', () => memory.dispose()],
            ['size', (readSignal?: AbortSignal) => memory.size(AbortSignal.any([combined, ...(readSignal ? [readSignal] : [])]))],
            ['readAt', (offset: number, length: number, readSignal?: AbortSignal) => {
              if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length))
                return Promise.reject(new RangeError('Captured range requires exact integer coordinates'))
              return memory.readAt(offset, length, AbortSignal.any([combined, ...(readSignal ? [readSignal] : [])]))
            }],
            ['stream', (start = 0, end = value.length, readSignal?: AbortSignal) => {
              if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > value.length)
                throw new RangeError('Captured stream is outside exact integer coordinates')
              return memory.stream(start, end, AbortSignal.any([combined, ...(readSignal ? [readSignal] : [])]))
            }],
          ]), live) }
        },
        close() { owned.clear() },
      } } }))
    }
    const digestInput = []
    for (const identity of identities) {
      const files = []
      for (const [path, value] of identity.files) { live(); files.push({ path, digest: await sha256(value) }) }
      digestInput.push({ layer: identity.layer, scopes: identity.scopes, files })
    }
    const revision = await sha256(encoder.encode(canonicalJsonStringify(digestInput)))
    live()
    const unavailable = async () => { throw new Error('Runtime inputs have no live source fallback') }
    const raw = layeredModContext({ files: unavailable, read: unavailable }, {
      gameId, contextId, layers: Object.freeze(layers),
    })
    const within = (layerId: string, path: string, listing = false) => {
      live()
      const prefixes = scopes.get(layerId)
      const normalized = normalizeVfsPath(path)
      const key = listing && normalized === '' ? '' : pathOf(normalized).toLowerCase()
      if (!prefixes || !(listing && key === '' || prefixes.some(prefix =>
        key === prefix || key.startsWith(`${prefix}/`))))
        throw new RangeError('Requested path was not captured')
    }
    let disposal: Promise<void> | undefined
    const dispose = () => disposal ??= Promise.resolve().then(async () => {
      active = false; lifetime.abort(new Error('Captured inputs disposed'))
      await Promise.allSettled([...ranges].map(source => source.dispose()))
      await raw.dispose()
    })
    // Cancellation retires existing leases even when the consumer does not call dispose itself.
    selectedSignal.addEventListener('abort', () => { void dispose().catch(() => undefined) }, { once: true })
    return observedFacade(raw, new Map<PropertyKey, unknown>([
      ['revision', revision], ['layers', Object.freeze(raw.layers)], ['dispose', dispose],
      ['files', async (layerId: string, page: Parameters<ModContext['files']>[1]) => {
        within(layerId, page.prefix ?? '', true); const value = await raw.files(layerId, page); live(); return value
      }],
      ['read', async (layerId: string, path: string, maxBytes: number) => {
        within(layerId, path); const value = await raw.read(layerId, path, maxBytes); live(); return value
      }],
      ['readWithContext', async (layerId: string, path: string, maxBytes: number) => {
        within(layerId, path); const value = await raw.readWithContext!(layerId, path, maxBytes); live(); return value
      }],
      ['locate', async (path: string) => {
        for (const layer of layers) within(layer.id, path)
        const value = await raw.locate(path); live(); return value
      }],
      ['openRangeWithContext', async (layerId: string, path: string, rangeSignal?: AbortSignal) => {
        within(layerId, path)
        const value = await raw.openRangeWithContext!(layerId, path, rangeSignal)
        if (!value) throw new Error('Captured member has no range source')
        try { live(); throwIfAborted(rangeSignal) } catch (error) { await value.source.dispose(); throw error }
        const retained = observedFacade(value.source, new Map<PropertyKey, unknown>([
          ['size', async (readSignal?: AbortSignal) => {
            live(); const result = await value.source.size(readSignal); live(); return result
          }],
          ['readAt', async (offset: number, length: number, readSignal?: AbortSignal) => {
            live(); const result = await value.source.readAt(offset, length, readSignal); live(); return result
          }],
          ['stream', (start?: number, end?: number, readSignal?: AbortSignal) => {
            live(); return value.source.stream(start, end, readSignal)
          }],
          ['dispose', () => { ranges.delete(retained); return value.source.dispose() }],
        ]))
        ranges.add(retained)
        return { ...value, source: retained }
      }],
    ]), live)
  } catch (error) {
    active = false; lifetime.abort(error)
    for (const layer of layers) if ('archive' in layer.content) await layer.content.archive.close()
    throw error
  }
}


/** Forward original receivers even for frozen providers; an empty proxy target avoids invariants. */
function observedFacade<Value extends object>(
  original: Value,
  overrides: ReadonlyMap<PropertyKey, unknown>,
  assertCurrent?: () => void,
): Value {
  const functions = new WeakMap<Function, Function>()
  const facade: Value = new Proxy(Object.create(null) as Value, {
    get(_target, key) {
      if (overrides.has(key)) return overrides.get(key)
      const value: unknown = Reflect.get(original, key, original)
      if (typeof value !== 'function') return value
      let forwarded = functions.get(value)
      if (!forwarded) {
        forwarded = (...args: unknown[]) => {
          assertCurrent?.()
          const answer: unknown = Reflect.apply(value, original, args)
          if (assertCurrent && answer && typeof (answer as { then?: unknown }).then === 'function')
            return Promise.resolve(answer).then(result => { assertCurrent(); return result })
          assertCurrent?.()
          return answer
        }
        functions.set(value, forwarded)
      }
      return forwarded
    },
    has: (_target, key) => Reflect.has(original, key),
    ownKeys: () => Reflect.ownKeys(original),
    getOwnPropertyDescriptor(_target, key): PropertyDescriptor | undefined {
      const descriptor = Reflect.getOwnPropertyDescriptor(original, key)
      return descriptor ? { configurable: true, enumerable: descriptor.enumerable ?? false,
        writable: false, value: Reflect.get(facade, key) } : undefined
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(original),
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    preventExtensions: () => false,
  })
  return facade
}

interface SourceRead {
  readonly layerId: string
  readonly path: string
  readonly maxBytes: number
  readonly size: number
  readonly digest: string
}

interface SourceListing {
  readonly layerId: string
  readonly request: Parameters<ModContext['files']>[1]
  readonly items: readonly string[]
  readonly nextCursor?: string
}

interface SourceLocation {
  readonly path: string
  readonly answer: Awaited<ReturnType<ModContext['locate']>>
}

export interface RuntimeSourceSnapshot {
  readonly context: ModContext
  verify(signal?: AbortSignal): Promise<
    Readonly<{
      digest: string
      fileCount: number
      totalBytes: number
    }>
  >
}

export class RuntimeSourceChangedError extends Error {
  readonly code = 'x3.host/runtime-source-changed'
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSourceChangedError'
  }
}

export class RuntimeSourceBudgetError extends Error {
  readonly code = 'x3.host/runtime-source-budget'
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSourceBudgetError'
  }
}

export class RuntimeSourceUntrackedQueryError extends Error {
  readonly code = 'x3.host/runtime-source-untracked-query'
  constructor() {
    super(
      'Runtime composition cannot use ModContext.query: its internal source reads are not captured',
    )
    this.name = 'RuntimeSourceUntrackedQueryError'
  }
}

function validAddress(layerId: string, path: string): boolean {
  return (
    layerId.length > 0 &&
    layerId.length <= MAX_PATH_LENGTH &&
    !layerId.includes('\0') &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.includes('\0')
  )
}

/** The returned context is only for this open attempt; caller still owns the original lease. */
export function captureRuntimeSourceReads(context: ModContext): RuntimeSourceSnapshot {
  const reads = new Map<string, SourceRead>()
  const listings = new Map<string, SourceListing>()
  const locations = new Map<string, SourceLocation>()
  let totalBytes = 0
  let listedItems = 0
  let listedBytes = 0
  let verifying = false
  let inFlight = 0
  const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
  const listAnswer = (page: Awaited<ReturnType<ModContext['files']>>, limit: number) => {
    if (!Array.isArray(page?.items) || page.items.length > limit
      || page.items.length > MAX_LIST_ITEMS || page.items.some(item =>
        typeof item !== 'string' || !validAddress('listed', item))
      || (page.nextCursor !== undefined && (typeof page.nextCursor !== 'string'
        || page.nextCursor.length > MAX_PATH_LENGTH)))
      throw new RuntimeSourceBudgetError('Runtime source listing is invalid or unbounded')
    return { items: [...page.items],
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
  }
  const wrapped: ModContext = Object.freeze({
    schemaVersion: context.schemaVersion,
    gameId: context.gameId,
    contextId: context.contextId,
    layers: context.layers,
    unresolved: context.unresolved,
    diagnostics: context.diagnostics,
    async files(layerId: string, page: Parameters<ModContext['files']>[1]) {
      if (verifying)
        throw new RuntimeSourceChangedError('Runtime inputs changed during verification')
      if (!validAddress(layerId, 'files') || !Number.isSafeInteger(page?.limit)
        || page.limit < 1 || page.limit > MAX_LIST_ITEMS
        || (page.prefix !== undefined && (typeof page.prefix !== 'string'
          || !validAddress(layerId, page.prefix || 'files')))
        || (page.cursor !== undefined && (typeof page.cursor !== 'string'
          || page.cursor.length > MAX_PATH_LENGTH)))
        throw new TypeError('Runtime source listing has invalid arguments')
      const request = { limit: page.limit,
        ...(page.prefix === undefined ? {} : { prefix: page.prefix }),
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
      const key = JSON.stringify([layerId, request])
      inFlight += 1
      try {
        const answer = listAnswer(await context.files(layerId, request), request.limit)
        const previous = listings.get(key)
        if (previous !== undefined) {
          if (!same(answer, { items: previous.items,
            ...(previous.nextCursor === undefined ? {} : { nextCursor: previous.nextCursor }) }))
            throw new RuntimeSourceChangedError(`Runtime source listing changed for ${layerId}`)
          return answer
        }
        const bytes = encoder.encode(JSON.stringify(answer)).byteLength
        if (listings.size >= MAX_LIST_PAGES || answer.items.length > MAX_LIST_ITEMS - listedItems
          || bytes > MAX_LIST_BYTES - listedBytes)
          throw new RuntimeSourceBudgetError('Runtime source listing exceeds its page or byte budget')
        listings.set(key, { layerId, request, ...answer })
        listedItems += answer.items.length
        listedBytes += bytes
        return answer
      } finally {
        inFlight -= 1
      }
    },
    async locate(path: string) {
      if (verifying)
        throw new RuntimeSourceChangedError('Runtime inputs changed during verification')
      if (!validAddress('locate', path))
        throw new TypeError('Runtime source location has an invalid path')
      inFlight += 1
      try {
        const found = await context.locate(path)
        if (found !== undefined && !validAddress(found.layerId, found.path))
          throw new RuntimeSourceBudgetError('Runtime source location is invalid')
        const answer = found === undefined ? undefined
          : { layerId: found.layerId, path: found.path }
        const previous = locations.get(path)
        if (previous !== undefined) {
          if (!same(previous.answer, answer))
            throw new RuntimeSourceChangedError(`Runtime source location changed for ${path}`)
        } else {
          if (locations.size >= MAX_FILES)
            throw new RuntimeSourceBudgetError('Runtime source locations exceed their budget')
          locations.set(path, { path, answer })
        }
        return answer
      } finally {
        inFlight -= 1
      }
    },
    ...(context.query === undefined
      ? {}
      : {
          async query() {
            throw new RuntimeSourceUntrackedQueryError()
          },
        }),
    dispose: () => context.dispose(),
    async read(layerId: string, path: string, maxBytes: number) {
      if (verifying)
        throw new RuntimeSourceChangedError('Runtime inputs changed during verification')
      if (!validAddress(layerId, path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new TypeError('Runtime source read has an invalid address or byte limit')
      inFlight += 1
      try {
        const bytes = await context.read(layerId, path, maxBytes)
        const digest = await sha256(bytes)
        const key = `${layerId}\0${path}`
        const previous = reads.get(key)
        if (previous !== undefined) {
          if (previous.digest !== digest)
            throw new RuntimeSourceChangedError(`Runtime source changed while reading ${path}`)
          return bytes
        }
        if (reads.size >= MAX_FILES || bytes.byteLength > MAX_TOTAL_BYTES - totalBytes)
          throw new RuntimeSourceBudgetError(
            'Runtime source snapshot exceeds its file or byte budget',
          )
        reads.set(key, { layerId, path, maxBytes, size: bytes.byteLength, digest })
        totalBytes += bytes.byteLength
        return bytes
      } finally {
        inFlight -= 1
      }
    },
  })
  return {
    context: wrapped,
    async verify(signal) {
      if (inFlight !== 0)
        throw new RuntimeSourceChangedError('Runtime preparer left source reads unfinished')
      verifying = true
      const ordered = [...reads.values()].sort((a, b) => {
        const first = `${a.layerId}\0${a.path}`
        const second = `${b.layerId}\0${b.path}`
        return first < second ? -1 : first > second ? 1 : 0
      })
      // Opaque cursors may be valid only after their preceding page. Replay in call order;
      // canonicalize separately for a digest independent of unrelated query scheduling.
      const replayListings = [...listings.entries()]
      const orderedListings = [...replayListings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      const orderedLocations = [...locations.values()].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      for (const [, listing] of replayListings) {
        signal?.throwIfAborted()
        let answer: ReturnType<typeof listAnswer>
        try { answer = listAnswer(await context.files(listing.layerId, listing.request),
          listing.request.limit) }
        catch (error) {
          signal?.throwIfAborted()
          throw new RuntimeSourceChangedError(`Runtime source listing is no longer readable: ${String(error)}`)
        }
        if (!same(answer, { items: listing.items,
          ...(listing.nextCursor === undefined ? {} : { nextCursor: listing.nextCursor }) }))
          throw new RuntimeSourceChangedError(`Runtime source listing changed for ${listing.layerId}`)
      }
      for (const location of orderedLocations) {
        signal?.throwIfAborted()
        let answer: Awaited<ReturnType<ModContext['locate']>>
        try {
          const found = await context.locate(location.path)
          answer = found === undefined ? undefined
            : { layerId: found.layerId, path: found.path }
        }
        catch (error) {
          signal?.throwIfAborted()
          throw new RuntimeSourceChangedError(`Runtime source location is no longer readable: ${String(error)}`)
        }
        if (!same(answer, location.answer))
          throw new RuntimeSourceChangedError(`Runtime source location changed for ${location.path}`)
      }
      for (const read of ordered) {
        signal?.throwIfAborted()
        let bytes: Uint8Array
        try {
          bytes = await context.read(read.layerId, read.path, read.maxBytes)
        } catch (error) {
          signal?.throwIfAborted()
          throw new RuntimeSourceChangedError(
            `Runtime source ${read.path} is no longer readable: ${String(error)}`,
          )
        }
        if (bytes.byteLength !== read.size || (await sha256(bytes)) !== read.digest)
          throw new RuntimeSourceChangedError(`Runtime source changed while preparing ${read.path}`)
      }
      const identity: unknown[] = ordered.map(read => [read.layerId, read.path, read.digest])
      identity.push(...orderedListings.map(([key, listing]) =>
        ['files', key, listing.items, listing.nextCursor ?? null]))
      identity.push(...orderedLocations.map(location =>
        ['locate', location.path, location.answer ?? null]))
      return Object.freeze({
        digest: await sha256(encoder.encode(JSON.stringify(identity))),
        fileCount: ordered.length,
        totalBytes,
      })
    },
  }
}
