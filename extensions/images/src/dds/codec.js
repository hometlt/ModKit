import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
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
])

/**
 * DXGI formats the header parser recognises by name and refuses by name.
 *
 * BC6H and BC7 stay here deliberately. Their block layouts need a mode/partition decoder an order
 * of magnitude larger than BCn, and the canonical stack reaches them through a third-party WASM
 * package rather than an algorithm that can be read across — the same boundary `pkm/etc.js`
 * records. Naming them keeps the refusal specific instead of "unsupported".
 */
const NAMED_UNDECODED_DXGI_FORMATS = new Map([
  [79, 'BC4_TYPELESS'],
  [82, 'BC5_TYPELESS'],
  [94, 'BC6H_TYPELESS'],
  [95, 'BC6H_UF16'],
  [96, 'BC6H_SF16'],
  [97, 'BC7_TYPELESS'],
  [98, 'BC7_UNORM'],
  [99, 'BC7_UNORM_SRGB'],
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

function parseDds(bytes) {
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
  let premultiplied = false
  let srgb = false
  let luminance = false
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
    premultiplied,
    srgb,
    luminance,
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

/**
 * Expand a 565 endpoint to 8 bits per channel by bit replication.
 *
 * The high bits are repeated into the low bits, which is what D3D specifies and what the GPU does.
 * Rational rounding (v * 255 / 31) is off by one for some inputs, so it would put the viewer's
 * pixels a step away from both the hardware and the legacy decoder this codec is held against.
 */
function expand565(value) {
  const red = (value >>> 11) & 0x1f
  const green = (value >>> 5) & 0x3f
  const blue = value & 0x1f
  return [(red << 3) | (red >>> 2), (green << 2) | (green >>> 4), (blue << 3) | (blue >>> 2), 255]
}

function colorPalette(first, second, allowTransparent) {
  const a = expand565(first)
  const b = expand565(second)
  if (first > second || !allowTransparent) {
    return [
      a,
      b,
      [
        Math.round((2 * a[0] + b[0]) / 3),
        Math.round((2 * a[1] + b[1]) / 3),
        Math.round((2 * a[2] + b[2]) / 3),
        255,
      ],
      [
        Math.round((a[0] + 2 * b[0]) / 3),
        Math.round((a[1] + 2 * b[1]) / 3),
        Math.round((a[2] + 2 * b[2]) / 3),
        255,
      ],
    ]
  }
  return [
    a,
    b,
    [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
      255,
    ],
    [0, 0, 0, 0],
  ]
}

function alphaPalette(first, second) {
  const values = [first, second]
  if (first > second) {
    for (let index = 1; index <= 6; index += 1) {
      values.push(Math.round(((7 - index) * first + index * second) / 7))
    }
  } else {
    for (let index = 1; index <= 4; index += 1) {
      values.push(Math.round(((5 - index) * first + index * second) / 5))
    }
    values.push(0, 255)
  }
  return values
}

function writeBlockPixel(output, width, height, blockX, blockY, pixel, color) {
  const x = blockX * 4 + (pixel & 3)
  const y = blockY * 4 + (pixel >>> 2)
  if (x >= width || y >= height) return
  output.set(color, (y * width + x) * 4)
}

function decodeColorBlock(view, offset, output, surface, blockX, blockY, allowTransparent, alphas) {
  const palette = colorPalette(
    view.getUint16(offset, true),
    view.getUint16(offset + 2, true),
    allowTransparent,
  )
  const indices = view.getUint32(offset + 4, true)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const color = [...palette[(indices >>> (pixel * 2)) & 3]]
    if (alphas !== undefined) color[3] = alphas[pixel]
    writeBlockPixel(output, surface.width, surface.height, blockX, blockY, pixel, color)
  }
}

function dxt3Alphas(view, offset) {
  const values = []
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const packed = view.getUint8(offset + (pixel >>> 1))
    const nibble = (packed >>> ((pixel & 1) * 4)) & 0xf
    values.push(nibble * 17)
  }
  return values
}

function dxt5Alphas(view, offset) {
  const palette = alphaPalette(view.getUint8(offset), view.getUint8(offset + 1))
  let packed = 0n
  for (let index = 0; index < 6; index += 1) {
    packed |= BigInt(view.getUint8(offset + 2 + index)) << BigInt(index * 8)
  }
  return Array.from({ length: 16 }, (_, pixel) => {
    const index = Number((packed >> BigInt(pixel * 3)) & 7n)
    return palette[index]
  })
}

/**
 * BC4/BC5 signed endpoint block.
 *
 * The endpoints are signed bytes reconstructed over [-1,1]; the rgba8 view they are projected into
 * is unsigned, so the reconstructed value is mapped through (v * 0.5 + 0.5). That projection is
 * lossy by construction — a signed-normalized channel has no exact rgba8 spelling.
 */
function signedInterpolatedValues(view, offset) {
  const toSigned = byte => Math.max(-127, byte >= 128 ? byte - 256 : byte) / 127
  const raw0 = view.getUint8(offset)
  const raw1 = view.getUint8(offset + 1)
  const first = toSigned(raw0)
  const second = toSigned(raw1)
  const signedFirst = raw0 >= 128 ? raw0 - 256 : raw0
  const signedSecond = raw1 >= 128 ? raw1 - 256 : raw1
  const palette =
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
  let packed = 0n
  for (let index = 0; index < 6; index += 1) {
    packed |= BigInt(view.getUint8(offset + 2 + index)) << BigInt(index * 8)
  }
  return Array.from({ length: 16 }, (_, pixel) => {
    const index = Number((packed >> BigInt(pixel * 3)) & 7n)
    return Math.round((palette[index] * 0.5 + 0.5) * 255)
  })
}

/** One interpolated 8-byte channel block, unsigned or signed. */
function interpolatedValues(view, offset, snorm) {
  return snorm ? signedInterpolatedValues(view, offset) : dxt5Alphas(view, offset)
}

/** BC4 (ATI1): a single interpolated channel replicated across RGB, alpha opaque. */
function decodeBc4Block(view, offset, output, surface, blockX, blockY, snorm) {
  const red = interpolatedValues(view, offset, snorm)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const value = red[pixel]
    writeBlockPixel(output, surface.width, surface.height, blockX, blockY, pixel, [
      value,
      value,
      value,
      255,
    ])
  }
}

/**
 * BC5 (ATI2): two interpolated channels into red and green.
 *
 * Blue is left at zero rather than reconstructed. SC2 stores tangent-space normal maps here and the
 * third component is implied, but rebuilding it would be a rendering decision this codec does not
 * get to make — the viewer sees exactly the two channels the file stores.
 */
function decodeBc5Block(view, offset, output, surface, blockX, blockY, snorm) {
  const red = interpolatedValues(view, offset, snorm)
  const green = interpolatedValues(view, offset + 8, snorm)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    writeBlockPixel(output, surface.width, surface.height, blockX, blockY, pixel, [
      red[pixel],
      green[pixel],
      0,
      255,
    ])
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

/** Decode one already-resolved surface (a single mip/layer/face/slice) to rgba8. */
function decodeSurface(bytes, info, surface) {
  const output = new Uint8Array(checkedImageBytes(surface.width, surface.height))
  if (info.format === 'rgba-mask') {
    decodeUncompressed(bytes, info, surface, output)
    return output
  }
  const view = viewOf(bytes)
  const blockBytes = blockBytesFor(info.format)
  if (blockBytes === 0) throw new TypeError(`DDS format ${info.format} is not supported`)
  let offset = surface.offset
  for (let blockY = 0; blockY < Math.ceil(surface.height / 4); blockY += 1) {
    for (let blockX = 0; blockX < Math.ceil(surface.width / 4); blockX += 1) {
      if (info.format === 'DXT1') {
        decodeColorBlock(view, offset, output, surface, blockX, blockY, true)
      } else if (info.format === 'DXT3') {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          surface,
          blockX,
          blockY,
          false,
          dxt3Alphas(view, offset),
        )
      } else if (info.format === 'DXT5') {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          surface,
          blockX,
          blockY,
          false,
          dxt5Alphas(view, offset),
        )
      } else if (info.format === 'BC4') {
        decodeBc4Block(view, offset, output, surface, blockX, blockY, info.snorm)
      } else if (info.format === 'BC5') {
        decodeBc5Block(view, offset, output, surface, blockX, blockY, info.snorm)
      } else {
        throw new TypeError(`DDS format ${info.format} is not supported`)
      }
      offset += blockBytes
    }
  }
  return output
}

/** Human-facing name of the stored encoding, keeping the FourCC the file actually carries. */
function encodingLabel(info) {
  const base =
    info.format === 'rgba-mask'
      ? `${info.rgbBits}-bit ${info.luminance ? 'luminance' : 'RGB'}`
      : info.format
  const spellings = []
  if (info.fourCc !== undefined && info.fourCc !== 'DX10' && info.fourCc !== info.format) {
    spellings.push(info.fourCc)
  }
  if (info.snorm) spellings.push('SNORM')
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
  if (info.format === 'BC4' || info.format === 'BC5') return 'none'
  if (info.premultiplied) return 'premultiplied'
  if (info.format === 'DXT1') return 'straight'
  if (info.format === 'rgba-mask') return info.masks[3] === 0 ? 'none' : 'straight'
  return 'unknown'
}

/** Source channel count of the stored surface, before the rgba8 projection. */
function channelsOf(info) {
  if (info.format === 'BC4') return 1
  if (info.format === 'BC5') return 2
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
      pixelsOfSurface = decodeSurface(bytes, info, surface)
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

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
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
      unsupportedFeatures: ['pixel-editing', 'dds-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
