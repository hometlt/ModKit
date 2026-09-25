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
 * The block compressor itself is shared: `@modkit/codec-kit/texture/bc` (`encodeDxt`), which every
 * codec that stores BC1–BC3 blocks uses. What stays here is the DDS container.
 *
 * The encoder writes a 128-byte legacy header (no DX10 block) and a single mip level; the header's
 * declared `dwMipMapCount` is whatever the caller passes, which is exactly what legacy did.
 */

import { chooseDxtEncoding, encodeDxt } from '@modkit/codec-kit/texture/bc'

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
  if (format !== 'rgba8') payload = encodeDxt(image, format)
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

/** The format legacy picked for `auto`: DXT5 once any texel is partially transparent, else DXT1. */
export const chooseDdsFormatForImage = chooseDxtEncoding

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
