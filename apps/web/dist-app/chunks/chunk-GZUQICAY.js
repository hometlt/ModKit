import {
  snapshotJson
} from "./chunk-QG2MBCY3.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/model/materials.js
var DEFAULT_MODEL_MATERIAL_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
var record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};
var text = (value, label, nonEmpty = false) => {
  if (typeof value !== "string" || nonEmpty && value.trim() === "")
    throw new TypeError(`${label} must be a string`);
};
var strings = (value, label) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
};
var optionalFields = (value, label) => {
  for (const key of ["name", "libraryId", "type", "blendMode"]) {
    if (value[key] !== void 0)
      text(value[key], `${label}.${key}`);
  }
  if (value["alphaMode"] !== void 0 && value["alphaMode"] !== "opaque" && value["alphaMode"] !== "mask" && value["alphaMode"] !== "blend") {
    throw new TypeError(`${label}.alphaMode must be opaque, mask or blend`);
  }
  if (value["alphaCutoff"] !== void 0 && (typeof value["alphaCutoff"] !== "number" || !Number.isFinite(value["alphaCutoff"]) || value["alphaCutoff"] < 0)) {
    throw new TypeError(`${label}.alphaCutoff must be finite and nonnegative`);
  }
  for (const key of ["castShadows", "receiveShadows"]) {
    if (value[key] !== void 0 && typeof value[key] !== "boolean") {
      throw new TypeError(`${label}.${key} must be a boolean`);
    }
  }
  for (const key of ["priority", "uvSource", "colorChannels", "nativeFlags"]) {
    if (value[key] !== void 0 && typeof value[key] !== "number")
      throw new TypeError(`${label}.${key} must be a number`);
  }
  for (const key of ["contracts", "flagNames"]) {
    if (value[key] !== void 0)
      strings(value[key], `${label}.${key}`);
  }
};
function snapshotModelMaterials(value, budget = DEFAULT_MODEL_MATERIAL_BUDGET, signal) {
  const snapshot = snapshotJson(value, { ...budget, sortKeys: true }, signal);
  if (!Array.isArray(snapshot))
    throw new TypeError("model materials must be an array");
  const ids = /* @__PURE__ */ new Set();
  for (const entry of snapshot) {
    const material = record(entry, "material");
    text(material["id"], "material.id", true);
    const id = material["id"];
    if (ids.has(id))
      throw new TypeError(`duplicate material id ${id}`);
    ids.add(id);
    optionalFields(material, `material ${id}`);
    if (material["layers"] !== void 0) {
      if (!Array.isArray(material["layers"]))
        throw new TypeError("material.layers must be an array");
      for (const entry2 of material["layers"]) {
        const layer = record(entry2, "material layer");
        text(layer["slot"], "material layer.slot", true);
        if (layer["resourceId"] !== void 0)
          text(layer["resourceId"], "material layer.resourceId", true);
        optionalFields(layer, "material layer");
      }
    }
    if (material["shader"] !== void 0) {
      const shader = record(material["shader"], "material.shader");
      text(shader["id"], "material.shader.id", true);
      record(shader["parameters"], "material.shader.parameters");
    }
  }
  return snapshot;
}

export {
  DEFAULT_MODEL_MATERIAL_BUDGET,
  snapshotModelMaterials
};
