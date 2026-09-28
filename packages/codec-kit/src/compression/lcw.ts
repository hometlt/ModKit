/**
 * Westwood's two image and data codings: LCW ("Format80", an LZ77 variant with fills) and the XOR
 * delta "Format40". CPS pictures, WSA and TD/RA1 SHP frames, VQA vectors and the Overlay packs of
 * Tiberian Sun and Red Alert 2 maps carry them.
 *
 * LCW commands: `0cccpppp pppppppp` copies c+3 bytes from p back; `10cccccc` copies c literal bytes
 * (c = 0 ends the stream); `11cccccc pppp` copies c+3 bytes from position p; `0xFE nnnn v` fills n
 * bytes with v; `0xFF nnnn pppp` copies n bytes from position p. A stream whose first byte is 0
 * addresses its positions from the end of the output (the "relative" form of large images). A
 * stream also ends where its input ends. The decoded size is the caller's (a CPS header, a pack
 * chunk) and bounds the output: a stream that would write past it is refused.
 *
 * Format40 XORs a delta onto the previous frame in place: `0 n v` XORs n bytes with v; `0..7F n`
 * XORs the next n input bytes; `80 0000` ends; `80 0nnn` skips n; `80 10nn` XORs the next n input
 * bytes; `80 11nn v` XORs n bytes with v; `81..FF` skips (cmd & 7F).
 */
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

export const LCW_MALFORMED = 'codec-kit/lcw-malformed'

function malformed(kind: string, message: string): Error {
  const error = new RangeError(`${kind} stream ${message}`)
  Object.defineProperty(error, 'code', { value: LCW_MALFORMED, enumerable: true })
  return error
}

function overrun(kind: string, bound: number): Error {
  const error = new RangeError(`${kind} output exceeds its ${bound}-byte bound`)
  Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
  return error
}

/**
 * Decode an LCW stream into its declared size, `maxOutputBytes`. Returns the output and the bytes
 * the stream wrote (`written`); a stream that stops short leaves the rest zero, as the games'
 * buffers were.
 */
export function decodeLcw(
  input: Uint8Array,
  maxOutputBytes: number,
): { readonly output: Uint8Array; readonly written: number } {
  if (!(input instanceof Uint8Array)) throw new TypeError('LCW input must be bytes')
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
  const output = new Uint8Array(maxOutputBytes)
  const relative = input[0] === 0
  let ip = relative ? 1 : 0
  let op = 0
  const need = (count: number): void => {
    if (count > input.length - ip) throw malformed('LCW', 'ends inside a command')
  }
  const u16 = (): number => {
    need(2)
    const value = (input[ip] ?? 0) | ((input[ip + 1] ?? 0) << 8)
    ip += 2
    return value
  }
  const room = (count: number): void => {
    if (count > output.length - op) throw overrun('LCW', output.length)
  }
  // Byte by byte: a copy may overlap what it writes, repeating the bytes before it.
  const copyFrom = (from: number, count: number): void => {
    if (from < 0 || from >= op) {
      throw malformed('LCW', `copies from ${from}, outside what was written`)
    }
    room(count)
    for (let index = 0; index < count; index += 1) output[op++] = output[from + index] ?? 0
  }
  while (ip < input.length) {
    const command = input[ip++] ?? 0
    if ((command & 0x80) === 0) {
      need(1)
      const distance = ((command & 0x0f) << 8) | (input[ip++] ?? 0)
      copyFrom(op - distance, ((command & 0x70) >>> 4) + 3)
    } else if ((command & 0x40) === 0) {
      const count = command & 0x3f
      if (count === 0) break
      need(count)
      room(count)
      output.set(input.subarray(ip, ip + count), op)
      ip += count
      op += count
    } else if (command === 0xfe) {
      const count = u16()
      need(1)
      room(count)
      output.fill(input[ip++] ?? 0, op, op + count)
      op += count
    } else {
      const count = command === 0xff ? u16() : (command & 0x3f) + 3
      const position = u16()
      copyFrom(relative ? op - position : position, count)
    }
  }
  return { output, written: op }
}

/** Apply a Format40 XOR delta onto `target` in place (the previous frame, or zeros). */
export function applyFormat40(input: Uint8Array, target: Uint8Array): void {
  if (!(input instanceof Uint8Array) || !(target instanceof Uint8Array)) {
    throw new TypeError('Format40 input and target must be bytes')
  }
  let ip = 0
  let op = 0
  const need = (count: number): void => {
    if (count > input.length - ip) throw malformed('Format40', 'ends inside a command')
  }
  const room = (count: number): void => {
    if (count > target.length - op) throw overrun('Format40', target.length)
  }
  const xorRun = (count: number): void => {
    need(count)
    room(count)
    for (let index = 0; index < count; index += 1) target[op++]! ^= input[ip++] ?? 0
  }
  const xorFill = (count: number, value: number): void => {
    room(count)
    for (let index = 0; index < count; index += 1) target[op++]! ^= value
  }
  while (ip < input.length) {
    const command = input[ip++] ?? 0
    if (command === 0) {
      need(2)
      const count = input[ip++] ?? 0
      xorFill(count, input[ip++] ?? 0)
    } else if ((command & 0x80) === 0) {
      xorRun(command)
    } else if (command !== 0x80) {
      const count = command & 0x7f
      room(count)
      op += count
    } else {
      need(2)
      const word = (input[ip] ?? 0) | ((input[ip + 1] ?? 0) << 8)
      ip += 2
      if (word === 0) return
      if ((word & 0x8000) === 0) {
        room(word)
        op += word
      } else if ((word & 0x4000) === 0) {
        xorRun(word & 0x3fff)
      } else {
        need(1)
        xorFill(word & 0x3fff, input[ip++] ?? 0)
      }
    }
  }
}

/**
 * `bytes` as an absolute LCW stream that `decodeLcw` (and the games) read back: runs of
 * four or more equal bytes as fills, the rest as literal runs of up to 63, then the end command.
 * ponytail: no back references, so repeated patterns other than runs stay as they are.
 */
export function encodeLcw(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('LCW input must be bytes')
  const out: number[] = []
  let literalStart = 0
  const flush = (end: number): void => {
    for (let at = literalStart; at < end; at += 63) {
      const count = Math.min(63, end - at)
      out.push(0x80 | count)
      for (let index = at; index < at + count; index += 1) out.push(bytes[index] ?? 0)
    }
  }
  let at = 0
  while (at < bytes.byteLength) {
    let run = 1
    while (at + run < bytes.byteLength && run < 0xffff && bytes[at + run] === bytes[at]) run += 1
    if (run >= 4) {
      flush(at)
      out.push(0xfe, run & 0xff, run >>> 8, bytes[at] ?? 0)
      at += run
      literalStart = at
    } else at += run
  }
  flush(bytes.byteLength)
  out.push(0x80)
  return Uint8Array.from(out)
}
