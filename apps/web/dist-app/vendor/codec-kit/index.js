import "../../chunks/chunk-OVW5EXOM.js";
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
} from "../../chunks/chunk-5GA6R5US.js";
import "../../chunks/chunk-JHPOUH6S.js";
import {
  contributionSettingsFor
} from "../../chunks/chunk-SCKD5U6H.js";
import "../../chunks/chunk-GGIVOOBZ.js";
import "../../chunks/chunk-YYQ3QKXM.js";
import "../../chunks/chunk-KL23KRQT.js";
import {
  revisionId,
  toPortableProjectionReceipt
} from "../../chunks/chunk-NMXLVS6H.js";
import {
  ModkitError,
  canonicalJsonStringify,
  createReferenceIndex,
  diagnostic
} from "../../chunks/chunk-HUU44HII.js";
import "../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/src/paging.ts
function pageStart(cursor) {
  if (cursor === void 0) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new TypeError("invalid page cursor");
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) throw new TypeError("page cursor exceeds safe integer range");
  return value;
}

// packages/codec-kit/src/json-snapshot.ts
function utf8ByteLength(text2) {
  let bytes = 0;
  for (let index = 0; index < text2.length; index++) {
    const code = text2.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 55296 && code <= 56319 && text2.charCodeAt(index + 1) >= 56320 && text2.charCodeAt(index + 1) <= 57343) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
function snapshotJson(value, budget, signal) {
  for (const limit of [budget?.maxDepth, budget?.maxNodes, budget?.maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError("invalid JSON snapshot budget");
  }
  const ancestors = /* @__PURE__ */ new Set();
  let nodes = 0;
  let bytes = 0;
  const charge = (count) => {
    bytes += count;
    if (bytes > budget.maxBytes) throw new RangeError("JSON snapshot exceeds maxBytes");
  };
  const copy = (entry, depth) => {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    if (depth > budget.maxDepth) throw new RangeError("JSON snapshot exceeds maxDepth");
    if (++nodes > budget.maxNodes) throw new RangeError("JSON snapshot exceeds maxNodes");
    if (entry === null || typeof entry === "boolean") {
      charge(entry === false ? 5 : 4);
      return entry;
    }
    if (typeof entry === "string") {
      charge(utf8ByteLength(JSON.stringify(entry)));
      return entry;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      charge(JSON.stringify(entry).length);
      return entry;
    }
    if (typeof entry !== "object" || entry === null) throw new TypeError("non-JSON snapshot value");
    const prototype = Object.getPrototypeOf(entry);
    if (!Array.isArray(entry) && prototype !== null && prototype !== Object.prototype) {
      throw new TypeError("JSON snapshot requires plain objects");
    }
    if (ancestors.has(entry)) throw new TypeError("cyclic JSON snapshot");
    ancestors.add(entry);
    try {
      charge(2);
      if (Array.isArray(entry)) {
        const result2 = [];
        for (let index = 0; index < entry.length; index++) {
          if (index > 0) charge(1);
          result2.push(copy(entry[index], depth + 1));
        }
        return Object.freeze(result2);
      }
      const result = [];
      const entries = Object.entries(entry);
      if (budget.sortKeys)
        entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      for (const [key, item] of entries) {
        if (item === void 0) continue;
        charge(utf8ByteLength(JSON.stringify(key)) + 1 + (result.length > 0 ? 1 : 0));
        result.push([key, copy(item, depth + 1)]);
      }
      return Object.freeze(Object.fromEntries(result));
    } finally {
      ancestors.delete(entry);
    }
  };
  return copy(value, 0);
}

// packages/codec-kit/src/deferred-session.ts
function deferAssetSession(revision, initialize, budget, openingSignal) {
  const controller = new AbortController();
  const signal = openingSignal === void 0 ? controller.signal : AbortSignal.any([openingSignal, controller.signal]);
  let pending;
  let resolved;
  let disposed = false;
  let disposal;
  let release;
  const releaseResolved = () => {
    if (release === void 0) release = resolved?.dispose() ?? Promise.resolve();
    return release;
  };
  const requireLive = () => {
    if (disposed)
      throw new ModkitError({
        code: "x3.host/session-disposed",
        message: "the deferred asset session has been disposed"
      });
    signal.throwIfAborted();
  };
  const get = async () => {
    requireLive();
    pending ??= Promise.resolve().then(async () => {
      requireLive();
      resolved = await initialize(signal);
      try {
        requireLive();
        if (resolved.revision !== revision)
          throw new ModkitError({
            code: "x3.host/subject-session-identity-mismatch",
            message: "deferred inspection changed the selected source revision"
          });
        return resolved;
      } catch (error) {
        await releaseResolved();
        throw error;
      }
    });
    const session = await pending;
    requireLive();
    return session;
  };
  const waitForSession = (waitSignal) => {
    if (waitSignal.aborted) return Promise.resolve(void 0);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (action) => {
        if (finished) return;
        finished = true;
        waitSignal.removeEventListener("abort", onAbort);
        action();
      };
      const onAbort = () => finish(() => resolve(void 0));
      waitSignal.addEventListener("abort", onAbort, { once: true });
      void get().then(
        (session) => finish(() => resolve(session)),
        (error) => finish(() => reject(error))
      );
    });
  };
  const dispose = () => {
    if (disposal !== void 0) return disposal;
    disposed = true;
    controller.abort();
    disposal = (async () => {
      if (pending === void 0) return;
      await pending.catch(() => void 0);
      if (resolved !== void 0) await releaseResolved();
    })();
    return disposal;
  };
  const rejected = (reason, message) => ({
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  });
  const operations = Object.freeze({
    async invoke(handlerId, input, options) {
      if (disposed || signal.aborted || options?.signal?.aborted)
        return rejected("cancelled", "the deferred operation was cancelled before dispatch");
      let owned;
      try {
        owned = snapshotJson(
          input,
          {
            maxDepth: budget.maxDepth,
            maxNodes: budget.maxNodes,
            maxBytes: budget.maxScalarBytes
          },
          options?.signal
        );
      } catch {
        return rejected("input-not-serializable", "operation input must be bounded JSON data");
      }
      const invokeSignal = options?.signal === void 0 ? signal : AbortSignal.any([signal, options.signal]);
      const invokeOptions = { ...options, signal: invokeSignal };
      try {
        const session = await waitForSession(invokeSignal);
        if (session === void 0 || invokeSignal.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        const result = await session.operations().invoke(handlerId, owned, invokeOptions);
        if (disposed || invokeSignal.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        return result;
      } catch (error) {
        if (disposed || signal.aborted || invokeOptions?.signal?.aborted)
          return rejected("cancelled", "the deferred operation was cancelled");
        throw error;
      }
    },
    dispose
  });
  return Object.freeze({
    revision,
    state: () => disposed ? "disposed" : resolved?.state() ?? "live",
    async descriptor() {
      const descriptor = await (await get()).descriptor();
      requireLive();
      return descriptor;
    },
    async dataSource(contract, major) {
      const lease = await (await get()).dataSource(contract, major);
      try {
        requireLive();
        return lease;
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
    operations: () => operations,
    async *events(eventSignal) {
      const waitSignal = eventSignal === void 0 ? signal : AbortSignal.any([signal, eventSignal]);
      const session = await waitForSession(waitSignal);
      if (session === void 0 || waitSignal.aborted) return;
      yield* session.events(waitSignal);
    },
    dispose
  });
}

// packages/codec-kit/src/projection.ts
var PROJECTION_RECEIPT_METADATA_ID = "uv-projection-receipt";
var PLANE_STATES = /* @__PURE__ */ new Set(["normalized", "preserved", "inferred", "lost"]);
var CONFIDENCES = /* @__PURE__ */ new Set(["exact", "high", "partial", "heuristic"]);
function createProjectionReceipt(receipt) {
  const planes = [...receipt.planes ?? []];
  if (planes.length === 0)
    throw new TypeError("a projection receipt must record at least one plane");
  for (const plane of planes) {
    if (!PLANE_STATES.has(plane.state)) {
      throw new TypeError(`projection plane \xAB${plane.planeId}\xBB has an unknown state ${plane.state}`);
    }
  }
  if (!CONFIDENCES.has(receipt.confidence)) {
    throw new TypeError(`projection receipt has an unknown confidence ${receipt.confidence}`);
  }
  if ((receipt.evidence ?? []).length === 0) {
    throw new TypeError(
      "a projection receipt made of no evidence is a claim with nothing behind it; state at least one declared or observed fact"
    );
  }
  return Object.freeze({
    form: "local",
    adapter: Object.freeze({ ...receipt.adapter }),
    subjectRevision: receipt.subjectRevision,
    companions: Object.freeze((receipt.companions ?? []).map((item) => Object.freeze({ ...item }))),
    basis: Object.freeze({ ...receipt.basis }),
    planes: Object.freeze(planes.map((plane) => Object.freeze({ ...plane }))),
    evidence: Object.freeze(receipt.evidence.map((item) => Object.freeze({ ...item }))),
    confidence: receipt.confidence,
    ...receipt.semanticHash === void 0 ? {} : { semanticHash: receipt.semanticHash },
    ...receipt.sourceUri === void 0 ? {} : { sourceUri: receipt.sourceUri }
  });
}

// packages/codec-kit/src/model-math/sequence-pose.ts
function sampleTrackValue(track, timeSeconds, out, options = {}) {
  const keys = track.keys;
  const count = keys.length;
  if (count === 0) {
    out.length = 0;
    return out;
  }
  let time = timeSeconds;
  let wrapRoundoff = 0;
  if (options.wrapSeconds && options.wrapSeconds > 0) {
    time = timeSeconds % options.wrapSeconds;
    wrapRoundoff = Math.max(options.wrapSeconds, Math.abs(timeSeconds)) * Number.EPSILON * 2;
    if (Math.abs(time - options.wrapSeconds) <= wrapRoundoff) time = 0;
  }
  const first = keys[0];
  if (time <= first.frame || count === 1) return copyVector(first.vector, out);
  const last = keys[count - 1];
  if (time >= last.frame) return copyVector(last.vector, out);
  let b = 1;
  while (b < count - 1 && time + wrapRoundoff >= keys[b].frame) b += 1;
  const ka = keys[b - 1];
  const kb = keys[b];
  if (track.lineType === 0) return copyVector(ka.vector, out);
  const span = kb.frame - ka.frame;
  const t = span > 0 ? Math.min(Math.max((time - ka.frame) / span, 0), 1) : 0;
  if (options.isQuat && ka.vector.length === 4 && kb.vector.length === 4) {
    return slerpVector(ka.vector, kb.vector, t, out);
  }
  out.length = ka.vector.length;
  for (let i = 0; i < ka.vector.length; i += 1) {
    const a = ka.vector[i];
    out[i] = a + ((kb.vector[i] ?? a) - a) * t;
  }
  return out;
}
function copyVector(source, out) {
  out.length = source.length;
  for (let i = 0; i < source.length; i += 1) out[i] = source[i];
  return out;
}
function slerpVector(a, b, t, out) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let sign = 1;
  if (dot < 0) {
    dot = -dot;
    sign = -1;
  }
  out.length = 4;
  if (dot > 0.9995) {
    for (let i = 0; i < 4; i += 1) out[i] = a[i] + (sign * b[i] - a[i]) * t;
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinTheta;
    const wb = Math.sin(t * theta) / sinTheta * sign;
    for (let i = 0; i < 4; i += 1) out[i] = wa * a[i] + wb * b[i];
  }
  const len = Math.hypot(out[0], out[1], out[2], out[3]);
  if (len > 0) {
    for (let i = 0; i < 4; i += 1) out[i] /= len;
  }
  return out;
}
function composeTrsMatrix(out, offset, translation, rotation, scale) {
  const x = rotation[0] ?? 0;
  const y = rotation[1] ?? 0;
  const z = rotation[2] ?? 0;
  const w = rotation[3] ?? 1;
  const sx = scale[0] ?? 1;
  const sy = scale[1] ?? 1;
  const sz = scale[2] ?? 1;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = translation[0] ?? 0;
  out[offset + 13] = translation[1] ?? 0;
  out[offset + 14] = translation[2] ?? 0;
  out[offset + 15] = 1;
}
function multiplyMat4(out, outOffset, a, aOffset, b, bOffset) {
  const a00 = a[aOffset];
  const a01 = a[aOffset + 1];
  const a02 = a[aOffset + 2];
  const a03 = a[aOffset + 3];
  const a10 = a[aOffset + 4];
  const a11 = a[aOffset + 5];
  const a12 = a[aOffset + 6];
  const a13 = a[aOffset + 7];
  const a20 = a[aOffset + 8];
  const a21 = a[aOffset + 9];
  const a22 = a[aOffset + 10];
  const a23 = a[aOffset + 11];
  const a30 = a[aOffset + 12];
  const a31 = a[aOffset + 13];
  const a32 = a[aOffset + 14];
  const a33 = a[aOffset + 15];
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[bOffset + col * 4];
    const b1 = b[bOffset + col * 4 + 1];
    const b2 = b[bOffset + col * 4 + 2];
    const b3 = b[bOffset + col * 4 + 3];
    out[outOffset + col * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[outOffset + col * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[outOffset + col * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[outOffset + col * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
}

// packages/codec-kit/src/model/animation.ts
var DEFAULT_MODEL_ANIMATION_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`);
}
function snapshotModelAnimations(value, budget = DEFAULT_MODEL_ANIMATION_BUDGET, signal) {
  const clips = snapshotJson(value, budget, signal);
  if (!Array.isArray(clips)) throw new TypeError("model animations must be an array");
  const ids = /* @__PURE__ */ new Set();
  for (const clip of clips) {
    if (clip === null || typeof clip !== "object" || typeof clip.id !== "string" || !clip.id || ids.has(clip.id)) {
      throw new TypeError("animation clip needs a unique id");
    }
    ids.add(clip.id);
    if (typeof clip.name !== "string" || !["animation", "rest-pose"].includes(clip.kind) || !["direct", "companion"].includes(clip.provenance) || !Number.isSafeInteger(clip.frames) || clip.frames < 0 || !Array.isArray(clip.channels))
      throw new TypeError("invalid animation clip");
    if (clip.durationSeconds !== void 0) {
      finite(clip.durationSeconds, "clip duration");
      if (clip.durationSeconds < 0) throw new TypeError("negative clip duration");
    }
    if (clip.looping !== void 0 && typeof clip.looping !== "boolean")
      throw new TypeError("invalid clip looping");
    if (clip.repeatCount !== void 0 && (!Number.isSafeInteger(clip.repeatCount) || clip.repeatCount < 0))
      throw new TypeError("invalid clip repeat count");
    if (clip.sequenceIndex !== void 0 && (!Number.isSafeInteger(clip.sequenceIndex) || clip.sequenceIndex < 0))
      throw new TypeError("invalid animation material sequence index");
    if (clip.movementSpeed !== void 0) finite(clip.movementSpeed, "clip movement speed");
    if (clip.boundsSphere !== void 0) {
      if (!Array.isArray(clip.boundsSphere.center) || clip.boundsSphere.center.length !== 3)
        throw new TypeError("invalid clip bounds");
      for (const component of clip.boundsSphere.center) finite(component, "clip bounds center");
      finite(clip.boundsSphere.radius, "clip bounds radius");
      if (clip.boundsSphere.radius < 0) throw new TypeError("negative clip bounds radius");
    }
    for (const channel of clip.channels) {
      if (channel === null || typeof channel !== "object" || typeof channel.target !== "string" || typeof channel.kind !== "string")
        throw new TypeError("invalid animation channel");
      if (channel.concurrent !== void 0 && typeof channel.concurrent !== "boolean")
        throw new TypeError("invalid concurrent flag");
      if (channel.wrapSeconds !== void 0) {
        finite(channel.wrapSeconds, "channel wrap");
        if (channel.wrapSeconds <= 0 || channel.concurrent !== true)
          throw new TypeError("invalid independent channel wrap");
      }
      if (channel.repeatCount !== void 0 && (!Number.isSafeInteger(channel.repeatCount) || channel.repeatCount < 0 || channel.concurrent !== true || channel.wrapSeconds === void 0))
        throw new TypeError("invalid independent channel repeat count");
      if (channel.samples !== void 0 && !Array.isArray(channel.samples))
        throw new TypeError("invalid animation samples");
      if (channel.interpolation === void 0) continue;
      if (!["step", "linear", "spherical-linear"].includes(channel.interpolation) || !channel.samples?.length) {
        throw new TypeError("sampleable channel needs interpolation and keys");
      }
      let previous = -Infinity;
      let components;
      for (const sample of channel.samples) {
        finite(sample.timeSeconds, "key time");
        if (sample.timeSeconds < previous) throw new TypeError("animation keys are not ordered");
        previous = sample.timeSeconds;
        if (!Array.isArray(sample.value) || sample.value.length === 0)
          throw new TypeError("empty animation key");
        components ??= sample.value.length;
        if (components !== sample.value.length || channel.interpolation === "spherical-linear" && components !== 4) {
          throw new TypeError("inconsistent animation key components");
        }
        for (const component of sample.value) finite(component, "key component");
      }
    }
  }
  return clips;
}
function createModelAnimationSampler(clip, budget, signal) {
  const owned = snapshotModelAnimations([clip], budget, signal)[0];
  const tracks = owned.channels.map((channel) => {
    if (channel.interpolation === void 0 || channel.samples === void 0)
      throw new TypeError("channel has no sampling semantics");
    const track = {
      lineType: channel.interpolation === "step" ? 0 : 1,
      globalSeqId: null,
      keys: channel.samples.map((key) => ({ frame: key.timeSeconds, vector: key.value }))
    };
    return { channel, track };
  });
  return Object.freeze({
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      finite(timeSeconds, "sample time");
      return Object.freeze(
        tracks.map(({ channel, track }) => {
          if (requestSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
          return Object.freeze({
            target: channel.target,
            kind: channel.kind,
            ...channel.axis === void 0 ? {} : { axis: channel.axis },
            value: Object.freeze(
              sampleTrackValue(track, timeSeconds, [], {
                isQuat: channel.interpolation === "spherical-linear",
                wrapSeconds: channel.concurrent ? channel.wrapSeconds : void 0
              })
            )
          });
        })
      );
    }
  });
}

// packages/codec-kit/src/model/skeleton.ts
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
  if (!Array.isArray(owned)) throw new TypeError("skeleton bindings must be an array");
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
  if (!hierarchyId || bones.length === 0) throw new TypeError("skeleton hierarchy is absent");
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
    if (bone.parentBoneIndex === null) return -1;
    const slot = byIndex.get(bone.parentBoneIndex);
    if (slot === void 0) throw new TypeError("bone parent is absent from hierarchy");
    return slot;
  });
  const order = [];
  const done = /* @__PURE__ */ new Set();
  for (let slot = 0; slot < bones.length; slot++) {
    const chain = [];
    const visiting = /* @__PURE__ */ new Set();
    let current = slot;
    while (current !== -1 && !done.has(current)) {
      if (visiting.has(current)) throw new TypeError("cyclic skeleton hierarchy");
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
  const { bones, parents } = compileHierarchy(
    snapshotModelSkeleton(bindings, budget, signal),
    hierarchyId
  );
  const children = bones.map(() => []);
  for (const [slot, parent] of parents.entries())
    if (parent >= 0) children[parent].push(bones[slot].nodeId);
  return Object.freeze(
    bones.map((bone, slot) => {
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
    })
  );
}
function createModelPoseSampler({
  bindings,
  hierarchyId,
  clip,
  budget,
  signal
}) {
  const { bones, byNode, parents, order } = compileHierarchy(
    snapshotModelSkeleton(bindings, budget, signal),
    hierarchyId
  );
  if (clip?.hierarchyId !== void 0 && clip.hierarchyId !== hierarchyId)
    throw new TypeError("animation belongs to a different hierarchy");
  const animation = clip === void 0 ? void 0 : createModelAnimationSampler(clip, budget, signal);
  const world = new Float32Array(bones.length * 16);
  const local = new Float32Array(16);
  const skin = new Float32Array(16);
  return Object.freeze({
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isFinite(timeSeconds)) throw new TypeError("pose time must be finite");
      const channels = animation?.sample(timeSeconds, requestSignal) ?? Object.freeze([]);
      const poses = bones.map((bone) => ({ ...bone.localPose }));
      const assigned = /* @__PURE__ */ new Set();
      for (const channel of channels) {
        if (!["translation", "rotation", "scale"].includes(channel.kind)) continue;
        const slot = byNode.get(channel.target);
        if (slot === void 0 || channel.axis !== void 0)
          throw new TypeError("animation has no whole-bone target");
        const key = `${slot}/${channel.kind}`;
        if (assigned.has(key)) throw new TypeError("duplicate bone animation channel");
        assigned.add(key);
        vector(channel.value, channel.kind === "rotation" ? 4 : 3, "bone animation value");
        Object.assign(poses[slot], { [channel.kind]: channel.value });
      }
      const result = new Array(bones.length);
      for (const slot of order) {
        if (requestSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
        const bone = bones[slot];
        const pose = poses[slot];
        composeTrsMatrix(local, 0, pose.translation, pose.rotation, pose.scale);
        const parent = parents[slot];
        if (parent < 0) world.set(local, slot * 16);
        else multiplyMat4(world, slot * 16, world, parent * 16, local, 0);
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

// packages/codec-kit/src/model/geometry.ts
function modelPrimitiveByteLength(primitive) {
  return primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.normals?.byteLength ?? 0) + (primitive.tangents?.byteLength ?? 0) + (primitive.colors?.byteLength ?? 0) + (primitive.boneIndices?.byteLength ?? 0) + (primitive.boneWeights?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0) + (primitive.textureCoordinateSets?.reduce((total, channel) => total + channel.coordinates.byteLength, 0) ?? 0);
}

// packages/codec-kit/src/editing.ts
function assetRevisionFromInput(input) {
  if (input.originKind !== "single" || input.revisions.topology !== "single") {
    throw new TypeError("assetRevisionFromInput: single-source subjects only");
  }
  const [binding] = input.bindings;
  if (binding === void 0) throw new TypeError("assetRevisionFromInput: no binding");
  const revision = binding.revision;
  return Object.freeze({
    bindings: Object.freeze({ [binding.bindingId]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: "single",
      bindingId: binding.bindingId,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision
    })
  });
}
function editPlanFromInput(input, { planId, edits, fidelity, guarantee = "atomic", diagnostics = [] }) {
  const revision = assetRevisionFromInput(input);
  const [binding] = input.bindings;
  const target = Object.freeze({
    targetId: binding.bindingId,
    subjectUri: binding.source.uri,
    ownerSource: Object.freeze({ ...binding.source }),
    semanticPath: Object.freeze([]),
    expectedRevision: revision
  });
  return Object.freeze({
    planId,
    targets: Object.freeze([target]),
    edits: Object.freeze(
      edits.map(
        (edit) => Object.freeze({
          ...edit,
          targetId: edit.targetId ?? binding.bindingId,
          source: edit.source ?? target.ownerSource
        })
      )
    ),
    semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics])
  });
}
function editPlanFromBinding(input, bindingId, { planId, edits, fidelity, guarantee = "atomic", diagnostics = [] }) {
  if (input.originKind !== "single" && input.originKind !== "bundle")
    throw new TypeError("editPlanFromBinding requires a physical subject");
  const primary = input.bindings.find((binding) => binding.bindingId === input.primaryBindingId);
  const selected = input.bindings.find((binding) => binding.bindingId === bindingId);
  if (primary === void 0 || selected === void 0 || selected.ownership !== "owned")
    throw new TypeError("editPlanFromBinding requires an exact owned binding");
  const ids = /* @__PURE__ */ new Set(), sourceIds = /* @__PURE__ */ new Set(), uris = /* @__PURE__ */ new Set();
  const targets = input.bindings.map((binding) => {
    if (ids.has(binding.bindingId) || sourceIds.has(binding.source.id) || uris.has(binding.source.uri))
      throw new TypeError("editPlanFromBinding refuses aliased bindings");
    ids.add(binding.bindingId);
    sourceIds.add(binding.source.id);
    uris.add(binding.source.uri);
    return Object.freeze({
      targetId: binding.bindingId,
      subjectUri: primary.source.uri,
      ownerSource: Object.freeze({ ...binding.source }),
      semanticPath: Object.freeze([]),
      expectedRevision: Object.freeze({
        bindings: Object.freeze({ [binding.bindingId]: binding.revision }),
        compositionFingerprint: canonicalJsonStringify({
          topology: "single",
          bindingId: binding.bindingId,
          source: { id: binding.source.id, uri: binding.source.uri },
          revision: binding.revision
        })
      })
    });
  });
  const prepared = edits.map((edit) => {
    if (edit.targetId !== void 0 && edit.targetId !== bindingId || edit.source !== void 0 && canonicalJsonStringify(edit.source) !== canonicalJsonStringify(selected.source))
      throw new TypeError("editPlanFromBinding edit belongs to a different owner");
    return Object.freeze({
      ...edit,
      targetId: bindingId,
      source: Object.freeze({ ...selected.source })
    });
  });
  return Object.freeze({
    planId,
    targets: Object.freeze(targets),
    edits: Object.freeze(prepared),
    semantics: Object.freeze({ mutationMode: "mutate", minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics])
  });
}
function replaceBytes(offset, length, bytes, label) {
  return Object.freeze({
    operation: "replace",
    range: Object.freeze({ kind: "bytes", offset: BigInt(offset), length: BigInt(length) }),
    payload: Object.freeze({ kind: "inline", bytes }),
    ...label === void 0 ? {} : { label }
  });
}

// packages/codec-kit/src/json-edit.ts
function required(value) {
  if (value === void 0) throw new TypeError("JSON Pointer target does not exist");
  return value;
}
function applyJsonEdit(root, edit, maxDepth) {
  if (edit.op !== "add" && edit.op !== "replace" && edit.op !== "remove")
    throw new TypeError("unsupported JSON edit");
  if (edit.path !== "" && !edit.path.startsWith("/")) throw new TypeError("invalid JSON Pointer");
  const tokens = edit.path === "" ? [] : edit.path.slice(1).split("/", maxDepth + 1).map((token) => {
    if (/~(?:[^01]|$)/u.test(token)) throw new TypeError("invalid JSON Pointer escape");
    return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
  });
  if (tokens.length > maxDepth) throw new RangeError("JSON Pointer exceeds maxDepth");
  const visit = (value, depth) => {
    if (depth === tokens.length) {
      if (edit.op === "remove") throw new TypeError("cannot remove the JSON document root");
      return edit.value;
    }
    const key = required(tokens[depth]);
    const last = depth === tokens.length - 1;
    if (Array.isArray(value)) {
      if (!(last && edit.op === "add" && key === "-") && !/^(0|[1-9][0-9]*)$/u.test(key))
        throw new TypeError("invalid JSON Pointer array index");
      const index = key === "-" ? value.length : Number(key);
      const inserting = last && edit.op === "add";
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length + (inserting ? 1 : 0))
        throw new RangeError("JSON Pointer array index is out of bounds");
      const result2 = [...value];
      if (last && edit.op === "remove") result2.splice(index, 1);
      else if (inserting) result2.splice(index, 0, edit.value);
      else result2[index] = visit(required(result2[index]), depth + 1);
      return Object.freeze(result2);
    }
    if (value === null || typeof value !== "object")
      throw new TypeError("JSON Pointer traverses a scalar");
    const object = value;
    if (!Object.hasOwn(object, key) && !(last && edit.op === "add"))
      throw new TypeError("JSON Pointer target does not exist");
    const entries = Object.entries(object).filter(
      ([name]) => !(last && edit.op === "remove" && name === key)
    );
    if (!(last && edit.op === "remove")) {
      const replacement = last && edit.op === "add" ? edit.value : visit(required(object[key]), depth + 1);
      const index = entries.findIndex(([name]) => name === key);
      if (index < 0) entries.push([key, replacement]);
      else entries[index] = [key, replacement];
    }
    return Object.freeze(Object.fromEntries(entries));
  };
  const result = visit(root, 0);
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new TypeError("JSON document root must remain an object");
  return result;
}

// packages/codec-kit/src/json.ts
var DEFAULT_MAX_DEPTH = 64;
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
function isJsonSerializable(value, maxDepth = DEFAULT_MAX_DEPTH) {
  return check(value, maxDepth, /* @__PURE__ */ new Set(), false);
}
function check(value, depth, seen, insideArray) {
  if (depth < 0) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "undefined":
      return !insideArray;
    case "bigint":
    case "symbol":
    case "function":
      return false;
    default:
      break;
  }
  const object = value;
  if (seen.has(object)) return false;
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.every((entry) => check(entry, depth - 1, seen, true));
    }
    if (!isPlainObject(object)) return false;
    return Object.values(object).every(
      (entry) => check(entry, depth - 1, seen, false)
    );
  } finally {
    seen.delete(object);
  }
}

// packages/codec-kit/src/logging.ts
var loggerFactory;
function installLoggerFactory(factory) {
  loggerFactory = factory;
}
function getLogger(category = []) {
  const invoke = (property, args) => {
    const target = loggerFactory?.(category);
    if (target === void 0) return void 0;
    const member = Reflect.get(target, property);
    return typeof member === "function" ? Reflect.apply(member, target, args) : member;
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "isEnabledFor" && loggerFactory === void 0) return () => false;
        return (...args) => invoke(property, args);
      }
    }
  );
}

// packages/codec-kit/src/model/materials.ts
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
  if (typeof value !== "string" || nonEmpty && value.trim() === "") throw new TypeError(`${label} must be a string`);
};
var strings = (value, label) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
};
var optionalFields = (value, label) => {
  for (const key of ["name", "libraryId", "type", "blendMode"]) {
    if (value[key] !== void 0) text(value[key], `${label}.${key}`);
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
    if (value[key] !== void 0 && typeof value[key] !== "number") throw new TypeError(`${label}.${key} must be a number`);
  }
  for (const key of ["contracts", "flagNames"]) {
    if (value[key] !== void 0) strings(value[key], `${label}.${key}`);
  }
};
function snapshotModelMaterials(value, budget = DEFAULT_MODEL_MATERIAL_BUDGET, signal) {
  const snapshot = snapshotJson(value, { ...budget, sortKeys: true }, signal);
  if (!Array.isArray(snapshot)) throw new TypeError("model materials must be an array");
  const ids = /* @__PURE__ */ new Set();
  for (const entry of snapshot) {
    const material = record(entry, "material");
    text(material["id"], "material.id", true);
    const id = material["id"];
    if (ids.has(id)) throw new TypeError(`duplicate material id ${id}`);
    ids.add(id);
    optionalFields(material, `material ${id}`);
    if (material["layers"] !== void 0) {
      if (!Array.isArray(material["layers"])) throw new TypeError("material.layers must be an array");
      for (const entry2 of material["layers"]) {
        const layer = record(entry2, "material layer");
        text(layer["slot"], "material layer.slot", true);
        if (layer["resourceId"] !== void 0) text(layer["resourceId"], "material layer.resourceId", true);
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

// packages/codec-kit/src/model/sources.ts
function frozenModelNode(node) {
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    meshIds: Object.freeze([...node.meshIds]),
    transform: Object.freeze([...node.transform])
  });
}
function frozenModelMesh(mesh) {
  return Object.freeze({ ...mesh, primitiveIds: Object.freeze([...mesh.primitiveIds]) });
}
function clonePrimitive(primitive) {
  return Object.freeze({
    ...primitive,
    positions: primitive.positions.slice(),
    ...primitive.indices === void 0 ? {} : { indices: primitive.indices.slice() },
    ...primitive.normals === void 0 ? {} : { normals: primitive.normals.slice() },
    ...primitive.tangents === void 0 ? {} : { tangents: primitive.tangents.slice() },
    ...primitive.colors === void 0 ? {} : { colors: primitive.colors.slice() },
    ...primitive.boneIndices === void 0 ? {} : { boneIndices: primitive.boneIndices.slice() },
    ...primitive.boneWeights === void 0 ? {} : { boneWeights: primitive.boneWeights.slice() },
    ...primitive.textureCoordinates === void 0 ? {} : { textureCoordinates: primitive.textureCoordinates.slice() },
    ...primitive.textureCoordinateSets === void 0 ? {} : {
      textureCoordinateSets: Object.freeze(
        primitive.textureCoordinateSets.map(
          (channel) => Object.freeze({ set: channel.set, coordinates: channel.coordinates.slice() })
        )
      )
    }
  });
}
function createModelSceneSource({
  info,
  nodes,
  meshes,
  primitives = []
}) {
  const ownedInfo = Object.freeze({ ...info });
  const ownedNodes = Object.freeze(nodes.map(frozenModelNode));
  const ownedMeshes = Object.freeze(meshes.map(frozenModelMesh));
  const ownedPrimitives = new Map(primitives.map((value) => [value.id, clonePrimitive(value)]));
  const page = (items, request) => {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new TypeError("model page limit must be a positive safe integer");
    }
    const start = pageStart(request.cursor);
    const values = items.slice(start, start + request.limit);
    return Object.freeze({
      items: Object.freeze(values),
      ...start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}
    });
  };
  const source = {
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async nodes(request, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return page(ownedNodes, request);
    },
    async meshes(request, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return page(ownedMeshes, request);
    }
  };
  if (ownedPrimitives.size > 0) {
    source.primitive = async (primitiveId, request, signal) => {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 0) {
        throw new TypeError("model primitive maxBytes must be a non-negative safe integer");
      }
      const primitive = ownedPrimitives.get(primitiveId);
      if (primitive === void 0) throw new RangeError(`unknown model primitive ${primitiveId}`);
      const bytes = modelPrimitiveByteLength(primitive);
      if (bytes > request.maxBytes) throw new RangeError("model primitive exceeds maxBytes budget");
      return clonePrimitive(primitive);
    };
  }
  return Object.freeze(source);
}
function facetPage(items, request) {
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
    throw new TypeError("model facet page limit must be a positive safe integer");
  }
  const start = pageStart(request.cursor);
  const values = items.slice(start, start + request.limit);
  return Object.freeze({
    items: Object.freeze(values),
    ...start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}
  });
}
function facetSource(info, key, items) {
  const owned = Object.freeze(items.map((item) => Object.freeze({ ...item })));
  const source = {
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return info;
    }
  };
  source[key] = async (request, signal) => {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    return facetPage(owned, request);
  };
  return Object.freeze(source);
}
function createModelResourceRefsSource({
  references,
  truncated = false
}) {
  const items = [...references];
  const info = Object.freeze({
    references: items.length,
    bound: items.filter((item) => item.bindingId !== void 0).length,
    truncated: truncated === true
  });
  return facetSource(info, "references", items);
}
function createModelSkeletonSource({
  bindings,
  hierarchies,
  budget
}) {
  const items = snapshotModelSkeleton(bindings, budget);
  const info = Object.freeze({
    bindings: items.length,
    named: items.filter((item) => item.boneName !== null).length,
    companionBound: items.filter((item) => item.provenance === "companion").length,
    // absent, not zero, when the publisher does not enumerate hierarchies
    ...hierarchies === void 0 ? {} : { hierarchies }
  });
  return facetSource(info, "bindings", items);
}
function createModelAnimationSource({
  clips,
  budget
}) {
  const items = snapshotModelAnimations(clips, budget);
  const info = Object.freeze({
    clips: items.length,
    channelled: items.filter((clip) => clip.channels.length > 0).length,
    companionBound: items.filter((clip) => clip.provenance === "companion").length
  });
  return facetSource(info, "clips", items);
}
function createModelCollisionSource({
  volumes
}) {
  const items = volumes.map((volume) => ({
    ...volume,
    ...volume.types === void 0 ? {} : { types: Object.freeze([...volume.types]) }
  }));
  const byKind = {};
  for (const volume of items) byKind[volume.kind] = (byKind[volume.kind] ?? 0) + 1;
  const info = Object.freeze({ volumes: items.length, byKind: Object.freeze(byKind) });
  return facetSource(info, "volumes", items);
}
function createModelMaterialSource({
  materials,
  libraries,
  budget
}) {
  const items = snapshotModelMaterials(materials, budget);
  const byContract = {};
  for (const material of items) {
    for (const contract of material.contracts ?? []) {
      byContract[contract] = (byContract[contract] ?? 0) + 1;
    }
  }
  const info = Object.freeze({
    materials: items.length,
    // absent, not zero, when the format has no library concept at all
    ...libraries === void 0 ? {} : { libraries },
    ...Object.keys(byContract).length === 0 ? {} : { byContract: Object.freeze(byContract) }
  });
  return facetSource(info, "materials", items);
}
function createModelEffectSource({
  effects,
  profile
}) {
  const items = effects.map((effect) => ({
    ...effect,
    ...effect.properties === void 0 ? {} : { properties: Object.freeze(effect.properties.map((one) => Object.freeze({ ...one }))) }
  }));
  const byKind = {};
  for (const effect of items) byKind[effect.kind] = (byKind[effect.kind] ?? 0) + 1;
  return facetSource(
    Object.freeze({
      effects: items.length,
      byKind: Object.freeze(byKind),
      ...profile === void 0 ? {} : { profile }
    }),
    "effects",
    items
  );
}
function createModelLightSource({
  lights
}) {
  const items = lights.map((light) => ({
    ...light,
    ...light.color === void 0 ? {} : { color: Object.freeze([...light.color]) },
    ...light.properties === void 0 ? {} : {
      properties: Object.freeze(
        light.properties.map((one) => Object.freeze({ ...one }))
      )
    }
  }));
  const byKind = {};
  for (const light of items) byKind[light.kind] = (byKind[light.kind] ?? 0) + 1;
  return facetSource(
    Object.freeze({ lights: items.length, byKind: Object.freeze(byKind) }),
    "lights",
    items
  );
}
function createModelCameraSource({
  cameras
}) {
  const items = cameras.map((camera) => ({
    ...camera,
    ...camera.properties === void 0 ? {} : {
      properties: Object.freeze(
        camera.properties.map((one) => Object.freeze({ ...one }))
      )
    }
  }));
  return facetSource(
    Object.freeze({ cameras: items.length }),
    "cameras",
    items
  );
}
function createModelPhysicsSource({
  bodies
}) {
  const items = bodies.map((body) => ({
    ...body,
    ...body.properties === void 0 ? {} : {
      properties: Object.freeze(
        body.properties.map((one) => Object.freeze({ ...one }))
      )
    }
  }));
  const byKind = {};
  for (const body of items) byKind[body.kind] = (byKind[body.kind] ?? 0) + 1;
  return facetSource(
    Object.freeze({ bodies: items.length, byKind: Object.freeze(byKind) }),
    "bodies",
    items
  );
}
function createModelNodeBehaviourSource({
  behaviours
}) {
  const items = behaviours.map((behaviour) => ({
    ...behaviour,
    ...behaviour.nodeIds === void 0 ? {} : { nodeIds: Object.freeze([...behaviour.nodeIds]) },
    ...behaviour.properties === void 0 ? {} : {
      properties: Object.freeze(
        behaviour.properties.map((one) => Object.freeze({ ...one }))
      )
    }
  }));
  const byKind = {};
  for (const behaviour of items)
    byKind[behaviour.kind] = (byKind[behaviour.kind] ?? 0) + 1;
  return facetSource(
    Object.freeze({ behaviours: items.length, byKind: Object.freeze(byKind) }),
    "behaviours",
    items
  );
}
function createModelSocketSource({
  sockets
}) {
  const items = sockets.map((socket) => ({
    ...socket,
    ...socket.orientation === void 0 ? {} : { orientation: Object.freeze({ ...socket.orientation }) }
  }));
  const byRole = {};
  for (const socket of items) byRole[socket.role] = (byRole[socket.role] ?? 0) + 1;
  return facetSource(
    Object.freeze({ sockets: items.length, byRole: Object.freeze(byRole) }),
    "sockets",
    items
  );
}

// packages/codec-kit/src/xml-scan.ts
function decodeXmlEntities(source) {
  if (!source.includes("&")) return source;
  return source.replace(/&(?:#(x[0-9A-Fa-f]+|[0-9]+)|([A-Za-z][A-Za-z0-9]*));/gu, (raw, numeric, named) => {
    if (numeric !== void 0) {
      const hex = numeric[0]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 1114111 ? String.fromCodePoint(codePoint) : raw;
    }
    return NAMED_ENTITIES[named.toLowerCase()] ?? raw;
  });
}
var NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
});
function encodeXmlText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function encodeXmlAttribute(value, quote = '"') {
  const escaped = encodeXmlText(value);
  if (quote === "both") return escaped.replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  return quote === '"' ? escaped.replaceAll('"', "&quot;") : escaped.replaceAll("'", "&apos;");
}
var NAME_CHAR = /[A-Za-z0-9_:.-]/;
function readTag(text2, lt) {
  let i = lt + 1;
  let closing = false;
  if (text2[i] === "/") {
    closing = true;
    i++;
  }
  const tagStart = i;
  while (i < text2.length && NAME_CHAR.test(text2[i])) i++;
  if (i === tagStart) return void 0;
  const tag = text2.slice(tagStart, i);
  const tagEnd = i;
  const attrs = [];
  let selfClosing = false;
  while (i < text2.length) {
    const ch = text2[i];
    if (ch === ">") {
      i++;
      break;
    }
    if (ch === "/" && text2[i + 1] === ">") {
      selfClosing = true;
      i += 2;
      break;
    }
    if (ch === "<") break;
    if (NAME_CHAR.test(ch)) {
      const nameStart = i;
      while (i < text2.length && NAME_CHAR.test(text2[i])) i++;
      const name = text2.slice(nameStart, i);
      const nameEnd = i;
      while (i < text2.length && /\s/.test(text2[i])) i++;
      if (text2[i] === "=") {
        i++;
        while (i < text2.length && /\s/.test(text2[i])) i++;
        const quote = text2[i];
        if (quote === '"' || quote === "'") {
          const valueStart = i + 1;
          const close = text2.indexOf(quote, valueStart);
          const valueEnd = close === -1 ? text2.length : close;
          attrs.push({
            name,
            nameStart,
            nameEnd,
            value: decodeXmlEntities(text2.slice(valueStart, valueEnd)),
            valueStart,
            valueEnd
          });
          i = close === -1 ? text2.length : close + 1;
        }
      }
      continue;
    }
    i++;
  }
  return {
    open: { tag, tagStart, tagEnd, attrs, openEnd: i, selfClosing },
    next: i,
    closing
  };
}
function scanXml(text2) {
  const roots = [];
  const stack = [];
  let i = 0;
  const attach = (el) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.el.children.push(el);
    else roots.push(el);
  };
  while (i < text2.length) {
    const lt = text2.indexOf("<", i);
    if (lt === -1) break;
    if (text2.startsWith("<!--", lt)) {
      const e = text2.indexOf("-->", lt + 4);
      i = e === -1 ? text2.length : e + 3;
      continue;
    }
    if (text2.startsWith("<![CDATA[", lt)) {
      const e = text2.indexOf("]]>", lt + 9);
      i = e === -1 ? text2.length : e + 3;
      continue;
    }
    if (text2.startsWith("<?", lt)) {
      const e = text2.indexOf("?>", lt + 2);
      i = e === -1 ? text2.length : e + 2;
      continue;
    }
    if (text2.startsWith("<!", lt)) {
      const e = text2.indexOf(">", lt + 2);
      i = e === -1 ? text2.length : e + 1;
      continue;
    }
    const parsed = readTag(text2, lt);
    if (!parsed) {
      i = lt + 1;
      continue;
    }
    if (parsed.closing) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag === parsed.open.tag) {
          for (let k = s + 1; k < stack.length; k++) stack[k].el.end = text2.length;
          stack[s].el.end = parsed.next;
          stack.length = s;
          break;
        }
      }
      i = parsed.next;
      continue;
    }
    const { open } = parsed;
    const el = {
      tag: open.tag,
      tagStart: open.tagStart,
      tagEnd: open.tagEnd,
      start: lt,
      end: open.openEnd,
      openEnd: open.openEnd,
      attrs: open.attrs,
      children: []
    };
    attach(el);
    if (!open.selfClosing) stack.push({ el, tag: open.tag });
    i = parsed.next;
  }
  for (const s of stack) s.el.end = text2.length;
  return roots;
}
function getAttr(el, name) {
  return el.attrs.find((a) => a.name === name);
}
function elementPathAt(text2, offset) {
  return pathTo(scanXml(text2), offset, []);
}
function pathTo(els, offset, acc) {
  for (const el of els) {
    if (offset > el.start && offset < el.end) {
      acc.push(el);
      pathTo(el.children, offset, acc);
      return acc;
    }
  }
  return acc;
}
function attrAt(el, offset) {
  return el.attrs.find((a) => offset >= a.valueStart && offset <= a.valueEnd);
}

// packages/codec-kit/src/graph-isolation.ts
function requiredId(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}
function analyzeGraphIsolation(request) {
  if (request.schemaVersion !== 1) throw new TypeError("graph isolation requires schemaVersion 1");
  const ownerId = requiredId(request.ownerId, "ownerId");
  const targetId = requiredId(request.targetId, "targetId");
  if (!Number.isSafeInteger(request.maxEdges) || request.maxEdges <= 0) {
    throw new TypeError("maxEdges must be a positive safe integer");
  }
  if (request.edges.length > request.maxEdges) {
    throw new RangeError(`graph isolation edge limit exceeded (${request.maxEdges})`);
  }
  if (!request.complete) {
    return Object.freeze({
      schemaVersion: 1,
      state: "unavailable",
      ownerId,
      targetId,
      reason: "relation graph is incomplete; another referrer may be missing"
    });
  }
  const selected = request.selectedEdgeIds === void 0 ? void 0 : new Set(request.selectedEdgeIds);
  if (selected?.size !== request.selectedEdgeIds?.length) {
    throw new TypeError("selectedEdgeIds must not contain duplicates");
  }
  const ids = /* @__PURE__ */ new Set();
  const incoming = /* @__PURE__ */ new Map();
  const rewritableOwnerEdges = [];
  for (const edge of request.edges) {
    requiredId(edge.id, "edge.id");
    requiredId(edge.from, "edge.from");
    requiredId(edge.to, "edge.to");
    requiredId(edge.relation, "edge.relation");
    if (ids.has(edge.id)) throw new TypeError(`duplicate graph edge id: ${edge.id}`);
    ids.add(edge.id);
    if (edge.to !== targetId) continue;
    const edgeIds = incoming.get(edge.from) ?? [];
    edgeIds.push(edge.id);
    incoming.set(edge.from, edgeIds);
    if (edge.from === ownerId && edge.rewritable && (selected === void 0 || selected.has(edge.id))) {
      rewritableOwnerEdges.push(edge.id);
    }
  }
  if (selected !== void 0) {
    for (const edgeId of selected) {
      if (!ids.has(edgeId)) throw new RangeError(`selected graph edge does not exist: ${edgeId}`);
    }
  }
  if (rewritableOwnerEdges.length === 0) {
    return Object.freeze({
      schemaVersion: 1,
      state: "unavailable",
      ownerId,
      targetId,
      reason: `${ownerId} has no selected rewritable edge to ${targetId}`
    });
  }
  const referrers = Object.freeze(
    [...incoming.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([nodeId, edgeIds]) => Object.freeze({ nodeId, edgeIds: Object.freeze([...edgeIds].sort()) })
    )
  );
  const otherReferrerIds = Object.freeze(
    referrers.map((referrer) => referrer.nodeId).filter((nodeId) => nodeId !== ownerId)
  );
  return Object.freeze({
    schemaVersion: 1,
    state: "ready",
    ownerId,
    targetId,
    shared: otherReferrerIds.length > 0,
    referrers,
    otherReferrerIds,
    rewireEdgeIds: Object.freeze([...rewritableOwnerEdges].sort())
  });
}

// packages/codec-kit/src/subject-facts.ts
function abort(signal) {
  if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
}
function pageOf(items, request, signal) {
  abort(signal);
  if (request === null || typeof request !== "object" || !Number.isSafeInteger(request.limit) || request.limit <= 0) {
    throw new TypeError("page limit must be a positive safe integer");
  }
  const start = request.cursor === void 0 ? 0 : Number(request.cursor);
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length) {
    throw new RangeError("page cursor is invalid");
  }
  const end = Math.min(items.length, start + request.limit);
  return Object.freeze({
    items: Object.freeze(items.slice(start, end)),
    ...end < items.length ? { nextCursor: String(end) } : {}
  });
}
function provenanceOf(source, semanticPath = []) {
  return Object.freeze([
    Object.freeze({
      label: source.uri,
      source,
      semanticPath: Object.freeze([...semanticPath])
    })
  ]);
}
function fact(source, id, label, value, semanticPath = []) {
  return Object.freeze({ id, label, value, provenance: provenanceOf(source, semanticPath) });
}
function createSubjectFactsSource(options) {
  const groups = Object.freeze(
    options.groups.filter((group) => group.facts.length > 0).map(
      (group) => Object.freeze({ id: group.id, label: group.label, factCount: group.facts.length })
    )
  );
  const facts = new Map(options.groups.map((group) => [group.id, Object.freeze([...group.facts])]));
  const relations = Object.freeze([...options.relations ?? []]);
  const summary = Object.freeze({
    snapshotId: options.snapshotId,
    identity: Object.freeze({
      subjectId: options.subjectId,
      label: options.label,
      kind: options.kind,
      ...options.type === void 0 ? {} : { type: options.type },
      origins: provenanceOf(options.source)
    }),
    groupCount: groups.length,
    relationCount: relations.length
  });
  return Object.freeze({
    async summary(signal) {
      abort(signal);
      return summary;
    },
    async groups(request, signal) {
      return pageOf(groups, request, signal);
    },
    async facts(groupId, request, signal) {
      const values = facts.get(groupId);
      if (values === void 0) throw new RangeError(`unknown fact group: ${groupId}`);
      return pageOf(values, request, signal);
    },
    async relations(request, signal) {
      return pageOf(relations, request, signal);
    }
  });
}
function createRelationGraphSource(options) {
  const nodes = Object.freeze([...options.nodes]);
  const edges = Object.freeze([...options.edges]);
  const counts = /* @__PURE__ */ new Map();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const types = Object.freeze(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, count], tone) => Object.freeze({ id, label: id, count, tone }))
  );
  const summary = Object.freeze({
    snapshotId: options.snapshotId,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    types,
    completeness: options.completeness ?? "complete",
    ...options.reason === void 0 ? {} : { reason: options.reason }
  });
  return Object.freeze({
    async summary(signal) {
      abort(signal);
      return summary;
    },
    async nodes(request, signal) {
      return pageOf(nodes, request, signal);
    },
    async edges(request, signal) {
      return pageOf(edges, request, signal);
    }
  });
}
function subjectIdFor(scope, path) {
  if (scope === "") throw new TypeError("a subject id needs a scope");
  if (path.length === 0) throw new TypeError("a subject id needs at least one path segment");
  return `modkit-subject://${encodeURIComponent(scope)}/${path.map(encodeURIComponent).join("/")}`;
}
function parseSubjectId(id) {
  const prefix = "modkit-subject://";
  if (!id.startsWith(prefix)) return void 0;
  const segments = id.slice(prefix.length).split("/").filter((part) => part !== "");
  if (segments.length < 2) return void 0;
  return {
    scope: decodeURIComponent(segments[0]),
    path: segments.slice(1).map(decodeURIComponent)
  };
}
function subjectFieldGroup(source, group, fields) {
  return {
    id: group.id,
    label: group.label,
    facts: fields.map(
      (field) => Object.freeze({
        id: field.id,
        label: field.label,
        value: field.value,
        provenance: provenanceOf(source, field.semanticPath ?? []),
        ...field.type === void 0 ? {} : { type: field.type },
        ...field.unit === void 0 ? {} : { unit: field.unit },
        ...field.editable === void 0 ? {} : { editable: field.editable }
      })
    )
  };
}

// packages/codec-kit/src/table-source.ts
function createTableDataSource(options) {
  const header = Object.freeze([...options.header]);
  const rows = options.rows.map(
    (cells, index) => Object.freeze({ index, cells: Object.freeze(cells.map(String)) })
  );
  const startOf = (request) => {
    if (!Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new TypeError("table page count must be a positive safe integer");
    }
    const start = request.kind === "range" ? request.from : Number(request.cursor ?? 0);
    if (!Number.isSafeInteger(start) || (start ?? -1) < 0) {
      throw new TypeError("table page start is invalid");
    }
    return start;
  };
  return Object.freeze({
    async shape() {
      return { rows: rows.length, columns: header.length, header: [...header] };
    },
    async rows(request, signal) {
      signal?.throwIfAborted();
      const start = startOf(request);
      const items = rows.slice(start, start + request.count);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < rows.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async cell(coord) {
      const value = rows[coord.row]?.cells[coord.column];
      if (value === void 0) throw new RangeError("table cell is outside the table");
      return Object.freeze({ value, ...options.cellFacts?.(coord, value) ?? {} });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      for (const row of rows) {
        for (let column = 0; column < row.cells.length; column += 1) {
          signal?.throwIfAborted();
          if (row.cells[column].toLocaleLowerCase().includes(needle)) {
            yield { row: row.index, column };
          }
        }
      }
    }
  });
}

// packages/codec-kit/src/index.ts
var INSPECTION_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["json"])
  }),
  Object.freeze({
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["bytes"])
  })
]);
function simpleLease(value) {
  let released = false;
  return Object.freeze({
    value,
    async release() {
      released = true;
    },
    isReleased: () => released
  });
}
function createTreeDataSource(rootNode) {
  const nodes = /* @__PURE__ */ new Map();
  const register = (node, id) => {
    const children = Array.isArray(node.children) ? node.children : [];
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) });
    children.forEach((child, index) => register(child, `${id}/${index}`));
  };
  register(rootNode, "root");
  const ref = (id) => {
    const item = nodes.get(id);
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 });
  };
  return Object.freeze({
    async root() {
      return ref("root");
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError("tree page limit must be a positive safe integer");
      }
      const start = pageStart(page.cursor);
      const childIds = nodes.get(node.id)?.childIds ?? [];
      const items = childIds.slice(start, start + page.limit).map(ref);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < childIds.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node;
      if (value === void 0) throw new TypeError(`unknown tree node ${node.id}`);
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...value.preview === void 0 ? {} : { preview: value.preview },
        ...value.subjectId === void 0 ? {} : { subjectId: value.subjectId },
        ...value.semanticPath === void 0 ? {} : { semanticPath: Object.freeze([...value.semanticPath]) },
        ...value.value === void 0 ? {} : { value: value.value },
        ...value.type === void 0 ? {} : { type: value.type },
        ...value.unit === void 0 ? {} : { unit: value.unit },
        ...value.editable === void 0 ? {} : { editable: value.editable },
        ...value.spans === void 0 ? {} : { spans: value.spans }
      });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      for (const [id, item] of nodes) {
        if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
        const haystack = `${item.node.label}
${item.node.preview ?? ""}`.toLocaleLowerCase();
        if (haystack.includes(needle)) yield ref(id);
      }
    }
  });
}
function createTransportSource(snapshot, options = {}) {
  const updateIntervalMs = options.updateIntervalMs ?? 50;
  if (!Number.isSafeInteger(updateIntervalMs) || updateIntervalMs <= 0) {
    throw new RangeError("transport updateIntervalMs must be a positive safe integer");
  }
  let current = {
    ...snapshot,
    tracks: snapshot.tracks.map((track) => ({ ...track })),
    controls: { ...snapshot.controls }
  };
  const listeners = /* @__PURE__ */ new Set();
  let timer;
  let previousTick = 0;
  const owned = () => Object.freeze({
    ...current,
    tracks: Object.freeze(current.tracks.map((track) => Object.freeze({ ...track }))),
    controls: Object.freeze({ ...current.controls })
  });
  const publish = () => {
    const event = Object.freeze({ kind: "snapshot", snapshot: owned() });
    for (const listener of listeners) listener(event);
  };
  const stopClock = () => {
    if (timer !== void 0) globalThis.clearInterval(timer);
    timer = void 0;
  };
  const startClock = () => {
    if (options.wallClock !== true || timer !== void 0 || current.state !== "playing" || listeners.size === 0 || typeof current.durationMs !== "number")
      return;
    previousTick = Date.now();
    timer = globalThis.setInterval(() => {
      const now = Date.now();
      const elapsed = now - previousTick;
      previousTick = now;
      const positionMs = Math.min(
        current.durationMs,
        current.positionMs + elapsed * current.rate
      );
      current = {
        ...current,
        positionMs,
        state: positionMs >= current.durationMs ? "ended" : current.state
      };
      publish();
      if (current.state === "ended") stopClock();
    }, updateIntervalMs);
  };
  return Object.freeze({
    async snapshot(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return owned();
    },
    async *events(signal) {
      if (signal?.aborted) return;
      const queue = [Object.freeze({ kind: "snapshot", snapshot: owned() })];
      let wake;
      const listener = (event) => {
        queue.push(event);
        wake?.();
      };
      const abort2 = () => wake?.();
      listeners.add(listener);
      startClock();
      signal?.addEventListener("abort", abort2, { once: true });
      try {
        while (!signal?.aborted) {
          if (queue.length === 0) await new Promise((resolve) => wake = resolve);
          wake = void 0;
          const event = queue.shift();
          if (event !== void 0) yield event;
        }
      } finally {
        listeners.delete(listener);
        if (listeners.size === 0) stopClock();
        signal?.removeEventListener("abort", abort2);
      }
    },
    control(kind, input = {}) {
      if (kind === "playPause") {
        current = {
          ...current,
          positionMs: current.state === "ended" ? 0 : current.positionMs,
          state: current.state === "playing" ? "paused" : "playing"
        };
      } else if (kind === "seek") {
        const positionMs = input?.["positionMs"];
        if (!Number.isFinite(positionMs) || positionMs < 0)
          throw new RangeError("transport seek requires a non-negative positionMs");
        const maximum = typeof current.durationMs === "number" ? current.durationMs : positionMs;
        current = { ...current, positionMs: Math.min(positionMs, maximum) };
      } else if (kind === "setRate") {
        const rate = input?.["rate"];
        if (!Number.isFinite(rate) || rate <= 0 || rate > 16)
          throw new RangeError("transport rate must be within (0, 16]");
        current = { ...current, rate };
      } else if (kind === "selectTrack") {
        const trackId = input?.["trackId"];
        if (typeof trackId !== "string" || !current.tracks.some((track) => track.id === trackId))
          throw new RangeError("transport selectTrack requires a known trackId");
        current = {
          ...current,
          tracks: current.tracks.map((track) => ({ ...track, selected: track.id === trackId }))
        };
      } else {
        throw new RangeError(`unknown transport control: ${kind}`);
      }
      publish();
      if (current.state === "playing") startClock();
      else stopClock();
    }
  });
}
var TRANSPORT_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "media.play-pause",
    handlerId: "transport-play-pause",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.seek",
    handlerId: "transport-seek",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.set-rate",
    handlerId: "transport-set-rate",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  }),
  Object.freeze({
    id: "media.select-track",
    handlerId: "transport-select-track",
    mutatesSource: false,
    requiredPermissions: Object.freeze(["read-source"]),
    outputKinds: Object.freeze(["none"])
  })
]);
function createTransportHandlers(transport) {
  const handler = (kind) => async (input) => {
    transport.control(kind, input);
    return Object.freeze({ kind: "none" });
  };
  return Object.freeze({
    "transport-play-pause": handler("playPause"),
    "transport-seek": handler("seek"),
    "transport-set-rate": handler("setRate"),
    "transport-select-track": handler("selectTrack")
  });
}
function assertBoundedRead(offset, length, size) {
  if (typeof offset !== "bigint" || offset < 0n || offset > BigInt(size)) {
    throw new RangeError("encoded media offset is outside the source");
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError("encoded media length must be a non-negative safe integer");
  }
}
function createEncodedMediaSource(bytes, descriptor) {
  const owned = Object.freeze({
    mediaType: descriptor.mediaType,
    bytes: BigInt(bytes.byteLength),
    ...descriptor.codecs === void 0 ? {} : { codecs: Object.freeze([...descriptor.codecs]) }
  });
  return Object.freeze({
    async descriptor() {
      return owned;
    },
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      assertBoundedRead(offset, length, bytes.byteLength);
      const start = Number(offset);
      return bytes.slice(start, Math.min(bytes.byteLength, start + length));
    }
  });
}
function createRasterImageSource(bytes, mediaType, info, readRegion) {
  const ownedInfo = Object.freeze({ ...info });
  const encoded = createEncodedMediaSource(bytes, { mediaType });
  const source = {
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return encoded;
    }
  };
  if (readRegion !== void 0) source.readRegion = readRegion;
  return Object.freeze(source);
}
function createAudioMediaSource(bytes, mediaType, info, readPcm) {
  const tracks = Object.freeze(info.tracks.map((track) => Object.freeze({ ...track })));
  const ownedInfo = Object.freeze({ ...info, tracks });
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map((track) => track.codec)
  });
  if (ownedInfo.pcmAccess === true && readPcm === void 0) {
    throw new TypeError("audio source declares pcmAccess without a readPcm implementation");
  }
  const source = {
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(trackId, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (trackId !== void 0 && trackId !== null && !tracks.some((track) => track.id === trackId)) {
        throw new RangeError(`unknown audio track ${trackId}`);
      }
      return encoded;
    }
  };
  if (readPcm !== void 0) source.readPcm = readPcm;
  return Object.freeze(source);
}
function createVideoMediaSource(bytes, mediaType, info) {
  const tracks = Object.freeze(info.tracks.map((track) => Object.freeze({ ...track })));
  const ownedInfo = Object.freeze({ ...info, tracks });
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map((track) => track.codec)
  });
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return encoded;
    }
  });
}
function createVectorSceneSource(info, text2) {
  const ownedInfo = Object.freeze({
    ...info,
    ...info.viewBox === void 0 ? {} : { viewBox: Object.freeze([...info.viewBox]) }
  });
  const document = Object.freeze({
    mediaType: "image/svg+xml",
    profile: "uvg.secure-static.v1",
    text: text2
  });
  return Object.freeze({
    async info(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return ownedInfo;
    },
    async document(signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      return document;
    }
  });
}
function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
function projectionReceiptMetadataGroup(receipt, identity) {
  const portable = toPortableProjectionReceipt(receipt, identity);
  return Object.freeze({
    id: PROJECTION_RECEIPT_METADATA_ID,
    label: "UV projection receipt",
    entries: Object.freeze([Object.freeze({ key: "receipt", value: jsonSafe(portable) })])
  });
}
var CODEC_SOURCE_IDENTITY = Object.freeze({
  kind: "redacted",
  reason: "a codec projects a subject the host already opened; its portable identity is the subject revision this receipt carries, and an ambient URI would leak the producing machine into every copy"
});
function descriptorMetadata(inspection) {
  const groups = inspection.metadata ?? [];
  if (inspection.projectionReceipt === void 0) return groups;
  return [
    ...groups,
    projectionReceiptMetadataGroup(inspection.projectionReceipt, CODEC_SOURCE_IDENTITY)
  ];
}
function inspectionOperations(declarations, states = []) {
  const declaredIds = new Set(declarations.map((operation) => operation.id));
  const byId = /* @__PURE__ */ new Map();
  for (const operation of states) {
    const id = operation.id;
    if (!declaredIds.has(operation.id)) {
      throw new TypeError(`operation state references undeclared operation ${operation.id}`);
    }
    if (byId.has(operation.id)) {
      throw new TypeError(`duplicate operation state for ${operation.id}`);
    }
    if (operation.state === "available") {
      if (operation.reason !== void 0) {
        throw new TypeError(`available operation ${id} cannot have a reason`);
      }
    } else if (operation.state !== "disabled" && operation.state !== "dependency-required" || typeof operation.reason !== "string" || operation.reason.length === 0) {
      throw new TypeError(`invalid operation state or reason for ${operation.id}`);
    }
    byId.set(operation.id, operation);
  }
  return Object.freeze(
    declarations.map((operation) => {
      const override = byId.get(operation.id);
      const identity = {
        id: operation.id,
        handlerId: operation.handlerId,
        mutatesSource: operation.mutatesSource,
        ...operation.inputSchema === void 0 ? {} : { inputSchema: operation.inputSchema }
      };
      return Object.freeze(
        override === void 0 || override.state === "available" ? { ...identity, state: "available" } : { ...identity, state: override.state, reason: override.reason }
      );
    })
  );
}
async function readAll(source, budget, signal) {
  if (source.kind !== "bytes" || source.size === void 0) {
    throw new TypeError("inspection codecs require a sized byte source");
  }
  if (source.size > budget.maxInputBytes || source.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("source exceeds the inspection budget");
  }
  const total = Number(source.size);
  const result = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
    const chunk = await source.read(BigInt(offset), Math.min(64 * 1024, total - offset), signal);
    if (chunk.byteLength === 0) throw new RangeError("source ended before its declared size");
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function memoryByteSource(bytes) {
  return Object.freeze({
    size: async () => BigInt(bytes.byteLength),
    async read(offset, length, readSignal) {
      if (readSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (offset < 0n || offset > BigInt(bytes.byteLength) || length < 0) {
        throw new RangeError("byte range is outside the source");
      }
      return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length));
    }
  });
}
var RANGE_DETECT_PREFIX_BYTES = 64 * 1024;
var RANGE_READ_CHUNK_BYTES = 8 * 1024 * 1024;
function rangeByteSource(source, budget) {
  if (source.kind !== "bytes" || source.size === void 0) {
    throw new TypeError("range inspection codecs require a sized byte source");
  }
  const size = source.size;
  const maximum = BigInt(budget.maxInputBytes);
  return Object.freeze({
    size: async () => size,
    async read(offset, length, readSignal) {
      if (readSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (typeof offset !== "bigint" || offset < 0n || offset > size || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError("byte range is outside the source");
      }
      if (BigInt(length) > maximum) {
        throw new RangeError("byte range exceeds the inspection budget");
      }
      const end = offset + BigInt(length) < size ? offset + BigInt(length) : size;
      const result = new Uint8Array(Number(end - offset));
      let filled = 0;
      while (filled < result.byteLength) {
        if (readSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
        const wanted = Math.min(RANGE_READ_CHUNK_BYTES, result.byteLength - filled);
        const chunk = await source.read(offset + BigInt(filled), wanted, readSignal);
        if (chunk.byteLength === 0) throw new RangeError("source ended before its declared size");
        const taken = Math.min(chunk.byteLength, wanted);
        result.set(chunk.subarray(0, taken), filled);
        filled += taken;
      }
      return result;
    }
  });
}
function originFrom(input, primary, companions = []) {
  const requiredCompanionBindings = new Set(
    companions.flatMap(
      (companion) => companion.required === true && companion.state === "resolved" ? companion.bindingIds : []
    )
  );
  const toBinding = (binding) => ({
    id: binding.bindingId,
    role: binding.role,
    source: binding.source,
    required: binding.sourceKind === "candidate" || requiredCompanionBindings.has(binding.bindingId),
    ownership: binding.ownership,
    revision: binding.revision
  });
  if (input.originKind === "single")
    return { kind: "single", binding: toBinding(primary) };
  if (input.originKind === "bundle") {
    return {
      kind: "bundle",
      bindings: input.bindings.map(toBinding),
      primary: input.primaryBindingId
    };
  }
  if (input.originKind === "namespace") {
    return { kind: "namespace", root: input.root, revision: input.revisions.namespaceRevision };
  }
  throw new TypeError("inspection codec requires a physical byte input");
}
function probeLength(plan, size) {
  const first = plan.ranges[0];
  const declared = Math.min(plan.maxBytes, first?.length ?? plan.maxBytes);
  const available = size === void 0 ? declared : Number(size);
  return Math.max(0, Math.min(declared, available));
}
function createInspectionCodec(definition, contributionContext) {
  if (definition.deferInspection === true) {
    const codec = createInspectionCodec(
      { ...definition, deferInspection: false },
      contributionContext
    );
    return Object.freeze({
      ...codec,
      async open(input, intent, budget, signal) {
        signal?.throwIfAborted();
        const ownedBudget = Object.freeze({ ...budget });
        return deferAssetSession(
          revisionId(input.revisions.revision),
          (initializeSignal) => codec.open(input, intent, ownedBudget, initializeSignal),
          ownedBudget,
          signal
        );
      }
    });
  }
  const namespaceDefinition = definition.namespace;
  const rangeDefinition = definition.access === "ranges" ? definition : void 0;
  const customOperations = Object.freeze([...definition.operations ?? []]);
  const sharedOperations = namespaceDefinition === void 0 && rangeDefinition === void 0 ? INSPECTION_OPERATIONS : INSPECTION_OPERATIONS.filter((operation) => operation.handlerId !== "export-raw");
  const customIds = /* @__PURE__ */ new Set();
  for (const operation of customOperations) {
    if (customIds.has(operation.id))
      throw new TypeError(`Duplicate custom operation: ${operation.id}`);
    customIds.add(operation.id);
  }
  const operationDeclarations = Object.freeze([
    ...sharedOperations.filter((operation) => !customIds.has(operation.id)),
    ...customOperations
  ]);
  const handlerIds = /* @__PURE__ */ new Set();
  for (const operation of operationDeclarations) {
    if (handlerIds.has(operation.handlerId))
      throw new TypeError(`Duplicate operation handler: ${operation.handlerId}`);
    handlerIds.add(operation.handlerId);
  }
  return Object.freeze({
    async probe(request, signal) {
      if (namespaceDefinition !== void 0) {
        if (request.source.kind !== "namespace" || request.plan.kind !== "namespace") {
          throw new TypeError(`${definition.id} requires a namespace probe`);
        }
        const namespaceLease = await request.source.openNamespace(signal);
        try {
          const markers = [];
          for (const path of request.plan.markers) {
            let entryLease;
            try {
              entryLease = await namespaceLease.value.open(path, signal);
            } catch (error) {
              const code = error?.code;
              if (code === "x3.host/namespace-entry-not-found") continue;
              throw error;
            }
            try {
              markers.push(
                Object.freeze({
                  path,
                  kind: entryLease.value.kind === "namespace" ? "directory" : "file",
                  ...entryLease.value.kind === "bytes" && entryLease.value.size !== void 0 ? { size: entryLease.value.size } : {}
                })
              );
            } finally {
              await entryLease.release();
            }
          }
          const detected2 = await namespaceDefinition.detect(
            Object.freeze(markers),
            request.source.ref.uri
          );
          return Object.freeze({
            codecId: definition.id,
            confidence: detected2.confidence,
            evidence: Object.freeze([
              Object.freeze({
                kind: detected2.kind ?? "structure",
                weight: detected2.confidence,
                note: detected2.note
              })
            ]),
            requiredRanges: Object.freeze([])
          });
        } finally {
          await namespaceLease.release();
        }
      }
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
        throw new TypeError(`${definition.id} requires a byte probe`);
      }
      const bytes = await request.source.read(
        0n,
        probeLength(request.plan, request.source.size),
        signal
      );
      const detected = await definition.detect(bytes, request.source.ref.uri);
      return Object.freeze({
        codecId: definition.id,
        confidence: detected.confidence,
        evidence: Object.freeze([
          Object.freeze({
            kind: detected.kind ?? "magic",
            weight: detected.confidence,
            note: detected.note
          })
        ]),
        requiredRanges: Object.freeze([
          Object.freeze({ byteOffset: "0", byteLength: String(bytes.byteLength) })
        ])
      });
    },
    async planInput(source, evidence, signal) {
      if (definition.planInput !== void 0) {
        return definition.planInput(source, evidence, signal, contributionContext);
      }
      if (namespaceDefinition !== void 0) {
        if (source.kind !== "namespace") {
          throw new TypeError(`${definition.id} requires a namespace input`);
        }
        return Object.freeze({ originKind: "namespace", requirements: Object.freeze([]) });
      }
      return Object.freeze({
        originKind: "single",
        candidate: Object.freeze({ bindingId: "content", role: "content", ownership: "owned" }),
        requirements: Object.freeze([])
      });
    },
    async open(input, intent, budget, signal) {
      if (namespaceDefinition !== void 0) {
        if (input.originKind !== "namespace") {
          throw new TypeError(`${definition.id} requires a namespace input`);
        }
        const namespaceLease = await input.openNamespace(signal);
        try {
          const inspection = await namespaceDefinition.inspect(namespaceLease.value, {
            ...contributionContext === void 0 ? {} : {
              contracts: contributionContext.contracts,
              ...contributionContext.modelResources === void 0 ? {} : { modelResources: contributionContext.modelResources },
              ...contributionContext.rasterResources === void 0 ? {} : { rasterResources: contributionContext.rasterResources },
              ...contributionContext.logicalResources === void 0 ? {} : { logicalResources: contributionContext.logicalResources }
            },
            budget,
            signal,
            intent,
            settings: contributionSettingsFor(contributionContext?.settings, input.root.uri),
            namespace: namespaceLease.value,
            input
          });
          const dataSources = new Map(Object.entries(inspection.dataSources ?? {}));
          const descriptor = await assembleSubjectDescriptor({
            schemaVersion: 2,
            subjectUri: input.root.uri,
            origin: originFrom(input),
            interpretation: "codec",
            identity: {
              codecId: definition.id,
              codecVersion: definition.version ?? "1.0.0",
              formatId: definition.format.id,
              formatLabel: definition.format.label,
              ...definition.format.mediaType === void 0 ? {} : { mediaType: definition.format.mediaType },
              confidence: inspection.detection.confidence,
              detection: [
                {
                  kind: inspection.detection.kind ?? "structure",
                  weight: inspection.detection.confidence,
                  ...inspection.detection.note === void 0 ? {} : { note: inspection.detection.note }
                }
              ]
            },
            traits: inspection.traits.map((trait) => ({
              id: trait.id,
              descriptorVersion: 1,
              state: "available",
              ...trait.parameters === void 0 ? {} : { parameters: trait.parameters }
            })),
            operations: inspectionOperations(operationDeclarations, inspection.operationStates),
            constraints: {
              readOnly: !operationDeclarations.some((operation) => operation.mutatesSource === true),
              seekable: false,
              randomAccess: false,
              trusted: false,
              ...inspection.maxDecodedBytes === void 0 ? {} : { maxDecodedBytes: String(inspection.maxDecodedBytes) },
              ...inspection.unsupportedFeatures === void 0 ? {} : { unsupportedFeatures: inspection.unsupportedFeatures }
            },
            dataSources: [...dataSources.keys()].map(
              (contract) => ({ contract, major: 1 })
            ),
            diagnostics: inspection.diagnostics ?? [],
            metadata: descriptorMetadata(inspection),
            revision: input.revisions.revision
          });
          const handlers = new Map([
            ["inspect", async () => ({ kind: "json", value: inspection.summary })],
            ["validate", async () => ({ kind: "none" })],
            ...Object.entries(inspection.handlers ?? {})
          ]);
          return createAssetSession({
            maxOperationDiagnostics: budget.maxDiagnostics,
            revision: revisionId(input.revisions.revision),
            descriptor,
            operationDeclarations,
            permissionGrant: {
              id: `${definition.format.id}-inspection-session`,
              classes: declaredPermissionClasses(operationDeclarations)
            },
            handlers,
            async openDataSource(contract) {
              const value = dataSources.get(contract);
              if (value === void 0)
                throw new TypeError(`${definition.id} does not publish ${contract}`);
              return simpleLease(value);
            },
            release: [() => namespaceLease.release()]
          }).session;
        } catch (error) {
          await namespaceLease.release();
          throw error;
        }
      }
      if (input.originKind !== "single" && input.originKind !== "bundle") {
        throw new TypeError(`${definition.id} requires a single or bundle byte input`);
      }
      const primaryId = input.primaryBindingId;
      const primary = input.bindings.find((binding) => binding.bindingId === primaryId);
      if (primary === void 0) throw new TypeError("primary binding is missing");
      const sourceLease = await input.openBinding(primary.bindingId, signal);
      const source = sourceLease.value;
      try {
        const bytes = rangeDefinition === void 0 ? await readAll(source, budget, signal) : void 0;
        const byteSource = bytes === void 0 ? rangeByteSource(source, budget) : memoryByteSource(bytes);
        const sourceSize = await byteSource.size();
        const readable = BigInt(budget.maxInputBytes) < sourceSize ? BigInt(budget.maxInputBytes) : sourceSize;
        const prefix = bytes ?? await byteSource.read(0n, Math.min(RANGE_DETECT_PREFIX_BYTES, Number(readable)), signal);
        const detected = await definition.detect(prefix, primary.source.uri);
        const inspectionContext = {
          ...contributionContext === void 0 ? {} : {
            contracts: contributionContext.contracts,
            ...contributionContext.modelResources === void 0 ? {} : { modelResources: contributionContext.modelResources },
            ...contributionContext.rasterResources === void 0 ? {} : { rasterResources: contributionContext.rasterResources },
            ...contributionContext.logicalResources === void 0 ? {} : { logicalResources: contributionContext.logicalResources }
          },
          budget,
          signal,
          intent,
          settings: contributionSettingsFor(contributionContext?.settings, primary.source.uri),
          source,
          primary,
          byteSource,
          input
        };
        const inspection = rangeDefinition !== void 0 ? await rangeDefinition.inspect(inspectionContext) : await definition.inspect(bytes, inspectionContext);
        const dataSources = new Map([
          ["common.view/byte-range-source", byteSource],
          ...Object.entries(inspection.dataSources ?? {})
        ]);
        if (inspection.text === true) {
          dataSources.set("common.view/text-data-source", createUtf8TextDataSource(byteSource));
        } else if (typeof inspection.text === "string") {
          const textBytes = new TextEncoder().encode(inspection.text);
          const textByteSource = Object.freeze({
            async size() {
              return BigInt(textBytes.byteLength);
            },
            async read(offset, length, readSignal) {
              if (readSignal?.aborted) throw new DOMException("operation cancelled", "AbortError");
              if (offset < 0n || offset > BigInt(textBytes.byteLength) || length < 0)
                throw new RangeError("text byte range is outside the source");
              return textBytes.slice(
                Number(offset),
                Math.min(textBytes.byteLength, Number(offset) + length)
              );
            }
          });
          dataSources.set("common.view/text-data-source", createUtf8TextDataSource(textByteSource));
        }
        const descriptor = await assembleSubjectDescriptor({
          schemaVersion: 2,
          subjectUri: primary.source.uri,
          origin: originFrom(input, primary, inspection.companions),
          interpretation: "codec",
          identity: {
            codecId: definition.id,
            codecVersion: definition.version ?? "1.0.0",
            formatId: definition.format.id,
            formatLabel: definition.format.label,
            ...definition.format.mediaType === void 0 ? {} : { mediaType: definition.format.mediaType },
            confidence: detected.confidence,
            detection: [
              {
                kind: detected.kind ?? "magic",
                weight: detected.confidence,
                ...detected.note === void 0 ? {} : { note: detected.note }
              }
            ]
          },
          traits: inspection.traits.map((trait) => ({
            id: trait.id,
            descriptorVersion: 1,
            state: "available",
            ...trait.parameters === void 0 ? {} : { parameters: trait.parameters }
          })),
          operations: inspectionOperations(operationDeclarations, inspection.operationStates),
          constraints: {
            // a codec with a mutating operation is not read-only (ADR-HOST-002 Path A)
            readOnly: !operationDeclarations.some((operation) => operation.mutatesSource === true),
            seekable: true,
            randomAccess: true,
            trusted: false,
            maxDecodedBytes: String(inspection.maxDecodedBytes ?? sourceSize),
            ...inspection.unsupportedFeatures === void 0 ? {} : { unsupportedFeatures: inspection.unsupportedFeatures }
          },
          dataSources: [...dataSources.keys()].map(
            (contract) => ({ contract, major: 1 })
          ),
          diagnostics: inspection.diagnostics ?? [],
          metadata: descriptorMetadata(inspection),
          ...inspection.companions === void 0 ? {} : { companions: inspection.companions },
          revision: input.revisions.revision
        });
        const handlers = new Map([
          ["inspect", async () => ({ kind: "json", value: inspection.summary })],
          ["validate", async () => ({ kind: "none" })],
          ...bytes === void 0 ? [] : [
            ["export-raw", async () => ({ kind: "bytes", value: bytes })]
          ],
          ...Object.entries(inspection.handlers ?? {})
        ]);
        return createAssetSession({
          maxOperationDiagnostics: budget.maxDiagnostics,
          revision: revisionId(input.revisions.revision),
          descriptor,
          operationDeclarations,
          permissionGrant: {
            id: `${definition.format.id}-inspection-session`,
            classes: declaredPermissionClasses(operationDeclarations)
          },
          handlers,
          async openDataSource(contract) {
            const value = dataSources.get(contract);
            if (value === void 0)
              throw new TypeError(`${definition.id} does not publish ${contract}`);
            return simpleLease(value);
          },
          release: [() => sourceLease.release()]
        }).session;
      } catch (error) {
        await sourceLease.release();
        throw error;
      }
    }
  });
}
function declaredPermissionClasses(operations) {
  const classes = /* @__PURE__ */ new Set(["read-source"]);
  for (const operation of operations) {
    for (const item of operation.requiredPermissions ?? []) classes.add(item);
    if (operation.mutatesSource === true) classes.add("write-source");
  }
  return Object.freeze([...classes].sort());
}
function defineWriter({
  providerId,
  providerVersion = "1.0.0",
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = "mutate",
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits,
  plan
}) {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId
  });
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip
  });
  const writer = Object.freeze({
    identity,
    offer,
    async validate(change, signal) {
      if (validate !== void 0) return validate(change, signal);
      return { valid: change.targets.length > 0 && change.edits.length > 0, diagnostics: [] };
    },
    async plan(change, signal) {
      if (plan !== void 0) return plan(change, signal);
      const edits = await planEdits(change, signal);
      return Object.freeze({
        planId: `${providerId}:${change.targets.map((target) => target.targetId).join("+")}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: "atomic" }),
        fidelity,
        diagnostics: Object.freeze([])
      });
    }
  });
  return Object.freeze({
    abiVersion: 1,
    provides: Object.freeze(["common.edit/writer"]),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`);
      return simpleLease(writer);
    }
  });
}
export {
  INSPECTION_OPERATIONS,
  PROJECTION_RECEIPT_METADATA_ID,
  TRANSPORT_OPERATIONS,
  analyzeGraphIsolation,
  applyJsonEdit,
  assetRevisionFromInput,
  attrAt,
  createAudioMediaSource,
  createEncodedMediaSource,
  createInspectionCodec,
  createModelAnimationSampler,
  createModelAnimationSource,
  createModelCameraSource,
  createModelCollisionSource,
  createModelEffectSource,
  createModelLightSource,
  createModelMaterialSource,
  createModelNodeBehaviourSource,
  createModelPhysicsSource,
  createModelPoseSampler,
  createModelResourceRefsSource,
  createModelSceneSource,
  createModelSkeletonNodes,
  createModelSkeletonSource,
  createModelSocketSource,
  createProjectionReceipt,
  createRasterImageSource,
  createReferenceIndex,
  createRelationGraphSource,
  createSubjectFactsSource,
  createTableDataSource,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  createVectorSceneSource,
  createVideoMediaSource,
  declaredPermissionClasses,
  decodeXmlEntities,
  defineWriter,
  editPlanFromBinding,
  editPlanFromInput,
  elementPathAt,
  encodeXmlAttribute,
  encodeXmlText,
  fact,
  getAttr,
  getLogger,
  installLoggerFactory,
  isJsonSerializable,
  modelPrimitiveByteLength,
  pageOf,
  parseSubjectId,
  projectionReceiptMetadataGroup,
  provenanceOf,
  replaceBytes,
  scanXml,
  simpleLease,
  snapshotJson,
  snapshotModelAnimations,
  snapshotModelSkeleton,
  subjectFieldGroup,
  subjectIdFor
};
