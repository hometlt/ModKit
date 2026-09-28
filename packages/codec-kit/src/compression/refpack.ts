/**
 * RefPack (EA's LZ77 variant, also "QFS"): SAGE BIG archives, SAGE map envelopes and other EA
 * titles compress payloads with it.
 *
 * A stream starts with a flags byte and 0xFB, then big-endian sizes: 3 bytes each, or 4 when flag
 * 0x80 is set; with flag 0x01 the compressed size comes first and the decoded size second. Commands
 * follow: four match forms that may carry up to 3 literals, a literal run of 4–112 bytes, and a
 * stop code with up to 3 final literals. Every length and distance is checked before use, and the
 * declared size is bounded before anything is allocated.
 *
 * A stream too large to decode whole (Kane's Wrath's `static_common.bin` is 384 MB) is read by range
 * with `refPackRangeSource`: decoding resumes from the nearest checkpoint, which holds where the
 * input and output stand and the last 128 KiB of output, as far back as a match reaches.
 */
import type { ByteRangeSource } from '@modkit/sdk'
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

export const REFPACK_MALFORMED = 'codec-kit/refpack-malformed'

export interface RefPackHeader {
  /** Where the commands start. */
  readonly headerBytes: number
  /** Decoded size. */
  readonly size: number
  /** Present when the header carries it (flag 0x01). */
  readonly compressedSize?: number
}

function malformed(message: string): Error {
  const error = new RangeError(`RefPack stream ${message}`)
  Object.defineProperty(error, 'code', { value: REFPACK_MALFORMED, enumerable: true })
  return error
}

/** `true` for bytes that start with a RefPack header (flags with 0x10 set, then 0xFB). */
export function isRefPack(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && ((bytes[0] ?? 0) & 0x3e) === 0x10 && bytes[1] === 0xfb
}

/** The header of a RefPack stream; `bytes` needs only its first 10 bytes at most. */
export function readRefPackHeader(bytes: Uint8Array): RefPackHeader {
  if (!isRefPack(bytes)) throw malformed('has no RefPack header')
  const flags = bytes[0] ?? 0
  const width = (flags & 0x80) !== 0 ? 4 : 3
  const carriesCompressedSize = (flags & 0x01) !== 0
  const headerBytes = 2 + width * (carriesCompressedSize ? 2 : 1)
  if (bytes.byteLength < headerBytes) throw malformed('header is truncated')
  const number = (at: number): number => {
    let value = 0
    for (let index = 0; index < width; index += 1) value = value * 256 + (bytes[at + index] ?? 0)
    return value
  }
  return carriesCompressedSize
    ? { headerBytes, size: number(2 + width), compressedSize: number(2) }
    : { headerBytes, size: number(2) }
}

/** The most input one command reads: a literal run's control byte and 112 literals. */
const LONGEST_COMMAND = 113
/** The most output one command writes: 3 literals and a match of 1028 bytes. */
const LONGEST_OUTPUT = 1_031
/** How far back a match reaches at most. */
const WINDOW = 131_072

/** Where a run of commands stands: `output` before `op` is the history matches reach into. */
interface CommandRun {
  input: Uint8Array
  ip: number
  /** `input` ends where the stream ends; otherwise the run stops before a command that may not fit. */
  final: boolean
  readonly output: Uint8Array
  op: number
  stopped: boolean
}

/** Runs commands until the output reaches `until`, the stop code, or the end of a partial input. */
function runCommands(run: CommandRun, until: number): void {
  const { input, output, final } = run
  let ip = run.ip
  let op = run.op

  const literals = (length: number): void => {
    if (length > input.length - ip) throw malformed('literal run overruns the input')
    if (length > output.length - op) throw malformed('literal run overruns the output')
    if (length < 16) {
      // Most runs are 0–3 bytes, where a subarray costs more than the copy.
      for (let index = 0; index < length; index += 1) output[op++] = input[ip++] ?? 0
      return
    }
    output.set(input.subarray(ip, ip + length), op)
    ip += length
    op += length
  }
  const match = (distance: number, length: number): void => {
    if (distance > op) throw malformed(`has a match distance ${distance} before the output start`)
    if (length > output.length - op) throw malformed('match overruns the output')
    const from = op - distance
    if (distance >= length && length >= 32) {
      output.copyWithin(op, from, from + length)
      op += length
      return
    }
    // Byte by byte: short matches copy faster so, and an overlapping match (distance < length)
    // must, since it repeats the last `distance` bytes.
    for (let index = 0; index < length; index += 1) {
      output[op] = output[from + index] ?? 0
      op += 1
    }
  }
  // Operand bytes are read in place: a stream has millions of commands.
  const operands = (count: number): void => {
    if (count > input.length - ip) throw malformed('ends inside a command')
  }

  // A partial input stops the run where the next command might not fit; the whole input at its end.
  const limit = final ? input.length : input.length - LONGEST_COMMAND
  while (op < until && ip < limit) {
    const control = input[ip++] ?? 0
    if (control < 0x80) {
      operands(1)
      const b1 = input[ip++] ?? 0
      literals(control & 0x03)
      match(((control & 0x60) << 3) + b1 + 1, ((control & 0x1c) >>> 2) + 3)
    } else if (control < 0xc0) {
      operands(2)
      const b1 = input[ip++] ?? 0
      const b2 = input[ip++] ?? 0
      literals(b1 >>> 6)
      match(((b1 & 0x3f) << 8) + b2 + 1, (control & 0x3f) + 4)
    } else if (control < 0xe0) {
      operands(3)
      const b1 = input[ip++] ?? 0
      const b2 = input[ip++] ?? 0
      const b3 = input[ip++] ?? 0
      literals(control & 0x03)
      match(((control & 0x10) << 12) + (b1 << 8) + b2 + 1, ((control & 0x0c) << 6) + b3 + 5)
    } else if (control < 0xfc) {
      literals(((control & 0x1f) + 1) << 2)
    } else {
      literals(control & 0x03)
      run.stopped = true
      break
    }
  }
  if (final && !run.stopped && op < until) throw malformed('ends without its stop code')
  run.ip = ip
  run.op = op
}

/** Decode a whole RefPack stream; its declared size must not exceed `maxOutputBytes`. */
export function decodeRefPack(input: Uint8Array, maxOutputBytes: number): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('RefPack input must be bytes')
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
  const header = readRefPackHeader(input)
  if (header.size > maxOutputBytes) {
    const error = new RangeError(
      `RefPack output ${header.size} exceeds its ${maxOutputBytes}-byte bound`,
    )
    Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
    throw error
  }
  const output = new Uint8Array(header.size)
  const run: CommandRun = {
    input,
    ip: header.headerBytes,
    final: true,
    output,
    op: 0,
    stopped: false,
  }
  runCommands(run, Number.POSITIVE_INFINITY)
  if (run.op !== output.length)
    throw malformed(`decoded ${run.op} bytes where ${output.length} were declared`)
  return output
}

export interface RefPackRangeOptions {
  /** Bytes of the compressed stream, read from `source` at offset 0 (default: its size). */
  readonly compressedLength?: bigint
  /** Output between checkpoints: the most a read decodes before its range (default 4 MiB). */
  readonly checkpointBytes?: number
  /** Compressed bytes read from `source` at a time (default 1 MiB). */
  readonly inputChunkBytes?: number
}

interface Checkpoint {
  /** Compressed offset of the next command. */
  readonly input: number
  /** Decoded bytes before it. */
  readonly output: number
  /** The last decoded bytes before it, up to `WINDOW`. */
  readonly window: Uint8Array
}

/**
 * A RefPack stream by range of its decoded bytes, without decoding it whole. The first read past
 * what is decoded so far decodes forward to it once, leaving a checkpoint every `checkpointBytes`;
 * any later read decodes at most `checkpointBytes` before its range. Memory holds one 128 KiB
 * window per checkpoint (12 MiB for 384 MB at the default) and the last decoded span. Reads are
 * served one at a time.
 */
export async function refPackRangeSource(
  source: ByteRangeSource,
  options: RefPackRangeOptions = {},
): Promise<ByteRangeSource> {
  const compressedLength = Number(options.compressedLength ?? (await source.size()))
  const interval = options.checkpointBytes ?? 4 << 20
  const chunkBytes = options.inputChunkBytes ?? 1 << 20
  if (!Number.isSafeInteger(compressedLength) || compressedLength < 2) {
    throw malformed('has no RefPack header')
  }
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError('checkpointBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < LONGEST_COMMAND) {
    throw new RangeError(`inputChunkBytes must be at least ${LONGEST_COMMAND}`)
  }
  const readInput = async (offset: number, length: number, signal?: AbortSignal) => {
    const bytes = await source.read(BigInt(offset), length, signal)
    if (bytes.byteLength !== length) throw malformed('source is shorter than its length')
    return bytes
  }
  const header = readRefPackHeader(await readInput(0, Math.min(10, compressedLength)))
  const size = header.size
  const checkpoints: Checkpoint[] = [
    { input: header.headerBytes, output: 0, window: new Uint8Array(0) },
  ]
  let last: { readonly start: number; readonly bytes: Uint8Array } | undefined

  /** Decodes from `from` until the output reaches `until` or the end; `output[0]` is at `base`. */
  const decode = async (from: Checkpoint, until: number, signal?: AbortSignal) => {
    const base = from.output - from.window.length
    const target = Math.min(until, size)
    const output = new Uint8Array(
      from.window.length + Math.min(size - from.output, target - from.output + LONGEST_OUTPUT),
    )
    output.set(from.window)
    const run: CommandRun = {
      input: new Uint8Array(0),
      ip: 0,
      final: false,
      output,
      op: from.window.length,
      stopped: false,
    }
    let inputStart = from.input
    for (;;) {
      runCommands(run, target - base)
      if (base + run.op >= target || run.stopped) break
      // The run stopped before a command that may not fit: carry the rest on with the next chunk.
      signal?.throwIfAborted()
      const rest = run.input.subarray(run.ip)
      inputStart += run.ip
      const at = inputStart + rest.length
      const length = Math.min(chunkBytes, compressedLength - at)
      const input = new Uint8Array(rest.length + length)
      input.set(rest)
      if (length > 0) input.set(await readInput(at, length, signal), rest.length)
      run.input = input
      run.ip = 0
      run.final = at + length >= compressedLength
    }
    if (base + run.op < target || (run.stopped && base + run.op !== size)) {
      throw malformed(`decoded ${base + run.op} bytes where ${size} were declared`)
    }
    const checkpoint: Checkpoint = {
      input: inputStart + run.ip,
      output: base + run.op,
      window: output.slice(Math.max(0, run.op - WINDOW), run.op),
    }
    return { base, output, end: run.op, checkpoint }
  }

  const readNow = async (offset: number, length: number, signal?: AbortSignal) => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      throw new RangeError('RefPack range must be non-negative')
    }
    if (offset + length > size) throw new RangeError('RefPack range is outside the decoded stream')
    if (length === 0) return new Uint8Array(0)
    if (
      last !== undefined &&
      offset >= last.start &&
      offset + length <= last.start + last.bytes.length
    ) {
      return last.bytes.slice(offset - last.start, offset - last.start + length)
    }
    // The last checkpoint at or before the range, walking forward first when it is too far back.
    let low = 0
    for (let high = checkpoints.length - 1; low < high;) {
      const middle = (low + high + 1) >> 1
      if ((checkpoints[middle]?.output ?? 0) <= offset) low = middle
      else high = middle - 1
    }
    let from = checkpoints[low] as Checkpoint
    while (from === checkpoints.at(-1) && offset - from.output >= interval) {
      const next = (await decode(from, from.output + interval, signal)).checkpoint
      checkpoints.push(next)
      from = next
    }
    const decoded = await decode(from, offset + length, signal)
    last = {
      start: from.output,
      bytes: decoded.output.subarray(from.window.length, decoded.end),
    }
    return decoded.output.slice(offset - decoded.base, offset - decoded.base + length)
  }

  let queue: Promise<unknown> = Promise.resolve()
  return Object.freeze<ByteRangeSource>({
    size: async () => BigInt(size),
    read(offset, length, signal) {
      const result = queue.then(() => readNow(Number(offset), length, signal))
      queue = result.catch(() => undefined)
      return result
    },
  })
}
