import {
  array,
  field,
  finiteArray,
  object,
  required,
  safeIndex,
  string,
  vector3,
  vector4
} from "./chunk-I4Z5J3HX.js";
import {
  uvmImageLogicalId
} from "./chunk-OAFBQXD6.js";
import {
  readUvmAccessor
} from "./chunk-U6K3QYX2.js";
import {
  readUvmAnimationClips,
  readUvmKeyTimes,
  readUvmPrimitiveVisibility,
  uvmVisibilityTarget
} from "./chunk-3TRK5GFM.js";
import {
  composeTrsMatrix
} from "./chunk-5SBJANAJ.js";

// ../MODDING/modkit-core/packages/scene/dist/uvm/rig.js
var identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function uvMetadata(value) {
  const extras = value["extras"];
  if (extras === void 0)
    return {};
  const uv = object(extras, "UVM extras")["uv"];
  return uv === void 0 ? {} : object(uv, "UVM metadata");
}
function decodeUvmRig(document, readAccessor, maxScalarBytes, sceneNodes, signal) {
  signal?.throwIfAborted();
  const nodes = array(document, "nodes").map((value) => object(value, "UVM node"));
  const skins = array(document, "skins").map((value) => object(value, "UVM skin"));
  const parents = /* @__PURE__ */ new Map();
  for (const [parent, node] of nodes.entries()) {
    for (const child of array(node, "children")) {
      const childIndex = safeIndex(child, nodes.length, "joint parent");
      if (parents.has(childIndex))
        throw new TypeError("UVM node has multiple parents");
      parents.set(childIndex, parent);
    }
  }
  const done = /* @__PURE__ */ new Set();
  const rootByNode = /* @__PURE__ */ new Map();
  for (let node = 0; node < nodes.length; node++) {
    const path = /* @__PURE__ */ new Set();
    let cursor = node;
    let root = node;
    while (cursor !== void 0 && !done.has(cursor)) {
      if (path.has(cursor))
        throw new TypeError("UVM node hierarchy is cyclic");
      path.add(cursor);
      root = cursor;
      cursor = parents.get(cursor);
    }
    if (cursor !== void 0)
      root = required(rootByNode.get(cursor), "hierarchy root");
    for (const item of path) {
      done.add(item);
      rootByNode.set(item, root);
    }
  }
  let decodedBytes = 0;
  const read = (accessor, label) => {
    signal?.throwIfAborted();
    const result = readAccessor(accessor, maxScalarBytes - decodedBytes, label);
    decodedBytes += result.values.byteLength;
    if (!result.values.every(Number.isFinite))
      throw new TypeError(`UVM ${label} contains non-finite values`);
    return result;
  };
  const bindings = [];
  const animations = array(document, "animations").map((value) => object(value, "UVM animation"));
  const catalog = readUvmAnimationClips(document, signal);
  const visibility = readUvmPrimitiveVisibility(document, signal);
  const animatedNodes = /* @__PURE__ */ new Set();
  for (const animation of animations) {
    for (const candidate of array(animation, "channels")) {
      const channel = object(candidate, "UVM animation channel");
      const target = object(channel["target"] ?? {}, "UVM animation target");
      if (typeof target["path"] === "string" && ["translation", "rotation", "scale"].includes(target["path"]))
        animatedNodes.add(safeIndex(target["node"], nodes.length, "animation target"));
    }
  }
  let incompleteBindings = 0;
  for (const [skinIndex, skin] of skins.entries()) {
    const joints = array(skin, "joints").map((joint) => safeIndex(joint, nodes.length, "skin joint"));
    if (joints.length === 0 || new Set(joints).size !== joints.length)
      throw new TypeError("UVM skin needs unique joints");
    const slots = new Map(joints.map((joint, slot) => [safeIndex(joint, nodes.length, "skin joint"), slot]));
    if (joints.some((joint) => rootByNode.get(joint) !== rootByNode.get(required(joints[0], "first joint"))))
      throw new TypeError("UVM skin joints have no common root");
    if (skin["skeleton"] !== void 0) {
      const skeletonRoot = safeIndex(skin["skeleton"], nodes.length, "skeleton root");
      const descendants = /* @__PURE__ */ new Set([skeletonRoot]);
      for (const joint of joints) {
        const path = [];
        let current = joint;
        while (current !== void 0 && !descendants.has(current)) {
          path.push(current);
          current = parents.get(current);
        }
        if (current === void 0)
          throw new TypeError("UVM declared skeleton root is not a common ancestor");
        for (const child of path)
          descendants.add(child);
      }
    }
    const matrices = skin["inverseBindMatrices"] === void 0 ? void 0 : read(skin["inverseBindMatrices"], "inverse bind matrices");
    if (matrices !== void 0 && (matrices.width !== 16 || matrices.componentType !== 5126 || matrices.normalized || matrices.count < joints.length))
      throw new TypeError("UVM inverse bind matrices must be float MAT4 values for every joint");
    for (const [boneIndex, joint] of joints.entries()) {
      const node = required(nodes[joint], "skin joint");
      let parent = parents.get(joint);
      let identityChain = true;
      while (parent !== void 0 && !slots.has(parent) && !animatedNodes.has(parent)) {
        identityChain &&= required(sceneNodes[parent], "parent scene node").transform.every((value, index) => value === (index % 5 === 0 ? 1 : 0));
        parent = parents.get(parent);
      }
      const parentBoneIndex = parent === void 0 ? null : identityChain ? slots.get(parent) : void 0;
      const localPose = node["matrix"] === void 0 ? {
        translation: vector3(node["translation"] ?? [0, 0, 0]),
        rotation: vector4(node["rotation"] ?? [0, 0, 0, 1]),
        scale: vector3(node["scale"] ?? [1, 1, 1])
      } : void 0;
      if (parentBoneIndex === void 0 || localPose === void 0)
        incompleteBindings++;
      const inverseBindMatrix = matrices === void 0 ? identity() : Array.from(matrices.values.subarray(boneIndex * 16, boneIndex * 16 + 16));
      if (inverseBindMatrix[3] !== 0 || inverseBindMatrix[7] !== 0 || inverseBindMatrix[11] !== 0 || inverseBindMatrix[15] !== 1)
        throw new TypeError("UVM inverse bind matrix must be affine");
      bindings.push({
        partId: `skin-${skinIndex}`,
        hierarchyId: `skin-${skinIndex}`,
        boneIndex,
        boneName: typeof node["name"] === "string" ? node["name"] : null,
        provenance: "direct",
        nodeId: `node-${joint}`,
        inverseBindMatrix,
        ...parentBoneIndex === void 0 ? {} : { parentBoneIndex },
        ...localPose === void 0 ? {} : { localPose }
      });
    }
  }
  const clips = [];
  for (const [clipIndex, animation] of animations.entries()) {
    const samplers = array(animation, "samplers").map((value) => object(value, "UVM animation sampler"));
    const channels = [];
    const targets = /* @__PURE__ */ new Set();
    const frames = /* @__PURE__ */ new Set();
    let unsupportedChannels = 0;
    let durationSeconds = 0;
    for (const candidate of array(animation, "channels")) {
      const channel = object(candidate, "UVM animation channel");
      const sampler = required(samplers[safeIndex(channel["sampler"], samplers.length, "animation sampler")], "animation sampler");
      const input = read(sampler["input"], "animation time");
      if (input.width !== 1 || input.componentType !== 5126 || input.normalized || input.count === 0)
        throw new TypeError("UVM animation time accessor shape is invalid");
      let previous = -Infinity;
      for (const time of input.values) {
        if (time < 0 || time <= previous)
          throw new TypeError("UVM animation times must be nonnegative and strictly increasing");
        previous = time;
        frames.add(time);
        durationSeconds = Math.max(durationSeconds, time);
      }
      const target = object(channel["target"] ?? {}, "UVM animation target");
      const targetPath = target["path"];
      const visible = targetPath === "pointer" ? uvmVisibilityTarget(field(field(target["extensions"], "KHR_animation_pointer"), "pointer"), visibility) : void 0;
      if (visible === void 0 && (typeof targetPath !== "string" || !["translation", "rotation", "scale", "weights"].includes(targetPath))) {
        unsupportedChannels++;
        continue;
      }
      const node = visible === void 0 ? safeIndex(target["node"], nodes.length, "animation target") : void 0;
      const morphWeights = targetPath === "weights";
      if (node !== void 0 && !morphWeights && required(nodes[node], "animation target")["matrix"] !== void 0)
        throw new TypeError("UVM animated node cannot use matrix");
      const morphTargets = (() => {
        if (!morphWeights || node === void 0)
          return 0;
        const meshes = array(document, "meshes");
        const mesh = required(nodes[node], "morph node")["mesh"];
        if (mesh === void 0)
          throw new TypeError("UVM weights channel targets a node without a mesh");
        const primitive = array(object(meshes[safeIndex(mesh, meshes.length, "morph mesh")], "morph mesh"), "primitives")[0];
        const targets2 = primitive === void 0 ? [] : array(object(primitive, "morph primitive"), "targets");
        if (targets2.length === 0)
          throw new TypeError("UVM weights channel targets a mesh without morph targets");
        return targets2.length;
      })();
      const targetId = visible === void 0 ? `node-${node}` : "node" in visible ? `node-${visible.node}` : `mesh-${visible.mesh}-primitive-${visible.primitive}`;
      const key = `${targetId}/${targetPath}`;
      if (targets.has(key))
        throw new TypeError("UVM animation repeats a node property");
      targets.add(key);
      const interpolation = sampler["interpolation"] ?? "LINEAR";
      if (typeof interpolation !== "string" || !["STEP", "LINEAR", "CUBICSPLINE"].includes(interpolation))
        throw new TypeError("UVM animation interpolation is invalid");
      const cubic = interpolation === "CUBICSPLINE";
      const output = read(sampler["output"], "animation value");
      const width = morphWeights ? morphTargets : visible !== void 0 ? 1 : targetPath === "rotation" ? 4 : 3;
      if (output.width !== (morphWeights ? 1 : width) || output.count * output.width !== input.count * (cubic ? 3 : 1) * width || output.componentType !== 5126 || output.normalized)
        throw new TypeError("UVM animation input/output accessor shape is invalid");
      const metadata2 = uvMetadata(channel);
      const keyTimes = readUvmKeyTimes(metadata2["keyTimes"], { values: input.values, maxScalarBytes: maxScalarBytes - decodedBytes }, signal);
      if (keyTimes !== void 0)
        decodedBytes += keyTimes.length * 8;
      const samples = Array.from(keyTimes ?? input.values, (timeSeconds, frame) => {
        const at = (slot) => {
          const start = (cubic ? frame * 3 + slot : frame) * width;
          return Array.from(output.values.subarray(start, start + width));
        };
        const value = at(cubic ? 1 : 0);
        if (width === 4 && !morphWeights && Math.abs(Math.hypot(...value) - 1) > 1e-4)
          throw new TypeError("UVM animation quaternion is not a unit quaternion");
        return cubic ? { frame, timeSeconds, value, inTangent: at(0), outTangent: at(2) } : { frame, timeSeconds, value };
      });
      if (metadata2["globalSeqId"] !== void 0) {
        unsupportedChannels++;
        continue;
      }
      if (metadata2["concurrent"] !== void 0 && typeof metadata2["concurrent"] !== "boolean")
        throw new TypeError("UVM animation concurrent flag is invalid");
      if (metadata2["wrapSeconds"] !== void 0 && (metadata2["concurrent"] !== true || typeof metadata2["wrapSeconds"] !== "number" || !Number.isFinite(metadata2["wrapSeconds"]) || metadata2["wrapSeconds"] <= 0))
        throw new TypeError("UVM animation independent wrap duration is invalid");
      if (metadata2["repeatCount"] !== void 0 && (metadata2["concurrent"] !== true || typeof metadata2["repeatCount"] !== "number" || !Number.isSafeInteger(metadata2["repeatCount"]) || metadata2["repeatCount"] < 0 || metadata2["wrapSeconds"] === void 0))
        throw new TypeError("UVM animation independent repeat count is invalid");
      channels.push({
        target: targetId,
        kind: visible !== void 0 ? "visibility" : String(targetPath),
        firstFrame: 0,
        lastFrame: samples.length - 1,
        samples,
        interpolation: interpolation === "STEP" ? "step" : cubic ? "cubic-spline" : width === 4 && !morphWeights ? "spherical-linear" : "linear",
        ...metadata2["concurrent"] === void 0 ? {} : { concurrent: metadata2["concurrent"] },
        ...metadata2["wrapSeconds"] === void 0 ? {} : { wrapSeconds: metadata2["wrapSeconds"] },
        ...metadata2["repeatCount"] === void 0 ? {} : { repeatCount: metadata2["repeatCount"] }
      });
    }
    const metadata = uvMetadata(animation);
    if (metadata["sourceDurationSeconds"] !== void 0) {
      if (typeof metadata["sourceDurationSeconds"] !== "number" || !Number.isFinite(metadata["sourceDurationSeconds"]) || metadata["sourceDurationSeconds"] < 0)
        throw new TypeError("UVM source animation duration is invalid");
      durationSeconds = metadata["sourceDurationSeconds"];
    }
    if (metadata["looping"] !== void 0 && typeof metadata["looping"] !== "boolean")
      throw new TypeError("UVM animation looping flag is invalid");
    if (metadata["repeatCount"] !== void 0 && (typeof metadata["repeatCount"] !== "number" || !Number.isSafeInteger(metadata["repeatCount"]) || metadata["repeatCount"] < 0))
      throw new TypeError("UVM animation repeat count is invalid");
    const sequenceIndex = metadata["sourceSequenceIndex"];
    if (sequenceIndex !== void 0 && (typeof sequenceIndex !== "number" || !Number.isSafeInteger(sequenceIndex) || sequenceIndex < 0))
      throw new TypeError("UVM animation sequence index is invalid");
    clips.push({
      id: `animation-${clipIndex}`,
      name: typeof animation["name"] === "string" ? animation["name"] : "",
      kind: frames.size > 1 ? "animation" : "rest-pose",
      provenance: "direct",
      frames: frames.size,
      durationSeconds,
      channels,
      ...metadata["looping"] === void 0 ? {} : { looping: metadata["looping"] },
      ...metadata["repeatCount"] === void 0 ? {} : { repeatCount: metadata["repeatCount"] },
      ...unsupportedChannels === 0 ? {} : { unsupportedChannels },
      ...sequenceIndex === void 0 ? {} : { sequenceIndex }
    });
  }
  const selectable = catalog === void 0 ? clips : catalog.map((entry) => {
    const sampled = entry.animation === void 0 ? void 0 : required(clips[entry.animation], "catalog animation");
    return {
      ...sampled,
      id: entry.id,
      name: entry.name,
      durationSeconds: entry.durationSeconds,
      sequenceIndex: entry.sourceSequenceIndex,
      kind: entry.kind ?? sampled?.kind ?? (entry.durationSeconds > 0 ? "animation" : "rest-pose"),
      provenance: "direct",
      frames: entry.frames ?? sampled?.frames ?? 0,
      channels: sampled?.channels ?? [],
      ...entry.looping === void 0 ? {} : { looping: entry.looping },
      ...entry.repeatCount === void 0 ? {} : { repeatCount: entry.repeatCount }
    };
  });
  const jointNodes = new Set(bindings.map((binding) => binding.nodeId));
  const nodePoses = [...animatedNodes].filter((node) => !jointNodes.has(`node-${node}`)).map((node) => {
    const source = required(nodes[node], "animated node");
    return {
      nodeId: `node-${node}`,
      localPose: {
        translation: vector3(source["translation"] ?? [0, 0, 0]),
        rotation: vector4(source["rotation"] ?? [0, 0, 0, 1]),
        scale: vector3(source["scale"] ?? [1, 1, 1])
      }
    };
  });
  return { bindings, nodePoses, clips: selectable, incompleteBindings, decodedBytes };
}
function uvmMeshSkins(document) {
  const result = /* @__PURE__ */ new Map();
  const skins = array(document, "skins");
  for (const candidate of array(document, "nodes")) {
    const node = object(candidate, "UVM node");
    if (node["mesh"] === void 0)
      continue;
    const mesh = safeIndex(node["mesh"], array(document, "meshes").length, "skinned mesh");
    const skin = node["skin"] === void 0 ? null : safeIndex(node["skin"], skins.length, "mesh skin");
    if (result.has(mesh) && result.get(mesh) !== skin)
      throw new TypeError("UVM mesh instances use different skin bindings, which the mesh facet cannot represent");
    result.set(mesh, skin);
  }
  return result;
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/geometry.js
function floatValues(accessor) {
  if (!(accessor.values instanceof Float32Array))
    throw new TypeError("UVM vertex values must be float32");
  return accessor.values;
}
function identityTransform() {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function nodeTransform(node) {
  const hasTrs = ["translation", "rotation", "scale"].some((key) => node[key] !== void 0);
  if (node["matrix"] !== void 0) {
    if (hasTrs || !finiteArray(node["matrix"], 16))
      throw new TypeError("UVM node matrix must be finite and cannot coexist with TRS");
    return { transform: Object.freeze([...node["matrix"]]) };
  }
  if (!hasTrs)
    return { transform: identityTransform() };
  const translation = node["translation"] === void 0 ? [0, 0, 0] : node["translation"];
  const rotation = node["rotation"] === void 0 ? [0, 0, 0, 1] : node["rotation"];
  const scale = node["scale"] === void 0 ? [1, 1, 1] : node["scale"];
  if (!finiteArray(translation, 3) || !finiteArray(rotation, 4) || !finiteArray(scale, 3))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  if (Math.abs(Math.hypot(...rotation) - 1) > 1e-4)
    throw new TypeError("UVM node rotation must be a unit quaternion");
  const transform = new Float32Array(16);
  composeTrsMatrix(transform, 0, translation, rotation, scale);
  if (!transform.every(Number.isFinite))
    throw new RangeError("UVM node TRS exceeds the finite transform range");
  return {
    transform: Object.freeze(Array.from(transform)),
    trs: Object.freeze({
      translation: Object.freeze([...translation]),
      rotation: Object.freeze([...rotation]),
      scale: Object.freeze([...scale])
    })
  };
}
function decodeUvmGeometry(document, binary, budget, signal) {
  const nodes = array(document, "nodes");
  const meshes = array(document, "meshes");
  const materials = array(document, "materials");
  const textures = array(document, "textures");
  const animations = array(document, "animations");
  signal?.throwIfAborted();
  const meshSkins = uvmMeshSkins(document);
  const hiddenPrimitiveIds = new Set(readUvmPrimitiveVisibility(document, signal).flatMap((item) => "mesh" in item && item.value <= 0 ? [`mesh-${item.mesh}-primitive-${item.primitive}`] : []));
  const primitives = [];
  let decodedGeometryBytes = 0;
  const remaining = () => ({
    maxScalarBytes: budget.maxScalarBytes - decodedGeometryBytes
  });
  const charge = (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes > budget.maxScalarBytes - decodedGeometryBytes)
      throw new RangeError("UVM geometry exceeds maxScalarBytes budget");
    decodedGeometryBytes += bytes;
  };
  const modelMeshes = meshes.map((candidate, meshIndex) => {
    signal?.throwIfAborted();
    const mesh = object(candidate, `mesh ${meshIndex}`);
    const extras = mesh["extras"];
    const names = extras !== null && typeof extras === "object" && !Array.isArray(extras) ? extras["targetNames"] : void 0;
    const targetNames = Array.isArray(names) ? names : [];
    let targetCount;
    const primitiveIds = array(mesh, "primitives").map((candidatePrimitive, primitiveIndex) => {
      const primitive = object(candidatePrimitive, `mesh ${meshIndex} primitive ${primitiveIndex}`);
      if ((primitive["mode"] ?? 4) !== 4)
        throw new TypeError("UVM/core currently requires triangles");
      const attributes = object(primitive["attributes"], "UVM primitive attributes");
      const position = readUvmAccessor(document, binary, attributes["POSITION"], remaining(), "positions", signal);
      const positions = floatValues(position);
      if (position.width !== 3 || position.componentType !== 5126 || position.normalized) {
        throw new TypeError("UVM POSITION must be a float VEC3 accessor");
      }
      if (!positions.every(Number.isFinite))
        throw new TypeError("UVM POSITION contains non-finite values");
      charge(positions.byteLength);
      let indices;
      if (primitive["indices"] === void 0) {
        charge(position.count * 4);
        indices = Uint32Array.from({ length: position.count }, (_unused, index) => index);
      } else {
        const accessor = readUvmAccessor(document, binary, primitive["indices"], remaining(), "indices", signal);
        if (accessor.width !== 1 || accessor.normalized || ![5121, 5123, 5125].includes(accessor.componentType))
          throw new TypeError("UVM indices must be unsigned integer SCALAR values");
        indices = accessor.values;
        charge(indices.byteLength);
      }
      if (indices.length % 3 !== 0)
        throw new TypeError("UVM indices must form triangles");
      if (indices.some((index) => index >= position.count))
        throw new RangeError("UVM index exceeds POSITION count");
      const vertexAttribute = (semantic, width) => {
        if (attributes[semantic] === void 0)
          return void 0;
        const attribute = readUvmAccessor(document, binary, attributes[semantic], remaining(), semantic, signal);
        const color = semantic === "COLOR_0";
        if (attribute.componentType === 5126 && attribute.normalized)
          throw new TypeError(`UVM ${semantic} float accessor cannot use normalized`);
        const normalizedInteger = (color || semantic === "WEIGHTS_0" || semantic.startsWith("TEXCOORD_")) && attribute.normalized && [5121, 5123].includes(attribute.componentType);
        if (attribute.width !== width && !(color && attribute.width === 3) || attribute.count !== position.count || attribute.componentType !== 5126 && !normalizedInteger) {
          throw new TypeError(`UVM ${semantic} must be a supported VEC${width} matching POSITION count`);
        }
        if (!attribute.values.every(Number.isFinite))
          throw new TypeError(`UVM ${semantic} contains non-finite values`);
        let values = floatValues(attribute);
        if (normalizedInteger) {
          const divisor = attribute.componentType === 5121 ? 255 : 65535;
          for (let index = 0; index < values.length; index += 1)
            values[index] = required(values[index], semantic) / divisor;
        }
        if (color && attribute.width === 3) {
          charge(position.count * 16);
          values = new Float32Array(position.count * 4);
          for (let index = 0; index < position.count; index += 1) {
            values.set(attribute.values.subarray(index * 3, index * 3 + 3), index * 4);
            values[index * 4 + 3] = 1;
          }
        } else
          charge(values.byteLength);
        if (color) {
          for (let index = 0; index < values.length; index += 1)
            values[index] = Math.min(1, Math.max(0, required(values[index], semantic)));
        }
        return values;
      };
      const normals = vertexAttribute("NORMAL", 3);
      const tangents = vertexAttribute("TANGENT", 4);
      const colors = vertexAttribute("COLOR_0", 4);
      const boneWeights = vertexAttribute("WEIGHTS_0", 4);
      let boneIndices;
      let hierarchyId;
      if (attributes["JOINTS_0"] !== void 0 || boneWeights !== void 0) {
        if (attributes["JOINTS_1"] !== void 0 || attributes["WEIGHTS_1"] !== void 0)
          throw new TypeError("UVM joint sets beyond four influences need a richer geometry facet");
        const skin = meshSkins.get(meshIndex);
        if (skin === void 0 || skin === null || boneWeights === void 0 || attributes["JOINTS_0"] === void 0)
          throw new TypeError("UVM joint indices and weights need a paired mesh skin binding");
        const joints = readUvmAccessor(document, binary, attributes["JOINTS_0"], remaining(), "joint indices", signal);
        const jointCount = array(array(document, "skins")[skin], "joints").length;
        if (joints.width !== 4 || joints.count !== position.count || joints.normalized || ![5121, 5123].includes(joints.componentType) || joints.values.some((value) => value >= jointCount))
          throw new TypeError("UVM joint indices must reference valid skin slots");
        charge(joints.values.byteLength);
        boneIndices = Uint32Array.from(joints.values);
        if (boneWeights.some((value) => value < 0 || value > 1))
          throw new TypeError("UVM skin weights are outside zero to one");
        for (let offset = 0; offset < boneWeights.length; offset += 4) {
          const sum = required(boneWeights[offset], "skin weight") + required(boneWeights[offset + 1], "skin weight") + required(boneWeights[offset + 2], "skin weight") + required(boneWeights[offset + 3], "skin weight");
          if (Math.abs(sum - 1) > 1e-4)
            throw new TypeError("UVM skin weights must sum to one");
        }
        hierarchyId = `skin-${skin}`;
      }
      const textureCoordinateSets = Object.keys(attributes).filter((semantic) => /^TEXCOORD_(?:0|[1-9][0-9]*)$/u.test(semantic)).map((semantic) => {
        const set = Number(semantic.slice("TEXCOORD_".length));
        if (!Number.isSafeInteger(set))
          throw new TypeError("UVM UV set index is invalid");
        return { set, coordinates: required(vertexAttribute(semantic, 2), semantic) };
      }).sort((a, b) => a.set - b.set);
      if (textureCoordinateSets.some((channel, index) => channel.set !== index)) {
        throw new TypeError("UVM UV sets must be consecutive from zero");
      }
      const textureCoordinates = textureCoordinateSets.find((channel) => channel.set === 0)?.coordinates;
      const targetList = primitive["targets"];
      if (targetList !== void 0 && !Array.isArray(targetList))
        throw new TypeError("UVM morph targets must be an array");
      const morphTargets = (Array.isArray(targetList) ? targetList : []).map((candidateTarget, targetIndex) => {
        const target = object(candidateTarget, `mesh ${meshIndex} primitive ${primitiveIndex} morph target ${targetIndex}`);
        const delta = (semantic) => {
          if (target[semantic] === void 0)
            return void 0;
          const accessor = readUvmAccessor(document, binary, target[semantic], remaining(), `morph ${semantic}`, signal);
          if (accessor.width !== 3 || accessor.count !== position.count || accessor.componentType !== 5126 || accessor.normalized)
            throw new TypeError(`UVM morph ${semantic} must be float VEC3 deltas matching POSITION`);
          const values = floatValues(accessor);
          if (!values.every(Number.isFinite))
            throw new TypeError(`UVM morph ${semantic} contains non-finite values`);
          charge(values.byteLength);
          return values;
        };
        const deltas = delta("POSITION");
        if (deltas === void 0)
          charge(position.count * 12);
        const normalDeltas = delta("NORMAL");
        const tangentDeltas = delta("TANGENT");
        const name = targetNames[targetIndex];
        return {
          ...typeof name === "string" ? { name } : {},
          positions: deltas ?? new Float32Array(position.count * 3),
          ...normalDeltas === void 0 ? {} : { normals: normalDeltas },
          ...tangentDeltas === void 0 ? {} : { tangents: tangentDeltas }
        };
      });
      if (targetCount !== void 0 && targetCount !== morphTargets.length)
        throw new TypeError("UVM mesh primitives must carry the same number of morph targets");
      targetCount = morphTargets.length;
      charge(textureCoordinates?.byteLength ?? 0);
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`;
      primitives.push({
        id,
        topology: "triangles",
        positions,
        indices,
        ...normals === void 0 ? {} : { normals },
        ...tangents === void 0 ? {} : { tangents },
        ...colors === void 0 ? {} : { colors },
        ...boneIndices === void 0 ? {} : {
          boneIndices,
          boneWeights: required(boneWeights, "skin weights"),
          hierarchyId: required(hierarchyId, "skin hierarchy")
        },
        ...textureCoordinates === void 0 ? {} : { textureCoordinates },
        ...textureCoordinateSets.length === 0 ? {} : { textureCoordinateSets },
        ...primitive["material"] !== void 0 ? {
          materialId: `material-${safeIndex(primitive["material"], materials.length, "primitive material")}`
        } : {},
        ...morphTargets.length === 0 ? {} : { morphTargets },
        ...hiddenPrimitiveIds.has(id) ? { hidden: true } : {}
      });
      return id;
    });
    const weights = mesh["weights"];
    if (weights !== void 0 && (!Array.isArray(weights) || weights.length !== (targetCount ?? 0) || !weights.every((weight) => typeof weight === "number" && Number.isFinite(weight))))
      throw new TypeError("UVM mesh weights must be one finite number per morph target");
    return {
      id: `mesh-${meshIndex}`,
      ...typeof mesh["name"] === "string" ? { name: mesh["name"] } : {},
      primitiveIds,
      ...Array.isArray(weights) && weights.length > 0 ? { morphWeights: Object.freeze([...weights]) } : {}
    };
  });
  const modelNodes = nodes.map((candidate, nodeIndex) => {
    const node = object(candidate, `node ${nodeIndex}`);
    const childIds = (Array.isArray(node["children"]) ? node["children"] : []).map((child) => `node-${safeIndex(child, nodes.length, `node ${nodeIndex} child`)}`);
    const meshIds = node["mesh"] === void 0 ? [] : [`mesh-${safeIndex(node["mesh"], meshes.length, "node mesh")}`];
    return {
      id: `node-${nodeIndex}`,
      ...typeof node["name"] === "string" ? { name: node["name"] } : {},
      childIds,
      meshIds,
      ...nodeTransform(node)
    };
  });
  return Object.freeze({
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
    materials: materials.length,
    textures: textures.length,
    animations: animations.length,
    decodedGeometryBytes
  });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/model.js
function readUvmModel(document, binary, budget, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM scalar budget");
  const scene = decodeUvmGeometry(document, binary, budget, signal);
  const rig = decodeUvmRig(document, (accessor, maxScalarBytes, purpose) => readUvmAccessor(document, binary, accessor, { maxScalarBytes }, purpose, signal), budget.maxScalarBytes - scene.decodedGeometryBytes, scene.nodes, signal);
  return Object.freeze({ scene, rig });
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/images.js
function uvmImageResourceId(document, index) {
  const images = array(document, "images");
  const image = object(images[safeIndex(index, images.length, "image")], "image");
  if (typeof image["name"] === "string" && image["name"].length > 0)
    return image["name"];
  if (typeof image["uri"] === "string" && !image["uri"].startsWith("data:"))
    return uvmImageLogicalId(image["uri"]);
  return `uvm-image-${index}`;
}
function uvmImageFilters(document) {
  const textures = array(document, "textures");
  const samplers = document["samplers"] === void 0 ? [] : array(document, "samplers");
  const byImage = /* @__PURE__ */ new Map();
  for (const candidate of textures) {
    const texture = object(candidate, "texture");
    const source = texture["source"];
    const samplerIndex = texture["sampler"];
    if (typeof source !== "number" || typeof samplerIndex !== "number")
      continue;
    const magnified = object(samplers[samplerIndex] ?? {}, "sampler")["magFilter"];
    const filter = magnified === 9728 ? "nearest" : magnified === 9729 ? "linear" : void 0;
    if (filter === void 0)
      continue;
    const known = byImage.get(source);
    byImage.set(source, known === void 0 || known === filter ? filter : null);
  }
  const filters = /* @__PURE__ */ new Map();
  for (const [image, filter] of byImage)
    if (filter !== null)
      filters.set(uvmImageResourceId(document, image), filter);
  return filters;
}
function prepareUvmTextureImages(document, binary, indices, maxEmbeddedBytes, signal) {
  const textures = array(document, "textures"), images = array(document, "images");
  const imageIndices = indices.map((textureIndex) => {
    const texture = object(textures[safeIndex(textureIndex, textures.length, "texture")], "texture");
    return safeIndex(texture["source"], images.length, "texture image");
  });
  return prepareUvmImages(document, binary, imageIndices, maxEmbeddedBytes, signal).map((image, index) => Object.freeze({ ...image, texture: indices[index] }));
}
function prepareUvmImages(document, binary, indices, maxEmbeddedBytes, signal) {
  if (!Number.isSafeInteger(maxEmbeddedBytes) || maxEmbeddedBytes < 0)
    throw new TypeError("invalid image budget");
  const images = array(document, "images"), views = array(document, "bufferViews");
  const captured = /* @__PURE__ */ new Map();
  let remaining = maxEmbeddedBytes;
  return indices.map((index) => {
    signal?.throwIfAborted();
    const imageIndex = safeIndex(index, images.length, "image");
    let source = captured.get(imageIndex);
    if (source === void 0) {
      const image = object(images[imageIndex], "image");
      const mediaType = image["mimeType"] === void 0 ? void 0 : string(image["mimeType"], "image mimeType");
      if (image["uri"] === void 0 === (image["bufferView"] === void 0))
        throw new TypeError("UVM image requires exactly one URI or bufferView");
      if (image["uri"] !== void 0) {
        const uri = string(image["uri"], "image URI");
        if (uri.startsWith("data:")) {
          const comma = uri.indexOf(",");
          if (comma < 0)
            throw new TypeError("invalid image data URI");
          const declaration = uri.slice(5, comma), payload = uri.slice(comma + 1);
          const declaredType = declaration.split(";")[0];
          if (mediaType !== void 0 && declaredType !== "" && declaredType !== mediaType)
            throw new TypeError("image data URI and mimeType disagree");
          let bytes;
          if (declaration.endsWith(";base64")) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload))
              throw new TypeError("invalid image base64");
            const length = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
          } else {
            let length = 0;
            for (let i = 0; i < payload.length; i++, length++) {
              if (payload[i] === "%") {
                if (!/^[0-9a-f]{2}$/iu.test(payload.slice(i + 1, i + 3)))
                  throw new TypeError("invalid image URI escape");
                i += 2;
              } else if (payload.charCodeAt(i) > 127)
                throw new TypeError("image URI bytes must be percent encoded");
            }
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = new Uint8Array(length);
            for (let i = 0, j = 0; i < payload.length; i++, j++) {
              if (payload[i] === "%") {
                bytes[j] = parseInt(payload.slice(i + 1, i + 3), 16);
                i += 2;
              } else
                bytes[j] = payload.charCodeAt(i);
            }
          }
          remaining -= bytes.length;
          const type = mediaType ?? declaredType;
          source = { kind: "embedded", bytes, ...type ? { mediaType: type } : {} };
        } else
          source = {
            kind: "logical",
            requirement: {
              id: `uvm-image-${imageIndex}`,
              logicalId: uvmImageLogicalId(uri),
              role: "texture",
              scopes: [
                "sibling-directory",
                "workspace-dependency-layer",
                "current-mount",
                "enclosing-container"
              ]
            }
          };
      } else {
        const view = object(views[safeIndex(image["bufferView"], views.length, "image bufferView")], "image bufferView");
        const offset = view["byteOffset"] ?? 0, length = view["byteLength"];
        if (view["buffer"] !== 0 || view["byteStride"] !== void 0 || typeof offset !== "number" || typeof length !== "number" || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > binary.length || length > binary.length - offset)
          throw new TypeError("image bufferView must name a bounded slice of the UVM BIN chunk");
        if (length > remaining)
          throw new RangeError("embedded images exceed budget");
        remaining -= length;
        source = {
          kind: "embedded",
          bytes: binary.slice(offset, offset + length),
          ...mediaType === void 0 ? {} : { mediaType }
        };
      }
      captured.set(imageIndex, source);
    }
    return Object.freeze({ image: imageIndex, source });
  });
}
function uvmImageTexels(result, options = {}) {
  if (options.channels !== void 0 && options.channels !== "color" && options.channels !== "data")
    throw new TypeError("invalid image channel interpretation");
  const { info, region } = result;
  if (!["top-left", "bottom-left"].includes(info.orientation))
    throw new TypeError("image orientation is unknown");
  if (options.channels !== "data" && !["none", "straight", "premultiplied", "unknown"].includes(info.alphaMode))
    throw new TypeError("image alpha mode is invalid");
  if (!(region.pixels instanceof Uint8Array) || region.pixelFormat !== "rgba8" || region.width !== info.width || region.height !== info.height || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width <= 0 || info.height <= 0 || !Number.isSafeInteger(region.rowStride) || region.rowStride < info.width * 4 || region.rowStride * (info.height - 1) + info.width * 4 > region.pixels.length)
    throw new TypeError("invalid image region");
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let y = 0; y < info.height; y++) {
    const sourceY = info.orientation === "top-left" ? y : info.height - 1 - y;
    rgba.set(region.pixels.subarray(sourceY * region.rowStride, sourceY * region.rowStride + info.width * 4), y * info.width * 4);
  }
  if (options.channels !== "data" && info.alphaMode === "premultiplied")
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] ?? 0;
      for (let channel = 0; channel < 3; channel++)
        rgba[i + channel] = alpha === 0 ? 0 : Math.min(255, Math.round((rgba[i + channel] ?? 0) * 255 / alpha));
    }
  return rgba;
}

// ../MODDING/modkit-core/packages/scene/dist/uvm/collision-mesh.js
function readCollisionMesh(document, binary, shape, budget, signal) {
  const positions = readUvmAccessor(document, binary, shape["positions"], budget, "collision positions", signal);
  if (positions.width !== 3 || positions.componentType !== 5126 || positions.normalized || positions.count === 0 || !positions.values.every(Number.isFinite))
    throw new TypeError("UV_game_collision positions must be finite nonempty float VEC3");
  if (!(positions.values instanceof Float32Array))
    throw new TypeError("collision positions are not float32");
  let scalarBytes = positions.values.byteLength;
  if (shape["kind"] !== "mesh")
    return { positions: positions.values, scalarBytes };
  const indices = readUvmAccessor(document, binary, shape["indices"], { maxScalarBytes: budget.maxScalarBytes - scalarBytes }, "indices", signal);
  if (indices.width !== 1 || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized || indices.count === 0 || indices.count % 3 !== 0)
    throw new TypeError("UV_game_collision mesh indices must form integer triangles");
  for (let i = 0; i < indices.values.length; i++) {
    if (i % 4096 === 0)
      signal?.throwIfAborted();
    const index = indices.values[i];
    if (index === void 0 || index >= positions.count)
      throw new RangeError("UV_game_collision mesh index exceeds its positions");
  }
  scalarBytes += indices.values.byteLength;
  return { positions: positions.values, indices: indices.values, scalarBytes };
}

export {
  readUvmModel,
  readCollisionMesh,
  uvmImageResourceId,
  uvmImageFilters,
  prepareUvmTextureImages,
  uvmImageTexels
};
