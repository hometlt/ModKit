import {
  createModelAnimationSampler
} from "./chunk-2W3Y5ACO.js";
import {
  snapshotJson
} from "./chunk-3YDGNEY2.js";
import {
  SequencePoseSampler,
  composeTrsMatrix,
  multiplyMat4
} from "./chunk-WXUQLAQ3.js";
import {
  linearStretch
} from "./chunk-RUCAYZBL.js";

// packages/codec-kit/dist/model/skeleton.js
var DEFAULT_MODEL_SKELETON_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
function vector(value, size, label) {
  if (!Array.isArray(value) || value.length !== size)
    throw new TypeError(`invalid ${label}`);
  for (let index = 0; index < size; index++) {
    const x = value[index];
    if (typeof x !== "number" || !Number.isFinite(x))
      throw new TypeError(`invalid ${label}`);
  }
}
function finiteMatrix(matrix, offset) {
  for (let index = offset; index < offset + 16; index++)
    if (!Number.isFinite(matrix[index]))
      return false;
  return true;
}
function frozenMatrix(matrix, offset) {
  const m = (index) => matrix[offset + index];
  return Object.freeze([
    m(0),
    m(1),
    m(2),
    m(3),
    m(4),
    m(5),
    m(6),
    m(7),
    m(8),
    m(9),
    m(10),
    m(11),
    m(12),
    m(13),
    m(14),
    m(15)
  ]);
}
var boneChannelKind = (kind) => kind === "translation" ? 0 : kind === "rotation" ? 1 : kind === "scale" ? 2 : -1;
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
function quaternionStretch(length) {
  return length <= 1 ? 1 : Math.sqrt(1 + 4 * length * length * (length * length - 1));
}
function vectorLength(vector2) {
  let sum = 0;
  for (const x of vector2)
    sum += x * x;
  return Math.sqrt(sum);
}
function vectorDistance(a, b, sign = 1) {
  let sum = 0;
  for (let axis = 0; axis < a.length; axis++)
    sum += (a[axis] - sign * b[axis]) ** 2;
  return Math.sqrt(sum);
}
function boxMiddle(points) {
  return points[0].map((_, axis) => {
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      low = Math.min(low, point[axis]);
      high = Math.max(high, point[axis]);
    }
    return (low + high) / 2;
  });
}
function quaternionMiddle(points) {
  const first = points.find((point) => vectorLength(point) > 0);
  if (first === void 0)
    return [0, 0, 0, 1];
  const sum = [0, 0, 0, 0];
  for (const point of points) {
    const length2 = vectorLength(point);
    if (!(length2 > 0))
      continue;
    let dot = 0;
    for (let axis = 0; axis < 4; axis++)
      dot += point[axis] * first[axis];
    for (let axis = 0; axis < 4; axis++)
      sum[axis] += (dot < 0 ? -1 : 1) * point[axis] / length2;
  }
  const middle = vectorLength(sum) > 1e-9 ? sum : [...first];
  const length = vectorLength(middle);
  return middle.map((x) => x / length);
}
var ROTATION_FORM = 1 + Math.SQRT2;
function rotationDeviation(extent, middle) {
  const middleLength = vectorLength(middle);
  const middleStretch = quaternionStretch(middleLength);
  if (extent.between === "hull") {
    let length = 0;
    let near = 0;
    let far = 0;
    for (const point of extent.points) {
      length = Math.max(length, vectorLength(point));
      near = Math.max(near, vectorDistance(point, middle));
      far = Math.max(far, vectorDistance(point, middle, -1));
    }
    return Math.min(quaternionStretch(length) + middleStretch, ROTATION_FORM * near * far);
  }
  const unit = middleLength > 0 ? middle.map((x) => x / middleLength) : void 0;
  const unitError = ROTATION_FORM * Math.abs(middleLength - 1) * (middleLength + 1);
  const arc = (toward, ends) => {
    const sides = ends.map((end) => end.reduce((sum, x, axis) => sum + x * toward[axis], 0));
    const side = sides.every((dot) => dot >= 0) ? 1 : sides.every((dot) => dot <= 0) ? -1 : 0;
    if (side === 0)
      return 2;
    let farthest = 0;
    for (const end of ends)
      farthest = Math.max(farthest, vectorDistance(end, toward, side));
    return Math.min(2, 2 * farthest);
  };
  let deviation = 0;
  for (const point of extent.points) {
    const length = vectorLength(point);
    let bound = quaternionStretch(length) + middleStretch;
    if (unit !== void 0 && length > 0)
      bound = Math.min(bound, ROTATION_FORM * Math.abs(length - 1) * (length + 1) + arc(unit, [point.map((x) => x / length)]) + unitError);
    deviation = Math.max(deviation, bound);
  }
  for (const [from, to] of extent.arcs) {
    const a = vectorLength(from);
    const b = vectorLength(to);
    let bound = 1 + middleStretch;
    if (unit !== void 0 && a > 0 && b > 0)
      bound = Math.min(bound, arc(unit, [from.map((x) => x / a), to.map((x) => x / b)]) + unitError);
    deviation = Math.max(deviation, bound);
  }
  return deviation;
}
function createModelPoseSampler({ bindings, hierarchyId, clip, budget, signal }) {
  const { bones, byNode, parents, order } = compileHierarchy(snapshotModelSkeleton(bindings, budget, signal), hierarchyId);
  if (clip?.hierarchyId !== void 0 && clip.hierarchyId !== hierarchyId)
    throw new TypeError("animation belongs to a different hierarchy");
  const animation = clip === void 0 ? void 0 : createModelAnimationSampler(clip, budget, signal);
  const IGNORED = -1;
  const UNBOUND = -2;
  const REPEATED = -3;
  const targets = new Int32Array(animation?.channels.length ?? 0);
  const claimed = new Uint8Array(bones.length * 3);
  for (const [index, channel] of (animation?.channels ?? []).entries()) {
    const kind = boneChannelKind(channel.kind);
    const slot = kind < 0 ? void 0 : byNode.get(channel.target);
    const target = kind < 0 ? IGNORED : slot === void 0 || channel.axis !== void 0 ? UNBOUND : claimed[slot * 3 + kind] === 1 ? REPEATED : slot * 3 + kind;
    if (target >= 0)
      claimed[target] = 1;
    targets[index] = target;
  }
  const trs = new Array(bones.length * 3);
  const restPose = () => {
    for (let slot = 0; slot < bones.length; slot++) {
      const rest = bones[slot].localPose;
      trs[slot * 3] = rest.translation;
      trs[slot * 3 + 1] = rest.rotation;
      trs[slot * 3 + 2] = rest.scale;
    }
  };
  const assign = (index, value) => {
    const target = targets[index];
    if (target === IGNORED)
      return;
    if (target === UNBOUND)
      throw new TypeError("animation has no whole-bone target");
    if (target === REPEATED)
      throw new TypeError("duplicate bone animation channel");
    vector(value, target % 3 === 1 ? 4 : 3, "bone animation value");
    trs[target] = value;
  };
  const local = new Float32Array(16);
  const skinning = bones.length * 16;
  const compose = (matrices, requestSignal) => {
    for (const slot of order) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      composeTrsMatrix(local, 0, trs[slot * 3], trs[slot * 3 + 1], trs[slot * 3 + 2]);
      const parent = parents[slot];
      if (parent < 0)
        matrices.set(local, slot * 16);
      else
        multiplyMat4(matrices, slot * 16, matrices, parent * 16, local, 0);
      const inverseBind = bones[slot].inverseBindMatrix;
      if (inverseBind !== void 0)
        multiplyMat4(matrices, skinning + slot * 16, matrices, slot * 16, inverseBind, 0);
      if (!finiteMatrix(matrices, slot * 16) || inverseBind !== void 0 && !finiteMatrix(matrices, skinning + slot * 16))
        throw new RangeError("bone pose exceeds finite float range");
    }
  };
  const frozenPose = (matrices) => {
    const result = new Array(bones.length);
    for (let slot = 0; slot < bones.length; slot++) {
      const bone = bones[slot];
      result[slot] = bone.inverseBindMatrix === void 0 ? Object.freeze({
        boneIndex: bone.boneIndex,
        nodeId: bone.nodeId,
        worldMatrix: frozenMatrix(matrices, slot * 16)
      }) : Object.freeze({
        boneIndex: bone.boneIndex,
        nodeId: bone.nodeId,
        worldMatrix: frozenMatrix(matrices, slot * 16),
        skinningMatrix: frozenMatrix(matrices, skinning + slot * 16)
      });
    }
    return Object.freeze(result);
  };
  const scratch = new Float32Array(bones.length * 32);
  const values = [];
  const extentOf = () => {
    const channelOf = new Int32Array(bones.length * 3).fill(-1);
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (target === IGNORED)
        continue;
      if (target < 0 || animation.extent(index).width !== (target % 3 === 1 ? 4 : 3))
        return void 0;
      channelOf[target] = index;
    }
    const middle = new Array(bones.length * 3);
    const length = new Float64Array(bones.length);
    const move = new Float64Array(bones.length);
    const stretch = new Float64Array(bones.length);
    const bend = new Float64Array(bones.length);
    for (let slot = 0; slot < bones.length; slot++) {
      const rest = bones[slot].localPose;
      const extentOfKind = (kind) => {
        const index = channelOf[slot * 3 + kind];
        return index < 0 ? void 0 : animation.extent(index);
      };
      const translation = extentOfKind(0);
      const rotation = extentOfKind(1);
      const scale = extentOfKind(2);
      const t0 = translation === void 0 ? rest.translation : boxMiddle(translation.points);
      for (const point of translation?.points ?? [t0]) {
        length[slot] = Math.max(length[slot], vectorLength(point));
        move[slot] = Math.max(move[slot], vectorDistance(point, t0));
      }
      const q0 = rotation === void 0 ? rest.rotation : quaternionMiddle(rotation.points);
      let turned = (rotation?.arcs.length ?? 0) > 0 ? 1 : 0;
      for (const point of rotation?.points ?? [q0])
        turned = Math.max(turned, quaternionStretch(vectorLength(point)));
      const deviation = rotation === void 0 ? 0 : rotationDeviation(rotation, q0);
      const s0 = scale === void 0 ? rest.scale : boxMiddle(scale.points);
      let scaled = 0;
      let spread = 0;
      for (const point of scale?.points ?? [s0])
        for (let axis = 0; axis < 3; axis++) {
          scaled = Math.max(scaled, Math.abs(point[axis]));
          spread = Math.max(spread, Math.abs(point[axis] - s0[axis]));
        }
      middle[slot * 3] = t0;
      middle[slot * 3 + 1] = q0;
      middle[slot * 3 + 2] = s0;
      stretch[slot] = turned * scaled;
      bend[slot] = deviation * scaled + quaternionStretch(vectorLength(q0)) * spread;
    }
    const center = new Float32Array(bones.length * 16);
    const turn = new Float64Array(bones.length);
    const shift = new Float64Array(bones.length);
    for (const slot of order) {
      composeTrsMatrix(local, 0, middle[slot * 3], middle[slot * 3 + 1], middle[slot * 3 + 2]);
      const parent = parents[slot];
      if (parent < 0) {
        center.set(local, slot * 16);
        turn[slot] = bend[slot];
        shift[slot] = move[slot];
        continue;
      }
      multiplyMat4(center, slot * 16, center, parent * 16, local, 0);
      const above = linearStretch(center.subarray(parent * 16, parent * 16 + 16));
      turn[slot] = turn[parent] * stretch[slot] + above * bend[slot];
      shift[slot] = turn[parent] * length[slot] + shift[parent] + above * move[slot];
    }
    for (const values2 of [center, turn, shift])
      for (let index = 0; index < values2.length; index++)
        if (!Number.isFinite(values2[index]))
          return void 0;
    return Object.freeze({ center, turn, shift });
  };
  let extent;
  return Object.freeze({
    extent: () => (extent === void 0 ? extent = extentOf() ?? null : extent) ?? void 0,
    bones: Object.freeze(bones.map((bone) => Object.freeze({
      boneIndex: bone.boneIndex,
      nodeId: bone.nodeId,
      skinned: bone.inverseBindMatrix !== void 0
    }))),
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isFinite(timeSeconds))
        throw new TypeError("pose time must be finite");
      const channels = animation?.sample(timeSeconds, requestSignal) ?? Object.freeze([]);
      restPose();
      for (let index = 0; index < channels.length; index++)
        assign(index, channels[index].value);
      compose(scratch, requestSignal);
      return Object.freeze({ bones: frozenPose(scratch), channels });
    },
    sampleMatrices(timeSeconds, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isFinite(timeSeconds))
        throw new TypeError("pose time must be finite");
      animation?.sampleInto(timeSeconds, values, requestSignal);
      restPose();
      for (let index = 0; index < targets.length; index++)
        assign(index, values[index]);
      const matrices = new Float32Array(bones.length * 32);
      compose(matrices, requestSignal);
      let pose;
      return Object.freeze({ matrices, pose: () => pose ??= frozenPose(matrices) });
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
