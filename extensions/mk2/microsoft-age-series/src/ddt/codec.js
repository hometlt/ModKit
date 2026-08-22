import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ddt'
const HEADER_BYTES = 16
const MIP_RECORD_BYTES = 8

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u32le(bytes, offset) {
  return viewOf(bytes).getUint32(offset, true)
}

function checkedSlice(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    throw new RangeError(`DDT ${label} is outside the texture`)
  }
  return bytes.slice(offset, offset + length)
}

function decodedBytes(width, height) {
  const length = width * height * 4
  if (!Number.isSafeInteger(length) || length <= 0) throw new RangeError('DDT dimensions overflow')
  return length
}

function textureFormat(flags) {
  if (flags[2] === 4) return 'DXT1'
  if (flags[2] === 8) return flags[0] === 1 ? 'DXT5' : 'DXT3'
  throw new TypeError(`DDT compression flags ${flags.join(',')} are unsupported`)
}

function levelBytes(width, height, format) {
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4)
  return blocks * (format === 'DXT1' ? 8 : 16)
}

function parseDdt(bytes, maximumNodes) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('DDT header is truncated')
  if (ascii(bytes, 0, 4) !== 'RTS3') throw new TypeError('DDT RTS3 magic is missing')
  const flags = Object.freeze([bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0])
  const mipLevels = bytes[7] ?? 0
  const width = u32le(bytes, 8)
  const height = u32le(bytes, 12)
  decodedBytes(width, height)
  if (mipLevels === 0) throw new TypeError('DDT mip count is zero')
  if (mipLevels > maximumNodes) throw new RangeError('DDT mip table exceeds maxNodes')
  const tableBytes = mipLevels * MIP_RECORD_BYTES
  checkedSlice(bytes, HEADER_BYTES, tableBytes, 'mip table')
  const format = textureFormat(flags)
  const levels = []
  for (let index = 0; index < mipLevels; index += 1) {
    const cursor = HEADER_BYTES + index * MIP_RECORD_BYTES
    const offset = u32le(bytes, cursor)
    const length = u32le(bytes, cursor + 4)
    const levelWidth = Math.max(1, Math.floor(width / 2 ** index))
    const levelHeight = Math.max(1, Math.floor(height / 2 ** index))
    const expected = levelBytes(levelWidth, levelHeight, format)
    if (offset < HEADER_BYTES + tableBytes)
      throw new RangeError(`DDT mip ${index} overlaps the header`)
    checkedSlice(bytes, offset, length, `mip ${index}`)
    if (length !== expected) {
      throw new TypeError(`DDT mip ${index} has ${length} bytes, expected ${expected}`)
    }
    levels.push(Object.freeze({ index, offset, length, width: levelWidth, height: levelHeight }))
  }
  return Object.freeze({ width, height, mipLevels, flags, format, levels: Object.freeze(levels) })
}

function expand565(value) {
  const red = (value >>> 11) & 0x1f
  const green = (value >>> 5) & 0x3f
  const blue = value & 0x1f
  return [
    Math.round((red * 255) / 31),
    Math.round((green * 255) / 63),
    Math.round((blue * 255) / 31),
    255,
  ]
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

function dxt3Alphas(view, offset) {
  const values = []
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const packed = view.getUint8(offset + (pixel >>> 1))
    values.push(((packed >>> ((pixel & 1) * 4)) & 0xf) * 17)
  }
  return values
}

function dxt5Alphas(view, offset) {
  const palette = alphaPalette(view.getUint8(offset), view.getUint8(offset + 1))
  let packed = 0n
  for (let index = 0; index < 6; index += 1) {
    packed |= BigInt(view.getUint8(offset + 2 + index)) << BigInt(index * 8)
  }
  return Array.from(
    { length: 16 },
    (_, pixel) => palette[Number((packed >> BigInt(pixel * 3)) & 7n)],
  )
}

function writePixel(output, width, height, blockX, blockY, pixel, color) {
  const x = blockX * 4 + (pixel & 3)
  const y = blockY * 4 + (pixel >>> 2)
  if (x >= width || y >= height) return
  output.set(color, (y * width + x) * 4)
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
  const indices = view.getUint32(offset + 4, true)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const color = [...palette[(indices >>> (pixel * 2)) & 3]]
    if (alphas !== undefined) color[3] = alphas[pixel]
    writePixel(output, width, height, blockX, blockY, pixel, color)
  }
}

function decodeLevel(bytes, info, level) {
  const output = new Uint8Array(decodedBytes(level.width, level.height))
  const payload = checkedSlice(bytes, level.offset, level.length, `mip ${level.index}`)
  const view = viewOf(payload)
  const blockBytes = info.format === 'DXT1' ? 8 : 16
  let offset = 0
  for (let blockY = 0; blockY < Math.ceil(level.height / 4); blockY += 1) {
    for (let blockX = 0; blockX < Math.ceil(level.width / 4); blockX += 1) {
      if (info.format === 'DXT1') {
        decodeColorBlock(view, offset, output, level.width, level.height, blockX, blockY, true)
      } else if (info.format === 'DXT3') {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          level.width,
          level.height,
          blockX,
          blockY,
          false,
          dxt3Alphas(view, offset),
        )
      } else {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          level.width,
          level.height,
          blockX,
          blockY,
          false,
          dxt5Alphas(view, offset),
        )
      }
      offset += blockBytes
    }
  }
  return output
}

function regionReader(bytes, info) {
  const decoded = new Map()
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('DDT region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('DDT decoder exposes only rgba8 texture images')
    }
    const mipLevel = request.mipLevel ?? 0
    if (!Number.isSafeInteger(mipLevel) || mipLevel < 0 || mipLevel >= info.levels.length) {
      throw new RangeError('DDT mip level is outside the texture')
    }
    const level = info.levels[mipLevel]
    if (request.x + request.width > level.width || request.y + request.height > level.height) {
      throw new RangeError('DDT region is outside the mip level')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('DDT region exceeds maxBytes budget')
    }
    let pixels = decoded.get(mipLevel)
    if (pixels === undefined) {
      pixels = decodeLevel(bytes, info, level)
      decoded.set(mipLevel, pixels)
    }
    const region = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * level.width + request.x) * 4
      region.set(pixels.subarray(start, start + request.width * 4), row * request.width * 4)
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels: region,
    })
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'ddt', label: 'AoE3/AoM DDT texture', mediaType: 'image/x-ddt' }),
  async detect(prefix) {
    return prefix.byteLength >= HEADER_BYTES && ascii(prefix, 0, 4) === 'RTS3'
      ? { confidence: 0.99, kind: 'magic', note: 'RTS3 texture header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const info = parseDdt(bytes, context.budget.maxNodes)
    const topDecodedBytes = decodedBytes(info.width, info.height)
    if (topDecodedBytes > context.budget.maxScalarBytes) {
      throw new RangeError('DDT decoded pixels exceed maxScalarBytes')
    }
    const raster = createRasterImageSource(
      bytes,
      'image/x-ddt',
      {
        width: info.width,
        height: info.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: info.mipLevels,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'unknown',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(bytes, info),
    )
    return {
      summary: {
        format: 'ddt',
        width: info.width,
        height: info.height,
        encoding: info.format,
        mipLevels: info.mipLevels,
      },
      metadata: [
        {
          id: 'ddt-image',
          label: 'DDT texture',
          entries: [
            { key: 'magic', value: 'RTS3' },
            { key: 'width', value: info.width },
            { key: 'height', value: info.height },
            { key: 'encoding', value: info.format },
            { key: 'formatFlags', value: info.flags.join(', ') },
            { key: 'mipLevels', value: info.mipLevels },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: info.width, height: info.height, bitDepth: 8 } },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        ...(info.mipLevels > 1
          ? [{ id: 'image.mipmaps', parameters: { levels: info.mipLevels } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: 'DDT RTS3',
          preview: `${info.width} × ${info.height}, ${info.format}`,
          children: info.levels.map(level => ({
            kind: 'image',
            label: `Mip ${level.index}`,
            preview: `${level.width} × ${level.height}, ${level.length} bytes at ${level.offset}`,
          })),
        }),
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: BigInt(topDecodedBytes),
      unsupportedFeatures: ['ddt-writing', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
