import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/hdr'
const ascii = new TextDecoder('latin1')

function matchesSignature(bytes) {
  const prefix = ascii.decode(bytes.subarray(0, Math.min(bytes.byteLength, 10)))
  return prefix.startsWith('#?RADIANCE') || prefix.startsWith('#?RGBE')
}

function parseHeader(bytes, maxNodes) {
  if (!matchesSignature(bytes)) throw new TypeError('Radiance HDR signature is invalid')
  const limit = Math.min(bytes.byteLength, 64 * 1024)
  const lines = []
  let offset = 0
  let resolution
  while (offset < limit) {
    if (lines.length >= maxNodes)
      throw new RangeError('Radiance HDR header exceeds maxNodes budget')
    let end = bytes.indexOf(0x0a, offset)
    if (end < 0 || end >= limit) throw new TypeError('Radiance HDR resolution line is missing')
    const contentEnd = end > offset && bytes[end - 1] === 0x0d ? end - 1 : end
    const line = ascii.decode(bytes.subarray(offset, contentEnd))
    lines.push(line)
    const match = /^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/iu.exec(line)
    offset = end + 1
    if (match !== null) {
      resolution = Object.freeze({
        ySign: match[1],
        height: Number(match[2]),
        xSign: match[3],
        width: Number(match[4]),
        text: line,
      })
      break
    }
  }
  if (
    resolution === undefined ||
    !Number.isSafeInteger(resolution.width) ||
    !Number.isSafeInteger(resolution.height) ||
    resolution.width < 1 ||
    resolution.height < 1
  ) {
    throw new TypeError('Radiance HDR dimensions are invalid')
  }
  const field = key => lines.find(line => line.startsWith(`${key}=`))?.slice(key.length + 1)
  const format = field('FORMAT')
  if (format !== '32-bit_rle_rgbe') {
    throw new TypeError(`unsupported Radiance HDR format ${format ?? '(missing)'}`)
  }
  return Object.freeze({
    ...resolution,
    headerBytes: offset,
    format,
    exposure: field('EXPOSURE'),
    gamma: field('GAMMA'),
    lines: Object.freeze(lines),
  })
}

function clamp8(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function decodeRgbe(bytes, hdr) {
  const pixelCount = hdr.width * hdr.height
  if (!Number.isSafeInteger(pixelCount * 4))
    throw new RangeError('Radiance HDR decoded size is unsafe')
  const fileOrder = new Uint8Array(pixelCount * 4)
  let source = hdr.headerBytes
  for (let y = 0; y < hdr.height; y += 1) {
    const modernRle =
      hdr.width >= 8 &&
      hdr.width <= 0x7fff &&
      source + 4 <= bytes.byteLength &&
      bytes[source] === 2 &&
      bytes[source + 1] === 2 &&
      ((bytes[source + 2] ?? 0) & 0x80) === 0 &&
      (((bytes[source + 2] ?? 0) << 8) | (bytes[source + 3] ?? 0)) === hdr.width
    if (modernRle) {
      source += 4
      for (let channel = 0; channel < 4; channel += 1) {
        let x = 0
        while (x < hdr.width) {
          if (source >= bytes.byteLength)
            throw new TypeError('Radiance HDR RLE scanline is truncated')
          const count = bytes[source] ?? 0
          source += 1
          if (count > 128) {
            const run = count - 128
            if (run === 0 || source >= bytes.byteLength || x + run > hdr.width) {
              throw new TypeError('Radiance HDR RLE run is invalid')
            }
            const value = bytes[source] ?? 0
            source += 1
            for (let index = 0; index < run; index += 1) {
              fileOrder[(y * hdr.width + x) * 4 + channel] = value
              x += 1
            }
          } else {
            if (count === 0 || source + count > bytes.byteLength || x + count > hdr.width) {
              throw new TypeError('Radiance HDR literal run is invalid')
            }
            for (let index = 0; index < count; index += 1) {
              fileOrder[(y * hdr.width + x) * 4 + channel] = bytes[source] ?? 0
              source += 1
              x += 1
            }
          }
        }
      }
    } else {
      const rowBytes = hdr.width * 4
      if (source + rowBytes > bytes.byteLength)
        throw new TypeError('Radiance HDR scanline is truncated')
      fileOrder.set(bytes.subarray(source, source + rowBytes), y * rowBytes)
      source += rowBytes
    }
  }
  if (source !== bytes.byteLength) throw new TypeError('Radiance HDR has trailing payload bytes')
  const pixels = new Uint8Array(fileOrder.byteLength)
  for (let fileY = 0; fileY < hdr.height; fileY += 1) {
    const targetY = hdr.ySign === '-' ? fileY : hdr.height - 1 - fileY
    for (let fileX = 0; fileX < hdr.width; fileX += 1) {
      const targetX = hdr.xSign === '+' ? fileX : hdr.width - 1 - fileX
      const sourcePixel = (fileY * hdr.width + fileX) * 4
      const targetPixel = (targetY * hdr.width + targetX) * 4
      const exponent = fileOrder[sourcePixel + 3] ?? 0
      const scale = exponent === 0 ? 0 : Math.pow(2, exponent - 128) / 256
      pixels[targetPixel] = clamp8((fileOrder[sourcePixel] ?? 0) * scale)
      pixels[targetPixel + 1] = clamp8((fileOrder[sourcePixel + 1] ?? 0) * scale)
      pixels[targetPixel + 2] = clamp8((fileOrder[sourcePixel + 2] ?? 0) * scale)
      pixels[targetPixel + 3] = 255
    }
  }
  return pixels
}

function regionReader(bytes, hdr) {
  let decoded
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError(
        'Radiance HDR region coordinates and budget must be non-negative safe integers',
      )
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('Radiance HDR exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > hdr.width || request.y + request.height > hdr.height) {
      throw new RangeError('Radiance HDR region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('Radiance HDR region exceeds maxBytes budget')
    }
    decoded ??= decodeRgbe(bytes, hdr)
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * hdr.width + request.x) * 4
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
  format: Object.freeze({ id: 'hdr', label: 'Radiance RGBE HDR', mediaType: 'image/vnd.radiance' }),
  async detect(prefix) {
    return matchesSignature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'radiance-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const hdr = parseHeader(bytes, context.budget.maxNodes)
    const decodedBytes = BigInt(hdr.width) * BigInt(hdr.height) * 4n
    const decodedAccess = decodedBytes <= BigInt(context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/vnd.radiance',
      {
        width: hdr.width,
        height: hdr.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 3,
        bitDepth: 8,
        colorSpace: 'linear',
        alphaMode: 'none',
        orientation: 'top-left',
        decodedAccess,
      },
      decodedAccess ? regionReader(bytes, hdr) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'Radiance HDR',
      preview: `${hdr.width} × ${hdr.height}, ${hdr.format}`,
      children: hdr.lines.map((line, index) => ({
        kind: 'field',
        label: `Header line ${index}`,
        preview: line.length === 0 ? '(blank)' : line,
      })),
    })
    return {
      summary: {
        format: 'hdr',
        width: hdr.width,
        height: hdr.height,
        encoding: hdr.format,
        orientation: hdr.text,
      },
      metadata: [
        {
          id: 'radiance-image',
          label: 'Radiance HDR image',
          entries: [
            { key: 'width', value: hdr.width },
            { key: 'height', value: hdr.height },
            { key: 'format', value: hdr.format },
            { key: 'orientation', value: hdr.text },
            { key: 'headerBytes', value: hdr.headerBytes },
            ...(hdr.exposure === undefined ? [] : [{ key: 'exposure', value: hdr.exposure }]),
            ...(hdr.gamma === undefined ? [] : [{ key: 'gamma', value: hdr.gamma }]),
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: hdr.width, height: hdr.height, bitDepth: 8 } },
        { id: 'image.channels', parameters: { count: 3, alpha: false } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(decodedAccess ? { maxDecodedBytes: decodedBytes } : {}),
      unsupportedFeatures: [
        ...(decodedAccess ? [] : ['decoded-region-provider']),
        'high-dynamic-range-sample-preservation',
        'hdr-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
