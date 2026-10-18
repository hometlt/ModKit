// packages/uv/dist/model/validation/values.js
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function field(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value[key];
}
function array(value, key) {
  const candidate = field(value, key);
  return Array.isArray(candidate) ? candidate : [];
}
function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(finite);
}
function oneOf(value, values) {
  return typeof value === "string" && values.includes(value);
}
function safeIndex(value, length, label) {
  if (!integer(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}

export {
  object,
  field,
  array,
  nonBlank,
  finite,
  integer,
  finiteArray,
  oneOf,
  safeIndex
};
