/**
 * Bounded portable Granny Oodle1 decompressor (not modern Oodle).
 * Adapted from LunaticInAHat/liboodle, Unlicense, commit 7837c253f8ca505a3ba3cd8e35d8bc3f5ab76a30.
 * Three width streams share arithmetic input and output history; coder state resets per stream.
 * The decay gate uses the scheduled renormalization threshold, as the native decoder does.
 * No filesystem/native DLL, allocation above caller ceiling, or partial successful output.
 */
class Bits {
  private at = 1
  private register: number
  private low: number
  private modulus = 128
  constructor(private readonly input: Uint8Array) {
    if (!input.length) throw new RangeError('Oodle1 empty bitstream')
    this.register = input[0]! >>> 1
    this.low = input[0]! & 1
  }
  /** Ingest the native 7+1 split without signed JS bitwise overflow. */
  peek(one: number): number {
    if (!Number.isInteger(one) || one < 1 || one > 16384) throw new RangeError('Oodle1 alphabet')
    while (this.modulus <= 0x800000) {
      if (this.at >= this.input.length) throw new RangeError('Oodle1 truncated arithmetic stream')
      const b = this.input[this.at++]!
      this.register = (this.register * 2 + this.low) * 128 + (b >>> 1)
      this.low = b & 1
      this.modulus *= 256
    }
    return Math.min(Math.floor(this.register / Math.floor(this.modulus / one)), one - 1)
  }
  /** Consume a nonempty arithmetic interval; reject corrupted state before the next loop. */
  consume(min: number, span: number, one: number): void {
    const scale = Math.floor(this.modulus / one)
    if (span < 1 || min < 0 || min + span > one) throw new RangeError('Oodle1 interval')
    this.register -= min * scale
    this.modulus = min < one - span ? span * scale : this.modulus - min * scale
    if (this.register < 0 || this.modulus < 1) throw new RangeError('Oodle1 arithmetic state')
  }
  /** Read and consume a uniform symbol. */
  get(one: number): number { const z = this.peek(one); this.consume(z, 1, one); return z }
}

class Symbols {
  private readonly symbols: Uint16Array
  private readonly weights: Uint32Array
  private readonly occurrences: Uint32Array
  private total = 4
  private learned = 0
  private normalized = 0
  private next = 8
  private rapid = 4
  private readonly decayThreshold: number
  private readonly interval: number
  constructor(alphabet: number, private readonly used: number) {
    if (alphabet < 1 || alphabet > 16384 || used < 0 || used > alphabet) throw new RangeError('Oodle1 symbol header')
    this.symbols = new Uint16Array(alphabet + 2)
    this.weights = new Uint32Array(alphabet + 2).fill(16384)
    this.occurrences = new Uint32Array(alphabet + 2)
    this.weights[0] = 0; this.occurrences[0] = 4
    this.decayThreshold = Math.max(256, Math.min((alphabet - 1) * 32, 15160))
    this.interval = Math.max(128, Math.min((alphabet - 1) * 2, this.decayThreshold / 2 - 32))
  }
  /** Halve learned frequencies, pruning exhausted symbols and preserving native swap order. */
  private decay(): void {
    this.occurrences[0] = this.occurrences[0]! >>> 1
    this.total = this.occurrences[0]!
    let highest = 0, slot = 0
    for (let i = 1; i <= this.learned; i++) {
      while (this.occurrences[i]! <= 1) {
        if (i >= this.learned) { this.occurrences[i] = 0; this.learned--; break }
        this.occurrences[i] = this.occurrences[this.learned]!
        this.occurrences[this.learned] = 0
        this.symbols[i] = this.symbols[this.learned--]!
      }
      if (!this.occurrences[i]) break
      this.occurrences[i] = this.occurrences[i]! >>> 1
      this.total += this.occurrences[i]!
      if (this.occurrences[i]! > highest) { highest = this.occurrences[i]!; slot = i }
    }
    if (highest && slot !== this.learned) {
      ;[this.occurrences[this.learned], this.occurrences[slot]] = [this.occurrences[slot]!, this.occurrences[this.learned]!];
      [this.symbols[this.learned], this.symbols[slot]] = [this.symbols[slot]!, this.symbols[this.learned]!]
    }
    if (this.learned !== this.used && !this.occurrences[0]) { this.occurrences[0] = 1; this.total++ }
    this.weights.fill(16384, this.learned + 1)
  }
  /** Rebuild quantized spans with integer divisions and the native rapid-renormalize schedule. */
  private renormalize(): void {
    const quanta = Math.floor(0x20000 / this.total)
    let accumulator = Math.floor(this.occurrences[0]! * quanta / 8)
    this.weights[0] = 0
    for (let i = 1; i <= this.learned; i++) {
      this.weights[i] = accumulator
      accumulator += Math.floor(this.occurrences[i]! * quanta / 8)
    }
    if (this.rapid * 2 < this.interval) this.rapid *= 2
    else this.rapid = this.interval
    this.next = this.total + this.rapid
    this.normalized = this.learned
    this.weights.fill(16384, this.learned + 1)
  }
  /** Decode a learned/probationary/new symbol; stream-dependent alphabet affects only new symbols. */
  decode(bits: Bits, alphabet: number): number {
    if (this.total >= this.next) {
      if (this.next >= this.decayThreshold) this.decay()
      this.renormalize()
    }
    const z = bits.peek(16384)
    let index = 0
    while (index <= this.normalized && this.weights[index + 1]! <= z) index++
    bits.consume(this.weights[index]!, this.weights[index + 1]! - this.weights[index]!, 16384)
    this.occurrences[index] = this.occurrences[index]! + 1; this.total++
    if (index) return this.symbols[index]!
    if (this.learned !== this.normalized && bits.get(2)) {
      index = bits.get(this.learned - this.normalized) + this.normalized + 1
      this.occurrences[index] = this.occurrences[index]! + 2; this.total += 2
      return this.symbols[index]!
    }
    if (this.learned >= this.symbols.length - 2) throw new RangeError('Oodle1 learned-symbol overflow')
    const symbol = bits.get(alphabet)
    this.symbols[++this.learned] = symbol
    this.occurrences[this.learned] = this.occurrences[this.learned]! + 2; this.total += 2
    if (this.learned === this.used) { this.total -= this.occurrences[0]!; this.occurrences[0] = 0 }
    return symbol
  }
}

/** Decode exactly the declared three output ranges, with shared history and bounded allocation. */
export function decompressOodle1(input: Uint8Array, size: number, stop0: number, stop1: number,
  maxBytes: number, signal?: AbortSignal): Uint8Array {
  signal?.throwIfAborted()
  if (![size, stop0, stop1, maxBytes].every(Number.isSafeInteger) || stop0 < 0 || stop1 < stop0 || size < stop1 ||
    size > maxBytes || maxBytes < 0 || input.length < 37) throw new RangeError('Oodle1 size/header budget')
  if (size === 0) return new Uint8Array()
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const bits = new Bits(input.subarray(36)), output = new Uint8Array(size)
  let out = 0, allocated = size
  for (const [stream, end] of [stop0, stop1, size].entries()) {
    if (out === end) continue
    const h0 = view.getUint32(stream * 12, true), h1 = view.getUint32(stream * 12 + 4, true)
    const h2 = view.getUint32(stream * 12 + 8, true), window = h0 >>> 9, literals = h0 & 511
    if (literals > 256 || window > 0x7fffff) throw new RangeError('Oodle1 header bounds')
    const off1Size = Math.min(4, window + 1), off4Size = Math.min(256, Math.floor(window / 4) + 1)
    const off1kSize = Math.floor(window / 1024) + 1
    // Charge all typed model allocations before constructing any of them, including later streams.
    allocated += 10 * (4 * (literals + 2) + 65 * 67 + off1Size + 2 + off1kSize * (off4Size + 2) + off1kSize + 2)
    if (allocated > maxBytes) throw new RangeError('Oodle1 adaptive model workspace budget')
    const lit = Array.from({ length: 4 }, () => new Symbols(literals, h1 & 511))
    const lengths = Array.from({ length: 65 }, (_, i) => new Symbols(65, i === 64 ? 0 : (h2 >>> (24 - Math.floor(i / 16) * 8)) & 255))
    const off1 = new Symbols(off1Size, off1Size)
    const off4 = Array.from({ length: Math.floor(window / 1024) + 1 }, () => new Symbols(off4Size, off4Size))
    const off1k = new Symbols(Math.floor(window / 1024) + 1, (h1 >>> 19) + 1)
    let produced = 0, last = 0
    while (out < end) {
      if ((produced & 4095) === 0) signal?.throwIfAborted()
      last = lengths[last]!.decode(bits, 65)
      if (last === 0) { output[out++] = lit[produced & 3]!.decode(bits, literals); produced++; continue }
      const length = last <= 60 ? last + 1 : [128, 192, 256, 512][last - 61]
      if (length === undefined || out + length > end) throw new RangeError('Oodle1 repeat crosses output bound')
      const effective = Math.min(window, produced)
      const byte = off1.decode(bits, off1Size) + 1
      const kilo = off1k.decode(bits, Math.floor(effective / 1024) + 1)
      const quad = off4[kilo]?.decode(bits, Math.min(256, Math.floor(effective / 4) + 1))
      if (quad === undefined) throw new RangeError('Oodle1 repeat alphabet')
      const offset = kilo * 1024 + quad * 4 + byte
      if (offset > out) throw new RangeError('Oodle1 repeat before output history')
      for (let i = 0; i < length; i++) { output[out] = output[out - offset]!; out++ }
      produced += length
    }
  }
  signal?.throwIfAborted()
  return output
}
