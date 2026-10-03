import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/compression/bounded.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var COMPRESSION_OUTPUT_LIMIT = "codec-kit/compression-output-limit";
function defaultOutputLimitError(maximum) {
  const error = new RangeError(`decompressed output exceeds its ${maximum}-byte bound`);
  Object.defineProperty(error, "code", { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true });
  return error;
}
async function decompressBounded(payload, format, options) {
  if (!(payload instanceof Uint8Array))
    throw new TypeError("compressed payload must be bytes");
  const maximum = options.maxOutputBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError("maxOutputBytes must be a non-negative safe integer");
  }
  options.signal?.throwIfAborted();
  if (typeof DecompressionStream !== "function") {
    throw new TypeError("portable decompression requires DecompressionStream");
  }
  const input = new Uint8Array(payload);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks = [];
  let outputBytes = 0;
  try {
    for (; ; ) {
      options.signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done)
        break;
      outputBytes += chunk.value.byteLength;
      if (!Number.isSafeInteger(outputBytes) || outputBytes > maximum) {
        throw (options.outputLimitError ?? defaultOutputLimitError)(maximum);
      }
      options.onChunk?.(chunk.value.byteLength);
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => void 0);
    throw error;
  }
  options.signal?.throwIfAborted();
  const output = new Uint8Array(outputBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function compressPortable(payload, format, signal) {
  signal?.throwIfAborted();
  if (typeof CompressionStream !== "function") {
    throw new TypeError("portable compression requires CompressionStream");
  }
  const stream = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new CompressionStream(format));
  const output = new Uint8Array(await new Response(stream).arrayBuffer());
  signal?.throwIfAborted();
  return output;
}

export {
  COMPRESSION_OUTPUT_LIMIT,
  decompressBounded,
  compressPortable
};
