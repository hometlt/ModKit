/*
 * Portable LZMA / LZMA2 decoders plus the x86 BCJ and BCJ2 branch filters.
 *
 * Adapted from the public-domain LZMA SDK (Igor Pavlov) and XZ Utils (Lasse Collin) algorithms.
 * The whole-buffer decoders write into one caller-sized output buffer, so memory is the declared
 * output size: the dictionary is that same buffer and a declared dictionary size never causes an
 * allocation. Callers bound the output size before calling. The stream decoders (`*DecodeStream`)
 * take input and yield output in chunks over a window of the dictionary, which the caller bounds
 * instead, so an output of any size decodes in the memory of its dictionary.
 */

const PROB_INIT = 1024
const TOP = 1 << 24
const STATES = 12
const POS_STATES_MAX = 16
const DIST_MODELS = 114

export interface LzmaProperties {
  readonly lc: number
  readonly lp: number
  readonly pb: number
  readonly dictionarySize: number
}

function corrupt(message: string): TypeError {
  return new TypeError(`LZMA ${message}`)
}

/** Decode the lc/lp/pb property byte shared by LZMA-alone, 7z LZMA and LZMA2 chunks. */
export function lzmaPropertiesFromByte(value: number): Pick<LzmaProperties, 'lc' | 'lp' | 'pb'> {
  if (!Number.isInteger(value) || value < 0 || value >= 225) {
    throw corrupt('property byte is invalid')
  }
  const lc = value % 9
  const rest = Math.floor(value / 9)
  return { lc, lp: rest % 5, pb: Math.floor(rest / 5) }
}

/** Parse the 5-byte LZMA properties (7z coder properties and the LZMA-alone header prefix). */
export function parseLzmaProperties(bytes: Uint8Array): LzmaProperties {
  if (bytes.byteLength < 5) throw corrupt('properties are truncated')
  const dictionarySize =
    ((bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8) | ((bytes[3] ?? 0) << 16)) +
    (bytes[4] ?? 0) * 0x1000000
  return { ...lzmaPropertiesFromByte(bytes[0] ?? 0), dictionarySize: Math.max(dictionarySize, 1) }
}

/** LZMA2 one-byte dictionary property (0..40) to a byte count. */
export function lzma2DictionarySize(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 40) {
    throw corrupt('LZMA2 dictionary property is invalid')
  }
  if (value === 40) return 0xffffffff
  return (2 | (value & 1)) * 2 ** (Math.floor(value / 2) + 11)
}

class RangeDecoder {
  range = 0xffffffff
  code = 0
  private cursor: number

  constructor(
    private input: Uint8Array,
    start: number,
    private end: number,
  ) {
    if (end - start < 5) throw corrupt('range coder stream is truncated')
    this.cursor = start
    if (this.next() !== 0) throw corrupt('range coder has an invalid first byte')
    for (let index = 0; index < 4; index += 1) this.code = ((this.code << 8) | this.next()) >>> 0
  }

  get position(): number {
    return this.cursor
  }

  /** Input bytes not yet consumed. */
  get available(): number {
    return this.end - this.cursor
  }

  /** Continue the stream with the next chunk of input, dropping what is consumed. */
  feed(chunk: Uint8Array): void {
    const rest = this.input.subarray(this.cursor, this.end)
    const joined = new Uint8Array(rest.byteLength + chunk.byteLength)
    joined.set(rest)
    joined.set(chunk, rest.byteLength)
    this.input = joined
    this.cursor = 0
    this.end = joined.byteLength
  }

  private next(): number {
    if (this.cursor >= this.end) throw corrupt('compressed data is truncated')
    return this.input[this.cursor++] ?? 0
  }

  bit(probs: Uint16Array, index: number): number {
    const prob = probs[index] ?? 0
    const bound = Math.imul(this.range >>> 11, prob) >>> 0
    let bit: number
    if (this.code < bound) {
      this.range = bound
      probs[index] = prob + ((2048 - prob) >>> 5)
      bit = 0
    } else {
      this.range = (this.range - bound) >>> 0
      this.code = (this.code - bound) >>> 0
      probs[index] = prob - (prob >>> 5)
      bit = 1
    }
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.next()) >>> 0
    }
    return bit
  }

  tree(probs: Uint16Array, offset: number, levels: number): number {
    let symbol = 1
    for (let index = 0; index < levels; index += 1) {
      symbol = (symbol << 1) | this.bit(probs, offset + symbol)
    }
    return symbol - (1 << levels)
  }

  reverse(probs: Uint16Array, offset: number, levels: number): number {
    let symbol = 1
    let result = 0
    for (let index = 0; index < levels; index += 1) {
      const bit = this.bit(probs, offset + symbol)
      symbol = (symbol << 1) | bit
      result |= bit << index
    }
    return result >>> 0
  }

  direct(count: number): number {
    let result = 0
    for (let index = 0; index < count; index += 1) {
      this.range >>>= 1
      const bit = this.code >= this.range ? 1 : 0
      if (bit === 1) this.code = (this.code - this.range) >>> 0
      result = ((result << 1) | bit) >>> 0
      if (this.range < TOP) {
        this.range = (this.range << 8) >>> 0
        this.code = ((this.code << 8) | this.next()) >>> 0
      }
    }
    return result
  }
}

/** Length decoder layout: choice(2) low(16*8) mid(16*8) high(256). */
const LEN_LOW = 2
const LEN_MID = LEN_LOW + POS_STATES_MAX * 8
const LEN_HIGH = LEN_MID + POS_STATES_MAX * 8
const LEN_SIZE = LEN_HIGH + 256

function decodeLength(rc: RangeDecoder, probs: Uint16Array, posState: number): number {
  if (rc.bit(probs, 0) === 0) return rc.tree(probs, LEN_LOW + posState * 8, 3)
  if (rc.bit(probs, 1) === 0) return 8 + rc.tree(probs, LEN_MID + posState * 8, 3)
  return 16 + rc.tree(probs, LEN_HIGH, 8)
}

/** One LZMA decoder state over a flat output buffer; LZMA2 drives it chunk by chunk. */
class LzmaState {
  private lc = 0
  private lp = 0
  private pb = 0
  private literal = new Uint16Array(0)
  private readonly isMatch = new Uint16Array(STATES << 4)
  private readonly isRep = new Uint16Array(STATES)
  private readonly isRepG0 = new Uint16Array(STATES)
  private readonly isRepG1 = new Uint16Array(STATES)
  private readonly isRepG2 = new Uint16Array(STATES)
  private readonly isRep0Long = new Uint16Array(STATES << 4)
  private readonly slots = new Uint16Array(4 << 6)
  private readonly distances = new Uint16Array(DIST_MODELS)
  private readonly align = new Uint16Array(16)
  private readonly matchLength = new Uint16Array(LEN_SIZE)
  private readonly repLength = new Uint16Array(LEN_SIZE)
  private state = 0
  private reps = [0, 0, 0, 0]
  /** Bytes of a match cut off at a soft end, copied first by the next call. */
  private pending = 0
  /** An end marker was decoded. */
  ended = false
  /**
   * Output offset where the current dictionary starts (LZMA2 dictionary resets move it). A sliding
   * window moves it below zero; the window still holds `dictionarySize` bytes behind the position.
   */
  dictionaryStart = 0

  constructor(
    readonly output: Uint8Array,
    public dictionarySize: number,
  ) {}

  setProperties(props: Pick<LzmaProperties, 'lc' | 'lp' | 'pb'>): void {
    if (props.pb > 4) throw corrupt('position bits property is invalid')
    this.lc = props.lc
    this.lp = props.lp
    this.pb = props.pb
    const size = 0x300 << (props.lc + props.lp)
    if (this.literal.length !== size) this.literal = new Uint16Array(size)
  }

  reset(): void {
    for (const probs of [
      this.literal,
      this.isMatch,
      this.isRep,
      this.isRepG0,
      this.isRepG1,
      this.isRepG2,
      this.isRep0Long,
      this.slots,
      this.distances,
      this.align,
      this.matchLength,
      this.repLength,
    ]) {
      probs.fill(PROB_INIT)
    }
    this.state = 0
    this.reps = [0, 0, 0, 0]
  }

  /**
   * Decode from `rc` until `end` output bytes exist. An end marker is accepted only when
   * `allowEndMarker` is set, and then decoding stops early; the return value is the new position.
   * A stream decoder stops early too while fewer than `inputMargin` input bytes remain, and passes
   * `softEnd` when `end` is only the end of its window: a match crossing it continues next call.
   */
  decode(
    rc: RangeDecoder,
    position: number,
    end: number,
    allowEndMarker: boolean,
    inputMargin = 0,
    softEnd = false,
  ): number {
    const out = this.output
    const posMask = (1 << this.pb) - 1
    const lpMask = (1 << this.lp) - 1
    const lc = this.lc
    const literal = this.literal
    let state = this.state
    let [rep0, rep1, rep2, rep3] = this.reps as [number, number, number, number]
    let pos = position
    if (this.pending > 0) {
      if (!softEnd && this.pending > end - pos)
        throw corrupt('match exceeds the declared output size')
      const length = Math.min(this.pending, end - pos)
      for (let from = pos - rep0 - 1, index = 0; index < length; index += 1)
        out[pos++] = out[from++] ?? 0
      this.pending -= length
    }
    // Position contexts count from the last dictionary reset, as LzmaDec's processedPos does.
    const origin = this.dictionaryStart
    while (pos < end && rc.available >= inputMargin) {
      const posState = (pos - origin) & posMask
      if (rc.bit(this.isMatch, (state << 4) + posState) === 0) {
        const previous = pos > origin ? (out[pos - 1] ?? 0) : 0
        const base = 0x300 * ((((pos - origin) & lpMask) << lc) + (previous >>> (8 - lc)))
        let symbol = 1
        if (state >= 7) {
          const back = pos - rep0 - 1
          if (back < this.dictionaryStart) throw corrupt('literal match distance is invalid')
          let matchByte = out[back] ?? 0
          while (symbol < 0x100) {
            const matchBit = (matchByte >>> 7) & 1
            matchByte <<= 1
            const bit = rc.bit(literal, base + ((1 + matchBit) << 8) + symbol)
            symbol = (symbol << 1) | bit
            if (matchBit !== bit) break
          }
        }
        while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literal, base + symbol)
        out[pos++] = symbol & 0xff
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
        continue
      }

      let length: number
      if (rc.bit(this.isRep, state) !== 0) {
        if (pos === this.dictionaryStart) throw corrupt('repeat match precedes any output')
        if (rc.bit(this.isRepG0, state) === 0) {
          if (rc.bit(this.isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11
            const back = pos - rep0 - 1
            if (back < this.dictionaryStart) throw corrupt('short repeat distance is invalid')
            out[pos] = out[back] ?? 0
            pos += 1
            continue
          }
        } else {
          let distance: number
          if (rc.bit(this.isRepG1, state) === 0) distance = rep1
          else {
            if (rc.bit(this.isRepG2, state) === 0) distance = rep2
            else {
              distance = rep3
              rep3 = rep2
            }
            rep2 = rep1
          }
          rep1 = rep0
          rep0 = distance
        }
        length = decodeLength(rc, this.repLength, posState) + 2
        state = state < 7 ? 8 : 11
      } else {
        rep3 = rep2
        rep2 = rep1
        rep1 = rep0
        length = decodeLength(rc, this.matchLength, posState) + 2
        state = state < 7 ? 7 : 10
        const lengthState = Math.min(length - 2, 3)
        const slot = rc.tree(this.slots, lengthState << 6, 6)
        if (slot < 4) rep0 = slot
        else {
          const direct = (slot >>> 1) - 1
          rep0 = ((2 | (slot & 1)) << direct) >>> 0
          if (slot < 14) {
            rep0 = (rep0 + rc.reverse(this.distances, rep0 - slot - 1, direct)) >>> 0
          } else {
            rep0 = (rep0 + ((rc.direct(direct - 4) << 4) >>> 0)) >>> 0
            rep0 = (rep0 + rc.reverse(this.align, 0, 4)) >>> 0
            if (rep0 === 0xffffffff) {
              if (!allowEndMarker) throw corrupt('end marker precedes the declared output size')
              this.ended = true
              break
            }
          }
        }
      }

      if (rep0 >= pos - this.dictionaryStart || rep0 >= this.dictionarySize) {
        throw corrupt('match distance is invalid')
      }
      if (length > end - pos) {
        if (!softEnd) throw corrupt('match exceeds the declared output size')
        this.pending = length - (end - pos)
        length = end - pos
      }
      let from = pos - rep0 - 1
      if (rep0 + 1 >= length) {
        out.copyWithin(pos, from, from + length)
        pos += length
      } else {
        for (let index = 0; index < length; index += 1) out[pos++] = out[from++] ?? 0
      }
    }
    this.state = state
    this.reps = [rep0, rep1, rep2, rep3]
    return pos
  }
}

export interface LzmaDecodeOptions {
  /** Exact decoded size; the caller has already checked it against its budget. */
  readonly outputSize: number
  /** Accept (and stop at) an end-of-stream marker before `outputSize`. Default false. */
  readonly allowEndMarker?: boolean
}

function checkOutputSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('LZMA output size is invalid')
}

/** Decode raw LZMA data (no header) with separately supplied properties, e.g. a 7z LZMA coder. */
export function lzmaDecode(
  input: Uint8Array,
  properties: LzmaProperties,
  options: LzmaDecodeOptions,
): Uint8Array {
  checkOutputSize(options.outputSize)
  const output = new Uint8Array(options.outputSize)
  if (options.outputSize === 0) return output
  const decoder = new LzmaState(output, properties.dictionarySize)
  decoder.setProperties(properties)
  decoder.reset()
  const rc = new RangeDecoder(input, 0, input.byteLength)
  const produced = decoder.decode(rc, 0, output.byteLength, options.allowEndMarker === true)
  return produced === output.byteLength ? output : output.slice(0, produced)
}

/** LZMA2 chunk rules over one decoder; the whole-buffer and stream decoders feed it chunks. */
class Lzma2Chunks {
  private needDictionaryReset = true
  private needProperties = true

  constructor(readonly decoder: LzmaState) {}

  /** Header bytes after the control byte: 2 stored, 4 LZMA, plus a properties byte on reset ≥ 2. */
  static headerLength(control: number): number {
    if (control < 0x80) {
      if (control > 2) throw corrupt('LZMA2 control byte is invalid')
      return 2
    }
    return ((control >>> 5) & 3) >= 2 ? 5 : 4
  }

  /** Output and input bytes the chunk declares. */
  static sizes(control: number, header: Uint8Array): { unpacked: number; packed: number } {
    const first = (((header[0] ?? 0) << 8) | (header[1] ?? 0)) + 1
    if (control < 0x80) return { unpacked: first, packed: first }
    return {
      unpacked: ((control & 0x1f) << 16) + first,
      packed: (((header[2] ?? 0) << 8) | (header[3] ?? 0)) + 1,
    }
  }

  /** Decode one chunk at `position` of the decoder's output; the caller checked the room. */
  apply(control: number, header: Uint8Array, data: Uint8Array, position: number): number {
    const decoder = this.decoder
    const reset = control < 0x80 ? (control === 1 ? 3 : 0) : (control >>> 5) & 3
    if (reset === 3) {
      decoder.dictionaryStart = position
      this.needDictionaryReset = false
    } else if (this.needDictionaryReset) throw corrupt('LZMA2 stream lacks a dictionary reset')
    if (control < 0x80) {
      decoder.output.set(data, position)
      return position + data.byteLength
    }
    if (reset >= 2) {
      const props = lzmaPropertiesFromByte(header[4] ?? 0)
      if (props.lc + props.lp > 4) throw corrupt('LZMA2 lc+lp exceeds 4')
      decoder.setProperties(props)
      this.needProperties = false
    } else if (this.needProperties) throw corrupt('LZMA2 chunk lacks properties')
    if (reset >= 1) decoder.reset()
    const rc = new RangeDecoder(data, 0, data.byteLength)
    const end = position + Lzma2Chunks.sizes(control, header).unpacked
    if (decoder.decode(rc, position, end, false) !== end) throw corrupt('LZMA2 chunk decoded short')
    if (rc.position !== data.byteLength) throw corrupt('LZMA2 chunk size disagrees with its data')
    return end
  }
}

/** Decode an LZMA2 chunk stream (xz filter 0x21, 7z method 21) into exactly `outputSize` bytes. */
export function lzma2Decode(
  input: Uint8Array,
  dictionarySize: number,
  options: Pick<LzmaDecodeOptions, 'outputSize'>,
): Uint8Array {
  checkOutputSize(options.outputSize)
  const output = new Uint8Array(options.outputSize)
  const chunks = new Lzma2Chunks(new LzmaState(output, dictionarySize))
  let cursor = 0
  let position = 0
  for (;;) {
    if (cursor >= input.byteLength) throw corrupt('LZMA2 end marker is missing')
    const control = input[cursor++] ?? 0
    if (control === 0) break
    const headerLength = Lzma2Chunks.headerLength(control)
    if (cursor + headerLength > input.byteLength) throw corrupt('LZMA2 chunk header is truncated')
    const header = input.subarray(cursor, cursor + headerLength)
    cursor += headerLength
    const { unpacked, packed } = Lzma2Chunks.sizes(control, header)
    if (cursor + packed > input.byteLength) throw corrupt('LZMA2 chunk is truncated')
    if (unpacked > output.byteLength - position) throw corrupt('LZMA2 output exceeds its size')
    position = chunks.apply(control, header, input.subarray(cursor, cursor + packed), position)
    cursor += packed
  }
  if (position !== output.byteLength) throw corrupt('LZMA2 decoded size is invalid')
  return output
}

/** Output bytes a stream decoder yields at a time. */
const STREAM_CHUNK = 1 << 20
/** An LZMA symbol consumes at most ~48 range-coder bytes; below this the decoder asks for input. */
const SYMBOL_INPUT_MARGIN = 64
/** Largest LZMA2 chunk output: 21 bits of size. */
const LZMA2_CHUNK_MAX = 1 << 21

export interface LzmaStreamOptions {
  /** Exact decoded size; it may exceed any single allocation the caller allows. */
  readonly outputSize: number
  /**
   * Largest dictionary window the caller allows to be allocated. The window is the declared
   * dictionary (never more than `outputSize`) plus a fixed chunk of slack; a larger one is refused.
   */
  readonly maxDictionaryBytes: number
}

/**
 * The output of a stream decoder: the last `keep` bytes (the dictionary) and room after them.
 * When the room is used up the window slides back, keeping the dictionary behind the position.
 */
class OutputWindow {
  readonly buffer: Uint8Array
  flushed = 0
  /** Output bytes that slid out of the window. */
  base = 0

  constructor(
    private readonly keep: number,
    slack: number,
  ) {
    this.buffer = new Uint8Array(keep + slack)
  }

  /** The bytes decoded since the last take, in a buffer of their own. */
  take(position: number): Uint8Array {
    const out = this.buffer.slice(this.flushed, position)
    this.flushed = position
    return out
  }

  /** Slide back once everything up to `position` was taken; returns how far it moved. */
  slide(position: number): number {
    const shift = Math.max(0, position - this.keep)
    this.buffer.copyWithin(0, shift, position)
    this.flushed -= shift
    this.base += shift
    return shift
  }
}

function windowKeep(dictionarySize: number, options: LzmaStreamOptions): number {
  checkOutputSize(options.outputSize)
  const keep = Math.min(Math.max(dictionarySize, 1), options.outputSize)
  if (keep > options.maxDictionaryBytes) {
    throw new RangeError(
      `LZMA dictionary of ${keep} bytes exceeds the ${options.maxDictionaryBytes}-byte budget`,
    )
  }
  return keep
}

/** Pulls bytes off an async chunk iterator. */
class ChunkInput {
  private readonly iterator: AsyncIterator<Uint8Array>
  private buffered = new Uint8Array(0)
  done = false

  constructor(input: AsyncIterable<Uint8Array>) {
    this.iterator = input[Symbol.asyncIterator]()
  }

  async next(): Promise<Uint8Array | undefined> {
    if (this.done) return undefined
    const result = await this.iterator.next()
    if (result.done === true) this.done = true
    return result.done === true ? undefined : result.value
  }

  /** Exactly `length` bytes, or a truncation error. */
  async take(length: number, truncated: string): Promise<Uint8Array> {
    while (this.buffered.byteLength < length) {
      const chunk = await this.next()
      if (chunk === undefined) throw corrupt(truncated)
      const joined = new Uint8Array(this.buffered.byteLength + chunk.byteLength)
      joined.set(this.buffered)
      joined.set(chunk, this.buffered.byteLength)
      this.buffered = joined
    }
    const value = this.buffered.subarray(0, length)
    this.buffered = this.buffered.subarray(length)
    return value
  }

  /** What `take` pulled beyond the bytes it returned. */
  drain(): Uint8Array {
    const rest = this.buffered
    this.buffered = new Uint8Array(0)
    return rest
  }

  /** Stop the source early: the rest of it is not needed. */
  async close(): Promise<void> {
    if (!this.done) await this.iterator.return?.()
  }
}

/**
 * Decode raw LZMA data arriving in chunks, yielding the output in chunks of up to 1 MiB: memory is
 * the dictionary window, not the output. The stream ends early only at an end marker when
 * `allowEndMarker` is set; the caller compares the total it received.
 */
export async function* lzmaDecodeStream(
  input: AsyncIterable<Uint8Array>,
  properties: LzmaProperties,
  options: LzmaStreamOptions & Pick<LzmaDecodeOptions, 'allowEndMarker'>,
): AsyncGenerator<Uint8Array> {
  const keep = windowKeep(properties.dictionarySize, options)
  const source = new ChunkInput(input)
  try {
    if (options.outputSize === 0) return
    const window = new OutputWindow(keep, STREAM_CHUNK)
    const decoder = new LzmaState(window.buffer, properties.dictionarySize)
    decoder.setProperties(properties)
    decoder.reset()
    const rc = new RangeDecoder(await source.take(5, 'range coder stream is truncated'), 0, 5)
    rc.feed(source.drain())
    let position = 0
    while (window.base + position < options.outputSize && !decoder.ended) {
      while (!source.done && rc.available < SYMBOL_INPUT_MARGIN) {
        const chunk = await source.next()
        if (chunk !== undefined) rc.feed(chunk)
      }
      const remaining = options.outputSize - window.base - position
      const room = Math.min(
        window.buffer.byteLength - position,
        STREAM_CHUNK - (position - window.flushed),
      )
      const end = position + Math.min(remaining, room)
      position = decoder.decode(
        rc,
        position,
        end,
        options.allowEndMarker === true,
        source.done ? 0 : SYMBOL_INPUT_MARGIN,
        remaining > room,
      )
      if (position < end && !decoder.ended) continue
      if (position > window.flushed) yield window.take(position)
      if (position === window.buffer.byteLength) {
        const shift = window.slide(position)
        position -= shift
        decoder.dictionaryStart -= shift
      }
    }
  } finally {
    await source.close()
  }
}

/** Decode an LZMA2 chunk stream arriving in chunks, yielding its output as `lzmaDecodeStream`. */
export async function* lzma2DecodeStream(
  input: AsyncIterable<Uint8Array>,
  dictionarySize: number,
  options: LzmaStreamOptions,
): AsyncGenerator<Uint8Array> {
  const keep = windowKeep(dictionarySize, options)
  const source = new ChunkInput(input)
  try {
    const window = new OutputWindow(keep, LZMA2_CHUNK_MAX)
    const decoder = new LzmaState(window.buffer, dictionarySize)
    const chunks = new Lzma2Chunks(decoder)
    let position = 0
    for (;;) {
      const control = (await source.take(1, 'LZMA2 end marker is missing'))[0] ?? 0
      if (control === 0) break
      const header = await source.take(
        Lzma2Chunks.headerLength(control),
        'LZMA2 chunk header is truncated',
      )
      const { unpacked, packed } = Lzma2Chunks.sizes(control, header)
      if (unpacked > options.outputSize - window.base - position) {
        throw corrupt('LZMA2 output exceeds its size')
      }
      const data = await source.take(packed, 'LZMA2 chunk is truncated')
      if (unpacked > window.buffer.byteLength - position) {
        if (position > window.flushed) yield window.take(position)
        const shift = window.slide(position)
        position -= shift
        decoder.dictionaryStart -= shift
      }
      position = chunks.apply(control, header, data, position)
      if (position - window.flushed >= STREAM_CHUNK) yield window.take(position)
    }
    if (position > window.flushed) yield window.take(position)
    if (window.base + position !== options.outputSize) {
      throw corrupt('LZMA2 decoded size is invalid')
    }
  } finally {
    await source.close()
  }
}

/** The x86 BCJ branch-call filter's state across buffers (XZ `simple/x86.c`, decoding). */
class BcjX86 {
  private prevMask = 0
  private prevPos = -5

  /**
   * Convert `buffer`, whose first byte is stream position `start`; returns how many bytes are
   * final. The rest (at most 4) needs the next buffer, or stays as is at the end of the stream.
   */
  convert(buffer: Uint8Array, start: number): number {
    const allowed = [true, true, true, false, true, false, false, false]
    const bitNumber = [0, 1, 2, 2, 3, 3, 3, 3]
    const msByte = (b: number) => b === 0 || b === 0xff
    let prevMask = this.prevMask
    let prevPos = this.prevPos
    if (start - prevPos > 5) prevPos = start - 5
    const limit = buffer.byteLength - 5
    let pos = 0
    while (pos <= limit) {
      let b = buffer[pos] ?? 0
      if (b !== 0xe8 && b !== 0xe9) {
        pos += 1
        continue
      }
      const offset = start + pos - prevPos
      prevPos = start + pos
      if (offset > 5) prevMask = 0
      else
        for (let index = 0; index < offset; index += 1) prevMask = ((prevMask & 0x77) << 1) & 0xff
      b = buffer[pos + 4] ?? 0
      if (msByte(b) && allowed[(prevMask >>> 1) & 7] === true && prevMask >>> 1 < 0x10) {
        let src =
          ((b << 24) |
            ((buffer[pos + 3] ?? 0) << 16) |
            ((buffer[pos + 2] ?? 0) << 8) |
            (buffer[pos + 1] ?? 0)) >>>
          0
        let dest: number
        for (;;) {
          dest = (src - (start + pos + 5)) >>> 0
          if (prevMask === 0) break
          const index = bitNumber[prevMask >>> 1] ?? 0
          b = (dest >>> (24 - index * 8)) & 0xff
          if (!msByte(b)) break
          src = (dest ^ (2 ** (32 - index * 8) - 1)) >>> 0
        }
        buffer[pos + 4] = ((dest >>> 24) & 1) === 0 ? 0 : 0xff
        buffer[pos + 3] = (dest >>> 16) & 0xff
        buffer[pos + 2] = (dest >>> 8) & 0xff
        buffer[pos + 1] = dest & 0xff
        pos += 5
        prevMask = 0
      } else {
        pos += 1
        prevMask |= 1
        if (msByte(b)) prevMask |= 0x10
      }
    }
    this.prevMask = prevMask
    this.prevPos = prevPos
    return Math.min(pos, buffer.byteLength)
  }
}

/** Reverse the x86 BCJ branch-call filter in place over a whole buffer (stream start = 0). */
export function bcjX86Decode(buffer: Uint8Array): Uint8Array {
  new BcjX86().convert(buffer, 0)
  return buffer
}

/** Reverse the x86 BCJ filter over a chunked stream; chunk boundaries do not change the result. */
export async function* bcjX86DecodeStream(
  input: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const filter = new BcjX86()
  let carry = new Uint8Array(0)
  let position = 0
  for await (const chunk of input) {
    const buffer = new Uint8Array(carry.byteLength + chunk.byteLength)
    buffer.set(carry)
    buffer.set(chunk, carry.byteLength)
    const done = filter.convert(buffer, position)
    position += done
    carry = buffer.slice(done)
    if (done > 0) yield buffer.subarray(0, done)
  }
  if (carry.byteLength > 0) yield carry
}

/** Decode 7-Zip BCJ2 from its main, call, jump and range-coded streams into `outputSize` bytes. */
export function bcj2Decode(
  main: Uint8Array,
  call: Uint8Array,
  jump: Uint8Array,
  rcStream: Uint8Array,
  outputSize: number,
): Uint8Array {
  checkOutputSize(outputSize)
  const output = new Uint8Array(outputSize)
  if (outputSize === 0) return output
  const probs = new Uint16Array(258).fill(PROB_INIT)
  const rc = new Bcj2Range(rcStream)
  let inPos = 0
  let outPos = 0
  let callPos = 0
  let jumpPos = 0
  let prev = 0
  const isJump = (b0: number, b1: number) =>
    (b1 & 0xfe) === 0xe8 || (b0 === 0x0f && (b1 & 0xf0) === 0x80)
  for (;;) {
    let found = false
    while (inPos < main.byteLength && outPos < outputSize) {
      const b = main[inPos++] ?? 0
      output[outPos++] = b
      if (isJump(prev, b)) {
        found = true
        prev = b
        break
      }
      prev = b
    }
    if (!found || outPos === outputSize) break
    const b = prev
    // E8 calls are modelled by the byte before the opcode (0 at stream start).
    const context = b === 0xe8 ? (output[outPos - 2] ?? 0) : b === 0xe9 ? 256 : 257
    if (rc.bit(probs, context) === 0) continue
    let source: Uint8Array
    let at: number
    if (b === 0xe8) {
      source = call
      at = callPos
      callPos += 4
    } else {
      source = jump
      at = jumpPos
      jumpPos += 4
    }
    if (at + 4 > source.byteLength) throw corrupt('BCJ2 branch stream is truncated')
    const absolute =
      (((source[at] ?? 0) << 24) |
        ((source[at + 1] ?? 0) << 16) |
        ((source[at + 2] ?? 0) << 8) |
        (source[at + 3] ?? 0)) >>>
      0
    const dest = (absolute - (outPos + 4)) >>> 0
    for (let shift = 0; shift < 32 && outPos < outputSize; shift += 8) {
      output[outPos++] = (dest >>> shift) & 0xff
    }
    prev = (dest >>> 24) & 0xff
  }
  if (outPos !== outputSize) throw corrupt('BCJ2 main stream is truncated')
  return output
}

class Bcj2Range {
  private range = 0xffffffff
  private code = 0
  private cursor = 0

  constructor(private readonly input: Uint8Array) {
    for (let index = 0; index < 5; index += 1) this.code = ((this.code << 8) | this.next()) >>> 0
  }

  private next(): number {
    if (this.cursor >= this.input.byteLength) throw corrupt('BCJ2 range stream is truncated')
    return this.input[this.cursor++] ?? 0
  }

  bit(probs: Uint16Array, index: number): number {
    const prob = probs[index] ?? 0
    const bound = Math.imul(this.range >>> 11, prob) >>> 0
    let bit: number
    if (this.code < bound) {
      this.range = bound
      probs[index] = prob + ((2048 - prob) >>> 5)
      bit = 0
    } else {
      this.range = (this.range - bound) >>> 0
      this.code = (this.code - bound) >>> 0
      probs[index] = prob - (prob >>> 5)
      bit = 1
    }
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.next()) >>> 0
    }
    return bit
  }
}
