import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkit/codec-kit'
import { decodeBc6h, decodeBc7 } from './bptc.js'
import { ENCODABLE_FORMATS, encodeDds } from './encode.js'
import {
  applyColorKeyTransparency,
  applyRoundedAlpha,
  combineNormalSpecular,
  convertNormalMapToSc2,
  prepareSc2ButtonIcon,
  resizeRgba,
} from '../ops/raster-ops.js'
import {
  blockBytesFor,
  levelDimensions,
  payloadBytes,
  resolveSubresource,
  sliceBytes,
} from './layout.js'

const ID = 'modkit/dds'
const DDS_MAGIC = 0x20534444
const DDPF_ALPHA = 0x2
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40
const DDPF_LUMINANCE = 0x2_0000
const DDSCAPS2_CUBEMAP = 0x200
const DDSCAPS2_VOLUME = 0x20_0000
const DDS_HEADER_FLAGS_DEPTH = 0x80_0000

/** R8G8B8A8 / B8G8R8A8 little-endian byte order expressed as channel masks. */
const RGBA8_MASKS = Object.freeze([0x0000_00ff, 0x0000_ff00, 0x00ff_0000, 0xff00_0000])
const BGRA8_MASKS = Object.freeze([0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000])

/**
 * Legacy FourCC codes and the block format each one selects.
 *
 * DXT2/DXT4 are the premultiplied-alpha spellings of DXT3/DXT5: identical block layout, so they
 * decode through the same path and only the reported alpha mode differs.
 */
const FOURCC_FORMATS = new Map([
  ['DXT1', { format: 'DXT1' }],
  ['DXT2', { format: 'DXT3', premultiplied: true }],
  ['DXT3', { format: 'DXT3' }],
  ['DXT4', { format: 'DXT5', premultiplied: true }],
  ['DXT5', { format: 'DXT5' }],
  ['ATI1', { format: 'BC4' }],
  ['BC4U', { format: 'BC4' }],
  ['BC4S', { format: 'BC4', snorm: true }],
  ['ATI2', { format: 'BC5' }],
  ['BC5U', { format: 'BC5' }],
  ['BC5S', { format: 'BC5', snorm: true }],
])

/**
 * DXGI formats this decoder actually turns into pixels. Recognised-but-undecodable formats are
 * named separately below so the refusal says which format it is, not "unsupported".
 */
const DECODED_DXGI_FORMATS = new Map([
  [28, { format: 'rgba-mask', bits: 32, masks: RGBA8_MASKS }],
  [29, { format: 'rgba-mask', bits: 32, masks: RGBA8_MASKS, srgb: true }],
  [70, { format: 'DXT1' }],
  [71, { format: 'DXT1' }],
  [72, { format: 'DXT1', srgb: true }],
  [73, { format: 'DXT3' }],
  [74, { format: 'DXT3' }],
  [75, { format: 'DXT3', srgb: true }],
  [76, { format: 'DXT5' }],
  [77, { format: 'DXT5' }],
  [78, { format: 'DXT5', srgb: true }],
  [80, { format: 'BC4' }],
  [81, { format: 'BC4', snorm: true }],
  [83, { format: 'BC5' }],
  [84, { format: 'BC5', snorm: true }],
  [87, { format: 'rgba-mask', bits: 32, masks: BGRA8_MASKS }],
  [91, { format: 'rgba-mask', bits: 32, masks: BGRA8_MASKS, srgb: true }],
  /*
   * BPTC. The blocks are decoded by the vendored texture2ddecoder runtime through `bptc.js`, the
   * same implementation the legacy MK2 codec called. BC6H_TYPELESS carries no signedness of its
   * own; legacy read it as the unsigned profile and so does this.
   */
  [94, { format: 'BC6H' }],
  [95, { format: 'BC6H' }],
  [96, { format: 'BC6H', signedFloat: true }],
  [97, { format: 'BC7' }],
  [98, { format: 'BC7' }],
  [99, { format: 'BC7', srgb: true }],
])

/**
 * DXGI formats the header parser recognises by name and refuses by name.
 *
 * Naming them keeps the refusal specific instead of "unsupported". Legacy refused these two as
 * well, so nothing decodable is being withheld here.
 */
const NAMED_UNDECODED_DXGI_FORMATS = new Map([
  [79, 'BC4_TYPELESS'],
  [82, 'BC5_TYPELESS'],
])

/** Uncompressed pixel-format bit counts the masked reader handles. */
const UNCOMPRESSED_BIT_COUNTS = new Set([8, 16, 24, 32])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function fourCc(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function checkedImageBytes(width, height) {
  const length = width * height * 4
  if (!Number.isSafeInteger(length) || length <= 0) throw new RangeError('DDS dimensions overflow')
  return length
}

/**
 * Read the DDS header into the shape the rest of this codec works from.
 *
 * Exported because `compressed.js` needs the same parse to describe the stored blocks; the codec
 * module surface the host marshals is `abiVersion` and `createCodec`, so an extra named export
 * changes nothing about how the codec is loaded.
 */
export function parseDds(bytes) {
  if (bytes.byteLength < 128) throw new TypeError('DDS header is truncated')
  const view = viewOf(bytes)
  if (view.getUint32(0, true) !== DDS_MAGIC) throw new TypeError('DDS magic is missing')
  if (view.getUint32(4, true) !== 124 || view.getUint32(76, true) !== 32) {
    throw new TypeError('DDS header sizes are invalid')
  }
  const headerFlags = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)
  checkedImageBytes(width, height)
  const mipLevels = Math.max(1, view.getUint32(28, true))
  const caps2 = view.getUint32(112, true)
  const cubemap = (caps2 & DDSCAPS2_CUBEMAP) !== 0
  const volume = (caps2 & DDSCAPS2_VOLUME) !== 0 || (headerFlags & DDS_HEADER_FLAGS_DEPTH) !== 0
  const pixelFlags = view.getUint32(80, true)
  const legacyFourCc = fourCc(view, 84)
  const headerBits = view.getUint32(88, true)
  const headerMasks = Object.freeze([
    view.getUint32(92, true),
    view.getUint32(96, true),
    view.getUint32(100, true),
    view.getUint32(104, true),
  ])
  let format = 'rgba-mask'
  let dataOffset = 128
  let layers = 1
  let dxgiFormat
  let snorm = false
  let signedFloat = false
  let premultiplied = false
  let srgb = false
  let luminance = false
  let alphaOnly = false
  /* Block formats leave dwRGBBitCount undefined; only an uncompressed payload may size rows by it. */
  let rgbBits = 0
  let masks = headerMasks
  let resourceDimension
  let miscFlag
  let miscFlags2
  if ((pixelFlags & DDPF_FOURCC) !== 0) {
    if (legacyFourCc === 'DX10') {
      if (bytes.byteLength < 148) throw new TypeError('DDS DX10 header is truncated')
      dataOffset = 148
      dxgiFormat = view.getUint32(128, true)
      resourceDimension = view.getUint32(132, true)
      miscFlag = view.getUint32(136, true)
      layers = Math.max(1, view.getUint32(140, true))
      miscFlags2 = view.getUint32(144, true)
      const mapped = DECODED_DXGI_FORMATS.get(dxgiFormat)
      if (mapped === undefined) {
        const named = NAMED_UNDECODED_DXGI_FORMATS.get(dxgiFormat)
        throw new TypeError(
          named === undefined
            ? `DDS DXGI format ${dxgiFormat} is not supported`
            : `DDS DXGI format ${dxgiFormat} (${named}) is recognised but this decoder produces no pixels for it`,
        )
      }
      format = mapped.format
      snorm = mapped.snorm === true
      signedFloat = mapped.signedFloat === true
      srgb = mapped.srgb === true
      if (mapped.bits !== undefined) {
        rgbBits = mapped.bits
        masks = mapped.masks
      }
    } else {
      const mapped = FOURCC_FORMATS.get(legacyFourCc)
      if (mapped === undefined) {
        throw new TypeError(`DDS FourCC ${legacyFourCc.trim()} is not supported`)
      }
      format = mapped.format
      snorm = mapped.snorm === true
      premultiplied = mapped.premultiplied === true
    }
  } else if ((pixelFlags & DDPF_RGB) !== 0) {
    rgbBits = headerBits
  } else if ((pixelFlags & DDPF_LUMINANCE) !== 0) {
    /* Single-channel luminance, optionally with an alpha channel: replicate luminance to RGB. */
    rgbBits = headerBits
    luminance = true
  } else if ((pixelFlags & DDPF_ALPHA) !== 0) {
    /* Alpha-only surfaces carry no colour; the alpha mask alone drives the projection. */
    rgbBits = headerBits
    alphaOnly = true
    masks = Object.freeze([0, 0, 0, headerMasks[3] === 0 ? 0xff : headerMasks[3]])
  } else {
    throw new TypeError('DDS pixel format is not FourCC, RGB, luminance or alpha')
  }
  if (format === 'rgba-mask' && !UNCOMPRESSED_BIT_COUNTS.has(rgbBits)) {
    throw new TypeError(`DDS ${rgbBits}-bit uncompressed payload is not supported`)
  }
  const info = Object.freeze({
    width,
    height,
    depth: volume ? Math.max(1, view.getUint32(24, true)) : 1,
    mipLevels,
    layers,
    faces: cubemap ? 6 : 1,
    format,
    fourCc: (pixelFlags & DDPF_FOURCC) !== 0 ? legacyFourCc : undefined,
    dataOffset,
    rgbBits,
    masks,
    cubemap,
    volume,
    snorm,
    signedFloat,
    premultiplied,
    srgb,
    luminance,
    alphaOnly,
    ...(dxgiFormat === undefined ? {} : { dxgiFormat }),
    ...(resourceDimension === undefined ? {} : { resourceDimension }),
    ...(miscFlag === undefined ? {} : { miscFlag }),
    ...(miscFlags2 === undefined ? {} : { miscFlags2 }),
  })
  if (info.dataOffset + sliceBytes(info, 0) > bytes.byteLength) {
    throw new TypeError('DDS pixel payload is truncated')
  }
  return info
}

/*
 * Block decoders write straight into the output with per-call scratch palettes. The earlier
 * per-pixel arrays and BigInt index unpacking made DDS decoding the largest CPU cost of loading a
 * map's models; the arithmetic (565 bit replication, Math.round of the same interpolations) is
 * unchanged, so the pixels are byte-identical.
 */
/*
 * 565 endpoints expand by bit replication (high bits repeated into low bits), as D3D specifies and the
 * GPU does; rational rounding (v * 255 / 31) is off by one for some inputs.
 */
const COLOR_PALETTE = new Uint8Array(16)
const ALPHA_PALETTE = new Uint8Array(8)
const BLOCK_VALUES = new Uint8Array(16)
const BLOCK_VALUES_SECOND = new Uint8Array(16)

function fillColorPalette(first, second, allowTransparent) {
  const p = COLOR_PALETTE
  const r0 = (first >>> 11) & 0x1f,
    g0 = (first >>> 5) & 0x3f,
    b0 = first & 0x1f
  const r1 = (second >>> 11) & 0x1f,
    g1 = (second >>> 5) & 0x3f,
    b1 = second & 0x1f
  p[0] = (r0 << 3) | (r0 >>> 2)
  p[1] = (g0 << 2) | (g0 >>> 4)
  p[2] = (b0 << 3) | (b0 >>> 2)
  p[3] = 255
  p[4] = (r1 << 3) | (r1 >>> 2)
  p[5] = (g1 << 2) | (g1 >>> 4)
  p[6] = (b1 << 3) | (b1 >>> 2)
  p[7] = 255
  if (first > second || !allowTransparent) {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((2 * p[c] + p[4 + c]) / 3)
      p[12 + c] = Math.round((p[c] + 2 * p[4 + c]) / 3)
    }
    p[11] = 255
    p[15] = 255
  } else {
    for (let c = 0; c < 3; c += 1) {
      p[8 + c] = Math.round((p[c] + p[4 + c]) / 2)
      p[12 + c] = 0
    }
    p[11] = 255
    p[15] = 0
  }
}

/** Fill `target` with the 16 interpolated 8-bit values of one BC3-alpha/BC4 block. */
function fillInterpolatedValues(view, offset, snorm, target) {
  const raw0 = view.getUint8(offset)
  const raw1 = view.getUint8(offset + 1)
  const palette = ALPHA_PALETTE
  if (snorm) {
    const toSigned = byte => Math.max(-127, byte >= 128 ? byte - 256 : byte) / 127
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
    for (let index = 0; index < 8; index += 1)
      palette[index] = Math.round((values[index] * 0.5 + 0.5) * 255)
  } else {
    palette[0] = raw0
    palette[1] = raw1
    if (raw0 > raw1) {
      for (let index = 1; index <= 6; index += 1)
        palette[index + 1] = Math.round(((7 - index) * raw0 + index * raw1) / 7)
    } else {
      for (let index = 1; index <= 4; index += 1)
        palette[index + 1] = Math.round(((5 - index) * raw0 + index * raw1) / 5)
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
    target[pixel] = palette[bit < 24 ? (low >>> bit) & 7 : (high >>> (bit - 24)) & 7]
  }
}

function fillDxt3Alphas(view, offset, target) {
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const packed = view.getUint8(offset + (pixel >>> 1))
    target[pixel] = ((packed >>> ((pixel & 1) * 4)) & 0xf) * 17
  }
}

/** Walk a block-compressed surface, handing each block's byte offset and block coordinates on. */
function decodeBlocks(view, surface, output, blockBytes, decodeBlock) {
  const { width, height } = surface
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  let offset = surface.offset
  for (let blockY = 0; blockY < blocksY; blockY += 1) {
    for (let blockX = 0; blockX < blocksX; blockX += 1) {
      decodeBlock(offset, blockX, blockY)
      offset += blockBytes
    }
  }
}

function writeColorBlock(view, offset, output, surface, blockX, blockY, allowTransparent, alphas) {
  fillColorPalette(view.getUint16(offset, true), view.getUint16(offset + 2, true), allowTransparent)
  const indices = view.getUint32(offset + 4, true)
  const { width, height } = surface
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3)
    const y = blockY * 4 + (pixel >>> 2)
    if (x >= width || y >= height) continue
    const target = (y * width + x) * 4
    const source = ((indices >>> (pixel * 2)) & 3) * 4
    output[target] = COLOR_PALETTE[source]
    output[target + 1] = COLOR_PALETTE[source + 1]
    output[target + 2] = COLOR_PALETTE[source + 2]
    output[target + 3] = alphas === undefined ? COLOR_PALETTE[source + 3] : alphas[pixel]
  }
}

function writeChannelsBlock(output, surface, blockX, blockY, red, green, grey) {
  const { width, height } = surface
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const x = blockX * 4 + (pixel & 3)
    const y = blockY * 4 + (pixel >>> 2)
    if (x >= width || y >= height) continue
    const target = (y * width + x) * 4
    output[target] = red[pixel]
    output[target + 1] = grey ? red[pixel] : green[pixel]
    output[target + 2] = grey ? red[pixel] : 0
    output[target + 3] = 255
  }
}

function maskShift(mask) {
  if (mask === 0) return 0
  let shift = 0
  let value = mask >>> 0
  while ((value & 1) === 0) {
    value >>>= 1
    shift += 1
  }
  return shift
}

function maskValue(pixel, mask, fallback) {
  if (mask === 0) return fallback
  const shift = maskShift(mask)
  const maximum = mask >>> shift
  return Math.round((((pixel & mask) >>> shift) * 255) / maximum)
}

function decodeUncompressed(bytes, info, surface, output) {
  if (!UNCOMPRESSED_BIT_COUNTS.has(info.rgbBits)) {
    throw new TypeError(`DDS ${info.rgbBits}-bit uncompressed payload is not supported`)
  }
  const bytesPerPixel = info.rgbBits / 8
  const rowStride = Math.ceil((surface.width * info.rgbBits) / 8)
  const view = viewOf(bytes)
  for (let y = 0; y < surface.height; y += 1) {
    for (let x = 0; x < surface.width; x += 1) {
      const offset = surface.offset + y * rowStride + x * bytesPerPixel
      let packed = 0
      for (let byte = 0; byte < bytesPerPixel; byte += 1) {
        packed |= view.getUint8(offset + byte) << (byte * 8)
      }
      const target = (y * surface.width + x) * 4
      const red = maskValue(packed, info.masks[0], 0)
      output[target] = red
      /* A luminance surface stores one colour channel; RGB is that channel replicated. */
      output[target + 1] = info.luminance ? red : maskValue(packed, info.masks[1], 0)
      output[target + 2] = info.luminance ? red : maskValue(packed, info.masks[2], 0)
      output[target + 3] = maskValue(packed, info.masks[3], 255)
    }
  }
}

/**
 * Decode one already-resolved surface (a single mip/layer/face/slice) to rgba8.
 *
 * BC6H and BC7 leave through `bptc.js` to the vendored runtime, which is why this is async: every
 * other format is decoded inline here and returns without ever awaiting.
 */
async function decodeSurface(bytes, info, surface) {
  const output = new Uint8Array(checkedImageBytes(surface.width, surface.height))
  if (info.format === 'rgba-mask') {
    decodeUncompressed(bytes, info, surface, output)
    return output
  }
  if (info.format === 'BC6H' || info.format === 'BC7') {
    const blocks = bytes.subarray(surface.offset, surface.offset + surface.length)
    const decode = info.format === 'BC6H' ? decodeBc6h : decodeBc7
    return decode(blocks, surface.width, surface.height)
  }
  const view = viewOf(bytes)
  const blockBytes = blockBytesFor(info.format)
  if (blockBytes === 0) throw new TypeError(`DDS format ${info.format} is not supported`)
  const decodeBlock =
    info.format === 'DXT1'
      ? (offset, blockX, blockY) =>
          writeColorBlock(view, offset, output, surface, blockX, blockY, true)
      : info.format === 'DXT3'
        ? (offset, blockX, blockY) => {
            fillDxt3Alphas(view, offset, BLOCK_VALUES)
            writeColorBlock(view, offset + 8, output, surface, blockX, blockY, false, BLOCK_VALUES)
          }
        : info.format === 'DXT5'
          ? (offset, blockX, blockY) => {
              fillInterpolatedValues(view, offset, false, BLOCK_VALUES)
              writeColorBlock(
                view,
                offset + 8,
                output,
                surface,
                blockX,
                blockY,
                false,
                BLOCK_VALUES,
              )
            }
          : info.format === 'BC4'
            ? (offset, blockX, blockY) => {
                fillInterpolatedValues(view, offset, info.snorm, BLOCK_VALUES)
                writeChannelsBlock(
                  output,
                  surface,
                  blockX,
                  blockY,
                  BLOCK_VALUES,
                  BLOCK_VALUES,
                  true,
                )
              }
            : info.format === 'BC5'
              ? (offset, blockX, blockY) => {
                  fillInterpolatedValues(view, offset, info.snorm, BLOCK_VALUES)
                  fillInterpolatedValues(view, offset + 8, info.snorm, BLOCK_VALUES_SECOND)
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
              : undefined
  if (decodeBlock === undefined) throw new TypeError(`DDS format ${info.format} is not supported`)
  decodeBlocks(view, surface, output, blockBytes, decodeBlock)
  return output
}

/** Human-facing name of the stored encoding, keeping the FourCC the file actually carries. */
function encodingLabel(info) {
  const kind = info.alphaOnly ? 'alpha' : info.luminance ? 'luminance' : 'RGB'
  const base = info.format === 'rgba-mask' ? `${info.rgbBits}-bit ${kind}` : info.format
  const spellings = []
  if (info.fourCc !== undefined && info.fourCc !== 'DX10' && info.fourCc !== info.format) {
    spellings.push(info.fourCc)
  }
  if (info.snorm) spellings.push('SNORM')
  if (info.signedFloat) spellings.push('SF16')
  return spellings.length === 0 ? base : `${base} (${spellings.join(', ')})`
}

/**
 * Alpha mode of the stored surface.
 *
 * A DX10 header states it outright in miscFlags2; everything else is implied by the format, so the
 * answer is only as specific as the file allows and stays 'unknown' rather than guessing.
 */
function alphaModeOf(info) {
  if (info.miscFlags2 !== undefined) {
    const declared = info.miscFlags2 & 0x7
    if (declared === 1) return 'straight'
    if (declared === 2) return 'premultiplied'
    if (declared === 3) return 'none'
  }
  if (info.format === 'BC4' || info.format === 'BC5' || info.format === 'BC6H') return 'none'
  if (info.premultiplied) return 'premultiplied'
  if (info.format === 'DXT1') return 'straight'
  if (info.format === 'rgba-mask') return info.masks[3] === 0 ? 'none' : 'straight'
  return 'unknown'
}

/** Source channel count of the stored surface, before the rgba8 projection. */
function channelsOf(info) {
  if (info.format === 'BC4') return 1
  if (info.format === 'BC5') return 2
  /* BC6H stores three half-float channels and no alpha; BC7 stores four. */
  if (info.format === 'BC6H') return 3
  if (info.alphaOnly) return 1
  if (info.luminance) return info.masks[3] === 0 ? 1 : 2
  if (info.format === 'rgba-mask') return info.masks[3] === 0 ? 3 : 4
  return 4
}

/** Stable cache key for one subresource of one file. */
function subresourceKey(coordinates) {
  return `${coordinates.mipLevel}/${coordinates.layer}/${coordinates.face}/${coordinates.slice}`
}

function regionReader(bytes, info) {
  /*
   * One decoded surface per requested subresource. A viewer that walks a mip chain asks for each
   * level once and then pans over it, so caching the level — not just level 0 — is what keeps the
   * pan interactive; the map is bounded by the subresource count the header declares.
   */
  const decoded = new Map()
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('DDS region coordinates and budget must be non-negative safe integers')
    }
    if (request.pixelFormat !== 'rgba8') {
      throw new RangeError('DDS decoder exposes pixels as rgba8 only')
    }
    if ((request.frame ?? 0) !== 0) {
      throw new RangeError('DDS holds a single frame; frame 0 is the only one')
    }
    const coordinates = {
      mipLevel: request.mipLevel ?? 0,
      layer: request.layer ?? 0,
      face: request.face ?? 0,
      slice: request.slice ?? 0,
    }
    const surface = resolveSubresource(bytes, info, coordinates)
    if (request.x + request.width > surface.width || request.y + request.height > surface.height) {
      throw new RangeError(
        `DDS region is outside subresource ${subresourceKey(coordinates)} ` +
          `(${surface.width}x${surface.height})`,
      )
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('DDS region exceeds maxBytes budget')
    }
    const key = subresourceKey(coordinates)
    let pixelsOfSurface = decoded.get(key)
    if (pixelsOfSurface === undefined) {
      pixelsOfSurface = await decodeSurface(bytes, info, surface)
      decoded.set(key, pixelsOfSurface)
    }
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * surface.width + request.x) * 4
      pixels.set(
        pixelsOfSurface.subarray(start, start + request.width * 4),
        row * request.width * 4,
      )
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels,
    })
  }
}

/**
 * The pixel transforms MK2 shipped, as one operation.
 *
 * `ops/raster-ops.js` holds six of them — resize, the SC2 normal-map conversion, the normal and
 * specular combine, rounded alpha, the button-icon preparation and colour-key transparency — ported
 * and, until now, imported by nothing. MK2 reached them from VS Code commands; MK3 puts them behind
 * an operation instead, so the app, the editor and a script all reach the same code rather than the
 * editor owning a capability the others cannot have.
 *
 * Each entry states what it needs, because the failures are silent otherwise: `combineNormalSpecular`
 * wants a second image and produces nonsense from one, and `prepareSc2ButtonIcon` assumes a square
 * icon. Checking here means a caller gets told; checking nowhere means a modder gets a wrong texture.
 */
const TRANSFORMS = Object.freeze({
  resize: {
    label: 'Resize',
    apply: (image, request) => {
      const width = Number(request.width)
      const height = Number(request.height)
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0
      ) {
        throw new TypeError('resize requires a positive integer width and height')
      }
      return resizeRgba(image, width, height)
    },
  },
  'normal-map': {
    label: 'Convert normal map to the SC2 channel layout',
    apply: image => convertNormalMapToSc2(image),
  },
  'combine-normal-specular': {
    label: 'Combine a normal map with a specular map',
    apply: (image, request) => {
      const specular = imageFromRequest(request.specular)
      if (specular === undefined) {
        throw new TypeError('combine-normal-specular requires a specular image')
      }
      if (specular.width !== image.width || specular.height !== image.height) {
        throw new TypeError('combine-normal-specular requires both images at the same size')
      }
      return combineNormalSpecular(image, specular)
    },
  },
  'rounded-alpha': {
    label: 'Round the alpha corners',
    apply: (image, request) => {
      const radius = Number(request.radius ?? 0)
      if (!Number.isFinite(radius) || radius < 0) {
        throw new TypeError('rounded-alpha requires a non-negative radius')
      }
      return applyRoundedAlpha(image, radius)
    },
  },
  'button-icon': {
    label: 'Prepare an SC2 button icon',
    apply: (image, request) => {
      if (image.width !== image.height) {
        throw new TypeError(
          `button-icon requires a square image, got ${image.width} x ${image.height}`,
        )
      }
      return prepareSc2ButtonIcon(image, request.options ?? {})
    },
  },
  'color-key': {
    label: 'Make one colour transparent',
    apply: (image, request) => {
      // The library's own option names, so a caller reads one vocabulary rather than two.
      const target = request.target
      if (target === null || typeof target !== 'object') {
        throw new TypeError('color-key requires a target colour as { r, g, b }')
      }
      for (const channel of ['r', 'g', 'b']) {
        if (!Number.isFinite(Number(target[channel]))) {
          throw new TypeError(`color-key target is missing ${channel}`)
        }
      }
      return applyColorKeyTransparency(image, {
        target,
        ...(request.tolerance === undefined ? {} : { tolerance: Number(request.tolerance) }),
        ...(request.replacement === undefined ? {} : { replacement: request.replacement }),
      })
    },
  },
})

/** An `{ width, height, pixels }` image supplied in a request, with pixels as a number array. */
function imageFromRequest(value) {
  if (value === null || typeof value !== 'object') return undefined
  const width = Number(value.width)
  const height = Number(value.height)
  const pixels = Array.isArray(value.pixels) ? Uint8Array.from(value.pixels) : undefined
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || pixels === undefined) {
    return undefined
  }
  if (pixels.length !== width * height * 4) {
    throw new TypeError('a supplied image needs width * height * 4 RGBA bytes')
  }
  return { width, height, pixels }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  operations: Object.freeze([
    Object.freeze({
      id: 'edit.content',
      handlerId: 'transform',
      mutatesSource: true,
      requiredPermissions: Object.freeze(['read-source', 'write-source']),
      outputKinds: Object.freeze(['edit-plan']),
    }),
  ]),
  format: Object.freeze({ id: 'dds', label: 'DirectDraw Surface', mediaType: 'image/vnd-ms.dds' }),
  async detect(prefix) {
    const matches = prefix.byteLength >= 4 && viewOf(prefix).getUint32(0, true) === DDS_MAGIC
    return matches
      ? { confidence: 0.99, kind: 'magic', note: 'DDS magic and header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const info = parseDds(bytes)
    const decodedBytes = checkedImageBytes(info.width, info.height)
    if (decodedBytes > context.budget.maxScalarBytes) {
      throw new RangeError('DDS decoded pixels exceed the scalar budget')
    }
    const raster = createRasterImageSource(
      bytes,
      'image/vnd-ms.dds',
      {
        width: info.width,
        height: info.height,
        depth: info.depth,
        layers: info.layers,
        faces: info.faces,
        mipLevels: info.mipLevels,
        frames: 1,
        channels: channelsOf(info),
        channelLayout:
          info.format === 'BC5'
            ? 'rg'
            : info.format === 'BC4'
              ? 'r'
              : info.alphaOnly
                ? 'alpha'
                : info.luminance
                  ? info.masks[3] === 0
                    ? 'luminance'
                    : 'luminance-alpha'
                  : channelsOf(info) === 3
                    ? 'rgb'
                    : 'rgba',
        compression:
          {
            DXT1: 'bc1',
            DXT3: 'bc2',
            DXT5: 'bc3',
            BC4: 'bc4',
            BC5: 'bc5',
            BC6H: 'bc6h',
            BC7: 'bc7',
          }[info.format] ?? 'none',
        bitDepth: 8,
        colorSpace: info.srgb ? 'srgb' : info.dxgiFormat === undefined ? 'unknown' : 'linear',
        alphaMode: alphaModeOf(info),
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(bytes, info),
    )
    const subresources = info.mipLevels * info.layers * info.faces
    const mipChain = Array.from({ length: info.mipLevels }, (_, level) => {
      const size = levelDimensions(info, level)
      return {
        kind: 'field',
        label: `Mip ${level}`,
        preview: `${size.width} × ${size.height}${info.depth > 1 ? ` × ${size.depth}` : ''}, ${sliceBytes(info, level)} bytes`,
      }
    })
    const encoding = encodingLabel(info)
    const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'DDS',
      preview: `${info.width} × ${info.height}, ${encoding}`,
      children: [
        { kind: 'field', label: 'Format', preview: encoding },
        { kind: 'field', label: 'Mip levels', preview: String(info.mipLevels) },
        { kind: 'field', label: 'Array layers', preview: String(info.layers) },
        { kind: 'field', label: 'Cubemap faces', preview: String(info.faces) },
        { kind: 'field', label: 'Volume depth', preview: String(info.depth) },
        { kind: 'field', label: 'Subresources', preview: String(subresources) },
        { kind: 'field', label: 'Channels', preview: String(channelsOf(info)) },
        { kind: 'field', label: 'Alpha mode', preview: alphaModeOf(info) },
        { kind: 'field', label: 'Payload', preview: `${payloadBytes(info)} bytes` },
        ...(info.dxgiFormat === undefined
          ? []
          : [{ kind: 'field', label: 'DXGI format', preview: String(info.dxgiFormat) }]),
        ...(info.format === 'rgba-mask'
          ? [
              { kind: 'field', label: 'Bit count', preview: String(info.rgbBits) },
              {
                kind: 'field',
                label: 'Channel masks',
                preview: `R ${hex(info.masks[0])} G ${hex(info.masks[1])} B ${hex(info.masks[2])} A ${hex(info.masks[3])}`,
              },
            ]
          : []),
        { kind: 'group', label: 'Mip chain', children: mipChain },
      ],
    })
    return {
      summary: {
        format: 'dds',
        width: info.width,
        height: info.height,
        encoding,
        mipLevels: info.mipLevels,
        layers: info.layers,
        faces: info.faces,
        depth: info.depth,
        subresources,
        cubemap: info.cubemap,
      },
      metadata: [
        {
          id: 'dds-image',
          label: 'DDS image',
          entries: [
            { key: 'width', value: info.width },
            { key: 'height', value: info.height },
            { key: 'encoding', value: encoding },
            { key: 'mipLevels', value: info.mipLevels },
            { key: 'layers', value: info.layers },
            { key: 'faces', value: info.faces },
            { key: 'depth', value: info.depth },
            { key: 'subresources', value: subresources },
            { key: 'payloadBytes', value: payloadBytes(info) },
            { key: 'cubemap', value: info.cubemap },
            { key: 'channels', value: channelsOf(info) },
            { key: 'alphaMode', value: alphaModeOf(info) },
            ...(info.snorm ? [{ key: 'snorm', value: true }] : []),
            ...(info.luminance ? [{ key: 'luminance', value: true }] : []),
            ...(info.format === 'rgba-mask' ? [{ key: 'bitCount', value: info.rgbBits }] : []),
            ...(info.dxgiFormat === undefined
              ? []
              : [{ key: 'dxgiFormat', value: info.dxgiFormat }]),
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: info.width, height: info.height, bitDepth: 8 } },
        {
          id: 'image.channels',
          parameters: { count: channelsOf(info), alpha: alphaModeOf(info) !== 'none' },
        },
        ...(info.mipLevels > 1
          ? [{ id: 'image.mipmaps', parameters: { levels: info.mipLevels } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: BigInt(decodedBytes),
      /*
       * Writing is no longer unsupported, and one caveat replaces the two claims that were here:
       * a transform re-encodes the whole surface, so mip levels, array layers and cube faces beyond
       * the first are not carried over. Saying which is lost is the difference between a lossy
       * operation and a surprising one.
       */
      unsupportedFeatures: ['dds-transform-writes-a-single-surface'],
      handlers: {
        /**
         * Apply one named pixel transform and hand back the re-encoded file.
         *
         * The whole file is replaced rather than patched, because every one of these operations
         * changes the pixels and most change the dimensions — there is no byte range that means
         * "the image" in a block-compressed payload. The plan says so through its fidelity, and the
         * output format defaults to what the source used when that format can be written back.
         */
        transform: async input => {
          const request = input ?? {}
          const name = typeof request.transform === 'string' ? request.transform : undefined
          const transform = name === undefined ? undefined : TRANSFORMS[name]
          if (transform === undefined) {
            throw new TypeError(
              `DDS transform must be one of ${Object.keys(TRANSFORMS).join(', ')}`,
            )
          }
          const region = await regionReader(
            bytes,
            info,
          )({
            x: 0,
            y: 0,
            width: info.width,
            height: info.height,
            frame: 0,
            mipLevel: 0,
            layer: 0,
            face: 0,
            slice: 0,
            pixelFormat: 'rgba8',
            maxBytes: decodedBytes,
          })
          const source = { width: region.width, height: region.height, pixels: region.pixels }
          const result = transform.apply(source, request)
          const requested = typeof request.format === 'string' ? request.format : undefined
          const format =
            requested ?? (ENCODABLE_FORMATS.includes(info.format) ? info.format : 'rgba8')
          const encoded = encodeDds(result, { format })
          return {
            kind: 'edit-plan',
            plan: editPlanFromInput(context.input, {
              planId: `${ID}:${context.input.revisions.revision}:${name}`,
              edits: [replaceBytes(0, bytes.byteLength, encoded, `${transform.label} (${format})`)],
              fidelity: {
                roundTrip: 'lossy',
                preservesUnknownData: false,
                notes: [
                  'The surface is re-encoded; mip levels, layers and faces past the first are dropped.',
                ],
              },
            }),
          }
        },
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
