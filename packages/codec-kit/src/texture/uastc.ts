/**
 * UASTC LDR 4x4 (Basis Universal's transcodable block format; KTX2 colour model 166) decoded to
 * RGBA8. Written from the UASTC texture specification (Binomial LLC, Apache-2.0), whose tables of
 * mode prefix codes, per-mode parameters, partition patterns and ASTC endpoint quantisation are
 * reproduced here as data.
 *
 * A block is 128 bits read least significant first: a mode from a prefix code in the low seven bits,
 * hint bits a transcoder to BC1/ETC uses (skipped here), the partition pattern, the dual-plane
 * channel, ASTC-quantised endpoints (raw low bits plus base-3 or base-5 digits packed in bundles
 * ahead of them), then plain weights where each subset's first texel drops its top bit. Texels are
 * interpolated as ASTC LDR does in its linear decode mode, which is what the reference transcoder
 * writes for RGBA32 output.
 */

/** [prefix code, code length] per mode; 19 modes, one more code is reserved. */
const MODE_CODES: readonly (readonly [number, number])[] = [
  [0x01, 4], [0x35, 6], [0x1d, 5], [0x03, 5], [0x13, 5], [0x0b, 5], [0x1b, 5], [0x07, 5],
  [0x17, 5], [0x0f, 5], [0x02, 3], [0x00, 2], [0x06, 3], [0x1f, 5], [0x0d, 5], [0x05, 7],
  [0x15, 6], [0x25, 6], [0x09, 4],
]
const MODE_BY_PREFIX = (() => {
  const table = new Uint8Array(128).fill(255)
  MODE_CODES.forEach(([code, length], mode) => {
    for (let high = 0; high < 1 << (7 - length); high += 1) table[code | (high << length)] = mode
  })
  return table
})()
const SOLID_MODE = 8
const WEIGHT_BITS = [4, 2, 3, 2, 2, 3, 2, 2, 0, 2, 4, 2, 3, 1, 2, 4, 2, 2, 5]
const ENDPOINT_RANGE = [19, 20, 8, 7, 12, 20, 18, 12, 0, 8, 13, 13, 19, 20, 20, 20, 20, 20, 11]
const SUBSETS = [1, 1, 2, 3, 2, 1, 1, 2, 0, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1]
const COMPONENTS = [3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 3]
const HINT_BITS = [15, 15, 15, 15, 15, 15, 15, 15, 0, 23, 17, 17, 17, 23, 23, 23, 23, 23, 15]

/** 2-subset patterns shared by ASTC and BC7 (modes 2, 4, 9, 16), texels row-major. */
const PATTERNS2 = [
  '0011001100110011', '0001000100010001', '1000100010001000', '0001001100110111',
  '1111111011101100', '0011011101111111', '1110110010000000', '1111111011001000',
  '0000000000010011', '1100100000000000', '0000000101111111', '1111111111101000',
  '1110100000000000', '1111111100000000', '0000111111111111', '1111111111110000',
  '1000111011111111', '1111111101110001', '0111001100010000', '0011000100000000',
  '0000100011001110', '1111111101110011', '1000110011001110', '0011000100010000',
  '1111011101110011', '0110011001100110', '1111000000001111', '1010101010101010',
  '1111000011110000', '1001001101101100',
].map(pattern => Uint8Array.from(pattern, digit => Number(digit)))
/** 3-subset patterns shared by ASTC and BC7 (mode 3). */
const PATTERNS3 = [
  '0000000011221122', '1111111100002222', '1111000000002222', '1111222200000000',
  '1120112011201120', '0112011201120112', '0211021102110211', '2000200021112111',
  '2012201220122012', '1111000022221111', '0022001100110022',
].map(pattern => Uint8Array.from(pattern, digit => Number(digit)))
/** 2-subset ASTC patterns that stand for 3-subset BC7 ones (mode 7). */
const PATTERNS2_FROM_BC7_3 = [
  '0000111100000000', '0010001000100010', '1100110010000000', '0000000100110011',
  '1111111100001111', '0100010001000100', '0001001111111111', '0111001100110011',
  '1100000000111100', '0111011100000000', '0000000011101110', '1100000000001100',
  '0111001100000000', '0000000111111111', '1111111111110110', '1100110011001000',
  '1111111110001000', '0011011011001000', '1111011100000000',
].map(pattern => Uint8Array.from(pattern, digit => Number(digit)))
const NO_PATTERN = new Uint8Array(16)

/** ASTC integer sequence ranges: [bits, trits, quints] per range index. */
const RANGES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [0, 1, 0], [2, 0, 0], [0, 0, 1], [1, 1, 0], [3, 0, 0], [1, 0, 1], [2, 1, 0],
  [4, 0, 0], [2, 0, 1], [3, 1, 0], [5, 0, 0], [3, 0, 1], [4, 1, 0], [6, 0, 0], [4, 0, 1],
  [5, 1, 0], [7, 0, 0], [5, 0, 1], [6, 1, 0], [8, 0, 0],
]
/**
 * ASTC endpoint unquantisation for trit and quint ranges: the bit-swizzle of `B` (9 characters, a
 * letter names that bit of the raw value) and the multiplier `C`.
 */
const UNQUANTISE: readonly (readonly [string, number] | undefined)[] = [
  undefined, undefined, undefined, undefined, ['000000000', 204], undefined, ['000000000', 113],
  ['b000b0bb0', 93], undefined, ['b0000bb00', 54], ['cb000cbcb', 44], undefined,
  ['cb0000cbc', 26], ['dcb000dcb', 22], undefined, ['dcb0000dc', 13], ['edcb000ed', 11],
  undefined, ['edcb0000e', 6], ['fedcb000f', 5], undefined,
]

function unquantiseEndpoint(value: number, range: number): number {
  const [bits, trits, quints] = RANGES[range]!
  if (trits === 0 && quints === 0) {
    // Bit replication up to eight bits.
    let result = 0
    let left = 8
    while (left > 0) {
      const take = Math.min(left, bits)
      result |= (value >>> (bits - take)) << (left - take)
      left -= take
    }
    return result
  }
  const low = value & ((1 << bits) - 1)
  const digit = value >>> bits
  const [swizzle, multiplier] = UNQUANTISE[range]!
  const a = (low & 1) !== 0 ? 511 : 0
  let b = 0
  for (const character of swizzle) {
    b <<= 1
    if (character !== '0') b |= (low >>> (character.charCodeAt(0) - 97)) & 1
  }
  const mixed = (digit * multiplier + b) ^ a
  return (a & 0x80) | (mixed >>> 2)
}

/**
 * Unquantised endpoint per packed value. A trit or quint bundle past its largest valid value packs a
 * digit out of range; such values read as 0, as in the reference decoder's zero-filled table.
 */
const ENDPOINT_TABLES = RANGES.map((_, range) => {
  const [bits, trits, quints] = RANGES[range]!
  if ((trits !== 0 || quints !== 0) && UNQUANTISE[range] === undefined) return undefined
  const levels = (1 + 2 * trits + 4 * quints) << bits
  return Uint8Array.from({ length: 256 }, (_, value) =>
    value < levels ? unquantiseEndpoint(value, range) : 0,
  )
})

/** Interpolation weights (out of 64) per weight bit count. */
const WEIGHTS: readonly (readonly number[])[] = [
  [],
  [0, 64],
  [0, 21, 43, 64],
  [0, 9, 18, 27, 37, 46, 55, 64],
  [0, 4, 8, 12, 17, 21, 25, 29, 35, 39, 43, 47, 52, 56, 60, 64],
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64],
]

function interpolate(low: number, high: number, weight: number): number {
  const l = (low << 8) | low
  const h = (high << 8) | high
  return ((l * (64 - weight) + h * weight + 32) >>> 6) >>> 8
}

/** Reads the block's bits least significant first. */
class BlockBits {
  readonly #bytes: Uint8Array
  readonly #offset: number
  #position: number
  constructor(bytes: Uint8Array, offset: number, position: number) {
    this.#bytes = bytes
    this.#offset = offset
    this.#position = position
  }
  read(count: number): number {
    let value = 0
    for (let bit = 0; bit < count; bit += 1) {
      const at = this.#position + bit
      value |= ((this.#bytes[this.#offset + (at >>> 3)]! >>> (at & 7)) & 1) << bit
    }
    this.#position += count
    return value >>> 0
  }
  skip(count: number): void {
    this.#position += count
  }
}

/**
 * Decode one 16-byte UASTC block at `offset` into 16 RGBA8 texels (row-major) in `out` from
 * `outOffset`. Returns false for a reserved mode or pattern; the texels are then left untouched.
 */
export function decodeUastcBlock(
  bytes: Uint8Array,
  offset: number,
  out: Uint8Array,
  outOffset = 0,
): boolean {
  if (offset < 0 || offset + 16 > bytes.byteLength) throw new RangeError('UASTC block is truncated')
  const mode = MODE_BY_PREFIX[bytes[offset]! & 127]!
  if (mode === 255) return false
  const reader = new BlockBits(bytes, offset, MODE_CODES[mode]![1])
  if (mode === SOLID_MODE) {
    const colour = [reader.read(8), reader.read(8), reader.read(8), reader.read(8)]
    for (let texel = 0; texel < 16; texel += 1) out.set(colour, outOffset + texel * 4)
    return true
  }
  reader.skip(HINT_BITS[mode]!)
  let subsets = 1
  let patternIndex = 0
  if (mode === 2 || mode === 4 || mode === 7 || mode === 9 || mode === 16) {
    patternIndex = reader.read(5)
    subsets = 2
  } else if (mode === 3) {
    patternIndex = reader.read(4)
    subsets = 3
  }
  const pattern =
    subsets === 1
      ? NO_PATTERN
      : subsets === 3
        ? PATTERNS3[patternIndex]
        : mode === 7
          ? PATTERNS2_FROM_BC7_3[patternIndex]
          : PATTERNS2[patternIndex]
  if (pattern === undefined) return false
  let planes = 1
  let dualChannel = -1
  if (mode === 6 || mode === 11 || mode === 13) {
    dualChannel = reader.read(2)
    planes = 2
  } else if (mode === 17) {
    dualChannel = 3
    planes = 2
  }
  const components = COMPONENTS[mode]!
  const range = ENDPOINT_RANGE[mode]!
  const [bits, trits, quints] = RANGES[range]!
  const values = components * 2 * subsets
  // Base-3 digits come five to a bundle (8 bits), base-5 ones three to a bundle (7 bits); a last,
  // partial bundle is shorter. All bundles precede the raw endpoint bits.
  const bundleSize = trits !== 0 ? 5 : quints !== 0 ? 3 : 0
  const bundles: number[] = []
  if (bundleSize !== 0) {
    const count = Math.ceil(values / bundleSize)
    for (let bundle = 0; bundle < count; bundle += 1) {
      let length = trits !== 0 ? 8 : 7
      if (bundle === count - 1) {
        const remaining = values - bundle * bundleSize
        length =
          trits !== 0
            ? ([0, 2, 4, 5, 7, 8][remaining] ?? 8)
            : ([0, 3, 5, 7][remaining] ?? 7)
      }
      bundles.push(reader.read(length))
    }
  }
  const radix = trits !== 0 ? 3 : 5
  const endpoints = new Uint8Array(values)
  let digits = 0
  let digitsLeft = 0
  let nextBundle = 0
  for (let index = 0; index < values; index += 1) {
    let value = reader.read(bits)
    if (bundleSize !== 0) {
      if (digitsLeft === 0) {
        digits = bundles[nextBundle++]!
        digitsLeft = bundleSize
      }
      value |= (digits % radix) << bits
      digits = Math.floor(digits / radix)
      digitsLeft -= 1
    }
    endpoints[index] = value
  }
  const weightBits = WEIGHT_BITS[mode]!
  const anchors: number[] = []
  for (let subset = 0; subset < subsets; subset += 1) anchors.push(pattern.indexOf(subset))
  const weights = new Uint8Array(16 * planes)
  if (planes === 2) {
    // Dual plane: one subset; the first texel's two weights are its anchors.
    for (let index = 0; index < 32; index += 1)
      weights[index] = reader.read(index < 2 ? weightBits - 1 : weightBits)
  } else {
    for (let texel = 0; texel < 16; texel += 1)
      weights[texel] = reader.read(anchors.includes(texel) ? weightBits - 1 : weightBits)
  }
  const table = ENDPOINT_TABLES[range]
  if (table === undefined) return false
  const levelWeights = WEIGHTS[weightBits]!
  const levels = 1 << weightBits
  // Colours per subset and weight level: [subset][level][channel].
  const palette = new Uint8Array(subsets * levels * 4)
  for (let subset = 0; subset < subsets; subset += 1) {
    const base = subset * components * 2
    const endpoint = (channel: number, end: number) => table[endpoints[base + channel * 2 + end]!]!
    for (let level = 0; level < levels; level += 1) {
      const at = (subset * levels + level) * 4
      const weight = levelWeights[level]!
      if (components === 2) {
        const luminance = interpolate(endpoint(0, 0), endpoint(0, 1), weight)
        palette[at] = luminance
        palette[at + 1] = luminance
        palette[at + 2] = luminance
        palette[at + 3] = interpolate(endpoint(1, 0), endpoint(1, 1), weight)
      } else {
        for (let channel = 0; channel < 4; channel += 1)
          palette[at + channel] =
            channel < components ? interpolate(endpoint(channel, 0), endpoint(channel, 1), weight) : 255
      }
    }
  }
  for (let texel = 0; texel < 16; texel += 1) {
    const target = outOffset + texel * 4
    if (planes === 1) {
      const at = (pattern[texel]! * levels + weights[texel]!) * 4
      out[target] = palette[at]!
      out[target + 1] = palette[at + 1]!
      out[target + 2] = palette[at + 2]!
      out[target + 3] = palette[at + 3]!
    } else {
      for (let channel = 0; channel < 4; channel += 1)
        out[target + channel] = palette[weights[texel * 2 + (channel === dualChannel ? 1 : 0)]! * 4 + channel]!
    }
  }
  return true
}

/**
 * Decode a UASTC surface (row-major 4x4 blocks, 16 bytes each) to width × height RGBA8. A block of
 * a reserved mode decodes to transparent black.
 */
export function decodeUastcSurface(data: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new RangeError('UASTC surface size must be positive integers')
  const blocksWide = Math.ceil(width / 4)
  const blocksHigh = Math.ceil(height / 4)
  if (data.byteLength < blocksWide * blocksHigh * 16)
    throw new RangeError(`UASTC surface holds ${data.byteLength} of ${blocksWide * blocksHigh * 16} block bytes`)
  const pixels = new Uint8Array(width * height * 4)
  const block = new Uint8Array(64)
  for (let blockY = 0; blockY < blocksHigh; blockY += 1)
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      block.fill(0)
      decodeUastcBlock(data, (blockY * blocksWide + blockX) * 16, block)
      for (let row = 0; row < 4; row += 1) {
        const y = blockY * 4 + row
        if (y >= height) break
        const columns = Math.min(4, width - blockX * 4)
        pixels.set(block.subarray(row * 16, row * 16 + columns * 4), (y * width + blockX * 4) * 4)
      }
    }
  return pixels
}
