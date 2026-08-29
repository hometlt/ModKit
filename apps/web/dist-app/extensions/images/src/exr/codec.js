// Hand-ported from the MK2 OpenEXR codec. The decoded path is deliberately narrow: uncompressed,
// scanline, single-part, non-deep images with non-subsampled uint32/half/float channels.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/exr'
const MAGIC = 0x01312f76
const latin1 = new TextDecoder('latin1')

const ascii = bytes => latin1.decode(bytes)
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function hasMagic(bytes) {
  return bytes.byteLength >= 4 && viewOf(bytes).getUint32(0, true) === MAGIC
}

function parseHeader(bytes, maxNodes) {
  if (!hasMagic(bytes) || bytes.byteLength < 12) {
    throw new TypeError('OpenEXR header is missing or truncated')
  }
  const attributes = []
  const view = viewOf(bytes)
  const versionField = view.getUint32(4, true)
  let offset = 8
  while (offset < bytes.byteLength) {
    const nameEnd = bytes.indexOf(0, offset)
    if (nameEnd < 0) throw new TypeError('OpenEXR attribute name is unterminated')
    if (nameEnd === offset) {
      return Object.freeze({
        versionField,
        headerEnd: offset + 1,
        attributes: Object.freeze(attributes),
      })
    }
    const name = ascii(bytes.subarray(offset, nameEnd))
    offset = nameEnd + 1
    const typeEnd = bytes.indexOf(0, offset)
    if (typeEnd < 0) throw new TypeError(`OpenEXR attribute type ${name} is unterminated`)
    const type = ascii(bytes.subarray(offset, typeEnd))
    offset = typeEnd + 1
    if (offset + 4 > bytes.byteLength) throw new TypeError(`OpenEXR attribute ${name} is truncated`)
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.byteLength) {
      throw new TypeError(`OpenEXR attribute data ${name} is truncated`)
    }
    attributes.push(
      Object.freeze({
        name,
        type,
        size,
        offset,
        data: bytes.subarray(offset, offset + size),
      }),
    )
    if (attributes.length > maxNodes) throw new RangeError('OpenEXR attributes exceed maxNodes')
    offset += size
  }
  throw new TypeError('OpenEXR header terminator is missing')
}

function findAttribute(header, name) {
  return header.attributes.find(attribute => attribute.name === name)
}

function box2i(attribute) {
  if (attribute?.type !== 'box2i' || attribute.data.byteLength < 16) return undefined
  const view = viewOf(attribute.data)
  return Object.freeze({
    xMin: view.getInt32(0, true),
    yMin: view.getInt32(4, true),
    xMax: view.getInt32(8, true),
    yMax: view.getInt32(12, true),
  })
}

function compressionName(value) {
  return (
    ['none', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'][value] ??
    (value === undefined ? 'missing' : `unknown-${value}`)
  )
}

function pixelTypeName(value) {
  return value === 0 ? 'uint32' : value === 1 ? 'half' : value === 2 ? 'float' : `unknown-${value}`
}

function sampleBytes(value) {
  return value === 1 ? 2 : value === 0 || value === 2 ? 4 : 0
}

function parseChannels(attribute, maxNodes) {
  if (attribute?.type !== 'chlist') return []
  const channels = []
  const data = attribute.data
  const view = viewOf(data)
  let offset = 0
  while (offset < data.byteLength) {
    const nameEnd = data.indexOf(0, offset)
    if (nameEnd < 0) throw new TypeError('OpenEXR channel name is unterminated')
    if (nameEnd === offset) return Object.freeze(channels)
    const name = ascii(data.subarray(offset, nameEnd))
    offset = nameEnd + 1
    if (offset + 16 > data.byteLength) throw new TypeError(`OpenEXR channel ${name} is truncated`)
    const pixelType = view.getInt32(offset, true)
    channels.push(
      Object.freeze({
        name,
        pixelType,
        pixelTypeName: pixelTypeName(pixelType),
        linear: (data[offset + 4] ?? 0) !== 0,
        xSampling: view.getInt32(offset + 8, true),
        ySampling: view.getInt32(offset + 12, true),
      }),
    )
    if (channels.length > maxNodes) throw new RangeError('OpenEXR channels exceed maxNodes')
    offset += 16
  }
  throw new TypeError('OpenEXR channel list terminator is missing')
}

function channelTarget(name) {
  return { R: 0, G: 1, B: 2, A: 3 }[name.toUpperCase()] ?? -1
}

function halfToNumber(value) {
  const sign = (value & 0x8000) === 0 ? 1 : -1
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 31) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

function normalizedByte(value) {
  if (!Number.isFinite(value)) return value > 0 ? 255 : 0
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
}

function readSample(view, offset, pixelType) {
  if (pixelType === 1) return normalizedByte(halfToNumber(view.getUint16(offset, true)))
  if (pixelType === 2) return normalizedByte(view.getFloat32(offset, true))
  return normalizedByte(view.getUint32(offset, true) / 0xffffffff)
}

function imageShape(header, maxNodes) {
  const dataWindow = box2i(findAttribute(header, 'dataWindow'))
  if (dataWindow === undefined) throw new TypeError('OpenEXR dataWindow is required')
  const width = dataWindow.xMax - dataWindow.xMin + 1
  const height = dataWindow.yMax - dataWindow.yMin + 1
  if (width <= 0 || height <= 0) throw new TypeError('OpenEXR dataWindow dimensions are invalid')
  const channels = parseChannels(findAttribute(header, 'channels'), maxNodes)
  if (channels.length === 0) throw new TypeError('OpenEXR channels are required')
  const compression = findAttribute(header, 'compression')?.data[0]
  const previewable =
    compression === 0 &&
    findAttribute(header, 'tiles') === undefined &&
    (header.versionField & 0x00001800) === 0 &&
    channels.every(
      channel =>
        channel.xSampling === 1 && channel.ySampling === 1 && sampleBytes(channel.pixelType) > 0,
    )
  return Object.freeze({ dataWindow, width, height, channels, compression, previewable })
}

function checkedDecodedBytes(width, height, maximum) {
  const size = width * height * 4
  if (!Number.isSafeInteger(size) || size > maximum) {
    throw new RangeError('OpenEXR decoded pixels exceed maxScalarBytes')
  }
  return size
}

function decodePixels(bytes, header, shape, maximum) {
  if (!shape.previewable) {
    throw new RangeError(`OpenEXR ${compressionName(shape.compression)} image is metadata-only`)
  }
  const output = new Uint8Array(checkedDecodedBytes(shape.width, shape.height, maximum))
  for (let offset = 3; offset < output.byteLength; offset += 4) output[offset] = 255
  const tableBytes = shape.height * 8
  if (header.headerEnd + tableBytes > bytes.byteLength) {
    throw new TypeError('OpenEXR scanline offset table is truncated')
  }
  const view = viewOf(bytes)
  for (let index = 0; index < shape.height; index += 1) {
    const chunkOffset = Number(view.getBigUint64(header.headerEnd + index * 8, true))
    if (!Number.isSafeInteger(chunkOffset) || chunkOffset + 8 > bytes.byteLength) {
      throw new TypeError('OpenEXR scanline chunk offset is invalid')
    }
    const y = view.getInt32(chunkOffset, true)
    const packedBytes = view.getUint32(chunkOffset + 4, true)
    const dataStart = chunkOffset + 8
    const dataEnd = dataStart + packedBytes
    if (dataEnd > bytes.byteLength) throw new TypeError('OpenEXR scanline chunk is truncated')
    const row = y - shape.dataWindow.yMin
    if (row < 0 || row >= shape.height)
      throw new TypeError('OpenEXR scanline is outside dataWindow')
    let cursor = dataStart
    for (const channel of shape.channels) {
      const size = sampleBytes(channel.pixelType)
      const target = channelTarget(channel.name)
      if (cursor + shape.width * size > dataEnd) {
        throw new TypeError(`OpenEXR channel ${channel.name} data is truncated`)
      }
      if (target >= 0) {
        for (let x = 0; x < shape.width; x += 1) {
          output[(row * shape.width + x) * 4 + target] = readSample(
            view,
            cursor + x * size,
            channel.pixelType,
          )
        }
      }
      cursor += shape.width * size
    }
    if (cursor !== dataEnd) throw new TypeError('OpenEXR scanline carries unexpected bytes')
  }
  return output
}

function regionReader(bytes, header, shape, maximum) {
  let decoded
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('OpenEXR region coordinates and budget must be non-negative integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('OpenEXR preview exposes only the first image as rgba8')
    }
    if (request.x + request.width > shape.width || request.y + request.height > shape.height) {
      throw new RangeError('OpenEXR region is outside the image')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('OpenEXR region exceeds maxBytes')
    }
    decoded ??= decodePixels(bytes, header, shape, maximum)
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * shape.width + request.x) * 4
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
  format: Object.freeze({ id: 'exr', label: 'OpenEXR', mediaType: 'image/x-exr' }),
  async detect(prefix) {
    return hasMagic(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'openexr-magic' }
      : { confidence: 0, kind: 'magic', note: 'openexr-magic-mismatch' }
  },
  async inspect(bytes, context) {
    const header = parseHeader(bytes, context.budget.maxNodes)
    const shape = imageShape(header, context.budget.maxNodes)
    const displayWindow = box2i(findAttribute(header, 'displayWindow'))
    const bitDepth = shape.channels.some(channel => channel.pixelType === 2)
      ? 32
      : shape.channels.some(channel => channel.pixelType === 1)
        ? 16
        : 32
    const decodedBytes = shape.previewable
      ? checkedDecodedBytes(shape.width, shape.height, context.budget.maxScalarBytes)
      : 0
    const raster = createRasterImageSource(
      bytes,
      'image/x-exr',
      {
        width: shape.width,
        height: shape.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: shape.channels.length,
        bitDepth,
        colorSpace: 'linear',
        alphaMode: shape.channels.some(channel => channel.name.toUpperCase() === 'A')
          ? 'straight'
          : 'opaque',
        orientation: 'top-left',
        decodedAccess: shape.previewable,
      },
      shape.previewable
        ? regionReader(bytes, header, shape, context.budget.maxScalarBytes)
        : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'OpenEXR',
      preview: `${shape.width} × ${shape.height}, ${compressionName(shape.compression)}`,
      children: header.attributes.map(attribute => ({
        kind: 'attribute',
        label: attribute.name,
        preview: `${attribute.type}, ${attribute.size} bytes`,
      })),
    })
    return {
      summary: {
        format: 'exr',
        versionField: `0x${header.versionField.toString(16)}`,
        width: shape.width,
        height: shape.height,
        compression: compressionName(shape.compression),
        channels: shape.channels.map(channel => channel.name),
        decodedAccess: shape.previewable,
        attributes: header.attributes.length,
      },
      metadata: [
        {
          id: 'openexr-image',
          label: 'OpenEXR image',
          entries: [
            { key: 'width', value: shape.width },
            { key: 'height', value: shape.height },
            {
              key: 'dataWindow',
              value: `${shape.dataWindow.xMin},${shape.dataWindow.yMin} - ${shape.dataWindow.xMax},${shape.dataWindow.yMax}`,
            },
            {
              key: 'displayWindow',
              value:
                displayWindow === undefined
                  ? 'missing'
                  : `${displayWindow.xMin},${displayWindow.yMin} - ${displayWindow.xMax},${displayWindow.yMax}`,
            },
            { key: 'compression', value: compressionName(shape.compression) },
            {
              key: 'channels',
              value: shape.channels
                .map(channel => `${channel.name}:${channel.pixelTypeName}`)
                .join(', '),
            },
            { key: 'decodedAccess', value: shape.previewable },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: {
            width: shape.width,
            height: shape.height,
            bitDepth,
            decoded: shape.previewable,
          },
        },
        {
          id: 'image.channels',
          parameters: {
            count: shape.channels.length,
            alpha: shape.channels.some(channel => channel.name.toUpperCase() === 'A'),
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(shape.previewable ? { maxDecodedBytes: BigInt(decodedBytes) } : {}),
      unsupportedFeatures: [
        ...(shape.previewable ? [] : ['rgba-decoding-for-this-image']),
        'compressed-scanline-decoding',
        'tiled-images',
        'multipart-images',
        'deep-images',
        'pixel-editing',
        'openexr-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
