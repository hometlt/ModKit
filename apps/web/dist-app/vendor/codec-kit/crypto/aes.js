import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/crypto/aes.js
var AES_BLOCK_BYTES = 16;
var tables;
var xtime = (value) => (value << 1 ^ (value & 128 ? 27 : 0)) & 255;
function multiply(left, right) {
  let product = 0;
  for (let a = left, b = right; b !== 0; a = xtime(a), b >>>= 1)
    if (b & 1)
      product ^= a;
  return product;
}
var rotateRight = (word, bits) => (word >>> bits | word << 32 - bits) >>> 0;
function buildTables() {
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  for (let power = 0, value = 1; power < 255; power += 1) {
    exp[power] = value;
    log[value] = power;
    value ^= xtime(value);
  }
  const sbox = new Uint8Array(256);
  const inverse = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const inv = value === 0 ? 0 : exp[(255 - (log[value] ?? 0)) % 255] ?? 0;
    let affine = inv;
    for (let shift = 1; shift <= 4; shift += 1)
      affine ^= (inv << shift | inv >>> 8 - shift) & 255;
    affine ^= 99;
    sbox[value] = affine;
    inverse[affine] = value;
  }
  const e0 = new Uint32Array(256);
  const d0 = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const s = sbox[value] ?? 0;
    e0[value] = (multiply(s, 2) << 24 | s << 16 | s << 8 | multiply(s, 3)) >>> 0;
    const i = inverse[value] ?? 0;
    d0[value] = (multiply(i, 14) << 24 | multiply(i, 9) << 16 | multiply(i, 13) << 8 | multiply(i, 11)) >>> 0;
  }
  const rotated = (table, bits) => table.map((word) => rotateRight(word, bits));
  return {
    sbox,
    inverse,
    encrypt: [e0, rotated(e0, 8), rotated(e0, 16), rotated(e0, 24)],
    decrypt: [d0, rotated(d0, 8), rotated(d0, 16), rotated(d0, 24)]
  };
}
function expandKey(key, sbox) {
  const words = key.byteLength / 4;
  const rounds = words + 6;
  const schedule = new Uint32Array(4 * (rounds + 1));
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let index = 0; index < words; index += 1)
    schedule[index] = view.getUint32(index * 4, false);
  const subWord = (word) => ((sbox[word >>> 24] ?? 0) << 24 | (sbox[word >>> 16 & 255] ?? 0) << 16 | (sbox[word >>> 8 & 255] ?? 0) << 8 | (sbox[word & 255] ?? 0)) >>> 0;
  let rcon = 1;
  for (let index = words; index < schedule.length; index += 1) {
    let word = schedule[index - 1] ?? 0;
    if (index % words === 0) {
      word = (subWord((word << 8 | word >>> 24) >>> 0) ^ rcon << 24) >>> 0;
      rcon = xtime(rcon);
    } else if (words > 6 && index % words === 4)
      word = subWord(word);
    schedule[index] = ((schedule[index - words] ?? 0) ^ word) >>> 0;
  }
  return schedule;
}
function inverseSchedule(schedule, { sbox, decrypt }) {
  const rounds = schedule.length / 4 - 1;
  const [d0, d1, d2, d3] = decrypt;
  const out = new Uint32Array(schedule.length);
  for (let round = 0; round <= rounds; round += 1) {
    for (let column = 0; column < 4; column += 1) {
      const word = schedule[4 * (rounds - round) + column] ?? 0;
      out[4 * round + column] = round === 0 || round === rounds ? word : ((d0[sbox[word >>> 24] ?? 0] ?? 0) ^ (d1[sbox[word >>> 16 & 255] ?? 0] ?? 0) ^ (d2[sbox[word >>> 8 & 255] ?? 0] ?? 0) ^ (d3[sbox[word & 255] ?? 0] ?? 0)) >>> 0;
    }
  }
  return out;
}
function checkBlocks(data) {
  if (!(data instanceof Uint8Array))
    throw new TypeError("AES input must be bytes");
  if (data.byteLength % AES_BLOCK_BYTES !== 0)
    throw new RangeError(`AES input of ${data.byteLength} bytes is not whole 16-byte blocks`);
}
function checkIv(iv) {
  if (!(iv instanceof Uint8Array) || iv.byteLength !== AES_BLOCK_BYTES)
    throw new RangeError("AES CBC needs a 16-byte initialisation vector");
  return new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
}
function createAes(key) {
  if (!(key instanceof Uint8Array))
    throw new TypeError("AES key must be bytes");
  if (key.byteLength !== 16 && key.byteLength !== 24 && key.byteLength !== 32)
    throw new RangeError(`AES key must be 16, 24 or 32 bytes, not ${key.byteLength}`);
  tables ??= buildTables();
  const { sbox, inverse } = tables;
  const [e0, e1, e2, e3] = tables.encrypt;
  const [d0, d1, d2, d3] = tables.decrypt;
  const forward = expandKey(key, sbox);
  const backward = inverseSchedule(forward, tables);
  const rounds = forward.length / 4 - 1;
  const last = 4 * rounds;
  const encryptBlock = (s) => {
    const k = forward;
    let s0 = s[0] ^ (k[0] ?? 0);
    let s1 = s[1] ^ (k[1] ?? 0);
    let s2 = s[2] ^ (k[2] ?? 0);
    let s3 = s[3] ^ (k[3] ?? 0);
    for (let r = 4; r < last; r += 4) {
      const t0 = (e0[s0 >>> 24] ?? 0) ^ (e1[s1 >>> 16 & 255] ?? 0) ^ (e2[s2 >>> 8 & 255] ?? 0) ^ (e3[s3 & 255] ?? 0) ^ (k[r] ?? 0);
      const t1 = (e0[s1 >>> 24] ?? 0) ^ (e1[s2 >>> 16 & 255] ?? 0) ^ (e2[s3 >>> 8 & 255] ?? 0) ^ (e3[s0 & 255] ?? 0) ^ (k[r + 1] ?? 0);
      const t2 = (e0[s2 >>> 24] ?? 0) ^ (e1[s3 >>> 16 & 255] ?? 0) ^ (e2[s0 >>> 8 & 255] ?? 0) ^ (e3[s1 & 255] ?? 0) ^ (k[r + 2] ?? 0);
      const t3 = (e0[s3 >>> 24] ?? 0) ^ (e1[s0 >>> 16 & 255] ?? 0) ^ (e2[s1 >>> 8 & 255] ?? 0) ^ (e3[s2 & 255] ?? 0) ^ (k[r + 3] ?? 0);
      s0 = t0;
      s1 = t1;
      s2 = t2;
      s3 = t3;
    }
    const column = (a, b, c, d, round) => ((sbox[a >>> 24] ?? 0) << 24 | (sbox[b >>> 16 & 255] ?? 0) << 16 | (sbox[c >>> 8 & 255] ?? 0) << 8 | (sbox[d & 255] ?? 0)) ^ (k[round] ?? 0);
    s[0] = column(s0, s1, s2, s3, last) >>> 0;
    s[1] = column(s1, s2, s3, s0, last + 1) >>> 0;
    s[2] = column(s2, s3, s0, s1, last + 2) >>> 0;
    s[3] = column(s3, s0, s1, s2, last + 3) >>> 0;
  };
  const decryptBlock = (s) => {
    const k = backward;
    let s0 = s[0] ^ (k[0] ?? 0);
    let s1 = s[1] ^ (k[1] ?? 0);
    let s2 = s[2] ^ (k[2] ?? 0);
    let s3 = s[3] ^ (k[3] ?? 0);
    for (let r = 4; r < last; r += 4) {
      const t0 = (d0[s0 >>> 24] ?? 0) ^ (d1[s3 >>> 16 & 255] ?? 0) ^ (d2[s2 >>> 8 & 255] ?? 0) ^ (d3[s1 & 255] ?? 0) ^ (k[r] ?? 0);
      const t1 = (d0[s1 >>> 24] ?? 0) ^ (d1[s0 >>> 16 & 255] ?? 0) ^ (d2[s3 >>> 8 & 255] ?? 0) ^ (d3[s2 & 255] ?? 0) ^ (k[r + 1] ?? 0);
      const t2 = (d0[s2 >>> 24] ?? 0) ^ (d1[s1 >>> 16 & 255] ?? 0) ^ (d2[s0 >>> 8 & 255] ?? 0) ^ (d3[s3 & 255] ?? 0) ^ (k[r + 2] ?? 0);
      const t3 = (d0[s3 >>> 24] ?? 0) ^ (d1[s2 >>> 16 & 255] ?? 0) ^ (d2[s1 >>> 8 & 255] ?? 0) ^ (d3[s0 & 255] ?? 0) ^ (k[r + 3] ?? 0);
      s0 = t0;
      s1 = t1;
      s2 = t2;
      s3 = t3;
    }
    const column = (a, b, c, d, round) => ((inverse[a >>> 24] ?? 0) << 24 | (inverse[b >>> 16 & 255] ?? 0) << 16 | (inverse[c >>> 8 & 255] ?? 0) << 8 | (inverse[d & 255] ?? 0)) ^ (k[round] ?? 0);
    s[0] = column(s0, s3, s2, s1, last) >>> 0;
    s[1] = column(s1, s0, s3, s2, last + 1) >>> 0;
    s[2] = column(s2, s1, s0, s3, last + 2) >>> 0;
    s[3] = column(s3, s2, s1, s0, last + 3) >>> 0;
  };
  const each = (data, step) => {
    checkBlocks(data);
    const out = new Uint8Array(data.byteLength);
    const input = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const output = new DataView(out.buffer);
    const block = [0, 0, 0, 0];
    for (let at = 0; at < data.byteLength; at += AES_BLOCK_BYTES) {
      block[0] = input.getUint32(at, false);
      block[1] = input.getUint32(at + 4, false);
      block[2] = input.getUint32(at + 8, false);
      block[3] = input.getUint32(at + 12, false);
      step(block);
      output.setUint32(at, block[0], false);
      output.setUint32(at + 4, block[1], false);
      output.setUint32(at + 8, block[2], false);
      output.setUint32(at + 12, block[3], false);
    }
    return out;
  };
  const xorInto = (target, source) => {
    target[0] = (target[0] ^ source[0]) >>> 0;
    target[1] = (target[1] ^ source[1]) >>> 0;
    target[2] = (target[2] ^ source[2]) >>> 0;
    target[3] = (target[3] ^ source[3]) >>> 0;
  };
  const ivBlock = (iv) => {
    const view = checkIv(iv);
    return [
      view.getUint32(0, false),
      view.getUint32(4, false),
      view.getUint32(8, false),
      view.getUint32(12, false)
    ];
  };
  return Object.freeze({
    encryptEcb: (data) => each(data, encryptBlock),
    decryptEcb: (data) => each(data, decryptBlock),
    encryptCbc(data, iv) {
      const chain = ivBlock(iv);
      return each(data, (block) => {
        xorInto(block, chain);
        encryptBlock(block);
        chain.splice(0, 4, ...block);
      });
    },
    decryptCbc(data, iv) {
      const chain = ivBlock(iv);
      return each(data, (block) => {
        const cipher = [block[0], block[1], block[2], block[3]];
        decryptBlock(block);
        xorInto(block, chain);
        chain.splice(0, 4, ...cipher);
      });
    }
  });
}
export {
  AES_BLOCK_BYTES,
  createAes
};
