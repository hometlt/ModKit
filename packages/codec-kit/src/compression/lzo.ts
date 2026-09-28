/**
 * LZO1X decompression (the format of Oberhumer's `lzo1x_decompress_safe`), as the IsoMapPack5 and
 * PreviewPack of Tiberian Sun and Red Alert 2 maps carry it in their "format 5" chunks, and a
 * storing encoder for the packs a map writer re-packs.
 *
 * A stream is literal runs and matches: M1 (2 bytes near, or 3 bytes 2 KiB back right after a
 * literal run), M2 (3–8 bytes up to 2 KiB back), M3 (up to 16 KiB back) and M4 (16–48 KiB back);
 * the two low bits of a match's last opcode or distance byte say how many literals (0–3) follow
 * it, and the command after those literals is always a match. The stream ends with an M4 of
 * distance zero. The decoded size is the caller's (a pack chunk header) and bounds the output: a
 * stream must fill it exactly, and one that would write past it is refused.
 */
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

export const LZO_MALFORMED = 'codec-kit/lzo-malformed'

function malformed(message: string): Error {
  const error = new RangeError(`LZO1X stream ${message}`)
  Object.defineProperty(error, 'code', { value: LZO_MALFORMED, enumerable: true })
  return error
}

/** Decode an LZO1X stream into exactly `outputBytes` bytes, its declared size. */
export function decodeLzo1x(input: Uint8Array, outputBytes: number): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('LZO1X input must be bytes')
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) {
    throw new RangeError('outputBytes must be a non-negative safe integer')
  }
  const output = new Uint8Array(outputBytes)
  let ip = 0
  let op = 0

  const next = (): number => {
    if (ip >= input.length) throw malformed('ends inside a command')
    return input[ip++] ?? 0
  }
  const room = (count: number): void => {
    if (count > output.length - op) {
      const error = new RangeError(`LZO1X output exceeds its ${output.length}-byte bound`)
      Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
      throw error
    }
  }
  /** A count continued by zero bytes (255 each) and a final byte, as LZO spells long ones. */
  const extended = (base: number): number => {
    let count = base
    let byte = next()
    while (byte === 0) {
      count += 255
      room(count)
      byte = next()
    }
    return count + byte
  }
  const literals = (count: number): void => {
    if (count > input.length - ip) throw malformed('literal run overruns the input')
    room(count)
    output.set(input.subarray(ip, ip + count), op)
    ip += count
    op += count
  }
  // Byte by byte: a match may overlap what it writes, repeating the bytes before it.
  const copy = (distance: number, count: number): void => {
    if (distance <= 0 || distance > op) throw malformed(`has a match ${distance} back from ${op}`)
    room(count)
    const from = op - distance
    for (let index = 0; index < count; index += 1) output[op++] = output[from + index] ?? 0
  }

  type Mode = 'loop' | 'first-literal-run' | 'match' | 'match-next'
  let mode: Mode = 'loop'
  let t = 0
  if ((input[0] ?? 0) > 17) {
    t = next() - 17
    if (t < 4) {
      mode = 'match-next'
    } else {
      literals(t)
      mode = 'first-literal-run'
    }
  }
  for (;;) {
    switch (mode) {
      case 'loop': {
        t = next()
        if (t >= 16) {
          mode = 'match'
          break
        }
        literals(t === 0 ? extended(15) + 3 : t + 3)
        mode = 'first-literal-run'
        break
      }
      case 'first-literal-run': {
        t = next()
        if (t >= 16) {
          mode = 'match'
          break
        }
        // right after a literal run: 3 bytes from 2 KiB + 1 back or further
        copy(1 + 0x0800 + (t >>> 2) + (next() << 2), 3)
        t &= 3
        mode = t === 0 ? 'loop' : 'match-next'
        break
      }
      case 'match-next': {
        literals(t)
        t = next()
        mode = 'match'
        break
      }
      case 'match': {
        let trailing: number
        if (t >= 64) {
          copy(1 + ((t >>> 2) & 7) + (next() << 3), (t >>> 5) + 1)
          trailing = t & 3
        } else if (t >= 32) {
          const count = (t & 31) === 0 ? extended(31) : t & 31
          const first = next()
          copy(1 + ((first >>> 2) | (next() << 6)), count + 2)
          trailing = first & 3
        } else if (t >= 16) {
          const count = (t & 7) === 0 ? extended(7) : t & 7
          const first = next()
          const distance = ((t & 8) << 11) + ((first >>> 2) | (next() << 6))
          if (distance === 0) {
            if (op !== output.length) throw malformed(`ends after ${op} of ${output.length} bytes`)
            if (ip !== input.length) {
              throw malformed(`carries ${input.length - ip} bytes after its end`)
            }
            return output
          }
          copy(distance + 0x4000, count + 2)
          trailing = first & 3
        } else {
          // after a match's literals: the 2-byte M1
          copy(1 + (t >>> 2) + (next() << 2), 2)
          trailing = t & 3
        }
        t = trailing
        mode = t === 0 ? 'loop' : 'match-next'
        break
      }
    }
  }
}

/**
 * `bytes` as an LZO1X stream that `decodeLzo1x` (and the games) read back: one literal run and the
 * end marker. ponytail: stores, does not compress (the stream is 3–5 bytes plus 1 per 255 longer
 * than its input); a matching encoder when map packs must stay small.
 */
export function encodeLzo1x(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('LZO1X input must be bytes')
  const n = bytes.byteLength
  const head: number[] = []
  if (n > 0 && n <= 238) head.push(17 + n)
  else if (n > 238) {
    // a first byte of 0 opens a run of 18 + the zero-extended count
    head.push(0)
    let rest = n - 18
    for (; rest > 255; rest -= 255) head.push(0)
    head.push(rest)
  }
  const out = new Uint8Array(head.length + n + 3)
  out.set(head)
  out.set(bytes, head.length)
  out.set([0x11, 0, 0], head.length + n)
  return out
}
