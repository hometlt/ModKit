// Hand-ported from org.modkitx/diablo3-tex. The portable profile validates TEX v47 and
// decodes the known raw and component-planar BC payloads without external GPU tooling.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/diablo3-tex'
const MAGIC = 0xdeadbeef
const VERSION = 47
const HEADER_BYTES = 0x270
const MIP_TABLE = 0x38
const MAX_MIPS = 60
const FORMATS = Object.freeze({
  0: Object.freeze({ label: 'A8R8G8B8', bytesPerPixel: 4, alpha: true }),
  4: Object.freeze({ label: 'A4R4G4B4', bytesPerPixel: 2, alpha: true }),
  7: Object.freeze({ label: 'L8', bytesPerPixel: 1, alpha: false }),
  9: Object.freeze({ label: 'BC1 / DXT1', blockBytes: 8, alpha: true }),
  10: Object.freeze({ label: 'BC1 / DXT1 variant', blockBytes: 8, alpha: true }),
  11: Object.freeze({ label: 'BC2 / DXT3', blockBytes: 16, alpha: true }),
  12: Object.freeze({ label: 'BC3 / DXT5', blockBytes: 16, alpha: true }),
  23: Object.freeze({ label: 'A8', bytesPerPixel: 1, alpha: true }),
  43: Object.freeze({ label: 'BC5 / ATI2', blockBytes: 16, alpha: false }),
})

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function knownFormat(id) {
  return FORMATS[id]
}

function checkedImageBytes(width, height) {
  const value = width * height * 4
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError('Diablo III TEX dimensions overflow')
  return value
}

function parseTex(bytes, context) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('Diablo III TEX header is truncated')
  const view = viewOf(bytes)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION) {
    throw new TypeError('Diablo III TEX signature or version is invalid')
  }
  const pixelFormat = view.getUint32(0x20, true)
  const format = knownFormat(pixelFormat)
  if (format === undefined)
    throw new TypeError(`unsupported Diablo III TEX pixel format ${pixelFormat}`)
  const width = view.getUint32(0x24, true)
  const height = view.getUint32(0x28, true)
  const faces = view.getUint32(0x2c, true)
  if (width === 0 || height === 0 || width > 0x10000 || height > 0x10000) {
    throw new RangeError('Diablo III TEX dimensions are invalid')
  }
  if (faces === 0 || faces > 256) throw new RangeError('Diablo III TEX face count is invalid')
  const decodedBytes = checkedImageBytes(width, height)
  if (decodedBytes > context.budget.maxScalarBytes) {
    throw new RangeError('Diablo III TEX decoded image exceeds maxScalarBytes budget')
  }
  const mips = []
  for (let level = 0; level < MAX_MIPS; level += 1) {
    const offset = view.getUint32(MIP_TABLE + level * 8, true)
    const size = view.getUint32(MIP_TABLE + level * 8 + 4, true)
    if ((offset === 0) !== (size === 0))
      throw new TypeError(`Diablo III TEX mip ${level} has an incomplete range`)
    if (offset === 0) break
    const mipWidth = Math.max(1, width >>> level)
    const mipHeight = Math.max(1, height >>> level)
    const expected =
      format.blockBytes === undefined
        ? mipWidth * mipHeight * format.bytesPerPixel
        : Math.ceil(mipWidth / 4) * Math.ceil(mipHeight / 4) * format.blockBytes
    if (!Number.isSafeInteger(expected) || size < expected)
      throw new RangeError(`Diablo III TEX mip ${level} is truncated`)
    const stride = size + (format.blockBytes === undefined ? 0 : 16)
    const end = offset + faces * stride
    if (!Number.isSafeInteger(end) || end > bytes.byteLength)
      throw new RangeError(`Diablo III TEX mip ${level} faces are out of bounds`)
    mips.push(
      Object.freeze({ level, offset, size, width: mipWidth, height: mipHeight, expected, stride }),
    )
  }
  if (mips.length === 0) throw new TypeError('Diablo III TEX has no mip levels')
  if (mips.length > context.budget.maxNodes)
    throw new RangeError('Diablo III TEX mips exceed maxNodes budget')
  const frames = view.getUint32(0x218, true)
  const frameTableOffset = view.getUint32(0x21c, true)
  const frameTableSize = view.getUint32(0x220, true)
  if (
    frames > 1 &&
    (frameTableSize < frames * 80 || frameTableOffset + frameTableSize > bytes.byteLength)
  ) {
    throw new RangeError('Diablo III TEX frame table is out of bounds')
  }
  return Object.freeze({
    snoId: view.getInt32(0x10, true),
    pixelFormat,
    format,
    width,
    height,
    faces,
    flags: view.getUint32(0x30, true),
    extraMips: view.getUint32(0x34, true),
    mips: Object.freeze(mips),
    frames,
    frameTableOffset,
    frameTableSize,
    decodedBytes,
  })
}

function copyPart(source, sourceOffset, target, targetOffset, length) {
  target.set(source.subarray(sourceOffset, sourceOffset + length), targetOffset)
}

function unshuffle(format, source) {
  const blockBytes = format.blockBytes
  if (blockBytes === undefined || source.byteLength % blockBytes !== 0) {
    throw new TypeError('Diablo III TEX compressed payload has an invalid size')
  }
  const output = new Uint8Array(source.byteLength)
  const half = source.byteLength / 2
  const blocks = source.byteLength / blockBytes
  for (let index = 0; index < blocks; index += 1) {
    const target = index * blockBytes
    if (blockBytes === 8) {
      copyPart(source, index * 4, output, target, 4)
      copyPart(source, half + index * 4, output, target + 4, 4)
    } else if (format === FORMATS[11]) {
      copyPart(source, index * 8, output, target, 8)
      copyPart(source, half + index * 4, output, target + 8, 4)
      copyPart(source, half + half / 2 + index * 4, output, target + 12, 4)
    } else {
      copyPart(source, index * 2, output, target, 2)
      copyPart(source, half / 4 + index * 6, output, target + 2, 6)
      copyPart(source, half + index * 4, output, target + 8, 4)
      copyPart(source, half + half / 2 + index * 4, output, target + 12, 4)
    }
  }
  return output
}

function expand565(value) {
  return [
    Math.round((((value >>> 11) & 0x1f) * 255) / 31),
    Math.round((((value >>> 5) & 0x3f) * 255) / 63),
    Math.round(((value & 0x1f) * 255) / 31),
    255,
  ]
}

function colorPalette(first, second, allowTransparent) {
  const a = expand565(first)
  const b = expand565(second)
  return first > second || !allowTransparent
    ? [
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
    : [
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
    for (let index = 1; index <= 6; index += 1)
      values.push(Math.round(((7 - index) * first + index * second) / 7))
  } else {
    for (let index = 1; index <= 4; index += 1)
      values.push(Math.round(((5 - index) * first + index * second) / 5))
    values.push(0, 255)
  }
  return values
}

function alphaIndices(view, offset) {
  const palette = alphaPalette(view.getUint8(offset), view.getUint8(offset + 1))
  let packed = 0n
  for (let index = 0; index < 6; index += 1)
    packed |= BigInt(view.getUint8(offset + 2 + index)) << BigInt(index * 8)
  return Array.from(
    { length: 16 },
    (_, pixel) => palette[Number((packed >> BigInt(pixel * 3)) & 7n)],
  )
}

function writePixel(output, width, height, blockX, blockY, pixel, color) {
  const x = blockX * 4 + (pixel & 3)
  const y = blockY * 4 + (pixel >>> 2)
  if (x < width && y < height) output.set(color, (y * width + x) * 4)
}

function decodeColorBlock(
  view,
  offset,
  output,
  width,
  height,
  blockX,
  blockY,
  transparent,
  alphas,
) {
  const palette = colorPalette(
    view.getUint16(offset, true),
    view.getUint16(offset + 2, true),
    transparent,
  )
  const selectors = view.getUint32(offset + 4, true)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const color = [...palette[(selectors >>> (pixel * 2)) & 3]]
    if (alphas !== undefined) color[3] = alphas[pixel]
    writePixel(output, width, height, blockX, blockY, pixel, color)
  }
}

function decodeCompressed(payload, texture, mip) {
  const source = unshuffle(texture.format, payload)
  const view = viewOf(source)
  const output = new Uint8Array(mip.width * mip.height * 4)
  let offset = 0
  for (let blockY = 0; blockY < Math.ceil(mip.height / 4); blockY += 1) {
    for (let blockX = 0; blockX < Math.ceil(mip.width / 4); blockX += 1) {
      if (texture.pixelFormat === 9 || texture.pixelFormat === 10) {
        decodeColorBlock(view, offset, output, mip.width, mip.height, blockX, blockY, true)
      } else if (texture.pixelFormat === 11) {
        const alpha = Array.from(
          { length: 16 },
          (_, pixel) => ((view.getUint8(offset + (pixel >>> 1)) >>> ((pixel & 1) * 4)) & 0xf) * 17,
        )
        decodeColorBlock(
          view,
          offset + 8,
          output,
          mip.width,
          mip.height,
          blockX,
          blockY,
          false,
          alpha,
        )
      } else if (texture.pixelFormat === 12) {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          mip.width,
          mip.height,
          blockX,
          blockY,
          false,
          alphaIndices(view, offset),
        )
      } else {
        const red = alphaIndices(view, offset)
        const green = alphaIndices(view, offset + 8)
        for (let pixel = 0; pixel < 16; pixel += 1)
          writePixel(output, mip.width, mip.height, blockX, blockY, pixel, [
            red[pixel],
            green[pixel],
            255,
            255,
          ])
      }
      offset += texture.format.blockBytes
    }
  }
  return output
}

function decodeRaw(payload, texture, mip) {
  const output = new Uint8Array(mip.width * mip.height * 4)
  const view = viewOf(payload)
  for (let pixel = 0; pixel < mip.width * mip.height; pixel += 1) {
    const target = pixel * 4
    if (texture.pixelFormat === 0) {
      output.set(
        [payload[target + 2], payload[target + 1], payload[target], payload[target + 3]],
        target,
      )
    } else if (texture.pixelFormat === 4) {
      const value = view.getUint16(pixel * 2, true)
      output.set(
        [
          ((value >>> 8) & 0xf) * 17,
          ((value >>> 4) & 0xf) * 17,
          (value & 0xf) * 17,
          ((value >>> 12) & 0xf) * 17,
        ],
        target,
      )
    } else if (texture.pixelFormat === 7) {
      output.set([payload[pixel], payload[pixel], payload[pixel], 255], target)
    } else {
      output.set([255, 255, 255, payload[pixel]], target)
    }
  }
  return output
}

function decodedFace(bytes, texture, level, face) {
  const mip = texture.mips[level]
  if (mip === undefined) throw new RangeError(`Diablo III TEX mip ${level} is not present`)
  if (!Number.isSafeInteger(face) || face < 0 || face >= texture.faces)
    throw new RangeError(`Diablo III TEX face ${face} is not present`)
  const compressed = texture.format.blockBytes !== undefined
  const offset = mip.offset + face * mip.stride + (compressed ? 16 : 0)
  const payload = bytes.subarray(offset, offset + mip.expected)
  return compressed ? decodeCompressed(payload, texture, mip) : decodeRaw(payload, texture, mip)
}

function regionReader(bytes, texture) {
  const cache = new Map()
  return async request => {
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0))
      throw new TypeError('Diablo III TEX region values must be non-negative safe integers')
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError(
        'Diablo III TEX exposes RGBA8 mip/face data for frame, layer, and slice zero',
      )
    }
    const level = request.mipLevel ?? 0
    const face = request.face ?? 0
    const mip = texture.mips[level]
    if (mip === undefined) throw new RangeError(`Diablo III TEX mip ${level} is not present`)
    if (request.x + request.width > mip.width || request.y + request.height > mip.height)
      throw new RangeError('Diablo III TEX region is outside the image')
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes)
      throw new RangeError('Diablo III TEX region exceeds maxBytes')
    const key = `${level}/${face}`
    let decoded = cache.get(key)
    if (decoded === undefined) {
      decoded = decodedFace(bytes, texture, level, face)
      cache.set(key, decoded)
    }
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * mip.width + request.x) * 4
      pixels.set(decoded.subarray(start, start + request.width * 4), row * request.width * 4)
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
  format: Object.freeze({
    id: 'diablo3-tex',
    label: 'Diablo III TEX texture',
    mediaType: 'image/x-diablo3-tex',
  }),
  async detect(prefix) {
    if (prefix.byteLength < 8) return { confidence: 0, kind: 'magic', note: 'header-truncated' }
    const view = viewOf(prefix)
    return view.getUint32(0, true) === MAGIC && view.getUint32(4, true) === VERSION
      ? { confidence: 0.99, kind: 'magic', note: 'deadbeef-v47' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const texture = parseTex(bytes, context)
    const raster = createRasterImageSource(
      bytes,
      'image/x-diablo3-tex',
      {
        width: texture.width,
        height: texture.height,
        depth: 1,
        layers: 1,
        faces: texture.faces,
        mipLevels: texture.mips.length,
        frames: Math.max(1, texture.frames),
        channels: 4,
        bitDepth: 8,
        colorSpace: texture.pixelFormat === 43 ? 'linear' : 'srgb',
        alphaMode: texture.format.alpha ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(bytes, texture),
    )
    return {
      summary: {
        format: 'diablo3-tex',
        version: VERSION,
        snoId: texture.snoId,
        width: texture.width,
        height: texture.height,
        faces: texture.faces,
        mipLevels: texture.mips.length,
        frames: texture.frames,
        pixelFormat: texture.format.label,
        decodedAccess: true,
      },
      metadata: [
        {
          id: 'diablo3-tex-header',
          label: 'Diablo III TEX texture',
          entries: [
            { key: 'version', value: VERSION },
            { key: 'snoId', value: texture.snoId },
            { key: 'dimensions', value: `${texture.width}x${texture.height}` },
            { key: 'faces', value: texture.faces },
            { key: 'pixelFormat', value: texture.format.label },
            { key: 'mipLevels', value: texture.mips.length },
            { key: 'frames', value: texture.frames },
            { key: 'flags', value: texture.flags },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: texture.width, height: texture.height, bitDepth: 8 },
        },
        { id: 'image.channels', parameters: { count: 4, alpha: texture.format.alpha } },
        { id: 'content.binary', parameters: { version: VERSION } },
      ],
      maxDecodedBytes: texture.decodedBytes,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: 'Diablo III TEX',
          preview: `${texture.width} × ${texture.height}; ${texture.format.label}`,
          children: texture.mips.map(mip => ({
            kind: 'mip',
            label: `Mip ${mip.level}`,
            preview: `${mip.width} × ${mip.height}; ${mip.size} bytes at ${mip.offset}`,
          })),
        }),
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: ['atlas-frame-cropping', 'texture-writing', 'mip-generation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
