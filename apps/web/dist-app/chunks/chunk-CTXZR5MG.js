import {
  snapshotModelMaterials
} from "./chunk-I675VFQQ.js";
import {
  snapshotJson
} from "./chunk-ZSDVUSRM.js";

// ../MODDING/modkit-core/packages/uv/dist/model/validation/values.js
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

// ../MODDING/modkit-core/packages/codec-kit/dist/legacy/models/material.js
var LAYER_SLOTS = [
  "diffuse",
  "decal",
  "specular",
  "gloss",
  "emissive1",
  "emissive2",
  "emissiveMask",
  "envi",
  "enviMask",
  "alpha1",
  "alpha2",
  "normal",
  "normalBlend1Mask",
  "normalBlend2Mask",
  "normalBlend1",
  "normalBlend2",
  "height",
  "lightMap",
  "ao",
  "teamColorMask",
  "metalness",
  "roughness"
];
function isStandardLayerSlot(value) {
  return LAYER_SLOTS.includes(value);
}

// ../MODDING/modkit-core/packages/uv/dist/model/animation-materials.js
var layerWidths = {
  constantColor: 4,
  colorMultiply: 1,
  colorAdd: 1,
  alphaFactor: 1,
  uvOffset: 2,
  uvAngle: 3,
  uvTiling: 2,
  uvTriplanarOffset: 3,
  uvTriplanarScale: 3
};
var ordinal = "(?:0|[1-9]\\d*)";
var standard = `(?:standard|composite/passes/${ordinal}/material)`;
var layerPath = new RegExp(`^/renderModel/${standard}/layers/([^/]+)/(.*)$`, "u");
var scalarPath = new RegExp(`^/renderModel/(?:${standard}/(?:parallaxHeight|normalBlendFactors/[0-7])|composite/passes/${ordinal}/alphaFactor)$`, "u");
function uvmAnimationMaterialPropertyWidth(path) {
  if (scalarPath.test(path))
    return 1;
  const layer = layerPath.exec(path);
  if (layer === null || !isStandardLayerSlot(layer[1] ?? ""))
    return void 0;
  const property = layer[2] ?? "";
  return property === "flipbook/frame" ? 1 : Object.hasOwn(layerWidths, property) ? layerWidths[property] : void 0;
}
function vector(value, width, scalar = false) {
  if (scalar && width === 1 && typeof value === "number" && Number.isFinite(Math.fround(value)))
    return value;
  if (!Array.isArray(value) || value.length !== width || value.some((item) => typeof item !== "number" || !Number.isFinite(Math.fround(item))))
    throw new TypeError("animation material values must match a finite float32 property width");
  return Object.freeze(Array.from(value, (item) => Number(item)));
}
function readTargets(value, signal) {
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw new TypeError("animation materialTargets must be an array");
  const ids = /* @__PURE__ */ new Set();
  return Object.freeze(value.map((candidate) => {
    signal?.throwIfAborted();
    const item = object(candidate, "animation material target");
    const id = item["id"];
    if (typeof id !== "string" || !id.trim() || ids.has(id) || !Array.isArray(item["properties"]))
      throw new TypeError("animation material target requires a unique id and properties");
    ids.add(id);
    const paths = /* @__PURE__ */ new Set();
    const properties = item["properties"].map((candidate2) => {
      const property = object(candidate2, "animation material property");
      const path = property["path"];
      const width = typeof path === "string" ? uvmAnimationMaterialPropertyWidth(path) : void 0;
      if (typeof path !== "string" || width === void 0 || paths.has(path) || !Array.isArray(property["sequenceTracks"]) || property["sequenceTracks"].length === 0)
        throw new TypeError("animation material property requires a unique published path and sequenceTracks");
      paths.add(path);
      const value2 = vector(property["value"], width, true);
      const sequences = /* @__PURE__ */ new Set();
      const sequenceTracks = property["sequenceTracks"].map((candidate3) => {
        signal?.throwIfAborted();
        const sequence = object(candidate3, "animation material sequence track");
        const index = sequence["sequenceIndex"];
        if (!integer(index) || index < 0 || index > 4294967295 || sequences.has(index))
          throw new TypeError("invalid animation material sequence index");
        sequences.add(index);
        const concurrent = sequence["concurrent"], wrap = sequence["wrapSeconds"];
        if (concurrent !== void 0 && typeof concurrent !== "boolean" || (wrap !== void 0 || concurrent === true) && (typeof wrap !== "number" || !Number.isFinite(wrap) || wrap <= 0))
          throw new TypeError("invalid animation material concurrent clock");
        const track = object(sequence["track"], "animation material track");
        if (track["lineType"] !== 0 && track["lineType"] !== 1 || track["globalSeqId"] !== null || !Array.isArray(track["keys"]) || track["keys"].length === 0)
          throw new TypeError("animation material track requires supported step/linear keys and explicit sequence clock");
        let previous = -Infinity;
        for (const key of track["keys"]) {
          const keyValue = object(key, "animation material key"), frame = keyValue["frame"];
          if (typeof frame !== "number" || !Number.isFinite(Math.fround(frame)) || frame < previous)
            throw new TypeError("animation material key times must be finite and ordered");
          previous = frame;
          vector(keyValue["vector"], width);
          for (const tangent of ["inTan", "outTan"])
            if (keyValue[tangent] !== void 0)
              vector(keyValue[tangent], width);
        }
        return sequence;
      });
      return Object.freeze({ path, value: value2, sequenceTracks: Object.freeze(sequenceTracks) });
    });
    return Object.freeze({ id, properties: Object.freeze(properties) });
  }));
}
function readUvmAnimationMaterialTargets(document, signal) {
  return readTargets(field(field(document["extensions"], "UV_game_animation_clips"), "materialTargets"), signal);
}
function materializeUvmAnimationMaterialTargets(source, budget = { maxDepth: 128, maxNodes: 1e6, maxBytes: 67108864 }, signal) {
  const materials = snapshotModelMaterials(source, budget, signal);
  const targets = [];
  for (const material of materials) {
    signal?.throwIfAborted();
    if (material.shader?.id !== "modkit.render-material.v1")
      continue;
    const model = object(material.shader.parameters["renderModel"], "animation material render model");
    if (model["version"] !== 1)
      throw new TypeError("unsupported animation material version");
    const properties = [];
    const visit = (value, path, depth) => {
      signal?.throwIfAborted();
      if (depth > budget.maxDepth)
        throw new RangeError("animation material target exceeds maxDepth");
      if (uvmAnimationMaterialPropertyWidth(path) !== void 0 && value !== void 0) {
        const property = object(value, "material animation property");
        if (array(property, "sequenceTracks").length > 0)
          properties.push({
            path,
            value: property["value"],
            sequenceTracks: property["sequenceTracks"]
          });
        return;
      }
      if (Array.isArray(value)) {
        for (const [index, child] of value.entries())
          visit(child, `${path}/${index}`, depth + 1);
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (!["extras", "extensions"].includes(key)) {
            const token = key.replace(/~/gu, "~0").replace(/\//gu, "~1");
            visit(child, `${path}/${token}`, depth + 1);
          }
        }
      }
    };
    visit(model, "/renderModel", 0);
    if (properties.length > 0)
      targets.push({ id: material.id, properties });
  }
  return readTargets(snapshotJson(targets, budget, signal), signal);
}

// ../MODDING/modkit-core/packages/uv/dist/model/animation-clips.js
function readUvmPrimitiveVisibility(document, signal) {
  const value = field(field(document["extensions"], "UV_game_variants"), "visibility");
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw new TypeError("UVM primitive visibility must be an array");
  if (!array(document, "extensionsUsed").includes("UV_game_variants"))
    throw new TypeError("UV_game_variants is not declared in extensionsUsed");
  const meshes = array(document, "meshes");
  const targets = /* @__PURE__ */ new Set();
  return Object.freeze(value.map((candidate) => {
    signal?.throwIfAborted();
    const item = object(candidate, "UVM primitive visibility");
    const scalar = item["value"];
    const nodeBinding = item["binding"] === "batch";
    const target = nodeBinding ? { node: safeIndex(item["node"], array(document, "nodes").length, "visibility node"), binding: "batch" } : (() => {
      const mesh = safeIndex(item["mesh"], meshes.length, "visibility mesh");
      return {
        mesh,
        primitive: safeIndex(item["primitive"], array(meshes[mesh], "primitives").length, "visibility primitive")
      };
    })();
    const key = "node" in target ? `node/${target.node}/batch` : `${target.mesh}/${target.primitive}`;
    if (typeof scalar !== "number" || !Number.isFinite(scalar) || targets.has(key))
      throw new TypeError("UVM visibility requires a finite value and unique primitive target");
    targets.add(key);
    return Object.freeze({ ...target, value: scalar });
  }));
}
function uvmVisibilityPointer(index) {
  if (!integer(index) || index < 0)
    throw new TypeError("invalid visibility index");
  return `/extensions/UV_game_variants/visibility/${index}/value`;
}
function uvmVisibilityTarget(pointer, visibility) {
  if (typeof pointer !== "string")
    return void 0;
  const match = /^\/extensions\/UV_game_variants\/visibility\/(0|[1-9]\d*)\/value$/u.exec(pointer);
  if (match === null)
    return void 0;
  return visibility[safeIndex(Number(match[1]), visibility.length, "visibility pointer")];
}
function readUvmAnimationClips(document, signal) {
  signal?.throwIfAborted();
  const value = field(document["extensions"], "UV_game_animation_clips");
  if (value === void 0)
    return void 0;
  const catalog = object(value, "UV_game_animation_clips");
  if (!Array.isArray(catalog["clips"]))
    throw new TypeError("UVM clip catalog requires clips");
  const animations = array(document, "animations");
  const ids = /* @__PURE__ */ new Set(), sequences = /* @__PURE__ */ new Set(), linked = /* @__PURE__ */ new Set();
  const clips = [];
  for (const item of catalog["clips"]) {
    signal?.throwIfAborted();
    const record = object(item, "UVM clip catalog entry");
    const id = record["id"], name = record["name"], duration = record["durationSeconds"], sequence = record["sourceSequenceIndex"];
    if (typeof id !== "string" || !id.trim() || ids.has(id) || typeof name !== "string" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || !integer(sequence) || sequence < 0 || sequences.has(sequence))
      throw new TypeError("UVM clip catalog identity, duration or sequence is invalid");
    const sourceId = record["sourceId"], looping = record["looping"], repeatCount = record["repeatCount"], kind = record["kind"], frames = record["frames"];
    if (sourceId !== void 0 && (typeof sourceId !== "string" || !sourceId) || looping !== void 0 && typeof looping !== "boolean" || repeatCount !== void 0 && (!integer(repeatCount) || repeatCount < 0) || kind !== void 0 && kind !== "animation" && kind !== "rest-pose" || frames !== void 0 && (!integer(frames) || frames < 0))
      throw new TypeError("UVM clip catalog optional metadata is invalid");
    const animation = record["animation"] === void 0 ? void 0 : safeIndex(record["animation"], animations.length, "clip animation");
    if (animation !== void 0) {
      if (linked.has(animation))
        throw new TypeError("UVM animation is linked by multiple clips");
      const target = object(animations[animation], "clip animation");
      if (array(target, "channels").length === 0 || array(target, "samplers").length === 0)
        throw new TypeError("UVM catalog must not link an empty glTF animation");
      const declared = field(field(target["extras"], "uv"), "sourceSequenceIndex");
      if (declared !== void 0 && declared !== sequence)
        throw new TypeError("UVM clip and animation sequence indices disagree");
      linked.add(animation);
    }
    ids.add(id);
    sequences.add(sequence);
    clips.push(Object.freeze({
      id,
      name,
      durationSeconds: duration,
      sourceSequenceIndex: sequence,
      ...animation === void 0 ? {} : { animation },
      ...sourceId === void 0 ? {} : { sourceId },
      ...looping === void 0 ? {} : { looping },
      ...repeatCount === void 0 ? {} : { repeatCount },
      ...kind === void 0 ? {} : { kind },
      ...frames === void 0 ? {} : { frames }
    }));
  }
  for (const [index, animation] of animations.entries()) {
    const scope = field(field(field(animation, "extras"), "uv"), "effectTrackScope");
    if (!linked.has(index) && scope !== "absolute" && scope !== "global")
      throw new TypeError("UVM clip catalog omits a selectable glTF animation");
  }
  return Object.freeze(clips);
}
function validateUvmAnimationClips(document, signal) {
  readUvmPrimitiveVisibility(document, signal);
  const clips = readUvmAnimationClips(document, signal);
  const sequences = new Set(clips?.map((clip) => clip.sourceSequenceIndex));
  for (const target of readUvmAnimationMaterialTargets(document, signal))
    for (const property of target.properties)
      for (const track of property.sequenceTracks)
        if (!sequences.has(Number(track["sequenceIndex"])))
          throw new TypeError("animation material target references an absent catalog sequence");
  if (clips !== void 0 && !array(document, "extensionsUsed").includes("UV_game_animation_clips"))
    throw new TypeError("UV_game_animation_clips is not declared in extensionsUsed");
}

// ../MODDING/modkit-core/packages/uv/dist/model/key-times.js
function readUvmKeyTimes(value, input, signal) {
  if (value === void 0)
    return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid UVM keyTimes metadata");
  const record = value;
  if (record["version"] !== 1 || Object.keys(record).some((key) => !["version", "seconds"].includes(key)) || !Array.isArray(record["seconds"]) || !record["seconds"].length)
    throw new TypeError("UVM keyTimes requires version 1 and seconds");
  const seconds = record["seconds"];
  if (input !== void 0 && (seconds.length !== input.values.length || seconds.length * 8 > input.maxScalarBytes))
    throw new RangeError("UVM keyTimes count or scalar budget mismatch");
  let previous = -Infinity;
  for (let index = 0; index < seconds.length; index++) {
    signal?.throwIfAborted();
    const time = seconds[index];
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time <= previous || input !== void 0 && Math.fround(time) !== input.values[index])
      throw new TypeError("UVM keyTimes must increase and match the input accessor");
    previous = time;
  }
  return seconds;
}
function uvmKeyTimesMetadata(seconds) {
  return seconds.some((time) => Math.fround(time) !== time) ? { keyTimes: { version: 1, seconds: [...seconds] } } : {};
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
  safeIndex,
  isStandardLayerSlot,
  readUvmAnimationMaterialTargets,
  materializeUvmAnimationMaterialTargets,
  readUvmPrimitiveVisibility,
  uvmVisibilityPointer,
  uvmVisibilityTarget,
  readUvmAnimationClips,
  validateUvmAnimationClips,
  readUvmKeyTimes,
  uvmKeyTimesMetadata
};
