import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkitx-x3/codec-kit'

const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ascii = new TextDecoder('latin1')

function matchesSignature(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated PNG u32')
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

function parsePng(bytes, maxChunks) {
  if (!matchesSignature(bytes)) throw new TypeError('PNG signature is invalid')
  const chunks = []
  let offset = 8
  let sawIend = false
  while (offset < bytes.byteLength) {
    if (chunks.length >= maxChunks) throw new RangeError('PNG chunk count exceeds maxNodes budget')
    if (offset + 12 > bytes.byteLength) throw new TypeError('PNG chunk header is truncated')
    const length = u32(bytes, offset)
    const type = ascii.decode(bytes.subarray(offset + 4, offset + 8))
    const end = offset + 12 + length
    if (!/^[A-Za-z]{4}$/u.test(type) || end > bytes.byteLength) {
      throw new TypeError('PNG chunk is malformed or truncated')
    }
    if (u32(bytes, offset + 8 + length) !== crc32(bytes, offset + 4, offset + 8 + length)) {
      throw new TypeError(`PNG ${type} chunk CRC is invalid`)
    }
    chunks.push(Object.freeze({ type, length, offset, dataOffset: offset + 8 }))
    offset = end
    if (type === 'IEND') {
      sawIend = true
      break
    }
  }
  if (!sawIend || offset !== bytes.byteLength) throw new TypeError('PNG must end exactly at IEND')
  const ihdr = chunks[0]
  if (ihdr?.type !== 'IHDR' || ihdr.length !== 13) throw new TypeError('PNG IHDR is missing')
  const data = ihdr.dataOffset
  const width = u32(bytes, data)
  const height = u32(bytes, data + 4)
  const bitDepth = bytes[data + 8]
  const colorType = bytes[data + 9]
  const compression = bytes[data + 10]
  const filter = bytes[data + 11]
  const interlace = bytes[data + 12]
  if (
    width === 0 ||
    height === 0 ||
    compression !== 0 ||
    filter !== 0 ||
    ![0, 1].includes(interlace)
  ) {
    throw new TypeError('PNG IHDR contains unsupported structural values')
  }
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType)
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(bitDepth)) {
    throw new TypeError('PNG color type or bit depth is invalid')
  }
  const animation = chunks.find(chunk => chunk.type === 'acTL')
  const frames = animation?.length === 8 ? u32(bytes, animation.dataOffset) : 1
  return Object.freeze({
    chunks: Object.freeze(chunks),
    width,
    height,
    bitDepth,
    colorType,
    channels,
    interlace,
    frames,
  })
}

function paeth(a, b, c) {
  const value = a + b - c
  const distanceA = Math.abs(value - a)
  const distanceB = Math.abs(value - b)
  const distanceC = Math.abs(value - c)
  return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c
}

async function inflateBounded(compressed, expectedBytes, signal) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('no portable deflate decoder is available')
  }
  const result = new Uint8Array(expectedBytes)
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))
  const reader = stream.getReader()
  let offset = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const chunk = await reader.read()
      if (chunk.done) break
      if (offset + chunk.value.byteLength > expectedBytes) {
        throw new RangeError('PNG inflated data exceeds its declared dimensions')
      }
      result.set(chunk.value, offset)
      offset += chunk.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (offset !== expectedBytes) throw new TypeError('PNG inflated data is truncated')
  return result
}

async function decodeRgba8(bytes, png, signal) {
  const idatChunks = png.chunks.filter(chunk => chunk.type === 'IDAT')
  const compressed = new Uint8Array(idatChunks.reduce((total, chunk) => total + chunk.length, 0))
  let compressedOffset = 0
  for (const chunk of idatChunks) {
    compressed.set(
      bytes.subarray(chunk.dataOffset, chunk.dataOffset + chunk.length),
      compressedOffset,
    )
    compressedOffset += chunk.length
  }
  const rowBytes = png.width * png.channels
  const expectedBytes = (rowBytes + 1) * png.height
  if (!Number.isSafeInteger(expectedBytes)) throw new RangeError('PNG decoded size is unsafe')
  const raw = await inflateBounded(compressed, expectedBytes, signal)
  const unfiltered = new Uint8Array(rowBytes * png.height)
  for (let y = 0; y < png.height; y += 1) {
    const filter = raw[y * (rowBytes + 1)]
    const rowIn = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1))
    const rowOut = unfiltered.subarray(y * rowBytes, (y + 1) * rowBytes)
    const previous = y > 0 ? unfiltered.subarray((y - 1) * rowBytes, y * rowBytes) : undefined
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= png.channels ? (rowOut[x - png.channels] ?? 0) : 0
      const b = previous?.[x] ?? 0
      const c = x >= png.channels ? (previous?.[x - png.channels] ?? 0) : 0
      const input = rowIn[x] ?? 0
      const value =
        filter === 0
          ? input
          : filter === 1
            ? input + a
            : filter === 2
              ? input + b
              : filter === 3
                ? input + Math.floor((a + b) / 2)
                : filter === 4
                  ? input + paeth(a, b, c)
                  : undefined
      if (value === undefined) throw new TypeError(`PNG filter ${filter} is unsupported`)
      rowOut[x] = value & 0xff
    }
  }
  const rgba = new Uint8Array(png.width * png.height * 4)
  for (
    let pixel = 0, input = 0;
    pixel < png.width * png.height;
    pixel += 1, input += png.channels
  ) {
    const output = pixel * 4
    if (png.colorType === 0 || png.colorType === 4) {
      const gray = unfiltered[input] ?? 0
      rgba[output] = gray
      rgba[output + 1] = gray
      rgba[output + 2] = gray
      rgba[output + 3] = png.colorType === 4 ? (unfiltered[input + 1] ?? 255) : 255
    } else {
      rgba[output] = unfiltered[input] ?? 0
      rgba[output + 1] = unfiltered[input + 1] ?? 0
      rgba[output + 2] = unfiltered[input + 2] ?? 0
      rgba[output + 3] = png.colorType === 6 ? (unfiltered[input + 3] ?? 255) : 255
    }
  }
  return rgba
}

function decodedRegionReader(bytes, png) {
  let decoded
  return async (request, signal) => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PNG region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PNG exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > png.width || request.y + request.height > png.height) {
      throw new RangeError('PNG region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PNG region exceeds maxBytes budget')
    }
    decoded ??= decodeRgba8(bytes, png, signal)
    const source = await decoded
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const sourceStart = ((request.y + row) * png.width + request.x) * 4
      pixels.set(
        source.subarray(sourceStart, sourceStart + request.width * 4),
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

/** The decoded `tEXt` chunks: latin-1 keyword, NUL, latin-1 text — the pair `set-text` writes. */
function decodeTextChunks(bytes, png) {
  const decoder = new TextDecoder('latin1')
  const out = []
  for (const chunk of png.chunks) {
    if (chunk.type !== 'tEXt') continue
    const data = bytes.subarray(chunk.dataOffset, chunk.dataOffset + chunk.length)
    const nul = data.indexOf(0)
    if (nul <= 0) continue
    out.push({
      keyword: decoder.decode(data.subarray(0, nul)),
      text: decoder.decode(data.subarray(nul + 1)),
    })
  }
  return out
}

/**
 * ADR-HOST-002 Path A: the one mutating operation of this codec. `edit.field` with
 * `{ keyword, text }` sets or replaces a `tEXt` chunk and returns an edit plan — a single
 * byte-range replace (an insert before IEND when the keyword is new), every other byte of the file
 * untouched, so the claim is byte-identical preservation of unknown data. The codec never writes:
 * the host commits the plan under `write-source` through its editing backend.
 */
const EDIT_FIELD_OPERATION = Object.freeze({
  id: 'edit.field',
  handlerId: 'set-text',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  outputKinds: Object.freeze(['edit-plan']),
})

const latin1 = new TextEncoder()
function latin1Bytes(text) {
  // tEXt is Latin-1: refuse code points the chunk cannot carry instead of mangling them
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0xff) throw new TypeError('tEXt carries Latin-1 only')
  }
  return Uint8Array.from(text, char => char.codePointAt(0) ?? 0)
}

function textChunkBytes(keyword, text) {
  const key = latin1Bytes(keyword)
  const value = latin1Bytes(text)
  if (key.byteLength < 1 || key.byteLength > 79 || key.includes(0)) {
    throw new TypeError('tEXt keyword must be 1–79 Latin-1 characters without NUL')
  }
  if (value.includes(0)) throw new TypeError('tEXt text cannot contain NUL')
  const length = key.byteLength + 1 + value.byteLength
  const chunk = new Uint8Array(12 + length)
  new DataView(chunk.buffer).setUint32(0, length, false)
  chunk.set(latin1.encode('tEXt'), 4)
  chunk.set(key, 8)
  chunk[8 + key.byteLength] = 0
  chunk.set(value, 9 + key.byteLength)
  new DataView(chunk.buffer).setUint32(8 + length, crc32(chunk, 4, 8 + length), false)
  return chunk
}

function textKeywordOf(bytes, chunk) {
  if (chunk.type !== 'tEXt') return undefined
  const end = bytes.indexOf(0, chunk.dataOffset)
  if (end < 0 || end >= chunk.dataOffset + chunk.length) return undefined
  return ascii.decode(bytes.subarray(chunk.dataOffset, end))
}

/** The `set-text` handler: a plan that sets or replaces one tEXt keyword, nothing else moves. */
function setTextHandler(bytes, png, input) {
  return async value => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.keyword !== 'string' ||
      typeof value.text !== 'string'
    ) {
      throw new TypeError('edit.field expects { keyword, text }')
    }
    const replacement = textChunkBytes(value.keyword, value.text)
    const existing = png.chunks.find(chunk => textKeywordOf(bytes, chunk) === value.keyword)
    const iend = png.chunks.find(chunk => chunk.type === 'IEND')
    if (iend === undefined) throw new TypeError('PNG has no IEND chunk')
    const edit =
      existing === undefined
        ? replaceBytes(iend.offset, 0, replacement, `insert tEXt ${value.keyword}`)
        : replaceBytes(
            existing.offset,
            12 + existing.length,
            replacement,
            `replace tEXt ${value.keyword}`,
          )
    return {
      kind: 'edit-plan',
      plan: editPlanFromInput(input, {
        planId: `png-set-text:${value.keyword}`,
        edits: [edit],
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      }),
    }
  }
}

const definition = Object.freeze({
  id: 'org.modkitx/image-png',
  operations: Object.freeze([EDIT_FIELD_OPERATION]),
  format: Object.freeze({ id: 'png', label: 'PNG image', mediaType: 'image/png' }),
  async detect(bytes) {
    const match = matchesSignature(bytes)
    return {
      confidence: match ? 0.999 : 0.01,
      note: match ? 'png-signature' : 'signature-mismatch',
    }
  },
  async inspect(bytes, context) {
    const png = parsePng(bytes, context.budget.maxNodes)
    const hasAlpha = png.colorType === 4 || png.colorType === 6
    const hasPalette = png.colorType === 3
    const decodedAccess =
      context.intent !== 'thumbnail' &&
      png.bitDepth === 8 &&
      [0, 2, 4, 6].includes(png.colorType) &&
      png.interlace === 0 &&
      png.chunks.some(chunk => chunk.type === 'IDAT') &&
      !png.chunks.some(chunk => chunk.type === 'tRNS') &&
      png.width * png.height * 4 <= context.budget.maxScalarBytes &&
      typeof DecompressionStream === 'function'
    const raster = createRasterImageSource(
      bytes,
      'image/png',
      {
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
        alphaMode: hasAlpha ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess,
      },
      decodedAccess ? decodedRegionReader(bytes, png) : undefined,
    )
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
        channels: png.channels,
        hasAlpha,
        frames: png.frames,
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
            { key: 'chunks', value: png.chunks.length },
            { key: 'frames', value: png.frames },
          ],
        },
        /*
         * The values `edit.field` writes, not only their count. Without this a host can *set* a
         * text field and never show its current value — every form starts from a default instead
         * of from what the file says, and the only proof an edit landed is a rising chunk count.
         */
        ...(() => {
          const texts = decodeTextChunks(bytes, png)
          return texts.length === 0
            ? []
            : [
                {
                  id: 'png-text',
                  label: 'Text fields (tEXt)',
                  entries: texts.map(item => ({ key: item.keyword, value: item.text })),
                },
              ]
        })(),
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: png.width, height: png.height, bitDepth: png.bitDepth },
        },
        { id: 'image.channels', parameters: { count: png.channels, alpha: hasAlpha } },
        ...(hasPalette ? [{ id: 'image.palette', parameters: { indexed: true } }] : []),
        ...(png.frames > 1 ? [{ id: 'image.frames', parameters: { count: png.frames } }] : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      handlers: { 'set-text': setTextHandler(bytes, png, context.input) },
      maxDecodedBytes: BigInt(png.width) * BigInt(png.height) * 4n,
      unsupportedFeatures: [...(decodedAccess ? [] : ['decoded-region-provider']), 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
