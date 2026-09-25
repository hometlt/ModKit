import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-JVAXQGJ2.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/compression/refpack.js
var REFPACK_MALFORMED = "codec-kit/refpack-malformed";
function malformed(message) {
  const error = new RangeError(`RefPack stream ${message}`);
  Object.defineProperty(error, "code", { value: REFPACK_MALFORMED, enumerable: true });
  return error;
}
function isRefPack(bytes) {
  return bytes.byteLength >= 2 && ((bytes[0] ?? 0) & 62) === 16 && bytes[1] === 251;
}
function readRefPackHeader(bytes) {
  if (!isRefPack(bytes))
    throw malformed("has no RefPack header");
  const flags = bytes[0] ?? 0;
  const width = (flags & 128) !== 0 ? 4 : 3;
  const carriesCompressedSize = (flags & 1) !== 0;
  const headerBytes = 2 + width * (carriesCompressedSize ? 2 : 1);
  if (bytes.byteLength < headerBytes)
    throw malformed("header is truncated");
  const number = (at) => {
    let value = 0;
    for (let index = 0; index < width; index += 1)
      value = value * 256 + (bytes[at + index] ?? 0);
    return value;
  };
  return carriesCompressedSize ? { headerBytes, size: number(2 + width), compressedSize: number(2) } : { headerBytes, size: number(2) };
}
function decodeRefPack(input, maxOutputBytes) {
  if (!(input instanceof Uint8Array))
    throw new TypeError("RefPack input must be bytes");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError("maxOutputBytes must be a non-negative safe integer");
  }
  const header = readRefPackHeader(input);
  if (header.size > maxOutputBytes) {
    const error = new RangeError(`RefPack output ${header.size} exceeds its ${maxOutputBytes}-byte bound`);
    Object.defineProperty(error, "code", { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true });
    throw error;
  }
  const output = new Uint8Array(header.size);
  let ip = header.headerBytes;
  let op = 0;
  const literals = (length) => {
    if (length > input.length - ip)
      throw malformed("literal run overruns the input");
    if (length > output.length - op)
      throw malformed("literal run overruns the output");
    if (length < 16) {
      for (let index = 0; index < length; index += 1)
        output[op++] = input[ip++] ?? 0;
      return;
    }
    output.set(input.subarray(ip, ip + length), op);
    ip += length;
    op += length;
  };
  const match = (distance, length) => {
    if (distance > op)
      throw malformed(`has a match distance ${distance} before the output start`);
    if (length > output.length - op)
      throw malformed("match overruns the output");
    const from = op - distance;
    if (distance >= length && length >= 32) {
      output.copyWithin(op, from, from + length);
      op += length;
      return;
    }
    for (let index = 0; index < length; index += 1) {
      output[op] = output[from + index] ?? 0;
      op += 1;
    }
  };
  const operands = (count) => {
    if (count > input.length - ip)
      throw malformed("ends inside a command");
  };
  for (; ; ) {
    if (ip >= input.length)
      throw malformed("ends without its stop code");
    const control = input[ip++] ?? 0;
    if (control < 128) {
      operands(1);
      const b1 = input[ip++] ?? 0;
      literals(control & 3);
      match(((control & 96) << 3) + b1 + 1, ((control & 28) >>> 2) + 3);
    } else if (control < 192) {
      operands(2);
      const b1 = input[ip++] ?? 0;
      const b2 = input[ip++] ?? 0;
      literals(b1 >>> 6);
      match(((b1 & 63) << 8) + b2 + 1, (control & 63) + 4);
    } else if (control < 224) {
      operands(3);
      const b1 = input[ip++] ?? 0;
      const b2 = input[ip++] ?? 0;
      const b3 = input[ip++] ?? 0;
      literals(control & 3);
      match(((control & 16) << 12) + (b1 << 8) + b2 + 1, ((control & 12) << 6) + b3 + 5);
    } else if (control < 252) {
      literals((control & 31) + 1 << 2);
    } else {
      literals(control & 3);
      break;
    }
  }
  if (op !== output.length)
    throw malformed(`decoded ${op} bytes where ${output.length} were declared`);
  return output;
}
export {
  REFPACK_MALFORMED,
  decodeRefPack,
  isRefPack,
  readRefPackHeader
};
