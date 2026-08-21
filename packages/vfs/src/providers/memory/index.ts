import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

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

export interface MemoryVfsProviderOptions {
  readonly id?: string
  readonly authority?: string
  readonly revision?: string
  readonly entries?: Readonly<Record<string, Uint8Array>>
  readonly limits?: Partial<VfsLimits>
}

interface StoredEntry {
  readonly path: string
  readonly bytes: Uint8Array
}

function relativeToRoot(root: string, path: string): string | undefined {
  if (root === '') return path
  if (path === root) return ''
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
}

function nameOf(path: string): string {
  const parts = path.split('/')
  return parts.at(-1) ?? path
}

function entryNode(path: string, kind: 'file' | 'directory', entry?: StoredEntry): VfsNode {
  return Object.freeze({
    path,
    name: nameOf(path),
    kind,
    ...(entry === undefined ? {} : { size: BigInt(entry.bytes.byteLength) }),
  })
}

class MemoryMount implements VfsMount {
  readonly id: string
  readonly revision: string
  private disposed = false

  constructor(
    readonly rootUri: string,
    private readonly root: string,
    private readonly entries: ReadonlyMap<string, StoredEntry>,
    private readonly limits: VfsLimits,
    revision: string,
  ) {
    this.id = rootUri
    this.revision = revision
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    throwIfAborted(signal)
    this.assertLive()
    const relative = normalizeVfsPath(path)
    assertVfsPathBudget(relative, this.limits)
    const absolute = this.absolute(relative)
    const file = this.entries.get(absolute)
    if (file !== undefined) return entryNode(relative, 'file', file)
    const prefix = absolute === '' ? '' : `${absolute}/`
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) return entryNode(relative, 'directory')
    }
    return undefined
  }

  async *list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    throwIfAborted(signal)
    this.assertLive()
    const relative = normalizeVfsPath(path)
    assertVfsPathBudget(relative, this.limits)
    const absolute = this.absolute(relative)
    if (this.entries.has(absolute)) {
      throw new ModkitError({
        code: 'x3.vfs/not-a-directory',
        message: `memory VFS path «${relative}» is not a directory`,
        context: { path: relative },
      })
    }
    const prefix = absolute === '' ? '' : `${absolute}/`
    const children = new Map<string, StoredEntry | undefined>()
    for (const entry of this.entries.values()) {
      throwIfAborted(signal)
      if (!entry.path.startsWith(prefix)) continue
      const remainder = entry.path.slice(prefix.length)
      const slash = remainder.indexOf('/')
      const childName = slash === -1 ? remainder : remainder.slice(0, slash)
      if (childName === '') continue
      const childPath = relative === '' ? childName : `${relative}/${childName}`
      const exact = slash === -1 ? entry : undefined
      if (!children.has(childPath) || exact !== undefined) children.set(childPath, exact)
    }
    if (children.size > this.limits.maxEntries) {
      throw new ModkitError({
        code: 'x3.vfs/memory-entry-budget-exceeded',
        message: 'memory provider exceeded its configured entry boundary',
        context: { entries: children.size, maxEntries: this.limits.maxEntries },
      })
    }
    for (const [childPath, entry] of [...children.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      throwIfAborted(signal)
      yield entryNode(childPath, entry === undefined ? 'directory' : 'file', entry)
    }
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    throwIfAborted(signal)
    this.assertLive()
    const relative = normalizeVfsPath(path)
    assertVfsPathBudget(relative, this.limits)
    const entry = this.entries.get(this.absolute(relative))
    if (entry === undefined) {
      throw new ModkitError({
        code: 'x3.vfs/file-not-found',
        message: `memory VFS file «${relative}» does not exist`,
        context: { path: relative, rootUri: this.rootUri },
      })
    }
    return createMemorySource(`${this.rootUri}#${encodeURIComponent(relative)}`, entry.bytes)
  }

  dispose(): void {
    this.disposed = true
  }

  private absolute(path: string): string {
    if (this.root === '') return path
    return path === '' ? this.root : `${this.root}/${path}`
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw new ModkitError({
      code: 'x3.vfs/mount-disposed',
      message: `memory VFS mount «${this.rootUri}» is disposed`,
    })
  }
}

export class MemoryVfsProvider implements VfsProvider {
  readonly id: string
  readonly scheme = 'memory'
  private readonly authority: string | undefined
  private readonly revision: string
  private readonly entries: ReadonlyMap<string, StoredEntry>
  private readonly limits: VfsLimits

  constructor(options: MemoryVfsProviderOptions = {}) {
    this.id = options.id ?? 'org.modkitx-x3.vfs.memory'
    this.authority = options.authority
    this.limits = clampVfsLimits(options.limits)
    const entries = new Map<string, StoredEntry>()
    let totalBytes = 0n
    for (const [path, bytes] of Object.entries(options.entries ?? {})) {
      const normalized = normalizeVfsPath(path)
      assertVfsPathBudget(normalized, this.limits)
      if (normalized === '') {
        throw new ModkitError({
          code: 'x3.vfs/path-invalid',
          message: 'memory provider entries require non-empty paths',
          context: { path },
        })
      }
      const copy = bytes.slice()
      totalBytes += BigInt(copy.byteLength)
      entries.set(normalized, { path: normalized, bytes: copy })
    }
    if (entries.size > this.limits.maxEntries) {
      throw new ModkitError({
        code: 'x3.vfs/memory-entry-budget-exceeded',
        message: 'memory provider exceeded its configured entry boundary',
        context: { entries: entries.size, maxEntries: this.limits.maxEntries },
      })
    }
    if (totalBytes > this.limits.maxBytes) {
      throw new ModkitError({
        code: 'x3.vfs/memory-byte-budget-exceeded',
        message: 'memory provider exceeded its configured byte boundary',
        context: { bytes: String(totalBytes), maxBytes: String(this.limits.maxBytes) },
      })
    }
    this.entries = entries
    this.revision =
      options.revision ?? `provider-token:memory-${this.id}-${entries.size}-${totalBytes}`
  }

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    throwIfAborted(context.signal)
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch (cause) {
      throw new ModkitError({
        code: 'x3.vfs/uri-invalid',
        message: `memory provider cannot parse source URI «${uri}»`,
        context: { uri },
        cause,
      })
    }
    if (parsed.protocol !== 'memory:') {
      throw new ModkitError({
        code: 'x3.vfs/provider-scheme-mismatch',
        message: `memory provider cannot open protocol «${parsed.protocol}»`,
        context: { uri, protocol: parsed.protocol },
      })
    }
    if (this.authority !== undefined && parsed.host !== this.authority) {
      throw new ModkitError({
        code: 'x3.vfs/memory-authority-refused',
        message: `memory provider «${this.id}» refuses authority «${parsed.host}»`,
        context: { expected: this.authority, actual: parsed.host },
      })
    }
    const root = normalizeVfsPath(decodeURIComponent(parsed.pathname))
    const limits = clampVfsLimits(context.limits, this.limits)
    assertVfsPathBudget(root, limits)
    let entries = 0
    let bytes = 0n
    for (const entry of this.entries.values()) {
      if (relativeToRoot(root, entry.path) === undefined) continue
      entries += 1
      bytes += BigInt(entry.bytes.byteLength)
    }
    if (entries === 0) {
      throw new ModkitError({
        code: 'x3.vfs/memory-root-not-found',
        message: `memory provider root «${root}» has no entries`,
        context: { root, uri },
      })
    }
    if (entries > limits.maxEntries) {
      throw new ModkitError({
        code: 'x3.vfs/memory-entry-budget-exceeded',
        message: 'memory provider exceeded its configured entry boundary',
        context: { entries, maxEntries: limits.maxEntries },
      })
    }
    if (bytes > limits.maxBytes) {
      throw new ModkitError({
        code: 'x3.vfs/memory-byte-budget-exceeded',
        message: 'memory provider exceeded its configured byte boundary',
        context: { bytes: String(bytes), maxBytes: String(limits.maxBytes) },
      })
    }
    return new MemoryMount(uri, root, this.entries, limits, this.revision)
  }
}

export function createMemoryVfsProvider(options: MemoryVfsProviderOptions = {}): MemoryVfsProvider {
  return new MemoryVfsProvider(options)
}
