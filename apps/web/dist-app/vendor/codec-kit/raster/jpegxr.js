import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/raster/jpegxr.js
var JPEGXR_INVALID = "codec-kit/jpegxr-invalid";
var JPEGXR_UNSUPPORTED = "codec-kit/jpegxr-unsupported";
var JPEGXR_OUTPUT_LIMIT = "codec-kit/jpegxr-output-limit";
var Y_ONLY = 0;
var CF_RGB = 7;
var NCOMPONENT = 6;
var BD_8 = 1;
var FLAG_ALPHA = 1;
var FLAG_BGR = 2;
var FLAG_PREMULTIPLIED = 4;
var PIXEL_FORMAT_GUID = [
  36,
  195,
  221,
  111,
  3,
  78,
  254,
  75,
  177,
  133,
  61,
  119,
  118,
  141,
  201
];
var PIXEL_FORMAT_24BPP_RGB = 13;
var PIXEL_FORMAT_32BPP_BGRA = 15;
var PIXEL_FORMAT_8BPP_GRAY = 8;
var PIXEL_FORMAT_24BPP_COMPONENTS = 32;
var loaded;
function coded(error, code) {
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}
var isCoded = (error) => typeof error?.code === "string" && String(error.code).startsWith("codec-kit/jpegxr-");
async function instantiate() {
  const { JPEGXR_WASM_BASE64 } = await import("../../../chunks/wasm-K52AAIDB.js");
  const binary = Uint8Array.from(globalThis.atob(JPEGXR_WASM_BASE64), (c) => c.charCodeAt(0));
  let memory;
  const imports = {
    env: {
      __assert_fail: () => {
        throw new Error("jxrlib assertion failed");
      },
      // ALLOW_MEMORY_GROWTH: grow to the requested size, 1 on success, 0 when it cannot
      emscripten_resize_heap: (requested) => {
        const needed = requested - memory.buffer.byteLength;
        if (needed <= 0)
          return 1;
        try {
          memory.grow(Math.ceil(needed / 65536));
          return 1;
        } catch {
          return 0;
        }
      }
    },
    // jxrlib prints diagnostics only in debug builds; any write is acknowledged and dropped
    wasi_snapshot_preview1: {
      fd_write: (_fd, iov, count, written) => {
        const view = new DataView(memory.buffer);
        let total = 0;
        for (let index = 0; index < count; index += 1)
          total += view.getUint32(iov + index * 8 + 4, true);
        view.setUint32(written, total, true);
        return 0;
      }
    }
  };
  const { instance } = await WebAssembly.instantiate(binary, imports);
  const exports = instance.exports;
  memory = exports.memory;
  exports.__wasm_call_ctors();
  return exports;
}
function toRgba(native, count, bitsPerPixel, flags) {
  const rgba = new Uint8Array(count * 4);
  const bgr = (flags & FLAG_BGR) !== 0;
  const alpha = (flags & FLAG_ALPHA) !== 0;
  const step = bitsPerPixel >> 3;
  for (let pixel = 0, from = 0, to = 0; pixel < count; pixel += 1, from += step, to += 4) {
    if (step === 1) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = native[from];
    } else {
      rgba[to] = native[from + (bgr ? 2 : 0)];
      rgba[to + 1] = native[from + 1];
      rgba[to + 2] = native[from + (bgr ? 0 : 2)];
    }
    rgba[to + 3] = alpha ? native[from + 3] : 255;
  }
  return rgba;
}
function loadNativeDecoder() {
  loaded ??= instantiate().then((first) => {
    let wasm = first;
    return (file, options, raw) => {
      options.signal?.throwIfAborted();
      if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1)
        throw coded(new RangeError("JPEG XR needs a positive safe-integer output bound"), JPEGXR_OUTPUT_LIMIT);
      if (options.dialect !== void 0 && options.dialect !== "jpegxr" && options.dialect !== "hdphoto-independent")
        throw coded(new TypeError("unknown JPEG XR dialect"), JPEGXR_UNSUPPORTED);
      const exports = wasm ?? (() => {
        throw coded(new Error("the JPEG XR decoder failed and must be reloaded"), JPEGXR_INVALID);
      })();
      const pointers = [];
      const alloc = (size) => {
        const pointer = exports.malloc(size);
        if (pointer === 0)
          throw coded(new RangeError("JPEG XR decoder out of memory"), JPEGXR_INVALID);
        pointers.push(pointer);
        return pointer;
      };
      let handle = 0;
      try {
        const input = alloc(Math.max(1, file.byteLength));
        new Uint8Array(exports.memory.buffer).set(file, input);
        handle = exports.mk_jxr_open(input, file.byteLength, (raw ? 2 : 0) | (options.dialect === "hdphoto-independent" ? 1 : 0));
        if (handle === 0)
          throw coded(new TypeError("not a decodable JPEG XR file"), JPEGXR_INVALID);
        const info = alloc(7 * 4);
        if (exports.mk_jxr_info(handle, info) !== 0)
          throw coded(new TypeError("JPEG XR pixel format is unknown"), JPEGXR_UNSUPPORTED);
        const [width, height, bitsPerPixel, channels, colorFormat, bitDepth, flags] = new Int32Array(exports.memory.buffer.slice(info, info + 7 * 4));
        if (bitDepth !== BD_8 || (flags & FLAG_PREMULTIPLIED) !== 0 || !(raw ? colorFormat === NCOMPONENT && channels >= 1 && channels <= 3 && bitsPerPixel === channels * 8 && flags === 0 : colorFormat === Y_ONLY && bitsPerPixel === 8 || colorFormat === CF_RGB && (bitsPerPixel === 24 || bitsPerPixel === 32))) {
          throw coded(new TypeError(`JPEG XR pixel format (colour ${colorFormat}, depth ${bitDepth}, ${bitsPerPixel} bpp) is not decoded`), JPEGXR_UNSUPPORTED);
        }
        const bytes = width * height * (raw ? channels : 4);
        if (width < 1 || height < 1 || !Number.isSafeInteger(bytes) || bytes > options.maxOutputBytes) {
          throw coded(new RangeError(`JPEG XR image ${width}x${height} exceeds its ${options.maxOutputBytes}-byte bound`), JPEGXR_OUTPUT_LIMIT);
        }
        const stride = width * (bitsPerPixel / 8);
        const out = alloc(Math.max(1, stride * height));
        if (exports.mk_jxr_copy(handle, out, stride) !== 0)
          throw coded(new TypeError("JPEG XR codestream does not decode"), JPEGXR_INVALID);
        const native = new Uint8Array(exports.memory.buffer, out, stride * height);
        const pixels = raw ? native.slice() : toRgba(native, width * height, bitsPerPixel, flags);
        options.signal?.throwIfAborted();
        return {
          width,
          height,
          pixels,
          componentCount: channels
        };
      } catch (error) {
        if (isCoded(error))
          throw error;
        wasm = void 0;
        loaded = void 0;
        throw coded(new TypeError(`JPEG XR codestream does not decode: ${error.message}`), JPEGXR_INVALID);
      } finally {
        if (wasm !== void 0) {
          if (handle !== 0)
            exports.mk_jxr_close(handle);
          for (const pointer of pointers)
            exports.free(pointer);
        }
      }
    };
  });
  return loaded;
}
async function loadJpegXrDecoder() {
  const decode = await loadNativeDecoder();
  return (file, options) => {
    const image = decode(file, options, false);
    return {
      width: image.width,
      height: image.height,
      pixels: image.pixels
    };
  };
}
async function decodeJpegXrComponents(file, options) {
  const image = (await loadNativeDecoder())(file, options, true);
  return {
    width: image.width,
    height: image.height,
    componentCount: image.componentCount,
    pixels: image.pixels
  };
}
async function decodeJpegXr(file, options) {
  return (await loadJpegXrDecoder())(file, options);
}
function jpegXrFileFromHeaderless(input) {
  const { width, height, overlap, alpha, planes } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new RangeError("a JPEG XR image has a positive width and height");
  if (width > 65536 || height > 65536)
    throw new RangeError("a short JPEG XR header holds at most 65536 pixels on a side");
  if (![0, 1, 2].includes(overlap) || input.subVersion !== void 0 && ![0, 1].includes(input.subVersion))
    throw new RangeError("unsupported JPEG XR overlap or subversion");
  if (input.output !== void 0 && input.output !== "rgba" && input.output !== "components")
    throw new TypeError("unknown JPEG XR output representation");
  let components = 0;
  if (input.output === "components") {
    if (alpha || planes.length < 2)
      throw new TypeError("raw JPEG XR components require a complete non-alpha plane header");
    const format = planes[0] >> 5;
    components = format === Y_ONLY ? 1 : format === 3 ? 3 : format === NCOMPONENT ? (planes[1] >> 4) + 1 : 0;
    if (components < 1 || components > 3)
      throw new TypeError("raw JPEG XR supports only 1..3 components");
  }
  const codestream = new Uint8Array(16 + planes.byteLength);
  codestream.set(new TextEncoder().encode("WMPHOTO\0"));
  codestream[8] = 16 | (input.subVersion ?? 0);
  codestream[9] = overlap & 3;
  codestream[10] = 192 | (alpha ? 1 : 0);
  codestream[11] = components ? components === 1 ? 1 : 97 : 113;
  const header = new DataView(codestream.buffer);
  header.setUint16(12, width - 1);
  header.setUint16(14, height - 1);
  codestream.set(planes, 16);
  return jpegXrContainer(codestream, width, height, components ? components === 1 ? PIXEL_FORMAT_8BPP_GRAY : PIXEL_FORMAT_24BPP_COMPONENTS : alpha ? PIXEL_FORMAT_32BPP_BGRA : PIXEL_FORMAT_24BPP_RGB);
}
function jpegXrContainer(codestream, width, height, pixelFormat) {
  const entries = 5;
  const ifd = 8;
  const guid = ifd + 2 + entries * 12 + 4;
  const image = guid + 16;
  const file = new Uint8Array(image + codestream.byteLength);
  const view = new DataView(file.buffer);
  file.set([73, 73, 188, 1]);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, entries, true);
  const tags = [
    [48129, 1, 16, guid],
    // PIXEL_FORMAT
    [48256, 4, 1, width],
    // IMAGE_WIDTH
    [48257, 4, 1, height],
    // IMAGE_HEIGHT
    [48320, 4, 1, image],
    // IMAGE_OFFSET
    [48321, 4, 1, codestream.byteLength]
    // IMAGE_BYTE_COUNT
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const at = ifd + 2 + index * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  });
  file.set([...PIXEL_FORMAT_GUID, pixelFormat], guid);
  file.set(codestream, image);
  return file;
}
export {
  JPEGXR_INVALID,
  JPEGXR_OUTPUT_LIMIT,
  JPEGXR_UNSUPPORTED,
  decodeJpegXr,
  decodeJpegXrComponents,
  jpegXrFileFromHeaderless,
  loadJpegXrDecoder
};
