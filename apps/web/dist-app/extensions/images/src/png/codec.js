import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkit/codec-kit'
import {
  EXPORT_TARGETS,
  PNG_EXPORT_SCHEMA,
  exportRaster,
  rasterEditContent,
  rasterEditContentOperation,
} from '../ops/raster-transforms.js'
import { decodePngSamples, encodePng } from '@modkit/codec-kit/raster'
import { crc32Range } from '@modkit/codec-kit/checksum'

const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ascii = new TextDecoder('latin1')

function matchesSignature(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated PNG u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
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
    if (u32(bytes, offset + 8 + length) !== crc32Range(bytes, offset + 4, offset + 8 + length)) {
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
  const palette = chunks.find(chunk => chunk.type === 'PLTE')
  const transparency = chunks.find(chunk => chunk.type === 'tRNS')
  if (
    colorType === 3 &&
    (palette === undefined ||
      palette.length === 0 ||
      palette.length % 3 !== 0 ||
      palette.length > 3 * (1 << bitDepth) ||
      (transparency !== undefined && transparency.length > palette.length / 3))
  ) {
    throw new TypeError('indexed PNG palette or transparency table is invalid')
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

/**
 * PNG pixels as RGBA8. The samples come from the one PNG decoder of the shared raster layer
 * (filters, palettes, 16-bit and sub-byte grey); this view only lays them out for display.
 */
async function decodeRgba8(bytes, png, signal) {
  const image = await decodePngSamples(bytes, {
    maxPixels: png.width * png.height,
    ...(signal === undefined ? {} : { signal }),
  })
  const shift = image.bitDepth === 16 ? 8 : 0
  const rgba = new Uint8Array(image.width * image.height * 4)
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const at = pixel * image.channels
    const sample = index => (image.samples[at + index] ?? 0) >> shift
    const output = pixel * 4
    if (image.channels <= 2) {
      const grey = sample(0)
      rgba[output] = grey
      rgba[output + 1] = grey
      rgba[output + 2] = grey
      rgba[output + 3] = image.channels === 2 ? sample(1) : 255
    } else {
      rgba[output] = sample(0)
      rgba[output + 1] = sample(1)
      rgba[output + 2] = sample(2)
      rgba[output + 3] = image.channels === 4 ? sample(3) : 255
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
 * `FieldWriteRequest` sets or replaces a `tEXt` chunk and returns an edit plan — a single
 * byte-range replace (an insert before IEND when the keyword is new), every other byte of the file
 * untouched, so the claim is byte-identical preservation of unknown data. The codec never writes:
 * the host commits the plan under `write-source` through its editing backend.
 */
const EDIT_FIELD_OPERATION = Object.freeze({
  id: 'edit.field',
  handlerId: 'set-text',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  inputSchema: Object.freeze({
    $ref: 'modkit://image-png/edit-field.v1',
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: 'png-set-text',
          label: 'Set a PNG text field',
          summary: 'Sets or replaces one tEXt chunk; every other byte of the file is kept.',
          binding: Object.freeze({ groupId: 'png-text' }),
          fields: Object.freeze([
            Object.freeze({
              key: 'key',
              label: 'Keyword',
              type: Object.freeze({ kind: 'text', pattern: '^[^\\u0000]{1,79}$' }),
              inputPath: Object.freeze(['key']),
              required: true,
              initial: 'Description',
              source: 'entry-key',
              description: '1–79 Latin-1 characters, no NUL',
            }),
            Object.freeze({
              key: 'value',
              label: 'Text',
              type: Object.freeze({ kind: 'text' }),
              inputPath: Object.freeze(['value']),
              initial: 'set from the Modkit inspector',
              source: 'entry-value',
              description: 'Latin-1, no NUL',
            }),
          ]),
        }),
      ]),
    }),
  }),
  outputKinds: Object.freeze(['edit-plan']),
})

/**
 * A real, deterministic conversion owned by the PNG codec rather than by a CLI/UI adapter.
 * `subject.convert --target rgba8` routes here in every host and returns tightly packed pixels in
 * top-left row order. `--target dds` (and `png`, after an optional transform) goes through the
 * shared raster export; `{ target: 'dds', icon: true }` is MK2's "Convert PNG Icon to DDS".
 */
const CONVERT_RGBA8_OPERATION = Object.freeze({
  id: 'export.convert',
  handlerId: 'convert-rgba8',
  mutatesSource: false,
  requiredPermissions: Object.freeze(['read-source']),
  inputSchema: PNG_EXPORT_SCHEMA,
  outputKinds: Object.freeze(['bytes']),
})

function convertRgba8Handler(bytes, png) {
  return async (value, options) => {
    if (!EXPORT_TARGETS.includes(value?.target)) {
      throw new TypeError(`PNG conversion target must be one of ${EXPORT_TARGETS.join(', ')}`)
    }
    const palette = png.colorType === 3 && [1, 2, 4, 8].includes(png.bitDepth)
    const direct = png.bitDepth === 8 && [0, 2, 4, 6].includes(png.colorType)
    if (!(direct || palette) || png.interlace !== 0) {
      throw new TypeError(
        'PNG conversion requires non-interlaced 8-bit direct or 1/2/4/8-bit palette pixels',
      )
    }
    const pixels = await decodeRgba8(bytes, png, options?.signal)
    return {
      kind: 'bytes',
      value: await exportRaster({ width: png.width, height: png.height, pixels }, value, {
        signal: options?.signal,
      }),
    }
  }
}

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
  new DataView(chunk.buffer).setUint32(8 + length, crc32Range(chunk, 4, 8 + length), false)
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
    const keyword = value?.groupId === 'png-text' ? value.key : value?.keyword
    const text = value?.groupId === 'png-text' ? value.value : value?.text
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof keyword !== 'string' ||
      typeof text !== 'string'
    ) {
      throw new TypeError('edit.field expects a png-text FieldWriteRequest')
    }
    const replacement = textChunkBytes(keyword, text)
    const existing = png.chunks.find(chunk => textKeywordOf(bytes, chunk) === keyword)
    const iend = png.chunks.find(chunk => chunk.type === 'IEND')
    if (iend === undefined) throw new TypeError('PNG has no IEND chunk')
    const edit =
      existing === undefined
        ? replaceBytes(iend.offset, 0, replacement, `insert tEXt ${keyword}`)
        : replaceBytes(
            existing.offset,
            12 + existing.length,
            replacement,
            `replace tEXt ${keyword}`,
          )
    return {
      kind: 'edit-plan',
      plan: editPlanFromInput(input, {
        planId: `png-set-text:${keyword}`,
        edits: [edit],
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      }),
    }
  }
}

const definition = Object.freeze({
  id: 'modkit/image-png',
  operations: Object.freeze([
    CONVERT_RGBA8_OPERATION,
    EDIT_FIELD_OPERATION,
    rasterEditContentOperation('transform'),
  ]),
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
    const hasAlpha =
      png.colorType === 4 ||
      png.colorType === 6 ||
      (png.colorType === 3 && png.chunks.some(chunk => chunk.type === 'tRNS'))
    const hasPalette = png.colorType === 3
    const decodedDirect =
      png.bitDepth === 8 &&
      [0, 2, 4, 6].includes(png.colorType) &&
      !png.chunks.some(chunk => chunk.type === 'tRNS')
    const decodedPalette = hasPalette && [1, 2, 4, 8].includes(png.bitDepth)
    const decodedAccess =
      context.intent !== 'thumbnail' &&
      (decodedDirect || decodedPalette) &&
      png.interlace === 0 &&
      png.chunks.some(chunk => chunk.type === 'IDAT') &&
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
        channelLayout:
          png.colorType === 0
            ? 'luminance'
            : png.colorType === 4
              ? 'luminance-alpha'
              : hasAlpha
                ? 'rgba'
                : 'rgb',
        compression: 'none',
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
          return [
            {
              id: 'png-text',
              label: 'Text fields (tEXt)',
              entries: (texts.length === 0 ? [{ keyword: 'Description', text: null }] : texts).map(
                item => ({
                  key: item.keyword,
                  value: item.text,
                  type: { kind: 'text' },
                  editable: { write: { operation: 'edit.field' } },
                }),
              ),
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
      handlers: {
        'convert-rgba8': convertRgba8Handler(bytes, png),
        'set-text': setTextHandler(bytes, png, context.input),
        /*
         * Pixels written back as an 8-bit RGBA PNG. The pixels are exact; ancillary chunks (text,
         * gamma, ICC) and the source's bit depth and palette are not carried over, which is what
         * `preservesUnknownData: false` says.
         */
        transform: rasterEditContent({
          codecId: 'modkit/image-png',
          input: context.input,
          bytes,
          decode: async signal => ({
            width: png.width,
            height: png.height,
            pixels: await decodeRgba8(bytes, png, signal),
          }),
          encode: (image, signal) => encodePng(image.width, image.height, image.pixels, signal),
          fidelity: {
            roundTrip: 'semantic',
            preservesUnknownData: false,
            notes: ['Written as 8-bit RGBA; text, gamma and colour-profile chunks are dropped.'],
          },
        }),
      },
      maxDecodedBytes: BigInt(png.width) * BigInt(png.height) * 4n,
      unsupportedFeatures: [...(decodedAccess ? [] : ['decoded-region-provider'])],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
