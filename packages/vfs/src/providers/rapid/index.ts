import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

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

export interface RapidVfsProviderOptions {
  readonly id?: string
  readonly limits?: Partial<VfsLimits>
  /** Override only for installations whose pool is not the sibling of `data/packages`. */
  readonly poolRoot?: string
}

interface RapidRecord {
  readonly path: string
  readonly foldedPath: string
  readonly md5: string
  readonly crc32: string
  readonly size: number
}

const RAPID_SCHEME = 'rapid+file'
const RAPID_RECORD_FIXED_BYTES = 24
const ASCII = new TextDecoder('ascii', { fatal: true })

function rapidError(code: string, message: string, context?: Readonly<Record<string, unknown>>) {
  return new ModkitError({ code: `x3.vfs/rapid-${code}`, message, ...(context ? { context } : {}) })
}

function fileUriOf(uri: string): string {
  if (!uri.toLowerCase().startsWith(`${RAPID_SCHEME}:`)) {
    throw rapidError('uri-invalid', `rapid provider cannot open «${uri}»`, { uri })
  }
  return `file:${uri.slice(`${RAPID_SCHEME}:`.length)}`
}

function hex(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

function parseManifest(bytes: Uint8Array, limits: VfsLimits): readonly RapidRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records: RapidRecord[] = []
  const seen = new Set<string>()
  let cursor = 0
  while (cursor < bytes.byteLength) {
    if (records.length >= limits.maxEntries) {
      throw rapidError('entry-budget-exceeded', 'rapid manifest exceeds its entry boundary', {
        maxEntries: limits.maxEntries,
      })
    }
    const nameLength = bytes[cursor]
    cursor += 1
    if (nameLength === undefined || nameLength === 0) {
      throw rapidError('manifest-invalid', 'rapid manifest contains an empty path record', {
        cursor,
      })
    }
    if (cursor + nameLength + RAPID_RECORD_FIXED_BYTES > bytes.byteLength) {
      throw rapidError('manifest-truncated', 'rapid manifest record is truncated', { cursor })
    }
    const rawPath = ASCII.decode(bytes.subarray(cursor, cursor + nameLength))
    cursor += nameLength
    const path = normalizeVfsPath(rawPath)
    assertVfsPathBudget(path, limits)
    if (path !== rawPath.replaceAll('\\', '/') || path === '') {
      throw rapidError('path-invalid', 'rapid manifest path is not confined and canonical', {
        path: rawPath,
      })
    }
    const foldedPath = path.toLowerCase()
    if (seen.has(foldedPath)) {
      throw rapidError(
        'path-collision',
        'rapid manifest contains a case-insensitive path collision',
        {
          path,
        },
      )
    }
    seen.add(foldedPath)
    const md5 = hex(bytes.subarray(cursor, cursor + 16))
    cursor += 16
    const crc32 = view.getUint32(cursor, false).toString(16).padStart(8, '0')
    cursor += 4
    const size = view.getUint32(cursor, false)
    cursor += 4
    if (BigInt(size) > limits.maxFileBytes) {
      throw rapidError(
        'file-size-limit-exceeded',
        'rapid record exceeds its logical file boundary',
        {
          path,
          fileBytes: size,
          maxFileBytes: String(limits.maxFileBytes),
        },
      )
    }
    records.push(Object.freeze({ path, foldedPath, md5, crc32, size }))
  }
  return Object.freeze(records)
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
    if (retained > this.limits.maxMaterializedBytes - this.materializedBytes) {
      throw rapidError(
        'materialized-budget-exceeded',
        'rapid mount exhausted its materialized-byte boundary',
        {
          path: record.path,
          requestedBytes: record.size,
          retainedBytes: String(this.materializedBytes),
          maxMaterializedBytes: String(this.limits.maxMaterializedBytes),
        },
      )
    }
    const poolPath = resolve(this.poolRoot, record.md5.slice(0, 2), `${record.md5.slice(2)}.gz`)
    let compressed: Uint8Array
    try {
      compressed = await readFile(poolPath, signal === undefined ? undefined : { signal })
    } catch (cause) {
      throw rapidError('pool-blob-unavailable', 'rapid pool blob is unavailable', {
        path: record.path,
        md5: record.md5,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
    throwIfAborted(signal)
    let bytes: Uint8Array
    try {
      bytes = gunzipSync(compressed, { maxOutputLength: record.size + 1 })
    } catch (cause) {
      throw rapidError('pool-blob-invalid', 'rapid pool blob is not a bounded valid gzip stream', {
        path: record.path,
        md5: record.md5,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
    }
    throwIfAborted(signal)
    const actualMd5 = createHash('md5').update(bytes).digest('hex')
    if (bytes.byteLength !== record.size || actualMd5 !== record.md5) {
      throw rapidError(
        'pool-integrity-mismatch',
        'rapid pool blob does not match its manifest record',
        {
          path: record.path,
          expectedBytes: record.size,
          actualBytes: bytes.byteLength,
          expectedMd5: record.md5,
          actualMd5,
        },
      )
    }
    this.materializedBytes += retained
    const id = `${this.rootUri}#${encodeURIComponent(record.path)}`
    const inner = budgetRandomAccessSource(
      createMemorySource(id, bytes),
      record.size,
      this.limits,
      this.readBudget,
    )
    let disposed = false
    const tracked: RandomAccessSource = {
      id: inner.id,
      size: inner.size.bind(inner),
      readAt: inner.readAt.bind(inner),
      stream: inner.stream.bind(inner),
      dispose: async () => {
        if (disposed) return
        disposed = true
        this.materializedBytes -= retained
        this.sources.delete(tracked)
        await inner.dispose()
      },
    }
    this.sources.add(tracked)
    return tracked
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
    this.id = options.id ?? 'org.modkitx-x3.vfs.rapid'
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
    const records = parseManifest(manifest, limits)
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

export function createRapidVfsProvider(options: RapidVfsProviderOptions = {}): RapidVfsProvider {
  return new RapidVfsProvider(options)
}
