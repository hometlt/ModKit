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

export interface HttpFetchHeaders {
  get(name: string): string | null
}

export interface HttpFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: HttpFetchHeaders
  arrayBuffer(): Promise<ArrayBuffer>
}

export type HttpFetch = (
  input: string,
  init?: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly signal?: AbortSignal
  },
) => Promise<HttpFetchResponse>

export interface HttpRangeSourceOptions {
  readonly fetch?: HttpFetch
  readonly size?: number
  readonly signal?: AbortSignal
}

const unavailable = (message: string, context: Readonly<Record<string, unknown>> = {}) =>
  new ModkitError({ code: 'x3.vfs/http-range-unavailable', message, context })

function assertSafeSize(size: number | undefined): asserts size is number {
  if (size !== undefined && Number.isSafeInteger(size) && size >= 0) return
  throw unavailable('HTTP range source requires a non-negative safe content length')
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

/** Exact-range source shared by VFS and browser hosts. */
export async function createHttpRangeSource(
  url: string,
  options: HttpRangeSourceOptions = {},
): Promise<RandomAccessSource> {
  const fetcher = options.fetch ?? (globalThis.fetch as unknown as HttpFetch | undefined)
  if (fetcher === undefined) throw unavailable('this realm does not provide fetch')
  let size = options.size
  if (size === undefined) {
    throwIfAborted(options.signal)
    const head = await fetcher(
      url,
      options.signal === undefined
        ? { method: 'HEAD' }
        : { method: 'HEAD', signal: options.signal },
    )
    const length = head.headers.get('content-length')
    size = length === null ? undefined : Number(length)
    if (!head.ok || head.headers.get('accept-ranges')?.toLowerCase() !== 'bytes') {
      throw unavailable(`HTTP source «${url}» does not advertise bounded byte ranges`, {
        status: head.status,
        contentLength: length,
        acceptRanges: head.headers.get('accept-ranges'),
      })
    }
  }
  assertSafeSize(size)
  const sourceSize = size
  let disposed = false
  const assertLive = () => {
    if (!disposed) return
    throw new ModkitError({
      code: 'x3.vfs/source-disposed',
      message: `source «${url}» disposed`,
    })
  }
  const source: RandomAccessSource = {
    id: url,
    async size(signal) {
      throwIfAborted(signal)
      assertLive()
      return sourceSize
    },
    async readAt(offset, length, signal) {
      throwIfAborted(signal)
      assertLive()
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > sourceSize
      ) {
        throw rangeError(url, offset, length, sourceSize)
      }
      if (length === 0) return new Uint8Array()
      const response = await fetcher(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        ...(signal === undefined ? {} : { signal }),
      })
      if (response.status !== 206) {
        throw unavailable(`HTTP source «${url}» ignored a bounded range request`, {
          status: response.status,
          offset,
          length,
        })
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength !== length) {
        throw new ModkitError({
          code: 'x3.vfs/http-short-range-response',
          message: `HTTP source «${url}» returned ${bytes.byteLength} bytes for a ${length}-byte range`,
          context: { offset, length, actual: bytes.byteLength },
        })
      }
      return bytes
    },
    stream(start, end, signal) {
      assertLive()
      return sourceStream(source, sourceSize, start, end, signal)
    },
    dispose() {
      disposed = true
    },
  }
  return source
}

export interface HttpVfsProviderOptions {
  readonly id?: string
  readonly scheme?: 'http' | 'https'
  readonly fetch?: HttpFetch
  readonly allowedOrigins?: readonly string[]
  readonly limits?: Partial<VfsLimits>
}

class HttpMount implements VfsMount {
  readonly id: string
  readonly revision: string
  private readonly budget: VfsReadBudget
  private readonly sources = new Set<RandomAccessSource>()
  private disposed = false

  constructor(
    readonly rootUri: string,
    private readonly sizeBytes: number,
    private readonly fetcher: HttpFetch | undefined,
    private readonly limits: VfsLimits,
  ) {
    this.id = rootUri
    this.revision = `provider-token:http-${encodeURIComponent(rootUri)}-${sizeBytes}`
    this.budget = new VfsReadBudget(limits.maxReadBytes)
  }

  async stat(path: string, signal?: AbortSignal): Promise<VfsNode | undefined> {
    throwIfAborted(signal)
    this.assertLive()
    if (normalizeVfsPath(path) !== '') return undefined
    const parsed = new URL(this.rootUri)
    return Object.freeze({
      path: '',
      name: decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? parsed.host),
      kind: 'file',
      size: BigInt(this.sizeBytes),
      revision: this.revision,
    })
  }

  async *list(path: string, signal?: AbortSignal): AsyncIterable<VfsNode> {
    throwIfAborted(signal)
    this.assertLive()
    throw new ModkitError({
      code: 'x3.vfs/not-a-directory',
      message: `HTTP VFS root «${this.rootUri}» is one file, not a directory`,
      context: { path: normalizeVfsPath(path) },
    })
  }

  async open(path: string, signal?: AbortSignal): Promise<RandomAccessSource> {
    throwIfAborted(signal)
    this.assertLive()
    if (normalizeVfsPath(path) !== '') {
      throw new ModkitError({
        code: 'x3.vfs/file-not-found',
        message: `HTTP VFS root «${this.rootUri}» has no child path «${path}»`,
        context: { path },
      })
    }
    const raw = await createHttpRangeSource(this.rootUri, {
      size: this.sizeBytes,
      ...(this.fetcher === undefined ? {} : { fetch: this.fetcher }),
      ...(signal === undefined ? {} : { signal }),
    })
    const source = budgetRandomAccessSource(raw, this.sizeBytes, this.limits, this.budget)
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
      message: `HTTP VFS mount «${this.rootUri}» is disposed`,
    })
  }
}

export class HttpVfsProvider implements VfsProvider {
  readonly id: string
  readonly scheme: 'http' | 'https'
  private readonly limits: VfsLimits

  constructor(private readonly options: HttpVfsProviderOptions = {}) {
    this.id = options.id ?? 'org.modkitx-x3.vfs.http'
    this.scheme = options.scheme ?? 'https'
    this.limits = clampVfsLimits(options.limits)
  }

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    throwIfAborted(context.signal)
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch (cause) {
      throw new ModkitError({
        code: 'x3.vfs/uri-invalid',
        message: `HTTP provider cannot parse source URI «${uri}»`,
        context: { uri },
        cause,
      })
    }
    if (parsed.protocol !== `${this.scheme}:`) {
      throw new ModkitError({
        code: 'x3.vfs/provider-scheme-mismatch',
        message: `HTTP provider cannot open protocol «${parsed.protocol}»`,
        context: { uri, protocol: parsed.protocol },
      })
    }
    if (
      this.options.allowedOrigins !== undefined &&
      !this.options.allowedOrigins.includes(parsed.origin)
    ) {
      throw new ModkitError({
        code: 'x3.vfs/http-origin-refused',
        message: `HTTP provider refuses origin «${parsed.origin}»`,
        context: { origin: parsed.origin },
      })
    }
    const limits = clampVfsLimits(context.limits, this.limits)
    const probe = await createHttpRangeSource(parsed.href, {
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const size = await probe.size(context.signal)
    await probe.dispose()
    if (BigInt(size) > limits.maxFileBytes) {
      throw new ModkitError({
        code: 'x3.vfs/file-size-limit-exceeded',
        message: 'HTTP provider encountered a file above its logical size limit',
        context: { fileBytes: String(size), maxFileBytes: String(limits.maxFileBytes) },
      })
    }
    return new HttpMount(parsed.href, size, this.options.fetch, limits)
  }
}

export function createHttpVfsProvider(options: HttpVfsProviderOptions = {}): HttpVfsProvider {
  return new HttpVfsProvider(options)
}
