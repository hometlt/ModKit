import {
  bcBlockBytes,
  decodeBcSurface
} from "../../../chunks/chunk-Y4UL3XCN.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/texture/bc-encode.js
var at = (pixels, index) => pixels[index];
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
function writeColorBlock(out, offset, image, blockX, blockY, forceFourColor) {
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
      const red = at(image.pixels, pixel);
      const green = at(image.pixels, pixel + 1);
      const blue = at(image.pixels, pixel + 2);
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
      let best = at(image.pixels, pixel + 3) < 128 && !forceFourColor ? 3 : 0;
      let bestDistance = best === 3 ? 0 : Number.POSITIVE_INFINITY;
      if (best !== 3) {
        for (let index = 0; index < (forceFourColor ? 4 : 3); index += 1) {
          const distance = colorDistance(palette[index], at(image.pixels, pixel), at(image.pixels, pixel + 1), at(image.pixels, pixel + 2));
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
      const a0 = Math.max(0, Math.min(15, Math.round(at(image.pixels, (sourceY * image.width + sourceX0) * 4 + 3) / 17)));
      const a1 = Math.max(0, Math.min(15, Math.round(at(image.pixels, (sourceY * image.width + sourceX1) * 4 + 3) / 17)));
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
      const alpha = at(image.pixels, (sourceY * image.width + sourceX) * 4 + 3);
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
      const distance = Math.abs(palette[entry] - at(alphas, index));
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
        writeColorBlock(out, offset, image, blockX, blockY, false);
      } else {
        if (encoding === "dxt3")
          writeExplicitAlphaBlock(out, offset, image, blockX, blockY);
        else
          writeAlphaBlock(out, offset, image, blockX, blockY);
        writeColorBlock(out, offset + 8, image, blockX, blockY, true);
      }
      offset += blockBytes;
    }
  }
  return out;
}
function chooseDxtEncoding(image) {
  for (let index = 3; index < image.pixels.length; index += 4) {
    const alpha = at(image.pixels, index);
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
