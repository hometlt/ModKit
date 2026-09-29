// ../MODDING/modkit-core/packages/scene/dist/uvm/values.js
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
function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function string(value, label) {
  if (!nonBlank(value))
    throw new TypeError(`UVM ${label} must be a nonempty string`);
  return value;
}
function array(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [];
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}
function safeIndex(value, length, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}
function required(value, label) {
  if (value === void 0)
    throw new TypeError(`missing UVM ${label}`);
  return value;
}
function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
function vector3(value) {
  if (!finiteArray(value, 3))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [required(value[0], "x"), required(value[1], "y"), required(value[2], "z")];
}
function vector4(value) {
  if (!finiteArray(value, 4))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [
    required(value[0], "x"),
    required(value[1], "y"),
    required(value[2], "z"),
    required(value[3], "w")
  ];
}

export {
  object,
  field,
  nonBlank,
  string,
  array,
  safeIndex,
  required,
  finiteArray,
  vector3,
  vector4
};
