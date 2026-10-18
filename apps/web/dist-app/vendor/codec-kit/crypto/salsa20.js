import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/crypto/salsa20.js
var SIGMA = [1634760805, 857760878, 2036477234, 1797285236];
var TAU = [1634760805, 824206446, 2036477238, 1797285236];
var rotl = (value, shift) => value << shift | value >>> 32 - shift;
function block(state, work, out) {
  work.set(state);
  for (let round = 0; round < 20; round += 2) {
    work[4] ^= rotl(work[0] + work[12] | 0, 7);
    work[8] ^= rotl(work[4] + work[0] | 0, 9);
    work[12] ^= rotl(work[8] + work[4] | 0, 13);
    work[0] ^= rotl(work[12] + work[8] | 0, 18);
    work[9] ^= rotl(work[5] + work[1] | 0, 7);
    work[13] ^= rotl(work[9] + work[5] | 0, 9);
    work[1] ^= rotl(work[13] + work[9] | 0, 13);
    work[5] ^= rotl(work[1] + work[13] | 0, 18);
    work[14] ^= rotl(work[10] + work[6] | 0, 7);
    work[2] ^= rotl(work[14] + work[10] | 0, 9);
    work[6] ^= rotl(work[2] + work[14] | 0, 13);
    work[10] ^= rotl(work[6] + work[2] | 0, 18);
    work[3] ^= rotl(work[15] + work[11] | 0, 7);
    work[7] ^= rotl(work[3] + work[15] | 0, 9);
    work[11] ^= rotl(work[7] + work[3] | 0, 13);
    work[15] ^= rotl(work[11] + work[7] | 0, 18);
    work[1] ^= rotl(work[0] + work[3] | 0, 7);
    work[2] ^= rotl(work[1] + work[0] | 0, 9);
    work[3] ^= rotl(work[2] + work[1] | 0, 13);
    work[0] ^= rotl(work[3] + work[2] | 0, 18);
    work[6] ^= rotl(work[5] + work[4] | 0, 7);
    work[7] ^= rotl(work[6] + work[5] | 0, 9);
    work[4] ^= rotl(work[7] + work[6] | 0, 13);
    work[5] ^= rotl(work[4] + work[7] | 0, 18);
    work[11] ^= rotl(work[10] + work[9] | 0, 7);
    work[8] ^= rotl(work[11] + work[10] | 0, 9);
    work[9] ^= rotl(work[8] + work[11] | 0, 13);
    work[10] ^= rotl(work[9] + work[8] | 0, 18);
    work[12] ^= rotl(work[15] + work[14] | 0, 7);
    work[13] ^= rotl(work[12] + work[15] | 0, 9);
    work[14] ^= rotl(work[13] + work[12] | 0, 13);
    work[15] ^= rotl(work[14] + work[13] | 0, 18);
  }
  for (let index = 0; index < 16; index += 1) {
    const word2 = work[index] + state[index] >>> 0;
    out[index * 4] = word2 & 255;
    out[index * 4 + 1] = word2 >>> 8 & 255;
    out[index * 4 + 2] = word2 >>> 16 & 255;
    out[index * 4 + 3] = word2 >>> 24;
  }
}
var word = (bytes, offset) => (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
function salsa20Xor(key, nonce, input) {
  if (key.byteLength !== 16 && key.byteLength !== 32)
    throw new RangeError(`Salsa20 key must be 16 or 32 bytes, got ${String(key.byteLength)}`);
  if (nonce.byteLength !== 8)
    throw new RangeError(`Salsa20 nonce must be 8 bytes, got ${String(nonce.byteLength)}`);
  const constants = key.byteLength === 32 ? SIGMA : TAU;
  const second = key.byteLength === 32 ? 16 : 0;
  const state = new Uint32Array(16);
  state[0] = constants[0];
  for (let index = 0; index < 4; index += 1)
    state[1 + index] = word(key, index * 4);
  state[5] = constants[1];
  state[6] = word(nonce, 0);
  state[7] = word(nonce, 4);
  state[10] = constants[2];
  for (let index = 0; index < 4; index += 1)
    state[11 + index] = word(key, second + index * 4);
  state[15] = constants[3];
  const work = new Uint32Array(16);
  const stream = new Uint8Array(64);
  const out = new Uint8Array(input.byteLength);
  for (let offset = 0; offset < input.byteLength; offset += 64) {
    block(state, work, stream);
    const end = Math.min(64, input.byteLength - offset);
    for (let index = 0; index < end; index += 1)
      out[offset + index] = input[offset + index] ^ stream[index];
    state[8] = state[8] + 1 >>> 0;
    if (state[8] === 0)
      state[9] = state[9] + 1 >>> 0;
  }
  return out;
}
export {
  salsa20Xor
};
