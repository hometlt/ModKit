/**
 * BC1/BC2/BC3 (DXT1/DXT3/DXT5) block compression, shared by every codec that stores these blocks.
 *
 * Ported from MK2 `extensions/common/images/codecs/dds/src/dds.ts` (`encodeDxt1`, `encodeDxt3`,
 * `encodeDxt5`, `writeColorBlock`, `writeAlphaBlock`, `writeExplicitAlphaBlock`, `rgb565`,
 * `colorPalette`, `colorDistance`) by way of MK3's `extensions/images/src/dds/encode.js`, with no
 * change in behaviour: a min/max bounding-box endpoint fit with nearest-palette index selection,
 * rounding included, because the acceptance criterion is byte identity with MK2. A better
 * compressor would be a different change with its own evidence.
 *
 * Only the blocks live here. The file around them — a DDS header, a KTX level table, a game's
 * texture wrapper — belongs to the codec that owns that container.
 */
import type { RgbaImage } from '../raster/image.js'

export type DxtEncoding = 'dxt1' | 'dxt3' | 'dxt5'

type Rgb = readonly [number, number, number]

const at = (pixels: Uint8Array, index: number): number => pixels[index] as number

function rgb565(red: number, green: number, blue: number): number {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >>> 3)
}

/** 565 → 8-bit by bit replication, as D3D specifies and as the DDS decoder does. */
function expand565(value: number): Rgb {
  const red = (value >>> 11) & 0x1f
  const green = (value >>> 5) & 0x3f
  const blue = value & 0x1f
  return [(red << 3) | (red >>> 2), (green << 2) | (green >>> 4), (blue << 3) | (blue >>> 2)]
}

function colorPalette(first: number, second: number, fourColor: boolean): readonly Rgb[] {
  const a = expand565(first)
  const b = expand565(second)
  if (fourColor || first > second) {
    return [
      a,
      b,
      [
        Math.round((2 * a[0] + b[0]) / 3),
        Math.round((2 * a[1] + b[1]) / 3),
        Math.round((2 * a[2] + b[2]) / 3),
      ],
      [
        Math.round((a[0] + 2 * b[0]) / 3),
        Math.round((a[1] + 2 * b[1]) / 3),
        Math.round((a[2] + 2 * b[2]) / 3),
      ],
    ]
  }
  return [
    a,
    b,
    [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round((a[2] + b[2]) / 2)],
    [0, 0, 0],
  ]
}

function colorDistance(candidate: Rgb, red: number, green: number, blue: number): number {
  const dr = candidate[0] - red
  const dg = candidate[1] - green
  const db = candidate[2] - blue
  return dr * dr + dg * dg + db * db
}

/**
 * One 8-byte BC1 colour block.
 *
 * Endpoints are the corners of the block's RGB bounding box, quantized to 565. `forceFourColor`
 * is the DXT3/DXT5 case, where the three-colour-plus-transparent mode does not exist; in the DXT1
 * case a texel whose alpha is below 128 is forced onto index 3, which the decoder reads as
 * transparent black.
 */
function writeColorBlock(
  out: Uint8Array,
  offset: number,
  image: RgbaImage,
  blockX: number,
  blockY: number,
  forceFourColor: boolean,
): void {
  let minRed = 255
  let minGreen = 255
  let minBlue = 255
  let maxRed = 0
  let maxGreen = 0
  let maxBlue = 0
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x)
      const pixel = (sourceY * image.width + sourceX) * 4
      const red = at(image.pixels, pixel)
      const green = at(image.pixels, pixel + 1)
      const blue = at(image.pixels, pixel + 2)
      minRed = Math.min(minRed, red)
      minGreen = Math.min(minGreen, green)
      minBlue = Math.min(minBlue, blue)
      maxRed = Math.max(maxRed, red)
      maxGreen = Math.max(maxGreen, green)
      maxBlue = Math.max(maxBlue, blue)
    }
  }

  let first = rgb565(maxRed, maxGreen, maxBlue)
  let second = rgb565(minRed, minGreen, minBlue)
  if (forceFourColor && first <= second) [first, second] = [second, first]
  if (!forceFourColor && first < second) [first, second] = [second, first]

  out[offset] = first & 0xff
  out[offset + 1] = first >>> 8
  out[offset + 2] = second & 0xff
  out[offset + 3] = second >>> 8

  const palette = colorPalette(first, second, forceFourColor)
  let bits = 0
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x)
      const pixel = (sourceY * image.width + sourceX) * 4
      let best = at(image.pixels, pixel + 3) < 128 && !forceFourColor ? 3 : 0
      let bestDistance = best === 3 ? 0 : Number.POSITIVE_INFINITY
      if (best !== 3) {
        for (let index = 0; index < (forceFourColor ? 4 : 3); index += 1) {
          const distance = colorDistance(
            palette[index] as Rgb,
            at(image.pixels, pixel),
            at(image.pixels, pixel + 1),
            at(image.pixels, pixel + 2),
          )
          if (distance < bestDistance) {
            best = index
            bestDistance = distance
          }
        }
      }
      bits |= best << (2 * (y * 4 + x))
    }
  }

  out[offset + 4] = bits & 0xff
  out[offset + 5] = (bits >>> 8) & 0xff
  out[offset + 6] = (bits >>> 16) & 0xff
  out[offset + 7] = (bits >>> 24) & 0xff
}

/** BC2 explicit alpha: 16 texels of 4-bit alpha, two per byte, row-major. */
function writeExplicitAlphaBlock(
  out: Uint8Array,
  offset: number,
  image: RgbaImage,
  blockX: number,
  blockY: number,
): void {
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 2) {
      const sourceX0 = Math.min(image.width - 1, blockX * 4 + x)
      const sourceX1 = Math.min(image.width - 1, blockX * 4 + x + 1)
      const a0 = Math.max(
        0,
        Math.min(15, Math.round(at(image.pixels, (sourceY * image.width + sourceX0) * 4 + 3) / 17)),
      )
      const a1 = Math.max(
        0,
        Math.min(15, Math.round(at(image.pixels, (sourceY * image.width + sourceX1) * 4 + 3) / 17)),
      )
      out[offset + y * 2 + x / 2] = a0 | (a1 << 4)
    }
  }
}

/** BC3 interpolated alpha: endpoints are the block's alpha extremes, always the 8-value mode. */
function writeAlphaBlock(
  out: Uint8Array,
  offset: number,
  image: RgbaImage,
  blockX: number,
  blockY: number,
): void {
  let minAlpha = 255
  let maxAlpha = 0
  const alphas = new Uint8Array(16)
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x)
      const alpha = at(image.pixels, (sourceY * image.width + sourceX) * 4 + 3)
      alphas[y * 4 + x] = alpha
      minAlpha = Math.min(minAlpha, alpha)
      maxAlpha = Math.max(maxAlpha, alpha)
    }
  }
  out[offset] = maxAlpha
  out[offset + 1] = minAlpha
  const palette = [
    maxAlpha,
    minAlpha,
    Math.round((6 * maxAlpha + minAlpha) / 7),
    Math.round((5 * maxAlpha + 2 * minAlpha) / 7),
    Math.round((4 * maxAlpha + 3 * minAlpha) / 7),
    Math.round((3 * maxAlpha + 4 * minAlpha) / 7),
    Math.round((2 * maxAlpha + 5 * minAlpha) / 7),
    Math.round((maxAlpha + 6 * minAlpha) / 7),
  ]
  let bits = 0n
  for (let index = 0; index < 16; index += 1) {
    let best = 0
    let bestDistance = 256
    for (let entry = 0; entry < 8; entry += 1) {
      const distance = Math.abs((palette[entry] as number) - at(alphas, index))
      if (distance < bestDistance) {
        best = entry
        bestDistance = distance
      }
    }
    bits |= BigInt(best) << BigInt(index * 3)
  }
  for (let index = 0; index < 6; index += 1) {
    out[offset + 2 + index] = Number((bits >> BigInt(index * 8)) & 0xffn)
  }
}

/** The blocks of one surface in `encoding`, row-major, edge texels clamped into partial blocks. */
export function encodeDxt(image: RgbaImage, encoding: DxtEncoding): Uint8Array {
  const blocksWide = Math.ceil(image.width / 4)
  const blocksHigh = Math.ceil(image.height / 4)
  const blockBytes = encoding === 'dxt1' ? 8 : 16
  const out = new Uint8Array(blocksWide * blocksHigh * blockBytes)
  let offset = 0
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      if (encoding === 'dxt1') {
        writeColorBlock(out, offset, image, blockX, blockY, false)
      } else {
        if (encoding === 'dxt3') writeExplicitAlphaBlock(out, offset, image, blockX, blockY)
        else writeAlphaBlock(out, offset, image, blockX, blockY)
        writeColorBlock(out, offset + 8, image, blockX, blockY, true)
      }
      offset += blockBytes
    }
  }
  return out
}

/**
 * The encoding MK2 picked for `auto`: DXT5 as soon as one texel is partially transparent, DXT1
 * otherwise. Fully opaque and fully transparent both stay on DXT1, where one bit of alpha is enough.
 */
export function chooseDxtEncoding(image: RgbaImage): 'dxt1' | 'dxt5' {
  for (let index = 3; index < image.pixels.length; index += 4) {
    const alpha = at(image.pixels, index)
    if (alpha > 0 && alpha < 255) return 'dxt5'
  }
  return 'dxt1'
}
