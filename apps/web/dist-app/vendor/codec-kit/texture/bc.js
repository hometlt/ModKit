import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/texture/bc-decode.js
function bcBlockBytes(format) {
  return format === "DXT1" || format === "BC4" ? 8 : 16;
}
var COLOR_PALETTE = new Uint8Array(16);
var ALPHA_PALETTE = new Uint8Array(8);
var BLOCK_VALUES = new Uint8Array(16);
var BLOCK_VALUES_SECOND = new Uint8Array(16);
var at = (bytes, index) => bytes[index];
function fillColorPalette(first, second, allowTransparent) {
  const p = COLOR_PALETTE;
  const r0 = first >>> 11 & 31;
  const g0 = first >>> 5 & 63;
  const b0 = first & 31;
  const r1 = second >>> 11 & 31;
  const g1 = second >>> 5 & 63;
  const b1 = second & 31;
  p[0] = r0 << 3 | r0 >>> 2;
  p[1] = g0 << 2 | g0 >>> 4;
  p[2] = b0 << 3 | b0 >>> 2;
  p[3] = 255;
  p[4] = r1 << 3 | r1 >>> 2;
  p[5] = g1 << 2 | g1 >>> 4;
  p[6] = b1 << 3 | b1 >>> 2;
  p[7] = 255;
  if (first > second || !allowTransparent) {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((2 * at(p, c) + at(p, 4 + c)) / 3);
      p[12 + c] = Math.round((at(p, c) + 2 * at(p, 4 + c)) / 3);
    }
    p[11] = 255;
    p[15] = 255;
  } else {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((at(p, c) + at(p, 4 + c)) / 2);
      p[12 + c] = 0;
    }
    p[11] = 255;
    p[15] = 0;
  }
}
function fillInterpolatedValues(view, offset, snorm, target) {
  const raw0 = view.getUint8(offset);
  const raw1 = view.getUint8(offset + 1);
  const palette = ALPHA_PALETTE;
  if (snorm) {
    const toSigned = (byte) => Math.max(-127, byte >= 128 ? byte - 256 : byte) / 127;
    const first = toSigned(raw0);
    const second = toSigned(raw1);
    const signedFirst = raw0 >= 128 ? raw0 - 256 : raw0;
    const signedSecond = raw1 >= 128 ? raw1 - 256 : raw1;
    const values = signedFirst > signedSecond ? [
      first,
      second,
      (6 * first + second) / 7,
      (5 * first + 2 * second) / 7,
      (4 * first + 3 * second) / 7,
      (3 * first + 4 * second) / 7,
      (2 * first + 5 * second) / 7,
      (first + 6 * second) / 7
    ] : [
      first,
      second,
      (4 * first + second) / 5,
      (3 * first + 2 * second) / 5,
      (2 * first + 3 * second) / 5,
      (first + 4 * second) / 5,
      -1,
      1
    ];
    for (let index = 0; index < 8; index += 1) {
      palette[index] = Math.round((values[index] * 0.5 + 0.5) * 255);
    }
  } else {
    palette[0] = raw0;
    palette[1] = raw1;
    if (raw0 > raw1) {
      for (let index = 1; index <= 6; index += 1) {
        palette[index + 1] = Math.round(((7 - index) * raw0 + index * raw1) / 7);
      }
    } else {
      for (let index = 1; index <= 4; index += 1) {
        palette[index + 1] = Math.round(((5 - index) * raw0 + index * raw1) / 5);
      }
      palette[6] = 0;
      palette[7] = 255;
    }
  }
  const low = view.getUint8(offset + 2) | view.getUint8(offset + 3) << 8 | view.getUint8(offset + 4) << 16;
  const high = view.getUint8(offset + 5) | view.getUint8(offset + 6) << 8 | view.getUint8(offset + 7) << 16;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const bit = pixel * 3;
    target[pixel] = at(palette, bit < 24 ? low >>> bit & 7 : high >>> bit - 24 & 7);
  }
}
function fillDxt3Alphas(view, offset, target) {
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const packed = view.getUint8(offset + (pixel >>> 1));
    target[pixel] = (packed >>> (pixel & 1) * 4 & 15) * 17;
  }
}
function writeColorBlock(view, offset, output, surface, blockX, blockY, allowTransparent, alphas) {
  fillColorPalette(view.getUint16(offset, true), view.getUint16(offset + 2, true), allowTransparent);
  const indices = view.getUint32(offset + 4, true);
  const { width, height } = surface;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3);
    const y = blockY * 4 + (pixel >>> 2);
    if (x >= width || y >= height)
      continue;
    const target = (y * width + x) * 4;
    const source = (indices >>> pixel * 2 & 3) * 4;
    output[target] = at(COLOR_PALETTE, source);
    output[target + 1] = at(COLOR_PALETTE, source + 1);
    output[target + 2] = at(COLOR_PALETTE, source + 2);
    output[target + 3] = alphas === void 0 ? at(COLOR_PALETTE, source + 3) : at(alphas, pixel);
  }
}
function writeChannelsBlock(output, surface, blockX, blockY, red, green, grey) {
  const { width, height } = surface;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3);
    const y = blockY * 4 + (pixel >>> 2);
    if (x >= width || y >= height)
      continue;
    const target = (y * width + x) * 4;
    output[target] = at(red, pixel);
    output[target + 1] = grey ? at(red, pixel) : at(green, pixel);
    output[target + 2] = grey ? at(red, pixel) : 0;
    output[target + 3] = 255;
  }
}
function decodeBcSurface(bytes, offset, width, height, format, snorm = false) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Uint8Array(width * height * 4);
  const surface = { width, height };
  const decodeBlock = (at3, blockX, blockY) => {
    switch (format) {
      case "DXT1":
        writeColorBlock(view, at3, output, surface, blockX, blockY, true);
        return;
      case "DXT3":
        fillDxt3Alphas(view, at3, BLOCK_VALUES);
        writeColorBlock(view, at3 + 8, output, surface, blockX, blockY, false, BLOCK_VALUES);
        return;
      case "DXT5":
        fillInterpolatedValues(view, at3, false, BLOCK_VALUES);
        writeColorBlock(view, at3 + 8, output, surface, blockX, blockY, false, BLOCK_VALUES);
        return;
      case "BC4":
        fillInterpolatedValues(view, at3, snorm, BLOCK_VALUES);
        writeChannelsBlock(output, surface, blockX, blockY, BLOCK_VALUES, BLOCK_VALUES, true);
        return;
      case "BC5":
        fillInterpolatedValues(view, at3, snorm, BLOCK_VALUES);
        fillInterpolatedValues(view, at3 + 8, snorm, BLOCK_VALUES_SECOND);
        writeChannelsBlock(output, surface, blockX, blockY, BLOCK_VALUES, BLOCK_VALUES_SECOND, false);
    }
  };
  const blockBytes = bcBlockBytes(format);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let cursor = offset;
  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      decodeBlock(cursor, blockX, blockY);
      cursor += blockBytes;
    }
  }
  return output;
}

// packages/codec-kit/dist/texture/bc-encode.js
var at2 = (pixels, index) => pixels[index];
function rgb565(red, green, blue) {
  return (red & 248) << 8 | (green & 252) << 3 | blue >>> 3;
}
function expand565(value) {
  const red = value >>> 11 & 31;
  const green = value >>> 5 & 63;
  const blue = value & 31;
  return [red << 3 | red >>> 2, green << 2 | green >>> 4, blue << 3 | blue >>> 2];
}
function colorPalette(first, second, fourColor) {
  const a = expand565(first);
  const b = expand565(second);
  if (fourColor || first > second) {
    return [
      a,
      b,
      [
        Math.round((2 * a[0] + b[0]) / 3),
        Math.round((2 * a[1] + b[1]) / 3),
        Math.round((2 * a[2] + b[2]) / 3)
      ],
      [
        Math.round((a[0] + 2 * b[0]) / 3),
        Math.round((a[1] + 2 * b[1]) / 3),
        Math.round((a[2] + 2 * b[2]) / 3)
      ]
    ];
  }
  return [
    a,
    b,
    [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round((a[2] + b[2]) / 2)],
    [0, 0, 0]
  ];
}
function colorDistance(candidate, red, green, blue) {
  const dr = candidate[0] - red;
  const dg = candidate[1] - green;
  const db = candidate[2] - blue;
  return dr * dr + dg * dg + db * db;
}
function writeColorBlock2(out, offset, image, blockX, blockY, forceFourColor) {
  let minRed = 255;
  let minGreen = 255;
  let minBlue = 255;
  let maxRed = 0;
  let maxGreen = 0;
  let maxBlue = 0;
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y);
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x);
      const pixel = (sourceY * image.width + sourceX) * 4;
      const red = at2(image.pixels, pixel);
      const green = at2(image.pixels, pixel + 1);
      const blue = at2(image.pixels, pixel + 2);
      minRed = Math.min(minRed, red);
      minGreen = Math.min(minGreen, green);
      minBlue = Math.min(minBlue, blue);
      maxRed = Math.max(maxRed, red);
      maxGreen = Math.max(maxGreen, green);
      maxBlue = Math.max(maxBlue, blue);
    }
  }
  let first = rgb565(maxRed, maxGreen, maxBlue);
  let second = rgb565(minRed, minGreen, minBlue);
  if (forceFourColor && first <= second)
    [first, second] = [second, first];
  if (!forceFourColor && first < second)
    [first, second] = [second, first];
  out[offset] = first & 255;
  out[offset + 1] = first >>> 8;
  out[offset + 2] = second & 255;
  out[offset + 3] = second >>> 8;
  const palette = colorPalette(first, second, forceFourColor);
  let bits = 0;
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y);
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x);
      const pixel = (sourceY * image.width + sourceX) * 4;
      let best = at2(image.pixels, pixel + 3) < 128 && !forceFourColor ? 3 : 0;
      let bestDistance = best === 3 ? 0 : Number.POSITIVE_INFINITY;
      if (best !== 3) {
        for (let index = 0; index < (forceFourColor ? 4 : 3); index += 1) {
          const distance = colorDistance(palette[index], at2(image.pixels, pixel), at2(image.pixels, pixel + 1), at2(image.pixels, pixel + 2));
          if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
          }
        }
      }
      bits |= best << 2 * (y * 4 + x);
    }
  }
  out[offset + 4] = bits & 255;
  out[offset + 5] = bits >>> 8 & 255;
  out[offset + 6] = bits >>> 16 & 255;
  out[offset + 7] = bits >>> 24 & 255;
}
function writeExplicitAlphaBlock(out, offset, image, blockX, blockY) {
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y);
    for (let x = 0; x < 4; x += 2) {
      const sourceX0 = Math.min(image.width - 1, blockX * 4 + x);
      const sourceX1 = Math.min(image.width - 1, blockX * 4 + x + 1);
      const a0 = Math.max(0, Math.min(15, Math.round(at2(image.pixels, (sourceY * image.width + sourceX0) * 4 + 3) / 17)));
      const a1 = Math.max(0, Math.min(15, Math.round(at2(image.pixels, (sourceY * image.width + sourceX1) * 4 + 3) / 17)));
      out[offset + y * 2 + x / 2] = a0 | a1 << 4;
    }
  }
}
function writeAlphaBlock(out, offset, image, blockX, blockY) {
  let minAlpha = 255;
  let maxAlpha = 0;
  const alphas = new Uint8Array(16);
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y);
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x);
      const alpha = at2(image.pixels, (sourceY * image.width + sourceX) * 4 + 3);
      alphas[y * 4 + x] = alpha;
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
    }
  }
  out[offset] = maxAlpha;
  out[offset + 1] = minAlpha;
  const palette = [
    maxAlpha,
    minAlpha,
    Math.round((6 * maxAlpha + minAlpha) / 7),
    Math.round((5 * maxAlpha + 2 * minAlpha) / 7),
    Math.round((4 * maxAlpha + 3 * minAlpha) / 7),
    Math.round((3 * maxAlpha + 4 * minAlpha) / 7),
    Math.round((2 * maxAlpha + 5 * minAlpha) / 7),
    Math.round((maxAlpha + 6 * minAlpha) / 7)
  ];
  let bits = 0n;
  for (let index = 0; index < 16; index += 1) {
    let best = 0;
    let bestDistance = 256;
    for (let entry = 0; entry < 8; entry += 1) {
      const distance = Math.abs(palette[entry] - at2(alphas, index));
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    bits |= BigInt(best) << BigInt(index * 3);
  }
  for (let index = 0; index < 6; index += 1) {
    out[offset + 2 + index] = Number(bits >> BigInt(index * 8) & 0xffn);
  }
}
function encodeDxt(image, encoding) {
  const blocksWide = Math.ceil(image.width / 4);
  const blocksHigh = Math.ceil(image.height / 4);
  const blockBytes = encoding === "dxt1" ? 8 : 16;
  const out = new Uint8Array(blocksWide * blocksHigh * blockBytes);
  let offset = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      if (encoding === "dxt1") {
        writeColorBlock2(out, offset, image, blockX, blockY, false);
      } else {
        if (encoding === "dxt3")
          writeExplicitAlphaBlock(out, offset, image, blockX, blockY);
        else
          writeAlphaBlock(out, offset, image, blockX, blockY);
        writeColorBlock2(out, offset + 8, image, blockX, blockY, true);
      }
      offset += blockBytes;
    }
  }
  return out;
}
function chooseDxtEncoding(image) {
  for (let index = 3; index < image.pixels.length; index += 4) {
    const alpha = at2(image.pixels, index);
    if (alpha > 0 && alpha < 255)
      return "dxt5";
  }
  return "dxt1";
}
export {
  bcBlockBytes,
  chooseDxtEncoding,
  decodeBcSurface,
  encodeDxt
};
