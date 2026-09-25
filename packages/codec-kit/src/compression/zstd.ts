import { Decompress } from 'fzstd'
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

/**
 * Zstandard decoding (RFC 8878) through `fzstd`, bounded by the caller's output limit.
 *
 * Users: Roblox binary place/model chunks, KTX2 `Zstandard` supercompression, `.zst` payloads.
 * Dictionaries are not supported; a frame that needs one is refused by the decoder.
 */

export const ZSTD_MAGIC = Object.freeze([0x28, 0xb5, 0x2f, 0xfd] as const)
export const ZSTD_MALFORMED = 'codec-kit/zstd-malformed'

export interface ZstdDecodeOptions {
  /** Refuse output larger than this. */
  readonly maxOutputBytes: number
  /**
   * Exact decompressed size when the container states it (Roblox chunk header, KTX2 level
   * index). The output is then decoded in place and must match it exactly.
   */
  readonly expectedLength?: number
}

function withCode(error: Error, code: string): Error {
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

function limitError(maximum: number): Error {
  return withCode(
    new RangeError(`decompressed output exceeds its ${maximum}-byte bound`),
    COMPRESSION_OUTPUT_LIMIT,
  )
}

function malformed(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  return withCode(new RangeError(`Zstandard data is malformed: ${message}`), ZSTD_MALFORMED)
}

/** True when the bytes start with a Zstandard frame magic number. */
export function isZstdFrame(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === ZSTD_MAGIC[0] &&
    bytes[1] === ZSTD_MAGIC[1] &&
    bytes[2] === ZSTD_MAGIC[2] &&
    bytes[3] === ZSTD_MAGIC[3]
  )
}

/** Decode one or more concatenated Zstandard frames. */
export function decodeZstd(input: Uint8Array, options: ZstdDecodeOptions): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('Zstandard input must be bytes')
  const maximum = options.maxOutputBytes
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
  const expected = options.expectedLength
  if (expected !== undefined) {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new RangeError('expectedLength must be a non-negative safe integer')
    }
    if (expected > maximum) throw limitError(maximum)
  }
  // Streaming keeps the bound honest: fzstd's in-place mode silently drops bytes written past the
  // end of a caller buffer, so a frame larger than declared would look like a clean decode.
  const bound = expected ?? maximum
  const chunks: Uint8Array[] = []
  let total = 0
  const stream = new Decompress((chunk: Uint8Array) => {
    total += chunk.length
    if (total > bound) {
      throw expected === undefined
        ? limitError(maximum)
        : malformed(new Error(`frame is larger than the declared ${expected} bytes`))
    }
    chunks.push(chunk)
  })
  try {
    stream.push(input, true)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === COMPRESSION_OUTPUT_LIMIT || code === ZSTD_MALFORMED) throw error
    throw malformed(error)
  }
  if (expected !== undefined && total !== expected) {
    throw malformed(new Error(`decoded ${total} bytes where ${expected} were declared`))
  }
  if (chunks.length === 1 && chunks[0]?.length === total) return chunks[0]
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
