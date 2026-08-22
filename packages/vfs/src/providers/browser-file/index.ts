import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

import { budgetRandomAccessSource, VfsReadBudget } from '../../read-budget.js'
import { rangeError, type RandomAccessSource } from '../../source.js'
import {
  clampVfsLimits,
  normalizeVfsPath,
  type VfsLimits,
  type VfsMount,
  type VfsNode,
  type VfsProvider,
  type VfsProviderContext,
} from '../../vfs.js'

export interface BrowserBlobSlice {
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface BrowserFileSnapshot {
  readonly name?: string
  readonly size: number
  readonly lastModified?: number
  slice(start: number, end: number): BrowserBlobSlice
}

export interface BrowserFileHandle {
  readonly name?: string
  getFile(): Promise<BrowserFileSnapshot>
}

export interface BrowserDirectoryHandle {
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>
  getFileHandle(name: string): Promise<BrowserFileHandle>
}

export type BrowserFileInput = BrowserFileHandle | BrowserFileSnapshot

function isHandle(input: BrowserFileInput): input is BrowserFileHandle {
  return 'getFile' in input
}

async function snapshot(input: BrowserFileInput): Promise<BrowserFileSnapshot> {
  return isHandle(input) ? input.getFile() : input
}

function sourceStream(
  source: RandomAccessSource,
  size: number,
  start = 0,
  end = size,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  let position = Math.max(0, start)
  const stop = Math.min(end, size)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      throwIfAborted(signal)
      if (position >= stop) return controller.close()
      const length = Math.min(64 * 1024, stop - position)
      controller.enqueue(await source.readAt(position, length, signal))
      position += length
    },
  })
}

function createSnapshotSource(id: string, file: BrowserFileSnapshot): RandomAccessSource {
  let disposed = false
  const assertLive = () => {
    if (!disposed) return
    throw new ModkitError({
      code: 'x3.vfs/source-disposed',
      message: `source «${id}» disposed`,
    })
  }
  const source: RandomAccessSource = {
    id,
    async size(signal) {
      throwIfAborted(signal)
      assertLive()
      return file.size
    },
    async readAt(offset, length, signal) {
      throwIfAborted(signal)
      assertLive()
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > file.size
      ) {
        throw rangeError(id, offset, length, file.size)
      }
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
      if (bytes.byteLength !== length) {
        throw new ModkitError({
          code: 'x3.vfs/browser-file-short-read',
          message: `browser file «${id}» returned ${bytes.byteLength} bytes for a ${length}-byte range`,
          context: { offset, length, actual: bytes.byteLength },
        })
      }
      return bytes
    },
    stream(start, end, signal) {
      assertLive()
      return sourceStream(source, file.size, start, end, signal)
    },
    dispose() {
      disposed = true
    },
  }
  return source
}

/** Adapts a capability passed by the user; it never invokes a picker or ambient filesystem API. */
export async function createBrowserFileHandleSource(
  id: string,
  handle: BrowserFileHandle,
): Promise<RandomAccessSource> {
  return createSnapshotSource(id, await handle.getFile())
}

export async function openOpfsSource(
  root: BrowserDirectoryHandle,
  path: readonly string[],
  id = `opfs:/${path.join('/')}`,
): Promise<RandomAccessSource> {
  if (
    path.length === 0 ||
    path.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new ModkitError({
      code: 'x3.vfs/invalid-opfs-path',
      message: 'OPFS path must contain safe non-empty segments',
      context: { path: [...path] },
    })
  }
  let directory = root
  for (const segment of path.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  const name = path.at(-1)
  if (name === undefined) throw new TypeError('OPFS path unexpectedly empty')
  return createBrowserFileHandleSource(id, await directory.getFileHandle(name))
}

export interface BrowserFileVfsProviderOptions {
  readonly id?: string
  readonly resolve?: (
    uri: string,
  ) => BrowserFileInput | undefined | Promise<BrowserFileInput | undefined>
  readonly limits?: Partial<VfsLimits>
}

class BrowserFileMount implements VfsMount {
  readonly id: string
  readonly revision: string
  private readonly budget: VfsReadBudget
  private readonly sources = new Set<RandomAccessSource>()
  private disposed = false

  constructor(
    readonly rootUri: string,
    private readonly input: BrowserFileInput,
    private readonly file: BrowserFileSnapshot,
    private readonly limits: VfsLimits,
  ) {
    this.id = rootUri
    this.revision = `provider-token:browser-file-${file.lastModified ?? 'unknown'}-${file.size}`
    this.budget = new VfsReadBudget(limits.maxReadBytes)
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    throwIfAborted(signal)
    this.assertLive()
    if (normalizeVfsPath(path) !== '') return undefined
    return Object.freeze({
      path: '',
      name: this.file.name ?? (isHandle(this.input) ? this.input.name : undefined) ?? 'file',
      kind: 'file',
      size: BigInt(this.file.size),
      revision: this.revision,
    })
  }

  async *list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    throwIfAborted(signal)
    this.assertLive()
    throw new ModkitError({
      code: 'x3.vfs/not-a-directory',
      message: `browser-file VFS root «${this.rootUri}» is one file, not a directory`,
      context: { path: normalizeVfsPath(path) },
    })
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    throwIfAborted(signal)
    this.assertLive()
    if (normalizeVfsPath(path) !== '') {
      throw new ModkitError({
        code: 'x3.vfs/file-not-found',
        message: `browser-file VFS root «${this.rootUri}» has no child path «${path}»`,
        context: { path },
      })
    }
    const current = await snapshot(this.input)
    if (current.size !== this.file.size || current.lastModified !== this.file.lastModified) {
      throw new ModkitError({
        code: 'x3.vfs/browser-file-revision-changed',
        message: `browser file «${this.rootUri}» changed after its mount was opened`,
        context: { revision: this.revision },
      })
    }
    const raw = createSnapshotSource(this.rootUri, current)
    const source = budgetRandomAccessSource(raw, current.size, this.limits, this.budget)
    this.sources.add(source)
    return source
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.sources].map(async source => source.dispose()))
    this.sources.clear()
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw new ModkitError({
      code: 'x3.vfs/mount-disposed',
      message: `browser-file VFS mount «${this.rootUri}» is disposed`,
    })
  }
}

export class BrowserFileVfsProvider implements VfsProvider {
  readonly id: string
  readonly scheme = 'browser-file'
  private readonly registered = new Map<string, BrowserFileInput>()
  private readonly limits: VfsLimits

  constructor(private readonly options: BrowserFileVfsProviderOptions = {}) {
    this.id = options.id ?? 'org.modkitx-x3.vfs.browser-file'
    this.limits = clampVfsLimits(options.limits)
  }

  register(uri: string, input: BrowserFileInput): () => void {
    if (!uri.startsWith('browser-file:')) {
      throw new ModkitError({
        code: 'x3.vfs/provider-scheme-mismatch',
        message: `browser-file provider cannot register URI «${uri}»`,
        context: { uri },
      })
    }
    this.registered.set(uri, input)
    return () => {
      if (this.registered.get(uri) === input) this.registered.delete(uri)
    }
  }

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    throwIfAborted(context.signal)
    if (!uri.startsWith('browser-file:')) {
      throw new ModkitError({
        code: 'x3.vfs/provider-scheme-mismatch',
        message: `browser-file provider cannot open URI «${uri}»`,
        context: { uri },
      })
    }
    const input = this.registered.get(uri) ?? (await this.options.resolve?.(uri))
    if (input === undefined) {
      throw new ModkitError({
        code: 'x3.vfs/browser-file-unregistered',
        message: `browser-file source «${uri}» is not registered`,
        context: { uri },
      })
    }
    const limits = clampVfsLimits(context.limits, this.limits)
    const file = await snapshot(input)
    if (BigInt(file.size) > limits.maxFileBytes) {
      throw new ModkitError({
        code: 'x3.vfs/file-size-limit-exceeded',
        message: 'browser-file provider encountered a file above its logical size limit',
        context: { fileBytes: String(file.size), maxFileBytes: String(limits.maxFileBytes) },
      })
    }
    return new BrowserFileMount(uri, input, file, limits)
  }
}

export function createBrowserFileVfsProvider(
  options: BrowserFileVfsProviderOptions = {},
): BrowserFileVfsProvider {
  return new BrowserFileVfsProvider(options)
}
