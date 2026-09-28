import {
  COMPRESSION_OUTPUT_LIMIT
} from "./chunk-OWMFLKLT.js";
import {
  Decompress
} from "./chunk-4HPXBPET.js";
import "./chunk-CQ52GEHY.js";

// packages/codec-kit/src/compression/zstd.ts
var ZSTD_MAGIC = Object.freeze([40, 181, 47, 253]);
var ZSTD_MALFORMED = "codec-kit/zstd-malformed";
function withCode(error, code) {
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return error;
}
function limitError(maximum) {
  return withCode(
    new RangeError(`decompressed output exceeds its ${maximum}-byte bound`),
    COMPRESSION_OUTPUT_LIMIT
  );
}
function malformed(cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return withCode(new RangeError(`Zstandard data is malformed: ${message}`), ZSTD_MALFORMED);
}
function isZstdFrame(bytes) {
  return bytes.length >= 4 && bytes[0] === ZSTD_MAGIC[0] && bytes[1] === ZSTD_MAGIC[1] && bytes[2] === ZSTD_MAGIC[2] && bytes[3] === ZSTD_MAGIC[3];
}
function decodeZstd(input, options) {
  if (!(input instanceof Uint8Array)) throw new TypeError("Zstandard input must be bytes");
  const maximum = options.maxOutputBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError("maxOutputBytes must be a non-negative safe integer");
  }
  const expected = options.expectedLength;
  if (expected !== void 0) {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new RangeError("expectedLength must be a non-negative safe integer");
    }
    if (expected > maximum) throw limitError(maximum);
  }
  const bound = expected ?? maximum;
  const chunks = [];
  let total = 0;
  const stream = new Decompress((chunk) => {
    total += chunk.length;
    if (total > bound) {
      throw expected === void 0 ? limitError(maximum) : malformed(new Error(`frame is larger than the declared ${expected} bytes`));
    }
    chunks.push(chunk);
  });
  try {
    stream.push(input, true);
  } catch (error) {
    const code = error.code;
    if (code === COMPRESSION_OUTPUT_LIMIT || code === ZSTD_MALFORMED) throw error;
    throw malformed(error);
  }
  if (expected !== void 0 && total !== expected) {
    throw malformed(new Error(`decoded ${total} bytes where ${expected} were declared`));
  }
  if (chunks.length === 1 && chunks[0]?.length === total) return chunks[0];
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
export {
  ZSTD_MAGIC,
  ZSTD_MALFORMED,
  decodeZstd,
  isZstdFrame
};
