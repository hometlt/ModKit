/**
 * PNG → samples, the one PNG decoder of the shared layer.
 *
 * Grids that are not colours — a map's heights, cliff levels, masks — travel as 8- or 16-bit PNG,
 * and an image editor may save them back as grey, grey with alpha, RGB, RGBA or palette. This reads
 * every non-interlaced PNG to its samples at their own depth, so a caller keeps 16-bit precision
 * instead of an RGBA8 approximation. It replaces the private decoders the SC2 map images and the
 * images extension each carried (filters, Paeth and a CRC table of their own).
 */
import { decompressBounded } from '../compression/bounded.js'
import { encodeGreyPng } from './encoders.js'

const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS = new Map<number, 1 | 2 | 3 | 4>([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
])
const DEFAULT_MAX_PIXELS = 64 * 1024 * 1024

export interface PngSamples {
  readonly width: number
  readonly height: number
  /** Sample depth after decoding: palette and sub-byte grey images expand to 8. */
  readonly bitDepth: 8 | 16
  /** 1 grey, 2 grey + alpha, 3 RGB, 4 RGBA (a palette image decodes to RGB or RGBA). */
  readonly channels: 1 | 2 | 3 | 4
  /** Row-major, top row first, `channels` samples per pixel. */
  readonly samples: Uint16Array
}

export interface PngDecodeOptions {
  readonly maxPixels?: number
  readonly signal?: AbortSignal
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export async function decodePngSamples(
  bytes: Uint8Array,
  options: PngDecodeOptions = {},
): Promise<PngSamples> {
  if (bytes.byteLength < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new TypeError('not a PNG: bad signature')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let colorType = -1
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const data: Uint8Array[] = []
  for (let offset = 8; offset + 12 <= bytes.byteLength; ) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (body.byteLength !== length) throw new RangeError(`PNG chunk ${type} is truncated`)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8, false)
      height = view.getUint32(offset + 12, false)
      depth = body[8] ?? 0
      colorType = body[9] ?? -1
      if (body[12] !== 0) throw new TypeError('interlaced PNG is not supported')
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const stored = CHANNELS.get(colorType)
  if (stored === undefined || ![1, 2, 4, 8, 16].includes(depth) || width < 1 || height < 1) {
    throw new TypeError(`unsupported PNG: colour type ${colorType}, bit depth ${depth}`)
  }
  if ((colorType === 3 && (palette === undefined || depth === 16)) || (depth < 8 && ![0, 3].includes(colorType))) {
    throw new TypeError(`unsupported PNG: colour type ${colorType}, bit depth ${depth}`)
  }
  if (width * height > (options.maxPixels ?? DEFAULT_MAX_PIXELS)) {
    throw new RangeError(`PNG ${width}x${height} exceeds the pixel bound`)
  }
  const rowBytes = Math.ceil((width * stored * depth) / 8)
  const pixelBytes = Math.max(1, (stored * depth) / 8)
  const compressed = new Uint8Array(data.reduce((total, part) => total + part.byteLength, 0))
  data.reduce((offset, part) => (compressed.set(part, offset), offset + part.byteLength), 0)
  const raw = await decompressBounded(compressed, 'deflate', {
    maxOutputBytes: (rowBytes + 1) * height,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (raw.byteLength !== (rowBytes + 1) * height) throw new RangeError('PNG image data is truncated')
  const rows = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)]
    const row = y * rowBytes
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[y * (rowBytes + 1) + 1 + x] as number
      const a = x >= pixelBytes ? (rows[row + x - pixelBytes] as number) : 0
      const b = y > 0 ? (rows[row - rowBytes + x] as number) : 0
      const c = y > 0 && x >= pixelBytes ? (rows[row - rowBytes + x - pixelBytes] as number) : 0
      const predicted =
        filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : -1
      if (predicted < 0) throw new TypeError(`PNG row ${y} has unknown filter ${String(filter)}`)
      rows[row + x] = (value + predicted) & 0xff
    }
  }
  const sampleAt = (y: number, index: number): number => {
    if (depth === 16) return ((rows[y * rowBytes + index * 2] as number) << 8) | (rows[y * rowBytes + index * 2 + 1] as number)
    if (depth === 8) return rows[y * rowBytes + index] as number
    const bit = index * depth
    return ((rows[y * rowBytes + (bit >> 3)] as number) >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
  }
  if (colorType === 3) {
    const alpha = transparency !== undefined
    const channels = alpha ? 4 : 3
    const samples = new Uint16Array(width * height * channels)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const entry = sampleAt(y, x)
        if (entry * 3 + 2 >= palette!.byteLength) {
          throw new TypeError(`indexed PNG pixel refers to absent palette entry ${entry}`)
        }
        const out = (y * width + x) * channels
        for (let channel = 0; channel < 3; channel += 1) samples[out + channel] = palette![entry * 3 + channel] ?? 0
        if (alpha) samples[out + 3] = transparency![entry] ?? 255
      }
    }
    return Object.freeze({ width, height, bitDepth: 8, channels, samples })
  }
  const samples = new Uint16Array(width * height * stored)
  // Sub-byte grey scales to the full 8-bit range, as a viewer shows it.
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
  for (let y = 0; y < height; y += 1) {
    for (let index = 0; index < width * stored; index += 1) {
      samples[y * width * stored + index] = Math.round(sampleAt(y, index) * scale)
    }
  }
  return Object.freeze({ width, height, bitDepth: depth === 16 ? 16 : 8, channels: stored, samples })
}

/** A grid of integers — a map's heights, levels, masks — as an image carries it. */
export interface GreyGrid {
  readonly width: number
  readonly height: number
  /** Row-major, top row first. */
  readonly values: readonly number[]
}

/** The narrowest grey depth that holds `maximum`. */
export const greyDepthFor = (maximum: number): 8 | 16 => (maximum > 0xff ? 16 : 8)

/** A grid within `0..maximum` → grey PNG at the narrowest depth that holds it, every value exact. */
export async function greyGridToPng(
  grid: GreyGrid,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 0xffff) {
    throw new RangeError(`a grey grid's maximum must be 0..65535, not ${maximum}`)
  }
  return encodeGreyPng(grid.width, grid.height, grid.values, greyDepthFor(maximum), signal)
}

/**
 * A PNG → the grid it carries, for a grid of `width`×`height` within `minimum..maximum`. The first
 * channel is read (grey, or red of an RGB export — an editor may save grey as colour). A PNG at
 * another depth than the grid's is rescaled over the full range (8-bit 255 → 16-bit 65535), since
 * an editor that saved a 16-bit heightmap as 8 bits kept its shape, not its numbers.
 */
export async function greyGridFromPng(
  png: Uint8Array,
  expected: { readonly width: number; readonly height: number; readonly minimum: number; readonly maximum: number },
  signal?: AbortSignal,
): Promise<GreyGrid> {
  const image = await decodePngSamples(png, { maxPixels: expected.width * expected.height, ...(signal === undefined ? {} : { signal }) })
  if (image.width !== expected.width || image.height !== expected.height) {
    throw new RangeError(`the image is ${image.width}x${image.height}; the grid is ${expected.width}x${expected.height}`)
  }
  const depth = greyDepthFor(expected.maximum)
  const scale = image.bitDepth === depth ? 1 : depth === 16 ? 257 : 1 / 257
  const values = new Array<number>(image.width * image.height)
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.round((image.samples[index * image.channels] as number) * scale)
    if (value < expected.minimum || value > expected.maximum) {
      throw new RangeError(
        `pixel ${index % image.width},${Math.floor(index / image.width)} is ${value}, outside ${expected.minimum}..${expected.maximum}`,
      )
    }
    values[index] = value
  }
  return Object.freeze({ width: image.width, height: image.height, values: Object.freeze(values) })
}
