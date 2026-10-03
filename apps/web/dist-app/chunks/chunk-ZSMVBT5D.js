import {
  snapshotJson
} from "./chunk-3YDGNEY2.js";
import {
  CUBIC_SPLINE_LINE_TYPE,
  sampleTrackValue
} from "./chunk-WXUQLAQ3.js";
import {
  xxHash32
} from "./chunk-UCBII6KW.js";

// packages/codec-kit/dist/model/animation.js
var DEFAULT_MODEL_ANIMATION_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
function withoutHeldSamples(samples) {
  const still = (sample) => (sample.inTangent ?? []).every((value) => value === 0) && (sample.outTangent ?? []).every((value) => value === 0);
  const same = (a, b) => a.value.length === b.value.length && a.value.every((value, index) => Object.is(value, b.value[index])) && still(a) && still(b);
  const kept = samples.filter((sample, index) => {
    const previous = samples[index - 1];
    const next = samples[index + 1];
    return previous === void 0 || next === void 0 || !same(previous, sample) || !same(sample, next);
  });
  return kept.map((sample, index) => sample.frame === index ? sample : { ...sample, frame: index });
}
function animationSnapshotBudget(clips) {
  let samples = 0;
  let channels = 0;
  for (const clip of clips)
    for (const channel of clip.channels) {
      channels += 1;
      samples += channel.samples?.length ?? 0;
    }
  return Object.freeze({
    maxDepth: DEFAULT_MODEL_ANIMATION_BUDGET.maxDepth,
    maxNodes: Math.max(DEFAULT_MODEL_ANIMATION_BUDGET.maxNodes, 16 * samples + 64 * channels + 64 * clips.length),
    maxBytes: Math.max(DEFAULT_MODEL_ANIMATION_BUDGET.maxBytes, 256 * samples + 1024 * channels)
  });
}
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`);
}
function snapshotModelAnimations(value, budget = DEFAULT_MODEL_ANIMATION_BUDGET, signal) {
  const clips = snapshotJson(value, budget, signal);
  if (!Array.isArray(clips))
    throw new TypeError("model animations must be an array");
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
      if (clip.durationSeconds < 0)
        throw new TypeError("negative clip duration");
    }
    if (clip.looping !== void 0 && typeof clip.looping !== "boolean")
      throw new TypeError("invalid clip looping");
    if (clip.repeatCount !== void 0 && (!Number.isSafeInteger(clip.repeatCount) || clip.repeatCount < 0))
      throw new TypeError("invalid clip repeat count");
    if (clip.sequenceIndex !== void 0 && (!Number.isSafeInteger(clip.sequenceIndex) || clip.sequenceIndex < 0))
      throw new TypeError("invalid animation material sequence index");
    if (clip.movementSpeed !== void 0)
      finite(clip.movementSpeed, "clip movement speed");
    if (clip.boundsSphere !== void 0) {
      if (!Array.isArray(clip.boundsSphere.center) || clip.boundsSphere.center.length !== 3)
        throw new TypeError("invalid clip bounds");
      for (const component of clip.boundsSphere.center)
        finite(component, "clip bounds center");
      finite(clip.boundsSphere.radius, "clip bounds radius");
      if (clip.boundsSphere.radius < 0)
        throw new TypeError("negative clip bounds radius");
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
      if (channel.interpolation === void 0)
        continue;
      if (!["step", "linear", "spherical-linear", "cubic-spline"].includes(channel.interpolation) || !channel.samples?.length) {
        throw new TypeError("sampleable channel needs interpolation and keys");
      }
      let previous = -Infinity;
      let components;
      for (const sample of channel.samples) {
        finite(sample.timeSeconds, "key time");
        if (sample.timeSeconds < previous)
          throw new TypeError("animation keys are not ordered");
        previous = sample.timeSeconds;
        if (!Array.isArray(sample.value) || sample.value.length === 0)
          throw new TypeError("empty animation key");
        components ??= sample.value.length;
        if (components !== sample.value.length || channel.interpolation === "spherical-linear" && components !== 4) {
          throw new TypeError("inconsistent animation key components");
        }
        for (const component of sample.value)
          finite(component, "key component");
        if (channel.interpolation === "cubic-spline") {
          for (const tangent of [sample.inTangent, sample.outTangent]) {
            if (!Array.isArray(tangent) || tangent.length !== components)
              throw new TypeError("cubic-spline keys need in and out tangents of the key width");
            for (const component of tangent)
              finite(component, "key tangent");
          }
        }
      }
    }
  }
  return clips;
}
var MAX_LAYERED_PERIOD = 60;
function layeredClip(clips) {
  const first = clips[0];
  if (first === void 0)
    throw new TypeError("layeredClip needs a clip");
  if (clips.length === 1)
    return first;
  const ranked = clips.map((clip, order) => ({ clip, order })).sort((a, b) => (a.clip.priority ?? 0) - (b.clip.priority ?? 0) || a.order - b.order);
  const channels = /* @__PURE__ */ new Map();
  const periods = [];
  let longest = 0;
  for (const { clip } of ranked) {
    const speed = clip.speedScale ?? 1;
    if (!(speed > 0) || !Number.isFinite(speed))
      throw new TypeError("clip speed must be positive");
    const lastKey = clip.channels.reduce((end, channel) => (channel.samples ?? []).reduce((last, key) => Math.max(last, key.timeSeconds ?? 0), end), 0);
    const length = (clip.durationSeconds ?? lastKey) / speed;
    longest = Math.max(longest, length);
    const looping = (clip.loop ?? (clip.looping === true ? "loop" : "once")) === "loop";
    if (looping && length > 0)
      periods.push(Math.max(1, Math.round(length * 1e3)));
    for (const channel of clip.channels)
      channels.set(`${channel.target}/${channel.kind}/${channel.axis ?? ""}`, {
        ...channel,
        ...speed === 1 || channel.samples === void 0 ? {} : {
          samples: channel.samples.map((key) => ({
            ...key,
            timeSeconds: (key.timeSeconds ?? 0) / speed,
            ...key.inTangent === void 0 ? {} : { inTangent: key.inTangent.map((value) => value * speed) },
            ...key.outTangent === void 0 ? {} : { outTangent: key.outTangent.map((value) => value * speed) }
          }))
        },
        ...looping && length > 0 && channel.concurrent !== true ? { concurrent: true, wrapSeconds: length } : {}
      });
  }
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const common = periods.reduce((period2, next) => period2 / gcd(period2, next) * next, 1);
  const period = periods.length > 0 && common / 1e3 <= MAX_LAYERED_PERIOD ? common / 1e3 : longest;
  return {
    id: clips.map((clip) => clip.id).join("+"),
    name: clips.map((clip) => clip.name).join(" + "),
    kind: "animation",
    provenance: clips.every((clip) => clip.provenance === "companion") ? "companion" : "direct",
    frames: Math.max(...clips.map((clip) => clip.frames)),
    durationSeconds: period,
    ...periods.length > 0 ? { looping: true } : {},
    channels: [...channels.values()]
  };
}
function chooseByWeight(candidates, seed) {
  const total = candidates.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (!(total > 0))
    throw new TypeError("chooseByWeight needs a positive weight");
  let point = xxHash32(new TextEncoder().encode(seed)) / 2 ** 32 * total;
  for (const item of candidates) {
    point -= Math.max(0, item.weight);
    if (point < 0)
      return item.value;
  }
  return candidates.findLast((item) => item.weight > 0).value;
}
var MAX_EVENT_OCCURRENCES = 4096;
function clipEventsBetween(clip, fromSeconds, toSeconds) {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds))
    throw new TypeError("event window must be finite");
  if ((clip.events?.length ?? 0) === 0 || !(toSeconds > fromSeconds))
    return [];
  const mode = clip.loop ?? (clip.looping === true ? "loop" : "once");
  const duration = clip.durationSeconds ?? 0;
  const period = mode === "loop" ? duration : mode === "ping-pong" ? 2 * duration : 0;
  const found = [];
  for (const event of clip.events ?? []) {
    const back = 2 * duration - event.timeSeconds;
    const times = mode === "ping-pong" && back !== event.timeSeconds ? [event.timeSeconds, back] : [event.timeSeconds];
    for (const time of times) {
      if (!(period > 0)) {
        if (fromSeconds < time && time <= toSeconds)
          found.push({ event, atSeconds: time });
        continue;
      }
      for (let at = time + (Math.floor((fromSeconds - time) / period) + 1) * period; at <= toSeconds && found.length < MAX_EVENT_OCCURRENCES; at += period)
        if (at > fromSeconds)
          found.push({ event, atSeconds: at });
    }
  }
  return found.sort((left, right) => left.atSeconds - right.atSeconds);
}
function createModelAnimationSampler(clip, budget, signal) {
  const owned = snapshotModelAnimations([clip], budget, signal)[0];
  const tracks = owned.channels.map((channel) => {
    if (channel.interpolation === void 0 || channel.samples === void 0)
      throw new TypeError("channel has no sampling semantics");
    const track = {
      lineType: channel.interpolation === "step" ? 0 : channel.interpolation === "cubic-spline" ? CUBIC_SPLINE_LINE_TYPE : 1,
      globalSeqId: null,
      keys: channel.samples.map((key) => ({
        frame: key.timeSeconds,
        vector: key.value,
        ...key.inTangent === void 0 ? {} : { inTan: key.inTangent },
        ...key.outTangent === void 0 ? {} : { outTan: key.outTangent }
      }))
    };
    return { channel, track };
  });
  return Object.freeze({
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      finite(timeSeconds, "sample time");
      return Object.freeze(tracks.map(({ channel, track }) => {
        if (requestSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        return Object.freeze({
          target: channel.target,
          kind: channel.kind,
          ...channel.axis === void 0 ? {} : { axis: channel.axis },
          value: Object.freeze(sampleTrackValue(track, timeSeconds, [], {
            isQuat: channel.interpolation === "spherical-linear",
            wrapSeconds: channel.concurrent ? channel.wrapSeconds : void 0
          }))
        });
      }));
    }
  });
}

export {
  DEFAULT_MODEL_ANIMATION_BUDGET,
  withoutHeldSamples,
  animationSnapshotBudget,
  snapshotModelAnimations,
  layeredClip,
  chooseByWeight,
  clipEventsBetween,
  createModelAnimationSampler
};
