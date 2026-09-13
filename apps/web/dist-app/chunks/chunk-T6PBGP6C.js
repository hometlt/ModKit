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

// packages/uv/dist/model/validation/spatial.js
function validateSocketMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let count = 0;
  const axes = ["+x", "-x", "+y", "-y", "+z", "-z"];
  for (const [nodeIndex, candidate] of array(document, "nodes").entries()) {
    signal?.throwIfAborted();
    const node = object(candidate, `node ${nodeIndex}`);
    const candidateSocket = field(node["extensions"], "UV_game_socket");
    if (candidateSocket === void 0)
      continue;
    count += 1;
    const socket = object(candidateSocket, `node ${nodeIndex} UV_game_socket`);
    if (!nonBlank(socket["role"]))
      throw new TypeError(`node ${nodeIndex} socket needs a role`);
    if (socket["index"] !== void 0 && (!integer(socket["index"]) || socket["index"] < 0)) {
      throw new RangeError(`node ${nodeIndex} socket index is invalid`);
    }
    if (socket["sourceName"] !== void 0 && typeof socket["sourceName"] !== "string") {
      throw new TypeError(`node ${nodeIndex} socket sourceName is invalid`);
    }
    if (socket["forward"] !== void 0 && !oneOf(socket["forward"], axes)) {
      throw new TypeError(`node ${nodeIndex} socket forward axis is invalid`);
    }
    if (socket["up"] !== void 0 && !oneOf(socket["up"], axes)) {
      throw new TypeError(`node ${nodeIndex} socket up axis is invalid`);
    }
    const candidateIdentity = field(socket["extras"], "modkit");
    const identity = candidateIdentity === void 0 ? void 0 : object(candidateIdentity, "socket Modkit identity");
    if (identity !== void 0 && (!nonBlank(identity["id"]) || !nonBlank(identity["nodeId"]))) {
      throw new TypeError(`node ${nodeIndex} socket Modkit identity is invalid`);
    }
  }
  if (count > 0 && !used.includes("UV_game_socket")) {
    throw new TypeError("UV_game_socket is not declared in extensionsUsed");
  }
  if (count === 0 && used.includes("UV_game_socket")) {
    throw new TypeError("UV_game_socket is declared but absent");
  }
}
function validateCollisionMetadata(document, used, signal) {
  signal?.throwIfAborted();
  const nodes = array(document, "nodes");
  const allowedKinds = [
    "box",
    "sphere",
    "capsule",
    "cylinder",
    "convex-hull",
    "mesh",
    "plane"
  ];
  let extensionCount = 0;
  for (const [nodeIndex, candidate] of nodes.entries()) {
    signal?.throwIfAborted();
    const node = object(candidate, `node ${nodeIndex}`);
    const extension = field(node["extensions"], "UV_game_collision");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    if (!used.includes("UV_game_collision")) {
      throw new TypeError(`node ${nodeIndex} uses undeclared UV_game_collision`);
    }
    const collision = object(extension, `node ${nodeIndex} UV_game_collision`);
    const shapes = array(collision, "shapes");
    if (shapes.length === 0)
      throw new TypeError("UV_game_collision.shapes must not be empty");
    if (collision["role"] !== void 0 && !oneOf(collision["role"], ["physics", "hit", "selection", "footprint", "effect", "vision"])) {
      throw new TypeError(`node ${nodeIndex} has an invalid collision role`);
    }
    for (const [shapeIndex, shapeCandidate] of shapes.entries()) {
      signal?.throwIfAborted();
      const label = `node ${nodeIndex} collision shape ${shapeIndex}`;
      const shape = object(shapeCandidate, label);
      if (!oneOf(shape["kind"], allowedKinds))
        throw new TypeError(`${label} has an invalid kind`);
      if (shape["matrix"] !== void 0 && !finiteArray(shape["matrix"], 16)) {
        throw new TypeError(`${label} has an invalid matrix`);
      }
      if (shape["collisionMask"] !== void 0 && (!integer(shape["collisionMask"]) || shape["collisionMask"] < 0)) {
        throw new TypeError(`${label} has an invalid collisionMask`);
      }
      if (shape["kind"] === "box" && (!finiteArray(shape["size"], 3) || shape["size"].some((value) => value <= 0))) {
        throw new TypeError(`${label} has invalid box extents`);
      }
      if (shape["kind"] === "sphere" && !(finite(shape["radius"]) && shape["radius"] > 0)) {
        throw new TypeError(`${label} has an invalid radius`);
      }
      if ((shape["kind"] === "capsule" || shape["kind"] === "cylinder") && (!(finite(shape["radius"]) && shape["radius"] > 0) || !(finite(shape["height"]) && shape["height"] > 0) || shape["axis"] !== void 0 && !oneOf(shape["axis"], ["x", "y", "z"]))) {
        throw new TypeError(`${label} has invalid dimensions or axis`);
      }
      if (shape["kind"] === "plane" && (!finiteArray(shape["normal"], 3) || Math.hypot(...shape["normal"]) <= 1e-12)) {
        throw new TypeError(`${label} has an invalid normal`);
      }
      if ((shape["kind"] === "convex-hull" || shape["kind"] === "mesh") && !integer(shape["positions"])) {
        throw new TypeError(`${label} has an invalid positions accessor`);
      }
      if (shape["kind"] === "mesh" && !integer(shape["indices"])) {
        throw new TypeError(`${label} has an invalid indices accessor`);
      }
    }
  }
  if (used.includes("UV_game_collision") && extensionCount === 0) {
    throw new TypeError("UV_game_collision is declared but absent from all nodes");
  }
}

// packages/uv/dist/model/validation/effects.js
function validateEffectsMetadata(document, used, signal) {
  signal?.throwIfAborted();
  const extension = field(document["extensions"], "UV_game_effects");
  if (extension === void 0) {
    if (used.includes("UV_game_effects"))
      throw new TypeError("UV_game_effects is declared but absent");
    return;
  }
  if (!used.includes("UV_game_effects")) {
    throw new TypeError("UV_game_effects is not declared in extensionsUsed");
  }
  const effects = object(extension, "UV_game_effects");
  if (effects["profile"] !== void 0 && !oneOf(effects["profile"], ["common", "m3", "mdx", "w3d"])) {
    throw new TypeError("UV_game_effects has an invalid profile");
  }
  if (effects["trackTimeUnit"] !== void 0 && !oneOf(effects["trackTimeUnit"], ["seconds", "milliseconds"])) {
    throw new TypeError("UV_game_effects has an invalid trackTimeUnit");
  }
  const nodes = array(document, "nodes");
  const materials = array(document, "materials");
  if (effects["spaceNode"] !== void 0)
    safeIndex(effects["spaceNode"], nodes.length, "UV_game_effects spaceNode");
  for (const kind of ["particles", "ribbons", "forces", "warps", "projectors"]) {
    const entries = effects[kind];
    if (entries === void 0)
      continue;
    if (!Array.isArray(entries))
      throw new TypeError(`UV_game_effects.${kind} must be an array`);
    for (const [index2, candidate] of entries.entries()) {
      signal?.throwIfAborted();
      const entry = object(candidate, `UV_game_effects ${kind} ${index2}`);
      if (!nonBlank(entry["name"]))
        throw new TypeError(`UV_game_effects ${kind} ${index2} needs a name`);
      safeIndex(entry["node"], nodes.length, `UV_game_effects ${kind} ${index2} node`);
      if (oneOf(kind, ["particles", "ribbons", "projectors"])) {
        safeIndex(entry["material"], materials.length, `UV_game_effects ${kind} ${index2} material`);
      }
      if (entry["maxParticles"] !== void 0 && (!integer(entry["maxParticles"]) || entry["maxParticles"] < 0)) {
        throw new RangeError(`UV_game_effects ${kind} ${index2} maxParticles is invalid`);
      }
      if (entry["lifecycleSize"] !== void 0) {
        const lifecycle = object(entry["lifecycleSize"], `UV_game_effects ${kind} ${index2} lifecycleSize`);
        if (!finiteArray(lifecycle["start"], 3) || !finiteArray(lifecycle["middle"], 3) || !finiteArray(lifecycle["end"], 3) || !finite(lifecycle["timeMiddle"])) {
          throw new TypeError(`UV_game_effects ${kind} ${index2} lifecycleSize is invalid`);
        }
      }
    }
  }
}

// packages/uv/dist/model/accessor.js
var componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
var componentCounts = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};
function uvmAccessorWidth(type) {
  return typeof type === "string" && Object.hasOwn(componentCounts, type) ? componentCounts[type] : void 0;
}
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function index(value, length, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}
function nonnegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function readComponent(view, offset, type) {
  if (type === 5121)
    return view.getUint8(offset);
  if (type === 5123)
    return view.getUint16(offset, true);
  if (type === 5125)
    return view.getUint32(offset, true);
  if (type === 5126)
    return view.getFloat32(offset, true);
  throw new TypeError(`unsupported UVM accessor component type ${String(type)}`);
}
function readUvmAccessor(document, binary, accessorIndex, budget, purpose, signal) {
  signal?.throwIfAborted();
  if (!nonnegativeInteger(budget.maxScalarBytes))
    throw new TypeError("invalid UVM scalar budget");
  const accessors = Array.isArray(document["accessors"]) ? document["accessors"] : [];
  const bufferViews = Array.isArray(document["bufferViews"]) ? document["bufferViews"] : [];
  const accessor = record(accessors[index(accessorIndex, accessors.length, purpose)], purpose);
  if (accessor["sparse"] !== void 0)
    throw new TypeError(`${purpose} sparse accessors are not supported`);
  const count = accessor["count"];
  const type = accessor["type"];
  const componentType = accessor["componentType"];
  const width = uvmAccessorWidth(type);
  const bytesPerComponent = typeof componentType === "number" ? componentBytes[componentType] : void 0;
  if (!nonnegativeInteger(count) || width === void 0 || bytesPerComponent === void 0 || typeof componentType !== "number")
    throw new TypeError(`${purpose} accessor shape is invalid`);
  const bufferView = record(bufferViews[index(accessor["bufferView"], bufferViews.length, `${purpose} bufferView`)], `${purpose} bufferView`);
  if ((bufferView["buffer"] ?? 0) !== 0)
    throw new TypeError(`${purpose} references an external buffer`);
  const viewOffset = bufferView["byteOffset"] ?? 0;
  const accessorOffset = accessor["byteOffset"] ?? 0;
  const elementBytes = width * bytesPerComponent;
  const stride = bufferView["byteStride"] ?? elementBytes;
  const viewLength = bufferView["byteLength"];
  if (!nonnegativeInteger(viewOffset) || !nonnegativeInteger(accessorOffset) || !nonnegativeInteger(viewLength) || !nonnegativeInteger(stride) || stride < elementBytes)
    throw new TypeError(`${purpose} buffer view range is invalid`);
  const scalarCount = count * width;
  if (!Number.isSafeInteger(scalarCount * 4) || scalarCount * 4 > budget.maxScalarBytes)
    throw new RangeError(`${purpose} exceeds maxScalarBytes budget`);
  const start = viewOffset + accessorOffset;
  const end = count === 0 ? start : start + (count - 1) * stride + elementBytes;
  const viewEnd = viewOffset + viewLength;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(viewEnd) || start < viewOffset || end > viewEnd || viewEnd > binary.byteLength)
    throw new RangeError(`${purpose} accessor exceeds the UVM BIN chunk`);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = purpose === "indices" ? new Uint32Array(scalarCount) : new Float32Array(scalarCount);
  for (let item = 0; item < count; item++) {
    if (item % 4096 === 0)
      signal?.throwIfAborted();
    const itemOffset = start + item * stride;
    for (let component = 0; component < width; component++)
      values[item * width + component] = readComponent(view, itemOffset + component * bytesPerComponent, componentType);
  }
  return Object.freeze({
    values,
    count,
    width,
    componentType,
    normalized: accessor["normalized"] === true
  });
}

// packages/uv/dist/model/key-times.js
function readUvmKeyTimes(value, input, signal) {
  if (value === void 0)
    return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid UVM keyTimes metadata");
  const record2 = value;
  if (record2["version"] !== 1 || Object.keys(record2).some((key) => !["version", "seconds"].includes(key)) || !Array.isArray(record2["seconds"]) || !record2["seconds"].length)
    throw new TypeError("UVM keyTimes requires version 1 and seconds");
  const seconds = record2["seconds"];
  if (input !== void 0 && (seconds.length !== input.values.length || seconds.length * 8 > input.maxScalarBytes))
    throw new RangeError("UVM keyTimes count or scalar budget mismatch");
  let previous = -Infinity;
  for (let index2 = 0; index2 < seconds.length; index2++) {
    signal?.throwIfAborted();
    const time = seconds[index2];
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time <= previous || input !== void 0 && Math.fround(time) !== input.values[index2])
      throw new TypeError("UVM keyTimes must increase and match the input accessor");
    previous = time;
  }
  return seconds;
}

// packages/uv/dist/model/validation/animation.js
function validateAnimationPointers(document, used, signal) {
  signal?.throwIfAborted();
  let count = 0;
  const accessors = array(document, "accessors");
  for (const [animationIndex, candidate] of array(document, "animations").entries()) {
    signal?.throwIfAborted();
    const animation = object(candidate, `animation ${animationIndex}`);
    const samplers = array(animation, "samplers");
    const animationUv = field(animation["extras"], "uv") === void 0 ? void 0 : object(field(animation["extras"], "uv"), `animation ${animationIndex} extras.uv`);
    const scope = animationUv?.["effectTrackScope"];
    const hasGlobalSeqId = Object.prototype.hasOwnProperty.call(animationUv ?? {}, "globalSeqId");
    if (scope !== void 0 && scope !== "global" && scope !== "absolute") {
      throw new TypeError(`animation ${animationIndex} effect track scope is invalid`);
    }
    if (scope === "global" && (!integer(animationUv?.["globalSeqId"]) || animationUv?.["globalSeqId"] < 0)) {
      throw new TypeError(`animation ${animationIndex} globalSeqId is invalid or missing`);
    }
    if (scope !== "global" && hasGlobalSeqId) {
      throw new TypeError(`animation ${animationIndex} globalSeqId needs global scope`);
    }
    if (animationUv?.["sourceSequenceIndex"] !== void 0 && (!integer(animationUv["sourceSequenceIndex"]) || animationUv["sourceSequenceIndex"] < 0)) {
      throw new TypeError(`animation ${animationIndex} sourceSequenceIndex is invalid`);
    }
    const targets = /* @__PURE__ */ new Set();
    for (const [channelIndex, channelCandidate] of array(animation, "channels").entries()) {
      signal?.throwIfAborted();
      const channel = object(channelCandidate, `animation ${animationIndex} channel ${channelIndex}`);
      const target = object(channel["target"], `animation ${animationIndex} channel target`);
      const exactTimes = readUvmKeyTimes(field(field(channel["extras"], "uv"), "keyTimes"), void 0, signal);
      if (exactTimes !== void 0) {
        const timeSampler = object(samplers[safeIndex(channel["sampler"], samplers.length, "keyTimes sampler")], "keyTimes sampler");
        const timeAccessor = object(accessors[safeIndex(timeSampler["input"], accessors.length, "keyTimes accessor")], "keyTimes accessor");
        if (timeAccessor["count"] !== exactTimes.length || timeAccessor["type"] !== "SCALAR" || timeAccessor["componentType"] !== 5126)
          throw new TypeError("UVM keyTimes accessor shape mismatch");
      }
      const extension = field(target["extensions"], "KHR_animation_pointer");
      if (target["path"] !== "pointer" && extension === void 0)
        continue;
      count += 1;
      const samplerIndex = safeIndex(channel["sampler"], samplers.length, `animation ${animationIndex} pointer sampler`);
      const sampler = object(samplers[samplerIndex], `animation ${animationIndex} pointer sampler`);
      const pointer = object(extension, `animation ${animationIndex} KHR_animation_pointer`);
      const pointerPath = pointer["pointer"];
      if (!safeAnimationPointer(pointerPath))
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`);
      const targetValue = resolvePointer(document, pointerPath);
      if (target["path"] !== "pointer" || targetValue === void 0) {
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`);
      }
      if (targets.has(pointerPath)) {
        throw new TypeError(`animation ${animationIndex} pointer target is duplicated`);
      }
      targets.add(pointerPath);
      const interpolation = sampler["interpolation"] ?? "LINEAR";
      if (!oneOf(interpolation, ["STEP", "LINEAR", "CUBICSPLINE"])) {
        throw new TypeError(`animation ${animationIndex} pointer interpolation is invalid`);
      }
      const channelUv = field(channel["extras"], "uv") === void 0 ? void 0 : object(field(channel["extras"], "uv"), `animation ${animationIndex} channel extras.uv`);
      const sourceLineType = channelUv?.["sourceLineType"];
      if (sourceLineType !== void 0 && (!integer(sourceLineType) || sourceLineType < 0 || sourceLineType > 3)) {
        throw new TypeError(`animation ${animationIndex} pointer sourceLineType is invalid`);
      }
      if (interpolation === "STEP" && sourceLineType !== void 0 && sourceLineType !== 0 || interpolation === "LINEAR" && sourceLineType !== void 0 && sourceLineType !== 1 || interpolation === "CUBICSPLINE" && sourceLineType !== void 0 && sourceLineType !== 2 && sourceLineType !== 3) {
        throw new TypeError(`animation ${animationIndex} pointer sourceLineType does not match interpolation`);
      }
      const inputIndex = safeIndex(sampler["input"], accessors.length, `animation ${animationIndex} pointer input`);
      const outputIndex = safeIndex(sampler["output"], accessors.length, `animation ${animationIndex} pointer output`);
      const input = object(accessors[inputIndex], `animation ${animationIndex} pointer input`);
      const output = object(accessors[outputIndex], `animation ${animationIndex} pointer output`);
      const targetWidth = finite(targetValue) ? 1 : Array.isArray(targetValue) && targetValue.length > 0 && targetValue.length <= 4 && targetValue.every(finite) ? targetValue.length : void 0;
      const multiplier = interpolation === "CUBICSPLINE" ? 3 : 1;
      if (targetWidth === void 0 || input["normalized"] === true || output["normalized"] === true || input["componentType"] !== 5126 || input["type"] !== "SCALAR" || !integer(input["count"]) || input["count"] <= 0 || output["componentType"] !== 5126 || uvmAccessorWidth(output["type"]) !== targetWidth || output["count"] !== input["count"] * multiplier) {
        throw new TypeError(`animation ${animationIndex} pointer accessor shape is invalid`);
      }
    }
  }
  if (count > 0 && !used.includes("KHR_animation_pointer")) {
    throw new TypeError("KHR_animation_pointer is not declared in extensionsUsed");
  }
  if (count === 0 && used.includes("KHR_animation_pointer")) {
    throw new TypeError("KHR_animation_pointer is declared but absent");
  }
}
function safeAnimationPointer(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.includes("\0") || /~(?![01])/u.test(pointer))
    return false;
  return !["/buffers", "/bufferViews", "/accessors"].some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`));
}
function resolvePointer(root, pointer) {
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token))
        return void 0;
      const index2 = Number(token);
      if (!integer(index2) || index2 >= current.length)
        return void 0;
      current = current[index2];
    } else if (current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return void 0;
    }
  }
  return current;
}

// packages/codec-kit/dist/legacy/models/material.js
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
  "teamColorMask"
];
function isStandardLayerSlot(value) {
  return LAYER_SLOTS.includes(value);
}

// packages/uv/dist/model/animation-materials.js
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
        const index2 = sequence["sequenceIndex"];
        if (!integer(index2) || index2 < 0 || index2 > 4294967295 || sequences.has(index2))
          throw new TypeError("invalid animation material sequence index");
        sequences.add(index2);
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

// packages/uv/dist/model/animation-clips.js
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
function uvmVisibilityPointer(index2) {
  if (!integer(index2) || index2 < 0)
    throw new TypeError("invalid visibility index");
  return `/extensions/UV_game_variants/visibility/${index2}/value`;
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
    const record2 = object(item, "UVM clip catalog entry");
    const id = record2["id"], name = record2["name"], duration = record2["durationSeconds"], sequence = record2["sourceSequenceIndex"];
    if (typeof id !== "string" || !id.trim() || ids.has(id) || typeof name !== "string" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || !integer(sequence) || sequence < 0 || sequences.has(sequence))
      throw new TypeError("UVM clip catalog identity, duration or sequence is invalid");
    const sourceId = record2["sourceId"], looping = record2["looping"], repeatCount = record2["repeatCount"], kind = record2["kind"], frames = record2["frames"];
    if (sourceId !== void 0 && (typeof sourceId !== "string" || !sourceId) || looping !== void 0 && typeof looping !== "boolean" || repeatCount !== void 0 && (!integer(repeatCount) || repeatCount < 0) || kind !== void 0 && kind !== "animation" && kind !== "rest-pose" || frames !== void 0 && (!integer(frames) || frames < 0))
      throw new TypeError("UVM clip catalog optional metadata is invalid");
    const animation = record2["animation"] === void 0 ? void 0 : safeIndex(record2["animation"], animations.length, "clip animation");
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
  for (const [index2, animation] of animations.entries()) {
    const scope = field(field(field(animation, "extras"), "uv"), "effectTrackScope");
    if (!linked.has(index2) && scope !== "absolute" && scope !== "global")
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

// packages/uv/dist/model/validation/materials.js
function validateGameMaterialMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let extensionCount = 0;
  for (const [materialIndex, candidate] of array(document, "materials").entries()) {
    signal?.throwIfAborted();
    const material = object(candidate, `material ${materialIndex}`);
    const extension = field(material["extensions"], "UV_game_material");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    const label = `material ${materialIndex} UV_game_material`;
    if (!used.includes("UV_game_material")) {
      throw new TypeError(`${label} is not declared in extensionsUsed`);
    }
    const gameMaterial = object(extension, label);
    if (!nonBlank(gameMaterial["shader"]))
      throw new TypeError(`${label} requires a shader identity`);
    const params = gameMaterial["params"] === void 0 ? {} : object(gameMaterial["params"], `${label} parameters`);
    const snapshot = params["renderModel"];
    if (snapshot === void 0)
      continue;
    const renderModel = object(snapshot, `${label} neutral snapshot`);
    if (renderModel["version"] !== 1) {
      throw new TypeError(`${label} neutral snapshot has an unsupported version`);
    }
    if (renderModel["standard"] === void 0 && renderModel["composite"] === void 0) {
      throw new TypeError(`${label} neutral snapshot has no material payload`);
    }
    if (renderModel["standard"] !== void 0) {
      object(renderModel["standard"], `${label} standard material`);
    }
    if (renderModel["composite"] !== void 0) {
      object(renderModel["composite"], `${label} composite material`);
    }
  }
  if (used.includes("UV_game_material") && extensionCount === 0) {
    throw new TypeError("UV_game_material is declared but absent");
  }
}
function validateTeamColorMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let extensionCount = 0;
  for (const [materialIndex, candidate] of array(document, "materials").entries()) {
    signal?.throwIfAborted();
    const material = object(candidate, `material ${materialIndex}`);
    const extension = field(material["extensions"], "UV_game_material_team_color");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    const label = `material ${materialIndex} UV_game_material_team_color`;
    if (!used.includes("UV_game_material_team_color")) {
      throw new TypeError(`${label} is not declared in extensionsUsed`);
    }
    const teamColor = object(extension, label);
    if (!oneOf(teamColor["maskSource"], ["texture", "vertexColor", "paletteRange", "whole"])) {
      throw new TypeError(`${label} has an invalid maskSource`);
    }
    if (teamColor["blend"] !== void 0 && !oneOf(teamColor["blend"], ["multiply", "add", "replace", "overlay", "lerp"])) {
      throw new TypeError(`${label} has an invalid blend`);
    }
    if (teamColor["targets"] !== void 0 && (!Array.isArray(teamColor["targets"]) || teamColor["targets"].length === 0 || teamColor["targets"].some((target) => !oneOf(target, ["baseColor", "emissive", "specular"])) || new Set(teamColor["targets"]).size !== teamColor["targets"].length)) {
      throw new TypeError(`${label} has invalid targets`);
    }
    if (teamColor["strength"] !== void 0 && (!finite(teamColor["strength"]) || teamColor["strength"] < 0)) {
      throw new TypeError(`${label} has an invalid strength`);
    }
    const renderModel = field(teamColor["extras"], "renderModel");
    if (renderModel !== void 0) {
      const remap = object(renderModel, `${label} neutral remap`);
      if (remap["target"] !== "team-color" || !oneOf(remap["operation"], ["replace", "multiply", "hsv-shade", "grain-merge"])) {
        throw new TypeError(`${label} has invalid neutral remap metadata`);
      }
    }
  }
  if (used.includes("UV_game_material_team_color") && extensionCount === 0) {
    throw new TypeError("UV_game_material_team_color is declared but absent");
  }
}

// packages/uv/dist/model/validation/index.js
function validateUvmDocument(document, options = {}) {
  const { binaryByteLength, signal } = options;
  signal?.throwIfAborted();
  if (binaryByteLength !== void 0 && (!integer(binaryByteLength) || binaryByteLength < 0))
    throw new TypeError("invalid UVM binary byte length");
  const asset = object(document["asset"], "UVM asset");
  if (asset["version"] !== "2.0")
    throw new TypeError("UVM asset.version must be 2.0");
  const uv = object(object(asset["extras"], "UVM asset.extras")["uv"], "UVM profile marker");
  if (uv["format"] !== "UVM" || uv["version"] !== "1.0" || uv["profile"] !== "core") {
    throw new TypeError("asset.extras.uv must identify the UVM/core 1.0 profile");
  }
  const used = array(document, "extensionsUsed");
  for (const required of ["UV_asset", "UV_provenance"]) {
    if (!used.includes(required))
      throw new TypeError(`${required} is not declared in extensionsUsed`);
  }
  if (array(document, "extensionsRequired").some((id) => String(id).startsWith("UV_"))) {
    throw new TypeError("UVM/core must not require a UV extension for base rendering");
  }
  const extensions = object(document["extensions"], "UVM extensions");
  const identity = object(extensions["UV_asset"], "UV_asset");
  if (!nonBlank(identity["id"]) || !nonBlank(identity["class"])) {
    throw new TypeError("UV_asset requires non-empty id and class");
  }
  const provenance = object(extensions["UV_provenance"], "UV_provenance");
  const source = object(provenance["source"], "UV_provenance.source");
  const importer = object(provenance["importer"], "UV_provenance.importer");
  if (!nonBlank(source["format"]) || !nonBlank(importer["id"]) || !nonBlank(importer["version"])) {
    throw new TypeError("UV_provenance requires source format and importer coordinate");
  }
  if (extensions["UV_source_blob"] !== void 0 || used.includes("UV_source_blob"))
    throw new TypeError("UVM source blobs are not supported; project data into common facets or a bounded format residual");
  validateCollisionMetadata(document, used, signal);
  validateSocketMetadata(document, used, signal);
  validateTeamColorMetadata(document, used, signal);
  validateGameMaterialMetadata(document, used, signal);
  validateEffectsMetadata(document, used, signal);
  validateAnimationPointers(document, used, signal);
  validateUvmAnimationClips(document, signal);
}

export {
  uvmAccessorWidth,
  readUvmAccessor,
  object,
  array,
  isStandardLayerSlot,
  readUvmAnimationMaterialTargets,
  readUvmPrimitiveVisibility,
  uvmVisibilityPointer,
  uvmVisibilityTarget,
  readUvmAnimationClips,
  readUvmKeyTimes,
  validateUvmDocument
};
