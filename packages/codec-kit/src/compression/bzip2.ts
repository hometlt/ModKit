import { ModkitError } from '@modkit/core'
import seekBzip from 'seek-bzip'

/** Real bzip2 stream decode with an output-byte cap; decoder block scratch memory is additional. */
export function bzip2Decompress(
  data: Uint8Array,
  options: { maxOutputBytes: number; signal?: AbortSignal },
): Uint8Array {
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 0)
    throw new RangeError('maxOutputBytes must be a nonnegative safe integer')
  options.signal?.throwIfAborted()
  const chunks: Uint8Array[] = []
  let length = 0
  const payload = data[0] === 0x10 ? data.subarray(1) : data
  let position = 0
  try {
    // No eof() shortcut: seek-bzip otherwise accepts a stream cut exactly at a block boundary.
    seekBzip.decode(
      {
        readByte() {
          if (position >= payload.length) throw new Error('Truncated bzip2 stream')
          const byte = payload[position++]
          if (byte === undefined) throw new Error('Truncated bzip2 stream')
          return byte
        },
        read(buffer, offset, count) {
          for (let index = 0; index < count; index++) buffer[offset + index] = this.readByte()
          return count
        },
      },
      {
        writeByte(byte) {
          options.signal?.throwIfAborted()
          if (length >= options.maxOutputBytes)
            throw new ModkitError({
              code: 'codec-kit/compression-output-limit',
              message: 'bzip2 output exceeds maxOutputBytes',
              context: { maxOutputBytes: options.maxOutputBytes },
            })
          if (length % 16384 === 0)
            chunks.push(new Uint8Array(Math.min(16384, options.maxOutputBytes - length)))
          const chunk = chunks[chunks.length - 1]
          if (chunk === undefined) throw new Error('Missing output chunk')
          chunk[length % 16384] = byte
          length++
        },
      },
    )
    if (position !== payload.length)
      throw new Error('Trailing or concatenated bzip2 streams require an explicit container policy')
  } catch (cause) {
    if (cause instanceof ModkitError || options.signal?.aborted) throw cause
    throw new ModkitError({
      code: 'codec-kit/invalid-bzip2',
      message: 'Invalid or truncated bzip2 stream',
      cause,
    })
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk.subarray(0, Math.min(chunk.length, length - offset)), offset)
    offset += chunk.length
  }
  return output
}

/** The pinned MPQ ADPCM helper is unimplemented. Never substitute a different ADPCM dialect. */
export function adpcmDecompress(_data: Uint8Array, _channels = 1): never {
  void _data
  void _channels
  throw new ModkitError({
    code: 'codec-kit/adpcm-unavailable',
    message: 'MPQ ADPCM is outside the M1 shared-library surface',
  })
}
