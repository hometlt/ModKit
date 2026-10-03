import {
  COMPRESSION_OUTPUT_LIMIT
} from "./chunk-I2OSMP3G.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/compression/refpack.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
var LONGEST_COMMAND = 113;
var LONGEST_OUTPUT = 1031;
var WINDOW = 131072;
function runCommands(run, until) {
  const { input, output, final } = run;
  let ip = run.ip;
  let op = run.op;
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
  const limit = final ? input.length : input.length - LONGEST_COMMAND;
  while (op < until && ip < limit) {
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
      run.stopped = true;
      break;
    }
  }
  if (final && !run.stopped && op < until)
    throw malformed("ends without its stop code");
  run.ip = ip;
  run.op = op;
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
  const run = {
    input,
    ip: header.headerBytes,
    final: true,
    output,
    op: 0,
    stopped: false
  };
  runCommands(run, Number.POSITIVE_INFINITY);
  if (run.op !== output.length)
    throw malformed(`decoded ${run.op} bytes where ${output.length} were declared`);
  return output;
}
async function refPackRangeSource(source, options = {}) {
  const compressedLength = Number(options.compressedLength ?? await source.size());
  const interval = options.checkpointBytes ?? 4 << 20;
  const chunkBytes = options.inputChunkBytes ?? 1 << 20;
  if (!Number.isSafeInteger(compressedLength) || compressedLength < 2) {
    throw malformed("has no RefPack header");
  }
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError("checkpointBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < LONGEST_COMMAND) {
    throw new RangeError(`inputChunkBytes must be at least ${LONGEST_COMMAND}`);
  }
  const readInput = async (offset, length, signal) => {
    const bytes = await source.read(BigInt(offset), length, signal);
    if (bytes.byteLength !== length)
      throw malformed("source is shorter than its length");
    return bytes;
  };
  const header = readRefPackHeader(await readInput(0, Math.min(10, compressedLength)));
  const size = header.size;
  const checkpoints = [
    { input: header.headerBytes, output: 0, window: new Uint8Array(0) }
  ];
  let last;
  const decode = async (from, until, signal) => {
    const base = from.output - from.window.length;
    const target = Math.min(until, size);
    const output = new Uint8Array(from.window.length + Math.min(size - from.output, target - from.output + LONGEST_OUTPUT));
    output.set(from.window);
    const run = {
      input: new Uint8Array(0),
      ip: 0,
      final: false,
      output,
      op: from.window.length,
      stopped: false
    };
    let inputStart = from.input;
    for (; ; ) {
      runCommands(run, target - base);
      if (base + run.op >= target || run.stopped)
        break;
      signal?.throwIfAborted();
      const rest = run.input.subarray(run.ip);
      inputStart += run.ip;
      const at = inputStart + rest.length;
      const length = Math.min(chunkBytes, compressedLength - at);
      const input = new Uint8Array(rest.length + length);
      input.set(rest);
      if (length > 0)
        input.set(await readInput(at, length, signal), rest.length);
      run.input = input;
      run.ip = 0;
      run.final = at + length >= compressedLength;
    }
    if (base + run.op < target || run.stopped && base + run.op !== size) {
      throw malformed(`decoded ${base + run.op} bytes where ${size} were declared`);
    }
    const checkpoint = {
      input: inputStart + run.ip,
      output: base + run.op,
      window: output.slice(Math.max(0, run.op - WINDOW), run.op)
    };
    return { base, output, end: run.op, checkpoint };
  };
  const readNow = async (offset, length, signal) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
      throw new RangeError("RefPack range must be non-negative");
    }
    if (offset + length > size)
      throw new RangeError("RefPack range is outside the decoded stream");
    if (length === 0)
      return new Uint8Array(0);
    if (last !== void 0 && offset >= last.start && offset + length <= last.start + last.bytes.length) {
      return last.bytes.slice(offset - last.start, offset - last.start + length);
    }
    let low = 0;
    for (let high = checkpoints.length - 1; low < high; ) {
      const middle = low + high + 1 >> 1;
      if ((checkpoints[middle]?.output ?? 0) <= offset)
        low = middle;
      else
        high = middle - 1;
    }
    let from = checkpoints[low];
    while (from === checkpoints.at(-1) && offset - from.output >= interval) {
      const next = (await decode(from, from.output + interval, signal)).checkpoint;
      checkpoints.push(next);
      from = next;
    }
    const decoded = await decode(from, offset + length, signal);
    last = {
      start: from.output,
      bytes: decoded.output.subarray(from.window.length, decoded.end)
    };
    return decoded.output.slice(offset - decoded.base, offset - decoded.base + length);
  };
  let queue = Promise.resolve();
  return Object.freeze({
    size: async () => BigInt(size),
    read(offset, length, signal) {
      const result = queue.then(() => readNow(Number(offset), length, signal));
      queue = result.catch(() => void 0);
      return result;
    }
  });
}
export {
  REFPACK_MALFORMED,
  decodeRefPack,
  isRefPack,
  readRefPackHeader,
  refPackRangeSource
};
