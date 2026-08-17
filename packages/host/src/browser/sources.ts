import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import { rangeError, type RandomAccessSource } from '@modkitx-x3/vfs'

export interface BrowserBlobSlice {
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface BrowserFileSnapshot {
  readonly size: number
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

export interface BrowserFetchHeaders {
  get(name: string): string | null
}

export interface BrowserFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: BrowserFetchHeaders
  arrayBuffer(): Promise<ArrayBuffer>
}

export type BrowserFetch = (
  input: string,
  init?: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly signal?: AbortSignal
  },
) => Promise<BrowserFetchResponse>

const CHUNK = 64 * 1024

function streamFromSource(
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
      if (position >= stop) {
        controller.close()
        return
      }
      const length = Math.min(CHUNK, stop - position)
      controller.enqueue(await source.readAt(position, length, signal))
      position += length
    },
  })
}

export async function createBrowserFileHandleSource(
  id: string,
  handle: BrowserFileHandle,
): Promise<RandomAccessSource> {
  const file = await handle.getFile()
  let disposed = false
  const ensureLive = () => {
    if (disposed) {
      throw new ModkitError({ code: 'x3.vfs/source-disposed', message: `source «${id}» disposed` })
    }
  }
  const source: RandomAccessSource = {
    id,
    async size(signal) {
      throwIfAborted(signal)
      ensureLive()
      return file.size
    },
    async readAt(offset, length, signal) {
      throwIfAborted(signal)
      ensureLive()
      if (offset < 0 || length < 0 || offset + length > file.size) {
        throw rangeError(id, offset, length, file.size)
      }
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
    },
    stream(start, end, signal) {
      ensureLive()
      return streamFromSource(source, file.size, start, end, signal)
    },
    dispose() {
      disposed = true
    },
  }
  return source
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
      code: 'x3.host/invalid-opfs-path',
      message: 'OPFS path must contain safe non-empty segments',
      context: { path: [...path] },
    })
  }
  let directory = root
  for (const segment of path.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  const name = path[path.length - 1]
  if (name === undefined) throw new TypeError('OPFS path unexpectedly empty')
  return createBrowserFileHandleSource(id, await directory.getFileHandle(name))
}

export interface HttpRangeSourceOptions {
  readonly fetch?: BrowserFetch
  readonly size?: number
}

export async function createHttpRangeSource(
  url: string,
  options: HttpRangeSourceOptions = {},
): Promise<RandomAccessSource> {
  const fetcher = options.fetch ?? (globalThis.fetch as unknown as BrowserFetch | undefined)
  if (fetcher === undefined) {
    throw new ModkitError({
      code: 'x3.host/range-fetch-unavailable',
      message: 'this realm does not provide fetch for an HTTP range source',
    })
  }
  let size = options.size
  if (size === undefined) {
    const head = await fetcher(url, { method: 'HEAD' })
    const length = head.headers.get('content-length')
    const ranges = head.headers.get('accept-ranges')
    size = length === null ? undefined : Number(length)
    if (
      !head.ok ||
      !Number.isSafeInteger(size) ||
      Number(size) < 0 ||
      ranges?.toLowerCase() !== 'bytes'
    ) {
      throw new ModkitError({
        code: 'x3.host/range-fetch-unavailable',
        message: `HTTP source «${url}» does not advertise bounded byte ranges`,
        context: { status: head.status, contentLength: length, acceptRanges: ranges },
      })
    }
  }
  const sourceSize = size
  if (sourceSize === undefined || !Number.isSafeInteger(sourceSize) || sourceSize < 0) {
    throw new ModkitError({
      code: 'x3.host/range-fetch-unavailable',
      message: 'HTTP range source requires a non-negative safe content length',
    })
  }
  let disposed = false
  const source: RandomAccessSource = {
    id: url,
    async size(signal) {
      throwIfAborted(signal)
      if (disposed)
        throw new ModkitError({
          code: 'x3.vfs/source-disposed',
          message: `source «${url}» disposed`,
        })
      return sourceSize
    },
    async readAt(offset, length, signal) {
      throwIfAborted(signal)
      if (disposed)
        throw new ModkitError({
          code: 'x3.vfs/source-disposed',
          message: `source «${url}» disposed`,
        })
      if (offset < 0 || length < 0 || offset + length > sourceSize) {
        throw rangeError(url, offset, length, sourceSize)
      }
      if (length === 0) return new Uint8Array()
      const response = await fetcher(url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        ...(signal === undefined ? {} : { signal }),
      })
      if (response.status !== 206) {
        throw new ModkitError({
          code: 'x3.host/range-fetch-unavailable',
          message: `HTTP source «${url}» ignored a bounded range request`,
          context: { status: response.status, offset, length },
        })
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length !== length) {
        throw new ModkitError({
          code: 'x3.host/short-range-response',
          message: `HTTP source «${url}» returned ${bytes.length} bytes for a ${length}-byte range`,
          context: { offset, length, actual: bytes.length },
        })
      }
      return bytes
    },
    stream(start, end, signal) {
      return streamFromSource(source, sourceSize, start, end, signal)
    },
    dispose() {
      disposed = true
    },
  }
  return source
}
