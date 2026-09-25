export const COMPRESSION_OUTPUT_LIMIT = 'codec-kit/compression-output-limit'

export type PortableDecompressionFormat = 'deflate' | 'deflate-raw' | 'gzip'

export interface BoundedDecompressionOptions {
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
  readonly onChunk?: (byteLength: number) => void
  readonly outputLimitError?: (maximum: number) => Error
}

interface NativeResult {
  readonly buffer: Uint8Array
  readonly engine: { readonly bytesWritten: number }
}
type NativeDecompress = (
  payload: Uint8Array,
  options: { info: true; maxOutputLength: number; chunkSize: number },
  callback: (error: (Error & { code?: unknown }) | null, result: NativeResult) => void,
) => void
interface NodeZlib {
  readonly inflate: NativeDecompress
  readonly inflateRaw: NativeDecompress
  readonly gunzip: NativeDecompress
}

// A variable specifier, so a browser bundle does not try to resolve it.
const NODE_ZLIB = 'node:zlib'
let nodeZlib: Promise<NodeZlib | undefined> | undefined
function loadNodeZlib(): Promise<NodeZlib | undefined> {
  nodeZlib ??= import(/* @vite-ignore */ NODE_ZLIB).then(
    zlib => (typeof (zlib as Partial<NodeZlib>).inflate === 'function' ? (zlib as NodeZlib) : undefined),
    () => undefined,
  )
  return nodeZlib
}

/** What `DecompressionStream` answers for bytes after the end of the compressed stream. */
function trailingJunkError(): Error {
  const error = new TypeError('Trailing junk found after the end of the compressed stream')
  Object.defineProperty(error, 'code', { value: 'ERR_TRAILING_JUNK_AFTER_STREAM_END', enumerable: true })
  return error
}

function defaultOutputLimitError(maximum: number): Error {
  const error = new RangeError(`decompressed output exceeds its ${maximum}-byte bound`)
  Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
  return error
}

/**
 * Decompress one stream while enforcing an output-byte ceiling: with the platform's zlib where the
 * realm has one (Node, a Node worker, Electron — one call on the libuv thread pool instead of a
 * stream per payload), with `DecompressionStream` otherwise. Both answer the same inputs the same
 * way: bytes after the end of the stream, a truncated stream and an empty one are errors, several
 * gzip members are one output.
 */
export async function decompressBounded(
  payload: Uint8Array,
  format: PortableDecompressionFormat,
  options: BoundedDecompressionOptions,
): Promise<Uint8Array> {
  if (!(payload instanceof Uint8Array)) throw new TypeError('compressed payload must be bytes')
  const maximum = options.maxOutputBytes
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
  options.signal?.throwIfAborted()
  const zlib = await loadNodeZlib()
  if (zlib !== undefined) return decompressNative(zlib, payload, format, maximum, options)
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('portable decompression requires DecompressionStream')
  }

  const input = new Uint8Array(payload)
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let outputBytes = 0
  try {
    for (;;) {
      options.signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      outputBytes += chunk.value.byteLength
      if (!Number.isSafeInteger(outputBytes) || outputBytes > maximum) {
        throw (options.outputLimitError ?? defaultOutputLimitError)(maximum)
      }
      options.onChunk?.(chunk.value.byteLength)
      chunks.push(chunk.value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  }

  options.signal?.throwIfAborted()
  const output = new Uint8Array(outputBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function decompressNative(
  zlib: NodeZlib,
  payload: Uint8Array,
  format: PortableDecompressionFormat,
  maximum: number,
  options: BoundedDecompressionOptions,
): Promise<Uint8Array> {
  const run = format === 'gzip' ? zlib.gunzip : format === 'deflate-raw' ? zlib.inflateRaw : zlib.inflate
  let result: NativeResult
  try {
    result = await new Promise<NativeResult>((resolve, reject) =>
      run(
        payload,
        {
          info: true,
          // zlib takes 1..2^31-1 here; no single output this module hands back is larger.
          maxOutputLength: Math.min(Math.max(1, maximum), 0x7fffffff),
          // An exact bound (a sector, a chunk) is inflated into one buffer, without a join.
          chunkSize: Math.min(Math.max(maximum, 64), 1 << 20),
        },
        (error, value) => (error === null ? resolve(value) : reject(error)),
      ),
    )
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw (options.outputLimitError ?? defaultOutputLimitError)(maximum)
    }
    throw error
  }
  options.signal?.throwIfAborted()
  // zlib stops at the end of the stream and ignores what follows; the stream decoder refuses it.
  if (result.engine.bytesWritten !== payload.byteLength) throw trailingJunkError()
  const output = result.buffer
  if (output.byteLength > maximum) throw (options.outputLimitError ?? defaultOutputLimitError)(maximum)
  options.onChunk?.(output.byteLength)
  // A Node Buffer may be a slice of a shared pool; the result owns its whole buffer, as the
  // stream decoder's does (and as the host's worker RPC requires of anything it moves).
  return output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
    ? new Uint8Array(output.buffer)
    : new Uint8Array(output)
}

export type PortableCompressionFormat = PortableDecompressionFormat

/**
 * Compress with the platform's own encoder: zlib for PNG, raw deflate for ZIP, gzip for GZip.
 * Every runtime Modkit targets has `CompressionStream`; one that does not refuses by name.
 */
export async function compressPortable(
  payload: Uint8Array,
  format: PortableCompressionFormat,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (typeof CompressionStream !== 'function') {
    throw new TypeError('portable compression requires CompressionStream')
  }
  const stream = new Blob([new Uint8Array(payload)])
    .stream()
    .pipeThrough(new CompressionStream(format))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  signal?.throwIfAborted()
  return output
}
