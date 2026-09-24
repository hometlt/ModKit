/**
 * RGBA8 → file bytes for the simple raster formats, one implementation each.
 *
 * PNG was encoded twice in MK3 (the images extension and the scene's PNG writer), each with its
 * own CRC table; TGA and DIB came from MK2's `image-processing/src/core/encoders.ts`
 * (`encodeTgaRgba`, `encodeBmpRgba`) and its ICO codec. A codec that writes one of these formats
 * — or a host that converts to one — calls this module; the container around it (an ICO
 * directory, a game's header) stays with the codec that owns it.
 */
import { crc32Range } from '../checksum/index.js'
import { compressPortable } from '../compression/bounded.js'
import type { RgbaImage } from '../texture/types.js'

const at = (pixels: Uint8Array, index: number): number => pixels[index] as number

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ascii = new TextEncoder()

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength, false)
  out.set(ascii.encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32Range(out, 4, 8 + data.byteLength), false)
  return out
}

/** One PNG from unfiltered scanlines: filter 0 on every row, one zlib IDAT from the platform. */
async function writePng(
  width: number,
  height: number,
  bitDepth: 8 | 16,
  colorType: 0 | 6,
  rowBytes: number,
  row: (y: number, into: Uint8Array) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const raw = new Uint8Array((rowBytes + 1) * height)
  // filter 0 (None) on every scanline: the filter byte is already zero
  for (let y = 0; y < height; y += 1) row(y, raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)))
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  header[8] = bitDepth
  header[9] = colorType
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', await compressPortable(raw, 'deflate', signal)),
    pngChunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.byteLength
  }
  return png
}

/**
 * RGBA8 → PNG: colour type 6, 8 bits per channel, filter 0 on every scanline, one zlib IDAT from
 * the platform's `CompressionStream`. Exact pixels; nothing else about a source file survives.
 */
export async function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const rowBytes = width * 4
  return writePng(width, height, 8, 6, rowBytes, (y, into) => into.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes)), signal)
}

/**
 * Grey samples → PNG: colour type 0 at 8 or 16 bits, row-major, top row first. For grids that are
 * not colours (heights, levels, masks): every sample survives exactly at its depth.
 */
export async function encodeGreyPng(
  width: number,
  height: number,
  samples: ArrayLike<number>,
  bitDepth: 8 | 16,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (samples.length !== width * height) {
    throw new RangeError(`grey PNG needs ${width * height} samples, got ${samples.length}`)
  }
  const maximum = bitDepth === 16 ? 0xffff : 0xff
  const bytes = bitDepth / 8
  return writePng(width, height, bitDepth, 0, width * bytes, (y, into) => {
    for (let x = 0; x < width; x += 1) {
      const value = samples[y * width + x] as number
      if (!Number.isInteger(value) || value < 0 || value > maximum) {
        throw new RangeError(`grey sample ${value} at ${x},${y} is outside 0..${maximum}`)
      }
      if (bitDepth === 16) {
        into[x * 2] = value >> 8
        into[x * 2 + 1] = value & 0xff
      } else into[x] = value
    }
  }, signal)
}

/** RGBA8 → uncompressed 32-bit TGA with a top-left origin — MK2 `encodeTgaRgba`, unchanged. */
export function encodeTga(image: RgbaImage): Uint8Array {
  if (image.width > 0xffff || image.height > 0xffff) {
    throw new TypeError('TGA dimensions exceed 65535')
  }
  const out = new Uint8Array(18 + image.width * image.height * 4)
  const header = new DataView(out.buffer)
  out[2] = 2
  header.setUint16(12, image.width, true)
  header.setUint16(14, image.height, true)
  out[16] = 32
  out[17] = 0x28
  for (let source = 0, target = 18; source < image.pixels.length; source += 4, target += 4) {
    out[target] = at(image.pixels, source + 2)
    out[target + 1] = at(image.pixels, source + 1)
    out[target + 2] = at(image.pixels, source)
    out[target + 3] = at(image.pixels, source + 3)
  }
  return out
}

/**
 * A 32-bit bottom-up DIB as an ICO/CUR entry stores it: BITMAPINFOHEADER with the height doubled
 * for the AND mask, BGRA pixels, then the mask (a transparent pixel is a masked one, for renderers
 * that ignore alpha).
 */
export function encodeIconDib(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image
  const maskRow = Math.ceil(width / 32) * 4
  const out = new Uint8Array(40 + width * height * 4 + maskRow * height)
  const header = new DataView(out.buffer)
  header.setUint32(0, 40, true)
  header.setInt32(4, width, true)
  header.setInt32(8, height * 2, true)
  header.setUint16(12, 1, true)
  header.setUint16(14, 32, true)
  const maskStart = 40 + width * height * 4
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4
      const target = 40 + (row * width + x) * 4
      out[target] = at(pixels, source + 2)
      out[target + 1] = at(pixels, source + 1)
      out[target + 2] = at(pixels, source)
      out[target + 3] = at(pixels, source + 3)
      if (at(pixels, source + 3) === 0) {
        const index = maskStart + row * maskRow + (x >> 3)
        out[index] = at(out, index) | (0x80 >> (x & 7))
      }
    }
  }
  return out
}
