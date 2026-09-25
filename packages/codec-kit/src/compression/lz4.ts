/**
 * LZ4 block decoding (the raw block format, without the LZ4 frame).
 *
 * Roblox binary places and models compress each chunk as one LZ4 block whose decompressed size the
 * chunk header states, so the decoder takes that size and refuses anything that does not fill it
 * exactly. Every length and offset is checked before it is used: a hostile block cannot read or
 * write outside its buffers.
 */

export const LZ4_MALFORMED = 'codec-kit/lz4-malformed'

function malformed(message: string): Error {
  const error = new RangeError(`LZ4 block ${message}`)
  Object.defineProperty(error, 'code', { value: LZ4_MALFORMED, enumerable: true })
  return error
}

/** Decode one LZ4 block into exactly `outputLength` bytes. */
export function decodeLz4Block(input: Uint8Array, outputLength: number): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('LZ4 input must be bytes')
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
    throw new RangeError('LZ4 output length must be a non-negative safe integer')
  }
  const output = new Uint8Array(outputLength)
  let ip = 0
  let op = 0
  const inputLength = input.length
  while (ip < inputLength) {
    const token = input[ip++] ?? 0
    let literalLength = token >>> 4
    if (literalLength === 15) {
      let byte: number
      do {
        if (ip >= inputLength) throw malformed('ends inside a literal length')
        byte = input[ip++] ?? 0
        literalLength += byte
      } while (byte === 255)
    }
    if (literalLength > inputLength - ip) throw malformed('literal run overruns the input')
    if (literalLength > outputLength - op) throw malformed('literal run overruns the output')
    output.set(input.subarray(ip, ip + literalLength), op)
    ip += literalLength
    op += literalLength
    // The last sequence carries literals only.
    if (ip === inputLength) break
    if (ip + 2 > inputLength) throw malformed('ends inside a match offset')
    const offset = (input[ip] ?? 0) | ((input[ip + 1] ?? 0) << 8)
    ip += 2
    if (offset === 0 || offset > op) throw malformed(`has an invalid match offset ${offset}`)
    let matchLength = token & 15
    if (matchLength === 15) {
      let byte: number
      do {
        if (ip >= inputLength) throw malformed('ends inside a match length')
        byte = input[ip++] ?? 0
        matchLength += byte
      } while (byte === 255)
    }
    matchLength += 4
    if (matchLength > outputLength - op) throw malformed('match overruns the output')
    const from = op - offset
    if (offset >= matchLength) {
      output.copyWithin(op, from, from + matchLength)
      op += matchLength
    } else {
      // Overlapping copy repeats the last `offset` bytes; it must run byte by byte.
      for (let index = 0; index < matchLength; index += 1) {
        output[op] = output[from + index] ?? 0
        op += 1
      }
    }
  }
  if (op !== outputLength) {
    throw malformed(`decoded ${op} bytes where ${outputLength} were declared`)
  }
  return output
}
