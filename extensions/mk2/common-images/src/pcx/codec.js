import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/pcx'
const HEADER_BYTES = 128

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('PCX field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function parseHeader(bytes, maxScalarBytes) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('PCX header is truncated')
  const manufacturer = bytes[0]
  const version = bytes[1]
  const encoding = bytes[2]
  const bitsPerPlane = bytes[3]
  const xmin = u16(bytes, 4)
  const ymin = u16(bytes, 6)
  const xmax = u16(bytes, 8)
  const ymax = u16(bytes, 10)
  const hdpi = u16(bytes, 12)
  const vdpi = u16(bytes, 14)
  const planes = bytes[65]
  const bytesPerLine = u16(bytes, 66)
  const paletteInfo = u16(bytes, 68)
  const width = xmax - xmin + 1
  const height = ymax - ymin + 1
  if (
    manufacturer !== 0x0a ||
    ![0, 2, 3, 4, 5].includes(version) ||
    ![0, 1].includes(encoding) ||
    bitsPerPlane < 1 ||
    bitsPerPlane > 8 ||
    planes < 1 ||
    planes > 4 ||
    width < 1 ||
    height < 1 ||
    bytesPerLine < Math.ceil((width * bitsPerPlane) / 8)
  ) {
    throw new TypeError(
      'PCX manufacturer, version, encoding, dimensions, planes, or stride are invalid',
    )
  }
  const rowBytes = bytesPerLine * planes
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const supportedPacking = [1, 2, 4, 8].includes(bitsPerPlane)
  const decodedAccess =
    supportedPacking &&
    decodedBytes <= BigInt(maxScalarBytes) &&
    BigInt(rowBytes) * BigInt(height) <= BigInt(maxScalarBytes)
  const hasVgaPalette =
    bitsPerPlane === 8 &&
    planes === 1 &&
    bytes.byteLength >= HEADER_BYTES + 769 &&
    bytes[bytes.byteLength - 769] === 0x0c
  return Object.freeze({
    manufacturer,
    version,
    encoding,
    bitsPerPlane,
    xmin,
    ymin,
    xmax,
    ymax,
    hdpi,
    vdpi,
    planes,
    bytesPerLine,
    paletteInfo,
    width,
    height,
    rowBytes,
    decodedBytes,
    decodedAccess,
    hasVgaPalette,
    headerPalette: bytes.slice(16, 64),
  })
}

function decodeRows(bytes, pcx) {
  const expected = pcx.rowBytes * pcx.height
  const rows = new Uint8Array(expected)
  const dataEnd = pcx.hasVgaPalette ? bytes.byteLength - 769 : bytes.byteLength
  let source = HEADER_BYTES
  let target = 0
  while (target < expected) {
    if (source >= dataEnd) throw new TypeError('PCX image data is truncated')
    const marker = bytes[source] ?? 0
    source += 1
    if (pcx.encoding === 1 && (marker & 0xc0) === 0xc0) {
      const count = marker & 0x3f
      if (count === 0 || source >= dataEnd || target + count > expected) {
        throw new TypeError('PCX RLE packet is invalid or crosses the declared image')
      }
      rows.fill(bytes[source] ?? 0, target, target + count)
      source += 1
      target += count
    } else {
      rows[target] = marker
      target += 1
    }
  }
  return rows
}

function packedSample(row, planeOffset, x, bitsPerPlane) {
  const bitOffset = x * bitsPerPlane
  const byte = row[planeOffset + Math.floor(bitOffset / 8)] ?? 0
  const shift = 8 - bitsPerPlane - (bitOffset % 8)
  return (byte >>> shift) & ((1 << bitsPerPlane) - 1)
}

function paletteIndex(row, x, pcx) {
  let index = 0
  for (let plane = 0; plane < pcx.planes; plane += 1) {
    const sample = packedSample(row, plane * pcx.bytesPerLine, x, pcx.bitsPerPlane)
    index |= sample << (plane * pcx.bitsPerPlane)
  }
  return index
}

function grayscale(index, pcx) {
  const maximum = (1 << Math.min(8, pcx.bitsPerPlane * pcx.planes)) - 1
  return maximum === 0 ? 0 : Math.round((index * 255) / maximum)
}

function decodePixels(bytes, pcx) {
  const rows = decodeRows(bytes, pcx)
  const pixels = new Uint8Array(pcx.width * pcx.height * 4)
  const vgaPalette = pcx.hasVgaPalette ? bytes.subarray(bytes.byteLength - 768) : undefined
  const hasHeaderPalette = pcx.headerPalette.some(value => value !== 0)
  for (let y = 0; y < pcx.height; y += 1) {
    const row = rows.subarray(y * pcx.rowBytes, (y + 1) * pcx.rowBytes)
    for (let x = 0; x < pcx.width; x += 1) {
      const target = (y * pcx.width + x) * 4
      if (pcx.bitsPerPlane === 8 && pcx.planes >= 3) {
        pixels[target] = row[x] ?? 0
        pixels[target + 1] = row[pcx.bytesPerLine + x] ?? 0
        pixels[target + 2] = row[pcx.bytesPerLine * 2 + x] ?? 0
        pixels[target + 3] = pcx.planes === 4 ? (row[pcx.bytesPerLine * 3 + x] ?? 255) : 255
        continue
      }
      const index = paletteIndex(row, x, pcx)
      let red
      let green
      let blue
      if (pcx.paletteInfo !== 2 && pcx.bitsPerPlane === 8 && pcx.planes === 1 && vgaPalette) {
        red = vgaPalette[index * 3] ?? 0
        green = vgaPalette[index * 3 + 1] ?? 0
        blue = vgaPalette[index * 3 + 2] ?? 0
      } else if (pcx.paletteInfo !== 2 && hasHeaderPalette && index < 16) {
        red = pcx.headerPalette[index * 3] ?? 0
        green = pcx.headerPalette[index * 3 + 1] ?? 0
        blue = pcx.headerPalette[index * 3 + 2] ?? 0
      } else {
        red = grayscale(index, pcx)
        green = red
        blue = red
      }
      pixels[target] = red
      pixels[target + 1] = green
      pixels[target + 2] = blue
      pixels[target + 3] = 255
    }
  }
  return pixels
}

function regionReader(bytes, pcx) {
  let decoded
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PCX region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PCX exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > pcx.width || request.y + request.height > pcx.height) {
      throw new RangeError('PCX region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PCX region exceeds maxBytes budget')
    }
    decoded ??= decodePixels(bytes, pcx)
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * pcx.width + request.x) * 4
      pixels.set(decoded.subarray(source, source + request.width * 4), row * request.width * 4)
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
  format: Object.freeze({ id: 'pcx', label: 'ZSoft Paintbrush PCX', mediaType: 'image/x-pcx' }),
  async detect(prefix) {
    try {
      const pcx = parseHeader(prefix, Number.MAX_SAFE_INTEGER)
      return {
        confidence: 0.95,
        kind: 'structure',
        note: `pcx-v${pcx.version}-${pcx.bitsPerPlane}x${pcx.planes}`,
      }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
    }
  },
  async inspect(bytes, context) {
    const pcx = parseHeader(bytes, context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/x-pcx',
      {
        width: pcx.width,
        height: pcx.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: pcx.planes === 4 && pcx.bitsPerPlane === 8 ? 4 : 3,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: pcx.planes === 4 && pcx.bitsPerPlane === 8 ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: pcx.decodedAccess,
      },
      pcx.decodedAccess ? regionReader(bytes, pcx) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'PCX',
      preview: `${pcx.width} × ${pcx.height}, ${pcx.bitsPerPlane} bit(s) × ${pcx.planes} plane(s)`,
      children: [
        { kind: 'field', label: 'Version', preview: String(pcx.version) },
        { kind: 'field', label: 'Encoding', preview: pcx.encoding === 1 ? 'RLE' : 'raw' },
        { kind: 'field', label: 'Bytes per line', preview: String(pcx.bytesPerLine) },
        {
          kind: 'field',
          label: 'Palette',
          preview: pcx.hasVgaPalette ? '256-color VGA trailer' : 'header/grayscale',
        },
      ],
    })
    return {
      summary: {
        format: 'pcx',
        version: pcx.version,
        width: pcx.width,
        height: pcx.height,
        encoding: pcx.encoding === 1 ? 'rle' : 'raw',
        bitsPerPlane: pcx.bitsPerPlane,
        planes: pcx.planes,
        hasVgaPalette: pcx.hasVgaPalette,
      },
      metadata: [
        {
          id: 'pcx-image',
          label: 'PCX image',
          entries: [
            { key: 'version', value: pcx.version },
            { key: 'width', value: pcx.width },
            { key: 'height', value: pcx.height },
            { key: 'encoding', value: pcx.encoding === 1 ? 'RLE' : 'raw' },
            { key: 'bitsPerPlane', value: pcx.bitsPerPlane },
            { key: 'planes', value: pcx.planes },
            { key: 'bytesPerLine', value: pcx.bytesPerLine },
            { key: 'paletteInfo', value: pcx.paletteInfo },
            { key: 'hasVgaPalette', value: pcx.hasVgaPalette },
            { key: 'hdpi', value: pcx.hdpi },
            { key: 'vdpi', value: pcx.vdpi },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: pcx.width, height: pcx.height, bitDepth: 8 } },
        ...(pcx.planes === 1 ? [{ id: 'image.palette', parameters: { indexed: true } }] : []),
        {
          id: 'image.channels',
          parameters: { count: pcx.planes === 4 ? 4 : 3, alpha: pcx.planes === 4 },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(pcx.decodedAccess ? { maxDecodedBytes: pcx.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(pcx.decodedAccess ? [] : ['decoded-region-provider']),
        'pcx-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
