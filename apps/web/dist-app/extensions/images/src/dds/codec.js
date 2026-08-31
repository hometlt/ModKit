import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/dds'
const DDS_MAGIC = 0x20534444
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40

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
  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)
  checkedImageBytes(width, height)
  const mipLevels = Math.max(1, view.getUint32(28, true))
  const pixelFlags = view.getUint32(80, true)
  const legacyFourCc = fourCc(view, 84)
  let format = 'rgba-mask'
  let dataOffset = 128
  if ((pixelFlags & DDPF_FOURCC) !== 0) {
    format = legacyFourCc
    if (legacyFourCc === 'DX10') {
      if (bytes.byteLength < 148) throw new TypeError('DDS DX10 header is truncated')
      dataOffset = 148
      const dxgi = view.getUint32(128, true)
      const mapped = new Map([
        [71, 'DXT1'],
        [72, 'DXT1'],
        [74, 'DXT3'],
        [75, 'DXT3'],
        [77, 'DXT5'],
        [78, 'DXT5'],
      ]).get(dxgi)
      if (mapped === undefined) throw new TypeError(`DDS DXGI format ${dxgi} is not supported`)
      format = mapped
    }
  } else if ((pixelFlags & DDPF_RGB) === 0) {
    throw new TypeError('DDS pixel format is neither FourCC nor RGB')
  }
  const blockBytes = format === 'DXT1' ? 8 : format === 'DXT3' || format === 'DXT5' ? 16 : 0
  const firstLevelBytes =
    blockBytes === 0
      ? Math.ceil((width * view.getUint32(88, true)) / 8) * height
      : Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes
  if (dataOffset + firstLevelBytes > bytes.byteLength)
    throw new TypeError('DDS pixel payload is truncated')
  return Object.freeze({
    width,
    height,
    mipLevels,
    format,
    dataOffset,
    firstLevelBytes,
    rgbBits: view.getUint32(88, true),
    masks: Object.freeze([
      view.getUint32(92, true),
      view.getUint32(96, true),
      view.getUint32(100, true),
      view.getUint32(104, true),
    ]),
    cubemap: (view.getUint32(112, true) & 0x200) !== 0,
  })
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

function writeBlockPixel(output, width, height, blockX, blockY, pixel, color) {
  const x = blockX * 4 + (pixel & 3)
  const y = blockY * 4 + (pixel >>> 2)
  if (x >= width || y >= height) return
  output.set(color, (y * width + x) * 4)
}

function decodeColorBlock(view, offset, output, info, blockX, blockY, allowTransparent, alphas) {
  const palette = colorPalette(
    view.getUint16(offset, true),
    view.getUint16(offset + 2, true),
    allowTransparent,
  )
  const indices = view.getUint32(offset + 4, true)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const color = [...palette[(indices >>> (pixel * 2)) & 3]]
    if (alphas !== undefined) color[3] = alphas[pixel]
    writeBlockPixel(output, info.width, info.height, blockX, blockY, pixel, color)
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

function decodeUncompressed(bytes, info, output) {
  if (![24, 32].includes(info.rgbBits)) {
    throw new TypeError(`DDS ${info.rgbBits}-bit RGB payload is not supported`)
  }
  const bytesPerPixel = info.rgbBits / 8
  const view = viewOf(bytes)
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = info.dataOffset + index * bytesPerPixel
    let packed = 0
    for (let byte = 0; byte < bytesPerPixel; byte += 1) {
      packed |= view.getUint8(offset + byte) << (byte * 8)
    }
    const target = index * 4
    output[target] = maskValue(packed, info.masks[0], 0)
    output[target + 1] = maskValue(packed, info.masks[1], 0)
    output[target + 2] = maskValue(packed, info.masks[2], 0)
    output[target + 3] = maskValue(packed, info.masks[3], 255)
  }
}

function decodeRgba(bytes, info) {
  const output = new Uint8Array(checkedImageBytes(info.width, info.height))
  if (info.format === 'rgba-mask') {
    decodeUncompressed(bytes, info, output)
    return output
  }
  const view = viewOf(bytes)
  const blockBytes = info.format === 'DXT1' ? 8 : 16
  let offset = info.dataOffset
  for (let blockY = 0; blockY < Math.ceil(info.height / 4); blockY += 1) {
    for (let blockX = 0; blockX < Math.ceil(info.width / 4); blockX += 1) {
      if (info.format === 'DXT1') {
        decodeColorBlock(view, offset, output, info, blockX, blockY, true)
      } else if (info.format === 'DXT3') {
        decodeColorBlock(
          view,
          offset + 8,
          output,
          info,
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
          info,
          blockX,
          blockY,
          false,
          dxt5Alphas(view, offset),
        )
      } else {
        throw new TypeError(`DDS FourCC ${info.format} is not supported`)
      }
      offset += blockBytes
    }
  }
  return output
}

function regionReader(bytes, info) {
  let decoded
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('DDS region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('DDS decoder exposes only the first image as rgba8')
    }
    if (request.x + request.width > info.width || request.y + request.height > info.height) {
      throw new RangeError('DDS region is outside the image')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('DDS region exceeds maxBytes budget')
    }
    decoded ??= decodeRgba(bytes, info)
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * info.width + request.x) * 4
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
        depth: 1,
        layers: 1,
        faces: info.cubemap ? 6 : 1,
        mipLevels: info.mipLevels,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'unknown',
        alphaMode: info.format === 'DXT1' ? 'straight' : 'unknown',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(bytes, info),
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'DDS',
      preview: `${info.width} × ${info.height}, ${info.format}`,
      children: [
        { kind: 'field', label: 'Format', preview: info.format },
        { kind: 'field', label: 'Mip levels', preview: String(info.mipLevels) },
        { kind: 'field', label: 'First level', preview: `${info.firstLevelBytes} bytes` },
      ],
    })
    return {
      summary: {
        format: 'dds',
        width: info.width,
        height: info.height,
        encoding: info.format,
        mipLevels: info.mipLevels,
        cubemap: info.cubemap,
      },
      metadata: [
        {
          id: 'dds-image',
          label: 'DDS image',
          entries: [
            { key: 'width', value: info.width },
            { key: 'height', value: info.height },
            { key: 'encoding', value: info.format },
            { key: 'mipLevels', value: info.mipLevels },
            { key: 'cubemap', value: info.cubemap },
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
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: BigInt(decodedBytes),
      unsupportedFeatures: [
        ...(info.mipLevels > 1 ? ['decoded-mip-levels-after-zero'] : []),
        ...(info.cubemap ? ['decoded-cubemap-faces-after-zero'] : []),
        'pixel-editing',
        'dds-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
