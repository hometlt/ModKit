import {
  compressPortable,
  decompressBounded
} from "./chunk-GDKG5J25.js";
import {
  crc32Range
} from "./chunk-TWH75SBL.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/encoders.js
var at = (pixels, index) => pixels[index];
var PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
var ascii = new TextEncoder();
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength, false);
  out.set(ascii.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32Range(out, 4, 8 + data.byteLength), false);
  return out;
}
async function writePng(width, height, bitDepth, colorType, rowBytes, row, signal) {
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1)
    row(y, raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header[8] = bitDepth;
  header[9] = colorType;
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", await compressPortable(raw, "deflate", signal)),
    pngChunk("IEND", new Uint8Array(0))
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.byteLength;
  }
  return png;
}
async function encodePng(width, height, pixels, signal) {
  const rowBytes = width * 4;
  return writePng(width, height, 8, 6, rowBytes, (y, into) => into.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes)), signal);
}
async function encodeGreyPng(width, height, samples, bitDepth, signal) {
  if (samples.length !== width * height) {
    throw new RangeError(`grey PNG needs ${width * height} samples, got ${samples.length}`);
  }
  const maximum = bitDepth === 16 ? 65535 : 255;
  const bytes = bitDepth / 8;
  return writePng(width, height, bitDepth, 0, width * bytes, (y, into) => {
    for (let x = 0; x < width; x += 1) {
      const value = samples[y * width + x];
      if (!Number.isInteger(value) || value < 0 || value > maximum) {
        throw new RangeError(`grey sample ${value} at ${x},${y} is outside 0..${maximum}`);
      }
      if (bitDepth === 16) {
        into[x * 2] = value >> 8;
        into[x * 2 + 1] = value & 255;
      } else
        into[x] = value;
    }
  }, signal);
}
function encodeTga(image) {
  if (image.width > 65535 || image.height > 65535) {
    throw new TypeError("TGA dimensions exceed 65535");
  }
  const out = new Uint8Array(18 + image.width * image.height * 4);
  const header = new DataView(out.buffer);
  out[2] = 2;
  header.setUint16(12, image.width, true);
  header.setUint16(14, image.height, true);
  out[16] = 32;
  out[17] = 40;
  for (let source = 0, target = 18; source < image.pixels.length; source += 4, target += 4) {
    out[target] = at(image.pixels, source + 2);
    out[target + 1] = at(image.pixels, source + 1);
    out[target + 2] = at(image.pixels, source);
    out[target + 3] = at(image.pixels, source + 3);
  }
  return out;
}
function encodeIconDib(image) {
  const { width, height, pixels } = image;
  const maskRow = Math.ceil(width / 32) * 4;
  const out = new Uint8Array(40 + width * height * 4 + maskRow * height);
  const header = new DataView(out.buffer);
  header.setUint32(0, 40, true);
  header.setInt32(4, width, true);
  header.setInt32(8, height * 2, true);
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  const maskStart = 40 + width * height * 4;
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = 40 + (row * width + x) * 4;
      out[target] = at(pixels, source + 2);
      out[target + 1] = at(pixels, source + 1);
      out[target + 2] = at(pixels, source);
      out[target + 3] = at(pixels, source + 3);
      if (at(pixels, source + 3) === 0) {
        const index = maskStart + row * maskRow + (x >> 3);
        out[index] = at(out, index) | 128 >> (x & 7);
      }
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/png.js
var SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
var CHANNELS = /* @__PURE__ */ new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4]
]);
var DEFAULT_MAX_PIXELS = 64 * 1024 * 1024;
var paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
async function decodePngSamples(bytes, options = {}) {
  if (bytes.byteLength < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new TypeError("not a PNG: bad signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let palette;
  let transparency;
  const data = [];
  for (let offset = 8; offset + 12 <= bytes.byteLength; ) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.byteLength !== length)
      throw new RangeError(`PNG chunk ${type} is truncated`);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      depth = body[8] ?? 0;
      colorType = body[9] ?? -1;
      if (body[12] !== 0)
        throw new TypeError("interlaced PNG is not supported");
    } else if (type === "PLTE")
      palette = body;
    else if (type === "tRNS")
      transparency = body;
    else if (type === "IDAT")
      data.push(body);
    else if (type === "IEND")
      break;
    offset += 12 + length;
  }
  const stored = CHANNELS.get(colorType);
  if (stored === void 0 || ![1, 2, 4, 8, 16].includes(depth) || width < 1 || height < 1) {
    throw new TypeError(`unsupported PNG: colour type ${colorType}, bit depth ${depth}`);
  }
  if (colorType === 3 && (palette === void 0 || depth === 16) || depth < 8 && ![0, 3].includes(colorType)) {
    throw new TypeError(`unsupported PNG: colour type ${colorType}, bit depth ${depth}`);
  }
  if (width * height > (options.maxPixels ?? DEFAULT_MAX_PIXELS)) {
    throw new RangeError(`PNG ${width}x${height} exceeds the pixel bound`);
  }
  const rowBytes = Math.ceil(width * stored * depth / 8);
  const pixelBytes = Math.max(1, stored * depth / 8);
  const compressed = new Uint8Array(data.reduce((total, part) => total + part.byteLength, 0));
  data.reduce((offset, part) => (compressed.set(part, offset), offset + part.byteLength), 0);
  const raw = await decompressBounded(compressed, "deflate", {
    maxOutputBytes: (rowBytes + 1) * height,
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  if (raw.byteLength !== (rowBytes + 1) * height)
    throw new RangeError("PNG image data is truncated");
  const rows = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)];
    const row = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[y * (rowBytes + 1) + 1 + x];
      const a = x >= pixelBytes ? rows[row + x - pixelBytes] : 0;
      const b = y > 0 ? rows[row - rowBytes + x] : 0;
      const c = y > 0 && x >= pixelBytes ? rows[row - rowBytes + x - pixelBytes] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? a + b >> 1 : filter === 4 ? paeth(a, b, c) : -1;
      if (predicted < 0)
        throw new TypeError(`PNG row ${y} has unknown filter ${String(filter)}`);
      rows[row + x] = value + predicted & 255;
    }
  }
  const sampleAt2 = (y, index) => {
    if (depth === 16)
      return rows[y * rowBytes + index * 2] << 8 | rows[y * rowBytes + index * 2 + 1];
    if (depth === 8)
      return rows[y * rowBytes + index];
    const bit = index * depth;
    return rows[y * rowBytes + (bit >> 3)] >> 8 - depth - (bit & 7) & (1 << depth) - 1;
  };
  if (colorType === 3) {
    const alpha = transparency !== void 0;
    const channels = alpha ? 4 : 3;
    const samples2 = new Uint16Array(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const entry = sampleAt2(y, x);
        if (entry * 3 + 2 >= palette.byteLength) {
          throw new TypeError(`indexed PNG pixel refers to absent palette entry ${entry}`);
        }
        const out = (y * width + x) * channels;
        for (let channel = 0; channel < 3; channel += 1)
          samples2[out + channel] = palette[entry * 3 + channel] ?? 0;
        if (alpha)
          samples2[out + 3] = transparency[entry] ?? 255;
      }
    }
    return Object.freeze({ width, height, bitDepth: 8, channels, samples: samples2 });
  }
  const samples = new Uint16Array(width * height * stored);
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < height; y += 1) {
    for (let index = 0; index < width * stored; index += 1) {
      samples[y * width * stored + index] = Math.round(sampleAt2(y, index) * scale);
    }
  }
  return Object.freeze({ width, height, bitDepth: depth === 16 ? 16 : 8, channels: stored, samples });
}
var greyDepthFor = (maximum) => maximum > 255 ? 16 : 8;
async function greyGridToPng(grid, maximum, signal) {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 65535) {
    throw new RangeError(`a grey grid's maximum must be 0..65535, not ${maximum}`);
  }
  return encodeGreyPng(grid.width, grid.height, grid.values, greyDepthFor(maximum), signal);
}
async function greyGridFromPng(png, expected, signal) {
  const image = await decodePngSamples(png, { maxPixels: expected.width * expected.height, ...signal === void 0 ? {} : { signal } });
  if (image.width !== expected.width || image.height !== expected.height) {
    throw new RangeError(`the image is ${image.width}x${image.height}; the grid is ${expected.width}x${expected.height}`);
  }
  const depth = greyDepthFor(expected.maximum);
  const scale = image.bitDepth === depth ? 1 : depth === 16 ? 257 : 1 / 257;
  const values = new Array(image.width * image.height);
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.round(image.samples[index * image.channels] * scale);
    if (value < expected.minimum || value > expected.maximum) {
      throw new RangeError(`pixel ${index % image.width},${Math.floor(index / image.width)} is ${value}, outside ${expected.minimum}..${expected.maximum}`);
    }
    values[index] = value;
  }
  return Object.freeze({ width: image.width, height: image.height, values: Object.freeze(values) });
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/jpeg.js
var ZIGZAG = Int32Array.from([
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63
]);
var MAX_DIMENSION = 1 << 15;
var MAX_COMPONENTS = 4;
var COS = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) {
    const scale = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x += 1)
      table[u * 8 + x] = scale * Math.cos((2 * x + 1) * u * Math.PI / 16);
  }
  return table;
})();
function buildHuffmanTable(counts, values) {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17).fill(-1);
  const valuePointer = new Int32Array(17);
  let code = 0;
  let offset = 0;
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0;
    valuePointer[length] = offset;
    minCode[length] = code;
    maxCode[length] = count === 0 ? -1 : code + count - 1;
    code += count;
    offset += count;
    code <<= 1;
  }
  return { minCode, maxCode, valuePointer, values };
}
var BitReader = class {
  bytes;
  byteOffset;
  bitBuffer = 0;
  bitCount = 0;
  /** Set once the reader runs into a real marker, which ends the entropy-coded data. */
  markerHit = false;
  constructor(bytes, start) {
    this.bytes = bytes;
    this.byteOffset = start;
  }
  get offset() {
    return this.byteOffset;
  }
  /** Align to the next byte and step over a restart marker when one is there. */
  skipRestart() {
    this.bitCount = 0;
    let scan = this.byteOffset;
    while (scan + 1 < this.bytes.length && this.bytes[scan] !== 255)
      scan += 1;
    if (scan + 1 >= this.bytes.length)
      return false;
    const marker = this.bytes[scan + 1] ?? 0;
    if (marker < 208 || marker > 215)
      return false;
    this.byteOffset = scan + 2;
    this.markerHit = false;
    return true;
  }
  readBit() {
    if (this.bitCount > 0) {
      this.bitCount -= 1;
      return this.bitBuffer >> this.bitCount & 1;
    }
    if (this.byteOffset >= this.bytes.length) {
      this.markerHit = true;
      return 0;
    }
    const value = this.bytes[this.byteOffset] ?? 0;
    if (value === 255) {
      const next = this.bytes[this.byteOffset + 1] ?? 0;
      if (next !== 0) {
        this.markerHit = true;
        return 0;
      }
      this.byteOffset += 2;
    } else {
      this.byteOffset += 1;
    }
    this.bitBuffer = value;
    this.bitCount = 7;
    return value >> 7 & 1;
  }
  readBits(count) {
    let value = 0;
    for (let index = 0; index < count; index += 1)
      value = value << 1 | this.readBit();
    return value;
  }
  decodeHuffman(table) {
    let code = 0;
    for (let length = 1; length <= 16; length += 1) {
      code = code << 1 | this.readBit();
      if (this.markerHit)
        return 0;
      const max = table.maxCode[length] ?? -1;
      if (max >= 0 && code <= max) {
        const index = (table.valuePointer[length] ?? 0) + code - (table.minCode[length] ?? 0);
        return table.values[index] ?? 0;
      }
    }
    this.markerHit = true;
    return 0;
  }
};
function extend(value, length) {
  return length === 0 ? 0 : value < 1 << length - 1 ? value - (1 << length) + 1 : value;
}
function inverseDct(coefficients, out, outOffset, stride) {
  const rows = new Float64Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let u = 0; u < 8; u += 1) {
        const value = coefficients[y * 8 + u] ?? 0;
        if (value !== 0)
          sum += value * (COS[u * 8 + x] ?? 0);
      }
      rows[y * 8 + x] = sum / 2;
    }
  }
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      let sum = 0;
      for (let v = 0; v < 8; v += 1) {
        const value = rows[v * 8 + x] ?? 0;
        if (value !== 0)
          sum += value * (COS[v * 8 + y] ?? 0);
      }
      const sample = Math.round(sum / 2) + 128;
      out[outOffset + y * stride + x] = sample < 0 ? 0 : sample > 255 ? 255 : sample;
    }
  }
}
function u16(bytes, offset) {
  if (offset + 2 > bytes.length)
    throw new RangeError("truncated JPEG 16-bit field");
  return (bytes[offset] ?? 0) << 8 | (bytes[offset + 1] ?? 0);
}
function parse(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new TypeError("JPEG SOI signature is invalid");
  const quantization = new Array(4);
  const huffmanDc = new Array(4);
  const huffmanAc = new Array(4);
  let frame;
  let components = [];
  let maxHorizontal = 1;
  let maxVertical = 1;
  let restartInterval = 0;
  let adobeTransform;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 255) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215)
      continue;
    if (marker === 217)
      break;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length)
      throw new TypeError("JPEG segment is truncated");
    const payload = bytes.subarray(offset + 2, offset + length);
    if (marker === 219) {
      let at2 = 0;
      while (at2 < payload.length) {
        const spec = payload[at2] ?? 0;
        const precision = spec >> 4;
        const slot = spec & 15;
        at2 += 1;
        if (slot > 3)
          throw new TypeError("JPEG quantization table slot is out of range");
        const table = new Int32Array(64);
        for (let index = 0; index < 64; index += 1) {
          table[index] = precision === 0 ? payload[at2] ?? 0 : u16(payload, at2);
          at2 += precision === 0 ? 1 : 2;
        }
        quantization[slot] = table;
      }
    } else if (marker === 196) {
      let at2 = 0;
      while (at2 < payload.length) {
        const spec = payload[at2] ?? 0;
        const slot = spec & 15;
        at2 += 1;
        if (slot > 3)
          throw new TypeError("JPEG Huffman table slot is out of range");
        const counts = payload.subarray(at2, at2 + 16);
        at2 += 16;
        let total = 0;
        for (const count of counts)
          total += count;
        const values = payload.subarray(at2, at2 + total);
        at2 += total;
        const table = buildHuffmanTable(Uint8Array.from(counts), Uint8Array.from(values));
        if (spec >> 4 === 0)
          huffmanDc[slot] = table;
        else
          huffmanAc[slot] = table;
      }
    } else if (marker === 221) {
      restartInterval = u16(payload, 0);
    } else if (marker === 238 && payload.length >= 12) {
      adobeTransform = payload[11];
    } else if (marker === 194 || marker === 198 || marker === 202 || marker === 206) {
      throw new TypeError("progressive JPEG is not decoded by this baseline decoder");
    } else if (marker === 201 || marker === 203 || marker === 205 || marker === 207) {
      throw new TypeError("arithmetic-coded JPEG is not decoded by this baseline decoder");
    } else if (marker === 192 || marker === 193) {
      const precision = payload[0] ?? 0;
      if (precision !== 8)
        throw new TypeError("only 8-bit JPEG precision is decoded");
      const height = u16(payload, 1);
      const width = u16(payload, 3);
      const count = payload[5] ?? 0;
      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION)
        throw new RangeError("JPEG frame dimensions are out of range");
      if (count === 0 || count > MAX_COMPONENTS)
        throw new TypeError("JPEG component count is not supported");
      components = [];
      for (let index = 0; index < count; index += 1) {
        const at2 = 6 + index * 3;
        const sampling = payload[at2 + 1] ?? 0;
        const horizontal = sampling >> 4;
        const vertical = sampling & 15;
        if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4)
          throw new TypeError("JPEG sampling factor is out of range");
        components.push({
          id: payload[at2] ?? 0,
          horizontal,
          vertical,
          quantizationTable: payload[at2 + 2] ?? 0,
          blocksPerLine: 0,
          blocksPerColumn: 0,
          samples: new Uint8Array(0),
          stride: 0,
          huffmanDc: void 0,
          huffmanAc: void 0,
          prediction: 0
        });
        maxHorizontal = Math.max(maxHorizontal, horizontal);
        maxVertical = Math.max(maxVertical, vertical);
      }
      frame = { width, height, components: count, progressive: false };
    } else if (marker === 218) {
      if (frame === void 0)
        throw new TypeError("JPEG scan appears before its frame header");
      const count = payload[0] ?? 0;
      for (let index = 0; index < count; index += 1) {
        const id = payload[1 + index * 2] ?? 0;
        const tables = payload[2 + index * 2] ?? 0;
        const component = components.find((candidate) => candidate.id === id);
        if (component === void 0)
          throw new TypeError("JPEG scan names an unknown component");
        component.huffmanDc = huffmanDc[tables >> 4];
        component.huffmanAc = huffmanAc[tables & 15];
      }
      const mcusPerLine = Math.ceil(frame.width / (8 * maxHorizontal));
      const mcusPerColumn = Math.ceil(frame.height / (8 * maxVertical));
      for (const component of components) {
        component.blocksPerLine = mcusPerLine * component.horizontal;
        component.blocksPerColumn = mcusPerColumn * component.vertical;
        component.stride = component.blocksPerLine * 8;
        component.samples = new Uint8Array(component.stride * component.blocksPerColumn * 8);
      }
      return {
        frame,
        components,
        restartInterval,
        scanStart: offset + length,
        quantization,
        adobeTransform
      };
    }
    offset += length;
  }
  throw new TypeError("JPEG has no baseline scan");
}
function decodeScan(parsed, bytes, signal) {
  const { components, restartInterval, quantization } = parsed;
  const maxHorizontal = components.reduce((max, one) => Math.max(max, one.horizontal), 1);
  const maxVertical = components.reduce((max, one) => Math.max(max, one.vertical), 1);
  const mcusPerLine = Math.ceil(parsed.frame.width / (8 * maxHorizontal));
  const mcusPerColumn = Math.ceil(parsed.frame.height / (8 * maxVertical));
  const reader = new BitReader(bytes, parsed.scanStart);
  const coefficients = new Int16Array(64);
  const block = new Float64Array(64);
  let sinceRestart = 0;
  for (let mcu = 0; mcu < mcusPerLine * mcusPerColumn; mcu += 1) {
    signal?.throwIfAborted();
    if (restartInterval > 0 && sinceRestart === restartInterval) {
      reader.skipRestart();
      for (const component of components)
        component.prediction = 0;
      sinceRestart = 0;
    }
    sinceRestart += 1;
    const mcuRow = Math.floor(mcu / mcusPerLine);
    const mcuColumn = mcu % mcusPerLine;
    for (const component of components) {
      const table = quantization[component.quantizationTable];
      if (table === void 0)
        throw new TypeError("JPEG names a missing quantization table");
      const dc = component.huffmanDc;
      const ac = component.huffmanAc;
      if (dc === void 0 || ac === void 0)
        throw new TypeError("JPEG names a missing Huffman table");
      for (let v = 0; v < component.vertical; v += 1)
        for (let h = 0; h < component.horizontal; h += 1) {
          coefficients.fill(0);
          const magnitude = reader.decodeHuffman(dc);
          const diff = magnitude === 0 ? 0 : extend(reader.readBits(magnitude), magnitude);
          component.prediction += diff;
          coefficients[0] = component.prediction;
          let index = 1;
          while (index < 64) {
            const symbol = reader.decodeHuffman(ac);
            const size = symbol & 15;
            const run = symbol >> 4;
            if (size === 0) {
              if (run !== 15)
                break;
              index += 16;
              continue;
            }
            index += run;
            if (index > 63)
              break;
            coefficients[index] = extend(reader.readBits(size), size);
            index += 1;
          }
          block.fill(0);
          for (let position = 0; position < 64; position += 1)
            block[ZIGZAG[position] ?? 0] = (coefficients[position] ?? 0) * (table[position] ?? 1);
          const blockRow = mcuRow * component.vertical + v;
          const blockColumn = mcuColumn * component.horizontal + h;
          inverseDct(block, component.samples, blockRow * 8 * component.stride + blockColumn * 8, component.stride);
        }
    }
  }
}
function sampleAt(component, x, y, maxHorizontal, maxVertical) {
  const sourceX = Math.min(component.stride - 1, Math.floor(x * component.horizontal / maxHorizontal));
  const sourceY = Math.floor(y * component.vertical / maxVertical);
  return component.samples[sourceY * component.stride + sourceX] ?? 0;
}
var clamp = (value) => value < 0 ? 0 : value > 255 ? 255 : value | 0;
function decodeBaselineJpegPlanes(bytes, options = {}) {
  const parsed = parse(bytes);
  const { width, height } = parsed.frame;
  const planeBytes = width * height;
  if (!Number.isSafeInteger(planeBytes * parsed.components.length))
    throw new RangeError("JPEG dimensions overflow");
  if (options.maxBytes !== void 0 && planeBytes * parsed.components.length > options.maxBytes)
    throw new RangeError("decoded JPEG exceeds the caller budget");
  decodeScan(parsed, bytes, options.signal);
  const maxHorizontal = parsed.components.reduce((max, one) => Math.max(max, one.horizontal), 1);
  const maxVertical = parsed.components.reduce((max, one) => Math.max(max, one.vertical), 1);
  const planes = parsed.components.map((component) => {
    const samples = new Uint8Array(planeBytes);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        samples[y * width + x] = sampleAt(component, x, y, maxHorizontal, maxVertical);
    return { id: component.id, samples };
  });
  return { width, height, planes, adobeTransform: parsed.adobeTransform };
}
function decodeBaselineJpeg(bytes, options = {}) {
  const parsed = parse(bytes);
  const { width, height } = parsed.frame;
  const outputBytes = width * height * 4;
  if (!Number.isSafeInteger(outputBytes))
    throw new RangeError("JPEG dimensions overflow");
  if (options.maxBytes !== void 0 && outputBytes > options.maxBytes)
    throw new RangeError("decoded JPEG exceeds the caller budget");
  decodeScan(parsed, bytes, options.signal);
  const components = parsed.components;
  const maxHorizontal = components.reduce((max, one) => Math.max(max, one.horizontal), 1);
  const maxVertical = components.reduce((max, one) => Math.max(max, one.vertical), 1);
  const rgba = new Uint8Array(outputBytes);
  const first = components[0];
  if (first === void 0)
    throw new TypeError("JPEG frame declares no components");
  if (components.length === 4 && parsed.adobeTransform === void 0)
    throw new TypeError("four-component JPEG without an Adobe transform has no portable channel order; decode it with decodeBaselineJpegPlanes and apply the container own order");
  if (components.length === 2)
    throw new TypeError("two-component JPEG is not a colour model this decoder states");
  for (let y = 0; y < height; y += 1) {
    options.signal?.throwIfAborted();
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (components.length === 1) {
        const grey = sampleAt(first, x, y, maxHorizontal, maxVertical);
        rgba[target] = grey;
        rgba[target + 1] = grey;
        rgba[target + 2] = grey;
        rgba[target + 3] = 255;
        continue;
      }
      const second = components[1];
      const third = components[2];
      if (second === void 0 || third === void 0)
        throw new TypeError("JPEG frame declares fewer components than its scan uses");
      const luma = sampleAt(first, x, y, maxHorizontal, maxVertical);
      const cb = sampleAt(second, x, y, maxHorizontal, maxVertical) - 128;
      const cr = sampleAt(third, x, y, maxHorizontal, maxVertical) - 128;
      if (components.length === 3 && parsed.adobeTransform === 0) {
        rgba[target] = luma;
        rgba[target + 1] = clamp(cb + 128);
        rgba[target + 2] = clamp(cr + 128);
        rgba[target + 3] = 255;
        continue;
      }
      rgba[target] = clamp(luma + 1.402 * cr);
      rgba[target + 1] = clamp(luma - 0.344136 * cb - 0.714136 * cr);
      rgba[target + 2] = clamp(luma + 1.772 * cb);
      rgba[target + 3] = 255;
    }
  }
  return { width, height, pixels: rgba };
}
function readJpegFrameInfo(bytes) {
  try {
    return parse(bytes).frame;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("progressive"))
      return { width: 0, height: 0, components: 0, progressive: true };
    throw error;
  }
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/surfaces.js
function surfaceRegionReader(sizeOf, decode) {
  let held;
  return async (request, signal) => {
    signal?.throwIfAborted();
    const surface = Object.freeze({
      frame: request.frame ?? 0,
      mipLevel: request.mipLevel ?? 0,
      layer: request.layer ?? 0,
      face: request.face ?? 0,
      slice: request.slice ?? 0
    });
    const { x, y, width, height, maxBytes } = request;
    for (const value of [x, y, width, height, maxBytes, ...Object.values(surface)])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError("raster region coordinates, surface and budget must be non-negative safe integers");
    if (request.pixelFormat !== "rgba8")
      throw new RangeError("raster surfaces read as rgba8");
    const size = sizeOf(surface);
    if (size === void 0)
      throw new RangeError(`raster surface frame ${surface.frame}, mip ${surface.mipLevel}, layer ${surface.layer}, face ${surface.face}, slice ${surface.slice} is not present`);
    if (x + width > size.width || y + height > size.height)
      throw new RangeError("raster region is outside the surface");
    if (width * height * 4 > maxBytes)
      throw new RangeError("raster region exceeds maxBytes");
    const key = Object.values(surface).join(":");
    if (held?.key !== key) {
      const pixels2 = await decode(surface, signal);
      if (pixels2.length !== size.width * size.height * 4)
        throw new TypeError(`decoded raster surface is ${pixels2.length} bytes, not ${size.width}\xD7${size.height} RGBA8`);
      held = { key, pixels: pixels2 };
    }
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const start = ((y + row) * size.width + x) * 4;
      pixels.set(held.pixels.subarray(start, start + width * 4), row * width * 4);
    }
    return Object.freeze({
      width,
      height,
      rowStride: width * 4,
      pixelFormat: "rgba8",
      pixels
    });
  };
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/embedded.js
function findEmbeddedImage(head, scanBytes = 1024) {
  const scan = Math.min(head.byteLength, scanBytes);
  const u164 = (at2) => (head[at2] ?? 0) | (head[at2 + 1] ?? 0) << 8;
  for (let offset = 0; offset + 8 <= scan; offset += 1) {
    const magic = String.fromCharCode(...head.subarray(offset, offset + 4));
    if (magic === "DDS ")
      return { kind: "dds", offset };
    if (magic === "\x89PNG")
      return { kind: "png", offset };
    const width = u164(offset + 12);
    const height = u164(offset + 14);
    if ([2, 3, 10, 11].includes(head[offset + 2] ?? 0) && width > 0 && height > 0 && width <= 16384 && height <= 16384 && [8, 16, 24, 32].includes(head[offset + 16] ?? 0))
      return { kind: "tga", offset };
  }
  return void 0;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/tga.js
var FOOTER = [
  84,
  82,
  85,
  69,
  86,
  73,
  83,
  73,
  79,
  78,
  45,
  88,
  70,
  73,
  76,
  69,
  46,
  0
];
function u162(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength)
    throw new RangeError("TGA field is truncated");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
function hasFooter(bytes) {
  const start = bytes.byteLength - FOOTER.length;
  return start >= 0 && FOOTER.every((value, index) => bytes[start + index] === value);
}
function plausibleTgaHeader(bytes) {
  if (bytes.byteLength < 18)
    return false;
  const colorMapType = bytes[1] ?? 0;
  const imageType = bytes[2] ?? 0;
  const width = u162(bytes, 12);
  const height = u162(bytes, 14);
  const pixelDepth = bytes[16] ?? 0;
  if (![0, 1].includes(colorMapType) || ![1, 2, 3, 9, 10, 11].includes(imageType) || width === 0 || height === 0) {
    return false;
  }
  const mapped = imageType === 1 || imageType === 9;
  const grayscale2 = imageType === 3 || imageType === 11;
  if (mapped !== (colorMapType === 1))
    return false;
  if (mapped && ![8, 16].includes(pixelDepth))
    return false;
  if (grayscale2 && ![8, 16].includes(pixelDepth))
    return false;
  if (!mapped && !grayscale2 && ![16, 24, 32].includes(pixelDepth))
    return false;
  return true;
}
function parseTga(bytes, maxDecodedBytes) {
  if (!plausibleTgaHeader(bytes))
    throw new TypeError("TGA header is invalid");
  const idBytes = bytes[0] ?? 0;
  const colorMapType = bytes[1] ?? 0;
  const imageType = bytes[2] ?? 0;
  const colorMapFirst = u162(bytes, 3);
  const colorMapLength = u162(bytes, 5);
  const colorMapDepth = bytes[7] ?? 0;
  const xOrigin = u162(bytes, 8);
  const yOrigin = u162(bytes, 10);
  const width = u162(bytes, 12);
  const height = u162(bytes, 14);
  const pixelDepth = bytes[16] ?? 0;
  const descriptor = bytes[17] ?? 0;
  const mapped = imageType === 1 || imageType === 9;
  const grayscale2 = imageType === 3 || imageType === 11;
  const rle = imageType >= 9;
  const colorMapEntryBytes = Math.ceil(colorMapDepth / 8);
  if (mapped && (colorMapLength === 0 || ![15, 16, 24, 32].includes(colorMapDepth)) || !mapped && (colorMapLength !== 0 || colorMapType !== 0)) {
    throw new TypeError("TGA color-map declaration is invalid");
  }
  const dataOffset = 18 + idBytes + colorMapLength * colorMapEntryBytes;
  const footerBytes = hasFooter(bytes) ? 26 : 0;
  const dataEnd = bytes.byteLength - footerBytes;
  if (dataOffset >= dataEnd)
    throw new TypeError("TGA image payload is missing");
  const decodedBytes = BigInt(width) * BigInt(height) * 4n;
  const decodedAccess = !mapped && decodedBytes <= BigInt(maxDecodedBytes) && (!grayscale2 && [16, 24, 32].includes(pixelDepth) || grayscale2 && [8, 16].includes(pixelDepth));
  return Object.freeze({
    idBytes,
    colorMapType,
    imageType,
    colorMapFirst,
    colorMapLength,
    colorMapDepth,
    xOrigin,
    yOrigin,
    width,
    height,
    pixelDepth,
    descriptor,
    mapped,
    grayscale: grayscale2,
    rle,
    topOrigin: (descriptor & 32) !== 0,
    rightOrigin: (descriptor & 16) !== 0,
    alphaBits: descriptor & 15,
    dataOffset,
    dataEnd,
    decodedBytes,
    decodedAccess,
    hasFooter: footerBytes !== 0
  });
}
function readPixel(bytes, source, tga) {
  if (tga.grayscale) {
    return {
      red: bytes[source] ?? 0,
      green: bytes[source] ?? 0,
      blue: bytes[source] ?? 0,
      alpha: tga.pixelDepth === 16 ? bytes[source + 1] ?? 255 : 255,
      next: source + tga.pixelDepth / 8
    };
  }
  if (tga.pixelDepth === 16) {
    const value = u162(bytes, source);
    return {
      red: Math.round((value >>> 10 & 31) * 255 / 31),
      green: Math.round((value >>> 5 & 31) * 255 / 31),
      blue: Math.round((value & 31) * 255 / 31),
      alpha: tga.alphaBits > 0 ? (value & 32768) === 0 ? 0 : 255 : 255,
      next: source + 2
    };
  }
  return {
    red: bytes[source + 2] ?? 0,
    green: bytes[source + 1] ?? 0,
    blue: bytes[source] ?? 0,
    alpha: tga.pixelDepth === 32 ? bytes[source + 3] ?? 255 : 255,
    next: source + tga.pixelDepth / 8
  };
}
function decodeTgaPixels(bytes, tga) {
  const pixelCount = tga.width * tga.height;
  const pixels = new Uint8Array(pixelCount * 4);
  let source = tga.dataOffset;
  let filePixel = 0;
  const write = (pixel) => {
    if (filePixel >= pixelCount)
      throw new TypeError("TGA packet crosses the declared image");
    const fileX = filePixel % tga.width;
    const fileY = Math.floor(filePixel / tga.width);
    const targetX = tga.rightOrigin ? tga.width - 1 - fileX : fileX;
    const targetY = tga.topOrigin ? fileY : tga.height - 1 - fileY;
    const target = (targetY * tga.width + targetX) * 4;
    pixels[target] = pixel.red;
    pixels[target + 1] = pixel.green;
    pixels[target + 2] = pixel.blue;
    pixels[target + 3] = pixel.alpha;
    filePixel += 1;
  };
  while (filePixel < pixelCount) {
    if (source >= tga.dataEnd)
      throw new TypeError("TGA image data is truncated");
    if (tga.rle) {
      const packet = bytes[source] ?? 0;
      source += 1;
      const count = (packet & 127) + 1;
      if (filePixel + count > pixelCount)
        throw new TypeError("TGA RLE packet is too long");
      if ((packet & 128) !== 0) {
        const pixel = readPixel(bytes, source, tga);
        if (pixel.next > tga.dataEnd)
          throw new TypeError("TGA RLE pixel is truncated");
        source = pixel.next;
        for (let index = 0; index < count; index += 1)
          write(pixel);
      } else {
        for (let index = 0; index < count; index += 1) {
          const pixel = readPixel(bytes, source, tga);
          if (pixel.next > tga.dataEnd)
            throw new TypeError("TGA raw packet pixel is truncated");
          source = pixel.next;
          write(pixel);
        }
      }
    } else {
      const pixel = readPixel(bytes, source, tga);
      if (pixel.next > tga.dataEnd)
        throw new TypeError("TGA pixel is truncated");
      source = pixel.next;
      write(pixel);
    }
  }
  return pixels;
}
function decodeTga(bytes, maxDecodedBytes = 64 * 1024 * 1024) {
  const tga = parseTga(bytes, maxDecodedBytes);
  if (!tga.decodedAccess)
    throw new RangeError(tga.mapped ? "Colour-mapped TGA pixels are not decoded" : "TGA image exceeds the decode budget");
  return { width: tga.width, height: tga.height, pixels: decodeTgaPixels(bytes, tga) };
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/pcx.js
var HEADER_BYTES = 128;
function u163(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength)
    throw new RangeError("PCX field is truncated");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
function parsePcx(bytes, maxScalarBytes) {
  if (bytes.byteLength < HEADER_BYTES)
    throw new TypeError("PCX header is truncated");
  const manufacturer = bytes[0] ?? 0;
  const version = bytes[1] ?? 0;
  const encoding = bytes[2] ?? 0;
  const bitsPerPlane = bytes[3] ?? 0;
  const xmin = u163(bytes, 4);
  const ymin = u163(bytes, 6);
  const xmax = u163(bytes, 8);
  const ymax = u163(bytes, 10);
  const hdpi = u163(bytes, 12);
  const vdpi = u163(bytes, 14);
  const planes = bytes[65] ?? 0;
  const bytesPerLine = u163(bytes, 66);
  const paletteInfo = u163(bytes, 68);
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (manufacturer !== 10 || ![0, 2, 3, 4, 5].includes(version) || ![0, 1].includes(encoding) || bitsPerPlane < 1 || bitsPerPlane > 8 || planes < 1 || planes > 4 || width < 1 || height < 1 || bytesPerLine < Math.ceil(width * bitsPerPlane / 8)) {
    throw new TypeError("PCX manufacturer, version, encoding, dimensions, planes, or stride are invalid");
  }
  const rowBytes = bytesPerLine * planes;
  const decodedBytes = BigInt(width) * BigInt(height) * 4n;
  const supportedPacking = [1, 2, 4, 8].includes(bitsPerPlane);
  const decodedAccess = supportedPacking && decodedBytes <= BigInt(maxScalarBytes) && BigInt(rowBytes) * BigInt(height) <= BigInt(maxScalarBytes);
  const hasVgaPalette = bitsPerPlane === 8 && planes === 1 && bytes.byteLength >= HEADER_BYTES + 769 && bytes[bytes.byteLength - 769] === 12;
  return Object.freeze({
    manufacturer,
    version,
    encoding,
    bitsPerPlane,
    xmin,
    ymin,
    xmax,
    ymax,
    hdpi,
    vdpi,
    planes,
    bytesPerLine,
    paletteInfo,
    width,
    height,
    rowBytes,
    decodedBytes,
    decodedAccess,
    hasVgaPalette,
    headerPalette: bytes.slice(16, 64)
  });
}
function decodeRows(bytes, pcx) {
  const expected = pcx.rowBytes * pcx.height;
  const rows = new Uint8Array(expected);
  const dataEnd = pcx.hasVgaPalette ? bytes.byteLength - 769 : bytes.byteLength;
  let source = HEADER_BYTES;
  let target = 0;
  while (target < expected) {
    if (source >= dataEnd)
      throw new TypeError("PCX image data is truncated");
    const marker = bytes[source] ?? 0;
    source += 1;
    if (pcx.encoding === 1 && (marker & 192) === 192) {
      const count = marker & 63;
      if (count === 0 || source >= dataEnd || target + count > expected) {
        throw new TypeError("PCX RLE packet is invalid or crosses the declared image");
      }
      rows.fill(bytes[source] ?? 0, target, target + count);
      source += 1;
      target += count;
    } else {
      rows[target] = marker;
      target += 1;
    }
  }
  return rows;
}
function packedSample(row, planeOffset, x, bitsPerPlane) {
  const bitOffset = x * bitsPerPlane;
  const byte = row[planeOffset + Math.floor(bitOffset / 8)] ?? 0;
  const shift = 8 - bitsPerPlane - bitOffset % 8;
  return byte >>> shift & (1 << bitsPerPlane) - 1;
}
function paletteIndex(row, x, pcx) {
  let index = 0;
  for (let plane = 0; plane < pcx.planes; plane += 1) {
    const sample = packedSample(row, plane * pcx.bytesPerLine, x, pcx.bitsPerPlane);
    index |= sample << plane * pcx.bitsPerPlane;
  }
  return index;
}
function grayscale(index, pcx) {
  const maximum = (1 << Math.min(8, pcx.bitsPerPlane * pcx.planes)) - 1;
  return maximum === 0 ? 0 : Math.round(index * 255 / maximum);
}
function decodePcxIndices(bytes, pcx) {
  if (pcx.bitsPerPlane * pcx.planes > 8)
    throw new TypeError("PCX image is not indexed");
  const rows = decodeRows(bytes, pcx);
  const indices = new Uint8Array(pcx.width * pcx.height);
  for (let y = 0; y < pcx.height; y += 1) {
    const row = rows.subarray(y * pcx.rowBytes, (y + 1) * pcx.rowBytes);
    for (let x = 0; x < pcx.width; x += 1)
      indices[y * pcx.width + x] = paletteIndex(row, x, pcx);
  }
  return indices;
}
function decodePcxPixels(bytes, pcx) {
  const rows = decodeRows(bytes, pcx);
  const pixels = new Uint8Array(pcx.width * pcx.height * 4);
  const vgaPalette = pcx.hasVgaPalette ? bytes.subarray(bytes.byteLength - 768) : void 0;
  const hasHeaderPalette = pcx.headerPalette.some((value) => value !== 0);
  for (let y = 0; y < pcx.height; y += 1) {
    const row = rows.subarray(y * pcx.rowBytes, (y + 1) * pcx.rowBytes);
    for (let x = 0; x < pcx.width; x += 1) {
      const target = (y * pcx.width + x) * 4;
      if (pcx.bitsPerPlane === 8 && pcx.planes >= 3) {
        pixels[target] = row[x] ?? 0;
        pixels[target + 1] = row[pcx.bytesPerLine + x] ?? 0;
        pixels[target + 2] = row[pcx.bytesPerLine * 2 + x] ?? 0;
        pixels[target + 3] = pcx.planes === 4 ? row[pcx.bytesPerLine * 3 + x] ?? 255 : 255;
        continue;
      }
      const index = paletteIndex(row, x, pcx);
      let red;
      let green;
      let blue;
      if (pcx.paletteInfo !== 2 && pcx.bitsPerPlane === 8 && pcx.planes === 1 && vgaPalette) {
        red = vgaPalette[index * 3] ?? 0;
        green = vgaPalette[index * 3 + 1] ?? 0;
        blue = vgaPalette[index * 3 + 2] ?? 0;
      } else if (pcx.paletteInfo !== 2 && hasHeaderPalette && index < 16) {
        red = pcx.headerPalette[index * 3] ?? 0;
        green = pcx.headerPalette[index * 3 + 1] ?? 0;
        blue = pcx.headerPalette[index * 3 + 2] ?? 0;
      } else {
        red = grayscale(index, pcx);
        green = red;
        blue = red;
      }
      pixels[target] = red;
      pixels[target + 1] = green;
      pixels[target + 2] = blue;
      pixels[target + 3] = 255;
    }
  }
  return pixels;
}
function decodePcx(bytes, maxDecodedBytes = 64 * 1024 * 1024) {
  const pcx = parsePcx(bytes, maxDecodedBytes);
  if (!pcx.decodedAccess)
    throw new RangeError("PCX image cannot be decoded within the budget");
  return { width: pcx.width, height: pcx.height, pixels: decodePcxPixels(bytes, pcx) };
}

export {
  encodePng,
  encodeGreyPng,
  encodeTga,
  encodeIconDib,
  decodePngSamples,
  greyDepthFor,
  greyGridToPng,
  greyGridFromPng,
  decodeBaselineJpegPlanes,
  decodeBaselineJpeg,
  readJpegFrameInfo,
  surfaceRegionReader,
  findEmbeddedImage,
  plausibleTgaHeader,
  parseTga,
  decodeTgaPixels,
  decodeTga,
  parsePcx,
  decodePcxIndices,
  decodePcxPixels,
  decodePcx
};
