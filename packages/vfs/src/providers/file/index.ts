import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

import { assertReadRangeLimit, assertStreamLimit, VfsReadBudget } from '../../read-budget.js'
import { rangeError, type RandomAccessSource } from '../../source.js'
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

export interface FileVfsProviderOptions {
  readonly id?: string
  readonly limits?: Partial<VfsLimits>
}

interface FileSnapshot {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

function snapshotOf(info: Awaited<ReturnType<typeof stat>>): FileSnapshot {
  return {
    dev: BigInt(info.dev),
    ino: BigInt(info.ino),
    size: BigInt(info.size),
    mtimeNs: BigInt(Math.trunc(Number(info.mtimeMs) * 1_000_000)),
  }
}

function sameSnapshot(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

function missing(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')
  )
}

function nameOf(path: string): string {
  const parts = path.split('/')
  return parts.at(-1) ?? path
}

function fileRevision(snapshot: FileSnapshot): string {
  return `provider-token:${snapshot.dev}-${snapshot.ino}-${snapshot.size}-${snapshot.mtimeNs}`
}

function fileSizeLimitError(path: string, size: bigint, maximum: bigint): ModkitError {
  return new ModkitError({
    code: 'x3.vfs/file-size-limit-exceeded',
    message: 'file provider encountered a file above its logical size limit',
    context: { path, fileBytes: String(size), maxFileBytes: String(maximum) },
  })
}

class FileRandomAccessSource implements RandomAccessSource {
  private disposed = false

  constructor(
    readonly id: string,
    private readonly path: string,
    private readonly snapshot: FileSnapshot,
    private readonly limits: VfsLimits,
    private readonly readBudget: VfsReadBudget,
  ) {}

  async size(signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal)
    this.assertLive()
    return Number(this.snapshot.size)
  }

  async readAt(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal)
    this.assertLive()
    const size = Number(this.snapshot.size)
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
      throw rangeError(this.id, offset, length, size)
    }
    if (offset < 0 || length < 0 || offset + length > size) {
      throw rangeError(this.id, offset, length, size)
    }
    assertReadRangeLimit(this.id, length, this.limits)
    const reservation = this.readBudget.reserve(length, this.id)
    try {
      const current = snapshotOf(await stat(this.path))
      if (!sameSnapshot(this.snapshot, current)) {
        throw new ModkitError({
          code: 'x3.vfs/file-revision-changed',
          message: `file provider source «${this.id}» changed after it was opened`,
          context: { sourceId: this.id, revision: fileRevision(this.snapshot) },
        })
      }
      const handle = await open(this.path, 'r')
      try {
        const bytes = new Uint8Array(length)
        let filled = 0
        while (filled < length) {
          throwIfAborted(signal)
          const result = await handle.read(bytes, filled, length - filled, offset + filled)
          reservation.commit(result.bytesRead)
          if (result.bytesRead === 0) break
          filled += result.bytesRead
        }
        throwIfAborted(signal)
        if (filled !== length) {
          throw new ModkitError({
            code: 'x3.vfs/file-short-read',
            message: `file provider returned ${filled} bytes for an exact ${length}-byte read`,
            context: { sourceId: this.id, expected: length, actual: filled },
          })
        }
        return bytes
      } finally {
        await handle.close()
      }
    } finally {
      reservation.release()
    }
  }

  stream(
    start = 0,
    end = Number(this.snapshot.size),
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    this.assertLive()
    const size = Number(this.snapshot.size)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > size
    ) {
      throw rangeError(this.id, start, end - start, size)
    }
    assertStreamLimit(this.id, start, end, this.limits)
    let position = start
    return new ReadableStream<Uint8Array>({
      pull: async controller => {
        throwIfAborted(signal)
        if (position >= end) {
          controller.close()
          return
        }
        const length = Math.min(64 * 1024, end - position)
        const bytes = await this.readAt(position, length, signal)
        position += bytes.byteLength
        controller.enqueue(bytes)
      },
    })
  }

  dispose(): void {
    this.disposed = true
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw new ModkitError({
      code: 'x3.vfs/source-disposed',
      message: `source «${this.id}» disposed`,
    })
  }
}

class FileMount implements VfsMount {
  readonly id: string
  readonly revision: string
  private disposed = false
  private readonly sources = new Set<RandomAccessSource>()
  private readonly readBudget: VfsReadBudget

  constructor(
    readonly rootUri: string,
    private readonly rootPath: string,
    private readonly rootKind: 'file' | 'directory',
    private readonly rootSnapshot: FileSnapshot,
    private readonly limits: VfsLimits,
  ) {
    this.id = rootUri
    this.revision = fileRevision(rootSnapshot)
    this.readBudget = new VfsReadBudget(limits.maxReadBytes)
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    throwIfAborted(signal)
    this.assertLive()
    const resolved = await this.resolvePath(path, false)
    if (resolved === undefined) return undefined
    const info = await stat(resolved)
    const snapshot = snapshotOf(info)
    if (info.isFile() && snapshot.size > this.limits.maxFileBytes)
      throw fileSizeLimitError(path, snapshot.size, this.limits.maxFileBytes)
    const normalized = normalizeVfsPath(path)
    return Object.freeze({
      path: normalized,
      name: normalized === '' ? nameOf(this.rootPath.replaceAll('\\', '/')) : nameOf(normalized),
      kind: info.isDirectory() ? 'directory' : 'file',
      ...(info.isFile() ? { size: snapshot.size } : {}),
      revision: fileRevision(snapshot),
    })
  }

  async *list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    throwIfAborted(signal)
    this.assertLive()
    const directory = await this.resolvePath(path, true)
    const info = await stat(directory)
    if (!info.isDirectory()) {
      throw new ModkitError({
        code: 'x3.vfs/not-a-directory',
        message: `file VFS path «${path}» is not a directory`,
        context: { path },
      })
    }
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.length > this.limits.maxEntries) {
      throw new ModkitError({
        code: 'x3.vfs/file-entry-budget-exceeded',
        message: 'file provider exceeded its configured entry boundary',
        context: { entries: entries.length, maxEntries: this.limits.maxEntries },
      })
    }
    const normalizedParent = normalizeVfsPath(path)
    const nodes: VfsNode[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      throwIfAborted(signal)
      const child = normalizedParent === '' ? entry.name : `${normalizedParent}/${entry.name}`
      const resolved = await this.resolvePath(child, true)
      const childInfo = await stat(resolved)
      const snapshot = snapshotOf(childInfo)
      if (childInfo.isFile() && snapshot.size > this.limits.maxFileBytes)
        throw fileSizeLimitError(child, snapshot.size, this.limits.maxFileBytes)
      nodes.push(
        Object.freeze({
          path: normalizeVfsPath(child),
          name: entry.name,
          kind: childInfo.isDirectory() ? 'directory' : 'file',
          ...(childInfo.isFile() ? { size: snapshot.size } : {}),
          revision: fileRevision(snapshot),
        }),
      )
    }
    for (const node of nodes) yield node
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    throwIfAborted(signal)
    this.assertLive()
    const resolved = await this.resolvePath(path, true)
    const info = await stat(resolved)
    if (!info.isFile()) {
      throw new ModkitError({
        code: 'x3.vfs/not-a-file',
        message: `file VFS path «${path}» is not a regular file`,
        context: { path },
      })
    }
    const snapshot = snapshotOf(info)
    if (snapshot.size > this.limits.maxFileBytes) {
      throw fileSizeLimitError(path, snapshot.size, this.limits.maxFileBytes)
    }
    if (snapshot.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw fileSizeLimitError(path, snapshot.size, BigInt(Number.MAX_SAFE_INTEGER))
    }
    const source = new FileRandomAccessSource(
      pathToFileURL(resolved).href,
      resolved,
      snapshot,
      this.limits,
      this.readBudget,
    )
    this.sources.add(source)
    return source
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.sources].map(async source => source.dispose()))
    this.sources.clear()
  }

  private async resolvePath(path: string, requireExisting: true): Promise<string>
  private async resolvePath(path: string, requireExisting: false): Promise<string | undefined>
  private async resolvePath(path: string, requireExisting: boolean): Promise<string | undefined> {
    const normalized = normalizeVfsPath(path)
    assertVfsPathBudget(normalized, this.limits)
    if (this.rootKind === 'file') {
      if (normalized !== '') this.escapeRefused(path)
      return this.rootPath
    }
    const candidate = resolve(this.rootPath, ...normalized.split('/').filter(Boolean))
    let canonical: string
    try {
      canonical = await realpath(candidate)
    } catch (cause) {
      if (!requireExisting && missing(cause)) return undefined
      throw new ModkitError({
        code: 'x3.vfs/file-path-unavailable',
        message: `file provider cannot resolve «${path}» below its root`,
        context: { path, root: this.rootPath },
        cause,
      })
    }
    const inner = relative(this.rootPath, canonical)
    if (inner.startsWith('..') || isAbsolute(inner)) this.escapeRefused(path)
    return canonical
  }

  private escapeRefused(path: string): never {
    throw new ModkitError({
      code: 'x3.vfs/file-root-escape-refused',
      message: 'file provider refused to escape its confined root boundary',
      context: { path, root: this.rootPath },
    })
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw new ModkitError({
      code: 'x3.vfs/mount-disposed',
      message: `file VFS mount «${this.rootUri}» is disposed`,
    })
  }
}

export class FileVfsProvider implements VfsProvider {
  readonly id: string
  readonly scheme = 'file'
  private readonly limits: VfsLimits

  constructor(options: FileVfsProviderOptions = {}) {
    this.id = options.id ?? 'org.modkitx-x3.vfs.file'
    this.limits = clampVfsLimits(options.limits)
  }

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    throwIfAborted(context.signal)
    let rootPath: string
    try {
      rootPath = await realpath(fileURLToPath(uri))
    } catch (cause) {
      throw new ModkitError({
        code: 'x3.vfs/file-root-unavailable',
        message: `file provider cannot open root «${uri}»`,
        context: { uri },
        cause,
      })
    }
    const info = await stat(rootPath)
    if (!info.isFile() && !info.isDirectory()) {
      throw new ModkitError({
        code: 'x3.vfs/file-root-type-refused',
        message: `file provider root «${uri}» is neither a file nor a directory`,
        context: { uri },
      })
    }
    const limits = clampVfsLimits(context.limits, this.limits)
    const snapshot = snapshotOf(info)
    if (info.isFile() && snapshot.size > limits.maxFileBytes)
      throw fileSizeLimitError('', snapshot.size, limits.maxFileBytes)
    return new FileMount(uri, rootPath, info.isDirectory() ? 'directory' : 'file', snapshot, limits)
  }
}

export function createFileVfsProvider(options: FileVfsProviderOptions = {}): FileVfsProvider {
  return new FileVfsProvider(options)
}
