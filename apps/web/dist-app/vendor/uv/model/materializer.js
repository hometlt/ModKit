import {
  BufferBuilder,
  addAccessor,
  addJointAttribute,
  encodeAnimationChannel,
  encodeSkeleton
} from "../../../chunks/chunk-QONSPCLP.js";
import {
  packUvmGlb,
  uvmImageUri
} from "../../../chunks/chunk-OAFBQXD6.js";
import {
  materializeUvmAnimationMaterialTargets,
  uvmAnimationEvents,
  uvmAnimationPlayback,
  uvmKeyTimesMetadata,
  uvmVisibilityPointer
} from "../../../chunks/chunk-I43233HX.js";
import {
  DEFAULT_MODEL_MATERIAL_BUDGET,
  snapshotModelMaterials
} from "../../../chunks/chunk-I675VFQQ.js";
import {
  boundsOf
} from "../../../chunks/chunk-3YDZHAZL.js";
import {
  DEFAULT_MODEL_SKELETON_BUDGET,
  createModelSkeletonNodes,
  snapshotModelSkeleton
} from "../../../chunks/chunk-PERFFDVA.js";
import {
  DEFAULT_MODEL_ANIMATION_BUDGET,
  snapshotModelAnimations
} from "../../../chunks/chunk-RUAJQ7WQ.js";
import "../../../chunks/chunk-ZSDVUSRM.js";
import {
  composeTrsMatrix
} from "../../../chunks/chunk-5SBJANAJ.js";
import "../../../chunks/chunk-TKIPZ6HV.js";
import "../../../chunks/chunk-NUFRM6SI.js";
import "../../../chunks/chunk-W2UBWFML.js";
import "../../../chunks/chunk-NMYA52EI.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// ../MODDING/modkit-core/packages/uv/dist/model/rig.js
function refuse(message) {
  throw new TypeError(`UVM rig refused: ${message}`);
}
function unitQuaternion(values) {
  return Math.abs(Math.hypot(...values) - 1) <= 1e-4;
}
function prepareUvmSkeleton(source, nodes, storage, budget, signal) {
  const bindings = snapshotModelSkeleton(source, budget, signal);
  const nodeIndices = new Map(nodes.map((node, index) => [node.id, index]));
  const parents = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    for (const child of node.childIds ?? []) {
      if (!nodeIndices.has(child) || parents.has(child))
        refuse("scene has a missing or multiply parented node");
      parents.set(child, node.id);
    }
  }
  if (nodeIndices.size !== nodes.length)
    refuse("scene node ids are not unique");
  const groups = /* @__PURE__ */ new Map();
  for (const bone of bindings) {
    if (!bone.hierarchyId)
      refuse("bone has no explicit hierarchy");
    const group = groups.get(bone.hierarchyId) ?? [];
    group.push(bone);
    groups.set(bone.hierarchyId, group);
  }
  const skins = [];
  const groupingRoots = [];
  const boneByNode = /* @__PURE__ */ new Map();
  const hierarchies = /* @__PURE__ */ new Map();
  for (const [hierarchyId, group] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    group.sort((a, b) => a.boneIndex - b.boneIndex);
    if (group.length > 65536)
      refuse("skin exceeds the unsigned 16-bit joint index range");
    const slots = new Map(group.map((bone, slot) => [bone.boneIndex, slot]));
    const groupNodes = new Set(group.map((bone) => bone.nodeId));
    const expectedNodes = createModelSkeletonNodes(group, hierarchyId, budget, signal);
    for (const [slot, expected] of expectedNodes.entries()) {
      const bone = group[slot];
      const node = nodes[nodeIndices.get(expected.id) ?? -1];
      if (!node || boneByNode.has(expected.id))
        refuse("bone node is absent or belongs to multiple skins");
      if (node.transform.length !== 16 || node.transform.some((value, index) => value !== expected.transform[index]))
        refuse(`node ${node.id} disagrees with the bone local pose`);
      if (!unitQuaternion(bone.localPose.rotation))
        refuse("bone rotation is not a unit quaternion");
      if (bone.inverseBindMatrix === void 0)
        refuse("bone has no explicit inverse bind matrix");
      const inverse = Float32Array.from(bone.inverseBindMatrix);
      if (!inverse.every(Number.isFinite))
        refuse("inverse bind matrix exceeds finite float range");
      if (inverse[3] !== 0 || inverse[7] !== 0 || inverse[11] !== 0 || inverse[15] !== 1)
        refuse("inverse bind matrix is not affine");
      let parentId = parents.get(node.id);
      const visited = /* @__PURE__ */ new Set();
      while (parentId !== void 0 && !groupNodes.has(parentId)) {
        if (visited.has(parentId))
          refuse("scene ancestor cycle");
        visited.add(parentId);
        const ancestor = nodes[nodeIndices.get(parentId)];
        if (ancestor.transform.length !== 16 || ancestor.transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0)))
          refuse("a non-joint ancestor transform requires explicit rebasing");
        parentId = parents.get(parentId);
      }
      if (bone.parentBoneIndex !== null) {
        const parent = group[slots.get(bone.parentBoneIndex)];
        if (parentId !== parent.nodeId)
          refuse("scene and bone parents disagree");
      } else if (parentId !== void 0) {
        refuse("scene and root bone parents disagree");
      }
      boneByNode.set(node.id, bone);
    }
    const model = {
      format: "model-facets",
      meshes: [],
      materials: [],
      animations: [],
      bounds: null,
      effects: { particles: [], ribbons: [] },
      skeleton: {
        skinningInverses: "inverse-bind-matrices",
        bones: group.map((bone, index) => ({
          index,
          name: bone.boneName ?? "",
          parentIndex: bone.parentBoneIndex === null ? -1 : slots.get(bone.parentBoneIndex),
          inverseBindMatrix: Float32Array.from(bone.inverseBindMatrix)
        }))
      }
    };
    const encoded = encodeSkeleton(model, [], storage.buffer, storage.views, storage.accessors);
    const inverseBindMatrices = encoded.skins[0]?.["inverseBindMatrices"];
    if (typeof inverseBindMatrices !== "number")
      refuse("frozen skeleton writer returned no matrices");
    const joints = group.map((bone) => nodeIndices.get(bone.nodeId));
    const roots = group.filter((bone) => bone.parentBoneIndex === null);
    if (roots.length > 1)
      groupingRoots.push({
        skin: skins.length,
        children: [
          ...new Set(roots.map((bone) => {
            let root = bone.nodeId;
            while (parents.has(root))
              root = parents.get(root);
            return nodeIndices.get(root);
          }))
        ]
      });
    hierarchies.set(hierarchyId, { skin: skins.length, slots });
    skins.push({
      joints,
      inverseBindMatrices,
      ...roots.length === 1 ? { skeleton: nodeIndices.get(roots[0].nodeId) } : {}
    });
  }
  return { skins, boneByNode, hierarchies, groupingRoots };
}
function writeUvmSkinAttributes(primitive, attributes, skeleton, storage) {
  const hierarchy = skeleton.hierarchies.get(primitive.hierarchyId ?? "");
  if (!hierarchy)
    refuse(`primitive ${primitive.id} has no matching skeleton hierarchy`);
  const vertexCount = primitive.positions.length / 3;
  if (primitive.boneIndices?.length !== vertexCount * 4 || primitive.boneWeights?.length !== vertexCount * 4)
    refuse(`primitive ${primitive.id} needs four joint indices and weights per vertex`);
  const indices = new Uint16Array(primitive.boneIndices.length);
  for (const [index, joint] of primitive.boneIndices.entries()) {
    const slot = hierarchy.slots.get(joint);
    if (slot === void 0)
      refuse(`primitive ${primitive.id} references an unknown joint`);
    indices[index] = slot;
  }
  const weights = Float32Array.from(primitive.boneWeights);
  if (weights.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    refuse("skin weights must be finite values between zero and one");
  for (let offset = 0; offset < weights.length; offset += 4) {
    const sum = weights[offset] + weights[offset + 1] + weights[offset + 2] + weights[offset + 3];
    if (Math.abs(sum - 1) > 1e-4)
      refuse("skin weights must sum to one; no normalization is guessed");
  }
  const mesh = {
    name: primitive.id,
    materialIndex: -1,
    positions: primitive.positions,
    indices: new Uint32Array(),
    boneIndices: indices,
    boneWeights: weights
  };
  addJointAttribute(attributes, mesh, vertexCount, storage.buffer, storage.views, storage.accessors);
  return hierarchy.skin;
}
function writeUvmAnimations(source, nodeIndices, boneByNode, storage, budget, signal, primitiveIndices = /* @__PURE__ */ new Map(), rigidNodeIds = /* @__PURE__ */ new Set(), morphTargetCounts = /* @__PURE__ */ new Map(), hiddenPrimitives = []) {
  const clips = snapshotModelAnimations(source, budget, signal);
  const animations = [];
  const catalog = [];
  const sequenceIndices = /* @__PURE__ */ new Set();
  const losses = [];
  const visibility = [];
  const visibilityIndices = /* @__PURE__ */ new Map();
  for (const target of hiddenPrimitives) {
    visibilityIndices.set(`${target.mesh}/${target.primitive}/visibility`, visibility.length);
    visibility.push({ mesh: target.mesh, primitive: target.primitive, value: 0 });
  }
  for (const [clipIndex, clip] of clips.entries()) {
    const sequenceIndex = clip.sequenceIndex ?? clipIndex;
    if (sequenceIndices.has(sequenceIndex))
      refuse("clips require distinct material sequence indices");
    sequenceIndices.add(sequenceIndex);
    const samplers = [];
    const channels = [];
    const targets = /* @__PURE__ */ new Set();
    for (const [index, channel] of clip.channels.entries()) {
      const path = channel.kind;
      const node = nodeIndices.get(channel.target);
      const bone = boneByNode.get(channel.target);
      const width = path === "rotation" ? 4 : 3;
      const loss = (reason) => losses.push({ clipId: clip.id, channel: index, reason });
      if (path === "visibility") {
        const primitive = primitiveIndices.get(channel.target);
        const binding = primitive === void 0 && node !== void 0 && bone !== void 0 ? { node, binding: "batch" } : void 0;
        const samples = channel.samples;
        if (primitive === void 0 && binding === void 0 || channel.axis !== void 0 || !samples?.length || channel.interpolation !== "step" && channel.interpolation !== "linear") {
          loss("visibility channel has no explicit primitive target or scalar sampling semantics");
          continue;
        }
        let previous2 = -Infinity;
        if (!samples.every((sample) => {
          const time = Math.fround(sample.timeSeconds ?? NaN);
          const valid2 = Number.isFinite(time) && time >= 0 && time > previous2 && sample.value.length === 1 && Number.isFinite(Math.fround(sample.value[0] ?? NaN));
          previous2 = time;
          return valid2;
        })) {
          loss("visibility keys cannot be represented as finite, strictly increasing float32 samples");
          continue;
        }
        const targetKey = primitive === void 0 ? `node/${binding.node}/batch-visibility` : `${primitive.mesh}/${primitive.primitive}/visibility`;
        if (targets.has(targetKey))
          refuse(`clip ${clip.id} repeats primitive visibility`);
        targets.add(targetKey);
        let visibilityIndex = visibilityIndices.get(targetKey);
        if (visibilityIndex === void 0) {
          visibilityIndex = visibility.length;
          visibilityIndices.set(targetKey, visibilityIndex);
          visibility.push({ ...primitive ?? binding, value: 1 });
        }
        const times = Float32Array.from(samples, (sample) => sample.timeSeconds ?? NaN);
        const values = Float32Array.from(samples, (sample) => sample.value[0] ?? NaN);
        const input = addAccessor(storage.buffer, storage.views, storage.accessors, times, "SCALAR", 5126, void 0, { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] });
        const output = addAccessor(storage.buffer, storage.views, storage.accessors, values, "SCALAR", 5126);
        channels.push({
          sampler: samplers.length,
          target: {
            path: "pointer",
            extensions: {
              KHR_animation_pointer: { pointer: uvmVisibilityPointer(visibilityIndex) }
            }
          },
          extras: {
            uv: {
              ...uvmKeyTimesMetadata(samples.map((sample) => sample.timeSeconds)),
              ...channel.concurrent === true ? {
                sourceLineType: channel.interpolation === "step" ? 0 : 1,
                concurrent: true,
                ...channel.wrapSeconds === void 0 ? {} : { wrapSeconds: channel.wrapSeconds },
                ...channel.repeatCount === void 0 ? {} : { repeatCount: channel.repeatCount }
              } : {}
            }
          }
        });
        samplers.push({
          input,
          output,
          interpolation: channel.interpolation === "step" ? "STEP" : "LINEAR"
        });
        if (samples.some((sample) => Math.fround(sample.timeSeconds ?? NaN) !== sample.timeSeconds || sample.value.some((value) => Math.fround(value) !== value)))
          loss("visibility times or values were rounded to the glTF float32 representation");
        continue;
      }
      if (path === "weights") {
        const count = morphTargetCounts.get(channel.target) ?? 0;
        const samples = channel.samples;
        if (node === void 0 || count === 0 || channel.axis !== void 0 || !samples?.length || channel.interpolation !== "step" && channel.interpolation !== "linear") {
          loss("weights channel has no node with morph targets or no scalar sampling semantics");
          continue;
        }
        let previous2 = -Infinity;
        if (!samples.every((sample) => {
          const time = Math.fround(sample.timeSeconds ?? NaN);
          const valid2 = Number.isFinite(time) && time >= 0 && time > previous2 && sample.value.length === count && sample.value.every((value) => Number.isFinite(Math.fround(value)));
          previous2 = time;
          return valid2;
        })) {
          loss(`weights keys must be strictly increasing times with ${count} finite weights each`);
          continue;
        }
        const key2 = `${node}/weights`;
        if (targets.has(key2))
          refuse(`clip ${clip.id} has multiple channels for ${key2}`);
        targets.add(key2);
        const times = Float32Array.from(samples, (sample) => sample.timeSeconds ?? NaN);
        const input = addAccessor(storage.buffer, storage.views, storage.accessors, times, "SCALAR", 5126, void 0, { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] });
        const output = addAccessor(storage.buffer, storage.views, storage.accessors, Float32Array.from(samples.flatMap((sample) => sample.value)), "SCALAR", 5126);
        channels.push({ sampler: samplers.length, target: { node, path: "weights" } });
        samplers.push({
          input,
          output,
          interpolation: channel.interpolation === "step" ? "STEP" : "LINEAR"
        });
        continue;
      }
      if (!["translation", "rotation", "scale"].includes(path) || channel.axis !== void 0 || node === void 0 || bone === void 0 && !rigidNodeIds.has(channel.target) || clip.hierarchyId !== void 0 && clip.hierarchyId !== bone?.hierarchyId) {
        loss("channel has no explicit TRS node target");
        continue;
      }
      if (!channel.interpolation || !channel.samples?.length || path === "rotation" && channel.interpolation === "linear" || path !== "rotation" && channel.interpolation === "spherical-linear") {
        loss("channel interpolation is not representable by glTF TRS");
        continue;
      }
      const key = `${node}/${path}`;
      if (targets.has(key))
        refuse(`clip ${clip.id} has multiple channels for ${key}`);
      const cubic = channel.interpolation === "cubic-spline";
      let previous = -Infinity;
      const valid = channel.samples.every((sample) => {
        const time = Math.fround(sample.timeSeconds);
        const values = Float32Array.from(sample.value);
        const ok = Number.isFinite(time) && time >= 0 && time > previous && values.length === width && values.every(Number.isFinite) && (width !== 4 || unitQuaternion(values)) && (!cubic || [sample.inTangent, sample.outTangent].every((tangent) => tangent?.length === width && tangent.every((value) => Number.isFinite(value))));
        previous = time;
        return ok;
      });
      if (!valid) {
        loss("keys cannot be represented as finite, strictly increasing float32 glTF samples");
        continue;
      }
      if (cubic) {
        const times = Float32Array.from(channel.samples, (sample) => sample.timeSeconds);
        const input = addAccessor(storage.buffer, storage.views, storage.accessors, times, "SCALAR", 5126, void 0, { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] });
        const output = addAccessor(storage.buffer, storage.views, storage.accessors, Float32Array.from(channel.samples.flatMap((sample) => [
          ...sample.inTangent,
          ...sample.value,
          ...sample.outTangent
        ])), width === 4 ? "VEC4" : "VEC3", 5126);
        const keyTimes2 = uvmKeyTimesMetadata(channel.samples.map((sample) => sample.timeSeconds));
        const uv = {
          ...channel.concurrent === true ? {
            concurrent: true,
            ...channel.wrapSeconds === void 0 ? {} : { wrapSeconds: channel.wrapSeconds },
            ...channel.repeatCount === void 0 ? {} : { repeatCount: channel.repeatCount }
          } : {},
          ...keyTimes2
        };
        channels.push({
          sampler: samplers.length,
          target: { node, path },
          ...Object.keys(uv).length ? { extras: { uv } } : {}
        });
        samplers.push({ input, output, interpolation: "CUBICSPLINE" });
        targets.add(key);
        if (channel.samples.some((sample) => [
          sample.timeSeconds,
          ...sample.value,
          ...sample.inTangent,
          ...sample.outTangent
        ].some((value) => Math.fround(value) !== value)))
          loss("key times, values or tangents were rounded to the glTF float32 representation");
        continue;
      }
      const emitted = encodeAnimationChannel({
        lineType: channel.interpolation === "step" ? 0 : 1,
        globalSeqId: null,
        keys: channel.samples.map((sample) => ({
          frame: sample.timeSeconds,
          vector: sample.value
        }))
      }, width, node, path, samplers, channels, storage.buffer, storage.views, storage.accessors, channel.concurrent === true ? true : void 0, channel.wrapSeconds);
      if (!emitted) {
        loss("frozen UVM writer refused the channel");
        continue;
      }
      const emittedChannel = channels[channels.length - 1];
      const keyTimes = uvmKeyTimesMetadata(channel.samples.map((sample) => sample.timeSeconds));
      if (Object.keys(keyTimes).length) {
        emittedChannel["extras"] = {
          uv: {
            sourceLineType: channel.interpolation === "step" ? 0 : 1,
            ...channel.concurrent === true ? {
              concurrent: true,
              ...channel.wrapSeconds === void 0 ? {} : { wrapSeconds: channel.wrapSeconds },
              ...channel.repeatCount === void 0 ? {} : { repeatCount: channel.repeatCount }
            } : {},
            ...keyTimes
          }
        };
      }
      targets.add(key);
      if (channel.samples.some((sample) => Math.fround(sample.timeSeconds) !== sample.timeSeconds || sample.value.some((value) => Math.fround(value) !== value)))
        loss("key times or values were rounded to the glTF float32 representation");
    }
    if ((clip.unsupportedChannels ?? 0) > 0)
      losses.push({
        clipId: clip.id,
        reason: `${clip.unsupportedChannels} source channels are not represented by the facet`
      });
    const durationSeconds = clip.durationSeconds ?? clip.channels.reduce((end, channel) => (channel.samples ?? []).reduce((last, sample) => Math.max(last, sample.timeSeconds ?? 0), end), 0);
    const animationIndex = channels.length === 0 ? void 0 : animations.length;
    catalog.push({
      id: animationIndex === void 0 ? `sequence-${sequenceIndex}` : `animation-${animationIndex}`,
      sourceId: clip.id,
      name: clip.name,
      durationSeconds,
      sourceSequenceIndex: sequenceIndex,
      kind: clip.kind,
      frames: clip.frames,
      ...animationIndex === void 0 ? {} : { animation: animationIndex },
      ...clip.looping === void 0 ? {} : { looping: clip.looping },
      ...clip.repeatCount === void 0 ? {} : { repeatCount: clip.repeatCount }
    });
    if (animationIndex === void 0) {
      if ((clip.events?.length ?? 0) > 0)
        losses.push({ clipId: clip.id, reason: "events of a clip without motion are not written" });
      continue;
    }
    const events = (clip.events ?? []).map((event) => {
      const socket = event.nodeId === void 0 ? void 0 : nodeIndices.get(event.nodeId);
      if (event.nodeId !== void 0 && socket === void 0)
        refuse(`clip ${clip.id} names event node ${event.nodeId}, not a scene node`);
      return {
        t: event.timeSeconds,
        name: event.name,
        ...socket === void 0 ? {} : { socket },
        ...event.payload === void 0 ? {} : { payload: event.payload },
        ...event.durationSeconds === void 0 ? {} : { duration: event.durationSeconds }
      };
    });
    uvmAnimationEvents({ events }, Number.MAX_SAFE_INTEGER);
    const playback = uvmAnimationPlayback({
      ...clip.loop === void 0 ? {} : { loop: clip.loop },
      ...clip.priority === void 0 ? {} : { priority: clip.priority },
      ...clip.speedScale === void 0 ? {} : { speedScale: clip.speedScale },
      ...clip.blendInSeconds === void 0 ? {} : { blendInSeconds: clip.blendInSeconds },
      ...clip.blendOutSeconds === void 0 ? {} : { blendOutSeconds: clip.blendOutSeconds }
    });
    animations.push({
      name: clip.name,
      samplers,
      channels,
      ...Object.keys(playback).length === 0 && events.length === 0 ? {} : {
        extensions: {
          ...Object.keys(playback).length === 0 ? {} : { UV_game_animation_clips: { ...playback } },
          ...events.length === 0 ? {} : { UV_game_animation_events: { events } }
        }
      },
      extras: {
        uv: {
          sourceSequenceIndex: sequenceIndex,
          ...clip.durationSeconds === void 0 ? {} : { sourceDurationSeconds: clip.durationSeconds },
          ...clip.looping === void 0 ? {} : { looping: clip.looping },
          ...clip.repeatCount === void 0 ? {} : { repeatCount: clip.repeatCount }
        }
      }
    });
  }
  return { animations, catalog, visibility, losses };
}

// ../MODDING/modkit-core/packages/uv/dist/model/materializer.js
var GLTF_LAYER_SLOTS = Object.freeze({
  diffuse: "baseColor",
  basecolor: "baseColor",
  "base-color": "baseColor",
  albedo: "baseColor",
  color: "baseColor",
  normal: "normal",
  occlusion: "occlusion",
  ao: "occlusion",
  ambientocclusion: "occlusion",
  "ambient-occlusion": "occlusion",
  emissive: "emissive",
  emission: "emissive",
  teamcolor: "teamColor",
  "team-color": "teamColor",
  team: "teamColor"
});
function singleChannel(mask) {
  return mask === 1 ? "r" : mask === 2 ? "g" : mask === 4 ? "b" : mask === 8 ? "a" : void 0;
}
var GLTF_FILTER = { nearest: 9728, linear: 9729 };
function texturesWithSamplers(filters, colorKeys = []) {
  const samplers = [];
  const samplerOf = /* @__PURE__ */ new Map();
  const textures = filters.map((filter, index) => {
    const colorKey = colorKeys[index];
    const keyed = colorKey === void 0 ? {} : {
      extensions: {
        UV_texture_color_key: {
          color: [...colorKey.color],
          ...colorKey.tolerance === void 0 || colorKey.tolerance === 0 ? {} : { tolerance: colorKey.tolerance }
        }
      }
    };
    if (filter === void 0)
      return { source: index, ...keyed };
    let sampler = samplerOf.get(filter);
    if (sampler === void 0) {
      sampler = samplers.length;
      samplerOf.set(filter, sampler);
      samplers.push({ magFilter: GLTF_FILTER[filter], minFilter: GLTF_FILTER[filter] });
    }
    return { source: index, sampler, ...keyed };
  });
  return samplers.length === 0 ? { textures } : { textures, samplers };
}
var colorChannel = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
var UVM_GAME_BLEND_MODES = [
  "opaque",
  "alpha-blend",
  "alpha-test",
  "additive",
  "modulate",
  "modulate2x",
  "alpha-key",
  "screen",
  "subtract"
];
var isUvmGameBlendMode = (value) => UVM_GAME_BLEND_MODES.includes(value);
var MATERIALIZER_ID = "modkit/uvm-materializer";
var MATERIALIZER_VERSION = "1.0.0";
var PROFILE = "UVM/core@1.0";
var FLOAT = 5126;
var UINT32 = 5125;
var encoder = new TextEncoder();
function fail(message) {
  throw new TypeError(`UVM materialization refused: ${message}`);
}
function colorFactor(value, length, label) {
  if (value.length !== length || !value.every((component) => Number.isFinite(component) && component >= 0 && component <= 1))
    fail(`${label} must be ${length} finite components in 0..1`);
  return [...value];
}
function finite(values, label) {
  for (const value of values) {
    if (!Number.isFinite(value))
      fail(`${label} contains a non-finite number`);
  }
  return values;
}
function uvUnits(value) {
  if (value === void 0)
    return void 0;
  if (typeof value !== "object" || value === null)
    fail("options.units must be an object");
  const units = value;
  const positive = (key, required) => {
    const one = units[key];
    if (one === void 0 && !required)
      return void 0;
    if (typeof one !== "number" || !Number.isFinite(one) || one <= 0)
      fail(`options.units.${key} must be a positive finite number`);
    return one;
  };
  const metersPerSourceUnit = positive("metersPerSourceUnit", true);
  const sourceUnitsPerCell = positive("sourceUnitsPerCell", false);
  const sourceFrameRate = positive("sourceFrameRate", false);
  const { sourceUnit, footprintCells } = units;
  if (sourceUnit !== void 0 && (typeof sourceUnit !== "string" || sourceUnit.trim() === ""))
    fail("options.units.sourceUnit must be a non-empty string");
  if (footprintCells !== void 0 && (!Array.isArray(footprintCells) || footprintCells.length !== 2 || !footprintCells.every((cell) => typeof cell === "number" && Number.isFinite(cell) && cell > 0)))
    fail("options.units.footprintCells must be two positive numbers");
  return {
    ...sourceUnit === void 0 ? {} : { sourceUnit },
    metersPerSourceUnit,
    ...sourceUnitsPerCell === void 0 ? {} : { sourceUnitsPerCell },
    ...footprintCells === void 0 ? {} : { footprintCells: [...footprintCells] },
    ...sourceFrameRate === void 0 ? {} : { sourceFrameRate }
  };
}
function closeTo(composed, stated) {
  return Math.abs(composed - stated) <= 1e-4 * Math.max(1, Math.abs(stated));
}
var byUtf8 = (left, right) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index])
      return a[index] - b[index];
  }
  return a.length - b.length;
};
function positionalOrder(ids, pattern) {
  const slots = new Array(ids.length).fill(void 0);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match === null)
      return null;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= ids.length)
      return null;
    if (slots[index] !== void 0)
      return null;
    slots[index] = id;
  }
  return slots.every((slot) => slot !== void 0) ? slots : null;
}
var BufferBuilder2 = class {
  buffer = new BufferBuilder();
  views = [];
  /** Appends one 4-byte-aligned view and returns its bufferView index. */
  push(typed) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const offset = this.buffer.append(bytes);
    this.views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    return this.views.length - 1;
  }
  build() {
    return this.buffer.finish();
  }
};
var MATERIALIZER_GAME_EXTENSIONS = /* @__PURE__ */ new Set([
  "UV_game_socket",
  "UV_game_material",
  "UV_game_material_team_color",
  "UV_game_animation_clips",
  "UV_game_variants"
]);
function isJsonValue(value, depth) {
  if (depth > 64)
    return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}
function gameExtensionsOf(projection) {
  const entries = Object.entries(projection.gameExtensions ?? {});
  for (const [name, value] of entries) {
    if (!/^UV_game_[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(name) || MATERIALIZER_GAME_EXTENSIONS.has(name))
      throw new TypeError(`game extension ${name} is not a UV_game_<id> record a projection writes`);
    if (typeof value !== "object" || Array.isArray(value) || !isJsonValue(value, 0))
      throw new TypeError(`game extension ${name} is not a JSON object`);
  }
  return entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
function materializeUvmCore(projection, request, { digest, materialBudget = DEFAULT_MODEL_MATERIAL_BUDGET, skeletonBudget = DEFAULT_MODEL_SKELETON_BUDGET, animationBudget = DEFAULT_MODEL_ANIMATION_BUDGET, signal } = {}) {
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  const info = projection?.info;
  if (info === void 0)
    fail("the projection carries no info");
  if (request?.scope === void 0)
    fail("a materialization request must name its semantic scope");
  const assetId = request.options?.assetId;
  if (typeof assetId !== "string" || assetId.trim() === "") {
    fail("the request must carry options.assetId: the profile requires an identity, and inventing one would be a lie about provenance");
  }
  const sourceFormat = request.options?.sourceFormat;
  if (typeof sourceFormat !== "string" || sourceFormat.trim() === "") {
    fail("the request must carry options.sourceFormat: UV_provenance records where the artifact came from");
  }
  const diff = [];
  const lostFacetIds = [];
  const excludedFacetIds = [...projection.excludedFacetIds ?? []];
  const losses = [];
  const note = (facetId, change, path, message) => {
    diff.push({ facetId, change, ...path === void 0 ? {} : { path }, note: message });
  };
  const liveNodes = [...projection.nodes ?? []];
  const liveMeshes = [...projection.meshes ?? []];
  const primitives = projection.primitives === void 0 ? void 0 : [...projection.primitives];
  if (info.geometryAccess === "decoded" && primitives === void 0) {
    fail("geometryAccess is decoded but the projection carries no primitives");
  }
  if (info.geometryAccess === "metadata-only" && primitives !== void 0) {
    fail("geometryAccess is metadata-only but the projection carries primitives");
  }
  const nodeOrder = positionalOrder(liveNodes.map((node) => node.id), /^node-(\d+)$/u);
  const meshOrder = positionalOrder(liveMeshes.map((mesh) => mesh.id), /^mesh-(\d+)$/u);
  const identityPreserved = nodeOrder !== null && meshOrder !== null;
  const orderedNodes = identityPreserved ? nodeOrder.map((id) => liveNodes.find((node) => node.id === id)) : [...liveNodes].sort((left, right) => byUtf8(left.id, right.id));
  const orderedMeshes = identityPreserved ? meshOrder.map((id) => liveMeshes.find((mesh) => mesh.id === id)) : [...liveMeshes].sort((left, right) => byUtf8(left.id, right.id));
  const primitiveIdentityPreserved = identityPreserved && orderedMeshes.every((mesh, meshIndex) => (mesh.primitiveIds ?? []).every((id, index) => id === `mesh-${meshIndex}-primitive-${index}`));
  if (!identityPreserved) {
    note("uv.model/hierarchy@1", "value-differs", "/nodes/*/id", "the source names its nodes outside the positional convention of the artifact binding, so reopening renumbers them");
    note("uv.model/mesh-index@1", "value-differs", "/meshes/*/id", "the source names its meshes outside the positional convention of the artifact binding, so reopening renumbers them");
    losses.push("node and mesh identity renumbered to the positional artifact convention");
  }
  if (!primitiveIdentityPreserved && primitives !== void 0) {
    note("uv.model/geometry@1", "value-differs", "/primitives/*/id", "a primitive is named after the mesh that owns it and its place in that mesh, so reopening renames it whenever the source did not already use that form");
    note("uv.model/mesh-index@1", "value-differs", "/meshes/*/primitiveIds", "the primitive ids a mesh lists are renamed with the primitives themselves");
    losses.push("primitive identity renumbered to the positional artifact convention");
  }
  const nodeIndexById = new Map(orderedNodes.map((node, index) => [node.id, index]));
  const meshIndexById = new Map(orderedMeshes.map((mesh, index) => [mesh.id, index]));
  const buffers = new BufferBuilder2();
  const accessors = [];
  const rigStorage = { buffer: buffers.buffer, views: buffers.views, accessors };
  const skeleton = projection.skeleton === void 0 ? void 0 : prepareUvmSkeleton(projection.skeleton, orderedNodes, rigStorage, skeletonBudget, signal);
  const meshSkins = /* @__PURE__ */ new Map();
  const emittedMeshes = [];
  const materialIds = /* @__PURE__ */ new Set();
  let emittedPrimitives = 0;
  const primitiveById = new Map((primitives ?? []).map((item) => [item.id, item]));
  const primitiveIndices = /* @__PURE__ */ new Map();
  const ambiguousPrimitiveIds = /* @__PURE__ */ new Set();
  const meshTargetNames = /* @__PURE__ */ new Map();
  for (const mesh of orderedMeshes) {
    const meshPrimitives = [];
    for (const primitiveId of mesh.primitiveIds ?? []) {
      const primitive = primitiveById.get(primitiveId);
      if (primitive === void 0) {
        if (primitives === void 0)
          continue;
        fail(`mesh \xAB${mesh.id}\xBB names primitive \xAB${primitiveId}\xBB, which the projection does not publish`);
      }
      const positions = Float32Array.from(finite(primitive.positions, `primitive ${primitive.id} positions`));
      if (positions.length === 0 || positions.length % 3 !== 0) {
        fail(`primitive \xAB${primitive.id}\xBB does not carry VEC3 positions`);
      }
      if (primitive.topology !== "triangles") {
        losses.push(`primitive ${primitive.id} is ${primitive.topology}, which UVM/core does not carry`);
        note("uv.model/geometry@1", "absent-in-artifact", `/primitives/${primitive.id}`, `UVM/core carries triangles only; \xAB${primitive.topology}\xBB was not written`);
        continue;
      }
      const vertexCount = positions.length / 3;
      const attributes = {};
      attributes["POSITION"] = accessors.length;
      const positionBounds = boundsOf(positions);
      accessors.push({
        bufferView: buffers.push(positions),
        componentType: FLOAT,
        count: vertexCount,
        type: "VEC3",
        min: positionBounds.min,
        max: positionBounds.max
      });
      const attribute = (semantic, values, width) => {
        const data = Float32Array.from(finite(values, `primitive ${primitive.id} ${semantic}`));
        if (data.length !== vertexCount * width || !data.every(Number.isFinite)) {
          fail(`primitive ${primitive.id} ${semantic} must contain ${vertexCount} finite VEC${width} values`);
        }
        if (semantic === "TANGENT" && data.some((value, index) => index % 4 === 3 && value !== -1 && value !== 1)) {
          fail(`primitive ${primitive.id} tangent handedness must be -1 or 1`);
        }
        if (semantic === "NORMAL" || semantic === "TANGENT") {
          for (let offset = 0; offset < data.length; offset += width) {
            if (Math.hypot(data[offset], data[offset + 1], data[offset + 2]) !== 0)
              continue;
            const message = `${semantic} omitted: a vertex has a zero-length direction`;
            losses.push(`primitive ${primitive.id}: ${message}`);
            note("uv.model/geometry@1", "absent-in-artifact", `/primitives/${primitive.id}/${semantic}`, message);
            return;
          }
          let normalized = 0;
          for (let offset = 0; offset < data.length; offset += width) {
            const length = Math.hypot(data[offset], data[offset + 1], data[offset + 2]);
            if (Math.abs(length - 1) <= 1e-4)
              continue;
            for (let axis = 0; axis < 3; axis++)
              data[offset + axis] = data[offset + axis] / length;
            normalized++;
          }
          if (normalized > 0) {
            const message = `${normalized} ${semantic} directions normalized to the unit vectors required by glTF`;
            losses.push(`primitive ${primitive.id}: ${message}`);
            note("uv.model/geometry@1", "value-differs", `/primitives/${primitive.id}/${semantic}`, message);
          }
        }
        attributes[semantic] = accessors.length;
        accessors.push({
          bufferView: buffers.push(data),
          componentType: FLOAT,
          count: vertexCount,
          type: `VEC${width}`
        });
      };
      if (primitive.normals != null)
        attribute("NORMAL", primitive.normals, 3);
      if (primitive.tangents != null && attributes["NORMAL"] === void 0) {
        const message = "TANGENT omitted: the primitive has no normals";
        losses.push(`primitive ${primitive.id}: ${message}`);
        note("uv.model/geometry@1", "absent-in-artifact", `/primitives/${primitive.id}/TANGENT`, message);
      } else if (primitive.tangents != null)
        attribute("TANGENT", primitive.tangents, 4);
      if (primitive.colors != null)
        attribute("COLOR_0", primitive.colors, 4);
      const uvSets = /* @__PURE__ */ new Map();
      for (const channel of primitive.textureCoordinateSets ?? []) {
        if (!Number.isSafeInteger(channel.set) || channel.set < 0 || uvSets.has(channel.set)) {
          fail(`primitive ${primitive.id} has an invalid or duplicate UV set`);
        }
        uvSets.set(channel.set, channel.coordinates);
      }
      if (primitive.textureCoordinates != null) {
        const setZero = uvSets.get(0);
        if (setZero !== void 0 && (setZero.length !== primitive.textureCoordinates.length || setZero.some((value, index) => value !== primitive.textureCoordinates?.[index]))) {
          fail(`primitive ${primitive.id} has conflicting UV set zero values`);
        }
        uvSets.set(0, primitive.textureCoordinates);
      }
      const orderedUvSets = [...uvSets].sort(([a], [b]) => a - b);
      if (orderedUvSets.some(([set], index) => set !== index)) {
        fail(`primitive ${primitive.id} UV sets must be consecutive from zero for UVM/core`);
      }
      for (const [set, coordinates] of orderedUvSets) {
        attribute(`TEXCOORD_${set}`, coordinates, 2);
      }
      if (primitive.boneIndices !== void 0 || primitive.boneWeights !== void 0) {
        if (skeleton === void 0) {
          losses.push(`primitive ${primitive.id} skin bindings require a skeleton projection`);
          note("uv.model/geometry@1", "absent-in-artifact", `/primitives/${primitive.id}/skin`, "bone indices and weights cannot be materialized without their skeleton and bind transforms");
        } else {
          const skin = writeUvmSkinAttributes(primitive, attributes, skeleton, rigStorage);
          if (meshSkins.has(mesh.id) && meshSkins.get(mesh.id) !== skin)
            fail(`mesh ${mesh.id} mixes different skin bindings`);
          meshSkins.set(mesh.id, skin);
        }
      } else {
        if (meshSkins.has(mesh.id) && meshSkins.get(mesh.id) !== null)
          fail(`mesh ${mesh.id} mixes skinned and unskinned primitives`);
        meshSkins.set(mesh.id, null);
      }
      const indexValues = primitive.indices === void 0 || primitive.indices === null ? Uint32Array.from({ length: vertexCount }, (_unused, index) => index) : Uint32Array.from(primitive.indices);
      const indicesAccessor = accessors.length;
      accessors.push({
        bufferView: buffers.push(indexValues),
        componentType: UINT32,
        count: indexValues.length,
        type: "SCALAR"
      });
      const entry = { attributes, indices: indicesAccessor };
      const morphTargets = primitive.morphTargets ?? [];
      const names = morphTargets.map((target) => target.name);
      const priorNames = meshTargetNames.get(mesh.id);
      if (priorNames !== void 0 && (priorNames.length !== names.length || priorNames.some((name, at) => name !== names[at])))
        fail(`mesh ${mesh.id} primitives disagree on their morph targets`);
      meshTargetNames.set(mesh.id, names);
      if (morphTargets.length > 0) {
        entry.targets = morphTargets.map((target, at) => {
          const delta = (values, semantic) => {
            const data = Float32Array.from(finite(values, `primitive ${primitive.id} morph target ${at} ${semantic}`));
            if (data.length !== vertexCount * 3)
              fail(`primitive ${primitive.id} morph target ${at} ${semantic} must contain ${vertexCount} VEC3 deltas`);
            return data;
          };
          const positionDeltas = delta(target.positions, "POSITION");
          const deltaBounds = boundsOf(positionDeltas);
          const target_ = { POSITION: accessors.length };
          accessors.push({
            bufferView: buffers.push(positionDeltas),
            componentType: FLOAT,
            count: vertexCount,
            type: "VEC3",
            min: deltaBounds.min,
            max: deltaBounds.max
          });
          for (const [semantic, values] of [
            ["NORMAL", target.normals],
            ["TANGENT", target.tangents]
          ]) {
            if (values === void 0)
              continue;
            target_[semantic] = accessors.length;
            accessors.push({
              bufferView: buffers.push(delta(values, semantic)),
              componentType: FLOAT,
              count: vertexCount,
              type: "VEC3"
            });
          }
          return target_;
        });
      }
      if (typeof primitive.materialId === "string") {
        materialIds.add(primitive.materialId);
        entry.material = primitive.materialId;
      }
      if (primitiveIndices.has(primitive.id))
        ambiguousPrimitiveIds.add(primitive.id);
      if (ambiguousPrimitiveIds.has(primitive.id))
        primitiveIndices.delete(primitive.id);
      else
        primitiveIndices.set(primitive.id, {
          mesh: emittedMeshes.length,
          primitive: meshPrimitives.length
        });
      meshPrimitives.push(entry);
      emittedPrimitives += 1;
    }
    emittedMeshes.push({ mesh, primitives: meshPrimitives });
  }
  const definitions = projection.materials === void 0 ? void 0 : snapshotModelMaterials(projection.materials, materialBudget, signal);
  if (definitions !== void 0 && definitions.length !== Number(info.materials ?? 0)) {
    fail("material definitions do not match the declared material count");
  }
  const definitionsById = new Map(definitions?.map((material) => [material.id, material]));
  if (definitions !== void 0) {
    for (const id of materialIds)
      if (!definitionsById.has(id))
        fail(`primitive refers to undefined material ${id}`);
  }
  const referenced = [.../* @__PURE__ */ new Set([...materialIds, ...definitionsById.keys()])];
  const materialIndexById = /* @__PURE__ */ new Map();
  const materialCount = Math.max(Number(info.materials ?? 0), referenced.length);
  if (!Number.isSafeInteger(materialCount) || materialCount < 0 || materialCount > materialBudget.maxNodes) {
    fail("material count exceeds the material budget");
  }
  const positionalMaterials = referenced.every((id) => {
    const match = /^material-(0|[1-9]\d*)$/u.exec(id);
    if (match === null)
      return false;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= materialCount)
      return false;
    if ([...materialIndexById.values()].includes(index))
      return false;
    materialIndexById.set(id, index);
    return true;
  });
  if (!positionalMaterials) {
    materialIndexById.clear();
    for (const [index, id] of [...referenced].sort(byUtf8).entries())
      materialIndexById.set(id, index);
    if (referenced.length > 0) {
      note("uv.model/geometry@1", "value-differs", "/primitives/*/materialId", "the source names its materials outside the positional convention, so reopening renumbers them");
    }
    if (definitions !== void 0)
      note("common.view/model-material-source@1", "value-differs", "/materials/*/id", "material identity was renumbered to the positional UVM artifact convention");
  }
  const materials = Array.from({ length: materialCount }, () => ({
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 }
  }));
  for (const definition of definitions ?? []) {
    const index = materialIndexById.get(definition.id);
    const target = materials[index];
    const { id: _id, name, shader, contracts, alphaMode, alphaCutoff, doubleSided, baseColorFactor, emissiveFactor, unlit, metallicFactor, roughnessFactor, ...fields } = definition;
    if (name !== void 0)
      target.name = name;
    if (alphaMode !== void 0)
      target.alphaMode = alphaMode === "opaque" ? "OPAQUE" : alphaMode === "mask" ? "MASK" : "BLEND";
    if (alphaCutoff !== void 0)
      target.alphaCutoff = alphaCutoff;
    if (doubleSided === true)
      target.doubleSided = true;
    if (metallicFactor !== void 0)
      target.pbrMetallicRoughness.metallicFactor = colorFactor([metallicFactor], 1, `material ${definition.id} metallicFactor`)[0];
    if (roughnessFactor !== void 0)
      target.pbrMetallicRoughness.roughnessFactor = colorFactor([roughnessFactor], 1, `material ${definition.id} roughnessFactor`)[0];
    if (baseColorFactor !== void 0)
      target.pbrMetallicRoughness.baseColorFactor = colorFactor(baseColorFactor, 4, `material ${definition.id} baseColorFactor`);
    if (emissiveFactor !== void 0)
      target.emissiveFactor = colorFactor(emissiveFactor, 3, `material ${definition.id} emissiveFactor`);
    if (Object.keys(fields).length > 0)
      target.extras = { modkit: { material: { version: 1, fields } } };
    const artifactContracts = [];
    if (shader !== void 0) {
      const blendMode = fields["blendMode"];
      const { depthWrite, priority } = fields;
      target.extensions = {
        UV_game_material: {
          shader: shader.id,
          ...isUvmGameBlendMode(blendMode) ? { blendMode } : {},
          ...depthWrite === void 0 ? {} : { depthWrite },
          // the extension's integer order; a fractional priority stays in extras only
          ...priority !== void 0 && Number.isSafeInteger(priority) ? { sortPriority: priority } : {},
          params: shader.parameters
        }
      };
      const renderModel = shader.parameters["renderModel"];
      if (renderModel !== null && typeof renderModel === "object" && !Array.isArray(renderModel)) {
        const snapshot = renderModel;
        if (snapshot["version"] === 1 && snapshot["standard"] !== void 0)
          artifactContracts.push("UV_game_material/standard");
        if (snapshot["version"] === 1 && snapshot["composite"] !== void 0)
          artifactContracts.push("UV_game_material/composite");
      }
    }
    if (unlit === true)
      target.extensions = { ...target.extensions, KHR_materials_unlit: {} };
    const wholeTeam = definition.layers?.find((layer) => GLTF_LAYER_SLOTS[layer.slot.toLowerCase()] === "teamColor" && layer.resourceId === void 0);
    if (wholeTeam !== void 0)
      target.extensions = {
        ...target.extensions,
        UV_game_material_team_color: {
          maskSource: "whole",
          targets: ["baseColor"],
          blend: wholeTeam.blend ?? "multiply"
        }
      };
    if (JSON.stringify([...contracts ?? []].sort(byUtf8)) !== JSON.stringify(artifactContracts.sort(byUtf8))) {
      note("common.view/model-material-source@1", "value-differs", `/materials/${definition.id}/contracts`, "contract coverage is derived from the extensions actually written to UVM");
    }
    const omitted = (contracts ?? []).filter((contract) => !artifactContracts.includes(contract));
    if (omitted.length > 0) {
      lostFacetIds.push("common.view/model-material-source@1");
      losses.push(`material ${definition.id}: contract payloads not available: ${omitted.join(", ")}`);
    }
  }
  const closure = projection.resourceClosure;
  const resourceImages = [];
  const imageLogicalIds = [];
  const imageFilters = [];
  const imageColorKeys = [];
  if (closure !== void 0 && closure !== null) {
    if (closure.mode !== "logical" && closure.mode !== "content-qualified") {
      fail("resourceClosure.mode must be logical or content-qualified");
    }
    for (const entry of closure.entries ?? []) {
      if (entry?.role !== "image" && entry?.role !== "texture")
        continue;
      if (typeof entry.logicalId !== "string" || entry.logicalId === "") {
        fail("every image/texture resource-closure entry needs a non-empty logicalId");
      }
      if (entry.filter !== void 0 && entry.filter !== "nearest" && entry.filter !== "linear") {
        fail("a resource-closure filter is nearest or linear");
      }
      const colorKey = entry.colorKey;
      if (colorKey !== void 0 && (!Array.isArray(colorKey.color) || colorKey.color.length !== 3 || !colorKey.color.every(colorChannel) || colorKey.tolerance !== void 0 && !colorChannel(colorKey.tolerance))) {
        fail("a resource-closure colour key is three stored 8-bit channels and a 0..255 tolerance");
      }
      resourceImages.push({
        uri: uvmImageUri(entry.logicalId),
        ...typeof entry.mediaHint === "string" ? { mimeType: entry.mediaHint } : {}
      });
      imageLogicalIds.push(entry.logicalId);
      imageFilters.push(entry.filter);
      imageColorKeys.push(colorKey === void 0 ? void 0 : {
        color: [colorKey.color[0], colorKey.color[1], colorKey.color[2]],
        ...colorKey.tolerance === void 0 ? {} : { tolerance: colorKey.tolerance }
      });
    }
    const uncarried = (closure.entries ?? []).filter((entry) => entry?.role !== "image" && entry?.role !== "texture");
    if (uncarried.length > 0) {
      lostFacetIds.push("uv.model/resource-closure@1");
      note("uv.model/resource-closure@1", "value-differs", void 0, `${uncarried.length} non-image resource closure entry or entries have no UVM/core artifact binding`);
    }
    if ((closure.unavailable ?? []).length > 0) {
      lostFacetIds.push("uv.model/resource-closure@1");
      const ids = closure.unavailable.map((entry) => entry.logicalId).join(", ");
      losses.push(`${closure.unavailable.length} resource reference(s) were unavailable: ${ids}`);
      note("uv.model/resource-closure@1", "value-differs", void 0, `${closure.unavailable.length} resource reference(s) did not resolve through ResourceSessionPort: ${ids}`);
    }
  }
  if (Number(info.textures ?? 0) > 0 && closure === void 0) {
    losses.push(`${info.textures} texture reference(s) were not carried`);
    note("uv.model/structure@1", "value-differs", "/textures", "the base model contract publishes a texture count but no texture identity; writing empty texture objects to make the count match would be inventing data");
  }
  const imageIndex = new Map(imageLogicalIds.map((logicalId, index) => [logicalId, index]));
  for (const definition of imageIndex.size === 0 ? [] : definitions ?? []) {
    const target = materials[materialIndexById.get(definition.id)];
    for (const layer of definition.layers ?? []) {
      const slot = GLTF_LAYER_SLOTS[layer.slot.toLowerCase()];
      const index = layer.resourceId === void 0 ? void 0 : imageIndex.get(layer.resourceId);
      if (slot === void 0 || index === void 0)
        continue;
      const ref = {
        index,
        ...layer.uvSource !== void 0 && Number.isSafeInteger(layer.uvSource) && layer.uvSource > 0 ? { texCoord: layer.uvSource } : {}
      };
      if (slot === "baseColor")
        target.pbrMetallicRoughness.baseColorTexture ??= ref;
      else if (slot === "normal")
        target.normalTexture ??= ref;
      else if (slot === "occlusion")
        target.occlusionTexture ??= ref;
      else if (slot === "emissive" && target.emissiveTexture === void 0) {
        target.emissiveTexture = ref;
        target.emissiveFactor ??= [1, 1, 1];
      } else if (slot === "teamColor" && target.extensions?.UV_game_material_team_color === void 0) {
        const channel = singleChannel(layer.colorChannels);
        target.extensions = {
          ...target.extensions,
          UV_game_material_team_color: {
            maskSource: "texture",
            maskTexture: { ...ref, ...channel === void 0 ? {} : { channel } },
            targets: ["baseColor"],
            blend: layer.blend ?? "multiply"
          }
        };
      }
    }
  }
  if (closure !== void 0 && resourceImages.length !== Number(info.textures ?? 0)) {
    note("uv.model/structure@1", "value-differs", "/textures", `the resource closure carries ${resourceImages.length} image identity or identities, while the base model contract counts ${Number(info.textures ?? 0)} texture(s)`);
  }
  if (Number(info.animations ?? 0) > 0 && projection.animations === void 0) {
    losses.push(`${info.animations} animation(s) were not carried`);
    note("uv.model/structure@1", "value-differs", "/animations", "the base model contract publishes an animation count but no clips or channels; the optional animation facet is what will carry them");
  }
  if (Number(info.scenes ?? 1) !== 1) {
    note("uv.model/structure@1", "value-differs", "/scenes", "UVM/core describes a single game object, so exactly one scene is written");
  }
  if (primitives === void 0) {
    excludedFacetIds.push("uv.model/geometry@1");
    note("uv.model/geometry@1", "absent-in-live", void 0, "the source is metadata-only, so there was no geometry to carry");
    note("uv.model/structure@1", "value-differs", "/geometryAccess", "a metadata-only projection materialises into a document the artifact binding reopens as \xABdecoded\xBB; the flag describes the reader, and no byte written here could carry the source\u2019s answer");
  }
  const liveBounds = info.bounds !== void 0 && info.bounds !== null;
  const artifactBounds = emittedPrimitives > 0;
  if (liveBounds && !artifactBounds) {
    note("uv.model/bounds@1", "absent-in-artifact", void 0, "the artifact binding derives bounds from decoded geometry, and this materialization wrote none");
  }
  if (!liveBounds && artifactBounds) {
    note("uv.model/bounds@1", "absent-in-live", void 0, "the artifact binding derives bounds from decoded geometry, so reopening publishes bounds this source did not");
  }
  if (primitives === void 0 && Number(info.primitives ?? 0) > 0) {
    note("uv.model/structure@1", "value-differs", "/primitives", "a metadata-only source counts primitives it does not publish; the artifact carries only what was written");
  }
  const childless = new Set(orderedNodes.map((node) => node.id));
  for (const node of orderedNodes) {
    for (const child of node.childIds ?? [])
      childless.delete(child);
  }
  let rootIndices = orderedNodes.filter((node) => childless.has(node.id)).map((node) => nodeIndexById.get(node.id));
  const socketByNodeId = /* @__PURE__ */ new Map();
  const socketIds = /* @__PURE__ */ new Set();
  const roleOrdinals = /* @__PURE__ */ new Map();
  for (const socket of projection.sockets ?? []) {
    if (typeof socket?.id !== "string" || socket.id.length === 0 || typeof socket.nodeId !== "string" || typeof socket.role !== "string" || socket.role.length === 0) {
      fail("every socket needs non-empty id, nodeId and role");
    }
    if (!nodeIndexById.has(socket.nodeId)) {
      fail(`socket \xAB${socket.id}\xBB targets absent node \xAB${socket.nodeId}\xBB`);
    }
    if (socketByNodeId.has(socket.nodeId)) {
      fail(`node \xAB${socket.nodeId}\xBB carries more than one socket`);
    }
    if (socketIds.has(socket.id))
      fail(`socket \xAB${socket.id}\xBB is duplicated`);
    socketIds.add(socket.id);
    const index = roleOrdinals.get(socket.role) ?? 0;
    roleOrdinals.set(socket.role, index + 1);
    socketByNodeId.set(socket.nodeId, {
      .../^[a-z][a-z0-9-]*$/u.test(socket.id) ? { id: socket.id } : {},
      role: socket.role,
      index,
      ...typeof socket.sourceName === "string" ? { sourceName: socket.sourceName } : {},
      ...socket.orientation === void 0 ? {} : { forward: socket.orientation.forward, up: socket.orientation.up },
      // Preserve the previous publisher metadata while the shared socket ID is authoritative.
      extras: { modkit: { id: socket.id, nodeId: socket.nodeId } }
    });
  }
  let billboardNodes = 0;
  const nodeBillboard = (id, billboard) => {
    if (billboard.mode === "inverse-camera") {
      const rotations = billboard.basisRotations;
      if (rotations.length > 4)
        fail(`node \xAB${id}\xBB billboard needs at most four basis rotations`);
      for (const rotation of rotations)
        if (rotation.length !== 4 || !rotation.every((value) => Number.isFinite(Math.fround(value))) || Math.hypot(...rotation) === 0)
          fail(`node \xAB${id}\xBB billboard basis rotation must be a finite nonzero quaternion`);
      return {
        schemaVersion: 1,
        mode: "inverse-camera",
        basisRotations: rotations.map((rotation) => [...rotation])
      };
    }
    if (billboard.mode === "face-camera") {
      if (billboard.rotationAxes !== "z" && billboard.rotationAxes !== "xz")
        fail(`node \xAB${id}\xBB billboard rotation axes must be z or xz`);
      finite([...billboard.pivot], `node ${id} billboard pivot`);
      if (billboard.pivot.length !== 3)
        fail(`node \xAB${id}\xBB billboard pivot must carry 3 numbers`);
      return {
        schemaVersion: 1,
        mode: "face-camera",
        rotationAxes: billboard.rotationAxes,
        pivot: [...billboard.pivot]
      };
    }
    if (billboard.mode === "aim") {
      if (billboard.aim !== "view" && billboard.aim !== "eye")
        fail(`node \xAB${id}\xBB aim billboard must aim along the view or from the eye`);
      if (!["free", "frame-x", "frame-y", "frame-z", "own-x", "own-y"].includes(billboard.lock))
        fail(`node \xAB${id}\xBB aim billboard lock is unknown`);
      const quaternion = (value, label) => {
        if (value === void 0)
          return void 0;
        if (value.length !== 4 || !value.every((item) => Number.isFinite(Math.fround(item))) || Math.hypot(...value) === 0)
          fail(`node \xAB${id}\xBB aim billboard ${label} must be a finite nonzero quaternion`);
        return [...value];
      };
      const correction = quaternion(billboard.correction, "correction");
      const rootCorrection = quaternion(billboard.rootCorrection, "root correction");
      return {
        schemaVersion: 1,
        mode: "aim",
        aim: billboard.aim,
        lock: billboard.lock,
        ...correction === void 0 ? {} : { correction },
        ...rootCorrection === void 0 ? {} : { rootCorrection }
      };
    }
    return fail(`node \xAB${id}\xBB billboard mode is unknown`);
  };
  const meshChildren = [];
  const documentNodes = orderedNodes.map((node) => {
    const entry = {};
    const bone = skeleton?.boneByNode.get(node.id);
    if (typeof node.name === "string")
      entry.name = node.name;
    else if (typeof bone?.boneName === "string" && bone.boneName.length > 0)
      entry.name = bone.boneName;
    const children = (node.childIds ?? []).map((child) => nodeIndexById.get(child)).filter((index) => index !== void 0);
    const [meshId, ...moreMeshIds] = node.meshIds ?? [];
    if (meshId !== void 0 && meshIndexById.has(meshId))
      entry.mesh = meshIndexById.get(meshId);
    const skin = meshId === void 0 ? void 0 : meshSkins.get(meshId);
    if (skin !== void 0 && skin !== null)
      entry.skin = skin;
    for (const id of moreMeshIds) {
      const mesh = meshIndexById.get(id);
      if (mesh === void 0)
        continue;
      const child = { mesh };
      const childSkin = meshSkins.get(id);
      if (childSkin !== void 0 && childSkin !== null)
        child.skin = childSkin;
      children.push(orderedNodes.length + meshChildren.length);
      meshChildren.push(child);
    }
    if (children.length > 0)
      entry.children = children;
    const transform = finite([...node.transform ?? []], `node ${node.id} transform`);
    if (transform.length !== 16)
      fail(`node \xAB${node.id}\xBB transform must carry 16 numbers`);
    if (bone !== void 0) {
      entry.translation = [...bone.localPose.translation];
      entry.rotation = [...bone.localPose.rotation];
      entry.scale = [...bone.localPose.scale];
    } else if (node.trs !== void 0) {
      const { translation, rotation, scale } = node.trs;
      finite([...translation, ...rotation, ...scale], `node ${node.id} trs`);
      if (Math.abs(Math.hypot(...rotation) - 1) > 1e-4)
        fail(`node \xAB${node.id}\xBB trs rotation must be a unit quaternion`);
      const composed = new Float32Array(16);
      composeTrsMatrix(composed, 0, translation, rotation, scale);
      if (composed.some((value, index) => !closeTo(value, transform[index])))
        fail(`node \xAB${node.id}\xBB trs does not compose to its transform`);
      entry.translation = [...translation];
      entry.rotation = [...rotation];
      entry.scale = [...scale];
    } else if (transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0))) {
      entry.matrix = transform;
    }
    const socket = socketByNodeId.get(node.id);
    const billboard = node.billboard === void 0 ? void 0 : nodeBillboard(node.id, node.billboard);
    if (billboard !== void 0)
      billboardNodes += 1;
    if (socket !== void 0 || billboard !== void 0)
      entry.extensions = {
        ...socket === void 0 ? {} : { UV_game_socket: socket },
        ...billboard === void 0 ? {} : { UV_node_billboard: billboard }
      };
    return entry;
  });
  documentNodes.push(...meshChildren);
  const documentMeshes = emittedMeshes.map(({ mesh, primitives: entries }) => {
    const value = {};
    if (typeof mesh.name === "string")
      value.name = mesh.name;
    value.primitives = entries.map((entry) => {
      const primitive = { attributes: entry.attributes, indices: entry.indices };
      if (entry.material !== void 0)
        primitive.material = materialIndexById.get(entry.material);
      if (entry.targets !== void 0)
        primitive.targets = entry.targets;
      return primitive;
    });
    const names = meshTargetNames.get(mesh.id) ?? [];
    if (names.length > 0) {
      const weights = mesh.morphWeights ?? names.map(() => 0);
      if (weights.length !== names.length || !weights.every(Number.isFinite))
        fail(`mesh ${mesh.id} morph weights must be ${names.length} finite numbers`);
      value.weights = [...weights];
      if (names.every((name) => typeof name === "string"))
        value.extras = { targetNames: names };
    } else if (mesh.morphWeights !== void 0 && mesh.morphWeights.length > 0) {
      fail(`mesh ${mesh.id} has morph weights but no morph targets`);
    }
    return value;
  });
  for (const group of skeleton?.groupingRoots ?? []) {
    const existing = group.children.length === 1 ? group.children[0] : documentNodes.findIndex((node) => group.children.every((child) => node.children?.includes(child)));
    if (existing >= 0) {
      skeleton.skins[group.skin].skeleton = existing;
      continue;
    }
    const root = documentNodes.length;
    documentNodes.push({ children: [...group.children] });
    const children = new Set(group.children);
    rootIndices = [...rootIndices.filter((index) => !children.has(index)), root];
    skeleton.skins[group.skin].skeleton = root;
    note("uv.model/hierarchy@1", "absent-in-live", `/nodes/node-${root}`, "an identity grouping node gives the independent skeleton roots a common glTF ancestor");
    note("uv.model/structure@1", "value-differs", "/nodes", "glTF skin grouping adds one identity scene node");
  }
  let lodSelection;
  if (projection.lods !== void 0 && projection.lods.length > 0) {
    const levels = [...projection.lods].sort((a, b) => a.order - b.order);
    if (levels.length < 2)
      fail("discrete LOD needs at least two levels");
    if (levels.some((level, at) => at > 0 && level.order === levels[at - 1].order))
      fail("two LOD levels share an order");
    const claimed = /* @__PURE__ */ new Set();
    const groups = levels.map((level) => {
      if (level.nodeIds.length === 0)
        fail(`LOD level ${level.id} names no nodes`);
      const members = level.nodeIds.map((id) => {
        const index = nodeIndexById.get(id);
        if (index === void 0)
          fail(`LOD level ${level.id} names unknown node ${id}`);
        if (!rootIndices.includes(index))
          fail(`LOD level ${level.id} node ${id} is not a scene root; levels group whole root nodes`);
        if (claimed.has(index))
          fail(`node ${id} belongs to two LOD levels`);
        claimed.add(index);
        return index;
      });
      const group = documentNodes.length;
      documentNodes.push({ name: `uv:lod-${level.order}`, children: members });
      return { level, group };
    });
    documentNodes[groups[0].group].extensions = {
      MSFT_lod: { ids: groups.slice(1).map((entry) => entry.group) }
    };
    rootIndices = [...rootIndices.filter((index) => !claimed.has(index)), groups[0].group];
    const thresholds = groups.filter(({ level }) => level.screenCoverage !== void 0 || level.maxDistance !== void 0);
    if (thresholds.length > 0)
      lodSelection = {
        policy: groups.some(({ level }) => level.screenCoverage !== void 0) ? "screen-coverage" : "distance",
        levels: groups.map(({ level, group }) => ({
          node: group,
          ...level.screenCoverage === void 0 ? {} : { screenCoverage: level.screenCoverage },
          ...level.maxDistance === void 0 ? {} : { maxDistance: level.maxDistance }
        }))
      };
    note("uv.model/structure@1", "value-differs", "/nodes", `${groups.length} LOD levels are grouped under one node each (MSFT_lod)`);
  }
  const materialTargets = projection.materials === void 0 ? [] : materializeUvmAnimationMaterialTargets(projection.materials, materialBudget, signal);
  if (info.handedness === "left") {
    const root = documentNodes.length;
    documentNodes.push({
      name: "uv:handedness",
      scale: info.upAxis === "+z" ? [1, -1, 1] : [1, 1, -1],
      children: [...rootIndices]
    });
    rootIndices = [root];
    note("uv.model/structure@1", "value-differs", "/nodes", "one mirror node makes the left-handed source right-handed");
  }
  if (info.upAxis === "+z") {
    const root = documentNodes.length;
    documentNodes.push({
      name: "uv:up-axis",
      rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      children: [...rootIndices]
    });
    rootIndices = [root];
    note("uv.model/structure@1", "value-differs", "/nodes", "one rotation node turns the +z-up source to +y-up");
  }
  const unitsExtension = uvUnits(request.options?.units);
  if (unitsExtension !== void 0 && unitsExtension.metersPerSourceUnit !== 1) {
    const scale = unitsExtension.metersPerSourceUnit;
    const root = documentNodes.length;
    documentNodes.push({
      name: "uv:units",
      scale: [scale, scale, scale],
      children: [...rootIndices]
    });
    rootIndices = [root];
    note("uv.model/structure@1", "value-differs", "/nodes", "one scale node brings the source units to metres (UV_units)");
  }
  const hiddenPrimitives = (primitives ?? []).filter((primitive) => primitive.hidden === true).flatMap((primitive) => {
    const target = primitiveIndices.get(primitive.id);
    return target === void 0 ? [] : [target];
  }).sort((a, b) => a.mesh - b.mesh || a.primitive - b.primitive);
  const animation = projection.animations === void 0 ? void 0 : writeUvmAnimations(
    projection.animations,
    nodeIndexById,
    skeleton?.boneByNode ?? /* @__PURE__ */ new Map(),
    rigStorage,
    animationBudget,
    signal,
    primitiveIndices,
    // Identity scene nodes have explicit TRS defaults without inventing skin membership.
    // Authored matrix nodes remain ineligible: decomposition is not an implicit export step.
    new Set(orderedNodes.filter((node) => {
      const index = nodeIndexById.get(node.id);
      return index !== void 0 && documentNodes[index]?.matrix === void 0;
    }).map((node) => node.id)),
    new Map(orderedNodes.flatMap((node) => {
      const count = meshTargetNames.get((node.meshIds ?? [])[0] ?? "")?.length ?? 0;
      return count > 0 ? [[node.id, count]] : [];
    })),
    hiddenPrimitives
  );
  const visibility = animation?.visibility ?? hiddenPrimitives.map((target) => ({ mesh: target.mesh, primitive: target.primitive, value: 0 }));
  const animatesPointers = (animation?.animations ?? []).some((clip) => clip["channels"].some((channel) => channel["target"]?.["path"] === "pointer"));
  const clipLosses = /* @__PURE__ */ new Map();
  for (const loss of animation?.losses ?? []) {
    const key = `${loss.clipId}\0${loss.reason}`;
    const entry = clipLosses.get(key);
    if (entry === void 0)
      clipLosses.set(key, { clipId: loss.clipId, reason: loss.reason, count: 1 });
    else
      entry.count += 1;
  }
  for (const { clipId, reason, count } of clipLosses.values())
    losses.push(`animation ${clipId}: ${reason}${count > 1 ? ` (${count} channels)` : ""}`);
  for (const loss of animation?.losses ?? []) {
    note("common.view/model-animation-source@1", "value-differs", `/animations/${loss.clipId}${loss.channel === void 0 ? "" : `/channels/${loss.channel}`}`, loss.reason);
    lostFacetIds.push("common.view/model-animation-source@1");
  }
  if (animation !== void 0 && animation.animations.length !== Number(info.animations ?? 0))
    note("uv.model/structure@1", "value-differs", "/animations", "only clips with writable channels appear as glTF animations; the complete selectable set is retained in UV_game_animation_clips");
  if (skeleton !== void 0 && skeleton.skins.length > 0) {
    note("common.view/model-skeleton-source@1", "value-differs", void 0, "bone indices and hierarchy identities use positional skin joints; publisher-native flags, part identity and matrix annotations are not glTF skin fields");
    note("uv.model/geometry@1", "value-differs", "/primitives/*/skin", "bone indices are remapped to their positional skin joint slots");
  }
  if (animation !== void 0 && animation.animations.length > 0)
    note("common.view/model-animation-source@1", "value-differs", void 0, "clip and target identities are positional; native frame indices, provenance, bounds and movement speed are not glTF TRS fields");
  const binary = buffers.build();
  const gameExtensions = gameExtensionsOf(projection);
  const document = {
    asset: {
      version: "2.0",
      generator: `${MATERIALIZER_ID}/${MATERIALIZER_VERSION}`,
      extras: { uv: { format: "UVM", version: "1.0", profile: "core" } }
    },
    extensionsUsed: [
      "UV_asset",
      "UV_provenance",
      ...socketByNodeId.size === 0 ? [] : ["UV_game_socket"],
      ...billboardNodes === 0 ? [] : ["UV_node_billboard"],
      ...materials.some((material) => material.extensions?.UV_game_material !== void 0) ? ["UV_game_material"] : [],
      ...materials.some((material) => material.extensions?.UV_game_material_team_color !== void 0) ? ["UV_game_material_team_color"] : [],
      ...materials.some((material) => material.extensions?.KHR_materials_unlit !== void 0) ? ["KHR_materials_unlit"] : [],
      ...animation === void 0 || animation.catalog.length === 0 ? [] : ["UV_game_animation_clips"],
      ...animation?.animations.some((clip) => clip["extensions"]?.["UV_game_animation_events"]) ? ["UV_game_animation_events"] : [],
      ...visibility.length === 0 ? [] : ["UV_game_variants"],
      ...animatesPointers ? ["KHR_animation_pointer"] : [],
      ...imageColorKeys.some((key) => key !== void 0) ? ["UV_texture_color_key"] : [],
      ...unitsExtension === void 0 ? [] : ["UV_units"],
      ...projection.lods !== void 0 && projection.lods.length > 0 ? ["MSFT_lod"] : [],
      ...lodSelection === void 0 ? [] : ["MODKITX_lod_selection"],
      ...gameExtensions.map(([name]) => name)
    ],
    extensions: {
      ...Object.fromEntries(gameExtensions),
      ...unitsExtension === void 0 ? {} : { UV_units: unitsExtension },
      ...lodSelection === void 0 ? {} : { MODKITX_lod_selection: lodSelection },
      ...visibility.length === 0 ? {} : { UV_game_variants: { visibility } },
      ...animation === void 0 || animation.catalog.length === 0 ? {} : {
        UV_game_animation_clips: {
          clips: animation.catalog,
          ...materialTargets.length === 0 ? {} : { materialTargets }
        }
      },
      UV_asset: {
        id: assetId,
        class: request.options?.assetClass ?? "prop",
        coreRenderable: emittedPrimitives > 0,
        ...socketByNodeId.size === 0 ? {} : { sockets: socketByNodeId.size }
      },
      UV_provenance: {
        source: { format: sourceFormat },
        importer: { id: MATERIALIZER_ID, version: MATERIALIZER_VERSION },
        lost: losses
      }
    },
    scene: 0,
    scenes: [{ nodes: rootIndices }],
    nodes: documentNodes,
    ...documentMeshes.length === 0 ? {} : { meshes: documentMeshes },
    ...materials.length === 0 ? {} : { materials },
    ...skeleton === void 0 || skeleton.skins.length === 0 ? {} : { skins: skeleton.skins },
    ...animation === void 0 || animation.animations.length === 0 ? {} : { animations: animation.animations },
    ...resourceImages.length === 0 ? {} : {
      images: resourceImages,
      ...texturesWithSamplers(imageFilters, imageColorKeys)
    },
    accessors,
    bufferViews: buffers.views,
    buffers: [{ byteLength: binary.byteLength }]
  };
  const bytes = packUvmGlb(document, binary);
  const receipt = {
    materializer: {
      id: MATERIALIZER_ID,
      version: MATERIALIZER_VERSION,
      ...request.options === void 0 ? {} : { options: request.options }
    },
    scope: request.scope,
    profile: request.profile ?? PROFILE,
    subjectRevision: request.subjectRevision,
    lostFacetIds: [...new Set(lostFacetIds)].sort(byUtf8),
    excludedFacetIds: [...new Set(excludedFacetIds)].sort(byUtf8),
    diff,
    ...digest === void 0 ? {} : { artifactDigest: digest(bytes) }
  };
  const bindings = {
    nodes: Object.fromEntries(nodeIndexById),
    meshes: Object.fromEntries(meshIndexById),
    materials: Object.fromEntries(materialIndexById)
  };
  return { bytes, document, binary, receipt, bindings };
}
var MATERIALIZER_COORDINATE = Object.freeze({
  id: MATERIALIZER_ID,
  version: MATERIALIZER_VERSION,
  profile: PROFILE
});
export {
  MATERIALIZER_COORDINATE,
  materializeUvmCore,
  packUvmGlb
};
