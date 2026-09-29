import {
  COMPRESSION_OUTPUT_LIMIT
} from "../../../chunks/chunk-GDKG5J25.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/compression/lzo.js
var LZO_MALFORMED = "codec-kit/lzo-malformed";
function malformed(message) {
  const error = new RangeError(`LZO1X stream ${message}`);
  Object.defineProperty(error, "code", { value: LZO_MALFORMED, enumerable: true });
  return error;
}
function decodeLzo1x(input, outputBytes) {
  if (!(input instanceof Uint8Array))
    throw new TypeError("LZO1X input must be bytes");
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) {
    throw new RangeError("outputBytes must be a non-negative safe integer");
  }
  const output = new Uint8Array(outputBytes);
  let ip = 0;
  let op = 0;
  const next = () => {
    if (ip >= input.length)
      throw malformed("ends inside a command");
    return input[ip++] ?? 0;
  };
  const room = (count) => {
    if (count > output.length - op) {
      const error = new RangeError(`LZO1X output exceeds its ${output.length}-byte bound`);
      Object.defineProperty(error, "code", { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true });
      throw error;
    }
  };
  const extended = (base) => {
    let count = base;
    let byte = next();
    while (byte === 0) {
      count += 255;
      room(count);
      byte = next();
    }
    return count + byte;
  };
  const literals = (count) => {
    if (count > input.length - ip)
      throw malformed("literal run overruns the input");
    room(count);
    output.set(input.subarray(ip, ip + count), op);
    ip += count;
    op += count;
  };
  const copy = (distance, count) => {
    if (distance <= 0 || distance > op)
      throw malformed(`has a match ${distance} back from ${op}`);
    room(count);
    const from = op - distance;
    for (let index = 0; index < count; index += 1)
      output[op++] = output[from + index] ?? 0;
  };
  let mode = "loop";
  let t = 0;
  if ((input[0] ?? 0) > 17) {
    t = next() - 17;
    if (t < 4) {
      mode = "match-next";
    } else {
      literals(t);
      mode = "first-literal-run";
    }
  }
  for (; ; ) {
    switch (mode) {
      case "loop": {
        t = next();
        if (t >= 16) {
          mode = "match";
          break;
        }
        literals(t === 0 ? extended(15) + 3 : t + 3);
        mode = "first-literal-run";
        break;
      }
      case "first-literal-run": {
        t = next();
        if (t >= 16) {
          mode = "match";
          break;
        }
        copy(1 + 2048 + (t >>> 2) + (next() << 2), 3);
        t &= 3;
        mode = t === 0 ? "loop" : "match-next";
        break;
      }
      case "match-next": {
        literals(t);
        t = next();
        mode = "match";
        break;
      }
      case "match": {
        let trailing;
        if (t >= 64) {
          copy(1 + (t >>> 2 & 7) + (next() << 3), (t >>> 5) + 1);
          trailing = t & 3;
        } else if (t >= 32) {
          const count = (t & 31) === 0 ? extended(31) : t & 31;
          const first = next();
          copy(1 + (first >>> 2 | next() << 6), count + 2);
          trailing = first & 3;
        } else if (t >= 16) {
          const count = (t & 7) === 0 ? extended(7) : t & 7;
          const first = next();
          const distance = ((t & 8) << 11) + (first >>> 2 | next() << 6);
          if (distance === 0) {
            if (op !== output.length)
              throw malformed(`ends after ${op} of ${output.length} bytes`);
            if (ip !== input.length) {
              throw malformed(`carries ${input.length - ip} bytes after its end`);
            }
            return output;
          }
          copy(distance + 16384, count + 2);
          trailing = first & 3;
        } else {
          copy(1 + (t >>> 2) + (next() << 2), 2);
          trailing = t & 3;
        }
        t = trailing;
        mode = t === 0 ? "loop" : "match-next";
        break;
      }
    }
  }
}
function encodeLzo1x(bytes) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("LZO1X input must be bytes");
  const n = bytes.byteLength;
  const head = [];
  if (n > 0 && n <= 238)
    head.push(17 + n);
  else if (n > 238) {
    head.push(0);
    let rest = n - 18;
    for (; rest > 255; rest -= 255)
      head.push(0);
    head.push(rest);
  }
  const out = new Uint8Array(head.length + n + 3);
  out.set(head);
  out.set(bytes, head.length);
  out.set([17, 0, 0], head.length + n);
  return out;
}
export {
  LZO_MALFORMED,
  decodeLzo1x,
  encodeLzo1x
};
