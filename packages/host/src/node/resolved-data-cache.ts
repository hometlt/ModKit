/**
 * Kept resolved Data language contexts of a host: the language workspace's
 * `LanguageSemanticContextStore`, in the shared index cache directory (sdk `index-caches`).
 *
 * Each kept chain slot is a folder `resolved-data-<slot digest>` with `cache.json` (game, kind
 * `resolved-data`, the chain's label), so an application lists, sizes and removes it with the other
 * index caches, and one `context-<key digest>.mkrd` file: a JSON header line (format, the exact
 * store key, the input's kind/id/revision, the payload's byte length and SHA-256) followed by the
 * gzip-compressed payload JSON.
 *
 * `load` looks for the key's file in every slot folder and returns the input only when the format
 * and key match, the payload inflates to exactly the recorded length (never above the language
 * payload ceiling, enforced while inflating), its digest matches and it parses as JSON; anything
 * else is a miss, and the host validates a returned input like a fresh analysis. A hit refreshes
 * the file's time, which orders eviction. `save` writes a temporary file and renames it into its
 * slot, replaces the manifest the same way, removes the slot's other contexts, then removes the
 * least recently used resolved Data folders until all of them fit `maxBytes`; a context larger than
 * the whole budget is not kept. Other caches in the directory are never touched, and a failed write
 * is a missed cache, not an error. Node only (fs, zlib, crypto).
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { INDEX_CACHE_MANIFEST, type IndexCacheManifest } from '@modkit/sdk'
import type { JsonValue } from '@modkit/sdk'
import type { LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'
import { LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES } from '../language/context.js'
import type {
  LanguageSemanticContextStore,
  LanguageSemanticContextStoreSaveRequest,
} from '../language/semantic-context.js'

export interface ResolvedDataContextStoreOptions {
  /** The shared index cache directory (VS Code: `<global storage>/index-cache`). */
  readonly directory: string
  /** Bytes all kept resolved Data contexts may take on disk together. */
  readonly maxBytes: number
}

const FORMAT = 'modkit.resolved-data-context.v1'
const FOLDER_PREFIX = 'resolved-data-'
const FILE_PREFIX = 'context-'
const FILE_SUFFIX = '.mkrd'
const MAX_HEADER_BYTES = 16 * 1_024
/** A temporary file this old belongs to a write that never finished. */
const ABANDONED_PARTIAL_MS = 60 * 60 * 1_000

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)
const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32)
const contextFileName = (key: string): string => `${FILE_PREFIX}${digest(key)}${FILE_SUFFIX}`

interface ContextHeader {
  readonly format: typeof FORMAT
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly revision: string
  readonly payloadBytes: number
  readonly payloadSha256: string
}

/** The header of a kept context when it is this format and this exact key, else nothing. */
function headerOf(
  bytes: Uint8Array,
  key: string,
): { header: ContextHeader; body: number } | undefined {
  const newline = bytes.indexOf(0x0a)
  if (newline <= 0 || newline > MAX_HEADER_BYTES) return undefined
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, newline)))
  } catch {
    return undefined
  }
  const header = value as Partial<Record<keyof ContextHeader, unknown>> | null
  return typeof header === 'object' &&
    header !== null &&
    header.format === FORMAT &&
    header.key === key &&
    typeof header.kind === 'string' &&
    typeof header.id === 'string' &&
    typeof header.revision === 'string' &&
    typeof header.payloadSha256 === 'string' &&
    Number.isSafeInteger(header.payloadBytes) &&
    (header.payloadBytes as number) > 0 &&
    (header.payloadBytes as number) <= LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES
    ? { header: header as ContextHeader, body: newline + 1 }
    : undefined
}

/** The kept input of one file, or nothing when any check fails. */
async function decodeContext(
  bytes: Uint8Array,
  key: string,
): Promise<LanguageWorkspaceSemanticInput | undefined> {
  const located = headerOf(bytes, key)
  if (located === undefined) return undefined
  const { header, body } = located
  let payload: Buffer
  try {
    // The recorded length bounds inflation itself: a larger stream fails instead of growing.
    payload = await gunzipAsync(bytes.subarray(body), { maxOutputLength: header.payloadBytes })
  } catch {
    return undefined
  }
  if (
    payload.byteLength !== header.payloadBytes ||
    createHash('sha256').update(payload).digest('hex') !== header.payloadSha256
  ) {
    return undefined
  }
  let parsed: JsonValue
  try {
    parsed = JSON.parse(payload.toString('utf8')) as JsonValue
  } catch {
    return undefined
  }
  return { kind: header.kind, id: header.id, revision: header.revision, payload: parsed }
}

/** Write a file whole or not at all: a temporary sibling renamed over the target. */
async function writeAtomically(target: string, bytes: Uint8Array | string): Promise<void> {
  const partial = `${target}.${randomUUID()}.partial`
  try {
    await writeFile(partial, bytes)
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Folders of kept contexts with their bytes and last use (the newest file time inside). */
async function keptFolders(
  directory: string,
): Promise<{ readonly name: string; readonly bytes: number; readonly used: number }[]> {
  const folders = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(FOLDER_PREFIX)) continue
    let bytes = 0
    let used = 0
    let names: string[]
    try {
      names = await readdir(join(directory, entry.name))
    } catch {
      continue
    }
    for (const name of names) {
      const info = await stat(join(directory, entry.name, name)).catch(() => undefined)
      if (info === undefined) continue
      bytes += info.size
      used = Math.max(used, info.mtimeMs)
    }
    folders.push({ name: entry.name, bytes, used })
  }
  return folders
}

/**
 * A store of complete resolved Data contexts in the shared index cache directory; give it to
 * `createLanguageWorkspace({ semanticContextStore })`.
 */
export function createResolvedDataContextStore(
  options: ResolvedDataContextStoreOptions,
): LanguageSemanticContextStore {
  const { directory } = options
  const maxBytes =
    Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 0

  /** Remove least recently used kept folders, never `keep`, until all of them fit the budget. */
  const evict = async (keep: string): Promise<void> => {
    const folders = await keptFolders(directory)
    let total = folders.reduce((sum, folder) => sum + folder.bytes, 0)
    for (const folder of folders
      .filter(item => item.name !== keep)
      .sort((left, right) => left.used - right.used)) {
      if (total <= maxBytes) break
      await rm(join(directory, folder.name), { recursive: true, force: true }).catch(
        () => undefined,
      )
      total -= folder.bytes
    }
  }

  return Object.freeze({
    async load(request: { readonly key: string; readonly signal?: AbortSignal }) {
      request.signal?.throwIfAborted()
      if (maxBytes === 0) return undefined
      let folders: string[]
      try {
        folders = (await readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.isDirectory() && entry.name.startsWith(FOLDER_PREFIX))
          .map(entry => entry.name)
      } catch {
        return undefined
      }
      const name = contextFileName(request.key)
      for (const folder of folders) {
        const path = join(directory, folder, name)
        let bytes: Buffer
        try {
          bytes = await readFile(
            path,
            request.signal === undefined ? {} : { signal: request.signal },
          )
        } catch (error) {
          // The host turns an aborted read into its cancellation; other failures are misses.
          if (request.signal?.aborted === true) throw error
          continue
        }
        const input = await decodeContext(bytes, request.key)
        request.signal?.throwIfAborted()
        if (input === undefined) return undefined
        const now = new Date()
        await utimes(path, now, now).catch(() => undefined)
        return input
      }
      return undefined
    },

    async save(request: LanguageSemanticContextStoreSaveRequest) {
      if (maxBytes === 0) return
      try {
        request.signal?.throwIfAborted()
        const payload = Buffer.from(JSON.stringify(request.input.payload ?? null), 'utf8')
        if (payload.byteLength > LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES) return
        const compressed = await gzipAsync(payload)
        const header: ContextHeader = {
          format: FORMAT,
          key: request.key,
          kind: request.input.kind,
          id: request.input.id,
          revision: request.input.revision,
          payloadBytes: payload.byteLength,
          payloadSha256: createHash('sha256').update(payload).digest('hex'),
        }
        const head = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')
        if (
          head.byteLength > MAX_HEADER_BYTES ||
          head.byteLength + compressed.byteLength > maxBytes
        ) {
          return
        }
        request.signal?.throwIfAborted()
        const folderName = `${FOLDER_PREFIX}${digest(request.slot)}`
        const folder = join(directory, folderName)
        await mkdir(folder, { recursive: true })
        const name = contextFileName(request.key)
        await writeAtomically(join(folder, name), Buffer.concat([head, compressed]))
        const manifest: IndexCacheManifest = {
          game: request.gameId,
          kind: 'resolved-data',
          installation: request.label,
        }
        await writeAtomically(
          join(folder, INDEX_CACHE_MANIFEST),
          `${JSON.stringify(manifest, null, 2)}\n`,
        )
        // The slot keeps one context: an older analysis of the same chain goes, and so do
        // temporary files that no write will finish.
        const now = Date.now()
        for (const entry of await readdir(folder)) {
          if (entry === name || entry === INDEX_CACHE_MANIFEST) continue
          if (entry.endsWith('.partial')) {
            const info = await stat(join(folder, entry)).catch(() => undefined)
            if (info === undefined || now - info.mtimeMs < ABANDONED_PARTIAL_MS) continue
          }
          await rm(join(folder, entry), { force: true }).catch(() => undefined)
        }
        await evict(folderName)
      } catch {
        // A context that could not be kept is analysed again next time.
      }
    },
  })
}
