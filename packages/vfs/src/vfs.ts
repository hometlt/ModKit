import { ModkitError, throwIfAborted } from '@modkit/core'

import type { RandomAccessSource } from './source.js'

export type VfsNodeKind = 'file' | 'directory'

export interface VfsNode {
  readonly path: string
  readonly name: string
  readonly kind: VfsNodeKind
  readonly size?: bigint
  readonly revision?: string
}

export interface VfsLimits {
  readonly maxEntries: number
  /** Bytes an eager provider may retain while constructing a mount. */
  readonly maxMaterializedBytes: bigint
  /** Logical size of one addressable random-access file. */
  readonly maxFileBytes: bigint
  /** Cumulative bytes actually returned by all sources opened from one mount. */
  readonly maxReadBytes: bigint
  /** Bytes requested by one random-access read. */
  readonly maxReadRangeBytes: number
  /** Bytes exposed by one sequential stream window. */
  readonly maxStreamBytes: bigint
  readonly maxPathBytes: number
}

export const DEFAULT_VFS_LIMITS: VfsLimits = Object.freeze({
  // Large installed-game indexes are normal inputs (the pinned BAR rapid package has 18,413
  // records). Providers still count before exposing an entry; this ceiling merely lets a caller
  // grant a bounded installed-game-sized index instead of making that valid input impossible.
  maxEntries: 25_000,
  maxMaterializedBytes: 512n * 1024n * 1024n,
  maxFileBytes: 8n * 1024n * 1024n * 1024n * 1024n,
  maxReadBytes: 512n * 1024n * 1024n,
  maxReadRangeBytes: 16 * 1024 * 1024,
  maxStreamBytes: 512n * 1024n * 1024n,
  maxPathBytes: 4096,
})

export interface VfsProviderContext {
  readonly limits: VfsLimits
  readonly signal?: AbortSignal
}

export interface VfsOpenOptions {
  readonly limits?: Partial<VfsLimits>
  readonly signal?: AbortSignal
}

export interface VfsMount {
  readonly id: string
  readonly rootUri: string
  readonly revision: string
  stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined>
  list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode>
  open(path: string, signal?: AbortSignal): Promise<RandomAccessSource>
  dispose(): void | Promise<void>
}

/** Public SPI: applications may implement and explicitly register any custom protocol. */
export interface VfsProvider {
  readonly id: string
  readonly scheme: string
  open(uri: string, context: VfsProviderContext): Promise<VfsMount>
}

export interface VfsResolution {
  readonly mountPath: string
  readonly mount: VfsMount
  readonly path: string
}

const PATH_ENCODER = new TextEncoder()
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/u

function invalidPath(path: string, reason: string): ModkitError {
  return new ModkitError({
    code: 'x3.vfs/path-invalid',
    message: `VFS path «${path}» is invalid: ${reason}`,
    context: { path, reason },
  })
}

export function normalizeVfsPath(path: string): string {
  if (path.includes('\0')) throw invalidPath(path, 'NUL bytes are forbidden')
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      throw new ModkitError({
        code: 'x3.vfs/path-escape-refused',
        message: `VFS path «${path}» attempts to escape its mounted root`,
        context: { path },
      })
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function parseVfsScheme(uri: string): string {
  const match = SCHEME.exec(uri)
  const scheme = match?.[1]
  if (scheme === undefined) {
    throw new ModkitError({
      code: 'x3.vfs/uri-invalid',
      message: `VFS source URI «${uri}» has no protocol scheme`,
      context: { uri },
    })
  }
  return scheme.toLowerCase()
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ModkitError({
      code: 'x3.vfs/limit-invalid',
      message: `${name} must be a positive safe integer`,
      context: { name, value },
    })
  }
  return value
}

function positiveBigInt(value: bigint, name: string): bigint {
  if (value <= 0n) {
    throw new ModkitError({
      code: 'x3.vfs/limit-invalid',
      message: `${name} must be positive`,
      context: { name, value: String(value) },
    })
  }
  return value
}

function minimumBigInt(requested: bigint, maximum: bigint): bigint {
  return requested < maximum ? requested : maximum
}

export function clampVfsLimits(
  requested: Partial<VfsLimits> = {},
  maximum: VfsLimits = DEFAULT_VFS_LIMITS,
): VfsLimits {
  const requestedEntries = positiveSafeInteger(
    requested.maxEntries ?? maximum.maxEntries,
    'maxEntries',
  )
  const requestedPathBytes = positiveSafeInteger(
    requested.maxPathBytes ?? maximum.maxPathBytes,
    'maxPathBytes',
  )
  const requestedMaterializedBytes = positiveBigInt(
    requested.maxMaterializedBytes ?? maximum.maxMaterializedBytes,
    'maxMaterializedBytes',
  )
  const requestedFileBytes = positiveBigInt(
    requested.maxFileBytes ?? maximum.maxFileBytes,
    'maxFileBytes',
  )
  const requestedReadBytes = positiveBigInt(
    requested.maxReadBytes ?? maximum.maxReadBytes,
    'maxReadBytes',
  )
  const requestedReadRangeBytes = positiveSafeInteger(
    requested.maxReadRangeBytes ?? maximum.maxReadRangeBytes,
    'maxReadRangeBytes',
  )
  const requestedStreamBytes = positiveBigInt(
    requested.maxStreamBytes ?? maximum.maxStreamBytes,
    'maxStreamBytes',
  )
  return Object.freeze({
    maxEntries: Math.min(requestedEntries, maximum.maxEntries),
    maxMaterializedBytes: minimumBigInt(requestedMaterializedBytes, maximum.maxMaterializedBytes),
    maxFileBytes: minimumBigInt(requestedFileBytes, maximum.maxFileBytes),
    maxReadBytes: minimumBigInt(requestedReadBytes, maximum.maxReadBytes),
    maxReadRangeBytes: Math.min(requestedReadRangeBytes, maximum.maxReadRangeBytes),
    maxStreamBytes: minimumBigInt(requestedStreamBytes, maximum.maxStreamBytes),
    maxPathBytes: Math.min(requestedPathBytes, maximum.maxPathBytes),
  })
}

export function assertVfsPathBudget(path: string, limits: VfsLimits): void {
  const bytes = PATH_ENCODER.encode(path).byteLength
  if (bytes > limits.maxPathBytes) {
    throw new ModkitError({
      code: 'x3.vfs/path-budget-exceeded',
      message: `VFS path exceeds the ${limits.maxPathBytes}-byte provider limit`,
      context: { path, pathBytes: bytes, maxPathBytes: limits.maxPathBytes },
    })
  }
}

export class VfsProviderRegistry {
  private readonly providers = new Map<string, VfsProvider>()

  register(provider: VfsProvider): this {
    const scheme = parseVfsScheme(`${provider.scheme}:`)
    if (this.providers.has(scheme)) {
      throw new ModkitError({
        code: 'x3.vfs/provider-already-registered',
        message: `a VFS provider for protocol «${scheme}» is already registered`,
        context: { providerId: provider.id, scheme },
      })
    }
    this.providers.set(scheme, provider)
    return this
  }

  unregister(scheme: string): VfsProvider | undefined {
    const normalized = parseVfsScheme(`${scheme}:`)
    const provider = this.providers.get(normalized)
    this.providers.delete(normalized)
    return provider
  }

  resolve(uri: string): VfsProvider {
    const scheme = parseVfsScheme(uri)
    const provider = this.providers.get(scheme)
    if (provider === undefined) {
      throw new ModkitError({
        code: 'x3.vfs/provider-not-registered',
        message: `no VFS provider is registered for protocol «${scheme}»`,
        context: { scheme, uri },
      })
    }
    return provider
  }

  async open(uri: string, options: VfsOpenOptions = {}): Promise<VfsMount> {
    throwIfAborted(options.signal)
    const limits = clampVfsLimits(options.limits)
    const context: VfsProviderContext =
      options.signal === undefined ? { limits } : { limits, signal: options.signal }
    return this.resolve(uri).open(uri, context)
  }
}

interface MountedSource {
  readonly path: string
  readonly mount: VfsMount
}

function isWithin(mountPath: string, path: string): boolean {
  return mountPath === '' || path === mountPath || path.startsWith(`${mountPath}/`)
}

export class VirtualFileSystem {
  readonly providers: VfsProviderRegistry
  private readonly mounts = new Map<string, MountedSource>()
  private disposed = false

  constructor(providers: VfsProviderRegistry = new VfsProviderRegistry()) {
    this.providers = providers
  }

  registerProvider(provider: VfsProvider): this {
    this.assertLive()
    this.providers.register(provider)
    return this
  }

  async openMount(uri: string, options: VfsOpenOptions = {}): Promise<VfsMount> {
    this.assertLive()
    return this.providers.open(uri, options)
  }

  mount(path: string, mount: VfsMount): this {
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    if (this.mounts.has(normalized)) {
      throw new ModkitError({
        code: 'x3.vfs/mount-already-exists',
        message: `a VFS source is already mounted at «${normalized}»`,
        context: { path: normalized },
      })
    }
    this.mounts.set(normalized, { path: normalized, mount })
    return this
  }

  unmount(path: string): VfsMount | undefined {
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    const mounted = this.mounts.get(normalized)
    this.mounts.delete(normalized)
    return mounted?.mount
  }

  resolve(path: string): VfsResolution {
    this.assertLive()
    const normalized = normalizeVfsPath(path)
    let best: MountedSource | undefined
    for (const mounted of this.mounts.values()) {
      if (!isWithin(mounted.path, normalized)) continue
      if (best === undefined || mounted.path.length > best.path.length) best = mounted
    }
    if (best === undefined) {
      throw new ModkitError({
        code: 'x3.vfs/mount-not-found',
        message: `no VFS source is mounted for path «${normalized}»`,
        context: { path: normalized },
      })
    }
    const innerPath =
      best.path === ''
        ? normalized
        : normalized === best.path
          ? ''
          : normalized.slice(best.path.length + 1)
    return { mountPath: best.path, mount: best.mount, path: innerPath }
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    const resolved = this.resolve(path)
    return resolved.mount.stat(resolved.path, signal)
  }

  list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    const resolved = this.resolve(path)
    return resolved.mount.list(resolved.path, signal)
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    const resolved = this.resolve(path)
    return resolved.mount.open(resolved.path, signal)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const mounts = new Set([...this.mounts.values()].map(value => value.mount))
    this.mounts.clear()
    const results = await Promise.allSettled([...mounts].map(async mount => mount.dispose()))
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      const first = failures[0]
      throw new ModkitError({
        code: 'x3.vfs/dispose-failed',
        message: 'one or more mounted VFS sources failed to dispose',
        context: { failureCount: failures.length },
        cause: first?.reason,
      })
    }
  }

  private assertLive(): void {
    if (!this.disposed) return
    throw new ModkitError({
      code: 'x3.vfs/filesystem-disposed',
      message: 'the virtual filesystem is disposed',
    })
  }
}
