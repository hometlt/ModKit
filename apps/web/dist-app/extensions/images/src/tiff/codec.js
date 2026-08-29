import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/tiff'
const TYPE_BYTES = Object.freeze({
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
})

const matches = bytes =>
  bytes.byteLength >= 4 &&
  ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))

function createReader(bytes, littleEndian) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const range = (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.byteLength) {
      throw new RangeError('TIFF field is outside the source')
    }
  }
  return Object.freeze({
    u16(offset) {
      range(offset, 2)
      return view.getUint16(offset, littleEndian)
    },
    u32(offset) {
      range(offset, 4)
      return view.getUint32(offset, littleEndian)
    },
    range,
  })
}

function parseTiff(bytes, budget) {
  if (!matches(bytes)) throw new TypeError('TIFF byte order or version is invalid')
  const littleEndian = bytes[0] === 0x49
  const reader = createReader(bytes, littleEndian)
  let ifdOffset = reader.u32(4)
  if (ifdOffset === 0) throw new TypeError('TIFF has no image file directory')
  const seenOffsets = new Set()
  const pages = []
  let nodeCount = 0
  while (ifdOffset !== 0) {
    if (pages.length >= budget.maxDepth)
      throw new RangeError('TIFF page count exceeds maxDepth budget')
    if (seenOffsets.has(ifdOffset)) throw new TypeError('TIFF IFD chain contains a cycle')
    seenOffsets.add(ifdOffset)
    const entryCount = reader.u16(ifdOffset)
    nodeCount += entryCount
    if (nodeCount > budget.maxNodes)
      throw new RangeError('TIFF entry count exceeds maxNodes budget')
    reader.range(ifdOffset + 2, entryCount * 12 + 4)
    const entries = []
    for (let index = 0; index < entryCount; index += 1) {
      const offset = ifdOffset + 2 + index * 12
      const tag = reader.u16(offset)
      const type = reader.u16(offset + 2)
      const count = reader.u32(offset + 4)
      const typeBytes = TYPE_BYTES[type]
      if (typeBytes === undefined)
        throw new TypeError(`TIFF field ${tag} has an unknown type ${type}`)
      const byteLengthBig = BigInt(count) * BigInt(typeBytes)
      if (byteLengthBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`TIFF field ${tag} is too large`)
      }
      const byteLength = Number(byteLengthBig)
      if (byteLength > budget.maxScalarBytes) {
        throw new RangeError(`TIFF field ${tag} exceeds maxScalarBytes budget`)
      }
      const dataOffset = byteLength <= 4 ? offset + 8 : reader.u32(offset + 8)
      reader.range(dataOffset, byteLength)
      entries.push(Object.freeze({ tag, type, count, byteLength, dataOffset }))
    }
    const nextOffset = ifdOffset + 2 + entryCount * 12
    pages.push(Object.freeze({ offset: ifdOffset, entries: Object.freeze(entries) }))
    ifdOffset = reader.u32(nextOffset)
  }

  const first = pages[0]
  const fields = new Map()
  for (const entry of first.entries) {
    if (fields.has(entry.tag)) throw new TypeError(`TIFF first IFD repeats tag ${entry.tag}`)
    fields.set(entry.tag, entry)
  }
  const numericValues = tag => {
    const entry = fields.get(tag)
    if (entry === undefined) return undefined
    if (![1, 3, 4].includes(entry.type))
      throw new TypeError(`TIFF tag ${tag} is not integer-valued`)
    if (entry.count > budget.maxNodes) {
      throw new RangeError(`TIFF tag ${tag} value count exceeds maxNodes budget`)
    }
    const values = []
    for (let index = 0; index < entry.count; index += 1) {
      const offset = entry.dataOffset + index * TYPE_BYTES[entry.type]
      values.push(
        entry.type === 1
          ? (bytes[offset] ?? 0)
          : entry.type === 3
            ? reader.u16(offset)
            : reader.u32(offset),
      )
    }
    return Object.freeze(values)
  }
  const scalar = (tag, fallback) => {
    const values = numericValues(tag)
    if (values === undefined) return fallback
    if (values.length !== 1) throw new TypeError(`TIFF tag ${tag} must contain one value`)
    return values[0]
  }

  const width = scalar(256)
  const height = scalar(257)
  const compression = scalar(259, 1)
  const photometric = scalar(262)
  const orientation = scalar(274, 1)
  const samplesPerPixel = scalar(277, 1)
  const rowsPerStrip = scalar(278, height)
  const planarConfiguration = scalar(284, 1)
  const bitsPerSample = numericValues(258) ?? Object.freeze([1])
  const stripOffsets = numericValues(273) ?? Object.freeze([])
  const stripByteCounts = numericValues(279) ?? Object.freeze([])
  const bitDepth = bitsPerSample.reduce((maximum, value) => Math.max(maximum, value), 0)
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(rowsPerStrip) ||
    width <= 0 ||
    height <= 0 ||
    rowsPerStrip <= 0 ||
    !Number.isSafeInteger(samplesPerPixel) ||
    samplesPerPixel <= 0 ||
    bitDepth <= 0
  ) {
    throw new TypeError('TIFF dimensions or strip geometry is invalid')
  }

  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const stripCount = Math.ceil(height / rowsPerStrip)
  let decodedAccess =
    compression === 1 &&
    photometric === 2 &&
    [3, 4].includes(samplesPerPixel) &&
    bitsPerSample.length === samplesPerPixel &&
    bitsPerSample.every(value => value === 8) &&
    planarConfiguration === 1 &&
    orientation === 1 &&
    stripOffsets.length === stripCount &&
    stripByteCounts.length === stripCount &&
    decodedBytes <= BigInt(budget.maxScalarBytes)
  if (decodedAccess) {
    for (let index = 0; index < stripCount; index += 1) {
      const rows = Math.min(rowsPerStrip, height - index * rowsPerStrip)
      const expectedBytes = rows * width * samplesPerPixel
      const offset = stripOffsets[index]
      const byteLength = stripByteCounts[index]
      if (
        !Number.isSafeInteger(expectedBytes) ||
        byteLength !== expectedBytes ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + byteLength > bytes.byteLength
      ) {
        decodedAccess = false
        break
      }
    }
  }

  return Object.freeze({
    littleEndian,
    pages: Object.freeze(pages),
    width,
    height,
    compression,
    photometric,
    orientation,
    samplesPerPixel,
    rowsPerStrip,
    planarConfiguration,
    bitsPerSample,
    bitDepth,
    stripOffsets,
    stripByteCounts,
    decodedBytes,
    decodedAccess,
  })
}

function decodePixels(bytes, tiff) {
  const output = new Uint8Array(tiff.width * tiff.height * 4)
  let target = 0
  for (let strip = 0; strip < tiff.stripOffsets.length; strip += 1) {
    const offset = tiff.stripOffsets[strip]
    const end = offset + tiff.stripByteCounts[strip]
    for (let source = offset; source < end; source += tiff.samplesPerPixel) {
      output[target] = bytes[source] ?? 0
      output[target + 1] = bytes[source + 1] ?? 0
      output[target + 2] = bytes[source + 2] ?? 0
      output[target + 3] = tiff.samplesPerPixel === 4 ? (bytes[source + 3] ?? 0) : 255
      target += 4
    }
  }
  if (target !== output.byteLength)
    throw new TypeError('TIFF strips do not fill the declared image')
  return output
}

function regionReader(bytes, tiff) {
  let decoded
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('TIFF region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('TIFF exposes only first-page frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > tiff.width || request.y + request.height > tiff.height) {
      throw new RangeError('TIFF region is outside the first page')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('TIFF region exceeds maxBytes budget')
    }
    decoded ??= decodePixels(bytes, tiff)
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * tiff.width + request.x) * 4
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
  format: Object.freeze({ id: 'tiff', label: 'Tagged Image File Format', mediaType: 'image/tiff' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'tiff-byte-order-and-version' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const tiff = parseTiff(bytes, context.budget)
    const raster = createRasterImageSource(
      bytes,
      'image/tiff',
      {
        width: tiff.width,
        height: tiff.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: tiff.pages.length,
        channels: tiff.samplesPerPixel,
        bitDepth: tiff.bitDepth,
        colorSpace: tiff.photometric === 2 ? 'srgb' : 'unknown',
        alphaMode: tiff.samplesPerPixel === 4 ? 'straight' : 'none',
        orientation: tiff.orientation === 1 ? 'top-left' : 'unknown',
        decodedAccess: tiff.decodedAccess,
      },
      tiff.decodedAccess ? regionReader(bytes, tiff) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'TIFF',
      preview: `${tiff.width} × ${tiff.height}, ${tiff.pages.length} page(s)`,
      children: tiff.pages.map((page, index) => ({
        kind: 'directory',
        label: `IFD ${index}`,
        preview: `${page.entries.length} entries at ${page.offset}`,
        children: page.entries.map(entry => ({
          kind: 'field',
          label: `Tag ${entry.tag}`,
          preview: `type ${entry.type}, count ${entry.count}`,
        })),
      })),
    })
    return {
      summary: {
        format: 'tiff',
        byteOrder: tiff.littleEndian ? 'little-endian' : 'big-endian',
        width: tiff.width,
        height: tiff.height,
        pages: tiff.pages.length,
        compression: tiff.compression,
        photometric: tiff.photometric,
        samplesPerPixel: tiff.samplesPerPixel,
        decodedAccess: tiff.decodedAccess,
      },
      metadata: [
        {
          id: 'tiff-image',
          label: 'TIFF first page',
          entries: [
            { key: 'width', value: tiff.width },
            { key: 'height', value: tiff.height },
            { key: 'pages', value: tiff.pages.length },
            { key: 'byteOrder', value: tiff.littleEndian ? 'little-endian' : 'big-endian' },
            { key: 'bitsPerSample', value: [...tiff.bitsPerSample] },
            { key: 'samplesPerPixel', value: tiff.samplesPerPixel },
            { key: 'compression', value: tiff.compression },
            { key: 'photometric', value: tiff.photometric },
            { key: 'orientation', value: tiff.orientation },
            { key: 'rowsPerStrip', value: tiff.rowsPerStrip },
            { key: 'strips', value: tiff.stripOffsets.length },
            { key: 'planarConfiguration', value: tiff.planarConfiguration },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: {
            width: tiff.width,
            height: tiff.height,
            bitDepth: tiff.bitDepth,
          },
        },
        {
          id: 'image.channels',
          parameters: { count: tiff.samplesPerPixel, alpha: tiff.samplesPerPixel === 4 },
        },
        ...(tiff.pages.length > 1
          ? [{ id: 'image.frames', parameters: { count: tiff.pages.length } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(tiff.decodedAccess ? { maxDecodedBytes: tiff.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(tiff.decodedAccess ? [] : ['decoded-region-provider']),
        'compressed-tiled-planar-or-non-rgb-decoding',
        'additional-page-pixel-decoding',
        'tiff-writing',
        'metadata-editing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
