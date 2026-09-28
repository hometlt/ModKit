import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-JVAXQGJ2.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/compression/lcw.js
var LCW_MALFORMED = "codec-kit/lcw-malformed";
function malformed(kind, message) {
  const error = new RangeError(`${kind} stream ${message}`);
  Object.defineProperty(error, "code", { value: LCW_MALFORMED, enumerable: true });
  return error;
}
function overrun(kind, bound) {
  const error = new RangeError(`${kind} output exceeds its ${bound}-byte bound`);
  Object.defineProperty(error, "code", { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true });
  return error;
}
function decodeLcw(input, maxOutputBytes) {
  if (!(input instanceof Uint8Array))
    throw new TypeError("LCW input must be bytes");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError("maxOutputBytes must be a non-negative safe integer");
  }
  const output = new Uint8Array(maxOutputBytes);
  const relative = input[0] === 0;
  let ip = relative ? 1 : 0;
  let op = 0;
  const need = (count) => {
    if (count > input.length - ip)
      throw malformed("LCW", "ends inside a command");
  };
  const u16 = () => {
    need(2);
    const value = (input[ip] ?? 0) | (input[ip + 1] ?? 0) << 8;
    ip += 2;
    return value;
  };
  const room = (count) => {
    if (count > output.length - op)
      throw overrun("LCW", output.length);
  };
  const copyFrom = (from, count) => {
    if (from < 0 || from >= op) {
      throw malformed("LCW", `copies from ${from}, outside what was written`);
    }
    room(count);
    for (let index = 0; index < count; index += 1)
      output[op++] = output[from + index] ?? 0;
  };
  while (ip < input.length) {
    const command = input[ip++] ?? 0;
    if ((command & 128) === 0) {
      need(1);
      const distance = (command & 15) << 8 | (input[ip++] ?? 0);
      copyFrom(op - distance, ((command & 112) >>> 4) + 3);
    } else if ((command & 64) === 0) {
      const count = command & 63;
      if (count === 0)
        break;
      need(count);
      room(count);
      output.set(input.subarray(ip, ip + count), op);
      ip += count;
      op += count;
    } else if (command === 254) {
      const count = u16();
      need(1);
      room(count);
      output.fill(input[ip++] ?? 0, op, op + count);
      op += count;
    } else {
      const count = command === 255 ? u16() : (command & 63) + 3;
      const position = u16();
      copyFrom(relative ? op - position : position, count);
    }
  }
  return { output, written: op };
}
function applyFormat40(input, target) {
  if (!(input instanceof Uint8Array) || !(target instanceof Uint8Array)) {
    throw new TypeError("Format40 input and target must be bytes");
  }
  let ip = 0;
  let op = 0;
  const need = (count) => {
    if (count > input.length - ip)
      throw malformed("Format40", "ends inside a command");
  };
  const room = (count) => {
    if (count > target.length - op)
      throw overrun("Format40", target.length);
  };
  const xorRun = (count) => {
    need(count);
    room(count);
    for (let index = 0; index < count; index += 1)
      target[op++] ^= input[ip++] ?? 0;
  };
  const xorFill = (count, value) => {
    room(count);
    for (let index = 0; index < count; index += 1)
      target[op++] ^= value;
  };
  while (ip < input.length) {
    const command = input[ip++] ?? 0;
    if (command === 0) {
      need(2);
      const count = input[ip++] ?? 0;
      xorFill(count, input[ip++] ?? 0);
    } else if ((command & 128) === 0) {
      xorRun(command);
    } else if (command !== 128) {
      const count = command & 127;
      room(count);
      op += count;
    } else {
      need(2);
      const word = (input[ip] ?? 0) | (input[ip + 1] ?? 0) << 8;
      ip += 2;
      if (word === 0)
        return;
      if ((word & 32768) === 0) {
        room(word);
        op += word;
      } else if ((word & 16384) === 0) {
        xorRun(word & 16383);
      } else {
        need(1);
        xorFill(word & 16383, input[ip++] ?? 0);
      }
    }
  }
}
function encodeLcw(bytes) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("LCW input must be bytes");
  const out = [];
  let literalStart = 0;
  const flush = (end) => {
    for (let at2 = literalStart; at2 < end; at2 += 63) {
      const count = Math.min(63, end - at2);
      out.push(128 | count);
      for (let index = at2; index < at2 + count; index += 1)
        out.push(bytes[index] ?? 0);
    }
  };
  let at = 0;
  while (at < bytes.byteLength) {
    let run = 1;
    while (at + run < bytes.byteLength && run < 65535 && bytes[at + run] === bytes[at])
      run += 1;
    if (run >= 4) {
      flush(at);
      out.push(254, run & 255, run >>> 8, bytes[at] ?? 0);
      at += run;
      literalStart = at;
    } else
      at += run;
  }
  flush(bytes.byteLength);
  out.push(128);
  return Uint8Array.from(out);
}
export {
  LCW_MALFORMED,
  applyFormat40,
  decodeLcw,
  encodeLcw
};
