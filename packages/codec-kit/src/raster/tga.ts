/**
 * Truevision TGA reading: the header, and pixels of true-colour and greyscale images (raw or RLE,
 * any origin) as straight RGBA8 with a top-left origin. Moved unchanged from the core images
 * extension's TGA codec, which now reads through it, so a provider that meets a TGA (SC2 Arcade
 * icons are uncompressed 32-bit TGA) decodes it with the same code. Colour-mapped pixels are not
 * decoded (`decodedAccess` false). The writer is `encodeTga` in encoders.ts.
 */
import type { RgbaImage } from '../texture/types.js'

const FOOTER = [
  0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4f, 0x4e, 0x2d, 0x58, 0x46, 0x49, 0x4c, 0x45,
  0x2e, 0x00,
] as const

export interface TgaHeader {
  readonly idBytes: number
  readonly colorMapType: number
  readonly imageType: number
  readonly colorMapFirst: number
  readonly colorMapLength: number
  readonly colorMapDepth: number
  readonly xOrigin: number
  readonly yOrigin: number
  readonly width: number
  readonly height: number
  readonly pixelDepth: number
  readonly descriptor: number
  readonly mapped: boolean
  readonly grayscale: boolean
  readonly rle: boolean
  readonly topOrigin: boolean
  readonly rightOrigin: boolean
  readonly alphaBits: number
  readonly dataOffset: number
  readonly dataEnd: number
  readonly decodedBytes: bigint
  /** Pixels can be decoded: not colour-mapped, a supported depth, and within the byte budget. */
  readonly decodedAccess: boolean
  readonly hasFooter: boolean
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('TGA field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function hasFooter(bytes: Uint8Array): boolean {
  const start = bytes.byteLength - FOOTER.length
  return start >= 0 && FOOTER.every((value, index) => bytes[start + index] === value)
}

/** Whether the first 18 bytes are a TGA header this reader accepts (TGA has no signature). */
export function plausibleTgaHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 18) return false
  const colorMapType = bytes[1] ?? 0
  const imageType = bytes[2] ?? 0
  const width = u16(bytes, 12)
  const height = u16(bytes, 14)
  const pixelDepth = bytes[16] ?? 0
  if (![0, 1].includes(colorMapType) || ![1, 2, 3, 9, 10, 11].includes(imageType) || width === 0 || height === 0) {
    return false
  }
  const mapped = imageType === 1 || imageType === 9
  const grayscale = imageType === 3 || imageType === 11
  if (mapped !== (colorMapType === 1)) return false
  if (mapped && ![8, 16].includes(pixelDepth)) return false
  if (grayscale && ![8, 16].includes(pixelDepth)) return false
  if (!mapped && !grayscale && ![16, 24, 32].includes(pixelDepth)) return false
  return true
}

/** The header of a whole TGA file; `maxDecodedBytes` bounds `decodedAccess` (width × height × 4). */
export function parseTga(bytes: Uint8Array, maxDecodedBytes: number): TgaHeader {
  if (!plausibleTgaHeader(bytes)) throw new TypeError('TGA header is invalid')
  const idBytes = bytes[0] ?? 0
  const colorMapType = bytes[1] ?? 0
  const imageType = bytes[2] ?? 0
  const colorMapFirst = u16(bytes, 3)
  const colorMapLength = u16(bytes, 5)
  const colorMapDepth = bytes[7] ?? 0
  const xOrigin = u16(bytes, 8)
  const yOrigin = u16(bytes, 10)
  const width = u16(bytes, 12)
  const height = u16(bytes, 14)
  const pixelDepth = bytes[16] ?? 0
  const descriptor = bytes[17] ?? 0
  const mapped = imageType === 1 || imageType === 9
  const grayscale = imageType === 3 || imageType === 11
  const rle = imageType >= 9
  const colorMapEntryBytes = Math.ceil(colorMapDepth / 8)
  if (
    (mapped && (colorMapLength === 0 || ![15, 16, 24, 32].includes(colorMapDepth))) ||
    (!mapped && (colorMapLength !== 0 || colorMapType !== 0))
  ) {
    throw new TypeError('TGA color-map declaration is invalid')
  }
  const dataOffset = 18 + idBytes + colorMapLength * colorMapEntryBytes
  const footerBytes = hasFooter(bytes) ? 26 : 0
  const dataEnd = bytes.byteLength - footerBytes
  if (dataOffset >= dataEnd) throw new TypeError('TGA image payload is missing')
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const decodedAccess =
    !mapped &&
    decodedBytes <= BigInt(maxDecodedBytes) &&
    ((!grayscale && [16, 24, 32].includes(pixelDepth)) || (grayscale && [8, 16].includes(pixelDepth)))
  return Object.freeze({
    idBytes, colorMapType, imageType, colorMapFirst, colorMapLength, colorMapDepth, xOrigin, yOrigin,
    width, height, pixelDepth, descriptor, mapped, grayscale, rle,
    topOrigin: (descriptor & 0x20) !== 0,
    rightOrigin: (descriptor & 0x10) !== 0,
    alphaBits: descriptor & 0x0f,
    dataOffset, dataEnd, decodedBytes, decodedAccess,
    hasFooter: footerBytes !== 0,
  })
}

interface Pixel { readonly red: number; readonly green: number; readonly blue: number; readonly alpha: number; readonly next: number }

function readPixel(bytes: Uint8Array, source: number, tga: TgaHeader): Pixel {
  if (tga.grayscale) {
    return {
      red: bytes[source] ?? 0,
      green: bytes[source] ?? 0,
      blue: bytes[source] ?? 0,
      alpha: tga.pixelDepth === 16 ? (bytes[source + 1] ?? 255) : 255,
      next: source + tga.pixelDepth / 8,
    }
  }
  if (tga.pixelDepth === 16) {
    const value = u16(bytes, source)
    return {
      red: Math.round((((value >>> 10) & 0x1f) * 255) / 31),
      green: Math.round((((value >>> 5) & 0x1f) * 255) / 31),
      blue: Math.round(((value & 0x1f) * 255) / 31),
      alpha: tga.alphaBits > 0 ? ((value & 0x8000) === 0 ? 0 : 255) : 255,
      next: source + 2,
    }
  }
  return {
    red: bytes[source + 2] ?? 0,
    green: bytes[source + 1] ?? 0,
    blue: bytes[source] ?? 0,
    alpha: tga.pixelDepth === 32 ? (bytes[source + 3] ?? 255) : 255,
    next: source + tga.pixelDepth / 8,
  }
}

/**
 * RGBA8 pixels, top-left origin, of a header with `decodedAccess`. A colour-mapped file is read as
 * if its indices were pixels, as the images codec always did; `decodeTga` refuses it.
 */
export function decodeTgaPixels(bytes: Uint8Array, tga: TgaHeader): Uint8Array {
  const pixelCount = tga.width * tga.height
  const pixels = new Uint8Array(pixelCount * 4)
  let source = tga.dataOffset
  let filePixel = 0
  const write = (pixel: Pixel) => {
    if (filePixel >= pixelCount) throw new TypeError('TGA packet crosses the declared image')
    const fileX = filePixel % tga.width
    const fileY = Math.floor(filePixel / tga.width)
    const targetX = tga.rightOrigin ? tga.width - 1 - fileX : fileX
    const targetY = tga.topOrigin ? fileY : tga.height - 1 - fileY
    const target = (targetY * tga.width + targetX) * 4
    pixels[target] = pixel.red
    pixels[target + 1] = pixel.green
    pixels[target + 2] = pixel.blue
    pixels[target + 3] = pixel.alpha
    filePixel += 1
  }
  while (filePixel < pixelCount) {
    if (source >= tga.dataEnd) throw new TypeError('TGA image data is truncated')
    if (tga.rle) {
      const packet = bytes[source] ?? 0
      source += 1
      const count = (packet & 0x7f) + 1
      if (filePixel + count > pixelCount) throw new TypeError('TGA RLE packet is too long')
      if ((packet & 0x80) !== 0) {
        const pixel = readPixel(bytes, source, tga)
        if (pixel.next > tga.dataEnd) throw new TypeError('TGA RLE pixel is truncated')
        source = pixel.next
        for (let index = 0; index < count; index += 1) write(pixel)
      } else {
        for (let index = 0; index < count; index += 1) {
          const pixel = readPixel(bytes, source, tga)
          if (pixel.next > tga.dataEnd) throw new TypeError('TGA raw packet pixel is truncated')
          source = pixel.next
          write(pixel)
        }
      }
    } else {
      const pixel = readPixel(bytes, source, tga)
      if (pixel.next > tga.dataEnd) throw new TypeError('TGA pixel is truncated')
      source = pixel.next
      write(pixel)
    }
  }
  return pixels
}

/**
 * A whole TGA file as an RGBA8 image with a top-left origin; throws for colour-mapped files and for
 * images over `maxDecodedBytes` of RGBA (default 64 MiB).
 */
export function decodeTga(bytes: Uint8Array, maxDecodedBytes = 64 * 1024 * 1024): RgbaImage {
  const tga = parseTga(bytes, maxDecodedBytes)
  if (!tga.decodedAccess) throw new RangeError(tga.mapped ? 'Colour-mapped TGA pixels are not decoded' : 'TGA image exceeds the decode budget')
  return { width: tga.width, height: tga.height, pixels: decodeTgaPixels(bytes, tga) }
}
