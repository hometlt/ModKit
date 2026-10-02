/**
 * Baseline JPEG decoding, shared by every codec that has to read a JPEG payload.
 *
 * This is the sequential DCT mode — the one JFIF files and Blizzard's JPEG-compressed BLP1
 * textures use. Progressive and arithmetic-coded streams are refused by name rather than decoded
 * badly: a caller that cannot show those needs to know, not to display something wrong.
 *
 * The inverse DCT here is the plain separable transform against a cosine table. A fast integer
 * approximation would be harder to check against the specification, and an image codec that is
 * subtly wrong is worse than one that is a little slower.
 */
import type { RgbaImage } from './image.js'

export interface JpegDecodeOptions {
  /** Hard ceiling on the decoded RGBA byte count. */
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

export interface JpegFrameInfo {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly progressive: boolean
}

interface Component {
  readonly id: number
  readonly horizontal: number
  readonly vertical: number
  readonly quantizationTable: number
  blocksPerLine: number
  blocksPerColumn: number
  samples: Uint8Array
  stride: number
  huffmanDc: HuffmanTable | undefined
  huffmanAc: HuffmanTable | undefined
  prediction: number
}

/** A canonical Huffman table, flattened to one range per code length. */
interface HuffmanTable {
  readonly minCode: Int32Array
  readonly maxCode: Int32Array
  readonly valuePointer: Int32Array
  readonly values: Uint8Array
}

const ZIGZAG = Int32Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

const MAX_DIMENSION = 1 << 15
const MAX_COMPONENTS = 4

/** COS[u * 8 + x] = C(u) * cos((2x + 1) * u * pi / 16), with C(0) = 1/sqrt(2). */
const COS = (() => {
  const table = new Float64Array(64)
  for (let u = 0; u < 8; u += 1) {
    const scale = u === 0 ? Math.SQRT1_2 : 1
    for (let x = 0; x < 8; x += 1)
      table[u * 8 + x] = scale * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
  return table
})()

function buildHuffmanTable(counts: Uint8Array, values: Uint8Array): HuffmanTable {
  const minCode = new Int32Array(17)
  const maxCode = new Int32Array(17).fill(-1)
  const valuePointer = new Int32Array(17)
  let code = 0
  let offset = 0
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0
    valuePointer[length] = offset
    minCode[length] = code
    maxCode[length] = count === 0 ? -1 : code + count - 1
    code += count
    offset += count
    code <<= 1
  }
  return { minCode, maxCode, valuePointer, values }
}

/** The entropy-coded segment, read bit by bit with JPEG's 0xFF00 byte stuffing. */
class BitReader {
  private byteOffset: number
  private bitBuffer = 0
  private bitCount = 0
  /** Set once the reader runs into a real marker, which ends the entropy-coded data. */
  markerHit = false

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
  ) {
    this.byteOffset = start
  }

  get offset(): number {
    return this.byteOffset
  }

  /** Align to the next byte and step over a restart marker when one is there. */
  skipRestart(): boolean {
    this.bitCount = 0
    let scan = this.byteOffset
    while (scan + 1 < this.bytes.length && this.bytes[scan] !== 0xff) scan += 1
    if (scan + 1 >= this.bytes.length) return false
    const marker = this.bytes[scan + 1] ?? 0
    if (marker < 0xd0 || marker > 0xd7) return false
    this.byteOffset = scan + 2
    this.markerHit = false
    return true
  }

  readBit(): number {
    if (this.bitCount > 0) {
      this.bitCount -= 1
      return (this.bitBuffer >> this.bitCount) & 1
    }
    if (this.byteOffset >= this.bytes.length) {
      this.markerHit = true
      return 0
    }
    const value = this.bytes[this.byteOffset] ?? 0
    if (value === 0xff) {
      const next = this.bytes[this.byteOffset + 1] ?? 0
      if (next !== 0x00) {
        // A real marker ends the scan; stop consuming rather than reading past it.
        this.markerHit = true
        return 0
      }
      this.byteOffset += 2
    } else {
      this.byteOffset += 1
    }
    this.bitBuffer = value
    this.bitCount = 7
    return (value >> 7) & 1
  }

  readBits(count: number): number {
    let value = 0
    for (let index = 0; index < count; index += 1) value = (value << 1) | this.readBit()
    return value
  }

  decodeHuffman(table: HuffmanTable): number {
    let code = 0
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | this.readBit()
      if (this.markerHit) return 0
      const max = table.maxCode[length] ?? -1
      if (max >= 0 && code <= max) {
        const index = (table.valuePointer[length] ?? 0) + code - (table.minCode[length] ?? 0)
        return table.values[index] ?? 0
      }
    }
    this.markerHit = true
    return 0
  }
}

/** JPEG's receive-and-extend: a magnitude category plus its bits becomes a signed value. */
function extend(value: number, length: number): number {
  return length === 0 ? 0 : value < 1 << (length - 1) ? value - (1 << length) + 1 : value
}

/**
 * One 8x8 inverse DCT, written from the definition.
 *
 * `coefficients` arrive in natural (de-zig-zagged) order and already dequantized. Output is
 * level-shifted and clamped to 0..255, written into the component's own sample plane.
 */
function inverseDct(
  coefficients: Float64Array,
  out: Uint8Array,
  outOffset: number,
  stride: number,
): void {
  const rows = new Float64Array(64)
  // Rows first: for each of the 8 rows, a 1-D inverse transform over its 8 frequencies.
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let sum = 0
      for (let u = 0; u < 8; u += 1) {
        const value = coefficients[y * 8 + u] ?? 0
        if (value !== 0) sum += value * (COS[u * 8 + x] ?? 0)
      }
      rows[y * 8 + x] = sum / 2
    }
  }
  // Then columns, with the level shift and clamp folded into the write.
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      let sum = 0
      for (let v = 0; v < 8; v += 1) {
        const value = rows[v * 8 + x] ?? 0
        if (value !== 0) sum += value * (COS[v * 8 + y] ?? 0)
      }
      const sample = Math.round(sum / 2) + 128
      out[outOffset + y * stride + x] = sample < 0 ? 0 : sample > 255 ? 255 : sample
    }
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new RangeError('truncated JPEG 16-bit field')
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

interface ParsedJpeg {
  readonly frame: JpegFrameInfo
  readonly components: Component[]
  readonly restartInterval: number
  readonly scanStart: number
  readonly quantization: (Int32Array | undefined)[]
  readonly adobeTransform: number | undefined
}

/**
 * Read every header a baseline scan needs and stop at the start of its entropy-coded data.
 *
 * `headerBytes` lets a caller supply a shared JPEG header separately from the payload, which is
 * how BLP1 stores its mips; it is simply decoded as if the two were concatenated.
 */
function parse(bytes: Uint8Array): ParsedJpeg {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new TypeError('JPEG SOI signature is invalid')
  const quantization: (Int32Array | undefined)[] = new Array<Int32Array | undefined>(4)
  const huffmanDc: (HuffmanTable | undefined)[] = new Array<HuffmanTable | undefined>(4)
  const huffmanAc: (HuffmanTable | undefined)[] = new Array<HuffmanTable | undefined>(4)
  let frame: JpegFrameInfo | undefined
  let components: Component[] = []
  let maxHorizontal = 1
  let maxVertical = 1
  let restartInterval = 0
  let adobeTransform: number | undefined
  let offset = 2

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1] ?? 0
    offset += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9) break
    const length = u16(bytes, offset)
    if (length < 2 || offset + length > bytes.length)
      throw new TypeError('JPEG segment is truncated')
    const payload = bytes.subarray(offset + 2, offset + length)

    if (marker === 0xdb) {
      let at = 0
      while (at < payload.length) {
        const spec = payload[at] ?? 0
        const precision = spec >> 4
        const slot = spec & 15
        at += 1
        if (slot > 3) throw new TypeError('JPEG quantization table slot is out of range')
        const table = new Int32Array(64)
        for (let index = 0; index < 64; index += 1) {
          table[index] = precision === 0 ? (payload[at] ?? 0) : u16(payload, at)
          at += precision === 0 ? 1 : 2
        }
        quantization[slot] = table
      }
    } else if (marker === 0xc4) {
      let at = 0
      while (at < payload.length) {
        const spec = payload[at] ?? 0
        const slot = spec & 15
        at += 1
        if (slot > 3) throw new TypeError('JPEG Huffman table slot is out of range')
        const counts = payload.subarray(at, at + 16)
        at += 16
        let total = 0
        for (const count of counts) total += count
        const values = payload.subarray(at, at + total)
        at += total
        const table = buildHuffmanTable(
          Uint8Array.from(counts),
          Uint8Array.from(values),
        )
        if ((spec >> 4) === 0) huffmanDc[slot] = table
        else huffmanAc[slot] = table
      }
    } else if (marker === 0xdd) {
      restartInterval = u16(payload, 0)
    } else if (marker === 0xee && payload.length >= 12) {
      // Adobe APP14 says whether three components are YCbCr or RGB, and whether CMYK is inverted.
      adobeTransform = payload[11]
    } else if (marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce) {
      throw new TypeError('progressive JPEG is not decoded by this baseline decoder')
    } else if (marker === 0xc9 || marker === 0xcb || marker === 0xcd || marker === 0xcf) {
      throw new TypeError('arithmetic-coded JPEG is not decoded by this baseline decoder')
    } else if (marker === 0xc0 || marker === 0xc1) {
      const precision = payload[0] ?? 0
      if (precision !== 8) throw new TypeError('only 8-bit JPEG precision is decoded')
      const height = u16(payload, 1)
      const width = u16(payload, 3)
      const count = payload[5] ?? 0
      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION)
        throw new RangeError('JPEG frame dimensions are out of range')
      if (count === 0 || count > MAX_COMPONENTS)
        throw new TypeError('JPEG component count is not supported')
      components = []
      for (let index = 0; index < count; index += 1) {
        const at = 6 + index * 3
        const sampling = payload[at + 1] ?? 0
        const horizontal = sampling >> 4
        const vertical = sampling & 15
        if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4)
          throw new TypeError('JPEG sampling factor is out of range')
        components.push({
          id: payload[at] ?? 0,
          horizontal,
          vertical,
          quantizationTable: payload[at + 2] ?? 0,
          blocksPerLine: 0,
          blocksPerColumn: 0,
          samples: new Uint8Array(0),
          stride: 0,
          huffmanDc: undefined,
          huffmanAc: undefined,
          prediction: 0,
        })
        maxHorizontal = Math.max(maxHorizontal, horizontal)
        maxVertical = Math.max(maxVertical, vertical)
      }
      frame = { width, height, components: count, progressive: false }
    } else if (marker === 0xda) {
      if (frame === undefined) throw new TypeError('JPEG scan appears before its frame header')
      const count = payload[0] ?? 0
      for (let index = 0; index < count; index += 1) {
        const id = payload[1 + index * 2] ?? 0
        const tables = payload[2 + index * 2] ?? 0
        const component = components.find(candidate => candidate.id === id)
        if (component === undefined) throw new TypeError('JPEG scan names an unknown component')
        component.huffmanDc = huffmanDc[tables >> 4]
        component.huffmanAc = huffmanAc[tables & 15]
      }
      const mcusPerLine = Math.ceil(frame.width / (8 * maxHorizontal))
      const mcusPerColumn = Math.ceil(frame.height / (8 * maxVertical))
      for (const component of components) {
        component.blocksPerLine = mcusPerLine * component.horizontal
        component.blocksPerColumn = mcusPerColumn * component.vertical
        component.stride = component.blocksPerLine * 8
        component.samples = new Uint8Array(component.stride * component.blocksPerColumn * 8)
      }
      return {
        frame,
        components,
        restartInterval,
        scanStart: offset + length,
        quantization,
        adobeTransform,
      }
    }
    offset += length
  }
  throw new TypeError('JPEG has no baseline scan')
}

function decodeScan(parsed: ParsedJpeg, bytes: Uint8Array, signal?: AbortSignal): void {
  const { components, restartInterval, quantization } = parsed
  const maxHorizontal = components.reduce((max, one) => Math.max(max, one.horizontal), 1)
  const maxVertical = components.reduce((max, one) => Math.max(max, one.vertical), 1)
  const mcusPerLine = Math.ceil(parsed.frame.width / (8 * maxHorizontal))
  const mcusPerColumn = Math.ceil(parsed.frame.height / (8 * maxVertical))
  const reader = new BitReader(bytes, parsed.scanStart)
  const coefficients = new Int16Array(64)
  const block = new Float64Array(64)
  let sinceRestart = 0

  for (let mcu = 0; mcu < mcusPerLine * mcusPerColumn; mcu += 1) {
    signal?.throwIfAborted()
    if (restartInterval > 0 && sinceRestart === restartInterval) {
      reader.skipRestart()
      for (const component of components) component.prediction = 0
      sinceRestart = 0
    }
    sinceRestart += 1
    const mcuRow = Math.floor(mcu / mcusPerLine)
    const mcuColumn = mcu % mcusPerLine

    for (const component of components) {
      const table = quantization[component.quantizationTable]
      if (table === undefined) throw new TypeError('JPEG names a missing quantization table')
      const dc = component.huffmanDc
      const ac = component.huffmanAc
      if (dc === undefined || ac === undefined)
        throw new TypeError('JPEG names a missing Huffman table')
      for (let v = 0; v < component.vertical; v += 1)
        for (let h = 0; h < component.horizontal; h += 1) {
          coefficients.fill(0)
          const magnitude = reader.decodeHuffman(dc)
          const diff = magnitude === 0 ? 0 : extend(reader.readBits(magnitude), magnitude)
          component.prediction += diff
          coefficients[0] = component.prediction
          let index = 1
          while (index < 64) {
            const symbol = reader.decodeHuffman(ac)
            const size = symbol & 15
            const run = symbol >> 4
            if (size === 0) {
              if (run !== 15) break
              index += 16
              continue
            }
            index += run
            if (index > 63) break
            coefficients[index] = extend(reader.readBits(size), size)
            index += 1
          }
          block.fill(0)
          for (let position = 0; position < 64; position += 1)
            block[ZIGZAG[position] ?? 0] =
              (coefficients[position] ?? 0) * (table[position] ?? 1)
          const blockRow = mcuRow * component.vertical + v
          const blockColumn = mcuColumn * component.horizontal + h
          inverseDct(
            block,
            component.samples,
            blockRow * 8 * component.stride + blockColumn * 8,
            component.stride,
          )
        }
    }
  }
}

/**
 * Nearest-neighbour upsample of one component plane to full frame resolution.
 *
 * The standard does not fix an upsampling filter, and browsers typically interpolate. Against a
 * browser this shows only at chroma edges — a measured mean of about two levels per channel on a
 * 4:2:0 photograph — and never as structural difference.
 */
function sampleAt(
  component: Component,
  x: number,
  y: number,
  maxHorizontal: number,
  maxVertical: number,
): number {
  const sourceX = Math.min(
    component.stride - 1,
    Math.floor((x * component.horizontal) / maxHorizontal),
  )
  const sourceY = Math.floor((y * component.vertical) / maxVertical)
  return component.samples[sourceY * component.stride + sourceX] ?? 0
}

const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value | 0)

/** One decoded component, already upsampled to the full frame size. */
export interface JpegPlane {
  /** The component id the frame header gave it, in frame order. */
  readonly id: number
  /** One byte per pixel, row-major, `width * height` long. */
  readonly samples: Uint8Array
}

export interface JpegPlanes {
  readonly width: number
  readonly height: number
  readonly planes: readonly JpegPlane[]
  /** The Adobe APP14 transform byte, when the file carries one. */
  readonly adobeTransform: number | undefined
}

/**
 * Decode to component planes and stop there.
 *
 * A four-component JPEG has no portable meaning on its own: it may be CMYK, YCCK, or — as in
 * Blizzard's JPEG-compressed BLP1 textures — four channels a container defines for itself. The
 * container knows that order; this decoder does not, and will not guess one.
 */
export function decodeBaselineJpegPlanes(
  bytes: Uint8Array,
  options: JpegDecodeOptions = {},
): JpegPlanes {
  const parsed = parse(bytes)
  const { width, height } = parsed.frame
  const planeBytes = width * height
  if (!Number.isSafeInteger(planeBytes * parsed.components.length))
    throw new RangeError('JPEG dimensions overflow')
  if (options.maxBytes !== undefined && planeBytes * parsed.components.length > options.maxBytes)
    throw new RangeError('decoded JPEG exceeds the caller budget')
  decodeScan(parsed, bytes, options.signal)
  const maxHorizontal = parsed.components.reduce((max, one) => Math.max(max, one.horizontal), 1)
  const maxVertical = parsed.components.reduce((max, one) => Math.max(max, one.vertical), 1)
  const planes = parsed.components.map(component => {
    const samples = new Uint8Array(planeBytes)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        samples[y * width + x] = sampleAt(component, x, y, maxHorizontal, maxVertical)
    return { id: component.id, samples }
  })
  return { width, height, planes, adobeTransform: parsed.adobeTransform }
}

/** Decode a complete baseline JPEG into straight RGBA. */
export function decodeBaselineJpeg(bytes: Uint8Array, options: JpegDecodeOptions = {}): RgbaImage {
  const parsed = parse(bytes)
  const { width, height } = parsed.frame
  const outputBytes = width * height * 4
  if (!Number.isSafeInteger(outputBytes)) throw new RangeError('JPEG dimensions overflow')
  if (options.maxBytes !== undefined && outputBytes > options.maxBytes)
    throw new RangeError('decoded JPEG exceeds the caller budget')
  decodeScan(parsed, bytes, options.signal)

  const components = parsed.components
  const maxHorizontal = components.reduce((max, one) => Math.max(max, one.horizontal), 1)
  const maxVertical = components.reduce((max, one) => Math.max(max, one.vertical), 1)
  const rgba = new Uint8Array(outputBytes)
  const first = components[0]
  if (first === undefined) throw new TypeError('JPEG frame declares no components')
  if (components.length === 4 && parsed.adobeTransform === undefined)
    throw new TypeError(
      'four-component JPEG without an Adobe transform has no portable channel order; ' +
        'decode it with decodeBaselineJpegPlanes and apply the container own order',
    )
  if (components.length === 2)
    throw new TypeError('two-component JPEG is not a colour model this decoder states')

  for (let y = 0; y < height; y += 1) {
    options.signal?.throwIfAborted()
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4
      if (components.length === 1) {
        const grey = sampleAt(first, x, y, maxHorizontal, maxVertical)
        rgba[target] = grey
        rgba[target + 1] = grey
        rgba[target + 2] = grey
        rgba[target + 3] = 255
        continue
      }
      const second = components[1]
      const third = components[2]
      if (second === undefined || third === undefined)
        throw new TypeError('JPEG frame declares fewer components than its scan uses')
      const luma = sampleAt(first, x, y, maxHorizontal, maxVertical)
      const cb = sampleAt(second, x, y, maxHorizontal, maxVertical) - 128
      const cr = sampleAt(third, x, y, maxHorizontal, maxVertical) - 128
      // Adobe transform 0 means the three components are already RGB.
      if (components.length === 3 && parsed.adobeTransform === 0) {
        rgba[target] = luma
        rgba[target + 1] = clamp(cb + 128)
        rgba[target + 2] = clamp(cr + 128)
        rgba[target + 3] = 255
        continue
      }
      rgba[target] = clamp(luma + 1.402 * cr)
      rgba[target + 1] = clamp(luma - 0.344136 * cb - 0.714136 * cr)
      rgba[target + 2] = clamp(luma + 1.772 * cb)
      rgba[target + 3] = 255
    }
  }
  return { width, height, pixels: rgba }
}

/** Frame facts without decoding any pixels, for a codec that only needs to describe the file. */
export function readJpegFrameInfo(bytes: Uint8Array): JpegFrameInfo {
  try {
    return parse(bytes).frame
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('progressive'))
      return { width: 0, height: 0, components: 0, progressive: true }
    throw error
  }
}
