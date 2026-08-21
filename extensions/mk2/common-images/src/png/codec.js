import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/png'
const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const latin1 = new TextDecoder('latin1')

function matches(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('PNG field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}

function crc32(bytes, start, end) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const DEPTHS = Object.freeze({
  0: Object.freeze([1, 2, 4, 8, 16]),
  2: Object.freeze([8, 16]),
  3: Object.freeze([1, 2, 4, 8]),
  4: Object.freeze([8, 16]),
  6: Object.freeze([8, 16]),
})

const CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })

function parsePng(bytes, maxNodes) {
  if (!matches(bytes)) throw new TypeError('PNG signature is invalid')
  const chunks = []
  let offset = 8
  let sawIend = false
  while (offset < bytes.byteLength) {
    if (chunks.length >= maxNodes) throw new RangeError('PNG chunk count exceeds maxNodes budget')
    if (offset + 12 > bytes.byteLength) throw new TypeError('PNG chunk header is truncated')
    const length = u32(bytes, offset)
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8))
    const dataOffset = offset + 8
    const end = dataOffset + length
    const next = end + 4
    if (!/^[A-Za-z]{4}$/u.test(type) || next > bytes.byteLength) {
      throw new TypeError('PNG chunk type or range is invalid')
    }
    if (u32(bytes, end) !== crc32(bytes, offset + 4, end)) {
      throw new TypeError(`PNG ${type} chunk CRC is invalid`)
    }
    chunks.push(Object.freeze({ type, length, offset, dataOffset }))
    offset = next
    if (type === 'IEND') {
      if (length !== 0) throw new TypeError('PNG IEND chunk must be empty')
      sawIend = true
      break
    }
  }
  if (!sawIend || offset !== bytes.byteLength) throw new TypeError('PNG must end exactly at IEND')
  const ihdr = chunks[0]
  if (ihdr?.type !== 'IHDR' || ihdr.length !== 13) throw new TypeError('PNG IHDR is missing')
  if (chunks.filter(chunk => chunk.type === 'IHDR').length !== 1) {
    throw new TypeError('PNG must contain exactly one IHDR')
  }
  const width = u32(bytes, ihdr.dataOffset)
  const height = u32(bytes, ihdr.dataOffset + 4)
  const bitDepth = bytes[ihdr.dataOffset + 8]
  const colorType = bytes[ihdr.dataOffset + 9]
  const compression = bytes[ihdr.dataOffset + 10]
  const filter = bytes[ihdr.dataOffset + 11]
  const interlace = bytes[ihdr.dataOffset + 12]
  if (
    width === 0 ||
    height === 0 ||
    compression !== 0 ||
    filter !== 0 ||
    ![0, 1].includes(interlace) ||
    DEPTHS[colorType]?.includes(bitDepth) !== true
  ) {
    throw new TypeError('PNG IHDR values are invalid')
  }
  const idat = chunks.filter(chunk => chunk.type === 'IDAT')
  if (idat.length === 0) {
    throw new TypeError('PNG has no image data')
  }
  const firstIdat = chunks.findIndex(chunk => chunk.type === 'IDAT')
  const lastIdat = chunks.findLastIndex(chunk => chunk.type === 'IDAT')
  if (chunks.slice(firstIdat, lastIdat + 1).some(chunk => chunk.type !== 'IDAT')) {
    throw new TypeError('PNG IDAT chunks must be consecutive')
  }
  if (chunks.some(chunk => chunk.type[2] === chunk.type[2]?.toLowerCase())) {
    throw new TypeError('PNG chunk reserved bit must be zero')
  }
  const knownCritical = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
  if (
    chunks.some(
      chunk => chunk.type[0] === chunk.type[0]?.toUpperCase() && !knownCritical.has(chunk.type),
    )
  ) {
    throw new TypeError('PNG contains an unknown critical chunk')
  }
  const palette = chunks.find(chunk => chunk.type === 'PLTE')
  if (chunks.filter(chunk => chunk.type === 'PLTE').length > 1) {
    throw new TypeError('PNG must not contain multiple PLTE chunks')
  }
  if (
    colorType === 3 &&
    (palette === undefined ||
      palette.length === 0 ||
      palette.length % 3 !== 0 ||
      palette.length > 3 * 2 ** bitDepth)
  ) {
    throw new TypeError('indexed PNG requires a valid PLTE')
  }
  if (
    palette !== undefined &&
    (palette.offset > chunks[firstIdat].offset || [0, 4].includes(colorType))
  ) {
    throw new TypeError('PNG PLTE placement or color type is invalid')
  }
  const animation = chunks.find(chunk => chunk.type === 'acTL')
  if (
    chunks.filter(chunk => chunk.type === 'acTL').length > 1 ||
    (animation !== undefined &&
      (animation.length !== 8 || animation.offset > chunks[firstIdat].offset))
  ) {
    throw new TypeError('PNG/APNG animation control chunk is invalid')
  }
  const frames = animation?.length === 8 ? u32(bytes, animation.dataOffset) : 1
  if (frames < 1) throw new TypeError('PNG/APNG frame count is invalid')
  return Object.freeze({
    chunks: Object.freeze(chunks),
    width,
    height,
    bitDepth,
    colorType,
    channels: CHANNELS[colorType],
    interlace,
    frames,
    hasPalette: palette !== undefined,
    hasTransparency: chunks.some(chunk => chunk.type === 'tRNS') || [4, 6].includes(colorType),
    idatBytes: idat.reduce((sum, chunk) => sum + chunk.length, 0),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'png', label: 'Portable Network Graphics', mediaType: 'image/png' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'png-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const png = parsePng(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(bytes, 'image/png', {
      width: png.width,
      height: png.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: png.frames,
      channels: png.channels,
      bitDepth: png.bitDepth,
      colorSpace: png.chunks.some(chunk => chunk.type === 'sRGB') ? 'srgb' : 'unknown',
      alphaMode: png.hasTransparency ? 'straight' : 'none',
      orientation: 'top-left',
      decodedAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'PNG',
      preview: `${png.width} × ${png.height}, ${png.bitDepth}-bit`,
      children: png.chunks.map((chunk, index) => ({
        kind: 'chunk',
        label: `${index}: ${chunk.type}`,
        preview: `${chunk.length} data bytes`,
      })),
    })
    return {
      summary: {
        format: 'png',
        width: png.width,
        height: png.height,
        bitDepth: png.bitDepth,
        colorType: png.colorType,
        channels: png.channels,
        frames: png.frames,
        chunks: png.chunks.length,
      },
      metadata: [
        {
          id: 'png-image',
          label: 'PNG image',
          entries: [
            { key: 'width', value: png.width },
            { key: 'height', value: png.height },
            { key: 'bitDepth', value: png.bitDepth },
            { key: 'colorType', value: png.colorType },
            { key: 'channels', value: png.channels },
            { key: 'interlaced', value: png.interlace === 1 },
            { key: 'frames', value: png.frames },
            { key: 'chunks', value: png.chunks.length },
            { key: 'idatBytes', value: png.idatBytes },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: png.width, height: png.height, bitDepth: png.bitDepth },
        },
        { id: 'image.channels', parameters: { count: png.channels, alpha: png.hasTransparency } },
        ...(png.hasPalette ? [{ id: 'image.palette', parameters: { indexed: true } }] : []),
        ...(png.frames > 1 ? [{ id: 'image.frames', parameters: { count: png.frames } }] : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: [
        'decoded-region-provider',
        'png-writing',
        'metadata-editing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
