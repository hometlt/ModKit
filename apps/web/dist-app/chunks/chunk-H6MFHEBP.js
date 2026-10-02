// packages/codec-kit/src/compression/adler32.ts
function createAdler32() {
  let a = 1;
  let b = 0;
  return Object.freeze({
    update(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError("Adler-32 input must be bytes");
      for (const byte of bytes) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
      }
    },
    digest() {
      return (b << 16 | a) >>> 0;
    }
  });
}
function adler32(bytes) {
  const checksum = createAdler32();
  checksum.update(bytes);
  return checksum.digest();
}

// packages/codec-kit/src/checksum/xxhash32.ts
var PRIME1 = 2654435761;
var PRIME2 = 2246822519;
var PRIME3 = 3266489917;
var PRIME4 = 668265263;
var PRIME5 = 374761393;
var rotateLeft = (value, bits) => (value << bits | value >>> 32 - bits) >>> 0;
var round = (lane, input) => Math.imul(rotateLeft(lane + Math.imul(input, PRIME2) >>> 0, 13), PRIME1) >>> 0;
function xxHash32(bytes, seed = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  let offset = 0;
  let hash;
  if (length >= 16) {
    let v1 = seed + PRIME1 + PRIME2 >>> 0;
    let v2 = seed + PRIME2 >>> 0;
    let v3 = seed >>> 0;
    let v4 = seed - PRIME1 >>> 0;
    for (const last = length - 16; offset <= last; offset += 16) {
      v1 = round(v1, view.getUint32(offset, true));
      v2 = round(v2, view.getUint32(offset + 4, true));
      v3 = round(v3, view.getUint32(offset + 8, true));
      v4 = round(v4, view.getUint32(offset + 12, true));
    }
    hash = rotateLeft(v1, 1) + rotateLeft(v2, 7) + rotateLeft(v3, 12) + rotateLeft(v4, 18) >>> 0;
  } else {
    hash = seed + PRIME5 >>> 0;
  }
  hash = hash + length >>> 0;
  for (; offset + 4 <= length; offset += 4)
    hash = Math.imul(rotateLeft(hash + Math.imul(view.getUint32(offset, true), PRIME3) >>> 0, 17), PRIME4) >>> 0;
  for (; offset < length; offset += 1)
    hash = Math.imul(rotateLeft(hash + Math.imul(bytes[offset], PRIME5) >>> 0, 11), PRIME1) >>> 0;
  hash = Math.imul(hash ^ hash >>> 15, PRIME2);
  hash = Math.imul(hash ^ hash >>> 13, PRIME3);
  return (hash ^ hash >>> 16) >>> 0;
}

// packages/codec-kit/src/checksum/index.ts
var crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data) {
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) {
    crc = (crcTable[(crc ^ data[i]) & 255] ^ crc >>> 8) >>> 0;
  }
  return (crc ^ 4294967295) >>> 0;
}
function crc32Range(bytes, start, end) {
  return crc32(bytes.subarray(start, end));
}
var CASTAGNOLI = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? c >>> 1 ^ 2197175160 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32c(bytes, start = 0, end = bytes.byteLength) {
  let crc = 4294967295;
  for (let index = start; index < end; index += 1)
    crc = crc >>> 8 ^ CASTAGNOLI[(crc ^ (bytes[index] ?? 0)) & 255];
  return (crc ^ 4294967295) >>> 0;
}
var EDC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? c >>> 1 ^ 3623976961 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function cdRomEdc(bytes) {
  let edc = 0;
  for (const byte of bytes) edc = (edc >>> 8 ^ EDC[(edc ^ byte) & 255]) >>> 0;
  return edc;
}
var FORWARD = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n << 24;
    for (let k = 0; k < 8; k += 1) c = c & 2147483648 ? c << 1 ^ 79764919 : c << 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function createCrc32Msb({
  init = 4294967295,
  xorOut = 4294967295
} = {}) {
  let crc = init >>> 0;
  return {
    update(byte, count = 1) {
      for (let index = 0; index < count; index += 1) {
        crc = (crc << 8 ^ FORWARD[(crc >>> 24 ^ byte) & 255]) >>> 0;
      }
    },
    digest: () => (crc ^ xorOut) >>> 0
  };
}

export {
  createAdler32,
  adler32,
  xxHash32,
  crc32,
  crc32Range,
  crc32c,
  cdRomEdc,
  createCrc32Msb
};
