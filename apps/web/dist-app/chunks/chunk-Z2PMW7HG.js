// packages/codec-kit/dist/raster/channel-bits.js
function expand5To8(value) {
  if ((value & 31) !== value)
    throw new RangeError("colour channel must be an unsigned 5-bit integer");
  return value << 3 | value >>> 2;
}
function rgb555ToRgb888(word) {
  if ((word & 65535) !== word)
    throw new RangeError("RGB555 word must be an unsigned 16-bit integer");
  return expand5To8(word >>> 10 & 31) << 16 | expand5To8(word >>> 5 & 31) << 8 | expand5To8(word & 31);
}

export {
  expand5To8,
  rgb555ToRgb888
};
