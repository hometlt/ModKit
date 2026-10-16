/**
 * BC1–BC5 (DXT1/DXT3/DXT5, BC4, BC5) block decoding, shared by every codec that stores these
 * blocks — DDS, KTX, KTX2, PVR and game texture wrappers alike.
 *
 * Moved unchanged from MK3's `extensions/images/src/dds/codec.js`, so the pixels are byte-identical
 * to what that decoder produced. 565 endpoints expand by bit replication (high bits repeated into
 * low bits), as D3D specifies and the GPU does; rational rounding (v * 255 / 31) is off by one for
 * some inputs. BC6H and BC7 are decoded by `gpu-texture-wasm` (the Texture2DDecoder runtime), not
 * here.
 */

import { expand5To8 } from '../raster/channel-bits.js'

export type BcFormat = 'DXT1' | 'DXT3' | 'DXT5' | 'BC4' | 'BC5'

/** Bytes per 4 × 4 block. */
export function bcBlockBytes(format: BcFormat): number {
  return format === 'DXT1' || format === 'BC4' ? 8 : 16
}

const COLOR_PALETTE = new Uint8Array(16)
const ALPHA_PALETTE = new Uint8Array(8)
const BLOCK_VALUES = new Uint8Array(16)
const BLOCK_VALUES_SECOND = new Uint8Array(16)

const at = (bytes: Uint8Array, index: number): number => bytes[index] as number

function fillColorPalette(first: number, second: number, allowTransparent: boolean): void {
  const p = COLOR_PALETTE
  const r0 = (first >>> 11) & 0x1f
  const g0 = (first >>> 5) & 0x3f
  const b0 = first & 0x1f
  const r1 = (second >>> 11) & 0x1f
  const g1 = (second >>> 5) & 0x3f
  const b1 = second & 0x1f
  p[0] = expand5To8(r0)
  p[1] = (g0 << 2) | (g0 >>> 4)
  p[2] = expand5To8(b0)
  p[3] = 255
  p[4] = expand5To8(r1)
  p[5] = (g1 << 2) | (g1 >>> 4)
  p[6] = expand5To8(b1)
  p[7] = 255
  if (first > second || !allowTransparent) {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((2 * at(p, c) + at(p, 4 + c)) / 3)
      p[12 + c] = Math.round((at(p, c) + 2 * at(p, 4 + c)) / 3)
    }
    p[11] = 255
    p[15] = 255
  } else {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((at(p, c) + at(p, 4 + c)) / 2)
      p[12 + c] = 0
    }
    p[11] = 255
    p[15] = 0
  }
}

/** Fill `target` with the 16 interpolated 8-bit values of one BC3-alpha/BC4 block. */
function fillInterpolatedValues(
  view: DataView,
  offset: number,
  snorm: boolean,
  target: Uint8Array,
): void {
  const raw0 = view.getUint8(offset)
  const raw1 = view.getUint8(offset + 1)
  const palette = ALPHA_PALETTE
  if (snorm) {
    const toSigned = (byte: number): number => Math.max(-127, byte >= 128 ? byte - 256 : byte) / 127
    const first = toSigned(raw0)
    const second = toSigned(raw1)
    const signedFirst = raw0 >= 128 ? raw0 - 256 : raw0
    const signedSecond = raw1 >= 128 ? raw1 - 256 : raw1
    const values =
      signedFirst > signedSecond
        ? [
            first,
            second,
            (6 * first + second) / 7,
            (5 * first + 2 * second) / 7,
            (4 * first + 3 * second) / 7,
            (3 * first + 4 * second) / 7,
            (2 * first + 5 * second) / 7,
            (first + 6 * second) / 7,
          ]
        : [
            first,
            second,
            (4 * first + second) / 5,
            (3 * first + 2 * second) / 5,
            (2 * first + 3 * second) / 5,
            (first + 4 * second) / 5,
            -1,
            1,
          ]
    for (let index = 0; index < 8; index += 1) {
      palette[index] = Math.round(((values[index] as number) * 0.5 + 0.5) * 255)
    }
  } else {
    palette[0] = raw0
    palette[1] = raw1
    if (raw0 > raw1) {
      for (let index = 1; index <= 6; index += 1) {
        palette[index + 1] = Math.round(((7 - index) * raw0 + index * raw1) / 7)
      }
    } else {
      for (let index = 1; index <= 4; index += 1) {
        palette[index + 1] = Math.round(((5 - index) * raw0 + index * raw1) / 5)
      }
      palette[6] = 0
      palette[7] = 255
    }
  }
  // 48 index bits in two 24-bit halves; 3-bit fields never straddle bit 24.
  const low =
    view.getUint8(offset + 2) | (view.getUint8(offset + 3) << 8) | (view.getUint8(offset + 4) << 16)
  const high =
    view.getUint8(offset + 5) | (view.getUint8(offset + 6) << 8) | (view.getUint8(offset + 7) << 16)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const bit = pixel * 3
    target[pixel] = at(palette, bit < 24 ? (low >>> bit) & 7 : (high >>> (bit - 24)) & 7)
  }
}

function fillDxt3Alphas(view: DataView, offset: number, target: Uint8Array): void {
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const packed = view.getUint8(offset + (pixel >>> 1))
    target[pixel] = ((packed >>> ((pixel & 1) * 4)) & 0xf) * 17
  }
}

interface Surface {
  readonly width: number
  readonly height: number
}

function writeColorBlock(
  view: DataView,
  offset: number,
  output: Uint8Array,
  surface: Surface,
  blockX: number,
  blockY: number,
  allowTransparent: boolean,
  alphas?: Uint8Array,
): void {
  fillColorPalette(view.getUint16(offset, true), view.getUint16(offset + 2, true), allowTransparent)
  const indices = view.getUint32(offset + 4, true)
  const { width, height } = surface
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3)
    const y = blockY * 4 + (pixel >>> 2)
    if (x >= width || y >= height) continue
    const target = (y * width + x) * 4
    const source = ((indices >>> (pixel * 2)) & 3) * 4
    output[target] = at(COLOR_PALETTE, source)
    output[target + 1] = at(COLOR_PALETTE, source + 1)
    output[target + 2] = at(COLOR_PALETTE, source + 2)
    output[target + 3] = alphas === undefined ? at(COLOR_PALETTE, source + 3) : at(alphas, pixel)
  }
}

function writeChannelsBlock(
  output: Uint8Array,
  surface: Surface,
  blockX: number,
  blockY: number,
  red: Uint8Array,
  green: Uint8Array,
  grey: boolean,
): void {
  const { width, height } = surface
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3)
    const y = blockY * 4 + (pixel >>> 2)
    if (x >= width || y >= height) continue
    const target = (y * width + x) * 4
    output[target] = at(red, pixel)
    output[target + 1] = grey ? at(red, pixel) : at(green, pixel)
    output[target + 2] = grey ? at(red, pixel) : 0
    output[target + 3] = 255
  }
}

/**
 * Decode one block-compressed surface to RGBA8. `offset` is where its first block starts in
 * `bytes`; blocks run row-major, partial edge blocks clipped. BC4 decodes as grey, BC5 as
 * red/green with blue zero; `snorm` reads BC4/BC5 endpoints as signed.
 */
export function decodeBcSurface(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  format: BcFormat,
  snorm = false,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const output = new Uint8Array(width * height * 4)
  const surface: Surface = { width, height }
  const decodeBlock = (at: number, blockX: number, blockY: number): void => {
    switch (format) {
      case 'DXT1':
        writeColorBlock(view, at, output, surface, blockX, blockY, true)
        return
      case 'DXT3':
        fillDxt3Alphas(view, at, BLOCK_VALUES)
        writeColorBlock(view, at + 8, output, surface, blockX, blockY, false, BLOCK_VALUES)
        return
      case 'DXT5':
        fillInterpolatedValues(view, at, false, BLOCK_VALUES)
        writeColorBlock(view, at + 8, output, surface, blockX, blockY, false, BLOCK_VALUES)
        return
      case 'BC4':
        fillInterpolatedValues(view, at, snorm, BLOCK_VALUES)
        writeChannelsBlock(output, surface, blockX, blockY, BLOCK_VALUES, BLOCK_VALUES, true)
        return
      case 'BC5':
        fillInterpolatedValues(view, at, snorm, BLOCK_VALUES)
        fillInterpolatedValues(view, at + 8, snorm, BLOCK_VALUES_SECOND)
        writeChannelsBlock(
          output,
          surface,
          blockX,
          blockY,
          BLOCK_VALUES,
          BLOCK_VALUES_SECOND,
          false,
        )
    }
  }
  const blockBytes = bcBlockBytes(format)
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  let cursor = offset
  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      decodeBlock(cursor, blockX, blockY)
      cursor += blockBytes
    }
  }
  return output
}
