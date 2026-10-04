/**
 * ZSoft PCX reading: the header, the palette indices of indexed images and RGBA8 pixels (VGA
 * trailer, 16-colour header palette or grey ramp; 24/32-bit planar). Moved unchanged from the core
 * images extension's PCX codec, which now reads through it, so a game that keeps colour tables in
 * PCX (StarCraft's `game/tunit.pcx`: palette indices of the player colours) reads them with the
 * same code.
 */
import type { RgbaImage } from './image.js'

const HEADER_BYTES = 128

export interface PcxHeader {
  readonly manufacturer: number
  readonly version: number
  readonly encoding: number
  readonly bitsPerPlane: number
  readonly xmin: number
  readonly ymin: number
  readonly xmax: number
  readonly ymax: number
  readonly hdpi: number
  readonly vdpi: number
  readonly planes: number
  readonly bytesPerLine: number
  readonly paletteInfo: number
  readonly width: number
  readonly height: number
  readonly rowBytes: number
  readonly decodedBytes: bigint
  /** Pixels can be decoded: a supported packing, within the byte budget. */
  readonly decodedAccess: boolean
  /** 8-bit single-plane images may end with `0x0c` and a 256-colour RGB palette. */
  readonly hasVgaPalette: boolean
  readonly headerPalette: Uint8Array
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('PCX field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

/** The header of a PCX image; `maxScalarBytes` bounds what `decodedAccess` promises to decode. */
export function parsePcx(bytes: Uint8Array, maxScalarBytes: number): PcxHeader {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('PCX header is truncated')
  const manufacturer = bytes[0] ?? 0
  const version = bytes[1] ?? 0
  const encoding = bytes[2] ?? 0
  const bitsPerPlane = bytes[3] ?? 0
  const xmin = u16(bytes, 4)
  const ymin = u16(bytes, 6)
  const xmax = u16(bytes, 8)
  const ymax = u16(bytes, 10)
  const hdpi = u16(bytes, 12)
  const vdpi = u16(bytes, 14)
  const planes = bytes[65] ?? 0
  const bytesPerLine = u16(bytes, 66)
  const paletteInfo = u16(bytes, 68)
  const width = xmax - xmin + 1
  const height = ymax - ymin + 1
  if (
    manufacturer !== 0x0a ||
    ![0, 2, 3, 4, 5].includes(version) ||
    ![0, 1].includes(encoding) ||
    bitsPerPlane < 1 ||
    bitsPerPlane > 8 ||
    planes < 1 ||
    planes > 4 ||
    width < 1 ||
    height < 1 ||
    bytesPerLine < Math.ceil((width * bitsPerPlane) / 8)
  ) {
    throw new TypeError(
      'PCX manufacturer, version, encoding, dimensions, planes, or stride are invalid',
    )
  }
  const rowBytes = bytesPerLine * planes
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const supportedPacking = [1, 2, 4, 8].includes(bitsPerPlane)
  const decodedAccess =
    supportedPacking &&
    decodedBytes <= BigInt(maxScalarBytes) &&
    BigInt(rowBytes) * BigInt(height) <= BigInt(maxScalarBytes)
  const hasVgaPalette =
    bitsPerPlane === 8 &&
    planes === 1 &&
    bytes.byteLength >= HEADER_BYTES + 769 &&
    bytes[bytes.byteLength - 769] === 0x0c
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
    headerPalette: bytes.slice(16, 64),
  })
}

function decodeRows(bytes: Uint8Array, pcx: PcxHeader): Uint8Array {
  const expected = pcx.rowBytes * pcx.height
  const rows = new Uint8Array(expected)
  const dataEnd = pcx.hasVgaPalette ? bytes.byteLength - 769 : bytes.byteLength
  let source = HEADER_BYTES
  let target = 0
  while (target < expected) {
    if (source >= dataEnd) throw new TypeError('PCX image data is truncated')
    const marker = bytes[source] ?? 0
    source += 1
    if (pcx.encoding === 1 && (marker & 0xc0) === 0xc0) {
      const count = marker & 0x3f
      if (count === 0 || source >= dataEnd || target + count > expected) {
        throw new TypeError('PCX RLE packet is invalid or crosses the declared image')
      }
      rows.fill(bytes[source] ?? 0, target, target + count)
      source += 1
      target += count
    } else {
      rows[target] = marker
      target += 1
    }
  }
  return rows
}

function packedSample(
  row: Uint8Array,
  planeOffset: number,
  x: number,
  bitsPerPlane: number,
): number {
  const bitOffset = x * bitsPerPlane
  const byte = row[planeOffset + Math.floor(bitOffset / 8)] ?? 0
  const shift = 8 - bitsPerPlane - (bitOffset % 8)
  return (byte >>> shift) & ((1 << bitsPerPlane) - 1)
}

function paletteIndex(row: Uint8Array, x: number, pcx: PcxHeader): number {
  let index = 0
  for (let plane = 0; plane < pcx.planes; plane += 1) {
    const sample = packedSample(row, plane * pcx.bytesPerLine, x, pcx.bitsPerPlane)
    index |= sample << (plane * pcx.bitsPerPlane)
  }
  return index
}

function grayscale(index: number, pcx: PcxHeader): number {
  const maximum = (1 << Math.min(8, pcx.bitsPerPlane * pcx.planes)) - 1
  return maximum === 0 ? 0 : Math.round((index * 255) / maximum)
}

/**
 * The palette index of every pixel, row-major, of an indexed image (at most 8 bits per pixel over
 * all planes) — what a game that remaps colours reads instead of the image's own palette.
 */
export function decodePcxIndices(bytes: Uint8Array, pcx: PcxHeader): Uint8Array {
  if (pcx.bitsPerPlane * pcx.planes > 8) throw new TypeError('PCX image is not indexed')
  const rows = decodeRows(bytes, pcx)
  const indices = new Uint8Array(pcx.width * pcx.height)
  for (let y = 0; y < pcx.height; y += 1) {
    const row = rows.subarray(y * pcx.rowBytes, (y + 1) * pcx.rowBytes)
    for (let x = 0; x < pcx.width; x += 1) indices[y * pcx.width + x] = paletteIndex(row, x, pcx)
  }
  return indices
}

/** Straight RGBA8 pixels, top-left origin. */
export function decodePcxPixels(bytes: Uint8Array, pcx: PcxHeader): Uint8Array {
  const rows = decodeRows(bytes, pcx)
  const pixels = new Uint8Array(pcx.width * pcx.height * 4)
  const vgaPalette = pcx.hasVgaPalette ? bytes.subarray(bytes.byteLength - 768) : undefined
  const hasHeaderPalette = pcx.headerPalette.some(value => value !== 0)
  for (let y = 0; y < pcx.height; y += 1) {
    const row = rows.subarray(y * pcx.rowBytes, (y + 1) * pcx.rowBytes)
    for (let x = 0; x < pcx.width; x += 1) {
      const target = (y * pcx.width + x) * 4
      if (pcx.bitsPerPlane === 8 && pcx.planes >= 3) {
        pixels[target] = row[x] ?? 0
        pixels[target + 1] = row[pcx.bytesPerLine + x] ?? 0
        pixels[target + 2] = row[pcx.bytesPerLine * 2 + x] ?? 0
        pixels[target + 3] = pcx.planes === 4 ? (row[pcx.bytesPerLine * 3 + x] ?? 255) : 255
        continue
      }
      const index = paletteIndex(row, x, pcx)
      let red: number
      let green: number
      let blue: number
      // A valid indexed VGA trailer is authoritative, even with a grayscale header hint.
      if (pcx.bitsPerPlane === 8 && pcx.planes === 1 && vgaPalette) {
        red = vgaPalette[index * 3] ?? 0
        green = vgaPalette[index * 3 + 1] ?? 0
        blue = vgaPalette[index * 3 + 2] ?? 0
      } else if (pcx.paletteInfo !== 2 && hasHeaderPalette && index < 16) {
        red = pcx.headerPalette[index * 3] ?? 0
        green = pcx.headerPalette[index * 3 + 1] ?? 0
        blue = pcx.headerPalette[index * 3 + 2] ?? 0
      } else {
        red = grayscale(index, pcx)
        green = red
        blue = red
      }
      pixels[target] = red
      pixels[target + 1] = green
      pixels[target + 2] = blue
      pixels[target + 3] = 255
    }
  }
  return pixels
}

/** A whole PCX image as RGBA8; refuses one beyond `maxDecodedBytes` or of an unsupported packing. */
export function decodePcx(bytes: Uint8Array, maxDecodedBytes = 64 * 1024 * 1024): RgbaImage {
  const pcx = parsePcx(bytes, maxDecodedBytes)
  if (!pcx.decodedAccess) throw new RangeError('PCX image cannot be decoded within the budget')
  return { width: pcx.width, height: pcx.height, pixels: decodePcxPixels(bytes, pcx) }
}
