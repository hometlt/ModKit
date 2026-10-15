/*! JPEG XR decoder (native/jpegxr): Microsoft jxrlib, Copyright (c) 2009 Microsoft, BSD license */
/**
 * JPEG XR (ITU-T T.832, formerly HD Photo) decoding, owned here for every codec that meets it:
 * Microsoft's jxrlib, vendored as C under native/jpegxr and built to WebAssembly by its
 * build.mjs, decodes a JPEG XR file into RGBA8. The WASM loads on the first decode, so importing a
 * codec costs nothing; it runs through four imports of its own here, without Emscripten's runtime
 * (which hooks process events in Node), the same in Node, a Node worker and a browser worker.
 *
 * - {@link loadJpegXrDecoder} / {@link decodeJpegXr}: a whole file (container and codestream),
 *   8-bit grey, RGB or RGBA, alpha planar or interleaved, refused past `maxOutputBytes`.
 * - {@link jpegXrFileFromHeaderless}: the file for a codestream whose writer cut off the image
 *   header (id Tech virtual-texture pages keep only the plane headers and one spatial tile), so
 *   no codec rebuilds that header itself.
 * - {@link decodeJpegXrComponents}: explicit raw 1..3 component bytes, no ICC or game-specific
 *   YCoCg/normal conversion. Optional `hdphoto-independent` selects the independently coded
 *   spatial, subversion-1, overlap-1/no-flexbits/no-alpha HD Photo dialect; never auto-detected.
 *
 * Not decoded: 16-bit, fixed, float, CMYK, premultiplied formats, n-component RGBA conversion
 * ({@link JPEGXR_UNSUPPORTED}); writing JPEG XR.
 */
import type { RgbaImage } from './image.js'

/** The file is not JPEG XR, or its codestream does not decode. */
export const JPEGXR_INVALID = 'codec-kit/jpegxr-invalid'
/** The file is JPEG XR in a pixel format this decoder does not return. */
export const JPEGXR_UNSUPPORTED = 'codec-kit/jpegxr-unsupported'
/** The decoded image would pass the caller's `maxOutputBytes`. */
export const JPEGXR_OUTPUT_LIMIT = 'codec-kit/jpegxr-output-limit'

export interface JpegXrDecodeOptions {
  /** Positive safe-integer byte bound: RGBA width×height×4, or raw width×height×componentCount. */
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
}

/** Decode one JPEG XR file into RGBA8. */
export type JpegXrDecoder = (file: Uint8Array, options: JpegXrDecodeOptions) => RgbaImage

/** Interleaved biased 8-bit codestream components, not implicitly RGB or alpha. */
export interface JpegXrComponentImage {
  readonly width: number
  readonly height: number
  readonly componentCount: 1 | 2 | 3
  readonly pixels: Uint8Array
}

export interface JpegXrComponentDecodeOptions extends JpegXrDecodeOptions {
  /** Default standard JPEG XR; HDP has a deliberately narrow, explicitly admitted profile. */
  readonly dialect?: 'jpegxr' | 'hdphoto-independent'
}

/** A codestream without its image header: what the header would have said, and the rest. */
export interface HeaderlessJpegXr {
  readonly width: number
  readonly height: number
  /** OVERLAP_MODE: 0 none, 1 one level, 2 two levels. */
  readonly overlap: 0 | 1 | 2
  /** Whether an alpha image plane (and its plane header) follows the colour plane. */
  readonly alpha: boolean
  /** Codec sub-version: 0 the original operators (HD Photo, id Tech pages), 1 JPEG XR. Default 0. */
  readonly subVersion?: 0 | 1
  /** Default RGBA-compatible file. Components uses gray or generic n-channel container output. */
  readonly output?: 'rgba' | 'components'
  /** Everything after the image header: plane header(s), header-size word and the spatial tile. */
  readonly planes: Uint8Array
}

interface JxrExports {
  readonly memory: WebAssembly.Memory
  __wasm_call_ctors(): void
  malloc(size: number): number
  free(pointer: number): void
  mk_jxr_open(buffer: number, bytes: number, mode: number): number
  mk_jxr_info(handle: number, out: number): number
  mk_jxr_copy(handle: number, dest: number, stride: number): number
  mk_jxr_close(handle: number): void
}

// jxrlib COLORFORMAT, BITDEPTH_BITS and pixel-format GUIDs (GUID_PKPixelFormat…, last byte varies).
const Y_ONLY = 0
const CF_RGB = 7
const NCOMPONENT = 6
const BD_8 = 1
const FLAG_ALPHA = 1
const FLAG_BGR = 2
const FLAG_PREMULTIPLIED = 4
const PIXEL_FORMAT_GUID = [
  0x24, 0xc3, 0xdd, 0x6f, 0x03, 0x4e, 0xfe, 0x4b, 0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9,
]
const PIXEL_FORMAT_24BPP_RGB = 0x0d
const PIXEL_FORMAT_32BPP_BGRA = 0x0f
const PIXEL_FORMAT_8BPP_GRAY = 0x08
const PIXEL_FORMAT_24BPP_COMPONENTS = 0x20

interface NativeImage {
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly pixels: Uint8Array
}
type NativeDecoder = (
  file: Uint8Array,
  options: JpegXrComponentDecodeOptions,
  raw: boolean,
) => NativeImage
let loaded: Promise<NativeDecoder> | undefined

/** Retain stable caller-visible error codes without replacing the native error category. */
function coded(error: Error, code: string): Error {
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

const isCoded = (error: unknown): boolean =>
  typeof (error as { code?: unknown } | null)?.code === 'string' &&
  String((error as { code: string }).code).startsWith('codec-kit/jpegxr-')

/** Instantiate the WASM with the four functions it imports (see build.mjs for its exports). */
async function instantiate(): Promise<JxrExports> {
  const { JPEGXR_WASM_BASE64 } = await import('../lib/jpegxr/wasm.js')
  const binary = Uint8Array.from(globalThis.atob(JPEGXR_WASM_BASE64), c => c.charCodeAt(0))
  let memory: WebAssembly.Memory | undefined
  const imports = {
    env: {
      __assert_fail: (): never => {
        throw new Error('jxrlib assertion failed')
      },
      // ALLOW_MEMORY_GROWTH: grow to the requested size, 1 on success, 0 when it cannot
      emscripten_resize_heap: (requested: number): number => {
        const needed = requested - memory!.buffer.byteLength
        if (needed <= 0) return 1
        try {
          memory!.grow(Math.ceil(needed / 65536))
          return 1
        } catch {
          return 0
        }
      },
    },
    // jxrlib prints diagnostics only in debug builds; any write is acknowledged and dropped
    wasi_snapshot_preview1: {
      fd_write: (_fd: number, iov: number, count: number, written: number): number => {
        const view = new DataView(memory!.buffer)
        let total = 0
        for (let index = 0; index < count; index += 1)
          total += view.getUint32(iov + index * 8 + 4, true)
        view.setUint32(written, total, true)
        return 0
      },
    },
  }
  const { instance } = await WebAssembly.instantiate(binary, imports)
  const exports = instance.exports as unknown as JxrExports
  memory = exports.memory
  exports.__wasm_call_ctors()
  return exports
}

/** The decoded pixels in the file's format, as RGBA8. */
function toRgba(native: Uint8Array, count: number, bitsPerPixel: number, flags: number) {
  const rgba = new Uint8Array(count * 4)
  const bgr = (flags & FLAG_BGR) !== 0
  const alpha = (flags & FLAG_ALPHA) !== 0
  const step = bitsPerPixel >> 3
  for (let pixel = 0, from = 0, to = 0; pixel < count; pixel += 1, from += step, to += 4) {
    if (step === 1) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = native[from]!
    } else {
      rgba[to] = native[from + (bgr ? 2 : 0)]!
      rgba[to + 1] = native[from + 1]!
      rgba[to + 2] = native[from + (bgr ? 0 : 2)]!
    }
    rgba[to + 3] = alpha ? native[from + 3]! : 255
  }
  return rgba
}

/**
 * The JPEG XR decoder, loaded once per realm on first use. A decoder trap (a corrupt codestream
 * jxrlib asserts on) drops the instance, so the next call starts from a fresh one.
 */
function loadNativeDecoder(): Promise<NativeDecoder> {
  loaded ??= instantiate().then(first => {
    let wasm: JxrExports | undefined = first
    return (file, options, raw) => {
      options.signal?.throwIfAborted()
      if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1)
        throw coded(
          new RangeError('JPEG XR needs a positive safe-integer output bound'),
          JPEGXR_OUTPUT_LIMIT,
        )
      if (
        options.dialect !== undefined &&
        options.dialect !== 'jpegxr' &&
        options.dialect !== 'hdphoto-independent'
      )
        throw coded(new TypeError('unknown JPEG XR dialect'), JPEGXR_UNSUPPORTED)
      const exports =
        wasm ??
        (() => {
          throw coded(new Error('the JPEG XR decoder failed and must be reloaded'), JPEGXR_INVALID)
        })()
      const pointers: number[] = []
      const alloc = (size: number): number => {
        const pointer = exports.malloc(size)
        if (pointer === 0)
          throw coded(new RangeError('JPEG XR decoder out of memory'), JPEGXR_INVALID)
        pointers.push(pointer)
        return pointer
      }
      let handle = 0
      try {
        const input = alloc(Math.max(1, file.byteLength))
        new Uint8Array(exports.memory.buffer).set(file, input)
        handle = exports.mk_jxr_open(
          input,
          file.byteLength,
          (raw ? 2 : 0) | (options.dialect === 'hdphoto-independent' ? 1 : 0),
        )
        if (handle === 0) throw coded(new TypeError('not a decodable JPEG XR file'), JPEGXR_INVALID)
        const info = alloc(7 * 4)
        if (exports.mk_jxr_info(handle, info) !== 0)
          throw coded(new TypeError('JPEG XR pixel format is unknown'), JPEGXR_UNSUPPORTED)
        const [width, height, bitsPerPixel, channels, colorFormat, bitDepth, flags] =
          new Int32Array(exports.memory.buffer.slice(info, info + 7 * 4)) as unknown as number[]
        if (
          bitDepth !== BD_8 ||
          (flags! & FLAG_PREMULTIPLIED) !== 0 ||
          !(raw
            ? colorFormat === NCOMPONENT &&
              channels! >= 1 &&
              channels! <= 3 &&
              bitsPerPixel === channels! * 8 &&
              flags === 0
            : (colorFormat === Y_ONLY && bitsPerPixel === 8) ||
              (colorFormat === CF_RGB && (bitsPerPixel === 24 || bitsPerPixel === 32)))
        ) {
          throw coded(
            new TypeError(
              `JPEG XR pixel format (colour ${colorFormat}, depth ${bitDepth}, ${bitsPerPixel} bpp) is not decoded`,
            ),
            JPEGXR_UNSUPPORTED,
          )
        }
        const bytes = width! * height! * (raw ? channels! : 4)
        if (
          width! < 1 ||
          height! < 1 ||
          !Number.isSafeInteger(bytes) ||
          bytes > options.maxOutputBytes
        ) {
          throw coded(
            new RangeError(
              `JPEG XR image ${width}x${height} exceeds its ${options.maxOutputBytes}-byte bound`,
            ),
            JPEGXR_OUTPUT_LIMIT,
          )
        }
        const stride = width! * (bitsPerPixel! / 8)
        const out = alloc(Math.max(1, stride * height!))
        if (exports.mk_jxr_copy(handle, out, stride) !== 0)
          throw coded(new TypeError('JPEG XR codestream does not decode'), JPEGXR_INVALID)
        const native = new Uint8Array(exports.memory.buffer, out, stride * height!)
        const pixels = raw
          ? native.slice()
          : toRgba(native, width! * height!, bitsPerPixel!, flags!)
        options.signal?.throwIfAborted()
        return {
          width: width!,
          height: height!,
          pixels,
          componentCount: channels!,
        }
      } catch (error) {
        if (isCoded(error)) throw error
        // a trap leaves jxrlib's heap undefined: drop the instance, report the file
        wasm = undefined
        loaded = undefined
        throw coded(
          new TypeError(`JPEG XR codestream does not decode: ${(error as Error).message}`),
          JPEGXR_INVALID,
        )
      } finally {
        if (wasm !== undefined) {
          if (handle !== 0) exports.mk_jxr_close(handle)
          for (const pointer of pointers) exports.free(pointer)
        }
      }
    }
  })
  return loaded
}

/** Load the standard RGBA decoder over the same per-realm WASM lifecycle as raw decoding. */
export async function loadJpegXrDecoder(): Promise<JpegXrDecoder> {
  const decode = await loadNativeDecoder()
  return (file, options) => {
    const image = decode(file, options, false)
    return {
      width: image.width,
      height: image.height,
      pixels: image.pixels,
    }
  }
}

/** Decode raw 8-bit components within their actual byte bound; color semantics stay with callers. */
export async function decodeJpegXrComponents(
  file: Uint8Array,
  options: JpegXrComponentDecodeOptions,
): Promise<JpegXrComponentImage> {
  const image = (await loadNativeDecoder())(file, options, true)
  return {
    width: image.width,
    height: image.height,
    componentCount: image.componentCount as 1 | 2 | 3,
    pixels: image.pixels,
  }
}

/** Decode one JPEG XR file into RGBA8 ({@link loadJpegXrDecoder}). */
export async function decodeJpegXr(
  file: Uint8Array,
  options: JpegXrDecodeOptions,
): Promise<RgbaImage> {
  return (await loadJpegXrDecoder())(file, options)
}

/**
 * The JPEG XR file for a headerless codestream: the 16-byte image header (short header, long
 * words, spatial order, no tiling and no index table, 8-bit output) rebuilt in front of the
 * planes, inside the minimal container jxrlib reads (pixel format 32bpp BGRA with alpha, 24bpp
 * RGB without; {@link decodeJpegXr} returns RGBA either way). Explicit components selects gray
 * or generic three-slot storage (T.832 defines no two-channel GUID); the plane header remains
 * authoritative for {@link decodeJpegXrComponents}' actual 1/2/3-component count and tight stride.
 */
export function jpegXrFileFromHeaderless(input: HeaderlessJpegXr): Uint8Array {
  const { width, height, overlap, alpha, planes } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new RangeError('a JPEG XR image has a positive width and height')
  if (width > 65536 || height > 65536)
    throw new RangeError('a short JPEG XR header holds at most 65536 pixels on a side')
  if (
    ![0, 1, 2].includes(overlap) ||
    (input.subVersion !== undefined && ![0, 1].includes(input.subVersion))
  )
    throw new RangeError('unsupported JPEG XR overlap or subversion')
  if (input.output !== undefined && input.output !== 'rgba' && input.output !== 'components')
    throw new TypeError('unknown JPEG XR output representation')
  let components = 0
  if (input.output === 'components') {
    if (alpha || planes.length < 2)
      throw new TypeError('raw JPEG XR components require a complete non-alpha plane header')
    const format = planes[0]! >> 5
    components =
      format === Y_ONLY ? 1 : format === 3 ? 3 : format === NCOMPONENT ? (planes[1]! >> 4) + 1 : 0
    if (components < 1 || components > 3)
      throw new TypeError('raw JPEG XR supports only 1..3 components')
  }
  const codestream = new Uint8Array(16 + planes.byteLength)
  codestream.set(new TextEncoder().encode('WMPHOTO\0'))
  codestream[8] = 0x10 | (input.subVersion ?? 0)
  codestream[9] = overlap & 3
  codestream[10] = 0xc0 | (alpha ? 1 : 0)
  codestream[11] = components ? (components === 1 ? 0x01 : 0x61) : 0x71
  const header = new DataView(codestream.buffer)
  header.setUint16(12, width - 1)
  header.setUint16(14, height - 1)
  codestream.set(planes, 16)
  return jpegXrContainer(
    codestream,
    width,
    height,
    components
      ? components === 1
        ? PIXEL_FORMAT_8BPP_GRAY
        : PIXEL_FORMAT_24BPP_COMPONENTS
      : alpha
        ? PIXEL_FORMAT_32BPP_BGRA
        : PIXEL_FORMAT_24BPP_RGB,
  )
}

/** The JPEG XR container (T.832 annex A) with one image: the five tags jxrlib needs. */
function jpegXrContainer(
  codestream: Uint8Array,
  width: number,
  height: number,
  pixelFormat: number,
): Uint8Array {
  const entries = 5
  const ifd = 8
  const guid = ifd + 2 + entries * 12 + 4
  const image = guid + 16
  const file = new Uint8Array(image + codestream.byteLength)
  const view = new DataView(file.buffer)
  file.set([0x49, 0x49, 0xbc, 0x01])
  view.setUint32(4, ifd, true)
  view.setUint16(ifd, entries, true)
  const tags: readonly (readonly [tag: number, type: number, count: number, value: number])[] = [
    [0xbc01, 1, 16, guid], // PIXEL_FORMAT
    [0xbc80, 4, 1, width], // IMAGE_WIDTH
    [0xbc81, 4, 1, height], // IMAGE_HEIGHT
    [0xbcc0, 4, 1, image], // IMAGE_OFFSET
    [0xbcc1, 4, 1, codestream.byteLength], // IMAGE_BYTE_COUNT
  ]
  tags.forEach(([tag, type, count, value], index) => {
    const at = ifd + 2 + index * 12
    view.setUint16(at, tag, true)
    view.setUint16(at + 2, type, true)
    view.setUint32(at + 4, count, true)
    view.setUint32(at + 8, value, true)
  })
  file.set([...PIXEL_FORMAT_GUID, pixelFormat], guid)
  file.set(codestream, image)
  return file
}
