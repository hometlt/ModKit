import { createHash } from 'node:crypto'
import { open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGunzip, gunzipSync } from 'node:zlib'

import { ModkitError, throwIfAborted } from '@modkit/core'

import { budgetRandomAccessSource, VfsReadBudget } from '../../read-budget.js'
import { createMemorySource, type RandomAccessSource } from '../../source.js'
import {
  assertVfsPathBudget,
  clampVfsLimits,
  normalizeVfsPath,
  type VfsLimits,
  type VfsMount,
  type VfsNode,
  type VfsProvider,
  type VfsProviderContext,
} from '../../vfs.js'
import { parseRapidManifest, rapidError, type RapidRecord } from './manifest.js'

export interface RapidVfsProviderOptions {
  readonly id?: string
  readonly limits?: Partial<VfsLimits>
  /** Override only for installations whose pool is not the sibling of `data/packages`. */
  readonly poolRoot?: string
}

const RAPID_SCHEME = 'rapid+file'

function fileUriOf(uri: string): string {
  if (!uri.toLowerCase().startsWith(`${RAPID_SCHEME}:`)) {
    throw rapidError('uri-invalid', `rapid provider cannot open «${uri}»`, { uri })
  }
  return `file:${uri.slice(`${RAPID_SCHEME}:`.length)}`
}

/** Read and inflate chunk: 1 MiB keeps a 73 MB blob at native zlib speed (64 KiB was 13× slower). */
const POOL_CHUNK_BYTES = 1024 * 1024

/**
 * Stream one pool blob from disk through asynchronous zlib into a buffer of exactly the manifest
 * size, hashing as it goes. Only one chunk of the compressed blob is held at a time, and a large
 * blob (BAR has 73 MB ones) no longer blocks the event loop in one synchronous inflate. Output
 * past the manifest size stops the decoder at once. Node's DecompressionStream was measured at
 * 40 s for BAR's largest blob against 3 s here, so this Node-only provider uses zlib directly.
 */
async function readPoolBlob(
  poolPath: string,
  record: RapidRecord,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let handle: FileHandle
  try {
    handle = await open(poolPath, 'r')
  } catch (cause) {
    throw rapidError('pool-blob-unavailable', 'rapid pool blob is unavailable', {
      path: record.path,
      md5: record.md5,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  }
  const output = new Uint8Array(record.size)
  const md5 = createHash('md5')
  let written = 0
  const compressed = handle.createReadStream({ autoClose: false, highWaterMark: POOL_CHUNK_BYTES })
  const inflated = createGunzip({ chunkSize: POOL_CHUNK_BYTES })
  compressed.on('error', error => inflated.destroy(error))
  try {
    for await (const chunk of compressed.pipe(inflated) as AsyncIterable<Buffer>) {
      throwIfAborted(signal)
      if (chunk.byteLength > record.size - written) {
        throw rapidError('pool-integrity-mismatch', 'rapid pool blob exceeds its manifest size', {
          path: record.path,
          expectedBytes: record.size,
          actualBytes: `more than ${String(record.size)}`,
        })
      }
      output.set(chunk, written)
      md5.update(chunk)
      written += chunk.byteLength
    }
  } catch (cause) {
    if (cause instanceof ModkitError || signal?.aborted === true) throw cause
    throw rapidError('pool-blob-invalid', 'rapid pool blob is not a bounded valid gzip stream', {
      path: record.path,
      md5: record.md5,
      cause: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    compressed.destroy()
    inflated.destroy()
    await handle.close()
  }
  const actualMd5 = md5.digest('hex')
  if (written !== record.size || actualMd5 !== record.md5) {
    throw rapidError(
      'pool-integrity-mismatch',
      'rapid pool blob does not match its manifest record',
      {
        path: record.path,
        expectedBytes: record.size,
        actualBytes: written,
        expectedMd5: record.md5,
        actualMd5,
      },
    )
  }
  return output
}

function nameOf(path: string): string {
  return path.split('/').at(-1) ?? path
}

class RapidMount implements VfsMount {
  readonly id: string
  readonly revision: string
  private disposed = false
  private materializedBytes = 0n
  private readonly readBudget: VfsReadBudget
  private readonly records: ReadonlyMap<string, RapidRecord>
  private readonly directories: ReadonlyMap<string, string>
  private readonly sources = new Set<RandomAccessSource>()

  constructor(
    readonly rootUri: string,
    private readonly poolRoot: string,
    records: readonly RapidRecord[],
    manifestMd5: string,
    private readonly limits: VfsLimits,
  ) {
    this.id = rootUri
    this.revision = `content-hash.md5:${manifestMd5}`
    this.readBudget = new VfsReadBudget(limits.maxReadBytes)
    this.records = new Map(records.map(record => [record.foldedPath, record]))
    const directories = new Map<string, string>([['', '']])
    for (const record of records) {
      const parts = record.path.split('/')
      for (let count = 1; count < parts.length; count += 1) {
        const path = parts.slice(0, count).join('/')
        const folded = path.toLowerCase()
        if (!directories.has(folded)) directories.set(folded, path)
      }
    }
    this.directories = directories
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    throwIfAborted(signal)
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    assertVfsPathBudget(normalized, this.limits)
    const record = this.records.get(normalized.toLowerCase())
    if (record !== undefined) return this.fileNode(record)
    const directory = this.directories.get(normalized.toLowerCase())
    if (directory === undefined) return undefined
    return Object.freeze({
      path: directory,
      name: directory === '' ? '' : nameOf(directory),
      kind: 'directory' as const,
      revision: this.revision,
    })
  }

  async *list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    throwIfAborted(signal)
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    assertVfsPathBudget(normalized, this.limits)
    const directory = this.directories.get(normalized.toLowerCase())
    if (directory === undefined) {
      if (this.records.has(normalized.toLowerCase())) {
        throw rapidError('not-a-directory', `rapid path «${path}» is not a directory`, { path })
      }
      throw rapidError('path-unavailable', `rapid directory «${path}» does not exist`, { path })
    }
    const prefix = directory === '' ? '' : `${directory}/`
    const children = new Map<string, VfsNode>()
    for (const record of this.records.values()) {
      throwIfAborted(signal)
      if (!record.path.toLowerCase().startsWith(prefix.toLowerCase())) continue
      const remainder = record.path.slice(prefix.length)
      const slash = remainder.indexOf('/')
      const childPath = `${prefix}${slash === -1 ? remainder : remainder.slice(0, slash)}`
      const key = childPath.toLowerCase()
      if (children.has(key)) continue
      children.set(
        key,
        slash === -1
          ? this.fileNode(record)
          : Object.freeze({
              path: childPath,
              name: nameOf(childPath),
              kind: 'directory' as const,
              revision: this.revision,
            }),
      )
      if (children.size > this.limits.maxEntries) {
        throw rapidError('list-budget-exceeded', 'rapid directory exceeds its listing boundary', {
          path: directory,
          maxEntries: this.limits.maxEntries,
        })
      }
    }
    for (const node of [...children.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      yield node
    }
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    throwIfAborted(signal)
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    assertVfsPathBudget(normalized, this.limits)
    const record = this.records.get(normalized.toLowerCase())
    if (record === undefined) {
      throw rapidError('not-a-file', `rapid path «${path}» is not a file`, { path })
    }
    const retained = BigInt(record.size)
    const releaseMaterialized = this.reserveMaterialized(retained, record.path)
    let inner: RandomAccessSource | undefined
    try {
      const poolPath = this.poolPathOf(record.md5)
      const bytes = await readPoolBlob(poolPath, record, signal)
      throwIfAborted(signal)
      const id = `${this.rootUri}#${encodeURIComponent(record.path)}`
      const innerSource = budgetRandomAccessSource(
        createMemorySource(id, bytes),
        record.size,
        this.limits,
        this.readBudget,
      )
      inner = innerSource
      let disposed = false
      const tracked: RandomAccessSource = {
        id: innerSource.id,
        size: innerSource.size.bind(innerSource),
        readAt: innerSource.readAt.bind(innerSource),
        stream: innerSource.stream.bind(innerSource),
        dispose: async () => {
          if (disposed) return
          disposed = true
          this.sources.delete(tracked)
          releaseMaterialized()
          await innerSource.dispose()
        },
      }
      this.sources.add(tracked)
      return tracked
    } catch (error) {
      releaseMaterialized()
      if (inner !== undefined) {
        try {
          await inner.dispose()
        } catch {
          // Preserve the materialization failure that triggered this rollback.
        }
      }
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.sources].map(async source => source.dispose()))
    this.sources.clear()
  }

  private fileNode(record: RapidRecord): VfsNode {
    return Object.freeze({
      path: record.path,
      name: nameOf(record.path),
      kind: 'file' as const,
      size: BigInt(record.size),
      revision: `content-hash.md5:${record.md5}`,
    })
  }

  private reserveMaterialized(retained: bigint, path: string): () => void {
    if (retained > this.limits.maxMaterializedBytes - this.materializedBytes) {
      throw rapidError(
        'materialized-budget-exceeded',
        'rapid mount exhausted its materialized-byte boundary',
        {
          path,
          requestedBytes: String(retained),
          retainedBytes: String(this.materializedBytes),
          maxMaterializedBytes: String(this.limits.maxMaterializedBytes),
        },
      )
    }
    this.materializedBytes += retained
    let released = false
    return () => {
      if (released) return
      released = true
      if (this.materializedBytes < retained) {
        throw rapidError(
          'materialized-budget-accounting-invalid',
          'rapid mount materialized-byte reservation underflowed',
          {
            path,
            releasedBytes: String(retained),
            retainedBytes: String(this.materializedBytes),
          },
        )
      }
      this.materializedBytes -= retained
    }
  }

  /**
   * The distinct blobs the manifest names that have no pool file, in md5 order. Only `stat`: the
   * integrity of a present blob stays with `readPoolBlob` when it is opened. Stops after
   * `maxBlobs` missing ones with `complete: false`.
   */
  async missingBlobs(
    maxBlobs: number,
    signal?: AbortSignal,
  ): Promise<{ readonly missing: readonly string[]; readonly complete: boolean }> {
    this.assertLive()
    const hashes = [...new Set([...this.records.values()].map(record => record.md5))].sort()
    const missing: string[] = []
    for (const md5 of hashes) {
      throwIfAborted(signal)
      const present = await stat(this.poolPathOf(md5)).then(
        info => info.isFile(),
        () => false,
      )
      if (present) continue
      if (missing.length === maxBlobs)
        return Object.freeze({ missing: Object.freeze(missing), complete: false })
      missing.push(md5)
    }
    return Object.freeze({ missing: Object.freeze(missing), complete: true })
  }

  private poolPathOf(md5: string): string {
    return resolve(this.poolRoot, md5.slice(0, 2), `${md5.slice(2)}.gz`)
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw rapidError('mount-disposed', `rapid VFS mount «${this.rootUri}» is disposed`)
  }
}

export class RapidVfsProvider implements VfsProvider {
  readonly id: string
  readonly scheme = RAPID_SCHEME
  private readonly limits: VfsLimits
  private readonly poolRoot: string | undefined

  constructor(options: RapidVfsProviderOptions = {}) {
    this.id = options.id ?? 'modkit-x3.vfs.rapid'
    this.limits = clampVfsLimits(options.limits)
    this.poolRoot = options.poolRoot
  }

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    throwIfAborted(context.signal)
    const limits = clampVfsLimits(context.limits, this.limits)
    let manifestPath: string
    try {
      manifestPath = await realpath(fileURLToPath(fileUriOf(uri)))
    } catch (cause) {
      throw rapidError('manifest-unavailable', `rapid provider cannot open manifest «${uri}»`, {
        uri,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
    const manifestInfo = await stat(manifestPath)
    if (!manifestInfo.isFile()) {
      throw rapidError('manifest-type-refused', 'rapid manifest is not a regular file', { uri })
    }
    if (BigInt(manifestInfo.size) > limits.maxMaterializedBytes) {
      throw rapidError(
        'manifest-budget-exceeded',
        'compressed rapid manifest exceeds its materialized boundary',
        {
          manifestBytes: manifestInfo.size,
          maxMaterializedBytes: String(limits.maxMaterializedBytes),
        },
      )
    }
    const compressed = await readFile(
      manifestPath,
      context.signal === undefined ? undefined : { signal: context.signal },
    )
    throwIfAborted(context.signal)
    let manifest: Uint8Array
    try {
      manifest = gunzipSync(compressed, { maxOutputLength: Number(limits.maxMaterializedBytes) })
    } catch (cause) {
      throw rapidError('manifest-invalid', 'rapid manifest is not a bounded valid gzip stream', {
        uri,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
    throwIfAborted(context.signal)
    const records = parseRapidManifest(manifest, limits)
    const manifestMd5 = createHash('md5').update(manifest).digest('hex')
    const poolRoot = await realpath(this.poolRoot ?? resolve(dirname(manifestPath), '..', 'pool'))
    return new RapidMount(
      `${RAPID_SCHEME}:${pathToFileURL(manifestPath).href.slice('file:'.length)}`,
      poolRoot,
      records,
      manifestMd5,
      limits,
    )
  }
}

/**
 * Which pool blobs of a mounted rapid package are absent — a partly downloaded installation. The
 * mount must come from the rapid provider; at most `maxBlobs` (default 4096) are listed, and
 * `complete` says whether that is all of them.
 */
export async function rapidMissingBlobs(
  mount: VfsMount,
  options: { readonly maxBlobs?: number; readonly signal?: AbortSignal } = {},
): Promise<{ readonly missing: readonly string[]; readonly complete: boolean }> {
  if (!(mount instanceof RapidMount))
    throw rapidError('not-a-rapid-mount', 'the mount is not a rapid package mount', {
      mountId: mount.id,
    })
  const maxBlobs = options.maxBlobs ?? 4096
  if (!Number.isSafeInteger(maxBlobs) || maxBlobs < 1)
    throw rapidError('missing-blob-limit-invalid', 'maxBlobs must be a positive safe integer', {
      maxBlobs,
    })
  return mount.missingBlobs(maxBlobs, options.signal)
}

export function createRapidVfsProvider(options: RapidVfsProviderOptions = {}): RapidVfsProvider {
  return new RapidVfsProvider(options)
}
