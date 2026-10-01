import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-GDKG5J25.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/compression/brotli.js
var BROTLI_UNSUPPORTED = "codec-kit/brotli-unsupported";
var NODE_ZLIB = "node:zlib";
var loaded;
function coded(error, code) {
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}
function loadBrotliSync() {
  loaded ??= (async () => {
    const zlib = await import(
      /* @vite-ignore */
      NODE_ZLIB
    ).catch(() => void 0);
    if (typeof zlib?.brotliDecompressSync !== "function")
      return () => {
        throw coded(new Error("this realm has no Brotli decoder"), BROTLI_UNSUPPORTED);
      };
    return (payload, maximum) => {
      try {
        const out = zlib.brotliDecompressSync(payload, { maxOutputLength: Math.max(1, maximum) });
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      } catch (error) {
        if (error.code === "ERR_BUFFER_TOO_LARGE")
          throw coded(new RangeError(`decompressed output exceeds its ${maximum}-byte bound`), COMPRESSION_OUTPUT_LIMIT);
        throw error;
      }
    };
  })();
  return loaded;
}
async function decodeBrotli(payload, maxOutputBytes) {
  return (await loadBrotliSync())(payload, maxOutputBytes);
}
export {
  BROTLI_UNSUPPORTED,
  decodeBrotli,
  loadBrotliSync
};
