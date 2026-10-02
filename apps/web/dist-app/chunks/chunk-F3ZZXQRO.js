// ../MODDING/modkit-core/packages/codec-kit/dist/compression/adler32.js
function createAdler32() {
  let a = 1;
  let b = 0;
  return Object.freeze({
    update(bytes) {
      if (!(bytes instanceof Uint8Array))
        throw new TypeError("Adler-32 input must be bytes");
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

// ../MODDING/modkit-core/packages/codec-kit/dist/checksum/index.js
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
    for (let k = 0; k < 8; k += 1)
      c = c & 1 ? c >>> 1 ^ 2197175160 : c >>> 1;
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
    for (let k = 0; k < 8; k += 1)
      c = c & 1 ? c >>> 1 ^ 3623976961 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function cdRomEdc(bytes) {
  let edc = 0;
  for (const byte of bytes)
    edc = (edc >>> 8 ^ EDC[(edc ^ byte) & 255]) >>> 0;
  return edc;
}
var FORWARD = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n << 24;
    for (let k = 0; k < 8; k += 1)
      c = c & 2147483648 ? c << 1 ^ 79764919 : c << 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function createCrc32Msb({ init = 4294967295, xorOut = 4294967295 } = {}) {
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
  crc32,
  crc32Range,
  crc32c,
  cdRomEdc,
  createCrc32Msb
};
