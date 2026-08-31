import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/pal'
const latin1 = new TextDecoder('latin1')

function tag(bytes, offset) {
  return latin1.decode(bytes.subarray(offset, offset + 4))
}

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('PAL field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('PAL field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function isJasc(bytes) {
  return latin1.decode(bytes.subarray(0, Math.min(bytes.byteLength, 16))).startsWith('JASC-PAL')
}

function isRiff(bytes) {
  return bytes.byteLength >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'PAL '
}

function emptyColors() {
  const colors = new Uint8Array(256 * 4)
  for (let index = 3; index < colors.length; index += 4) colors[index] = 255
  return colors
}

function parseJasc(bytes, maxNodes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n')
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines[0] !== 'JASC-PAL' || lines.length < 3 || lines.length > maxNodes) {
    throw new TypeError('JASC-PAL header or line count is invalid')
  }
  const version = lines[1]
  const count = Number(lines[2])
  if (!/^\d{4}$/u.test(version) || !Number.isSafeInteger(count) || count < 1 || count > 256) {
    throw new TypeError('JASC-PAL version or color count is invalid')
  }
  if (lines.length !== count + 3)
    throw new TypeError('JASC-PAL color count does not match its rows')
  const colors = emptyColors()
  for (let index = 0; index < count; index += 1) {
    const values = lines[index + 3].split(/\s+/u).map(Number)
    if (
      values.length !== 3 ||
      !values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 255)
    ) {
      throw new TypeError(`JASC-PAL color ${index} is invalid`)
    }
    colors.set(values, index * 4)
  }
  return Object.freeze({ format: 'jasc-pal', count, version, colors })
}

function parseRiff(bytes, maxNodes) {
  const end = 8 + u32(bytes, 4)
  if (end !== bytes.byteLength)
    throw new TypeError('RIFF PAL declared size does not match the source')
  let offset = 12
  let nodes = 0
  while (offset < end) {
    if (nodes >= maxNodes) throw new RangeError('RIFF PAL chunk count exceeds maxNodes budget')
    nodes += 1
    if (offset + 8 > end) throw new TypeError('RIFF PAL chunk header is truncated')
    const id = tag(bytes, offset)
    const size = u32(bytes, offset + 4)
    const payload = offset + 8
    if (payload + size > end) throw new TypeError(`RIFF PAL ${id} chunk is truncated`)
    if (id === 'data') {
      if (size < 4) throw new TypeError('RIFF PAL data chunk is too short')
      const version = u16(bytes, payload)
      const count = u16(bytes, payload + 2)
      if (count < 1 || count > 256 || 4 + count * 4 > size) {
        throw new TypeError('RIFF PAL entry count is invalid')
      }
      const colors = emptyColors()
      for (let index = 0; index < count; index += 1) {
        const source = payload + 4 + index * 4
        colors[index * 4] = bytes[source] ?? 0
        colors[index * 4 + 1] = bytes[source + 1] ?? 0
        colors[index * 4 + 2] = bytes[source + 2] ?? 0
      }
      return Object.freeze({
        format: 'riff-pal',
        count,
        version: `0x${version.toString(16)}`,
        colors,
      })
    }
    offset = payload + size + (size & 1)
  }
  throw new TypeError('RIFF PAL data chunk is missing')
}

function parseBinary(bytes) {
  if (bytes.byteLength !== 768) throw new TypeError('raw PAL must contain exactly 256 RGB entries')
  const sixBit = bytes.every(value => value <= 63)
  const colors = emptyColors()
  for (let index = 0; index < 256; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = bytes[index * 3 + channel] ?? 0
      colors[index * 4 + channel] = sixBit ? (value << 2) | (value >>> 4) : value
    }
  }
  return Object.freeze({
    format: sixBit ? 'westwood-6bit' : 'rgb-8bit',
    count: 256,
    version: 'raw',
    colors,
  })
}

function parsePalette(bytes, maxNodes) {
  if (isJasc(bytes)) return parseJasc(bytes, maxNodes)
  if (isRiff(bytes)) return parseRiff(bytes, maxNodes)
  return parseBinary(bytes)
}

function regionReader(palette) {
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PAL region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PAL exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > 16 || request.y + request.height > 16) {
      throw new RangeError('PAL region is outside the 16 by 16 swatch')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PAL region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * 16 + request.x) * 4
      pixels.set(
        palette.colors.subarray(source, source + request.width * 4),
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
  format: Object.freeze({ id: 'pal', label: 'Palette image' }),
  async detect(prefix) {
    if (isJasc(prefix)) return { confidence: 0.99, kind: 'structure', note: 'jasc-pal' }
    if (isRiff(prefix)) return { confidence: 0.98, kind: 'structure', note: 'riff-pal' }
    if (prefix.byteLength === 768)
      return { confidence: 0.7, kind: 'structure', note: 'raw-256-rgb' }
    return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const palette = parsePalette(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(
      bytes,
      'application/x-palette',
      {
        width: 16,
        height: 16,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(palette),
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'Palette',
      preview: `${palette.format}, ${palette.count} declared color(s)`,
      children: Array.from({ length: Math.min(16, palette.count) }, (_, index) => ({
        kind: 'field',
        label: `Index ${index}`,
        preview: `rgba(${palette.colors[index * 4]}, ${palette.colors[index * 4 + 1]}, ${palette.colors[index * 4 + 2]}, ${palette.colors[index * 4 + 3]})`,
      })),
    })
    return {
      summary: {
        format: 'pal',
        encoding: palette.format,
        colors: palette.count,
        swatchWidth: 16,
        swatchHeight: 16,
      },
      metadata: [
        {
          id: 'palette',
          label: 'Palette image',
          entries: [
            { key: 'encoding', value: palette.format },
            { key: 'version', value: palette.version },
            { key: 'declaredColors', value: palette.count },
            { key: 'swatchWidth', value: 16 },
            { key: 'swatchHeight', value: 16 },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: 16, height: 16, bitDepth: 8 } },
        { id: 'image.palette', parameters: { colors: palette.count } },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: 1024n,
      unsupportedFeatures: ['palette-writing', 'palette-remapping', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
