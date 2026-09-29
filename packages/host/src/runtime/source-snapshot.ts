/** Bounded source evidence for a Runtime composition prepared from a live ModContext.
 * Every game still reads through its own canonical loader. The host records consumed
 * bytes, directory pages and path resolutions, then replays them before admission.
 */
import type { ModContext } from '@modkit/vfs/content-sources'
import { sha256 } from '../artifact-files.js'

const MAX_FILES = 4_096
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_PATH_LENGTH = 4_096
const MAX_LIST_PAGES = 4_096
const MAX_LIST_ITEMS = 262_144
const MAX_LIST_BYTES = 64 * 1024 * 1024
const encoder = new TextEncoder()

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
      const orderedListings = [...listings.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      const orderedLocations = [...locations.values()].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      for (const [, listing] of orderedListings) {
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
