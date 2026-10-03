import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-JVAXQGJ2.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/compression/brotli.js
var BROTLI_UNSUPPORTED = "codec-kit/brotli-unsupported";
var NODE_ZLIB = "node:zlib";
var PORTABLE_LIMIT_MESSAGE = "Brotli output exceeds maxOutputLength";
var loaded;
var portable;
function coded(error, code) {
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}
var pastBound = (maximum) => coded(new RangeError(`decompressed output exceeds its ${maximum}-byte bound`), COMPRESSION_OUTPUT_LIMIT);
function loadBrotliSync() {
  loaded ??= (async () => {
    const zlib = await import(
      /* @vite-ignore */
      NODE_ZLIB
    ).catch(() => void 0);
    if (typeof zlib?.brotliDecompressSync !== "function")
      return loadPortableBrotliSync();
    return (payload, maximum) => {
      let out;
      try {
        out = zlib.brotliDecompressSync(payload, { maxOutputLength: Math.max(1, maximum) });
      } catch (error) {
        if (error.code === "ERR_BUFFER_TOO_LARGE")
          throw pastBound(maximum);
        throw error;
      }
      if (out.byteLength > maximum)
        throw pastBound(maximum);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    };
  })();
  return loaded;
}
function loadPortableBrotliSync() {
  portable ??= (async () => {
    const decoder = await import("../../../chunks/decode-G64U376Q.js").catch(() => void 0);
    if (decoder === void 0)
      return () => {
        throw coded(new Error("this realm has no Brotli decoder"), BROTLI_UNSUPPORTED);
      };
    return (payload, maximum) => {
      let out;
      try {
        out = decoder.BrotliDecode(new Int8Array(payload.buffer, payload.byteOffset, payload.byteLength), { maxOutputLength: maximum });
      } catch (error) {
        if (error instanceof RangeError && error.message === PORTABLE_LIMIT_MESSAGE)
          throw pastBound(maximum);
        throw error;
      }
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    };
  })();
  return portable;
}
async function decodeBrotli(payload, maxOutputBytes) {
  return (await loadBrotliSync())(payload, maxOutputBytes);
}
export {
  BROTLI_UNSUPPORTED,
  decodeBrotli,
  loadBrotliSync,
  loadPortableBrotliSync
};
/*! Brotli decoder (src/lib/brotli): Copyright 2017 Google Inc., @license MIT */
