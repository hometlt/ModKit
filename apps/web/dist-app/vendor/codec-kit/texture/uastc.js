import "../../../chunks/chunk-CQ52GEHY.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/texture/uastc.js
var MODE_CODES = [
  [1, 4],
  [53, 6],
  [29, 5],
  [3, 5],
  [19, 5],
  [11, 5],
  [27, 5],
  [7, 5],
  [23, 5],
  [15, 5],
  [2, 3],
  [0, 2],
  [6, 3],
  [31, 5],
  [13, 5],
  [5, 7],
  [21, 6],
  [37, 6],
  [9, 4]
];
var MODE_BY_PREFIX = (() => {
  const table = new Uint8Array(128).fill(255);
  MODE_CODES.forEach(([code, length], mode) => {
    for (let high = 0; high < 1 << 7 - length; high += 1)
      table[code | high << length] = mode;
  });
  return table;
})();
var SOLID_MODE = 8;
var WEIGHT_BITS = [4, 2, 3, 2, 2, 3, 2, 2, 0, 2, 4, 2, 3, 1, 2, 4, 2, 2, 5];
var ENDPOINT_RANGE = [19, 20, 8, 7, 12, 20, 18, 12, 0, 8, 13, 13, 19, 20, 20, 20, 20, 20, 11];
var COMPONENTS = [3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 3];
var HINT_BITS = [15, 15, 15, 15, 15, 15, 15, 15, 0, 23, 17, 17, 17, 23, 23, 23, 23, 23, 15];
var PATTERNS2 = [
  "0011001100110011",
  "0001000100010001",
  "1000100010001000",
  "0001001100110111",
  "1111111011101100",
  "0011011101111111",
  "1110110010000000",
  "1111111011001000",
  "0000000000010011",
  "1100100000000000",
  "0000000101111111",
  "1111111111101000",
  "1110100000000000",
  "1111111100000000",
  "0000111111111111",
  "1111111111110000",
  "1000111011111111",
  "1111111101110001",
  "0111001100010000",
  "0011000100000000",
  "0000100011001110",
  "1111111101110011",
  "1000110011001110",
  "0011000100010000",
  "1111011101110011",
  "0110011001100110",
  "1111000000001111",
  "1010101010101010",
  "1111000011110000",
  "1001001101101100"
].map((pattern) => Uint8Array.from(pattern, (digit) => Number(digit)));
var PATTERNS3 = [
  "0000000011221122",
  "1111111100002222",
  "1111000000002222",
  "1111222200000000",
  "1120112011201120",
  "0112011201120112",
  "0211021102110211",
  "2000200021112111",
  "2012201220122012",
  "1111000022221111",
  "0022001100110022"
].map((pattern) => Uint8Array.from(pattern, (digit) => Number(digit)));
var PATTERNS2_FROM_BC7_3 = [
  "0000111100000000",
  "0010001000100010",
  "1100110010000000",
  "0000000100110011",
  "1111111100001111",
  "0100010001000100",
  "0001001111111111",
  "0111001100110011",
  "1100000000111100",
  "0111011100000000",
  "0000000011101110",
  "1100000000001100",
  "0111001100000000",
  "0000000111111111",
  "1111111111110110",
  "1100110011001000",
  "1111111110001000",
  "0011011011001000",
  "1111011100000000"
].map((pattern) => Uint8Array.from(pattern, (digit) => Number(digit)));
var NO_PATTERN = new Uint8Array(16);
var RANGES = [
  [1, 0, 0],
  [0, 1, 0],
  [2, 0, 0],
  [0, 0, 1],
  [1, 1, 0],
  [3, 0, 0],
  [1, 0, 1],
  [2, 1, 0],
  [4, 0, 0],
  [2, 0, 1],
  [3, 1, 0],
  [5, 0, 0],
  [3, 0, 1],
  [4, 1, 0],
  [6, 0, 0],
  [4, 0, 1],
  [5, 1, 0],
  [7, 0, 0],
  [5, 0, 1],
  [6, 1, 0],
  [8, 0, 0]
];
var UNQUANTISE = [
  void 0,
  void 0,
  void 0,
  void 0,
  ["000000000", 204],
  void 0,
  ["000000000", 113],
  ["b000b0bb0", 93],
  void 0,
  ["b0000bb00", 54],
  ["cb000cbcb", 44],
  void 0,
  ["cb0000cbc", 26],
  ["dcb000dcb", 22],
  void 0,
  ["dcb0000dc", 13],
  ["edcb000ed", 11],
  void 0,
  ["edcb0000e", 6],
  ["fedcb000f", 5],
  void 0
];
function unquantiseEndpoint(value, range) {
  const [bits, trits, quints] = RANGES[range];
  if (trits === 0 && quints === 0) {
    let result = 0;
    let left = 8;
    while (left > 0) {
      const take = Math.min(left, bits);
      result |= value >>> bits - take << left - take;
      left -= take;
    }
    return result;
  }
  const low = value & (1 << bits) - 1;
  const digit = value >>> bits;
  const [swizzle, multiplier] = UNQUANTISE[range];
  const a = (low & 1) !== 0 ? 511 : 0;
  let b = 0;
  for (const character of swizzle) {
    b <<= 1;
    if (character !== "0")
      b |= low >>> character.charCodeAt(0) - 97 & 1;
  }
  const mixed = digit * multiplier + b ^ a;
  return a & 128 | mixed >>> 2;
}
var ENDPOINT_TABLES = RANGES.map((_, range) => {
  const [bits, trits, quints] = RANGES[range];
  if ((trits !== 0 || quints !== 0) && UNQUANTISE[range] === void 0)
    return void 0;
  const levels = 1 + 2 * trits + 4 * quints << bits;
  return Uint8Array.from({ length: 256 }, (_2, value) => value < levels ? unquantiseEndpoint(value, range) : 0);
});
var WEIGHTS = [
  [],
  [0, 64],
  [0, 21, 43, 64],
  [0, 9, 18, 27, 37, 46, 55, 64],
  [0, 4, 8, 12, 17, 21, 25, 29, 35, 39, 43, 47, 52, 56, 60, 64],
  [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64]
];
function interpolate(low, high, weight) {
  const l = low << 8 | low;
  const h = high << 8 | high;
  return l * (64 - weight) + h * weight + 32 >>> 6 >>> 8;
}
var BlockBits = class {
  #bytes;
  #offset;
  #position;
  constructor(bytes, offset, position) {
    this.#bytes = bytes;
    this.#offset = offset;
    this.#position = position;
  }
  read(count) {
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const at = this.#position + bit;
      value |= (this.#bytes[this.#offset + (at >>> 3)] >>> (at & 7) & 1) << bit;
    }
    this.#position += count;
    return value >>> 0;
  }
  skip(count) {
    this.#position += count;
  }
};
function decodeUastcBlock(bytes, offset, out, outOffset = 0) {
  if (offset < 0 || offset + 16 > bytes.byteLength)
    throw new RangeError("UASTC block is truncated");
  const mode = MODE_BY_PREFIX[bytes[offset] & 127];
  if (mode === 255)
    return false;
  const reader = new BlockBits(bytes, offset, MODE_CODES[mode][1]);
  if (mode === SOLID_MODE) {
    const colour = [reader.read(8), reader.read(8), reader.read(8), reader.read(8)];
    for (let texel = 0; texel < 16; texel += 1)
      out.set(colour, outOffset + texel * 4);
    return true;
  }
  reader.skip(HINT_BITS[mode]);
  let subsets = 1;
  let patternIndex = 0;
  if (mode === 2 || mode === 4 || mode === 7 || mode === 9 || mode === 16) {
    patternIndex = reader.read(5);
    subsets = 2;
  } else if (mode === 3) {
    patternIndex = reader.read(4);
    subsets = 3;
  }
  const pattern = subsets === 1 ? NO_PATTERN : subsets === 3 ? PATTERNS3[patternIndex] : mode === 7 ? PATTERNS2_FROM_BC7_3[patternIndex] : PATTERNS2[patternIndex];
  if (pattern === void 0)
    return false;
  let planes = 1;
  let dualChannel = -1;
  if (mode === 6 || mode === 11 || mode === 13) {
    dualChannel = reader.read(2);
    planes = 2;
  } else if (mode === 17) {
    dualChannel = 3;
    planes = 2;
  }
  const components = COMPONENTS[mode];
  const range = ENDPOINT_RANGE[mode];
  const [bits, trits, quints] = RANGES[range];
  const values = components * 2 * subsets;
  const bundleSize = trits !== 0 ? 5 : quints !== 0 ? 3 : 0;
  const bundles = [];
  if (bundleSize !== 0) {
    const count = Math.ceil(values / bundleSize);
    for (let bundle = 0; bundle < count; bundle += 1) {
      let length = trits !== 0 ? 8 : 7;
      if (bundle === count - 1) {
        const remaining = values - bundle * bundleSize;
        length = trits !== 0 ? [0, 2, 4, 5, 7, 8][remaining] ?? 8 : [0, 3, 5, 7][remaining] ?? 7;
      }
      bundles.push(reader.read(length));
    }
  }
  const radix = trits !== 0 ? 3 : 5;
  const endpoints = new Uint8Array(values);
  let digits = 0;
  let digitsLeft = 0;
  let nextBundle = 0;
  for (let index = 0; index < values; index += 1) {
    let value = reader.read(bits);
    if (bundleSize !== 0) {
      if (digitsLeft === 0) {
        digits = bundles[nextBundle++];
        digitsLeft = bundleSize;
      }
      value |= digits % radix << bits;
      digits = Math.floor(digits / radix);
      digitsLeft -= 1;
    }
    endpoints[index] = value;
  }
  const weightBits = WEIGHT_BITS[mode];
  const anchors = [];
  for (let subset = 0; subset < subsets; subset += 1)
    anchors.push(pattern.indexOf(subset));
  const weights = new Uint8Array(16 * planes);
  if (planes === 2) {
    for (let index = 0; index < 32; index += 1)
      weights[index] = reader.read(index < 2 ? weightBits - 1 : weightBits);
  } else {
    for (let texel = 0; texel < 16; texel += 1)
      weights[texel] = reader.read(anchors.includes(texel) ? weightBits - 1 : weightBits);
  }
  const table = ENDPOINT_TABLES[range];
  if (table === void 0)
    return false;
  const levelWeights = WEIGHTS[weightBits];
  const levels = 1 << weightBits;
  const palette = new Uint8Array(subsets * levels * 4);
  for (let subset = 0; subset < subsets; subset += 1) {
    const base = subset * components * 2;
    const endpoint = (channel, end) => table[endpoints[base + channel * 2 + end]];
    for (let level = 0; level < levels; level += 1) {
      const at = (subset * levels + level) * 4;
      const weight = levelWeights[level];
      if (components === 2) {
        const luminance = interpolate(endpoint(0, 0), endpoint(0, 1), weight);
        palette[at] = luminance;
        palette[at + 1] = luminance;
        palette[at + 2] = luminance;
        palette[at + 3] = interpolate(endpoint(1, 0), endpoint(1, 1), weight);
      } else {
        for (let channel = 0; channel < 4; channel += 1)
          palette[at + channel] = channel < components ? interpolate(endpoint(channel, 0), endpoint(channel, 1), weight) : 255;
      }
    }
  }
  for (let texel = 0; texel < 16; texel += 1) {
    const target = outOffset + texel * 4;
    if (planes === 1) {
      const at = (pattern[texel] * levels + weights[texel]) * 4;
      out[target] = palette[at];
      out[target + 1] = palette[at + 1];
      out[target + 2] = palette[at + 2];
      out[target + 3] = palette[at + 3];
    } else {
      for (let channel = 0; channel < 4; channel += 1)
        out[target + channel] = palette[weights[texel * 2 + (channel === dualChannel ? 1 : 0)] * 4 + channel];
    }
  }
  return true;
}
function decodeUastcSurface(data, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new RangeError("UASTC surface size must be positive integers");
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  if (data.byteLength < blocksWide * blocksHigh * 16)
    throw new RangeError(`UASTC surface holds ${data.byteLength} of ${blocksWide * blocksHigh * 16} block bytes`);
  const pixels = new Uint8Array(width * height * 4);
  const block = new Uint8Array(64);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1)
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      block.fill(0);
      decodeUastcBlock(data, (blockY * blocksWide + blockX) * 16, block);
      for (let row = 0; row < 4; row += 1) {
        const y = blockY * 4 + row;
        if (y >= height)
          break;
        const columns = Math.min(4, width - blockX * 4);
        pixels.set(block.subarray(row * 16, row * 16 + columns * 4), (y * width + blockX * 4) * 4);
      }
    }
  return pixels;
}
export {
  decodeUastcBlock,
  decodeUastcSurface
};
