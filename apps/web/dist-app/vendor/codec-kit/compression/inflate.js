import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-JVAXQGJ2.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/compression/inflate.js
var NODE_ZLIB = "node:zlib";
var loaded = /* @__PURE__ */ new Map();
function outputLimit(maximum) {
  const error = new RangeError(`decompressed output exceeds its ${maximum}-byte bound`);
  Object.defineProperty(error, "code", { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true });
  return error;
}
function loadInflateSync(format = "zlib") {
  let pending = loaded.get(format);
  if (pending === void 0) {
    pending = resolveInflate(format);
    loaded.set(format, pending);
  }
  return pending;
}
async function resolveInflate(format) {
  const zlib = await import(
    /* @vite-ignore */
    NODE_ZLIB
  ).catch(() => void 0);
  if (typeof zlib?.inflateSync === "function") {
    const run = format === "zlib" ? zlib.inflateSync.bind(zlib) : format === "gzip" ? zlib.gunzipSync.bind(zlib) : zlib.inflateRawSync.bind(zlib);
    return (payload, maximum) => {
      try {
        const out = run(payload, { maxOutputLength: Math.max(1, maximum) });
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      } catch (error) {
        if (error.code === "ERR_BUFFER_TOO_LARGE") {
          throw outputLimit(maximum);
        }
        throw error;
      }
    };
  }
  return loadPortableInflateSync(format);
}
async function loadPortableInflateSync(format = "zlib") {
  const pako = await import("../../../chunks/pako.esm-QQKRXK7D.js");
  return (payload, maximum) => {
    const chunks = [];
    let total = 0;
    const inflater = new pako.Inflate(format === "deflate-raw" ? { raw: true } : {});
    inflater.onData = (chunk) => {
      total += chunk.length;
      if (total > maximum)
        throw outputLimit(maximum);
      chunks.push(chunk);
    };
    inflater.push(payload, true);
    if (inflater.err !== 0)
      throw new Error(`inflate failed: ${inflater.msg}`);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
}
export {
  loadInflateSync,
  loadPortableInflateSync
};
