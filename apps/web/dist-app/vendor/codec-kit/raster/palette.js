import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/palette.js
var latin1 = new TextDecoder("latin1");
function tag(bytes, offset) {
  return latin1.decode(bytes.subarray(offset, offset + 4));
}
function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength)
    throw new RangeError("PAL field is truncated");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength)
    throw new RangeError("PAL field is truncated");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
function isJascPalette(bytes) {
  return latin1.decode(bytes.subarray(0, Math.min(bytes.byteLength, 16))).startsWith("JASC-PAL");
}
function isRiffPalette(bytes) {
  return bytes.byteLength >= 12 && tag(bytes, 0) === "RIFF" && tag(bytes, 8) === "PAL ";
}
function emptyColors() {
  const colors = new Uint8Array(256 * 4);
  for (let index = 3; index < colors.length; index += 4)
    colors[index] = 255;
  return colors;
}
function parseJasc(bytes, maxNodes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n/g, "\n");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "JASC-PAL" || lines.length < 3 || lines.length > maxNodes) {
    throw new TypeError("JASC-PAL header or line count is invalid");
  }
  const version = lines[1] ?? "";
  const count = Number(lines[2]);
  if (!/^\d{4}$/u.test(version) || !Number.isSafeInteger(count) || count < 1 || count > 256) {
    throw new TypeError("JASC-PAL version or color count is invalid");
  }
  if (lines.length !== count + 3) {
    throw new TypeError("JASC-PAL color count does not match its rows");
  }
  const colors = emptyColors();
  for (let index = 0; index < count; index += 1) {
    const values = (lines[index + 3] ?? "").split(/\s+/u).map(Number);
    if (values.length !== 3 || !values.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 255)) {
      throw new TypeError(`JASC-PAL color ${index} is invalid`);
    }
    colors.set(values, index * 4);
  }
  return Object.freeze({ format: "jasc-pal", count, version, colors });
}
function parseRiff(bytes, maxNodes) {
  const end = 8 + u32(bytes, 4);
  if (end !== bytes.byteLength) {
    throw new TypeError("RIFF PAL declared size does not match the source");
  }
  let offset = 12;
  let nodes = 0;
  while (offset < end) {
    if (nodes >= maxNodes)
      throw new RangeError("RIFF PAL chunk count exceeds maxNodes budget");
    nodes += 1;
    if (offset + 8 > end)
      throw new TypeError("RIFF PAL chunk header is truncated");
    const id = tag(bytes, offset);
    const size = u32(bytes, offset + 4);
    const payload = offset + 8;
    if (payload + size > end)
      throw new TypeError(`RIFF PAL ${id} chunk is truncated`);
    if (id === "data") {
      if (size < 4)
        throw new TypeError("RIFF PAL data chunk is too short");
      const version = u16(bytes, payload);
      const count = u16(bytes, payload + 2);
      if (count < 1 || count > 256 || 4 + count * 4 > size) {
        throw new TypeError("RIFF PAL entry count is invalid");
      }
      const colors = emptyColors();
      for (let index = 0; index < count; index += 1) {
        const source = payload + 4 + index * 4;
        colors[index * 4] = bytes[source] ?? 0;
        colors[index * 4 + 1] = bytes[source + 1] ?? 0;
        colors[index * 4 + 2] = bytes[source + 2] ?? 0;
      }
      return Object.freeze({
        format: "riff-pal",
        count,
        version: `0x${version.toString(16)}`,
        colors
      });
    }
    offset = payload + size + (size & 1);
  }
  throw new TypeError("RIFF PAL data chunk is missing");
}
function parseBinary(bytes) {
  if (bytes.byteLength === 1024) {
    const colors2 = emptyColors();
    for (let index = 0; index < 256; index += 1) {
      for (let channel = 0; channel < 3; channel += 1)
        colors2[index * 4 + channel] = bytes[index * 4 + channel] ?? 0;
    }
    return Object.freeze({ format: "rgbx-8bit", count: 256, version: "raw", colors: colors2 });
  }
  if (bytes.byteLength !== 768)
    throw new TypeError("raw PAL must contain exactly 256 RGB entries (768 bytes) or RGBx entries (1024 bytes)");
  const sixBit = bytes.every((value) => value <= 63);
  const colors = emptyColors();
  for (let index = 0; index < 256; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = bytes[index * 3 + channel] ?? 0;
      colors[index * 4 + channel] = sixBit ? value << 2 | value >>> 4 : value;
    }
  }
  return Object.freeze({
    format: sixBit ? "westwood-6bit" : "rgb-8bit",
    count: 256,
    version: "raw",
    colors
  });
}
function parsePalette(bytes, maxNodes) {
  if (isJascPalette(bytes))
    return parseJasc(bytes, maxNodes);
  if (isRiffPalette(bytes))
    return parseRiff(bytes, maxNodes);
  return parseBinary(bytes);
}
function nearestPaletteIndex(colors, r, g, b, skip) {
  if (colors.byteLength !== 256 * 4)
    throw new RangeError("palette must hold 256 RGBA entries");
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 256; index += 1) {
    if (index === skip)
      continue;
    const dr = (colors[index * 4] ?? 0) - r;
    const dg = (colors[index * 4 + 1] ?? 0) - g;
    const db = (colors[index * 4 + 2] ?? 0) - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
function quantizeToPalette(pixels, colors, options = {}) {
  if (pixels.byteLength % 4 !== 0)
    throw new RangeError("RGBA8 pixels come in groups of four");
  const threshold = options.alphaThreshold ?? 128;
  const out = new Uint8Array(pixels.byteLength / 4);
  const cache = /* @__PURE__ */ new Map();
  for (let pixel = 0; pixel < out.byteLength; pixel += 1) {
    const at = pixel * 4;
    if ((pixels[at + 3] ?? 0) < threshold && options.transparent !== void 0) {
      out[pixel] = options.transparent;
      continue;
    }
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    const key = r << 16 | g << 8 | b;
    let index = cache.get(key);
    if (index === void 0) {
      index = nearestPaletteIndex(colors, r, g, b, options.transparent);
      cache.set(key, index);
    }
    out[pixel] = index;
  }
  return out;
}
function applyPalette(indices, colors, transparent) {
  if (colors.byteLength !== 256 * 4)
    throw new RangeError("palette must hold 256 RGBA entries");
  const out = new Uint8Array(indices.byteLength * 4);
  for (let pixel = 0; pixel < indices.byteLength; pixel += 1) {
    const index = indices[pixel] ?? 0;
    if (index === transparent)
      continue;
    out.set(colors.subarray(index * 4, index * 4 + 4), pixel * 4);
  }
  return out;
}
export {
  applyPalette,
  isJascPalette,
  isRiffPalette,
  nearestPaletteIndex,
  parsePalette,
  quantizeToPalette
};
