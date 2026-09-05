/**
 * DDS encoding, ported from the legacy MK2 codec.
 *
 * Source: `references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts` (`encodeDds`,
 * `writeHeader`, `encodeDxt1`, `encodeDxt3`, `encodeDxt5`, `writeColorBlock`, `writeAlphaBlock`,
 * `writeExplicitAlphaBlock`, `rgb565`, `colorPalette`, `colorDistance`) and
 * `.../src/helpers.ts` (`chooseDdsFormatForImage`, `createRgbaImage`, `createDdsImage`).
 *
 * This is a phase-A port: same input, same bytes out. The compressor is legacy's — a min/max
 * bounding-box endpoint fit with nearest-palette index selection, not a rate-distortion optimizer —
 * and it is reproduced exactly, rounding included, because the acceptance criterion is byte
 * identity with MK2 rather than image quality. Improving the compressor would be a different
 * change with its own evidence.
 *
 * The encoder writes a 128-byte legacy header (no DX10 block) and a single mip level; the header's
 * declared `dwMipMapCount` is whatever the caller passes, which is exactly what legacy did.
 */

const DDS_MAGIC = 0x2053_4444
const HEADER_SIZE = 124
const PIXEL_FORMAT_SIZE = 32

const DDSD_CAPS = 0x1
const DDSD_HEIGHT = 0x2
const DDSD_WIDTH = 0x4
const DDSD_PITCH = 0x8
const DDSD_PIXELFORMAT = 0x1000
const DDSD_MIPMAPCOUNT = 0x2_0000
const DDSD_LINEARSIZE = 0x8_0000

const DDPF_ALPHAPIXELS = 0x1
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40

const DDSCAPS_COMPLEX = 0x8
const DDSCAPS_TEXTURE = 0x1000
const DDSCAPS_MIPMAP = 0x40_0000

/** The formats legacy could encode. Everything else was refused by name, and still is. */
export const ENCODABLE_FORMATS = Object.freeze(['rgba8', 'dxt1', 'dxt3', 'dxt5'])

function fourCC(text) {
  return (
    text.charCodeAt(0) |
    (text.charCodeAt(1) << 8) |
    (text.charCodeAt(2) << 16) |
    (text.charCodeAt(3) << 24)
  )
}

function checkImage(image) {
  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new TypeError(`DDS: invalid width ${image.width}`)
  }
  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new TypeError(`DDS: invalid height ${image.height}`)
  }
  const expected = image.width * image.height * 4
  if (image.pixels.length !== expected) {
    throw new TypeError(`DDS: expected ${expected} RGBA bytes, got ${image.pixels.length}`)
  }
}

function rgb565(red, green, blue) {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >>> 3)
}

/** 565 → 8-bit by bit replication, as D3D specifies and as the decoder in `codec.js` does. */
function expand565(value) {
  const red = (value >>> 11) & 0x1f
  const green = (value >>> 5) & 0x3f
  const blue = value & 0x1f
  return [(red << 3) | (red >>> 2), (green << 2) | (green >>> 4), (blue << 3) | (blue >>> 2)]
}

function colorPalette(first, second, fourColor) {
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

function colorDistance(candidate, red, green, blue) {
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
function writeColorBlock(out, offset, image, blockX, blockY, forceFourColor) {
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
      const red = image.pixels[pixel]
      const green = image.pixels[pixel + 1]
      const blue = image.pixels[pixel + 2]
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
      let best = image.pixels[pixel + 3] < 128 && !forceFourColor ? 3 : 0
      let bestDistance = best === 3 ? 0 : Number.POSITIVE_INFINITY
      if (best !== 3) {
        for (let index = 0; index < (forceFourColor ? 4 : 3); index += 1) {
          const distance = colorDistance(
            palette[index],
            image.pixels[pixel],
            image.pixels[pixel + 1],
            image.pixels[pixel + 2],
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

function encodeDxt1(image) {
  const blocksWide = Math.ceil(image.width / 4)
  const blocksHigh = Math.ceil(image.height / 4)
  const out = new Uint8Array(blocksWide * blocksHigh * 8)
  let offset = 0
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      writeColorBlock(out, offset, image, blockX, blockY, false)
      offset += 8
    }
  }
  return out
}

/** BC2 explicit alpha: 16 texels of 4-bit alpha, two per byte, row-major. */
function writeExplicitAlphaBlock(out, offset, image, blockX, blockY) {
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 2) {
      const sourceX0 = Math.min(image.width - 1, blockX * 4 + x)
      const sourceX1 = Math.min(image.width - 1, blockX * 4 + x + 1)
      const a0 = Math.max(
        0,
        Math.min(15, Math.round(image.pixels[(sourceY * image.width + sourceX0) * 4 + 3] / 17)),
      )
      const a1 = Math.max(
        0,
        Math.min(15, Math.round(image.pixels[(sourceY * image.width + sourceX1) * 4 + 3] / 17)),
      )
      out[offset + y * 2 + x / 2] = a0 | (a1 << 4)
    }
  }
}

function encodeDxt3(image) {
  const blocksWide = Math.ceil(image.width / 4)
  const blocksHigh = Math.ceil(image.height / 4)
  const out = new Uint8Array(blocksWide * blocksHigh * 16)
  let offset = 0
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      writeExplicitAlphaBlock(out, offset, image, blockX, blockY)
      writeColorBlock(out, offset + 8, image, blockX, blockY, true)
      offset += 16
    }
  }
  return out
}

/** BC3 interpolated alpha: endpoints are the block's alpha extremes, always the 8-value mode. */
function writeAlphaBlock(out, offset, image, blockX, blockY) {
  let minAlpha = 255
  let maxAlpha = 0
  const alphas = new Uint8Array(16)
  for (let y = 0; y < 4; y += 1) {
    const sourceY = Math.min(image.height - 1, blockY * 4 + y)
    for (let x = 0; x < 4; x += 1) {
      const sourceX = Math.min(image.width - 1, blockX * 4 + x)
      const alpha = image.pixels[(sourceY * image.width + sourceX) * 4 + 3]
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
      const distance = Math.abs(palette[entry] - alphas[index])
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

function encodeDxt5(image) {
  const blocksWide = Math.ceil(image.width / 4)
  const blocksHigh = Math.ceil(image.height / 4)
  const out = new Uint8Array(blocksWide * blocksHigh * 16)
  let offset = 0
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      writeAlphaBlock(out, offset, image, blockX, blockY)
      writeColorBlock(out, offset + 8, image, blockX, blockY, true)
      offset += 16
    }
  }
  return out
}

/** The 128-byte legacy header, with the payload space already allocated behind it. */
function writeHeader(width, height, format, payloadLength, mipMapCount) {
  const out = new Uint8Array(128 + payloadLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, DDS_MAGIC, true)
  view.setUint32(4, HEADER_SIZE, true)
  const compressed = format !== 'rgba8'
  view.setUint32(
    8,
    DDSD_CAPS |
      DDSD_HEIGHT |
      DDSD_WIDTH |
      DDSD_PIXELFORMAT |
      (compressed ? DDSD_LINEARSIZE : DDSD_PITCH) |
      (mipMapCount > 1 ? DDSD_MIPMAPCOUNT : 0),
    true,
  )
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, compressed ? payloadLength : width * 4, true)
  view.setUint32(28, mipMapCount, true)
  view.setUint32(76, PIXEL_FORMAT_SIZE, true)
  if (compressed) {
    view.setUint32(80, DDPF_FOURCC, true)
    view.setUint32(
      84,
      fourCC(format === 'dxt1' ? 'DXT1' : format === 'dxt3' ? 'DXT3' : 'DXT5'),
      true,
    )
  } else {
    /* B8G8R8A8, which is what the rgba8 payload below is byte-swapped into. */
    view.setUint32(80, DDPF_RGB | DDPF_ALPHAPIXELS, true)
    view.setUint32(88, 32, true)
    view.setUint32(92, 0x00ff_0000, true)
    view.setUint32(96, 0x0000_ff00, true)
    view.setUint32(100, 0x0000_00ff, true)
    view.setUint32(104, 0xff00_0000, true)
  }
  view.setUint32(
    108,
    DDSCAPS_TEXTURE | (mipMapCount > 1 ? DDSCAPS_COMPLEX | DDSCAPS_MIPMAP : 0),
    true,
  )
  return out
}

/**
 * Encode an RGBA8 raster as a DDS file.
 *
 * `image` is `{ width, height, pixels }` with `pixels` in top-left-first RGBA8 order.
 * `options.format` is one of {@link ENCODABLE_FORMATS} and defaults to `rgba8`;
 * `options.mipMapCount` only sets the header field — one level of pixels is written either way,
 * which is what legacy did.
 */
export function encodeDds(image, options = {}) {
  checkImage(image)
  const format = options.format ?? 'rgba8'
  const mipMapCount = options.mipMapCount ?? 1
  if (!ENCODABLE_FORMATS.includes(format)) {
    throw new TypeError(`DDS: encoding ${format} is not supported`)
  }
  let payload
  if (format === 'dxt1') payload = encodeDxt1(image)
  else if (format === 'dxt3') payload = encodeDxt3(image)
  else if (format === 'dxt5') payload = encodeDxt5(image)
  else {
    payload = new Uint8Array(image.pixels.length)
    for (let index = 0; index < image.width * image.height; index += 1) {
      payload[index * 4] = image.pixels[index * 4 + 2]
      payload[index * 4 + 1] = image.pixels[index * 4 + 1]
      payload[index * 4 + 2] = image.pixels[index * 4]
      payload[index * 4 + 3] = image.pixels[index * 4 + 3]
    }
  }
  const out = writeHeader(image.width, image.height, format, payload.length, mipMapCount)
  out.set(payload, 128)
  return out
}

/**
 * The format legacy picked for an image when the caller said `auto`: DXT5 as soon as one texel is
 * partially transparent, DXT1 otherwise. Fully opaque and fully transparent both stay on DXT1,
 * where the one-bit alpha is enough.
 */
export function chooseDdsFormatForImage(image) {
  for (let index = 3; index < image.pixels.length; index += 4) {
    const alpha = image.pixels[index]
    if (alpha > 0 && alpha < 255) return 'dxt5'
  }
  return 'dxt1'
}

function clampByte(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** A solid-colour RGBA8 raster. Alpha defaults to opaque, every other channel to zero. */
export function createRgbaImage(width, height, fill = { r: 0, g: 0, b: 0, a: 0 }) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new TypeError(`createRgbaImage: invalid width ${width}`)
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new TypeError(`createRgbaImage: invalid height ${height}`)
  }
  const red = clampByte(fill.r)
  const green = clampByte(fill.g)
  const blue = clampByte(fill.b)
  const alpha = clampByte(fill.a ?? 255)
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red
    pixels[index + 1] = green
    pixels[index + 2] = blue
    pixels[index + 3] = alpha
  }
  return { width, height, pixels }
}

/** A solid-colour DDS file, the shortest path from "I need a placeholder texture" to bytes. */
export function createDdsImage(width, height, options = {}) {
  const image = createRgbaImage(width, height, options.fill)
  const format =
    options.format === undefined || options.format === 'auto'
      ? chooseDdsFormatForImage(image)
      : options.format
  return encodeDds(image, { ...options, format })
}
