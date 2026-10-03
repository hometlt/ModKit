import {
  ModkitError
} from "./chunk-AMCLMQ4O.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/texture/gpu-texture-wasm.js
var runtimePromise;
function cacheRuntime(pending, message, hint) {
  runtimePromise = pending.catch((cause) => {
    runtimePromise = void 0;
    if (cause instanceof ModkitError)
      throw cause;
    throw new ModkitError({
      code: "codec-kit/texture-runtime-unavailable",
      message,
      cause,
      ...hint === void 0 ? {} : { context: { hint } }
    });
  });
  return runtimePromise;
}
function isNodeRuntime() {
  const processValue = globalThis.process;
  return typeof processValue?.versions?.node === "string";
}
function wasmOutputToUint8Array(output) {
  if (!output)
    return null;
  try {
    const bytes = new Uint8Array(output.length);
    for (let index = 0; index < output.length; index++)
      bytes[index] = output[index];
    return bytes;
  } finally {
    output.delete?.();
  }
}
function nativeRuntime(native) {
  const decode = (name) => async (...args) => wasmOutputToUint8Array(native[name](...args));
  return {
    decode_bc1: decode("decode_bc1"),
    decode_bc3: decode("decode_bc3"),
    decode_bc4: decode("decode_bc4"),
    decode_bc5: decode("decode_bc5"),
    decode_bc6: decode("decode_bc6"),
    decode_bc7: decode("decode_bc7"),
    decode_pvrtc: decode("decode_pvrtc"),
    decode_etc1: decode("decode_etc1"),
    decode_etc2: decode("decode_etc2"),
    decode_etc2a1: decode("decode_etc2a1"),
    decode_etc2a8: decode("decode_etc2a8"),
    decode_eacr: decode("decode_eacr"),
    decode_eacr_signed: decode("decode_eacr_signed"),
    decode_eacrg: decode("decode_eacrg"),
    decode_eacrg_signed: decode("decode_eacrg_signed"),
    decode_atc_rgb4: decode("decode_atc_rgb4"),
    decode_atc_rgba8: decode("decode_atc_rgba8"),
    decode_astc: decode("decode_astc"),
    unpack_crunch: decode("unpack_crunch"),
    unpack_unity_crunch: decode("unpack_unity_crunch")
  };
}
function initializeGpuTextureWasmBrowser(options) {
  if (!runtimePromise) {
    const baseText = String(options.assetBaseUrl);
    const base = new URL(baseText.endsWith("/") ? baseText : `${baseText}/`, import.meta.url);
    const wasmPath = new URL("wasm/", base).href;
    const moduleUrl = new URL("texture2ddecoder.js", wasmPath).href;
    runtimePromise = cacheRuntime(emscriptenRuntime(moduleUrl, {
      locateFile: (path) => new URL(path, wasmPath).href
    }), "Texture2DDecoder browser runtime failed to initialize", "Verify assetBaseUrl and that both texture2ddecoder.js and texture2ddecoder.wasm are deployed.");
  }
  const initializedRuntime = runtimePromise;
  return initializedRuntime.then(() => void 0);
}
async function emscriptenRuntime(moduleUrl, options) {
  const module = await import(
    /* @vite-ignore @modkitx-external-runtime */
    moduleUrl
  );
  const createModule = module.default;
  if (typeof createModule !== "function")
    throw new Error("Texture2DDecoder runtime does not export an Emscripten factory");
  return nativeRuntime(await createModule(options));
}
async function decoder() {
  if (!runtimePromise) {
    if (!isNodeRuntime()) {
      throw new ModkitError({
        code: "codec-kit/texture-runtime-unavailable",
        message: "Software GPU texture decoding is not initialized in this browser host",
        context: {
          hint: "Call initializeGpuTextureWasmBrowser({ assetBaseUrl }) before decoding."
        }
      });
    }
    const packageName = ["texture2ddecoder", "wasm"].join("-");
    runtimePromise = cacheRuntime((async () => {
      const { createRequire } = await import(
        /* @modkitx-external-runtime */
        ["node", "module"].join(":")
      );
      const { pathToFileURL } = await import(
        /* @modkitx-external-runtime */
        ["node", "url"].join(":")
      );
      const entry = pathToFileURL(createRequire(import.meta.url).resolve(packageName));
      return emscriptenRuntime(new URL("../wasm/texture2ddecoder.js", entry).href, {});
    })(), "Texture2DDecoder Node runtime failed to load", "Install the optional texture2ddecoder-wasm dependency for software GPU texture decode.");
  }
  const initializedRuntime = runtimePromise;
  return initializedRuntime;
}
async function decode2d(name, data, width, height) {
  const runtime = await decoder();
  return runtime[name](data, width, height);
}
var decode_bc1 = (data, width, height) => decode2d("decode_bc1", data, width, height);
var decode_bc3 = (data, width, height) => decode2d("decode_bc3", data, width, height);
var decode_bc4 = (data, width, height) => decode2d("decode_bc4", data, width, height);
var decode_bc5 = (data, width, height) => decode2d("decode_bc5", data, width, height);
var decode_bc6 = (data, width, height) => decode2d("decode_bc6", data, width, height);
var decode_bc7 = (data, width, height) => decode2d("decode_bc7", data, width, height);
var decode_etc1 = (data, width, height) => decode2d("decode_etc1", data, width, height);
var decode_etc2 = (data, width, height) => decode2d("decode_etc2", data, width, height);
var decode_etc2a1 = (data, width, height) => decode2d("decode_etc2a1", data, width, height);
var decode_etc2a8 = (data, width, height) => decode2d("decode_etc2a8", data, width, height);
var decode_eacr = (data, width, height) => decode2d("decode_eacr", data, width, height);
var decode_eacr_signed = (data, width, height) => decode2d("decode_eacr_signed", data, width, height);
var decode_eacrg = (data, width, height) => decode2d("decode_eacrg", data, width, height);
var decode_eacrg_signed = (data, width, height) => decode2d("decode_eacrg_signed", data, width, height);
var decode_atc_rgb4 = (data, width, height) => decode2d("decode_atc_rgb4", data, width, height);
var decode_atc_rgba8 = (data, width, height) => decode2d("decode_atc_rgba8", data, width, height);
async function decode_pvrtc(data, width, height, is2bpp = false) {
  return (await decoder()).decode_pvrtc(data, width, height, is2bpp);
}
async function decode_astc(data, width, height, blockWidth, blockHeight) {
  return (await decoder()).decode_astc(data, width, height, blockWidth, blockHeight);
}
async function unpack_crunch(data) {
  return (await decoder()).unpack_crunch(data);
}
async function unpack_unity_crunch(data) {
  return (await decoder()).unpack_unity_crunch(data);
}

export {
  initializeGpuTextureWasmBrowser,
  decode_bc1,
  decode_bc3,
  decode_bc4,
  decode_bc5,
  decode_bc6,
  decode_bc7,
  decode_etc1,
  decode_etc2,
  decode_etc2a1,
  decode_etc2a8,
  decode_eacr,
  decode_eacr_signed,
  decode_eacrg,
  decode_eacrg_signed,
  decode_atc_rgb4,
  decode_atc_rgba8,
  decode_pvrtc,
  decode_astc,
  unpack_crunch,
  unpack_unity_crunch
};
