// packages/codec-kit/dist/binary.js
function requireByteRange(byteLength, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0)
    throw new RangeError(label + " has an invalid range");
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || offset > byteLength || length > byteLength - offset)
    throw new RangeError(label + " is outside the source");
}
function requireRange(bytes, offset, length, label) {
  requireByteRange(bytes.byteLength, offset, length, label);
}
function byteView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function viewAt(bytes, offset, length, label) {
  requireRange(bytes, offset, length, label);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}
function ascii(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}
function readNullTerminatedAscii(bytes, offset, length, label) {
  requireRange(bytes, offset, length, label);
  let end = offset;
  while (end < offset + length && bytes[end] !== 0)
    end += 1;
  return ascii(bytes.subarray(offset, end));
}
function boundedCount(value, maximum, label) {
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new RangeError(label + " has an invalid maximum");
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new RangeError(label + " is outside 0\u2013" + String(maximum));
  return value;
}
function checkedProduct(left, right, label) {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new RangeError(label + " overflows a nonnegative safe integer");
  return result;
}

export {
  requireByteRange,
  requireRange,
  byteView,
  viewAt,
  ascii,
  readNullTerminatedAscii,
  boundedCount,
  checkedProduct
};
