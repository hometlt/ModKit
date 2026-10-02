import {
  RENDER_MATERIAL_SHADER,
  UVM_GAME_MODEL_STATES,
  UVM_MODEL_SHADOW_MESHES,
  UVM_NODE_BILLBOARD,
  addUvmShadowMeshes,
  createRenderMaterialSampler,
  readUvmBillboards,
  readUvmModelStates,
  readUvmShadowMeshBindings
} from "../../../chunks/chunk-W6WJ2KXN.js";
import "../../../chunks/chunk-WGWMBNZ4.js";
import {
  array,
  field,
  object,
  required,
  safeIndex
} from "../../../chunks/chunk-I4Z5J3HX.js";
import "../../../chunks/chunk-YOXPMEYX.js";
import {
  readUvmAccessor,
  readUvmAnimationClips,
  readUvmAnimationMaterialTargets,
  readUvmPrimitiveVisibility,
  uvmVisibilityPointer,
  uvmVisibilityTarget,
  validateUvmDocument
} from "../../../chunks/chunk-WXNMUTNG.js";
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  readUvmContainer,
  writeUvmContainer
} from "../../../chunks/chunk-NONHW3HK.js";
import "../../../chunks/chunk-I675VFQQ.js";
import "../../../chunks/chunk-YOJ4JJ3G.js";
import {
  snapshotJson
} from "../../../chunks/chunk-ZSDVUSRM.js";
import "../../../chunks/chunk-5SBJANAJ.js";
import "../../../chunks/chunk-TSKCLN7F.js";
import {
  applyJsonEdit
} from "../../../chunks/chunk-UDFSUVGJ.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/scene/dist/uvm/json-edit.js
var applyUvmJsonEdit = applyJsonEdit;

// ../MODDING/modkit-core/packages/scene/dist/uvm/document.js
var encoder = new TextEncoder();
function openUvmDocument(bytes, options = {}) {
  const budget = Object.freeze({ ...options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET });
  checkUvmContainerBudget(budget);
  const maxHistoryEntries = options.maxHistoryEntries ?? 100;
  const maxHistoryBytes = options.maxHistoryBytes ?? 536870912;
  const maxEdits = options.maxEdits ?? 4096;
  const resettable = options.resettable ?? false;
  if (typeof resettable !== "boolean")
    throw new TypeError("invalid UVM reset option");
  for (const limit of [maxHistoryEntries, maxHistoryBytes, maxEdits])
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError("invalid UVM document limit");
  const signal = options.signal;
  const validate = options.validate;
  let disposed = false;
  const checkAlive = () => {
    if (disposed)
      throw new TypeError("UVM document is disposed");
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
  };
  checkAlive();
  if (bytes.byteLength > budget.maxInputBytes)
    throw new RangeError("UVM exceeds maxInputBytes");
  const originalBytes = Uint8Array.from(bytes);
  const container = readUvmContainer(originalBytes, budget, signal);
  const ownView = (value) => Object.freeze({
    ...value,
    binary: Uint8Array.from(value.binary),
    extraChunks: Object.freeze(value.extraChunks.map((chunk) => Object.freeze({
      type: chunk.type,
      bytes: Uint8Array.from(chunk.bytes)
    })))
  });
  const validateState = (value) => {
    const asset = value.document["asset"];
    if (asset === null || typeof asset !== "object" || Array.isArray(asset) || asset["version"] !== "2.0")
      throw new TypeError("UVM requires glTF asset.version 2.0");
    validate?.(ownView(value));
    checkAlive();
  };
  validateState(container);
  const sizeOf = (value) => encoder.encode(JSON.stringify(value.document)).length + value.binary.byteLength + value.extraChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0);
  let current = {
    id: 0,
    container,
    originalBytes,
    size: sizeOf(container) + originalBytes.length
  };
  if (current.size > maxHistoryBytes)
    throw new RangeError("UVM document exceeds maxHistoryBytes");
  let resetState = resettable ? current : void 0;
  let revision = 0;
  let nextStateId = 1;
  const undo = [];
  const redo = [];
  const currentState = () => {
    checkAlive();
    if (current === void 0)
      throw new TypeError("UVM document is disposed");
    return current;
  };
  const retainedBytes = () => {
    const states = /* @__PURE__ */ new Set([currentState(), ...undo, ...redo]);
    if (resetState !== void 0)
      states.add(resetState);
    let bytes2 = 0;
    for (const state of states)
      bytes2 += state.size;
    return bytes2;
  };
  const status = () => {
    checkAlive();
    return Object.freeze({
      revision,
      modified: currentState().id !== 0,
      canUndo: undo.length > 0,
      canRedo: redo.length > 0,
      retainedBytes: retainedBytes()
    });
  };
  const checkRevision = (expected) => {
    checkAlive();
    if (!Number.isSafeInteger(expected) || expected !== revision)
      throw new TypeError("stale UVM document revision");
    if (revision === Number.MAX_SAFE_INTEGER)
      throw new RangeError("UVM document revision exhausted");
    return currentState();
  };
  const prune = () => {
    while (undo.length > 0 && (undo.length > maxHistoryEntries || retainedBytes() > maxHistoryBytes))
      undo.shift();
  };
  const commit = (before, expected, candidate) => {
    validateState(candidate);
    writeUvmContainer(candidate, budget, signal);
    checkRevision(expected);
    const size = sizeOf(candidate);
    if (size + (resetState?.size ?? 0) > maxHistoryBytes)
      throw new RangeError("UVM document exceeds maxHistoryBytes");
    undo.push(before);
    redo.length = 0;
    current = { id: nextStateId++, container: candidate, size };
    revision++;
    prune();
    return status();
  };
  return Object.freeze({
    status,
    snapshot: () => {
      checkAlive();
      return ownView(currentState().container);
    },
    apply: (edit) => {
      const expected = edit.expectedRevision;
      const before = checkRevision(expected);
      const json = edit.json ?? [];
      const binary = edit.binary ?? [];
      if (json.length + binary.length > maxEdits)
        throw new RangeError("UVM edit batch exceeds maxEdits");
      if (json.length + binary.length === 0)
        return status();
      let document = before.container.document;
      for (const change of json) {
        checkAlive();
        const owned = snapshotJson(change, {
          maxDepth: budget.maxDepth + 2,
          maxNodes: budget.maxNodes,
          maxBytes: budget.maxJsonBytes
        }, signal);
        document = snapshotJson(applyUvmJsonEdit(document, owned, budget.maxDepth), { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
      }
      const ranges = binary.map((change) => {
        const start = change.byteOffset;
        const end = start + change.bytes.byteLength;
        if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end > before.container.binary.length)
          throw new RangeError("UVM binary edit exceeds the BIN chunk");
        return { start, end, bytes: change.bytes };
      }).sort((a, b) => a.start - b.start);
      let previousEnd = 0;
      for (const range of ranges) {
        if (range.start < previousEnd)
          throw new TypeError("overlapping UVM binary edits");
        previousEnd = range.end;
      }
      const nextBinary = ranges.length ? Uint8Array.from(before.container.binary) : before.container.binary;
      for (const range of ranges)
        nextBinary.set(range.bytes, range.start);
      const candidate = Object.freeze({ ...before.container, document, binary: nextBinary });
      return commit(before, expected, candidate);
    },
    replace: (replacement) => {
      const expected = replacement.expectedRevision;
      const before = checkRevision(expected);
      const candidate = readUvmContainer(writeUvmContainer(replacement.container, budget, signal), budget, signal);
      return commit(before, expected, candidate);
    },
    undo: (expected) => {
      const before = checkRevision(expected);
      const previous = undo.pop();
      if (previous === void 0)
        return status();
      redo.push(before);
      current = previous;
      revision++;
      return status();
    },
    redo: (expected) => {
      const before = checkRevision(expected);
      const next = redo.pop();
      if (next === void 0)
        return status();
      undo.push(before);
      current = next;
      revision++;
      return status();
    },
    reset: (expected) => {
      const before = checkRevision(expected);
      if (resetState === void 0)
        throw new TypeError("UVM document reset was not enabled");
      if (before === resetState && undo.length === 0 && redo.length === 0)
        return status();
      current = resetState;
      undo.length = 0;
      redo.length = 0;
      revision++;
      return status();
    },
    serialize: (expected) => {
      const state = checkRevision(expected);
      return state.originalBytes ? Uint8Array.from(state.originalBytes) : writeUvmContainer(state.container, budget, signal);
    },
    dispose: () => {
      disposed = true;
      current = void 0;
      resetState = void 0;
      undo.length = 0;
      redo.length = 0;
    }
  });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/conversion-cache.js
function createUvmConversionCache(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("invalid UVM conversion cache byte limit");
  let entry;
  return Object.freeze({
    get(key, signal) {
      signal?.throwIfAborted();
      return entry?.key === key ? Uint8Array.from(entry.bytes) : void 0;
    },
    set(key, bytes, signal) {
      signal?.throwIfAborted();
      entry = bytes.byteLength <= maxBytes ? { key, bytes: Uint8Array.from(bytes) } : void 0;
    },
    clear() {
      entry = void 0;
    }
  });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/animation-materials.js
var layerProperties = [
  "constantColor",
  "colorMultiply",
  "colorAdd",
  "alphaFactor",
  "uvOffset",
  "uvAngle",
  "uvTiling",
  "uvTriplanarOffset",
  "uvTriplanarScale"
];
var escape = (value) => value.replace(/~/gu, "~0").replace(/\//gu, "~1");
function properties(params) {
  const result = /* @__PURE__ */ new Map();
  const add = (candidate, path) => {
    if (candidate !== void 0)
      result.set(path, object(candidate, "animated material property"));
  };
  const standard = (candidate, path) => {
    const material = object(candidate, "standard material");
    add(material["parallaxHeight"], `${path}/parallaxHeight`);
    for (const [index, value] of array(material, "normalBlendFactors").entries())
      add(value, `${path}/normalBlendFactors/${index}`);
    for (const [slot, value] of Object.entries(object(material["layers"], "material layers"))) {
      const layer = object(value, "material layer");
      const prefix = `${path}/layers/${escape(slot)}`;
      for (const key of layerProperties)
        add(layer[key], `${prefix}/${key}`);
      add(field(layer["flipbook"], "frame"), `${prefix}/flipbook/frame`);
    }
  };
  const model = object(params["renderModel"], "render model");
  if (model["standard"] !== void 0)
    standard(model["standard"], "/renderModel/standard");
  for (const [index, candidate] of array(model["composite"], "passes").entries()) {
    const pass = object(candidate, "material pass");
    standard(pass["material"], `/renderModel/composite/passes/${index}/material`);
    add(pass["alphaFactor"], `/renderModel/composite/passes/${index}/alphaFactor`);
  }
  return result;
}
function attachMaterialSequences(source, target, sequenceMap, materialMap, budget, signal) {
  let result = target;
  const targetMaterials = array(target, "materials");
  const usedTargets = /* @__PURE__ */ new Set();
  const sources = [];
  for (const [index, candidate] of array(source, "materials").entries()) {
    signal?.throwIfAborted();
    const extension = field(field(candidate, "extensions"), "UV_game_material");
    if (field(extension, "shader") !== RENDER_MATERIAL_SHADER)
      continue;
    const params = object(field(extension, "params"), "source material params");
    createRenderMaterialSampler(params, budget, signal);
    sources.push({ key: `material:${index}`, properties: properties(params) });
  }
  for (const [index, target2] of readUvmAnimationMaterialTargets(source, signal).entries())
    sources.push({
      key: `animation-target:${index}`,
      properties: new Map(target2.properties.map((property) => [
        property.path,
        { value: property.value, sequenceTracks: property.sequenceTracks }
      ]))
    });
  for (const source2 of sources) {
    const selected = [...source2.properties].map(([path, property]) => ({
      path,
      property,
      tracks: array(property, "sequenceTracks").filter((track) => sequenceMap.has(Number(field(track, "sequenceIndex"))))
    })).filter((item) => item.tracks.length > 0);
    if (selected.length === 0)
      continue;
    const mapped = materialMap.get(source2.key);
    if (mapped === void 0)
      throw new TypeError(`animation attachment lacks material mapping for ${source2.key}`);
    safeIndex(mapped, targetMaterials.length, "attachment material");
    const targetExtension = object(field(field(array(result, "materials")[mapped], "extensions"), "UV_game_material"), "target material extension");
    if (targetExtension["shader"] !== RENDER_MATERIAL_SHADER)
      throw new TypeError("attachment material shaders differ");
    let targetParams = object(targetExtension["params"], "target material params");
    createRenderMaterialSampler(targetParams, budget, signal);
    const targetProperties = properties(targetParams);
    for (const { path, property, tracks } of selected) {
      const targetProperty = targetProperties.get(path);
      if (targetProperty === void 0)
        throw new TypeError(`attachment material property is absent: ${path}`);
      const sourceValue = property["value"], targetValue = targetProperty["value"];
      if ((Array.isArray(sourceValue) ? sourceValue.length : 1) !== (Array.isArray(targetValue) ? targetValue.length : 1))
        throw new TypeError("attachment material property widths differ");
      const key = `${mapped}${path}`;
      if (usedTargets.has(key))
        throw new TypeError("multiple attachment materials write the same property");
      usedTargets.add(key);
      if (targetProperty["sequenceTracks"] === void 0 && targetProperty["track"] !== void 0)
        throw new TypeError("attachment requires explicit sequenceTracks for a target with a legacy fallback track");
      const existing = [...array(targetProperty, "sequenceTracks")];
      const sequences = new Set(existing.map((track) => field(track, "sequenceIndex")));
      for (const value of tracks) {
        const track = object(value, "material sequence track");
        const sequenceIndex = sequenceMap.get(Number(track["sequenceIndex"]));
        if (sequenceIndex === void 0 || sequences.has(sequenceIndex))
          throw new TypeError("attachment material sequence collision");
        sequences.add(sequenceIndex);
        existing.push({ ...track, sequenceIndex });
      }
      targetParams = applyUvmJsonEdit(targetParams, { op: "replace", path, value: { ...targetProperty, sequenceTracks: existing } }, budget.maxDepth);
    }
    createRenderMaterialSampler(targetParams, budget, signal);
    result = applyUvmJsonEdit(result, {
      op: "replace",
      path: `/materials/${mapped}/extensions/UV_game_material/params`,
      value: targetParams
    }, budget.maxDepth);
  }
  return result;
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/animation-attachment.js
function nonnegative(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new TypeError(`${label} must be a nonnegative integer`);
  return value;
}
function name(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be nonempty`);
  return value;
}
function list(value, label) {
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array`);
  return value;
}
function fields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new TypeError("unknown animation attachment field");
}
function pointerValue(document, pointer, maxDepth) {
  if (!pointer.startsWith("/") || /~(?:[^01]|$)/u.test(pointer))
    throw new TypeError("invalid animation pointer");
  const tokens = pointer.slice(1).split("/");
  if (tokens.length > maxDepth || ["buffers", "bufferViews", "accessors"].includes(tokens[0] ?? ""))
    throw new TypeError("animation pointer addresses storage or exceeds depth");
  let value = document;
  for (const token of tokens) {
    const key = token.replace(/~1/gu, "/").replace(/~0/gu, "~");
    value = Array.isArray(value) ? required(value[safeIndex(/^(0|[1-9]\d*)$/u.test(key) ? Number(key) : NaN, value.length, "pointer")], "pointer") : required(object(value, "pointer parent")[key], "pointer");
  }
  if (typeof value === "number" && Number.isFinite(value))
    return value;
  if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((item) => typeof item === "number" && Number.isFinite(item)))
    return value;
  throw new TypeError("animation pointer must target a numeric scalar or vector");
}
function noIndexedExtensions(value, label) {
  if (Object.keys(object(value["extensions"] ?? {}, `${label} extensions`)).length > 0)
    throw new TypeError(`${label} has extension indices without an attachment remapping policy`);
}
async function composeUvmAnimationBundle(base, bundle, request, options = {}) {
  const signal = options.signal;
  signal?.throwIfAborted();
  const budget = Object.freeze({ ...options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET });
  const maxWorkingBytes = nonnegative(options.maxWorkingBytes ?? 536870912, "attachment maxWorkingBytes");
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes
  };
  const input = object(snapshotJson(request, jsonBudget, signal), "animation attachment");
  fields(input, ["id", "clips", "nodes", "materials", "primitives", "pointers"]);
  const id = name(input["id"], "attachment id");
  let workingBytes = 0;
  const reserve = (bytes) => {
    workingBytes += bytes;
    if (!Number.isSafeInteger(workingBytes) || workingBytes > maxWorkingBytes)
      throw new RangeError("animation attachment exceeds maxWorkingBytes");
  };
  reserve(base.binary.byteLength + bundle.binary.byteLength);
  const baseBytes = writeUvmContainer(base, budget, signal);
  const sourceBytes = writeUvmContainer(bundle, budget, signal);
  reserve((baseBytes.length + sourceBytes.length) * 3);
  const ownedBase = readUvmContainer(baseBytes, budget, signal);
  const ownedBundle = readUvmContainer(sourceBytes, budget, signal);
  await Promise.resolve();
  signal?.throwIfAborted();
  if (ownedBase.format !== "glb" || ownedBundle.format !== "glb")
    throw new TypeError("animation attachment requires embedded UVM GLB containers");
  for (const container of [ownedBase, ownedBundle]) {
    validateUvmDocument(container.document, {
      binaryByteLength: container.binary.length,
      ...signal === void 0 ? {} : { signal }
    });
    const buffers = array(container.document, "buffers");
    const buffer = object(buffers[0] ?? { byteLength: 0 }, "embedded buffer");
    const length = nonnegative(buffer["byteLength"], "embedded buffer length");
    if (buffers.length > 1 || buffer["uri"] !== void 0 || length > container.binary.length || container.binary.length - length > 3)
      throw new TypeError("attachment storage must be a single embedded BIN buffer");
  }
  const source = ownedBundle.document;
  let document = ownedBase.document;
  const existingAttachments = array(field(document["extensions"], "UV_game_animation_clips"), "attachments");
  if (existingAttachments.some((item) => field(item, "id") === id))
    throw new TypeError("animation attachment id already exists");
  const decoded = /* @__PURE__ */ new Map();
  const read = (container, index) => {
    const accessorIndex = safeIndex(index, array(container.document, "accessors").length, "attachment accessor");
    const cached = decoded.get(container) ?? /* @__PURE__ */ new Map();
    decoded.set(container, cached);
    const old = cached.get(accessorIndex);
    if (old !== void 0)
      return old;
    const value = readUvmAccessor(container.document, container.binary, accessorIndex, { maxScalarBytes: maxWorkingBytes - workingBytes }, "animation attachment", signal);
    reserve(value.values.byteLength);
    if (!value.values.every(Number.isFinite))
      throw new TypeError("animation attachment has non-finite samples");
    cached.set(accessorIndex, value);
    return value;
  };
  const catalog = (container) => {
    const declared = readUvmAnimationClips(container.document, signal);
    if (declared !== void 0)
      return declared;
    return array(container.document, "animations").flatMap((candidate2, index) => {
      const animation = object(candidate2, "legacy animation");
      const metadata = object(field(animation["extras"], "uv") ?? {}, "animation metadata");
      if (metadata["effectTrackScope"] === "absolute" || metadata["effectTrackScope"] === "global")
        return [];
      let duration = 0;
      const frames = /* @__PURE__ */ new Set();
      for (const sampler of array(animation, "samplers")) {
        const time = read(container, field(sampler, "input"));
        if (time.width !== 1 || time.componentType !== 5126 || time.normalized || time.count === 0)
          throw new TypeError("animation time must be nonempty float SCALAR");
        let previous = -Infinity;
        for (const value of time.values) {
          if (value < 0 || value <= previous)
            throw new TypeError("animation times must increase");
          previous = value;
          duration = Math.max(duration, value);
          frames.add(value);
        }
      }
      const declaredDuration = metadata["sourceDurationSeconds"];
      if (declaredDuration !== void 0) {
        if (typeof declaredDuration !== "number" || !Number.isFinite(declaredDuration) || declaredDuration < 0)
          throw new TypeError("invalid source animation duration");
        duration = declaredDuration;
      }
      const looping = metadata["looping"];
      if (looping !== void 0 && typeof looping !== "boolean")
        throw new TypeError("invalid animation looping");
      const repeatCount = metadata["repeatCount"];
      if (repeatCount !== void 0 && (typeof repeatCount !== "number" || !Number.isSafeInteger(repeatCount) || repeatCount < 0))
        throw new TypeError("invalid animation repeat count");
      return [
        {
          id: `animation-${index}`,
          name: typeof animation["name"] === "string" ? animation["name"] : "",
          animation: index,
          durationSeconds: duration,
          sourceSequenceIndex: nonnegative(metadata["sourceSequenceIndex"] ?? index, "source sequence", 4294967295),
          kind: frames.size > 1 ? "animation" : "rest-pose",
          frames: frames.size,
          ...looping === void 0 ? {} : { looping },
          ...repeatCount === void 0 ? {} : { repeatCount }
        }
      ];
    });
  };
  const baseCatalog = catalog(ownedBase), sourceCatalog = catalog(ownedBundle);
  const rawCatalog = (doc) => new Map(array(field(doc["extensions"], "UV_game_animation_clips"), "clips").map((value) => {
    const entry = object(value, "catalog record");
    return [name(entry["id"], "catalog id"), entry];
  }));
  const baseRecords = rawCatalog(document), sourceRecords = rawCatalog(source);
  const sourceById = new Map(sourceCatalog.map((clip) => [clip.id, clip]));
  const clips = list(input["clips"], "attachment clips");
  if (clips.length === 0)
    throw new TypeError("attachment requires selected clips");
  const ids = new Set(baseCatalog.map((clip) => clip.id)), sequences = new Set(baseCatalog.map((clip) => clip.sourceSequenceIndex));
  const sequenceMap = /* @__PURE__ */ new Map();
  const selected = clips.map((candidate2) => {
    const entry = object(candidate2, "attachment clip");
    fields(entry, ["sourceId", "id", "sequenceIndex"]);
    const sourceId = name(entry["sourceId"], "source clip id"), targetId = name(entry["id"], "destination clip id");
    const sequenceIndex = nonnegative(entry["sequenceIndex"], "destination sequence", 4294967295);
    const clip = sourceById.get(sourceId);
    if (clip === void 0)
      throw new TypeError(`unknown attachment source clip: ${sourceId}`);
    if (ids.has(targetId) || sequences.has(sequenceIndex) || sequenceMap.has(clip.sourceSequenceIndex))
      throw new TypeError("animation attachment has duplicate clip or sequence identities");
    ids.add(targetId);
    sequences.add(sequenceIndex);
    sequenceMap.set(clip.sourceSequenceIndex, sequenceIndex);
    return { clip, id: targetId, sequenceIndex };
  });
  const indexMap = (key) => {
    const result2 = /* @__PURE__ */ new Map();
    for (const value of list(input[key], key)) {
      const item = object(value, key);
      fields(item, ["source", "target"]);
      const from = safeIndex(item["source"], array(source, key).length, `source ${key}`);
      const to = safeIndex(item["target"], array(document, key).length, `destination ${key}`);
      if (result2.has(from))
        throw new TypeError(`duplicate ${key} mapping`);
      result2.set(from, to);
    }
    return result2;
  };
  const nodeMap = indexMap("nodes");
  const materialMap = /* @__PURE__ */ new Map();
  for (const candidate2 of list(input["materials"], "material mappings")) {
    const item = object(candidate2, "material mapping");
    fields(item, ["source", "target", "sourceKind"]);
    const kind = item["sourceKind"] ?? "material";
    if (kind !== "material" && kind !== "animation-target")
      throw new TypeError("unknown attachment material source kind");
    const count = kind === "material" ? array(source, "materials").length : readUvmAnimationMaterialTargets(source, signal).length;
    const from = safeIndex(item["source"], count, "source material target");
    const to = safeIndex(item["target"], array(document, "materials").length, "destination material");
    const key = `${kind}:${from}`;
    if (materialMap.has(key))
      throw new TypeError("duplicate material mapping");
    materialMap.set(key, to);
  }
  const primitiveMap = /* @__PURE__ */ new Map();
  const primitiveTarget = (value, doc) => {
    const item = object(value, "primitive target");
    fields(item, ["mesh", "primitive"]);
    const meshes = array(doc, "meshes");
    const mesh = safeIndex(item["mesh"], meshes.length, "target mesh");
    return {
      mesh,
      primitive: safeIndex(item["primitive"], array(meshes[mesh], "primitives").length, "target primitive")
    };
  };
  for (const value of list(input["primitives"], "primitive mappings")) {
    const item = object(value, "primitive mapping");
    fields(item, ["source", "target"]);
    const from = primitiveTarget(item["source"], source), to = primitiveTarget(item["target"], document);
    const key = `${from.mesh}/${from.primitive}`;
    if (primitiveMap.has(key))
      throw new TypeError("duplicate primitive mapping");
    primitiveMap.set(key, to);
  }
  const pointerMap = /* @__PURE__ */ new Map();
  for (const value of list(input["pointers"], "pointer mappings")) {
    const item = object(value, "pointer mapping");
    fields(item, ["source", "target"]);
    const from = name(item["source"], "source pointer"), to = name(item["target"], "target pointer");
    const a = pointerValue(source, from, budget.maxDepth), b = pointerValue(document, to, budget.maxDepth);
    if ((Array.isArray(a) ? a.length : 1) !== (Array.isArray(b) ? b.length : 1) || pointerMap.has(from))
      throw new TypeError("pointer mapping width differs or source repeats");
    pointerMap.set(from, to);
  }
  const sourceVisibility = readUvmPrimitiveVisibility(source, signal);
  const visibility = [...readUvmPrimitiveVisibility(document, signal)];
  const animations = [...array(document, "animations")];
  const views = [...array(document, "bufferViews")], accessors = [...array(document, "accessors")];
  const viewMap = /* @__PURE__ */ new Map(), accessorMap = /* @__PURE__ */ new Map();
  const chunks = [];
  let binaryLength = ownedBase.binary.length;
  const copyAccessor = (index) => {
    const from = safeIndex(index, array(source, "accessors").length, "source accessor");
    const cached = accessorMap.get(from);
    if (cached !== void 0)
      return cached;
    read(ownedBundle, from);
    const accessor = object(array(source, "accessors")[from], "source accessor");
    noIndexedExtensions(accessor, "accessor");
    const viewIndex = safeIndex(accessor["bufferView"], array(source, "bufferViews").length, "source view");
    let mapped = viewMap.get(viewIndex);
    if (mapped === void 0) {
      const view = object(array(source, "bufferViews")[viewIndex], "source view");
      noIndexedExtensions(view, "bufferView");
      const offset = nonnegative(view["byteOffset"] ?? 0, "view offset"), length = nonnegative(view["byteLength"], "view length");
      if (offset + length > ownedBundle.binary.length)
        throw new RangeError("attachment view exceeds BIN");
      binaryLength = Math.ceil(binaryLength / 4) * 4;
      reserve(length * 2);
      chunks.push({
        offset: binaryLength,
        bytes: ownedBundle.binary.subarray(offset, offset + length)
      });
      mapped = views.length;
      viewMap.set(viewIndex, mapped);
      views.push({ ...view, buffer: 0, byteOffset: binaryLength });
      binaryLength += length;
      if (binaryLength > budget.maxInputBytes)
        throw new RangeError("attachment BIN exceeds maxInputBytes");
    }
    const mappedAccessor = accessors.length;
    accessors.push({ ...accessor, bufferView: mapped });
    accessorMap.set(from, mappedAccessor);
    return mappedAccessor;
  };
  const playbackLimitations = /* @__PURE__ */ new Set();
  const appended = [];
  const appendedRecords = [];
  let pointerUsed = false;
  let eventsUsed = false;
  for (const { clip, id: clipId, sequenceIndex } of selected) {
    signal?.throwIfAborted();
    let animationIndex;
    if (clip.animation !== void 0) {
      const sourceAnimation = object(array(source, "animations")[clip.animation], "source animation");
      const { extensions: animationExtensions, ...withoutExtensions } = sourceAnimation;
      const { UV_game_animation_clips: playback, UV_game_animation_events: events, ...others } = object(animationExtensions ?? {}, "source animation extensions");
      noIndexedExtensions({ extensions: others }, "animation");
      const mappedEvents = events === void 0 ? void 0 : {
        events: array(events, "events").map((value) => {
          const event = object(value, "source animation event");
          const socket = event["socket"];
          return socket === void 0 ? event : {
            ...event,
            socket: required(nodeMap.get(safeIndex(socket, array(source, "nodes").length, "event node")), `explicit node mapping for ${String(socket)}`)
          };
        })
      };
      if (mappedEvents !== void 0)
        eventsUsed = true;
      const animation = {
        ...withoutExtensions,
        ...playback === void 0 && mappedEvents === void 0 ? {} : {
          extensions: {
            ...playback === void 0 ? {} : { UV_game_animation_clips: playback },
            ...mappedEvents === void 0 ? {} : { UV_game_animation_events: mappedEvents }
          }
        }
      };
      const samplers = array(animation, "samplers").map((value) => {
        const sampler = object(value, "source sampler");
        noIndexedExtensions(sampler, "animation sampler");
        const time = read(ownedBundle, sampler["input"]);
        const output = read(ownedBundle, sampler["output"]);
        if (time.width !== 1 || time.componentType !== 5126 || time.normalized || time.count === 0 || output.componentType !== 5126 || output.normalized)
          throw new TypeError("attachment animation requires float accessors");
        let previous = -Infinity;
        for (const value2 of time.values) {
          if (value2 < 0 || value2 <= previous)
            throw new TypeError("attachment times must increase");
          previous = value2;
        }
        const interpolation = sampler["interpolation"] ?? "LINEAR";
        if (!["STEP", "LINEAR", "CUBICSPLINE"].includes(String(interpolation)))
          throw new TypeError("invalid animation interpolation");
        if (interpolation === "CUBICSPLINE")
          playbackLimitations.add("CUBICSPLINE channels are preserved; common scene sampling is not implemented");
        return {
          ...sampler,
          input: copyAccessor(sampler["input"]),
          output: copyAccessor(sampler["output"])
        };
      });
      const targets = /* @__PURE__ */ new Set();
      const channels = array(animation, "channels").map((candidate2) => {
        const channel = object(candidate2, "source channel");
        noIndexedExtensions(channel, "animation channel");
        const samplerIndex = safeIndex(channel["sampler"], samplers.length, "animation channel sampler");
        const sourceSampler = object(array(animation, "samplers")[samplerIndex], "source sampler");
        const inputAccessor = read(ownedBundle, sourceSampler["input"]);
        const outputAccessor = read(ownedBundle, sourceSampler["output"]);
        const multiplier = sourceSampler["interpolation"] === "CUBICSPLINE" ? 3 : 1;
        const target = object(channel["target"], "source target");
        let mapped;
        let key;
        if (target["path"] === "pointer") {
          const pointer = name(field(field(target["extensions"], "KHR_animation_pointer"), "pointer"), "source animation pointer");
          const visible = uvmVisibilityTarget(pointer, sourceVisibility);
          let destination;
          if (visible !== void 0) {
            if ("node" in visible)
              throw new TypeError("attachment of inactive batch visibility requires an explicit node binding");
            const primitive = primitiveMap.get(`${visible.mesh}/${visible.primitive}`);
            if (primitive === void 0)
              throw new TypeError("attachment lacks explicit visibility primitive mapping");
            let index = visibility.findIndex((item) => "mesh" in item && item.mesh === primitive.mesh && item.primitive === primitive.primitive);
            if (index < 0) {
              index = visibility.length;
              visibility.push({ ...primitive, value: 1 });
            }
            destination = uvmVisibilityPointer(index);
          } else {
            destination = required(pointerMap.get(pointer), `explicit pointer mapping for ${pointer}`);
            playbackLimitations.add(`General animation pointer ${destination} is preserved; common scene sampling is not implemented`);
          }
          const extensions2 = object(target["extensions"], "pointer extensions");
          if (Object.keys(extensions2).some((key2) => key2 !== "KHR_animation_pointer"))
            throw new TypeError("unmapped pointer target extension");
          mapped = {
            ...target,
            extensions: {
              ...extensions2,
              KHR_animation_pointer: {
                ...object(extensions2["KHR_animation_pointer"], "pointer extension"),
                pointer: destination
              }
            }
          };
          key = destination;
          pointerUsed = true;
        } else {
          noIndexedExtensions(target, "animation target");
          const path = target["path"];
          if (!["translation", "rotation", "scale", "weights"].includes(String(path)))
            throw new TypeError("unsupported attachment target path");
          const from = safeIndex(target["node"], array(source, "nodes").length, "source target node");
          const to = required(nodeMap.get(from), `explicit node mapping for ${from}`);
          if (path !== "weights" && field(array(document, "nodes")[to], "matrix") !== void 0)
            throw new TypeError("animation target cannot use a matrix");
          if (path === "weights") {
            const morphCount = (doc, nodeIndex) => {
              const node = object(array(doc, "nodes")[nodeIndex], "morph node");
              const meshes = array(doc, "meshes");
              const mesh = object(meshes[safeIndex(node["mesh"], meshes.length, "morph mesh")], "morph mesh");
              const counts = new Set(array(mesh, "primitives").map((primitive) => array(primitive, "targets").length));
              const count2 = counts.values().next().value;
              if (counts.size !== 1 || count2 === void 0 || count2 === 0)
                throw new TypeError("morph attachment needs matching explicit primitive targets");
              return count2;
            };
            const count = morphCount(source, from);
            if (morphCount(document, to) !== count || outputAccessor.width !== 1 || outputAccessor.count !== inputAccessor.count * multiplier * count)
              throw new TypeError("attachment morph targets and output accessor shape differ");
            playbackLimitations.add("Morph weight channels are preserved; common scene sampling is not implemented");
          } else {
            const width = path === "rotation" ? 4 : 3;
            if (outputAccessor.width !== width || outputAccessor.count !== inputAccessor.count * multiplier)
              throw new TypeError("attachment TRS output accessor shape is invalid");
            if (path === "rotation")
              for (let frame = 0; frame < inputAccessor.count; frame++) {
                const start = (frame * multiplier + (multiplier === 3 ? 1 : 0)) * 4;
                if (Math.abs(Math.hypot(...outputAccessor.values.subarray(start, start + 4)) - 1) > 1e-4)
                  throw new TypeError("attachment rotation key is not a unit quaternion");
              }
            if (!array(document, "skins").some((skin) => array(skin, "joints").includes(to)))
              playbackLimitations.add(`Node TRS target node-${to} has no explicit skeleton binding for common scene playback`);
          }
          mapped = { ...target, node: to };
          key = `${to}/${String(path)}`;
        }
        if (targets.has(key))
          throw new TypeError("attachment target remapping merges channels");
        targets.add(key);
        return { ...channel, target: mapped };
      });
      if (channels.length === 0 || samplers.length === 0)
        throw new TypeError("cannot attach an empty glTF animation");
      animationIndex = animations.length;
      animations.push({
        ...animation,
        channels,
        samplers,
        extras: {
          ...object(animation["extras"] ?? {}, "animation extras"),
          uv: {
            ...object(field(animation["extras"], "uv") ?? {}, "animation metadata"),
            sourceSequenceIndex: sequenceIndex
          }
        }
      });
    }
    const mappedClip = {
      ...clip,
      id: clipId,
      sourceSequenceIndex: sequenceIndex,
      ...animationIndex === void 0 ? {} : { animation: animationIndex }
    };
    appended.push(mappedClip);
    appendedRecords.push({ ...sourceRecords.get(clip.id), ...mappedClip });
  }
  document = attachMaterialSequences(source, document, sequenceMap, materialMap, jsonBudget, signal);
  const extensions = object(document["extensions"], "base extensions");
  const used = new Set(array(document, "extensionsUsed"));
  used.add("UV_game_animation_clips");
  if (eventsUsed)
    used.add("UV_game_animation_events");
  if (pointerUsed)
    used.add("KHR_animation_pointer");
  if (visibility.length > 0)
    used.add("UV_game_variants");
  const binary = new Uint8Array(binaryLength);
  binary.set(ownedBase.binary);
  for (const chunk of chunks)
    binary.set(chunk.bytes, chunk.offset);
  const catalogDocument = object(snapshotJson({
    ...document,
    ...animations.length === 0 ? {} : { animations },
    accessors,
    bufferViews: views,
    buffers: [
      {
        ...object(array(document, "buffers")[0] ?? {}, "base buffer"),
        byteLength: binaryLength
      }
    ],
    extensionsUsed: [...used],
    extensions: {
      ...extensions,
      UV_game_animation_clips: {
        ...object(extensions["UV_game_animation_clips"] ?? {}, "base catalog"),
        clips: [
          ...baseCatalog.map((clip) => ({ ...baseRecords.get(clip.id), ...clip })),
          ...appendedRecords
        ]
      },
      ...visibility.length === 0 ? {} : {
        UV_game_variants: {
          ...object(extensions["UV_game_variants"] ?? {}, "variants"),
          visibility
        }
      }
    }
  }, jsonBudget, signal), "composed document");
  const candidate = { ...ownedBase, document: catalogDocument, binary };
  validateUvmDocument(catalogDocument, {
    binaryByteLength: binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  reserve(writeUvmContainer(candidate, budget, signal).length * 3);
  signal?.throwIfAborted();
  const retainedExtensions = object(candidate.document["extensions"], "composed extensions");
  const result = readUvmContainer(writeUvmContainer({
    ...candidate,
    document: {
      ...candidate.document,
      extensions: {
        ...retainedExtensions,
        UV_game_animation_clips: {
          ...object(retainedExtensions["UV_game_animation_clips"], "composed catalog"),
          attachments: [
            ...existingAttachments,
            {
              id,
              mapping: input,
              clips: appended.map((clip) => clip.id),
              playbackLimitations: [...playbackLimitations]
            }
          ]
        }
      }
    }
  }, budget, signal), budget, signal);
  validateUvmDocument(result.document, {
    binaryByteLength: result.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  return Object.freeze({
    container: result,
    clips: Object.freeze(appended.map((clip) => Object.freeze(clip))),
    playbackLimitations: Object.freeze([...playbackLimitations])
  });
}
async function attachUvmAnimationBundle(document, expectedRevision, bundle, request, options) {
  const signal = options?.signal;
  if (document.status().revision !== expectedRevision)
    throw new TypeError("stale UVM document revision");
  const result = await composeUvmAnimationBundle(document.snapshot(), bundle, request, options);
  signal?.throwIfAborted();
  const status = document.replace({ expectedRevision, container: result.container });
  return Object.freeze({ ...result, status });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/animation-operation.js
async function prepareUvmAnimationAttachmentRequest(bytes, bundleBytes, input, options = {}) {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET;
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 });
  try {
    const expectedRevision = document.status().revision;
    const bundle = readUvmContainer(bundleBytes, budget, options.signal);
    const result = await attachUvmAnimationBundle(document, expectedRevision, bundle, input, options);
    return document.serialize(result.status.revision);
  } finally {
    document.dispose();
  }
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/operations.js
function object2(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function prepareUvmFieldWrite(bytes, input, options = {}) {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET;
  const request = object2(snapshotJson(input, { maxBytes: budget.maxJsonBytes, maxNodes: budget.maxNodes, maxDepth: budget.maxDepth }, options.signal), "UVM field request");
  const path = request["path"];
  if (!Array.isArray(path) || path.length === 0 || !path.every((key) => typeof key === "string"))
    throw new TypeError("UVM field write requires its full semantic path");
  const value = request["value"];
  if (value === void 0 || request["groupId"] !== "tree" || request["key"] !== path.at(-1) || !Object.hasOwn(request, "value"))
    throw new TypeError("UVM field identity or value is invalid");
  const pointer = "/" + path.map((key) => key.replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/");
  return prepareUvmJsonEdits(bytes, [{ op: "replace", path: pointer, value }], options);
}
function prepareUvmJsonEdits(bytes, edits, options = {}) {
  if (edits.length === 0)
    throw new TypeError("UVM edit batch must not be empty");
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 });
  try {
    const expectedRevision = document.status().revision;
    const result = document.apply({ expectedRevision, json: edits });
    return document.serialize(result.revision);
  } finally {
    document.dispose();
  }
}
function prepareUvmEditRequest(bytes, input, options = {}) {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET;
  const request = object2(snapshotJson(input, { maxBytes: budget.maxJsonBytes, maxNodes: budget.maxNodes, maxDepth: budget.maxDepth + 3 }, options.signal), "UVM edit request");
  if (Object.keys(request).some((key) => key !== "json" && key !== "binary"))
    throw new TypeError("UVM edit request accepts only json and binary edit arrays");
  const jsonInput = Object.hasOwn(request, "json") ? request["json"] : [];
  const binaryInput = Object.hasOwn(request, "binary") ? request["binary"] : [];
  if (!Array.isArray(jsonInput) || !Array.isArray(binaryInput))
    throw new TypeError("UVM edit request requires edit arrays");
  if (jsonInput.length + binaryInput.length === 0)
    throw new TypeError("UVM edit batch must not be empty");
  if (jsonInput.length + binaryInput.length > (options.maxEdits ?? 4096))
    throw new RangeError("UVM edit batch exceeds maxEdits");
  const edits = jsonInput.map((entry) => {
    const edit = object2(entry, "UVM JSON edit");
    const op = edit["op"];
    const path = edit["path"];
    if (typeof path !== "string" || op !== "add" && op !== "replace" && op !== "remove" || Object.keys(edit).some((key) => !["op", "path", "value"].includes(key)))
      throw new TypeError("invalid UVM JSON edit");
    if (op === "remove") {
      if (Object.hasOwn(edit, "value"))
        throw new TypeError("remove edit cannot carry a value");
      return { op, path };
    }
    const value = edit["value"];
    if (value === void 0 || !Object.hasOwn(edit, "value"))
      throw new TypeError("UVM JSON edit value is missing");
    return { op, path, value };
  });
  let binaryBytes = 0;
  const binary = binaryInput.map((entry) => {
    const edit = object2(entry, "UVM binary edit");
    const byteOffset = edit["byteOffset"];
    const bytesHex = edit["bytesHex"];
    if (Object.keys(edit).some((key) => key !== "byteOffset" && key !== "bytesHex") || typeof byteOffset !== "number" || !Number.isSafeInteger(byteOffset) || byteOffset < 0 || typeof bytesHex !== "string" || bytesHex.length === 0 || bytesHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(bytesHex))
      throw new TypeError("UVM binary edit requires a byte offset and nonempty hexadecimal bytes");
    binaryBytes += bytesHex.length / 2;
    if (binaryBytes > budget.maxInputBytes)
      throw new RangeError("UVM binary edits exceed maxInputBytes");
    const replacement = new Uint8Array(bytesHex.length / 2);
    for (let index = 0; index < replacement.length; index++) {
      if ((index & 4095) === 0 && options.signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      replacement[index] = Number.parseInt(bytesHex.slice(index * 2, index * 2 + 2), 16);
    }
    return { byteOffset, bytes: replacement };
  });
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 });
  try {
    const result = document.apply({
      expectedRevision: document.status().revision,
      json: edits,
      binary
    });
    return document.serialize(result.revision);
  } finally {
    document.dispose();
  }
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/edit-input-schema.js
function createUvmJsonEditInputSchema(options) {
  return Object.freeze({
    $ref: options.reference,
    document: snapshotJson({
      schemaVersion: 1,
      forms: [
        {
          id: "uvm-json-edit",
          label: "Apply model document changes",
          summary: "Apply JSON changes to the model working document, save the supported changes, and reopen the result. Undo is available through the host history.",
          ...options.baseInput === void 0 ? {} : { baseInput: options.baseInput },
          fields: [
            ...options.fields ?? [],
            {
              key: "json",
              label: "Model changes (JSON)",
              type: { kind: "json" },
              inputPath: ["json"],
              required: true,
              initial: [],
              description: "Enter an array of add, remove, or replace edits. Each edit names a JSON Pointer path in the exported UVM document; add and replace also provide a value. Keep linked copies of the same value consistent. Unsupported changes are refused before saving."
            }
          ]
        }
      ]
    }, { maxDepth: 32, maxNodes: 2048, maxBytes: 65536 })
  });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/ordered-euler-chains.js
var UVM_ORDERED_EULER_CHAINS = "UV_ordered_euler_chains";
function readUvmOrderedEulerChains(document) {
  const raw = field(document["extensions"], UVM_ORDERED_EULER_CHAINS);
  if (raw === void 0)
    return [];
  const extension = object(raw, "ordered Euler chains");
  if (extension["schemaVersion"] !== 1 || Object.keys(extension).some((key) => !["schemaVersion", "chains"].includes(key)) || !array(document, "extensionsUsed").includes(UVM_ORDERED_EULER_CHAINS))
    throw new TypeError("unsupported UVM ordered Euler chains");
  const nodes = array(document, "nodes"), used = /* @__PURE__ */ new Set();
  return Object.freeze(array(extension, "chains").map((candidate) => {
    const value = object(candidate, "ordered Euler chain");
    if (Object.keys(value).some((key) => !["node", "rotationNodes", "scaleNode", "order"].includes(key)))
      throw new TypeError("unsupported UVM ordered Euler chain");
    const node = safeIndex(value["node"], nodes.length, "ordered Euler node");
    const rotations = array(value, "rotationNodes");
    if (rotations.length !== 3 || value["order"] !== "xyz")
      throw new TypeError("invalid or duplicate UVM ordered Euler chain");
    const rotationNodes = rotations.map((entry, axis) => safeIndex(entry, nodes.length, `ordered Euler rotation ${axis}`));
    const scaleNode = safeIndex(value["scaleNode"], nodes.length, "ordered Euler scale node");
    const chainNodes = [node, ...rotationNodes];
    if (new Set(chainNodes).size !== 4 || chainNodes.some((index) => used.has(index)))
      throw new TypeError("ordered Euler nodes must be distinct");
    const children = (index) => array(object(nodes[index], `node ${index}`), "children");
    if (!children(node).includes(rotationNodes[0]) || !children(rotationNodes[0]).includes(rotationNodes[1]) || !children(rotationNodes[1]).includes(rotationNodes[2]) || scaleNode !== rotationNodes[2])
      throw new TypeError("ordered Euler hierarchy does not match its declaration");
    chainNodes.forEach((index) => used.add(index));
    return Object.freeze({ node, rotationNodes, scaleNode, order: "xyz" });
  }));
}
function addUvmOrderedEulerChains(source, inputs, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  signal?.throwIfAborted();
  validateUvmDocument(source.document, { binaryByteLength: source.binary.length, ...signal ? { signal } : {} });
  if (inputs.length === 0)
    return source;
  const extensions = object(source.document["extensions"], "extensions");
  if (extensions[UVM_ORDERED_EULER_CHAINS] !== void 0)
    throw new TypeError("UVM ordered Euler chains already exist");
  const document = snapshotJson({
    ...source.document,
    extensionsUsed: [.../* @__PURE__ */ new Set([...array(source.document, "extensionsUsed"), UVM_ORDERED_EULER_CHAINS])],
    extensions: {
      ...extensions,
      [UVM_ORDERED_EULER_CHAINS]: { schemaVersion: 1, chains: inputs }
    }
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  readUvmOrderedEulerChains(document);
  const result = {
    ...source,
    document,
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map((chunk) => ({ type: chunk.type, bytes: new Uint8Array(chunk.bytes) }))
  };
  writeUvmContainer(result, budget, signal);
  return result;
}
export {
  UVM_GAME_MODEL_STATES,
  UVM_MODEL_SHADOW_MESHES,
  UVM_NODE_BILLBOARD,
  UVM_ORDERED_EULER_CHAINS,
  addUvmOrderedEulerChains,
  addUvmShadowMeshes,
  attachUvmAnimationBundle,
  composeUvmAnimationBundle,
  createUvmConversionCache,
  createUvmJsonEditInputSchema,
  openUvmDocument,
  prepareUvmAnimationAttachmentRequest,
  prepareUvmEditRequest,
  prepareUvmFieldWrite,
  prepareUvmJsonEdits,
  readUvmBillboards,
  readUvmModelStates,
  readUvmOrderedEulerChains,
  readUvmShadowMeshBindings
};
