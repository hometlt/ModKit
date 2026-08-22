import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function checkedPixels(width, height, budget) {
  const length = width * height * 4
  if (!Number.isSafeInteger(length) || length <= 0)
    throw new RangeError('image dimensions overflow')
  if (length > budget.maxScalarBytes) throw new RangeError('decoded pixels exceed maxScalarBytes')
  return length
}

function raster(encoded, mime, info, decodeFrame) {
  const cache = new Map()
  return createRasterImageSource(
    encoded,
    mime,
    {
      width: info.width,
      height: info.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: info.frameCount,
      channels: 4,
      bitDepth: 8,
      colorSpace: 'unknown',
      alphaMode: 'straight',
      orientation: 'top-left',
      decodedAccess: true,
    },
    async (request, signal) => {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const frame = request.frame ?? 0
      if (!Number.isSafeInteger(frame) || frame < 0 || frame >= info.frameCount)
        throw new RangeError('frame is outside the image')
      if (request.pixelFormat !== 'rgba8' || (request.mipLevel ?? 0) !== 0)
        throw new RangeError('only rgba8 mip zero is available')
      if (
        ![request.x, request.y, request.width, request.height, request.maxBytes].every(value =>
          Number.isSafeInteger(value),
        ) ||
        request.x < 0 ||
        request.y < 0 ||
        request.width < 0 ||
        request.height < 0 ||
        request.x + request.width > info.width ||
        request.y + request.height > info.height
      )
        throw new RangeError('requested region is outside the image')
      const length = request.width * request.height * 4
      if (!Number.isSafeInteger(length) || length > request.maxBytes)
        throw new RangeError('requested region exceeds maxBytes')
      let pixels = cache.get(frame)
      if (pixels === undefined) {
        pixels = decodeFrame(frame)
        cache.set(frame, pixels)
      }
      const output = new Uint8Array(length)
      for (let row = 0; row < request.height; row += 1) {
        const start = ((request.y + row) * info.width + request.x) * 4
        output.set(pixels.subarray(start, start + request.width * 4), row * request.width * 4)
      }
      return Object.freeze({
        width: request.width,
        height: request.height,
        rowStride: request.width * 4,
        pixelFormat: 'rgba8',
        pixels: output,
      })
    },
  )
}

function grayscale(indices, transparent = true) {
  const output = new Uint8Array(indices.byteLength * 4)
  for (let index = 0; index < indices.byteLength; index += 1) {
    const value = indices[index] ?? 0
    output.set([value, value, value, transparent && value === 0 ? 0 : 255], index * 4)
  }
  return output
}

function rgb555(bytes) {
  const output = new Uint8Array((bytes.byteLength / 2) * 4)
  const view = viewOf(bytes)
  for (let index = 0; index < bytes.byteLength / 2; index += 1) {
    const value = view.getUint16(index * 2, true)
    output.set(
      [
        Math.round((((value >>> 10) & 31) * 255) / 31),
        Math.round((((value >>> 5) & 31) * 255) / 31),
        Math.round(((value & 31) * 255) / 31),
        255,
      ],
      index * 4,
    )
  }
  return output
}

export function parseDune(bytes, bits, budget) {
  const view = viewOf(bytes)
  const frames = []
  let cursor = 0
  while (cursor < bytes.byteLength) {
    while (cursor < bytes.byteLength && bytes[cursor] === 0) cursor += 1
    if (cursor === bytes.byteLength) break
    if (cursor + 29 > bytes.byteLength) throw new TypeError('Dune sprite frame header is truncated')
    if (frames.length >= budget.maxNodes) throw new RangeError('Dune frames exceed maxNodes')
    const width = view.getInt32(cursor + 1, true)
    const height = view.getInt32(cursor + 5, true)
    const bpp = bytes[cursor + 25] ?? 0
    if (width <= 0 || height <= 0 || bpp !== bits)
      throw new TypeError('Dune frame dimensions or bit depth are invalid')
    checkedPixels(width, height, budget)
    const dataOffset = cursor + 29
    const dataBytes = width * height * (bits / 8)
    if (dataOffset + dataBytes > bytes.byteLength)
      throw new TypeError('Dune frame pixels are truncated')
    const type = bytes[cursor] ?? 0
    const paletteHandle = view.getInt32(cursor + 21, true)
    let next = dataOffset + dataBytes
    let paletteOffset
    if (type === 1 && paletteHandle !== 0) {
      paletteOffset = next + 8
      next += 520
      if (next > bytes.byteLength) throw new TypeError('Dune embedded palette is truncated')
    }
    frames.push(
      Object.freeze({
        index: frames.length,
        type,
        width,
        height,
        x: view.getInt32(cursor + 9, true),
        y: view.getInt32(cursor + 13, true),
        dataOffset,
        dataBytes,
        paletteOffset,
      }),
    )
    cursor = next
  }
  if (frames.length === 0) throw new TypeError('Dune sprite has no frames')
  const first = frames[0]
  return Object.freeze({
    width: first.width,
    height: first.height,
    frameCount: frames.length,
    frames: Object.freeze(frames),
    encoding: bits === 8 ? 'indexed8-grayscale-fallback' : 'rgb555',
    decodeFrame(index) {
      const frame = frames[index]
      if (frame.width !== first.width || frame.height !== first.height)
        throw new TypeError('variable-size Dune frames cannot share one raster surface')
      const payload = bytes.subarray(frame.dataOffset, frame.dataOffset + frame.dataBytes)
      return bits === 8 ? grayscale(payload) : rgb555(payload)
    },
  })
}

export function parseShp(bytes, budget) {
  if (bytes.byteLength < 8) throw new TypeError('SHP header is truncated')
  const view = viewOf(bytes)
  const width = view.getUint16(2, true)
  const height = view.getUint16(4, true)
  const frameCount = view.getUint16(6, true)
  checkedPixels(width, height, budget)
  if (frameCount <= 0 || frameCount > budget.maxNodes)
    throw new RangeError('SHP frames exceed maxNodes')
  if (8 + frameCount * 24 > bytes.byteLength) throw new TypeError('SHP frame table is truncated')
  const frames = []
  for (let index = 0; index < frameCount; index += 1) {
    const offset = 8 + index * 24
    const frameWidth = view.getUint16(offset + 4, true)
    const frameHeight = view.getUint16(offset + 6, true)
    const format = bytes[offset + 8] ?? 0
    const legacy = view.getUint32(offset + 12, true)
    const standard = view.getUint32(offset + 20, true)
    const dataOffset = standard || legacy
    const rawBytes = frameWidth * frameHeight
    if (format <= 1 && dataOffset + rawBytes > bytes.byteLength)
      throw new TypeError('SHP raw frame is truncated')
    if (format > 3) throw new TypeError('SHP frame format is unsupported')
    frames.push(Object.freeze({ index, frameWidth, frameHeight, format, dataOffset, rawBytes }))
  }
  return Object.freeze({
    width,
    height,
    frameCount,
    frames: Object.freeze(frames),
    encoding: 'indexed8',
    decodeFrame(index) {
      const frame = frames[index]
      if (frame.format > 1) throw new TypeError('compressed SHP frame decoding is not implemented')
      const output = new Uint8Array(width * height)
      output.set(bytes.subarray(frame.dataOffset, frame.dataOffset + frame.rawBytes))
      return grayscale(output)
    },
  })
}

function diamondBytes(width, height) {
  let row = 4
  let total = 0
  for (let y = 0; y < height; y += 1) {
    total += row
    row += (y < height / 2 - 1 ? 1 : -1) * 4
  }
  return total
}

export function parseTmp(bytes, budget) {
  if (bytes.byteLength < 20) throw new TypeError('TMP header is truncated')
  const view = viewOf(bytes)
  const templateWidth = view.getUint32(0, true)
  const templateHeight = view.getUint32(4, true)
  const width = view.getInt32(8, true)
  const height = view.getInt32(12, true)
  checkedPixels(width, height, budget)
  const slots = templateWidth * templateHeight
  if (!Number.isSafeInteger(slots) || slots <= 0 || slots > budget.maxNodes)
    throw new RangeError('TMP tile slots exceed maxNodes')
  const tableEnd = 16 + slots * 4
  if (tableEnd > bytes.byteLength) throw new TypeError('TMP tile table is truncated')
  const payloadBytes = diamondBytes(width, height)
  if (payloadBytes !== (width * height) / 2)
    throw new TypeError('TMP diamond dimensions are invalid')
  const frames = []
  for (let index = 0; index < slots; index += 1) {
    const offset = view.getUint32(16 + index * 4, true)
    if (offset === 0) continue
    if (offset < tableEnd || offset + 52 + payloadBytes * 2 > bytes.byteLength)
      throw new TypeError('TMP tile payload is truncated')
    if (view.getUint32(offset + 12, true) !== 52 + payloadBytes)
      throw new TypeError('TMP depth offset is invalid')
    frames.push(Object.freeze({ index: frames.length, tileIndex: index, offset }))
  }
  if (frames.length === 0) throw new TypeError('TMP has no populated tiles')
  return Object.freeze({
    width,
    height,
    templateWidth,
    templateHeight,
    frameCount: frames.length,
    frames: Object.freeze(frames),
    encoding: 'indexed8-diamond',
    decodeFrame(index) {
      const frame = frames[index]
      const output = new Uint8Array(width * height)
      let source = frame.offset + 52
      let row = 4
      for (let y = 0; y < height; y += 1) {
        output.set(bytes.subarray(source, source + row), y * width + (width - row) / 2)
        source += row
        row += (y < height / 2 - 1 ? 1 : -1) * 4
      }
      return grayscale(output)
    },
  })
}

export function parseVpl(bytes, budget) {
  if (bytes.byteLength < 784) throw new TypeError('VPL header or palette is truncated')
  const view = viewOf(bytes)
  const firstRemap = view.getUint32(0, true)
  const lastRemap = view.getUint32(4, true)
  const tableCount = view.getUint32(8, true)
  if (firstRemap > lastRemap || lastRemap > 255) throw new TypeError('VPL remap range is invalid')
  if (tableCount <= 0 || tableCount > budget.maxNodes || tableCount > 256)
    throw new RangeError('VPL lighting tables exceed maxNodes')
  if (bytes.byteLength !== 784 + tableCount * 256)
    throw new TypeError('VPL table bytes do not match')
  const width = 16
  const height = 16
  checkedPixels(width, height, budget)
  const palette = bytes.subarray(16, 784)
  return Object.freeze({
    width,
    height,
    frameCount: tableCount + 1,
    frames: Object.freeze(Array.from({ length: tableCount + 1 }, (_, index) => ({ index }))),
    encoding: 'embedded-rgb-palette-and-lighting-tables',
    firstRemap,
    lastRemap,
    tableCount,
    decodeFrame(frame) {
      const table =
        frame === 0 ? undefined : bytes.subarray(784 + (frame - 1) * 256, 784 + frame * 256)
      const output = new Uint8Array(1024)
      for (let index = 0; index < 256; index += 1) {
        const mapped = table?.[index] ?? index
        const source = mapped * 3
        const max = Math.max(
          palette[source] ?? 0,
          palette[source + 1] ?? 0,
          palette[source + 2] ?? 0,
        )
        const scale = max <= 63 ? 255 / 63 : 1
        output.set(
          [
            Math.round((palette[source] ?? 0) * scale),
            Math.round((palette[source + 1] ?? 0) * scale),
            Math.round((palette[source + 2] ?? 0) * scale),
            255,
          ],
          index * 4,
        )
      }
      return output
    },
  })
}

export function parseOpaque(bytes, budget, kind) {
  if (bytes.byteLength < 8) throw new TypeError(`${kind} header is truncated`)
  const view = viewOf(bytes)
  const values = Object.freeze(
    Array.from({ length: Math.min(8, bytes.byteLength >>> 1) }, (_, index) =>
      view.getUint16(index * 2, true),
    ),
  )
  if (values.length > budget.maxNodes) throw new RangeError(`${kind} header fields exceed maxNodes`)
  return Object.freeze({
    width: 0,
    height: 0,
    frameCount: 0,
    frames: Object.freeze([]),
    encoding: 'metadata-only',
    headerWords: values,
  })
}

export function createWestwoodCodec(config) {
  const definition = Object.freeze({
    id: `org.modkitx/${config.id}`,
    version: '1.0.0',
    format: Object.freeze({ id: config.id, label: config.label }),
    async detect(prefix, uri) {
      let name
      try {
        name = new URL(uri).pathname
      } catch {
        name = uri.split(/[?#]/u, 1)[0] ?? uri
      }
      const extensions = config.extensions ?? [config.extension]
      if (!extensions.some(extension => name.toLowerCase().endsWith(`.${extension}`)))
        return { confidence: 0, kind: 'structure', note: 'extension-mismatch' }
      try {
        if (config.sniff !== undefined && !config.sniff(prefix))
          return { confidence: 0, kind: 'structure', note: 'structure-mismatch' }
      } catch {
        return { confidence: 0, kind: 'structure', note: 'structure-mismatch' }
      }
      return {
        confidence: config.confidence ?? 0.86,
        kind: 'structure',
        note: `${config.id} bounded structure`,
      }
    },
    async inspect(bytes, context) {
      const info = config.parse(bytes, context.budget)
      const decodedBytes =
        info.width > 0 ? checkedPixels(info.width, info.height, context.budget) : bytes.byteLength
      const dataSources = {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: config.label,
          preview:
            info.width > 0
              ? `${info.width} × ${info.height}, ${info.frameCount} frame(s)`
              : `${bytes.byteLength} bytes`,
          children: info.frames.map(frame => ({
            kind: 'frame',
            label: `Frame ${frame.index}`,
            preview: frame.format === undefined ? info.encoding : `format ${frame.format}`,
          })),
        }),
      }
      if (info.decodeFrame !== undefined) {
        dataSources['common.view/raster-image-source'] = raster(
          bytes,
          `image/x-${config.id}`,
          info,
          info.decodeFrame,
        )
      }
      return {
        summary: {
          format: config.id,
          width: info.width,
          height: info.height,
          frames: info.frameCount,
          encoding: info.encoding,
          ...(info.headerWords === undefined ? {} : { headerWords: info.headerWords }),
          ...(info.tableCount === undefined ? {} : { tableCount: info.tableCount }),
        },
        metadata: [
          {
            id: config.id,
            label: config.label,
            entries: [
              { key: 'width', value: info.width },
              { key: 'height', value: info.height },
              { key: 'frames', value: info.frameCount },
              { key: 'encoding', value: info.encoding },
            ],
          },
        ],
        traits: [
          ...(info.width > 0
            ? [
                {
                  id: 'image.raster',
                  parameters: {
                    width: info.width,
                    height: info.height,
                    decoded: info.decodeFrame !== undefined,
                  },
                },
              ]
            : []),
          ...(info.frameCount > 1
            ? [{ id: 'image.frames', parameters: { count: info.frameCount } }]
            : []),
          { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ],
        dataSources,
        maxDecodedBytes: decodedBytes,
        unsupportedFeatures: config.unsupported,
      }
    },
  })
  return context => createInspectionCodec(definition, context)
}
