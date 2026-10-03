import {
  createModelAnimationSampler
} from "./chunk-ZSMVBT5D.js";
import {
  snapshotJson
} from "./chunk-3YDGNEY2.js";
import {
  SequencePoseSampler,
  composeTrsMatrix,
  multiplyMat4
} from "./chunk-WXUQLAQ3.js";

// packages/codec-kit/dist/model/skeleton.js
var DEFAULT_MODEL_SKELETON_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
function vector(value, size, label) {
  if (!Array.isArray(value) || value.length !== size || value.some((x) => typeof x !== "number" || !Number.isFinite(x)))
    throw new TypeError(`invalid ${label}`);
}
function snapshotModelSkeleton(bindings, budget = DEFAULT_MODEL_SKELETON_BUDGET, signal) {
  const owned = snapshotJson(bindings, budget, signal);
  if (!Array.isArray(owned))
    throw new TypeError("skeleton bindings must be an array");
  for (const bone of owned) {
    if (bone === null || typeof bone !== "object" || typeof bone.partId !== "string" || !Number.isSafeInteger(bone.boneIndex) || bone.boneIndex < 0 || bone.boneName !== null && typeof bone.boneName !== "string")
      throw new TypeError("invalid bone binding");
    if (bone.nodeId !== void 0 && (typeof bone.nodeId !== "string" || bone.nodeId.length === 0))
      throw new TypeError("invalid bone node id");
    if (bone.localPose !== void 0) {
      vector(bone.localPose.translation, 3, "bone translation");
      vector(bone.localPose.rotation, 4, "bone rotation");
      vector(bone.localPose.scale, 3, "bone scale");
    }
    if (bone.inverseBindMatrix !== void 0)
      vector(bone.inverseBindMatrix, 16, "inverse bind matrix");
  }
  return owned;
}
function compileHierarchy(bindings, hierarchyId) {
  const bones = bindings.filter((bone) => bone.hierarchyId === hierarchyId).sort((a, b) => a.boneIndex - b.boneIndex);
  if (!hierarchyId || bones.length === 0)
    throw new TypeError("skeleton hierarchy is absent");
  const byIndex = /* @__PURE__ */ new Map();
  const byNode = /* @__PURE__ */ new Map();
  for (const [slot, bone] of bones.entries()) {
    if (bone.nodeId === void 0 || bone.localPose === void 0 || bone.parentBoneIndex === void 0)
      throw new TypeError("bone has no explicit scene node, local pose or parent");
    if (byIndex.has(bone.boneIndex) || byNode.has(bone.nodeId))
      throw new TypeError("ambiguous skeleton binding");
    byIndex.set(bone.boneIndex, slot);
    byNode.set(bone.nodeId, slot);
  }
  const parents = bones.map((bone) => {
    if (bone.parentBoneIndex === null)
      return -1;
    const slot = byIndex.get(bone.parentBoneIndex);
    if (slot === void 0)
      throw new TypeError("bone parent is absent from hierarchy");
    return slot;
  });
  const order = [];
  const done = /* @__PURE__ */ new Set();
  for (let slot = 0; slot < bones.length; slot++) {
    const chain = [];
    const visiting = /* @__PURE__ */ new Set();
    let current = slot;
    while (current !== -1 && !done.has(current)) {
      if (visiting.has(current))
        throw new TypeError("cyclic skeleton hierarchy");
      visiting.add(current);
      chain.push(current);
      current = parents[current];
    }
    for (const entry of chain.reverse()) {
      done.add(entry);
      order.push(entry);
    }
  }
  return { bones, byNode, parents, order };
}
function createModelSkeletonNodes(bindings, hierarchyId, budget, signal) {
  const { bones, parents } = compileHierarchy(snapshotModelSkeleton(bindings, budget, signal), hierarchyId);
  const children = bones.map(() => []);
  for (const [slot, parent] of parents.entries())
    if (parent >= 0)
      children[parent].push(bones[slot].nodeId);
  return Object.freeze(bones.map((bone, slot) => {
    const transform = new Float32Array(16);
    const pose = bone.localPose;
    composeTrsMatrix(transform, 0, pose.translation, pose.rotation, pose.scale);
    if (!transform.every(Number.isFinite))
      throw new RangeError("bone transform exceeds finite float range");
    return Object.freeze({
      id: bone.nodeId,
      ...bone.boneName === null ? {} : { name: bone.boneName },
      childIds: Object.freeze(children[slot]),
      meshIds: Object.freeze([]),
      transform: Object.freeze(Array.from(transform))
    });
  }));
}
function createModelPoseSampler({ bindings, hierarchyId, clip, budget, signal }) {
  const { bones, byNode, parents, order } = compileHierarchy(snapshotModelSkeleton(bindings, budget, signal), hierarchyId);
  if (clip?.hierarchyId !== void 0 && clip.hierarchyId !== hierarchyId)
    throw new TypeError("animation belongs to a different hierarchy");
  const animation = clip === void 0 ? void 0 : createModelAnimationSampler(clip, budget, signal);
  const world = new Float32Array(bones.length * 16);
  const local = new Float32Array(16);
  const skin = new Float32Array(16);
  return Object.freeze({
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isFinite(timeSeconds))
        throw new TypeError("pose time must be finite");
      const channels = animation?.sample(timeSeconds, requestSignal) ?? Object.freeze([]);
      const poses = bones.map((bone) => ({ ...bone.localPose }));
      const assigned = /* @__PURE__ */ new Set();
      for (const channel of channels) {
        if (!["translation", "rotation", "scale"].includes(channel.kind))
          continue;
        const slot = byNode.get(channel.target);
        if (slot === void 0 || channel.axis !== void 0)
          throw new TypeError("animation has no whole-bone target");
        const key = `${slot}/${channel.kind}`;
        if (assigned.has(key))
          throw new TypeError("duplicate bone animation channel");
        assigned.add(key);
        vector(channel.value, channel.kind === "rotation" ? 4 : 3, "bone animation value");
        Object.assign(poses[slot], { [channel.kind]: channel.value });
      }
      const result = new Array(bones.length);
      for (const slot of order) {
        if (requestSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        const bone = bones[slot];
        const pose = poses[slot];
        composeTrsMatrix(local, 0, pose.translation, pose.rotation, pose.scale);
        const parent = parents[slot];
        if (parent < 0)
          world.set(local, slot * 16);
        else
          multiplyMat4(world, slot * 16, world, parent * 16, local, 0);
        if (bone.inverseBindMatrix !== void 0)
          multiplyMat4(skin, 0, world, slot * 16, bone.inverseBindMatrix, 0);
        if (!world.subarray(slot * 16, slot * 16 + 16).every(Number.isFinite) || bone.inverseBindMatrix !== void 0 && !skin.every(Number.isFinite))
          throw new RangeError("bone pose exceeds finite float range");
        result[slot] = Object.freeze({
          boneIndex: bone.boneIndex,
          nodeId: bone.nodeId,
          worldMatrix: Object.freeze(Array.from(world.subarray(slot * 16, slot * 16 + 16))),
          ...bone.inverseBindMatrix === void 0 ? {} : { skinningMatrix: Object.freeze(Array.from(skin)) }
        });
      }
      return Object.freeze({ bones: Object.freeze(result), channels });
    }
  });
}
function createModelPoseBlendSampler({ bindings, hierarchyId, samples, budget = DEFAULT_MODEL_SKELETON_BUDGET, signal }) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > 32)
    throw new RangeError("poseSamples requires 1..32 entries");
  const captureBudget = { ...budget, maxBytes: Math.floor(budget.maxBytes / 8) };
  const captured = snapshotJson({ bindings, samples }, captureBudget, signal);
  let active = 0;
  for (const sample of captured.samples) {
    if (sample === null || typeof sample !== "object" || Object.keys(sample).some((key) => !["clip", "time", "weight", "additive"].includes(key)) || !Number.isFinite(sample.time) || !Number.isFinite(sample.weight) || sample.weight < 0 || sample.additive !== void 0 && typeof sample.additive !== "boolean")
      throw new TypeError("invalid pose sample time, weight or mode");
    if (sample.weight > 0)
      active++;
  }
  if (active === 0)
    throw new TypeError("poseSamples requires a positive weight");
  const { bones, byNode, parents, order } = compileHierarchy(snapshotModelSkeleton(captured.bindings, captureBudget, signal), hierarchyId);
  const pairs = bones.length * captured.samples.length;
  if (pairs > budget.maxNodes || pairs * 1024 + bones.length * 512 > Math.floor(budget.maxBytes / 2))
    throw new RangeError("pose blend sequences and bones exceed budget");
  const ordered = order.map((slot) => {
    const bone = bones[slot];
    if (bone === void 0)
      throw new TypeError("pose blend bone absent");
    return bone;
  });
  const ordinals = new Map(order.map((slot, ordinal) => [slot, ordinal]));
  const kernelBones = order.map((slot, ordinal) => {
    const bone = bones[slot], parent = parents[slot];
    if (bone === void 0 || parent === void 0)
      throw new TypeError("pose blend hierarchy absent");
    const parentIndex = parent < 0 ? -1 : ordinals.get(parent);
    if (parentIndex === void 0)
      throw new TypeError("pose blend parent absent");
    return {
      index: ordinal,
      name: bone.boneName ?? `bone-${bone.boneIndex}`,
      parentIndex,
      ...bone.inverseBindMatrix === void 0 ? {} : { inverseBindMatrix: Float32Array.from(bone.inverseBindMatrix) }
    };
  });
  const compiled = captured.samples.map((sample) => {
    if (sample.clip?.hierarchyId !== void 0 && sample.clip.hierarchyId !== hierarchyId)
      throw new TypeError("pose sample belongs to a different hierarchy");
    if ((sample.clip.unsupportedChannels ?? 0) > 0)
      throw new TypeError("pose sample has unresolved animation channels");
    const assigned = /* @__PURE__ */ new Set();
    for (const channel of sample.clip.channels) {
      if (!["translation", "rotation", "scale"].includes(channel.kind) || channel.axis !== void 0 || !byNode.has(channel.target))
        throw new TypeError("pose sample requires a whole-bone TRS target");
      const key = `${channel.target}/${channel.kind}`;
      if (assigned.has(key))
        throw new TypeError("duplicate pose blend channel");
      assigned.add(key);
    }
    return { sample, sampler: createModelAnimationSampler(sample.clip, captureBudget, signal) };
  });
  const kernel = new SequencePoseSampler(kernelBones);
  const constant = (value) => ({
    lineType: 0,
    globalSeqId: null,
    keys: [{ frame: 0, vector: value }]
  });
  return Object.freeze({
    sample(timeOffset = 0, requestSignal) {
      signal?.throwIfAborted();
      requestSignal?.throwIfAborted();
      if (!Number.isFinite(timeOffset))
        throw new TypeError("pose blend offset must be finite");
      const inputs = compiled.map(({ sample, sampler }) => {
        requestSignal?.throwIfAborted();
        const time = sample.time + timeOffset;
        if (!Number.isFinite(time))
          throw new RangeError("pose blend time overflow");
        const tracks = ordered.map((bone, boneIndex) => {
          const rest = bone.localPose;
          if (rest === void 0)
            throw new TypeError("pose blend local rest absent");
          return sample.additive ? { boneIndex } : {
            boneIndex,
            translation: constant(rest.translation),
            rotation: constant(rest.rotation),
            scale: constant(rest.scale)
          };
        });
        for (const value of sampler.sample(time, requestSignal)) {
          const slot = byNode.get(value.target), ordinal = slot === void 0 ? void 0 : ordinals.get(slot);
          const target = ordinal === void 0 ? void 0 : tracks[ordinal];
          if (target === void 0)
            throw new TypeError("pose blend target absent");
          vector(value.value, value.kind === "rotation" ? 4 : 3, "pose blend channel value");
          if (value.kind === "translation")
            target.translation = constant(value.value);
          else if (value.kind === "rotation")
            target.rotation = constant(value.value);
          else if (value.kind === "scale")
            target.scale = constant(value.value);
          else
            throw new TypeError("pose blend channel is not TRS");
        }
        const sequence = {
          name: sample.clip.name,
          durationSeconds: sample.clip.durationSeconds ?? 0,
          looping: false,
          nodeTracks: tracks
        };
        return {
          sequence,
          timeSeconds: 0,
          weight: sample.weight,
          ...sample.additive === void 0 ? {} : { additive: sample.additive }
        };
      });
      const result = kernel.sampleBlendedPose(inputs);
      if (!result.world.every(Number.isFinite) || !result.skinning.every(Number.isFinite))
        throw new RangeError("pose blend exceeds finite float range");
      const output = ordered.map((bone, index) => {
        if (bone.nodeId === void 0)
          throw new TypeError("pose blend node absent");
        return Object.freeze({
          boneIndex: bone.boneIndex,
          nodeId: bone.nodeId,
          worldMatrix: Object.freeze(Array.from(result.world.subarray(index * 16, index * 16 + 16))),
          ...bone.inverseBindMatrix === void 0 ? {} : {
            skinningMatrix: Object.freeze(Array.from(result.skinning.subarray(index * 16, index * 16 + 16)))
          }
        });
      });
      return Object.freeze({
        bones: Object.freeze(output.sort((a, b) => a.boneIndex - b.boneIndex)),
        channels: Object.freeze([])
      });
    }
  });
}

export {
  DEFAULT_MODEL_SKELETON_BUDGET,
  snapshotModelSkeleton,
  createModelSkeletonNodes,
  createModelPoseSampler,
  createModelPoseBlendSampler
};
