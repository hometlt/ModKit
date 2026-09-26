/**
 * S3, stage 1: what the host builds from a container's entry table, so a codec writes only
 * `index → entries`. From `ContainerEntryTable` this makes `common.view/namespace-entry-source`
 * (paged by cursor, prefix-filtered) and the `container.extract` handler (one entry's decoded bytes,
 * decoded by the shared owner in `compression/*`, bounded by the entry's size and the open budget).
 * Decoders load on first use, so no codec pays for pako or WASM at import.
 */
import {
  containerEntryRevision,
  revisionId,
  type ArtifactByteSource,
  type ByteRangeSource,
  type ResourceBudget,
} from '@modkit/sdk'
// A function declaration is initialised at instantiation, so this cycle with index.ts is safe.
import { simpleLease, type ContainerEntry, type ContainerEntryTable } from './index.js'

export const CONTAINER_EXTRACT_HANDLER_ID = 'extract-entry'

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function validPath(path: string): boolean {
  return path !== '' && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

export function containerEntryAccess(
  table: ContainerEntryTable,
  context: {
    readonly scheme: string
    readonly source: ArtifactByteSource
    readonly byteSource: ByteRangeSource
    readonly budget: ResourceBudget
  },
) {
  const fold = (path: string) => (table.caseSensitivity === 'insensitive' ? path.toLowerCase() : path)
  const byPath = new Map<string, ContainerEntry>()
  for (const entry of table.entries) {
    if (!validPath(entry.path)) throw new TypeError(`container entry path «${entry.path}» is invalid`)
    if (typeof entry.size !== 'bigint' || entry.size < 0n) throw new TypeError(`container entry ${entry.path} has an invalid size`)
    const key = fold(entry.path)
    if (byPath.has(key)) throw new TypeError(`container entry path «${entry.path}» is not unique`)
    byPath.set(key, entry)
  }
  const entries = [...byPath.values()]
  const containerRevision = revisionId(String(context.source.revision))
  const maximum = Number(context.budget.maxInputBytes)
  const storedSize = (entry: ContainerEntry): bigint | undefined =>
    entry.storage.kind === 'stored'
      ? entry.storage.length
      : entry.storage.kind === 'custom'
        ? undefined
        : entry.storage.compressedLength

  const namespace = Object.freeze({
    async list(prefix: string, page: { readonly limit: number; readonly cursor?: string }, signal?: AbortSignal) {
      throwIfCancelled(signal)
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) throw new TypeError('page limit must be a positive safe integer')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid container entry cursor')
      const wanted = fold(prefix)
      const matching = prefix === '' ? entries : entries.filter(entry => fold(entry.path).startsWith(wanted))
      const items = matching.slice(start, start + page.limit).map(entry => {
        const stored = storedSize(entry)
        return Object.freeze({
          id: entry.path,
          path: entry.path,
          name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
          kind: 'file' as const,
          size: entry.size,
          ...(stored === undefined || stored === entry.size ? {} : { storedSize: stored }),
          ...(entry.storage.kind === 'custom' ? {} : { compression: entry.storage.kind }),
          ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
          ...(entry.checksum === undefined ? {} : { checksum: entry.checksum }),
          revision: containerEntryRevision(containerRevision, entry.path, entry.size),
        })
      })
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length ? { nextCursor: String(start + items.length) } : {}),
      })
    },
    async openEntry(entryId: string, signal?: AbortSignal) {
      throwIfCancelled(signal)
      const entry = byPath.get(fold(entryId))
      if (entry === undefined) throw new TypeError(`unknown container entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${context.source.ref.id}!/${entry.path}`,
          uri: `${context.scheme}:${encodeURIComponent(context.source.ref.uri)}!/${entry.path}`,
          parentIds: Object.freeze([context.source.ref.id]) as readonly [string],
        }),
      )
    },
  })

  const readRange = async (offset: bigint, length: bigint, signal: AbortSignal | undefined) => {
    if (length > BigInt(maximum)) throw new RangeError(`container entry range of ${length} bytes exceeds the read budget of ${maximum}`)
    const bytes = await context.byteSource.read(offset, Number(length), signal)
    if (BigInt(bytes.byteLength) !== length) throw new RangeError('container entry is truncated')
    return bytes
  }

  /** One entry's decoded bytes, whole: bounded by its size and by the open budget. */
  const extractEntry = async (entry: ContainerEntry, signal: AbortSignal | undefined): Promise<Uint8Array> => {
    if (entry.size > BigInt(maximum)) {
      throw new RangeError(`container entry ${entry.path} (${entry.size} bytes) exceeds the extraction budget of ${maximum}`)
    }
    const size = Number(entry.size)
    const storage = entry.storage
    let bytes: Uint8Array
    switch (storage.kind) {
      case 'stored':
        bytes = await readRange(storage.offset, storage.length, signal)
        break
      case 'deflate':
      case 'zlib':
      case 'gzip': {
        const { decompressBounded } = await import('./compression/bounded.js')
        const format = storage.kind === 'deflate' ? 'deflate-raw' : storage.kind === 'zlib' ? 'deflate' : 'gzip'
        bytes = await decompressBounded(await readRange(storage.offset, storage.compressedLength, signal), format, {
          maxOutputBytes: size,
          ...(signal === undefined ? {} : { signal }),
        })
        break
      }
      case 'zstd': {
        const { decodeZstd } = await import('./compression/zstd.js')
        bytes = decodeZstd(await readRange(storage.offset, storage.compressedLength, signal), {
          expectedLength: size,
          maxOutputBytes: size,
        })
        break
      }
      case 'lz4-block': {
        const { decodeLz4Block } = await import('./compression/lz4.js')
        bytes = decodeLz4Block(await readRange(storage.offset, storage.compressedLength, signal), size)
        break
      }
      case 'refpack': {
        const { decodeRefPack } = await import('./compression/refpack.js')
        bytes = decodeRefPack(await readRange(storage.offset, storage.compressedLength, signal), size)
        break
      }
      case 'custom': {
        const opened = await storage.open(signal)
        if (Symbol.asyncIterator in opened) {
          const chunks: Uint8Array[] = []
          let total = 0
          for await (const chunk of opened as AsyncIterable<Uint8Array>) {
            throwIfCancelled(signal)
            total += chunk.byteLength
            if (total > size) throw new RangeError(`container entry ${entry.path} decodes past its size`)
            chunks.push(chunk)
          }
          bytes = new Uint8Array(total)
          let at = 0
          for (const chunk of chunks) {
            bytes.set(chunk, at)
            at += chunk.byteLength
          }
        } else {
          bytes = await (opened as ByteRangeSource).read(0n, size, signal)
        }
        break
      }
    }
    if (bytes.byteLength !== size) {
      throw new RangeError(`container entry ${entry.path} decoded to ${bytes.byteLength} bytes, not ${size}`)
    }
    return bytes
  }

  const extract = async (input: unknown, operation: { readonly signal?: AbortSignal }) => {
    const entryId =
      input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as { readonly entryId?: unknown }).entryId
        : undefined
    const entry = typeof entryId === 'string' ? byPath.get(fold(entryId)) : undefined
    if (entry === undefined) throw new TypeError('container.extract requires a known {entryId}')
    return { kind: 'bytes' as const, value: await extractEntry(entry, operation.signal) }
  }

  const decodedTotal = entries.reduce((total, entry) => total + entry.size, 0n)
  return Object.freeze({ namespace, extract, extractEntry, decodedTotal })
}
