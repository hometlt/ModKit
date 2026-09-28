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
    /** A companion binding's bytes by range, for entries whose `storage.source` names one. */
    readonly companionSource?: (
      bindingId: string,
      signal: AbortSignal | undefined,
    ) => Promise<{ readonly source: ByteRangeSource; release(): Promise<void> }>
  },
) {
  const fold = (path: string) =>
    table.caseSensitivity === 'insensitive' ? path.toLowerCase() : path
  const byPath = new Map<string, ContainerEntry>()
  for (const entry of table.entries) {
    if (!validPath(entry.path))
      throw new TypeError(`container entry path «${entry.path}» is invalid`)
    if (typeof entry.size !== 'bigint' || entry.size < 0n)
      throw new TypeError(`container entry ${entry.path} has an invalid size`)
    const key = fold(entry.path)
    if (byPath.has(key)) throw new TypeError(`container entry path «${entry.path}» is not unique`)
    byPath.set(key, entry)
  }
  const entries = [...byPath.values()]
  const containerRevision = revisionId(String(context.source.revision))
  const directories = (table.directories ?? []).map(({ path, hidden }) => {
    if (!validPath(path)) throw new TypeError(`container folder path «${path}» is invalid`)
    return Object.freeze({
      id: `${path}/`,
      path: `${path}/`,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind: 'directory' as const,
      ...(hidden === true ? { hidden: true as const } : {}),
      // a plain string: a branded RevisionId would leak an unexported brand into the declarations
      revision: String(context.source.revision),
    })
  })
  const maximum = Number(context.budget.maxInputBytes)
  const storedSize = (entry: ContainerEntry): bigint | undefined =>
    entry.storage.kind === 'stored'
      ? entry.storage.length
      : entry.storage.kind === 'custom'
        ? undefined
        : entry.storage.compressedLength

  const toItem = (entry: ContainerEntry) => {
    const stored = storedSize(entry)
    return Object.freeze({
      id: entry.path,
      path: entry.path,
      name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
      kind: 'file' as const,
      size: entry.size,
      ...(stored === undefined || stored === entry.size ? {} : { storedSize: stored }),
      ...(entry.storage.kind !== 'custom'
        ? { compression: entry.storage.kind }
        : entry.storage.compression === undefined
          ? {}
          : { compression: entry.storage.compression }),
      ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
      ...(entry.checksum === undefined ? {} : { checksum: entry.checksum }),
      ...(entry.hidden === true ? { hidden: true as const } : {}),
      ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
      // In place only within the container's own source; a companion's entry is extracted.
      ...(entry.storage.kind === 'stored' && entry.storage.source === undefined
        ? {
            storedRange: Object.freeze({
              offset: entry.storage.offset,
              length: entry.storage.length,
            }),
          }
        : {}),
      // Readable by range without extraction: stored data in a companion, or a custom entry whose
      // storage promises a range source.
      ...((entry.storage.kind === 'stored' && entry.storage.source !== undefined) ||
      (entry.storage.kind === 'custom' && entry.storage.rangeAccess === true)
        ? { rangeAccess: true as const }
        : {}),
      revision: containerEntryRevision(containerRevision, entry.path, entry.size),
    })
  }

  // Entries a lookup found beyond the listing (a hashed archive without its file list).
  const found = new Map<string, ContainerEntry>()
  const entryAt = async (
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<ContainerEntry | undefined> => {
    const key = fold(path)
    const known = byPath.get(key) ?? found.get(key)
    if (known !== undefined || table.find === undefined || !validPath(path)) return known
    const entry = await table.find(path, signal)
    if (entry === undefined) return undefined
    if (fold(entry.path) !== key || typeof entry.size !== 'bigint' || entry.size < 0n) {
      throw new TypeError(`container lookup of «${path}» answered another or an invalid entry`)
    }
    found.set(key, entry)
    return entry
  }

  const namespace = Object.freeze({
    async list(
      prefix: string,
      page: { readonly limit: number; readonly cursor?: string },
      signal?: AbortSignal,
    ) {
      throwIfCancelled(signal)
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('page limit must be a positive safe integer')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid container entry cursor')
      // a prefix selects a path and what is under it, never a sibling that shares its start
      const wanted = fold(prefix)
      const under = wanted.endsWith('/') ? wanted : `${wanted}/`
      const matching =
        prefix === ''
          ? entries
          : entries.filter(entry => {
              const path = fold(entry.path)
              return path === wanted || path.startsWith(under)
            })
      const folders = directories.filter(folder => {
        const path = fold(folder.path)
        return prefix === '' || path === `${wanted}/` || path.startsWith(under)
      })
      const all = [...matching.map(toItem), ...folders]
      const items = all.slice(start, start + page.limit)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}),
      })
    },
    ...(table.nestedContext === undefined
      ? {}
      : {
          async nestedContext(signal?: AbortSignal) {
            throwIfCancelled(signal)
            return table.nestedContext
          },
        }),
    ...(table.preamble === undefined
      ? {}
      : {
          async readPreamble(maxBytes: number, signal?: AbortSignal) {
            throwIfCancelled(signal)
            if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
              throw new TypeError('preamble maxBytes must be a non-negative safe integer')
            const bytes = await table.preamble!(maxBytes, signal)
            if (bytes.byteLength > maxBytes)
              throw new RangeError('container preamble exceeds the requested bound')
            // an owned buffer: the namespace crosses worker boundaries
            return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
              ? bytes
              : bytes.slice()
          },
        }),
    async lookup(path: string, signal?: AbortSignal) {
      throwIfCancelled(signal)
      const entry = await entryAt(path, signal)
      return entry === undefined ? undefined : toItem(entry)
    },
    async openEntrySource(entryId: string, signal?: AbortSignal) {
      throwIfCancelled(signal)
      const entry = await entryAt(entryId, signal)
      if (entry === undefined) throw new TypeError(`unknown container entry ${entryId}`)
      const storage = entry.storage
      if (storage.kind === 'stored' && storage.source !== undefined) {
        if (context.companionSource === undefined)
          throw new TypeError(
            `container entry data lives in companion «${storage.source}», which this open does not carry`,
          )
        const companion = await context.companionSource(storage.source, signal)
        const window = Object.freeze<ByteRangeSource>({
          size: async () => storage.length,
          async read(offset, length, readSignal) {
            if (offset < 0n || offset + BigInt(length) > storage.length)
              throw new RangeError('container entry read is outside the entry')
            return companion.source.read(storage.offset + offset, length, readSignal)
          },
        })
        return Object.freeze({ value: window, release: () => companion.release() })
      }
      if (storage.kind === 'custom' && storage.rangeAccess === true) {
        const opened = await storage.open(signal)
        if (Symbol.asyncIterator in opened)
          throw new TypeError(`container entry ${entry.path} promised a range source, not a stream`)
        return Object.freeze({ value: opened, release: async () => undefined })
      }
      throw new TypeError(`container entry ${entry.path} is not readable by range; extract it`)
    },
    async openEntry(entryId: string, signal?: AbortSignal) {
      throwIfCancelled(signal)
      const entry = await entryAt(entryId, signal)
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

  const readRange = async (
    offset: bigint,
    length: bigint,
    signal: AbortSignal | undefined,
    bindingId?: string,
  ) => {
    if (length > BigInt(maximum))
      throw new RangeError(
        `container entry range of ${length} bytes exceeds the read budget of ${maximum}`,
      )
    let bytes: Uint8Array
    if (bindingId === undefined) {
      bytes = await context.byteSource.read(offset, Number(length), signal)
    } else {
      if (context.companionSource === undefined) {
        throw new TypeError(
          `container entry data lives in companion «${bindingId}», which this open does not carry`,
        )
      }
      const companion = await context.companionSource(bindingId, signal)
      try {
        bytes = await companion.source.read(offset, Number(length), signal)
      } finally {
        await companion.release()
      }
    }
    if (BigInt(bytes.byteLength) !== length) throw new RangeError('container entry is truncated')
    return bytes
  }

  /** One entry's decoded bytes, whole: bounded by its size and by the open budget. */
  const extractEntry = async (
    entry: ContainerEntry,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> => {
    if (entry.size > BigInt(maximum)) {
      throw new RangeError(
        `container entry ${entry.path} (${entry.size} bytes) exceeds the extraction budget of ${maximum}`,
      )
    }
    const size = Number(entry.size)
    const storage = entry.storage
    let bytes: Uint8Array
    switch (storage.kind) {
      case 'stored':
        bytes = await readRange(storage.offset, storage.length, signal, storage.source)
        break
      case 'deflate':
      case 'zlib':
      case 'gzip': {
        const { decompressBounded } = await import('./compression/bounded.js')
        const format =
          storage.kind === 'deflate' ? 'deflate-raw' : storage.kind === 'zlib' ? 'deflate' : 'gzip'
        bytes = await decompressBounded(
          await readRange(storage.offset, storage.compressedLength, signal, storage.source),
          format,
          {
            maxOutputBytes: size,
            ...(signal === undefined ? {} : { signal }),
          },
        )
        break
      }
      case 'zstd': {
        const { decodeZstd } = await import('./compression/zstd.js')
        bytes = decodeZstd(
          await readRange(storage.offset, storage.compressedLength, signal, storage.source),
          {
            expectedLength: size,
            maxOutputBytes: size,
          },
        )
        break
      }
      case 'lz4-block': {
        const { decodeLz4Block } = await import('./compression/lz4.js')
        bytes = decodeLz4Block(
          await readRange(storage.offset, storage.compressedLength, signal, storage.source),
          size,
        )
        break
      }
      case 'refpack': {
        const { decodeRefPack } = await import('./compression/refpack.js')
        bytes = decodeRefPack(
          await readRange(storage.offset, storage.compressedLength, signal, storage.source),
          size,
        )
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
            if (total > size)
              throw new RangeError(`container entry ${entry.path} decodes past its size`)
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
      throw new RangeError(
        `container entry ${entry.path} decoded to ${bytes.byteLength} bytes, not ${size}`,
      )
    }
    return bytes
  }

  const extract = async (input: unknown, operation: { readonly signal?: AbortSignal }) => {
    const entryId =
      input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as { readonly entryId?: unknown }).entryId
        : undefined
    const entry = typeof entryId === 'string' ? await entryAt(entryId, operation.signal) : undefined
    if (entry === undefined) throw new TypeError('container.extract requires a known {entryId}')
    return { kind: 'bytes' as const, value: await extractEntry(entry, operation.signal) }
  }

  const decodedTotal = entries.reduce((total, entry) => total + entry.size, 0n)
  return Object.freeze({ namespace, extract, extractEntry, decodedTotal })
}
