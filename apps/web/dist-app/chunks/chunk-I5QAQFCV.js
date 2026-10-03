// ../../MODDING/modkit-core/packages/codec-kit/dist/checksum/xxhash32.js
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

export {
  xxHash32
};
