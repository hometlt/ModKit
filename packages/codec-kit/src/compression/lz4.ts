/**
 * Bounded LZ4 raw blocks and standard frames (linked/independent, stored/compressed blocks,
 * optional content size, header/block/content xxHash32). External dictionaries and concatenated
 * frames refuse. Output stays under the caller's ceiling plus bounded 64KiB history per block;
 * frame/block metadata is bounded by the input. No native dependencies.
 *
 * Roblox binary places and models compress each chunk as one LZ4 block whose decompressed size the
 * chunk header states, so the decoder takes that size and refuses anything that does not fill it
 * exactly. Every length and offset is checked before it is used: a hostile block cannot read or
 * write outside its buffers.
 */

import { xxHash32 } from '../checksum/xxhash32.js'

export const LZ4_MALFORMED = 'codec-kit/lz4-malformed'

function malformed(message: string): Error {
  const error = new RangeError(`LZ4 block ${message}`)
  Object.defineProperty(error, 'code', { value: LZ4_MALFORMED, enumerable: true })
  return error
}

/** Decode one LZ4 block into exactly `outputLength` bytes. */
export function decodeLz4Block(input: Uint8Array, outputLength: number,
  options: { readonly dictionary?: Uint8Array; readonly allowShortOutput?: boolean } = {}): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('LZ4 input must be bytes')
  if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
    throw new RangeError('LZ4 output length must be a non-negative safe integer')
  }
  const dictionary = options.dictionary?.subarray(-65536) ?? new Uint8Array()
  const prefix = dictionary.length
  const output = new Uint8Array(prefix + outputLength)
  output.set(dictionary)
  const outputEnd = output.length
  let ip = 0
  let op = prefix
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
    if (literalLength > outputEnd - op) throw malformed('literal run overruns the output')
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
    if (matchLength > outputEnd - op) throw malformed('match overruns the output')
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
  if (!options.allowShortOutput && op !== outputEnd) {
    throw malformed(`decoded ${op - prefix} bytes where ${outputLength} were declared`)
  }
  return prefix === 0 && op === outputEnd ? output : output.slice(prefix, op)
}

export interface Lz4FrameInfo {
  readonly headerBytes: number
  readonly contentSize?: number
  readonly maxBlockBytes: number
  readonly independent: boolean
  readonly blockChecksum: boolean
  readonly contentChecksum: boolean
}

/** Validate one standard frame descriptor before allocating output or admitting an entry size. */
export function lz4FrameInfo(input: Uint8Array, maxOutputBytes: number): Lz4FrameInfo {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) throw new RangeError('Invalid LZ4 output budget')
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  if (input.length < 7 || view.getUint32(0, true) !== 0x184d2204) throw malformed('frame header is truncated or has wrong magic')
  const flg = input[4]!, bd = input[5]!, code = (bd >>> 4) & 7
  if ((flg >>> 6) !== 1 || (flg & 2) !== 0 || (bd & 0x8f) !== 0 || code < 4 || code > 7)
    throw malformed('frame version, flags or block size unsupported')
  if (flg & 1) throw malformed('external frame dictionary unsupported')
  const headerBytes = flg & 8 ? 15 : 7
  if (input.length < headerBytes) throw malformed('frame content-size header truncated')
  if (((xxHash32(input.subarray(4, headerBytes - 1)) >>> 8) & 255) !== input[headerBytes - 1]) throw malformed('frame header checksum mismatch')
  const size = flg & 8 ? view.getBigUint64(6, true) : undefined
  if (size !== undefined && size > BigInt(maxOutputBytes)) throw malformed('frame content exceeds output budget')
  return { headerBytes, ...(size === undefined ? {} : { contentSize: Number(size) }),
    maxBlockBytes: 1 << (8 + code * 2), independent: (flg & 32) !== 0,
    blockChecksum: (flg & 16) !== 0, contentChecksum: (flg & 4) !== 0 }
}

/** Decode exactly one standard LZ4 frame through the same raw-block decoder, checking all checksums. */
export function decodeLz4Frame(input: Uint8Array, maxOutputBytes: number): Uint8Array {
  const info = lz4FrameInfo(input, maxOutputBytes)
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength), blocks: Uint8Array[] = []
  let cursor = info.headerBytes, total = 0, dictionary = new Uint8Array()
  /** Consume a checked u32; truncated end markers/checksums cannot masquerade as a clean end. */
  const word = (): number => {
    if (cursor + 4 > input.length) throw malformed('frame block or checksum truncated')
    const value = view.getUint32(cursor, true); cursor += 4; return value
  }
  while (true) {
    const header = word()
    if (header === 0) break
    const size = header & 0x7fffffff
    if (!size || size > info.maxBlockBytes || size > input.length - cursor) throw malformed('frame block exceeds its bounds')
    const raw = input.subarray(cursor, cursor + size); cursor += size
    if (info.blockChecksum && word() !== xxHash32(raw)) throw malformed('frame block checksum mismatch')
    const remaining = (info.contentSize ?? maxOutputBytes) - total
    if ((header & 0x80000000) !== 0 && size > remaining) throw malformed('frame stored block exceeds output budget')
    const block = header & 0x80000000 ? raw.slice() : decodeLz4Block(raw, Math.min(info.maxBlockBytes, remaining),
      { dictionary, allowShortOutput: true })
    if (block.length > remaining) throw malformed('frame output exceeds its declared size or budget')
    blocks.push(block); total += block.length
    if (!info.independent) {
      const history = new Uint8Array(Math.min(65536, dictionary.length + block.length))
      if (block.length >= history.length) history.set(block.subarray(-history.length))
      else { const kept = history.length - block.length; history.set(dictionary.subarray(-kept)); history.set(block, kept) }
      dictionary = history
    }
  }
  if (info.contentSize !== undefined && total !== info.contentSize) throw malformed('frame decoded size differs from content size')
  const output = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) { output.set(block, offset); offset += block.length }
  if (info.contentChecksum && word() !== xxHash32(output)) throw malformed('frame content checksum mismatch')
  if (cursor !== input.length) throw malformed('frame has trailing bytes or concatenated frames')
  return output
}
