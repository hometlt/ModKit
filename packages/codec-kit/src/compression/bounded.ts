export const COMPRESSION_OUTPUT_LIMIT = 'codec-kit/compression-output-limit'

export type PortableDecompressionFormat = 'deflate' | 'deflate-raw' | 'gzip'

export interface BoundedDecompressionOptions {
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
  readonly onChunk?: (byteLength: number) => void
  readonly outputLimitError?: (maximum: number) => Error
}

function defaultOutputLimitError(maximum: number): Error {
  const error = new RangeError(`decompressed output exceeds its ${maximum}-byte bound`)
  Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
  return error
}

/** Collect one browser-native decompression stream while enforcing an output-byte ceiling. */
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
