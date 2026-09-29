import {
  convertedFileName,
  exportOffer,
  invokeRefusalMessage,
  isRejected,
  mountFieldEditor
} from "./chunk-Z2D6YWX3.js";
import {
  MODEL_FALLBACK_MESSAGES,
  MODEL_GIZMO_FALLBACK_MESSAGES,
  PART_ATTRIBUTE,
  ViewerMountScope,
  createMediaShell,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  mountContributedSections,
  setPart,
  setState,
  setViewerText,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-FBGUD7CM.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/model/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/scene/dist/model/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/scene/dist/model/sampler.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/scene/dist/model/billboards.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/json-snapshot.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128)
      bytes++;
    else if (code < 2048)
      bytes += 2;
    else if (code >= 55296 && code <= 56319 && text.charCodeAt(index + 1) >= 56320 && text.charCodeAt(index + 1) <= 57343) {
      bytes += 4;
      index++;
    } else
      bytes += 3;
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
    if (bytes > budget.maxBytes)
      throw new RangeError("JSON snapshot exceeds maxBytes");
  };
  const copy = (entry, depth) => {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    if (depth > budget.maxDepth)
      throw new RangeError("JSON snapshot exceeds maxDepth");
    if (++nodes > budget.maxNodes)
      throw new RangeError("JSON snapshot exceeds maxNodes");
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
    if (typeof entry !== "object" || entry === null)
      throw new TypeError("non-JSON snapshot value");
    const prototype = Object.getPrototypeOf(entry);
    if (!Array.isArray(entry) && prototype !== null && prototype !== Object.prototype) {
      throw new TypeError("JSON snapshot requires plain objects");
    }
    if (ancestors.has(entry))
      throw new TypeError("cyclic JSON snapshot");
    ancestors.add(entry);
    try {
      charge(2);
      if (Array.isArray(entry)) {
        const result2 = [];
        for (let index = 0; index < entry.length; index++) {
          if (index > 0)
            charge(1);
          result2.push(copy(entry[index], depth + 1));
        }
        return Object.freeze(result2);
      }
      const result = [];
      const entries = Object.entries(entry);
      if (budget.sortKeys)
        entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      for (const [key, item] of entries) {
        if (item === void 0)
          continue;
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

// ../MODDING/modkit-core/packages/scene/dist/model/billboard-math.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/model-math/transform.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function normalizeQuat(value) {
  const x = value[0] ?? 0;
  const y = value[1] ?? 0;
  const z = value[2] ?? 0;
  const w = value[3] ?? 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}
function decomposeMatrix4(matrix2) {
  const m = (at) => matrix2[at] ?? (at % 5 === 0 ? 1 : 0);
  const determinant = m(0) * (m(5) * m(10) - m(9) * m(6)) - m(4) * (m(1) * m(10) - m(9) * m(2)) + m(8) * (m(1) * m(6) - m(5) * m(2));
  const sx = (determinant < 0 ? -1 : 1) * Math.hypot(m(0), m(1), m(2));
  const sy = Math.hypot(m(4), m(5), m(6));
  const sz = Math.hypot(m(8), m(9), m(10));
  const dx = sx || 1;
  const dy = sy || 1;
  const dz = sz || 1;
  return {
    translation: [m(12), m(13), m(14)],
    scaling: [sx, sy, sz],
    rotation: quaternionFromRotationMatrix([
      m(0) / dx,
      m(1) / dx,
      m(2) / dx,
      m(4) / dy,
      m(5) / dy,
      m(6) / dy,
      m(8) / dz,
      m(9) / dz,
      m(10) / dz
    ])
  };
}
function quaternionFromRotationMatrix(matrix2) {
  const m00 = matrix2[0] ?? 1;
  const m01 = matrix2[3] ?? 0;
  const m02 = matrix2[6] ?? 0;
  const m10 = matrix2[1] ?? 0;
  const m11 = matrix2[4] ?? 1;
  const m12 = matrix2[7] ?? 0;
  const m20 = matrix2[2] ?? 0;
  const m21 = matrix2[5] ?? 0;
  const m22 = matrix2[8] ?? 1;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s2 = Math.sqrt(trace + 1) * 2;
    return normalizeQuat([(m21 - m12) / s2, (m02 - m20) / s2, (m10 - m01) / s2, 0.25 * s2]);
  }
  if (m00 > m11 && m00 > m22) {
    const s2 = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuat([0.25 * s2, (m01 + m10) / s2, (m02 + m20) / s2, (m21 - m12) / s2]);
  }
  if (m11 > m22) {
    const s2 = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuat([(m01 + m10) / s2, 0.25 * s2, (m12 + m21) / s2, (m02 - m20) / s2]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuat([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}

// ../MODDING/modkit-core/packages/scene/dist/model/billboard-math.js
function invertQuat(rotation2) {
  const lengthSq = rotation2[0] * rotation2[0] + rotation2[1] * rotation2[1] + rotation2[2] * rotation2[2] + rotation2[3] * rotation2[3];
  if (lengthSq === 0)
    return [0, 0, 0, 1];
  return [
    -rotation2[0] / lengthSq,
    -rotation2[1] / lengthSq,
    -rotation2[2] / lengthSq,
    rotation2[3] / lengthSq
  ];
}
function multiplyQuat(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]);
}
function invertMatrix4OrNull(matrix2) {
  const out = new Float32Array(16);
  const b00 = (matrix2[0] ?? 0) * (matrix2[5] ?? 0) - (matrix2[1] ?? 0) * (matrix2[4] ?? 0);
  const b01 = (matrix2[0] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[4] ?? 0);
  const b02 = (matrix2[0] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[4] ?? 0);
  const b03 = (matrix2[1] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[5] ?? 0);
  const b04 = (matrix2[1] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[5] ?? 0);
  const b05 = (matrix2[2] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[6] ?? 0);
  const b06 = (matrix2[8] ?? 0) * (matrix2[13] ?? 0) - (matrix2[9] ?? 0) * (matrix2[12] ?? 0);
  const b07 = (matrix2[8] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[12] ?? 0);
  const b08 = (matrix2[8] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[12] ?? 0);
  const b09 = (matrix2[9] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[13] ?? 0);
  const b10 = (matrix2[9] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[13] ?? 0);
  const b11 = (matrix2[10] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[14] ?? 0);
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12)
    return null;
  determinant = 1 / determinant;
  out[0] = ((matrix2[5] ?? 0) * b11 - (matrix2[6] ?? 0) * b10 + (matrix2[7] ?? 0) * b09) * determinant;
  out[1] = ((matrix2[2] ?? 0) * b10 - (matrix2[1] ?? 0) * b11 - (matrix2[3] ?? 0) * b09) * determinant;
  out[2] = ((matrix2[13] ?? 0) * b05 - (matrix2[14] ?? 0) * b04 + (matrix2[15] ?? 0) * b03) * determinant;
  out[3] = ((matrix2[10] ?? 0) * b04 - (matrix2[9] ?? 0) * b05 - (matrix2[11] ?? 0) * b03) * determinant;
  out[4] = ((matrix2[6] ?? 0) * b08 - (matrix2[4] ?? 0) * b11 - (matrix2[7] ?? 0) * b07) * determinant;
  out[5] = ((matrix2[0] ?? 0) * b11 - (matrix2[2] ?? 0) * b08 + (matrix2[3] ?? 0) * b07) * determinant;
  out[6] = ((matrix2[14] ?? 0) * b02 - (matrix2[12] ?? 0) * b05 - (matrix2[15] ?? 0) * b01) * determinant;
  out[7] = ((matrix2[8] ?? 0) * b05 - (matrix2[10] ?? 0) * b02 + (matrix2[11] ?? 0) * b01) * determinant;
  out[8] = ((matrix2[4] ?? 0) * b10 - (matrix2[5] ?? 0) * b08 + (matrix2[7] ?? 0) * b06) * determinant;
  out[9] = ((matrix2[1] ?? 0) * b08 - (matrix2[0] ?? 0) * b10 - (matrix2[3] ?? 0) * b06) * determinant;
  out[10] = ((matrix2[12] ?? 0) * b04 - (matrix2[13] ?? 0) * b02 + (matrix2[15] ?? 0) * b00) * determinant;
  out[11] = ((matrix2[9] ?? 0) * b02 - (matrix2[8] ?? 0) * b04 - (matrix2[11] ?? 0) * b00) * determinant;
  out[12] = ((matrix2[5] ?? 0) * b07 - (matrix2[4] ?? 0) * b09 - (matrix2[6] ?? 0) * b06) * determinant;
  out[13] = ((matrix2[0] ?? 0) * b09 - (matrix2[1] ?? 0) * b07 + (matrix2[2] ?? 0) * b06) * determinant;
  out[14] = ((matrix2[13] ?? 0) * b01 - (matrix2[12] ?? 0) * b03 - (matrix2[14] ?? 0) * b00) * determinant;
  out[15] = ((matrix2[8] ?? 0) * b03 - (matrix2[9] ?? 0) * b01 + (matrix2[10] ?? 0) * b00) * determinant;
  return out;
}
function rotationTranslationScaleOriginMatrix(rotation2, translation2, scaling, origin) {
  const x = rotation2[0];
  const y = rotation2[1];
  const z = rotation2[2];
  const w = rotation2[3];
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
  const sx = scaling[0];
  const sy = scaling[1];
  const sz = scaling[2];
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const out = new Float32Array(16);
  out[0] = (1 - yy - zz) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - xx - zz) * sy;
  out[6] = (yz + wx) * sy;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - xx - yy) * sz;
  out[12] = translation2[0] + ox - (out[0] * ox + out[4] * oy + out[8] * oz);
  out[13] = translation2[1] + oy - (out[1] * ox + out[5] * oy + out[9] * oz);
  out[14] = translation2[2] + oz - (out[2] * ox + out[6] * oy + out[10] * oz);
  out[15] = 1;
  return out;
}
function multiplyMatrix4(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] = (a[0 * 4 + row] ?? 0) * (b[col * 4 + 0] ?? 0) + (a[1 * 4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) + (a[2 * 4 + row] ?? 0) * (b[col * 4 + 2] ?? 0) + (a[3 * 4 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

// ../MODDING/modkit-core/packages/scene/dist/model/billboards.js
function needed(value, label) {
  if (value === void 0)
    throw new TypeError("billboard " + label + " absent");
  return value;
}
function rotation(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item) && Number.isFinite(Math.fround(item))) || Math.hypot(...value) === 0)
    throw new TypeError("billboard quaternion must be finite and nonzero");
  return normalizeQuat(value);
}
function matrix(value) {
  if (value.length !== 16 || !value.every(Number.isFinite) || [3, 7, 11].some((index) => value[index] !== 0) || value[15] !== 1)
    throw new TypeError("billboard matrix must be finite affine");
  const result = Float32Array.from(value);
  if (!result.every(Number.isFinite))
    throw new RangeError("billboard matrix exceeds float32");
  return result;
}
function position(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item)))
    throw new TypeError("billboard position must contain three finite numbers");
  return [value[0], value[1], value[2]];
}
function snapshotModelBillboards(values, maxBytes, signal) {
  const owned = snapshotJson(values, { maxBytes, maxDepth: 8, maxNodes: Math.floor(maxBytes / 16) }, signal);
  if (!Array.isArray(owned))
    throw new TypeError("billboard constraints must be an array");
  const seen = /* @__PURE__ */ new Set();
  for (const item of owned) {
    if (!item || typeof item.nodeId !== "string" || !item.nodeId || seen.has(item.nodeId))
      throw new TypeError("invalid or duplicate billboard constraint");
    if (item.mode === "inverse-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "basisRotations"].includes(key)) || !Array.isArray(item.basisRotations) || item.basisRotations.length > 4)
        throw new TypeError("invalid inverse-camera billboard constraint");
      for (const basis of item.basisRotations)
        rotation(basis);
    } else if (item.mode === "face-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "rotationAxes", "pivot"].includes(key)) || !["z", "xz"].includes(item.rotationAxes))
        throw new TypeError("invalid face-camera billboard constraint");
      position(item.pivot);
    } else
      throw new TypeError("invalid billboard mode");
    seen.add(item.nodeId);
  }
  return owned;
}
function translation(value) {
  return Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, value[0], value[1], value[2], 1);
}
function rotationX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
}
function rotationZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}
function applyModelFaceCameraBillboard(sourceWorld, constraint, cameraPosition) {
  const world = matrix(sourceWorld);
  const inverse = invertMatrix4OrNull(world);
  if (inverse === null)
    throw new TypeError("face-camera billboard world is singular");
  const camera = position(cameraPosition);
  const pivot = position(constraint.pivot);
  const x = (inverse[0] ?? 0) * camera[0] + (inverse[4] ?? 0) * camera[1] + (inverse[8] ?? 0) * camera[2] + (inverse[12] ?? 0) - pivot[0];
  let y = (inverse[1] ?? 0) * camera[0] + (inverse[5] ?? 0) * camera[1] + (inverse[9] ?? 0) * camera[2] + (inverse[13] ?? 0) - pivot[1];
  const z = (inverse[2] ?? 0) * camera[0] + (inverse[6] ?? 0) * camera[1] + (inverse[10] ?? 0) * camera[2] + (inverse[14] ?? 0) - pivot[2];
  let result = multiplyMatrix4(world, translation(pivot));
  if (constraint.rotationAxes === "xz") {
    const pitch = Math.atan2(z, y);
    result = multiplyMatrix4(result, rotationX(pitch));
    y = Math.hypot(y, z);
  }
  result = multiplyMatrix4(result, rotationZ(-Math.atan2(x, y)));
  result = multiplyMatrix4(result, translation([-pivot[0], -pivot[1], -pivot[2]]));
  if (!result.every(Number.isFinite))
    throw new RangeError("face-camera billboard exceeds float32");
  return result;
}
function applyModelBillboards(pose, bindings, constraints, cameraRotation, hierarchyFrame, maxBytes, signal) {
  signal?.throwIfAborted();
  const inverseConstraints = constraints.filter((item) => item.mode === "inverse-camera");
  if (cameraRotation === void 0 || inverseConstraints.length === 0)
    return pose;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || pose.length * 2048 + inverseConstraints.length * 256 > maxBytes)
    throw new RangeError("billboard pose exceeds byte budget");
  const byNode = new Map(inverseConstraints.map((item) => [item.nodeId, item])), source = /* @__PURE__ */ new Map(), bones = new Map(bindings.map((item) => [item.boneIndex, item]));
  for (const item of pose) {
    if (source.has(item.boneIndex))
      throw new TypeError("duplicate billboard pose bone");
    source.set(item.boneIndex, item);
  }
  if (!pose.some((item) => byNode.has(item.nodeId)))
    return pose;
  const cameraInFrame = multiplyQuat(invertQuat(decomposeMatrix4(matrix(hierarchyFrame)).rotation), rotation(cameraRotation)), cameraInverse = invertQuat(cameraInFrame);
  const adjusted = /* @__PURE__ */ new Map(), output = /* @__PURE__ */ new Map();
  for (const entry of pose) {
    const chain = [], visiting = /* @__PURE__ */ new Set();
    let cursor = entry.boneIndex;
    while (cursor !== null && !adjusted.has(cursor)) {
      if (visiting.has(cursor))
        throw new TypeError("cyclic billboard hierarchy");
      visiting.add(cursor);
      chain.push(cursor);
      const parent = needed(bones.get(cursor), "bone binding").parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      cursor = parent;
    }
    for (const index of chain.reverse()) {
      signal?.throwIfAborted();
      const bone = needed(bones.get(index), "binding"), original = needed(source.get(index), "source pose"), parent = bone.parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      const originalWorld = matrix(original.worldMatrix), originalParent = parent === null ? null : matrix(needed(source.get(parent), "parent pose").worldMatrix), inverseOriginalParent = originalParent === null ? null : invertMatrix4OrNull(originalParent);
      const local = originalParent !== null && inverseOriginalParent !== null ? multiplyMatrix4(inverseOriginalParent, originalWorld) : originalWorld;
      const adjustedParent = parent === null ? void 0 : needed(adjusted.get(parent), "adjusted parent");
      let world = adjustedParent === void 0 ? local : multiplyMatrix4(adjustedParent, local);
      const constraint = byNode.get(original.nodeId);
      if (constraint !== void 0) {
        const localTransform = decomposeMatrix4(local), parentInverse = adjustedParent === void 0 ? [0, 0, 0, 1] : invertQuat(decomposeMatrix4(adjustedParent).rotation);
        let facing = multiplyQuat(parentInverse, cameraInverse);
        for (const basis of constraint.basisRotations)
          facing = multiplyQuat(facing, rotation(basis));
        facing = multiplyQuat(facing, localTransform.rotation);
        const billboardLocal = rotationTranslationScaleOriginMatrix(normalizeQuat(facing), localTransform.translation, localTransform.scaling, [0, 0, 0]);
        world = adjustedParent === void 0 ? billboardLocal : multiplyMatrix4(adjustedParent, billboardLocal);
      }
      if (!world.every(Number.isFinite))
        throw new RangeError("billboard world exceeds float32");
      adjusted.set(index, world);
      const skin = bone.inverseBindMatrix === void 0 ? void 0 : multiplyMatrix4(world, matrix(bone.inverseBindMatrix));
      if (skin !== void 0 && !skin.every(Number.isFinite))
        throw new RangeError("billboard skin exceeds float32");
      output.set(index, {
        boneIndex: index,
        nodeId: original.nodeId,
        worldMatrix: Array.from(world),
        ...skin === void 0 ? {} : { skinningMatrix: Array.from(skin) }
      });
    }
  }
  signal?.throwIfAborted();
  return pose.map((item) => needed(output.get(item.boneIndex), "result"));
}

// ../MODDING/modkit-core/packages/codec-kit/dist/model-math/sequence-pose.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var CUBIC_SPLINE_LINE_TYPE = 4;
var IDENTITY_QUAT = [0, 0, 0, 1];
var ZERO_VEC3 = [0, 0, 0];
var ONE_VEC3 = [1, 1, 1];
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
    if (Math.abs(time - options.wrapSeconds) <= wrapRoundoff)
      time = 0;
  }
  const first = keys[0];
  if (time <= first.frame || count === 1)
    return copyVector(first.vector, out);
  const last = keys[count - 1];
  if (time >= last.frame)
    return copyVector(last.vector, out);
  let b = 1;
  while (b < count - 1 && time + wrapRoundoff >= keys[b].frame)
    b += 1;
  const ka = keys[b - 1];
  const kb = keys[b];
  if (track.lineType === 0)
    return copyVector(ka.vector, out);
  const span = kb.frame - ka.frame;
  const t = span > 0 ? Math.min(Math.max((time - ka.frame) / span, 0), 1) : 0;
  if (track.lineType === CUBIC_SPLINE_LINE_TYPE) {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.length = ka.vector.length;
    for (let i = 0; i < ka.vector.length; i += 1)
      out[i] = h00 * ka.vector[i] + h10 * span * (ka.outTan?.[i] ?? 0) + h01 * (kb.vector[i] ?? ka.vector[i]) + h11 * span * (kb.inTan?.[i] ?? 0);
    if (options.isQuat && out.length === 4) {
      const len = Math.hypot(out[0], out[1], out[2], out[3]);
      if (len > 0)
        for (let i = 0; i < 4; i += 1)
          out[i] /= len;
    }
    return out;
  }
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
  for (let i = 0; i < source.length; i += 1)
    out[i] = source[i];
  return out;
}
function slerpVector(a, b, t, out) {
  let dot2 = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let sign = 1;
  if (dot2 < 0) {
    dot2 = -dot2;
    sign = -1;
  }
  out.length = 4;
  if (dot2 > 0.9995) {
    for (let i = 0; i < 4; i += 1)
      out[i] = a[i] + (sign * b[i] - a[i]) * t;
  } else {
    const theta = Math.acos(Math.min(1, dot2));
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinTheta;
    const wb = Math.sin(t * theta) / sinTheta * sign;
    for (let i = 0; i < 4; i += 1)
      out[i] = wa * a[i] + wb * b[i];
  }
  const len = Math.hypot(out[0], out[1], out[2], out[3]);
  if (len > 0) {
    for (let i = 0; i < 4; i += 1)
      out[i] /= len;
  }
  return out;
}
function composeTrsMatrix(out, offset, translation2, rotation2, scale) {
  const x = rotation2[0] ?? 0;
  const y = rotation2[1] ?? 0;
  const z = rotation2[2] ?? 0;
  const w = rotation2[3] ?? 1;
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
  out[offset + 12] = translation2[0] ?? 0;
  out[offset + 13] = translation2[1] ?? 0;
  out[offset + 14] = translation2[2] ?? 0;
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
var SequencePoseSampler = class {
  bones;
  boneCount;
  world;
  skinning;
  local;
  translation = [];
  rotation = [];
  scale = [];
  trackSetsBySequence = /* @__PURE__ */ new WeakMap();
  constructor(bones) {
    this.bones = bones;
    this.boneCount = bones.length;
    this.world = new Float32Array(this.boneCount * 16);
    this.skinning = new Float32Array(this.boneCount * 16);
    this.local = new Float32Array(16);
  }
  trackSets(sequence) {
    let sets = this.trackSetsBySequence.get(sequence);
    if (!sets) {
      sets = new Array(this.boneCount);
      for (const trackSet of sequence.nodeTracks) {
        if (trackSet.boneIndex >= 0 && trackSet.boneIndex < this.boneCount) {
          sets[trackSet.boneIndex] = trackSet;
        }
      }
      this.trackSetsBySequence.set(sequence, sets);
    }
    return sets;
  }
  /**
   * Bones must be stored parent-before-child (M3/MDX convention; the codecs
   * guarantee it). Loops sample tracks → local TRS → world = parentWorld ×
   * local → skinning = world × IREF.
   */
  samplePose(sequence, timeSeconds) {
    const sets = this.trackSets(sequence);
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex];
      const trackSet = sets[boneIndex];
      const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
      const translation2 = trackSet?.translation ? sampleTrackValue(trackSet.translation, timeSeconds, this.translation, { wrapSeconds }) : ZERO_VEC3;
      const rotation2 = trackSet?.rotation ? sampleTrackValue(trackSet.rotation, timeSeconds, this.rotation, {
        wrapSeconds,
        isQuat: true
      }) : IDENTITY_QUAT;
      const scale = trackSet?.scale ? sampleTrackValue(trackSet.scale, timeSeconds, this.scale, { wrapSeconds }) : ONE_VEC3;
      composeTrsMatrix(this.local, 0, translation2, rotation2, scale);
      const parentIndex = bone.parentIndex;
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0);
      } else {
        this.world.set(this.local, boneIndex * 16);
      }
      const inverseBind = bone.inverseBindMatrix;
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0);
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16);
      }
    }
    return { world: this.world, skinning: this.skinning };
  }
  /** Blend controller clip samples before composing the hierarchy. */
  sampleBlendedPose(samples) {
    const active = samples.filter((sample) => sample.weight > 0 && Number.isFinite(sample.weight));
    if (active.length === 0) {
      this.world.fill(0);
      this.skinning.fill(0);
      return { world: this.world, skinning: this.skinning };
    }
    const value = [];
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex];
      const translation2 = [0, 0, 0];
      const rotation2 = [0, 0, 0, 0];
      const scale = [0, 0, 0];
      let overrideWeight = 0;
      let referenceRotation;
      for (const sample of active) {
        if (sample.additive)
          continue;
        const trackSet = this.trackSets(sample.sequence)[boneIndex];
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
        const sampledTranslation = trackSet?.translation ? sampleTrackValue(trackSet.translation, sample.timeSeconds, value, { wrapSeconds }) : ZERO_VEC3;
        for (let component = 0; component < 3; component += 1)
          translation2[component] += (sampledTranslation[component] ?? 0) * sample.weight;
        const sampledRotation = trackSet?.rotation ? sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
          wrapSeconds,
          isQuat: true
        }) : IDENTITY_QUAT;
        referenceRotation ??= [...sampledRotation];
        const sign = quaternionDot(referenceRotation, sampledRotation) < 0 ? -1 : 1;
        for (let component = 0; component < 4; component += 1)
          rotation2[component] += (sampledRotation[component] ?? IDENTITY_QUAT[component]) * sample.weight * sign;
        const sampledScale = trackSet?.scale ? sampleTrackValue(trackSet.scale, sample.timeSeconds, value, { wrapSeconds }) : ONE_VEC3;
        for (let component = 0; component < 3; component += 1)
          scale[component] += (sampledScale[component] ?? 1) * sample.weight;
        overrideWeight += sample.weight;
      }
      if (overrideWeight > 0) {
        for (let component = 0; component < 3; component += 1) {
          translation2[component] /= overrideWeight;
          scale[component] /= overrideWeight;
        }
        normalizeQuaternionInPlace(rotation2);
      } else {
        translation2.splice(0, 3, 0, 0, 0);
        rotation2.splice(0, 4, 0, 0, 0, 1);
        scale.splice(0, 3, 1, 1, 1);
      }
      for (const sample of active) {
        if (!sample.additive)
          continue;
        const trackSet = this.trackSets(sample.sequence)[boneIndex];
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
        if (trackSet?.translation) {
          const sampled = sampleTrackValue(trackSet.translation, sample.timeSeconds, value, {
            wrapSeconds
          });
          for (let component = 0; component < 3; component += 1)
            translation2[component] += (sampled[component] ?? 0) * sample.weight;
        }
        if (trackSet?.scale) {
          const sampled = sampleTrackValue(trackSet.scale, sample.timeSeconds, value, {
            wrapSeconds
          });
          for (let component = 0; component < 3; component += 1)
            scale[component] *= 1 + ((sampled[component] ?? 1) - 1) * sample.weight;
        }
        if (trackSet?.rotation) {
          const sampled = sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
            wrapSeconds,
            isQuat: true
          });
          const delta = [];
          slerpVector(IDENTITY_QUAT, sampled, Math.min(1, sample.weight), delta);
          multiplyQuaternionInPlace(rotation2, delta);
        }
      }
      composeTrsMatrix(this.local, 0, translation2, rotation2, scale);
      const parentIndex = bone.parentIndex;
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0);
      } else {
        this.world.set(this.local, boneIndex * 16);
      }
      const inverseBind = bone.inverseBindMatrix;
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0);
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16);
      }
    }
    return { world: this.world, skinning: this.skinning };
  }
};
function quaternionDot(left, right) {
  return (left[0] ?? 0) * (right[0] ?? 0) + (left[1] ?? 0) * (right[1] ?? 0) + (left[2] ?? 0) * (right[2] ?? 0) + (left[3] ?? 1) * (right[3] ?? 1);
}
function normalizeQuaternionInPlace(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]) || 1;
  for (let component = 0; component < 4; component += 1)
    value[component] /= length;
}
function multiplyQuaternionInPlace(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx = 0, by = 0, bz = 0, bw = 1] = right;
  left[0] = aw * bx + ax * bw + ay * bz - az * by;
  left[1] = aw * by - ax * bz + ay * bw + az * bx;
  left[2] = aw * bz + ax * by - ay * bx + az * bw;
  left[3] = aw * bw - ax * bx - ay * by - az * bz;
  normalizeQuaternionInPlace(left);
}

// ../MODDING/modkit-core/packages/codec-kit/dist/model/skeleton.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/model/animation.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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

// ../MODDING/modkit-core/packages/codec-kit/dist/model/skeleton.js
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

// ../MODDING/modkit-core/packages/codec-kit/dist/model/skinning.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/model/legacy/skinning-kernels.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function skinInterleaved(source, mesh, matrices, target) {
  if (!mesh.skin)
    return new Float32Array(source);
  const out = target?.length === source.length ? target : new Float32Array(source.length);
  out.set(source);
  const stride = mesh.attributes.strideBytes / Float32Array.BYTES_PER_ELEMENT;
  const positionOffset = mesh.attributes.positionOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  const normalOffset = mesh.attributes.normalOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  const tangentOffset = mesh.attributes.tangentOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const vertexBase = vertex * stride;
    const skinBase = vertex * mesh.skin.maxInfluences;
    const px = source[vertexBase + positionOffset] ?? 0;
    const py = source[vertexBase + positionOffset + 1] ?? 0;
    const pz = source[vertexBase + positionOffset + 2] ?? 0;
    const nx = source[vertexBase + normalOffset] ?? 0;
    const ny = source[vertexBase + normalOffset + 1] ?? 0;
    const nz = source[vertexBase + normalOffset + 2] ?? 1;
    const tx = source[vertexBase + tangentOffset] ?? 1;
    const ty = source[vertexBase + tangentOffset + 1] ?? 0;
    const tz = source[vertexBase + tangentOffset + 2] ?? 0;
    let weightSum = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;
    let tangentX = 0;
    let tangentY = 0;
    let tangentZ = 0;
    for (let slot = 0; slot < mesh.skin.maxInfluences; slot += 1) {
      const weight = mesh.skin.boneWeights[skinBase + slot] ?? 0;
      if (weight <= 0)
        continue;
      const matrix2 = matrices[mesh.skin.boneIndices[skinBase + slot] ?? 0];
      if (!matrix2)
        continue;
      const transformed = transformPoint(matrix2, px, py, pz);
      const transformedNormal = transformVector(matrix2, nx, ny, nz);
      const transformedTangent = transformVector(matrix2, tx, ty, tz);
      x += transformed[0] * weight;
      y += transformed[1] * weight;
      z += transformed[2] * weight;
      normalX += transformedNormal[0] * weight;
      normalY += transformedNormal[1] * weight;
      normalZ += transformedNormal[2] * weight;
      tangentX += transformedTangent[0] * weight;
      tangentY += transformedTangent[1] * weight;
      tangentZ += transformedTangent[2] * weight;
      weightSum += weight;
    }
    if (weightSum > 0) {
      out[vertexBase + positionOffset] = x / weightSum;
      out[vertexBase + positionOffset + 1] = y / weightSum;
      out[vertexBase + positionOffset + 2] = z / weightSum;
      const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
      out[vertexBase + normalOffset] = normalX / normalLength;
      out[vertexBase + normalOffset + 1] = normalY / normalLength;
      out[vertexBase + normalOffset + 2] = normalZ / normalLength;
      const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
      out[vertexBase + tangentOffset] = tangentX / tangentLength;
      out[vertexBase + tangentOffset + 1] = tangentY / tangentLength;
      out[vertexBase + tangentOffset + 2] = tangentZ / tangentLength;
    }
  }
  return out;
}
function transformPoint(matrix2, x, y, z) {
  return [
    (matrix2[0] ?? 0) * x + (matrix2[4] ?? 0) * y + (matrix2[8] ?? 0) * z + (matrix2[12] ?? 0),
    (matrix2[1] ?? 0) * x + (matrix2[5] ?? 0) * y + (matrix2[9] ?? 0) * z + (matrix2[13] ?? 0),
    (matrix2[2] ?? 0) * x + (matrix2[6] ?? 0) * y + (matrix2[10] ?? 0) * z + (matrix2[14] ?? 0)
  ];
}
function transformVector(matrix2, x, y, z) {
  return [
    (matrix2[0] ?? 0) * x + (matrix2[4] ?? 0) * y + (matrix2[8] ?? 0) * z,
    (matrix2[1] ?? 0) * x + (matrix2[5] ?? 0) * y + (matrix2[9] ?? 0) * z,
    (matrix2[2] ?? 0) * x + (matrix2[6] ?? 0) * y + (matrix2[10] ?? 0) * z
  ];
}

// ../MODDING/modkit-core/packages/codec-kit/dist/model/skinning.js
var kernelOutput = new Float32Array(0);
function createModelSkinDeformer(primitive, boneIndices, maxBytes = 134217728, signal) {
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  const count = primitive.positions.length / 3;
  if (!Number.isSafeInteger(count) || !primitive.positions.every(Number.isFinite))
    throw new TypeError("invalid skin positions");
  const workingBytes = count * 144 + boneIndices.length * 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || workingBytes > maxBytes)
    throw new RangeError("skin deformation exceeds maxBytes");
  const slots = /* @__PURE__ */ new Map();
  for (const [slot, index] of boneIndices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || slots.has(index))
      throw new TypeError("ambiguous skin bone index");
    slots.set(index, slot);
  }
  const { boneWeights, boneIndices: authored } = primitive;
  if (!primitive.hierarchyId || authored?.length !== count * 4 || boneWeights?.length !== count * 4)
    throw new TypeError("skin requires an explicit hierarchy and four indices and weights per vertex");
  for (const [data, width, label] of [
    [primitive.normals, 3, "normals"],
    [primitive.tangents, 4, "tangents"]
  ]) {
    if (data !== void 0 && (data.length !== count * width || !data.every(Number.isFinite)))
      throw new TypeError(`invalid skin ${label}`);
  }
  const indices = new Uint32Array(authored.length);
  const weights = new Float32Array(boneWeights);
  let zeroWeightVertices = 0;
  let normalizedWeightVertices = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    let sum = 0;
    for (let influence = 0; influence < 4; influence++) {
      const index = vertex * 4 + influence;
      const weight = weights[index];
      if (!Number.isFinite(weight) || weight < 0 || weight > 1)
        throw new TypeError("invalid skin weight");
      const slot = slots.get(authored[index]);
      if (slot === void 0)
        throw new TypeError("skin references an absent bone");
      indices[index] = slot;
      sum += weight;
    }
    if (sum === 0)
      zeroWeightVertices++;
    else if (Math.abs(sum - 1) > 1e-4)
      normalizedWeightVertices++;
  }
  const source = new Float32Array(count * 9);
  for (let vertex = 0; vertex < count; vertex++) {
    if ((vertex & 1023) === 0 && signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    source.set(primitive.positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 9);
    if (primitive.normals)
      source.set(primitive.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 9 + 3);
    if (primitive.tangents)
      source.set(primitive.tangents.subarray(vertex * 4, vertex * 4 + 3), vertex * 9 + 6);
  }
  const mesh = {
    vertexCount: count,
    attributes: {
      strideBytes: 36,
      positionOffsetBytes: 0,
      normalOffsetBytes: 12,
      tangentOffsetBytes: 24
    },
    skin: { maxInfluences: 4, boneIndices: indices, boneWeights: weights }
  };
  return Object.freeze({
    workingBytes,
    zeroWeightVertices,
    normalizedWeightVertices,
    deform(bones, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const matrices = new Array(slots.size);
      for (const bone of bones) {
        const slot = slots.get(bone.boneIndex);
        if (slot === void 0)
          continue;
        const matrix2 = bone.skinningMatrix;
        if (matrices[slot] !== void 0 || matrix2?.length !== 16 || !matrix2.every(Number.isFinite))
          throw new TypeError("skin needs a unique explicit inverse-bind pose for each bone");
        matrices[slot] = new Float32Array(matrix2);
      }
      for (let slot = 0; slot < matrices.length; slot++)
        if (matrices[slot] === void 0)
          throw new TypeError("skin pose is incomplete");
      if (kernelOutput.length < source.length)
        kernelOutput = new Float32Array(source.length);
      const deformed = skinInterleaved(source, mesh, matrices, kernelOutput.subarray(0, source.length));
      for (let index = 0; index < deformed.length; index++)
        if (!Number.isFinite(deformed[index]))
          throw new RangeError("deformed skin exceeds finite float range");
      const positions = new Float32Array(count * 3);
      const normals = primitive.normals ? new Float32Array(count * 3) : void 0;
      const tangents = primitive.tangents ? new Float32Array(primitive.tangents) : void 0;
      for (let vertex = 0; vertex < count; vertex++) {
        if ((vertex & 1023) === 0 && requestSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        const from = vertex * 9, to = vertex * 3;
        positions[to] = deformed[from];
        positions[to + 1] = deformed[from + 1];
        positions[to + 2] = deformed[from + 2];
        if (normals !== void 0) {
          normals[to] = deformed[from + 3];
          normals[to + 1] = deformed[from + 4];
          normals[to + 2] = deformed[from + 5];
        }
        if (tangents !== void 0) {
          const tangent = vertex * 4;
          tangents[tangent] = deformed[from + 6];
          tangents[tangent + 1] = deformed[from + 7];
          tangents[tangent + 2] = deformed[from + 8];
        }
      }
      const { bounds: _bounds, boneIndices: _indices, boneWeights: _weights, hierarchyId: _hierarchy, normals: _normals, tangents: _tangents, ...rest } = primitive;
      return {
        ...rest,
        positions,
        ...normals ? { normals } : {},
        ...tangents ? { tangents } : {}
      };
    }
  });
}

// ../MODDING/modkit-core/packages/codec-kit/dist/model/geometry.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function modelPrimitiveByteLength(primitive) {
  return primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.normals?.byteLength ?? 0) + (primitive.tangents?.byteLength ?? 0) + (primitive.colors?.byteLength ?? 0) + (primitive.boneIndices?.byteLength ?? 0) + (primitive.boneWeights?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0) + (primitive.textureCoordinateSets?.reduce((total, channel) => total + channel.coordinates.byteLength, 0) ?? 0);
}

// ../MODDING/modkit-core/packages/scene/dist/model/node-pose.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function createNodePoseSampler(nodes, options) {
  const hierarchyId = "scene-local-pose";
  const targets = new Set(nodes.map((node) => node.nodeId));
  if (targets.size !== nodes.length)
    throw new TypeError("duplicate scene node pose");
  const bindings = nodes.map((node, boneIndex) => ({
    ...node,
    boneIndex,
    partId: hierarchyId,
    hierarchyId,
    boneName: null,
    parentBoneIndex: null,
    provenance: "direct"
  }));
  const select = (clip) => ({
    ...clip,
    hierarchyId,
    channels: clip.channels.filter((channel) => targets.has(channel.target) && ["translation", "rotation", "scale"].includes(channel.kind))
  });
  const shared = {
    bindings,
    hierarchyId,
    budget: options.budget,
    ...options.signal === void 0 ? {} : { signal: options.signal }
  };
  const sampler = options.poseSamples === void 0 ? createModelPoseSampler({
    ...shared,
    ...options.clip === void 0 ? {} : { clip: select(options.clip) }
  }) : createModelPoseBlendSampler({
    ...shared,
    samples: options.poseSamples.map((sample) => ({ ...sample, clip: select(sample.clip) }))
  });
  return {
    sample(time, signal) {
      return new Map(sampler.sample(options.poseSamples === void 0 ? time : time - options.poseTime, signal).bones.map((node) => [node.nodeId, node.worldMatrix]));
    }
  };
}

// ../MODDING/modkit-core/packages/scene/dist/model/sampler.js
var IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function present(value, label) {
  if (value === void 0)
    throw new TypeError(`missing scene ${label}`);
  return value;
}
function createModelSceneSampler(projection, options = {}) {
  const { signal, clip } = options;
  const poseTime = options.poseTime ?? 0;
  if (!Number.isFinite(poseTime))
    throw new TypeError("pose reference time must be finite");
  const maxBytes = options.maxBytes ?? 134217728;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("invalid scene maxBytes");
  const budget = { maxDepth: 64, maxNodes: 1e6, maxBytes };
  const owned = snapshotJson({ nodes: projection.nodes, meshes: projection.meshes }, budget, signal);
  const bindings = snapshotModelSkeleton(projection.skeleton ?? [], budget, signal);
  const billboards = snapshotModelBillboards(options.billboards ?? [], maxBytes, signal);
  const billboardBytes = billboards.length === 0 ? 0 : bindings.length * 2048 + billboards.length * 512;
  if (billboardBytes > maxBytes)
    throw new RangeError("scene billboards exceed byte budget");
  const billboardCamera = options.billboardCameraRotation === void 0 ? void 0 : [...options.billboardCameraRotation];
  const billboardPosition = options.billboardCameraPosition === void 0 ? void 0 : [...options.billboardCameraPosition];
  if (billboardPosition !== void 0 && (billboardPosition.length !== 3 || !billboardPosition.every(Number.isFinite)))
    throw new TypeError("billboard camera position must contain three finite numbers");
  for (const constraint of billboards)
    if (constraint.mode === "inverse-camera" && !bindings.some((bone) => bone.nodeId === constraint.nodeId))
      throw new TypeError("billboard node has no explicit pose binding");
    else if (constraint.mode === "face-camera" && bindings.some((bone) => bone.nodeId === constraint.nodeId))
      throw new TypeError("face-camera billboard currently requires a rigid scene node");
  const diagnostics = [];
  const report = (code, message, primitiveId) => {
    diagnostics.push({
      severity: "warning",
      code: `common.model/${code}`,
      message,
      ...primitiveId === void 0 ? {} : { primitiveId }
    });
  };
  if (billboards.some((item) => item.mode === "inverse-camera") && billboardCamera === void 0)
    report("billboard-camera-required", "Node billboard constraints require an explicit camera orientation; authored poses are retained.");
  if (billboards.some((item) => item.mode === "face-camera") && billboardPosition === void 0)
    report("billboard-camera-position-required", "Position-facing billboard constraints require an explicit camera position; authored poses are retained.");
  const nodes = /* @__PURE__ */ new Map();
  const parents = /* @__PURE__ */ new Map();
  for (const node of owned.nodes) {
    if (!node.id || nodes.has(node.id) || node.transform.length !== 16 || !node.transform.every(Number.isFinite) || [3, 7, 11].some((i) => node.transform[i] !== 0) || node.transform[15] !== 1)
      throw new TypeError("scene needs unique nodes with finite affine transforms");
    nodes.set(node.id, node);
    for (const child of node.childIds) {
      if (parents.has(child))
        throw new TypeError("scene node has multiple parents");
      parents.set(child, node.id);
    }
  }
  for (const child of parents.keys())
    if (!nodes.has(child))
      throw new TypeError("scene child is absent");
  for (const constraint of billboards) {
    if (!nodes.has(constraint.nodeId))
      throw new TypeError("billboard scene node is absent");
    if (constraint.mode !== "face-camera")
      continue;
    for (const bone of bindings) {
      let cursor = bone.nodeId;
      while (cursor !== void 0) {
        if (cursor === constraint.nodeId)
          throw new TypeError("face-camera billboard cannot contain a skinned hierarchy");
        cursor = parents.get(cursor);
      }
    }
  }
  const nodeMatrixBytes = nodes.size * 16 * Float32Array.BYTES_PER_ELEMENT * 2;
  if (nodeMatrixBytes > maxBytes)
    throw new RangeError("scene matrices exceed maxBytes");
  const worlds = /* @__PURE__ */ new Map();
  for (const node of owned.nodes) {
    const chain = [];
    const visiting = /* @__PURE__ */ new Set();
    let id = node.id;
    while (id !== void 0 && !worlds.has(id)) {
      if (visiting.has(id))
        throw new TypeError("cyclic scene nodes");
      visiting.add(id);
      chain.push(id);
      id = parents.get(id);
    }
    for (const child of chain.reverse()) {
      const parent = parents.get(child);
      const matrix2 = new Float32Array(16);
      multiplyMat4(matrix2, 0, parent === void 0 ? IDENTITY : present(worlds.get(parent), "parent world"), 0, present(nodes.get(child), "child node").transform, 0);
      if (!matrix2.every(Number.isFinite))
        throw new RangeError("scene transform exceeds finite float range");
      worlds.set(child, matrix2);
    }
  }
  const meshes = new Map(owned.meshes.map((mesh) => [mesh.id, mesh]));
  if (meshes.size !== owned.meshes.length)
    throw new TypeError("ambiguous scene mesh");
  const instances = /* @__PURE__ */ new Map();
  for (const node of owned.nodes)
    for (const mesh of node.meshIds) {
      if (!meshes.has(mesh))
        throw new TypeError("scene node references an absent mesh");
      const ids = instances.get(mesh) ?? [];
      ids.push(node.id);
      instances.set(mesh, ids);
    }
  const primitiveNodes = /* @__PURE__ */ new Map();
  let projectedInstances = 0;
  for (const mesh of owned.meshes)
    for (const primitive of mesh.primitiveIds) {
      const ids = primitiveNodes.get(primitive) ?? [];
      const meshInstances = instances.get(mesh.id) ?? [void 0];
      projectedInstances += meshInstances.length;
      if (projectedInstances > 65536)
        throw new RangeError("render instances exceed budget");
      ids.push(...meshInstances);
      primitiveNodes.set(primitive, ids);
    }
  const hierarchyBindings = /* @__PURE__ */ new Map();
  for (const bone of bindings)
    if (bone.hierarchyId !== void 0) {
      if (typeof bone.hierarchyId !== "string" || !bone.hierarchyId)
        throw new TypeError("invalid bone hierarchy");
      const entries = hierarchyBindings.get(bone.hierarchyId) ?? /* @__PURE__ */ new Map();
      if (entries.has(bone.boneIndex))
        throw new TypeError("ambiguous skeleton binding");
      entries.set(bone.boneIndex, bone);
      hierarchyBindings.set(bone.hierarchyId, entries);
    }
  const poseSamples = options.poseSamples === void 0 ? void 0 : snapshotJson(options.poseSamples, { ...budget, maxBytes: Math.floor(maxBytes / 4) }, signal);
  const poseBlendBytes = poseSamples === void 0 ? 0 : Math.floor(maxBytes / 2);
  const poseSamplers = /* @__PURE__ */ new Map();
  const hierarchyFrames = /* @__PURE__ */ new Map();
  const bindingsByNode = /* @__PURE__ */ new Map();
  for (const bone of bindings)
    if (bone.nodeId) {
      const entries = bindingsByNode.get(bone.nodeId) ?? [];
      entries.push(bone);
      bindingsByNode.set(bone.nodeId, entries);
    }
  const nodePoses = projection.nodePoses ?? [];
  const poseNodeIds = new Set(nodePoses.map((node) => node.nodeId));
  for (const id of poseNodeIds)
    if (!nodes.has(id) || bindingsByNode.has(id))
      throw new TypeError("scene node pose is absent or overlaps a skin binding");
  if (poseSamples !== void 0) {
    if (hierarchyBindings.size === 0 && nodePoses.length === 0)
      throw new TypeError("poseSamples requires explicit node or skeleton poses");
    for (const sample of poseSamples)
      for (const channel of sample.clip.channels)
        if (["translation", "rotation", "scale"].includes(channel.kind) && !bindingsByNode.has(channel.target) && !poseNodeIds.has(channel.target))
          throw new TypeError("pose sample target has no explicit bone binding");
  }
  const blendBudget = {
    ...budget,
    maxBytes: Math.floor(maxBytes / (4 * Math.max(1, hierarchyBindings.size + (nodePoses.length ? 1 : 0))))
  };
  const nodeSampler = nodePoses.length === 0 ? void 0 : createNodePoseSampler(nodePoses, {
    poseTime,
    budget: blendBudget,
    ...clip === void 0 ? {} : { clip },
    ...poseSamples === void 0 ? {} : { poseSamples },
    ...signal === void 0 ? {} : { signal }
  });
  const trs = clip?.channels.filter((channel) => ["translation", "rotation", "scale"].includes(channel.kind)) ?? [];
  const visibility = clip?.channels.filter((channel) => channel.kind === "visibility") ?? [];
  if ((clip?.channels.length ?? 0) > trs.length + visibility.length || (clip?.unsupportedChannels ?? 0) > 0)
    report("animation-channels-unrendered", "Some animation channels are not bone TRS or primitive visibility; their effects are not rendered.");
  for (const channel of trs)
    if (!bindingsByNode.has(channel.target) && !poseNodeIds.has(channel.target))
      report("animation-target-unrendered", `Animation target ${channel.target} has no explicit bone binding.`);
  for (const [hierarchyId, entries] of hierarchyBindings) {
    try {
      const bones = [...entries.values()];
      let frame;
      for (const bone of bones) {
        let parent = bone.nodeId === void 0 ? void 0 : parents.get(bone.nodeId);
        if (bone.parentBoneIndex === null) {
          const rootFrame = parent === void 0 ? IDENTITY : worlds.get(parent);
          if (rootFrame === void 0)
            throw new TypeError("skin root frame is absent");
          if (frame !== void 0 && !frame.every((value, i) => value === rootFrame[i]))
            throw new TypeError("skin roots need the same external frame");
          frame = rootFrame;
          while (parent !== void 0) {
            if (bindingsByNode.get(parent)?.some((item) => item.hierarchyId === hierarchyId))
              throw new TypeError("skin root has an external bone ancestor");
            parent = parents.get(parent);
          }
        } else {
          while (parent !== void 0 && !bindingsByNode.get(parent)?.some((item) => item.hierarchyId === hierarchyId)) {
            const node = nodes.get(parent);
            if (node === void 0 || !node.transform.every((value, i) => value === IDENTITY[i]))
              throw new TypeError("transformed node between bones needs pose rebasing");
            parent = parents.get(parent);
          }
          const parentBinding = parent === void 0 ? void 0 : bindingsByNode.get(parent)?.find((item) => item.hierarchyId === hierarchyId);
          if (parentBinding?.hierarchyId !== hierarchyId || parentBinding.boneIndex !== bone.parentBoneIndex)
            throw new TypeError("scene bone parent differs from the skin hierarchy");
        }
      }
      const boneNodes = new Set(bones.map((bone) => bone.nodeId));
      const channels = trs.filter((channel) => boneNodes.has(channel.target));
      const primarySampler = poseSamples === void 0 ? createModelPoseSampler({
        bindings: bones,
        hierarchyId,
        budget,
        ...signal === void 0 ? {} : { signal },
        ...clip !== void 0 && (clip.hierarchyId === void 0 || clip.hierarchyId === hierarchyId) ? { clip: { ...clip, channels } } : {}
      }) : void 0;
      const blended = poseSamples === void 0 ? void 0 : createModelPoseBlendSampler({
        bindings: bones,
        hierarchyId,
        budget: blendBudget,
        ...signal === void 0 ? {} : { signal },
        samples: poseSamples.map((sample) => ({
          ...sample,
          clip: {
            ...sample.clip,
            hierarchyId,
            channels: sample.clip.hierarchyId !== void 0 && sample.clip.hierarchyId !== hierarchyId ? [] : sample.clip.channels.filter((channel) => boneNodes.has(channel.target) && ["translation", "rotation", "scale"].includes(channel.kind))
          }
        }))
      });
      const sampler = blended === void 0 ? present(primarySampler, "primary pose sampler") : {
        sample: (time, requestSignal) => blended.sample(time - poseTime, requestSignal)
      };
      sampler.sample(0, signal);
      poseSamplers.set(hierarchyId, sampler);
      hierarchyFrames.set(hierarchyId, new Float32Array(frame ?? IDENTITY));
    } catch (error) {
      if (signal?.aborted)
        throw error;
      if (poseSamples !== void 0)
        throw error;
      report("pose-unavailable", `${hierarchyId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const deformers = /* @__PURE__ */ new Map();
  let workingBytes = projection.primitives.reduce((sum, primitive) => sum + modelPrimitiveByteLength(primitive), nodeMatrixBytes + billboardBytes);
  workingBytes += poseBlendBytes;
  if (workingBytes > maxBytes)
    throw new RangeError("render geometry exceeds maxBytes");
  const primitiveIds = /* @__PURE__ */ new Set();
  let instanceCount = 0;
  for (const primitive of projection.primitives) {
    if (primitiveIds.has(primitive.id))
      throw new TypeError("ambiguous scene primitive");
    primitiveIds.add(primitive.id);
    instanceCount += primitiveNodes.get(primitive.id)?.length ?? 1;
    if (instanceCount > 65536)
      throw new RangeError("render instances exceed budget");
    if (primitive.boneIndices === void 0 && primitive.boneWeights === void 0)
      continue;
    try {
      const hierarchyId = primitive.hierarchyId;
      if (hierarchyId === void 0 || !poseSamplers.has(hierarchyId))
        throw new TypeError("skin has no complete pose hierarchy");
      const bones = [...present(hierarchyBindings.get(hierarchyId), "hierarchy bindings").values()];
      if (bones.some((bone) => bone.inverseBindMatrix === void 0))
        throw new TypeError("skin has no explicit inverse bind matrix");
      const deformer = createModelSkinDeformer(primitive, bones.map((bone) => bone.boneIndex), maxBytes - workingBytes, signal);
      workingBytes += deformer.workingBytes;
      deformers.set(primitive, deformer);
      if (deformer.zeroWeightVertices > 0)
        report("skin-zero-weights", `${deformer.zeroWeightVertices} vertices retain source positions under MK2 CPU skinning.`, primitive.id);
      if (deformer.normalizedWeightVertices > 0)
        report("skin-weight-normalization", `${deformer.normalizedWeightVertices} vertices use MK2 CPU weight normalization.`, primitive.id);
    } catch (error) {
      if (error instanceof RangeError || signal?.aborted)
        throw error;
      report("skin-unavailable", `${primitive.id}: ${error instanceof Error ? error.message : String(error)}`, primitive.id);
    }
  }
  let visibilitySampler;
  if (visibility.length > 0) {
    for (const channel of visibility)
      if (!primitiveIds.has(channel.target))
        report("animation-target-unrendered", `Visibility target ${channel.target} is not an exact scene primitive id.`);
    try {
      visibilitySampler = createModelAnimationSampler({ ...present(clip, "visibility clip"), channels: visibility }, { ...budget, maxBytes: Math.floor(maxBytes / 4) }, signal);
    } catch (error) {
      if (signal?.aborted || error instanceof RangeError)
        throw error;
      report("visibility-unavailable", `Primitive visibility is not sampleable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    sample(timeSeconds, requestSignal) {
      if (!Number.isFinite(timeSeconds))
        throw new TypeError("scene time must be finite");
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const poses = /* @__PURE__ */ new Map();
      const animatedWorlds = /* @__PURE__ */ new Map();
      const hiddenPrimitives = /* @__PURE__ */ new Set();
      for (const value of visibilitySampler?.sample(timeSeconds, requestSignal) ?? [])
        if (primitiveIds.has(value.target) && (value.value[0] ?? 0) <= 0)
          hiddenPrimitives.add(value.target);
      const localPoses = nodeSampler?.sample(timeSeconds, requestSignal);
      const faceBillboards = new Map(billboards.flatMap((item) => item.mode === "face-camera" ? [[item.nodeId, item]] : []));
      const joints = [];
      for (const [hierarchyId, sampler] of poseSamplers) {
        const originalPose = sampler.sample(timeSeconds, requestSignal).bones;
        const pose = applyModelBillboards(originalPose, [...present(hierarchyBindings.get(hierarchyId), "billboard bindings").values()], billboards, billboardCamera, present(hierarchyFrames.get(hierarchyId), "billboard frame"), billboardBytes, requestSignal);
        poses.set(hierarchyId, pose);
        const offset = joints.length;
        const byIndex = new Map(pose.map((bone, i) => [bone.boneIndex, offset + i]));
        for (const bone of pose) {
          const frame = hierarchyFrames.get(hierarchyId);
          if (frame === void 0)
            throw new TypeError("skin frame is absent");
          const world = new Float32Array(16);
          multiplyMat4(world, 0, frame, 0, bone.worldMatrix, 0);
          if (!world.every(Number.isFinite))
            throw new RangeError("animated bone transform exceeds finite float range");
          animatedWorlds.set(bone.nodeId, world);
          const binding = present(present(hierarchyBindings.get(hierarchyId), "hierarchy bindings").get(bone.boneIndex), "bone binding");
          const parent = binding.parentBoneIndex == null ? void 0 : byIndex.get(binding.parentBoneIndex);
          joints.push({
            hierarchyId,
            boneIndex: bone.boneIndex,
            name: binding.boneName,
            position: [
              present(world[12], "joint x"),
              present(world[13], "joint y"),
              present(world[14], "joint z")
            ],
            ...parent === void 0 ? {} : { parent }
          });
        }
      }
      for (const [id] of worlds)
        if (!animatedWorlds.has(id)) {
          const parent = parents.get(id);
          const matrix2 = new Float32Array(16);
          multiplyMat4(matrix2, 0, parent === void 0 ? IDENTITY : present(animatedWorlds.get(parent), "animated parent"), 0, localPoses?.get(id) ?? present(nodes.get(id), "animated node").transform, 0);
          const face = faceBillboards.get(id);
          const adjusted = face === void 0 || billboardPosition === void 0 ? matrix2 : applyModelFaceCameraBillboard(matrix2, face, billboardPosition);
          if (!adjusted.every(Number.isFinite))
            throw new RangeError("animated scene transform exceeds finite float range");
          animatedWorlds.set(id, adjusted);
        }
      const primitives = [];
      for (const primitive of projection.primitives) {
        if (hiddenPrimitives.has(primitive.id))
          continue;
        const deformer = deformers.get(primitive);
        if (deformer !== void 0) {
          const deformed = deformer.deform(present(poses.get(present(primitive.hierarchyId, "skin hierarchy")), "skin pose"), requestSignal);
          const frame = primitive.hierarchyId === void 0 ? void 0 : hierarchyFrames.get(primitive.hierarchyId);
          const transformed = frame !== void 0 && !frame.every((value, i) => value === IDENTITY[i]);
          const instances2 = primitiveNodes.get(primitive.id)?.length ?? 1;
          for (let instance = 0; instance < instances2; instance++)
            primitives.push({
              ...deformed,
              ...transformed ? { transform: new Float32Array(frame) } : {}
            });
        } else {
          for (const node of primitiveNodes.get(primitive.id) ?? [void 0]) {
            const transform = node === void 0 ? void 0 : animatedWorlds.get(node) ?? worlds.get(node);
            primitives.push({
              ...primitive,
              ...transform === void 0 ? {} : { transform: new Float32Array(transform) }
            });
          }
        }
      }
      return {
        // Each sample owns these matrices. Sockets, emitters and other node-based features use
        // the same full world transforms as geometry and bones, without format-specific math.
        nodeTransforms: animatedWorlds,
        primitives: Object.freeze(primitives),
        joints: Object.freeze(joints),
        diagnostics: Object.freeze(diagnostics)
      };
    }
  });
}

// ../MODDING/modkit-core/packages/ui/dist/model/source.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024;
var MODEL_MAXIMUM_PRIMITIVES = 4096;
var MODEL_MAXIMUM_RECORDS = 65536;
async function readModelRecords(read, maximum, signal) {
  const records = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor;
  let bytes = 0;
  do {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    const limit = Math.min(256, maximum - records.length);
    if (limit <= 0)
      throw new RangeError("model source exceeds record budget");
    const page = await read({ limit, ...cursor === void 0 ? {} : { cursor } }, signal);
    if (!Array.isArray(page.items) || page.items.length > limit)
      throw new TypeError("model source exceeded page limit");
    const items = snapshotJson(page.items, { maxDepth: 64, maxNodes: 1e6, maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes }, signal);
    bytes += new TextEncoder().encode(JSON.stringify(items)).byteLength;
    records.push(...items);
    cursor = page.nextCursor;
    if (cursor !== void 0) {
      if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || seen.has(cursor))
        throw new TypeError("model source repeated or invalid cursor");
      if (items.length === 0)
        throw new TypeError("model source returned an empty page with a cursor");
      seen.add(cursor);
    }
  } while (cursor !== void 0);
  return Object.freeze(records);
}
async function loadModelStage(source, signal) {
  const info = await source.info(signal);
  const meshes = await readModelRecords((page, abort) => source.meshes(page, abort), MODEL_MAXIMUM_PRIMITIVES, signal);
  const nodes = await readModelRecords((page, abort) => source.nodes(page, abort), MODEL_MAXIMUM_RECORDS, signal);
  const ids = /* @__PURE__ */ new Set();
  for (const mesh of meshes)
    for (const id of mesh.primitiveIds) {
      if (typeof id !== "string" || !id)
        throw new TypeError("invalid model primitive id");
      ids.add(id);
      if (ids.size > MODEL_MAXIMUM_PRIMITIVES)
        throw new RangeError("model source exceeds primitive budget");
    }
  const primitives = [];
  let bytes = 0;
  if (source.primitive !== void 0)
    for (const id of ids) {
      if (signal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const primitive = await source.primitive(id, { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes }, signal);
      if (primitive.id !== id)
        throw new TypeError("model source returned a different primitive");
      bytes += modelPrimitiveByteLength(primitive);
      if (bytes > MODEL_MAXIMUM_PRIMITIVE_BYTES)
        throw new RangeError("model geometry exceeds byte budget");
      primitives.push(primitive);
    }
  return {
    info,
    nodes,
    meshes,
    primitives: Object.freeze(primitives),
    primitiveIds: Object.freeze([...ids]),
    ...primitives[0] === void 0 ? {} : { primitive: primitives[0] }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/model/scene.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var MODEL_FIELD_OF_VIEW = 0.8;
var MODEL_DEFAULT_BASE_COLOR = Object.freeze([0.78, 0.8, 0.84, 1]);
var MODEL_TEXTURED_BASE_COLOR = Object.freeze([1, 1, 1, 1]);
var MODEL_KEY_LIGHT = Object.freeze({
  direction: Object.freeze([0.35, 0.72, 0.6]),
  color: Object.freeze([1, 1, 1, 1]),
  ambient: 0.28
});
function upAxisCorrection(upAxis) {
  if (upAxis !== "+z")
    return void 0;
  return Float32Array.from([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
}
function orientPrimitive(primitive, correction) {
  if (correction === void 0)
    return primitive;
  const existing = primitive.transform;
  if (existing === void 0)
    return { ...primitive, transform: correction };
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1)
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += (correction[k * 4 + row] ?? 0) * (existing[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  return { ...primitive, transform: out };
}
var finite2 = (value) => typeof value === "number" && Number.isFinite(value);
function boundsFraming(bounds) {
  const { min, max } = bounds;
  if (!min.every(finite2) || !max.every(finite2))
    return void 0;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return radius > 0 ? { center, radius } : { center, radius: 1 };
}
function framePrimitive(primitive) {
  if (primitive.bounds !== void 0) {
    const framing = boundsFraming(primitive.bounds);
    if (framing !== void 0)
      return framing;
  }
  const positions = primitive.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (!finite2(x) || !finite2(y) || !finite2(z))
      continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (minX > maxX)
    return { center: [0, 0, 0], radius: 1 };
  return boundsFraming({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }) ?? {
    center: [0, 0, 0],
    radius: 1
  };
}
function framePrimitives(primitives) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives)
    for (let i = 0; i < primitive.positions.length; i += 3) {
      const x = primitive.positions[i], y = primitive.positions[i + 1], z = primitive.positions[i + 2];
      const matrix2 = primitive.transform;
      for (let axis = 0; axis < 3; axis++) {
        const value = matrix2 === void 0 ? primitive.positions[i + axis] : matrix2[axis] * x + matrix2[4 + axis] * y + matrix2[8 + axis] * z + matrix2[12 + axis];
        if (!Number.isFinite(value))
          throw new TypeError("invalid model framing positions");
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  return boundsFraming({ min, max }) ?? { center: [0, 0, 0], radius: 1 };
}
var dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
function modelCamera(framing, basis, distanceScale, viewport) {
  const radius = framing.radius > 0 && Number.isFinite(framing.radius) ? framing.radius : 1;
  const distance = radius / Math.sin(MODEL_FIELD_OF_VIEW / 2) * Math.max(0.15, distanceScale);
  const { right, up, backward } = basis;
  const eye = [
    framing.center[0] + backward[0] * distance,
    framing.center[1] + backward[1] * distance,
    framing.center[2] + backward[2] * distance
  ];
  const aspect = viewport.height <= 0 ? 1 : viewport.width / viewport.height;
  const focal = 1 / Math.tan(MODEL_FIELD_OF_VIEW / 2);
  const near = Math.max(distance - radius, radius * 1e-3, 1e-4);
  const far = distance + radius * 2 + near;
  const rightAxis = right;
  const upAxis = up;
  const backwardAxis = backward;
  const view = new Float32Array(16);
  view[0] = rightAxis[0];
  view[4] = rightAxis[1];
  view[8] = rightAxis[2];
  view[12] = -dot(rightAxis, eye);
  view[1] = upAxis[0];
  view[5] = upAxis[1];
  view[9] = upAxis[2];
  view[13] = -dot(upAxis, eye);
  view[2] = backwardAxis[0];
  view[6] = backwardAxis[1];
  view[10] = backwardAxis[2];
  view[14] = -dot(backwardAxis, eye);
  view[15] = 1;
  const projection = new Float32Array(16);
  projection[0] = focal / (aspect === 0 ? 1 : aspect);
  projection[5] = focal;
  projection[10] = (far + near) / (near - far);
  projection[11] = -1;
  projection[14] = 2 * far * near / (near - far);
  return { eye, framing, viewMatrix: view, viewProjection: multiply4x4(projection, view) };
}
function multiply4x4(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}
function projectPoint(viewProjection, point, viewport) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const clipX = viewProjection[0] * x + viewProjection[4] * y + viewProjection[8] * z + viewProjection[12];
  const clipY = viewProjection[1] * x + viewProjection[5] * y + viewProjection[9] * z + viewProjection[13];
  const clipW = viewProjection[3] * x + viewProjection[7] * y + viewProjection[11] * z + viewProjection[15];
  if (!Number.isFinite(clipW) || clipW <= 1e-6)
    return void 0;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY))
    return void 0;
  return [(ndcX * 0.5 + 0.5) * viewport.width, (1 - (ndcY * 0.5 + 0.5)) * viewport.height];
}
function materialColorFor(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  const hue = hash % 3600 / 3600;
  const [red, green, blue] = hueToRgb(hue, 0.28, 0.72);
  return [red, green, blue, 1];
}
function hueToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue * 6;
  const second = chroma * (1 - Math.abs(sector % 2 - 1));
  const match = lightness - chroma / 2;
  const table = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second]
  ];
  const base = table[Math.min(5, Math.floor(sector))] ?? table[0];
  const rgb = base;
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match];
}
var BASE_COLOR_SLOTS = Object.freeze([
  "diffuse",
  "basecolor",
  "albedo",
  "color",
  "colour",
  "mapkd"
]);
var slotKey = (value) => value.toLowerCase().replace(/[^a-z0-9]/gu, "");
function baseColorResourceOf(material) {
  const layers = material.layers ?? [];
  for (const slot of BASE_COLOR_SLOTS) {
    for (const layer of layers) {
      if (slotKey(layer.slot) === slot && layer.resourceId !== void 0)
        return layer.resourceId;
    }
  }
  return void 0;
}
function sceneMaterials(refs, textures, shaded) {
  const used = /* @__PURE__ */ new Map();
  const materials = refs.map((ref) => {
    const resourceId = baseColorResourceOf(ref);
    const texture = resourceId === void 0 ? void 0 : textures.get(resourceId);
    if (texture !== void 0)
      used.set(texture.id, texture);
    const bindings = [];
    const boundResources = /* @__PURE__ */ new Set();
    for (const layer of ref.layers ?? []) {
      if (layer.resourceId === void 0 || boundResources.has(layer.resourceId))
        continue;
      const layerTexture = textures.get(layer.resourceId);
      if (layerTexture === void 0)
        continue;
      boundResources.add(layer.resourceId);
      used.set(layerTexture.id, layerTexture);
      bindings.push({ resourceId: layer.resourceId, textureId: layerTexture.id });
    }
    return Object.freeze({
      id: ref.id,
      /*
       * A bound texture is the surface's own albedo, so it is shown at its own value. Modulating
       * it by the untextured grey made textured models darker than untextured ones — worst on the
       * dark textures where detail matters most.
       */
      baseColor: texture === void 0 ? materialColorFor(ref.id) : MODEL_TEXTURED_BASE_COLOR,
      ...texture === void 0 ? {} : { baseColorTexture: texture.id },
      shading: shaded ? "lambert" : "unlit",
      ...ref.alphaMode === void 0 ? {} : { alphaMode: ref.alphaMode },
      ...ref.alphaCutoff === void 0 ? {} : { alphaCutoff: ref.alphaCutoff },
      ...ref.shader === void 0 ? {} : { shader: ref.shader },
      ...bindings.length === 0 ? {} : { textureBindings: Object.freeze(bindings) }
    });
  });
  return Object.freeze({
    materials: Object.freeze(materials),
    textures: Object.freeze([...used.values()])
  });
}
function modelSceneRequest(options) {
  if (options.primitive === void 0 === (options.primitives === void 0))
    throw new TypeError("provide either one primitive or a complete primitive list");
  return {
    scene: {
      primitives: options.primitives ?? [options.primitive],
      ...options.materials === void 0 || options.materials.length === 0 ? {} : { materials: options.materials },
      ...options.textures === void 0 || options.textures.length === 0 ? {} : { textures: options.textures },
      ...options.light === void 0 ? {} : { light: options.light },
      ...options.materialContext === void 0 ? {} : { materialContext: options.materialContext }
    },
    camera: {
      viewProjection: options.camera.viewProjection,
      viewMatrix: options.camera.viewMatrix,
      eyePosition: options.camera.eye
    },
    viewport: options.viewport,
    ...options.clearColor === void 0 ? {} : { clearColor: options.clearColor },
    outputKind: "rgba8",
    ...options.signal === void 0 ? {} : { signal: options.signal }
  };
}
function skeletonJoints(bindings) {
  const hierarchyIds = [
    ...new Set(bindings.flatMap((binding) => typeof binding.hierarchyId === "string" && binding.hierarchyId ? [binding.hierarchyId] : []))
  ];
  const joints = [];
  for (const hierarchyId of hierarchyIds) {
    const hierarchy = bindings.filter((binding) => binding.hierarchyId === hierarchyId);
    const offset = joints.length;
    const sampled = createModelSceneSampler({
      nodes: createModelSkeletonNodes(hierarchy, hierarchyId),
      meshes: [],
      primitives: [],
      skeleton: hierarchy
    }).sample(0).joints;
    joints.push(...sampled.map((joint) => ({
      ...joint,
      ...joint.parent === void 0 ? {} : { parent: joint.parent + offset }
    })));
  }
  return Object.freeze(joints);
}

// ../MODDING/modkit-core/packages/ui/dist/field-write/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
function fieldEditTargetText(target) {
  if (target.state === "resolved")
    return target.destination.label;
  if (target.state === "selection-required") {
    const choices = target.candidates.map((item) => `${item.rootId} \u2192 ${item.path}`).join("; ");
    return choices.length === 0 ? target.reason : `${target.reason}: ${choices}`;
  }
  return target.reason;
}
function mountFieldEditTarget(container, target) {
  if (target === void 0)
    return void 0;
  const node = element(container, "small", { part: "field.target" });
  node.dataset["editTargetState"] = target.state;
  node.setAttribute("role", "status");
  setViewerText(node, fieldEditTargetText(target), 2048);
  return node;
}
function fieldWriteRefusal(descriptor, editable, route) {
  if (route !== void 0 && (route.commit === void 0 || route.authorization === void 0)) {
    return "this surface was mounted without a route to save a change";
  }
  if (editable === void 0)
    return "this codec does not offer this value for editing";
  if (editable.readonlyReason !== void 0)
    return editable.readonlyReason;
  const write = editable.write;
  if (write === void 0)
    return "this codec does not offer this value for editing";
  if (!("operation" in write)) {
    return "this value is written through a writer service this surface does not hold";
  }
  const operation = descriptor.operations.find((candidate) => candidate.id === write.operation);
  if (operation === void 0)
    return `the codec declares no operation \xAB${String(write.operation)}\xBB`;
  if (operation.state !== "available") {
    return `the operation \xAB${String(write.operation)}\xBB is ${operation.state} for this file`;
  }
  return void 0;
}
function editPlanOf(result) {
  const output = result.output;
  return output?.kind === "edit-plan" ? output.plan : void 0;
}
async function commitOperationWrite(route, operationId, input, signal) {
  const operation = route.descriptor.operations.find((candidate) => candidate.id === operationId);
  if (operation === void 0)
    return `the codec declares no operation \xAB${operationId}\xBB`;
  if (operation.state !== "available") {
    return `the operation \xAB${operationId}\xBB is ${operation.state} for this file`;
  }
  const coordinator = route.commit;
  const authorization = route.authorization;
  if (coordinator === void 0 || authorization === void 0) {
    return "no route to save this change";
  }
  const options = signal === void 0 ? {} : { signal };
  const result = await route.operations.invoke(operation.handlerId, input, options);
  if (isRejected(result))
    return invokeRefusalMessage(result);
  const plan = editPlanOf(result);
  if (plan === void 0)
    return "the codec returned no edit plan for this write";
  const grant = await authorization.request(plan, options);
  if (grant === void 0)
    return "not authorised to write this file";
  const prepared = await coordinator.prepare(plan, { grant: grant.grant, ...options });
  if (prepared.state !== "ready") {
    return prepared.state === "conflict" ? "the file changed after this view opened it" : `refused: ${prepared.reason ?? prepared.state}`;
  }
  const receipt = await coordinator.commit(prepared.prepared, { grant: grant.grant, ...options });
  return receipt.state === "committed" ? void 0 : `not saved: ${receipt.state}`;
}
function controlField(options) {
  const initialText = options.value === null || options.value === void 0 ? "" : String(options.value);
  return Object.freeze({
    key: options.target.key,
    label: options.label,
    type: options.type,
    inputPath: ["value"],
    name: options.target.key,
    kind: "text",
    initial: options.value,
    initialText,
    ...options.editable?.editor === void 0 ? {} : { editorId: options.editable.editor }
  });
}
async function mountInlineField(container, options) {
  const root = element(container, "span", { part: "field" });
  const refusal = fieldWriteRefusal(options.descriptor, options.editable, {
    ...options.commit === void 0 ? {} : { commit: options.commit },
    ...options.authorization === void 0 ? {} : { authorization: options.authorization }
  });
  if (refusal !== void 0) {
    const text = element(root, "span", { part: "field.control" });
    setViewerText(text, options.value ?? "", 4096);
    text.title = refusal;
    root.dataset["readonly"] = "true";
    return {
      root,
      async commit() {
        return false;
      },
      async unmount() {
        root.remove();
      }
    };
  }
  const host = element(root, "span", { part: "field.control" });
  const status = element(root, "span", { part: "field.status" });
  const control = await mountFieldEditor(host, controlField(options), options.signal, options.fieldEditors, options.editable?.editor, options.candidates);
  const write = options.editable?.write;
  const operationId = write !== void 0 && "operation" in write ? write.operation : void 0;
  const operation = options.descriptor.operations.find((candidate) => candidate.id === operationId);
  const commit = async () => {
    if (operation === void 0) {
      setViewerText(status, "no route to save this change", 512);
      return false;
    }
    const problem = control.validate();
    if (problem !== void 0) {
      setViewerText(status, problem, 512);
      return false;
    }
    const value = control.read();
    const request = {
      groupId: options.target.groupId,
      key: options.target.key,
      ...options.target.path === void 0 ? {} : { path: options.target.path },
      value
    };
    setViewerText(status, "\u2026", 8);
    const refusal2 = await commitOperationWrite(options, operation.id, request, options.signal);
    if (refusal2 !== void 0) {
      setViewerText(status, refusal2, 512);
      return false;
    }
    setViewerText(status, "", 1);
    await options.onWritten?.(value);
    return true;
  };
  return {
    root,
    commit,
    async unmount() {
      await control.unmount?.();
      root.remove();
    }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/model/orbit.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var PITCH_MINIMUM = -1.4;
var PITCH_MAXIMUM = 1.5;
var DRAG_RADIANS_PER_PIXEL = 8e-3;
var WHEEL_IN = 0.9;
var WHEEL_OUT = 1.1;
var DISTANCE_MINIMUM = 0.15;
var DISTANCE_MAXIMUM = 8;
var RESET_YAW = 0.7;
var RESET_PITCH = 0.45;
var clamp = (value, low, high) => Math.min(Math.max(value, low), high);
var POLE = Math.PI / 2 - 1e-3;
var AXIS_POSE = Object.freeze({
  "+x": [Math.PI / 2, 0],
  "-x": [-Math.PI / 2, 0],
  "+y": [0, POLE],
  "-y": [0, -POLE],
  "+z": [0, 0],
  "-z": [Math.PI, 0]
});
function createOrbitController(initial = {}) {
  let yaw = initial.yaw ?? RESET_YAW;
  let pitch = clamp(initial.pitch ?? RESET_PITCH, PITCH_MINIMUM, PITCH_MAXIMUM);
  let distanceScale = clamp(initial.distanceScale ?? 1, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    const pose = { yaw, pitch, distanceScale };
    for (const listener of listeners)
      listener(pose);
  };
  const controller = {
    get pose() {
      return { yaw, pitch, distanceScale };
    },
    position(target, radius) {
      const scaled = radius * distanceScale;
      return [
        target[0] + Math.sin(yaw) * Math.cos(pitch) * scaled,
        target[1] + Math.sin(pitch) * scaled,
        target[2] + Math.cos(yaw) * Math.cos(pitch) * scaled
      ];
    },
    basis() {
      const backward = [
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch)
      ];
      const horizontal = Math.hypot(backward[0], backward[2]) || 1;
      const right = [backward[2] / horizontal, 0, -backward[0] / horizontal];
      const up = [
        backward[1] * right[2],
        backward[2] * right[0] - backward[0] * right[2],
        -backward[1] * right[0]
      ];
      return { backward, right, up };
    },
    orbit(deltaX, deltaY) {
      yaw += deltaX * DRAG_RADIANS_PER_PIXEL;
      pitch = clamp(pitch + deltaY * DRAG_RADIANS_PER_PIXEL, PITCH_MINIMUM, PITCH_MAXIMUM);
      emit();
    },
    zoom(wheelDelta) {
      distanceScale = clamp(distanceScale * (wheelDelta > 0 ? WHEEL_OUT : WHEEL_IN), DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
      emit();
    },
    snapTo(axis) {
      const pose = AXIS_POSE[axis];
      if (pose === void 0)
        throw new TypeError(`unknown view axis: ${String(axis)}`);
      yaw = pose[0];
      pitch = pose[1];
      emit();
    },
    reset() {
      yaw = RESET_YAW;
      pitch = RESET_PITCH;
      distanceScale = 1;
      emit();
    },
    set(pose) {
      if (pose.yaw !== void 0)
        yaw = pose.yaw;
      if (pose.pitch !== void 0)
        pitch = clamp(pose.pitch, PITCH_MINIMUM, PITCH_MAXIMUM);
      if (pose.distanceScale !== void 0) {
        distanceScale = clamp(pose.distanceScale, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
      }
      emit();
    },
    attach(host, signal) {
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const options = signal === void 0 ? {} : { signal };
      host.addEventListener("pointerdown", (event) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        host.setPointerCapture(event.pointerId);
      }, options);
      host.addEventListener("pointermove", (event) => {
        if (!dragging)
          return;
        controller.orbit(event.clientX - lastX, event.clientY - lastY);
        lastX = event.clientX;
        lastY = event.clientY;
      }, options);
      const stop = () => {
        dragging = false;
      };
      host.addEventListener("pointerup", stop, options);
      host.addEventListener("pointercancel", stop, options);
      host.addEventListener("wheel", (event) => {
        event.preventDefault();
        controller.zoom(event.deltaY);
      }, { passive: false, ...options });
      host.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 40 : 12;
        if (event.key === "ArrowLeft")
          controller.orbit(-step, 0);
        else if (event.key === "ArrowRight")
          controller.orbit(step, 0);
        else if (event.key === "ArrowUp")
          controller.orbit(0, -step);
        else if (event.key === "ArrowDown")
          controller.orbit(0, step);
        else if (event.key === "+" || event.key === "=")
          controller.zoom(-1);
        else if (event.key === "-")
          controller.zoom(1);
        else if (event.key === "0")
          controller.reset();
        else
          return;
        event.preventDefault();
      }, options);
      return stop;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return controller;
}

// ../MODDING/modkit-core/packages/ui/dist/model/gizmo.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var SVG_NS = "http://www.w3.org/2000/svg";
var GIZMO_SIZE = 80;
var CENTER = GIZMO_SIZE / 2;
var RADIUS_FRONT = 28;
var RADIUS_BACK = 18;
var HANDLE_FRONT = 11;
var HANDLE_BACK = 6;
var AXES = Object.freeze([
  { key: "+x", label: "X", vector: [1, 0, 0], token: "--mk-color-axis-x" },
  { key: "-x", label: "", vector: [-1, 0, 0], token: "--mk-color-axis-x" },
  { key: "+y", label: "Y", vector: [0, 1, 0], token: "--mk-color-axis-y" },
  { key: "-y", label: "", vector: [0, -1, 0], token: "--mk-color-axis-y" },
  { key: "+z", label: "Z", vector: [0, 0, 1], token: "--mk-color-axis-z" },
  { key: "-z", label: "", vector: [0, 0, -1], token: "--mk-color-axis-z" }
]);
function createViewGizmo(host, options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_GIZMO_FALLBACK_MESSAGES);
  const document = host.ownerDocument;
  const root = element(host, "div", { part: "gizmo" });
  root.setAttribute("aria-label", localizer.text("viewer.viewAxis"));
  root.setAttribute("role", "group");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(GIZMO_SIZE));
  svg.setAttribute("height", String(GIZMO_SIZE));
  svg.setAttribute("viewBox", `0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`);
  setPart(svg, "gizmo.svg");
  root.append(svg);
  const pivot = document.createElementNS(SVG_NS, "circle");
  pivot.setAttribute("cx", String(CENTER));
  pivot.setAttribute("cy", String(CENTER));
  pivot.setAttribute("r", "3");
  pivot.setAttribute("fill", "var(--mk-color-canvas-gizmo)");
  svg.append(pivot);
  const nodes = [];
  for (const spec of AXES) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(CENTER));
    line.setAttribute("y1", String(CENTER));
    line.setAttribute("stroke", `var(${spec.token})`);
    line.setAttribute("stroke-linecap", "round");
    setPart(line, "gizmo.axis");
    svg.append(line);
    const hit = document.createElementNS(SVG_NS, "g");
    hit.setAttribute("role", "button");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-label", localizer.text("viewer.viewFromAxis", { axis: spec.key.toUpperCase() }));
    setPart(hit, "gizmo.handle");
    const handle = document.createElementNS(SVG_NS, "circle");
    handle.setAttribute("fill", `var(${spec.token})`);
    hit.append(handle);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("fill", "var(--mk-color-fg-inverse)");
    label.textContent = spec.label;
    setPart(label, "gizmo.label");
    hit.append(label);
    const activate = () => options.onAxis?.(spec.key);
    hit.addEventListener("click", activate);
    hit.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ")
        return;
      event.preventDefault();
      activate();
    });
    svg.append(hit);
    nodes.push({ spec, line, handle, label, hit });
  }
  const update = (yaw, pitch) => {
    const backward = [
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ];
    const horizontal = Math.hypot(backward[0], backward[2]) || 1;
    const right = [backward[2] / horizontal, 0, -backward[0] / horizontal];
    const up = [
      backward[1] * right[2],
      backward[2] * right[0] - backward[0] * right[2],
      -backward[1] * right[0]
    ];
    for (const { spec, line, handle, label, hit } of nodes) {
      const screenX = spec.vector[0] * right[0] + spec.vector[2] * right[2];
      const screenY = spec.vector[0] * up[0] + spec.vector[1] * up[1] + spec.vector[2] * up[2];
      const depth = spec.vector[0] * backward[0] + spec.vector[1] * backward[1] + spec.vector[2] * backward[2];
      const front = depth >= 0;
      const x = CENTER + screenX * (front ? RADIUS_FRONT : RADIUS_BACK);
      const y = CENTER - screenY * (front ? RADIUS_FRONT : RADIUS_BACK);
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      line.setAttribute("stroke-width", front ? "2.5" : "1.5");
      line.setAttribute("opacity", front ? "1" : "0.35");
      handle.setAttribute("cx", String(x));
      handle.setAttribute("cy", String(y));
      handle.setAttribute("r", String((front ? HANDLE_FRONT : HANDLE_BACK) / 2 + 3));
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(y));
      label.setAttribute("font-size", front ? "9" : "0");
      hit.setAttribute("opacity", front ? "1" : "0.5");
    }
  };
  update(0.7, 0.45);
  return {
    root,
    update,
    destroy() {
      root.remove();
    }
  };
}

// ../MODDING/modkit-core/packages/ui/dist/model/index.js
function modelAnimationPlaybackDuration(clip) {
  if (clip === void 0)
    return 0;
  let duration = clip.durationSeconds ?? 0;
  if (clip.repeatCount !== void 0 && clip.repeatCount > 0)
    duration = Math.max(duration, duration * clip.repeatCount);
  for (const channel of clip.channels) {
    if (channel.concurrent === true && channel.wrapSeconds !== void 0 && channel.repeatCount !== void 0 && channel.repeatCount > 0)
      duration = Math.max(duration, channel.wrapSeconds * channel.repeatCount);
  }
  return duration;
}
var MODEL_RENDERER_BACKENDS = Object.freeze({
  "modkit.browser-webgl": "webgl2",
  "modkit.headless": "cpu-raster"
});
var MODEL_WIREFRAME_BACKEND = "wireframe";
var CLIP_RENAME_OPERATION = "edit.field";
var MODEL_CONVERT_OPERATION = "model.export-native";
var MODEL_UVM_OPERATION = "model.export-uvm";
var UVM_EXPORT_INPUT = Object.freeze({ schemaVersion: 1 });
var UVM_WRITES = Object.freeze({
  format: Object.freeze({ id: "uvm", label: "UVM" }),
  extension: ".uvm",
  mediaType: "model/gltf-binary; profile=uvm-1.0"
});
function modelConversions(descriptor) {
  const native = exportOffer(descriptor, MODEL_CONVERT_OPERATION).flatMap((form2) => {
    if (form2.writes === void 0)
      return [];
    try {
      return [{ form: form2, input: form2.build(/* @__PURE__ */ new Map()) }];
    } catch {
      return [];
    }
  });
  const uvm = descriptor.operations.find((item) => item.id === MODEL_UVM_OPERATION && item.state === "available" && !item.mutatesSource);
  if (uvm === void 0)
    return native;
  const form = Object.freeze({
    id: "uvm",
    label: "UVM",
    operationId: MODEL_UVM_OPERATION,
    handlerId: uvm.handlerId,
    summary: "UVM",
    fields: Object.freeze([]),
    writes: UVM_WRITES,
    build: () => UVM_EXPORT_INPUT
  });
  return [...native, { form, input: UVM_EXPORT_INPUT }];
}
function modelRendererBackend(rendererId) {
  return MODEL_RENDERER_BACKENDS[rendererId] ?? "provider";
}
var MODEL_FACET_DETAIL_LIMIT = 64;
var MODEL_FACET_CONTRACTS = Object.freeze([
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source",
  "common.view/model-socket-source",
  "common.view/model-effect-source",
  "common.view/model-light-source",
  "common.view/model-camera-source",
  "common.view/model-physics-source",
  "common.view/model-node-behaviour-source"
]);
var FACET_READOUT = Object.freeze({
  "common.view/model-resource-refs-source": {
    labelKey: "viewer.modelResources",
    key: "references"
  },
  "common.view/model-skeleton-source": { labelKey: "viewer.modelBones", key: "bindings" },
  "common.view/model-animation-source": { labelKey: "viewer.modelClips", key: "clips" },
  "common.view/model-collision-source": { labelKey: "viewer.modelCollision", key: "volumes" },
  "common.view/model-material-source": { labelKey: "viewer.modelMaterials", key: "materials" },
  "common.view/model-socket-source": { labelKey: "viewer.modelSockets", key: "sockets" },
  "common.view/model-effect-source": { labelKey: "viewer.modelEffects", key: "effects" },
  "common.view/model-light-source": { labelKey: "viewer.modelLights", key: "lights" },
  "common.view/model-camera-source": { labelKey: "viewer.modelCameras", key: "cameras" },
  "common.view/model-physics-source": { labelKey: "viewer.modelPhysics", key: "bodies" },
  "common.view/model-node-behaviour-source": {
    labelKey: "viewer.modelBehaviours",
    key: "behaviours"
  }
});
var MODEL_PANEL_SECTIONS = Object.freeze([
  {
    id: "meshes",
    title: "Meshes",
    contract: "common.view/model-material-source",
    icon: "symbol-method"
  },
  {
    id: "materials",
    title: "Materials",
    contract: "common.view/model-material-source",
    icon: "paintcan"
  },
  {
    id: "resources",
    title: "Resources",
    contract: "common.view/model-resource-refs-source",
    icon: "file-media"
  },
  {
    id: "bones",
    title: "Bones",
    contract: "common.view/model-skeleton-source",
    icon: "type-hierarchy"
  },
  {
    id: "animations",
    title: "Animations",
    contract: "common.view/model-animation-source",
    icon: "play"
  },
  {
    id: "attachments",
    title: "Attachments",
    contract: "common.view/model-socket-source",
    icon: "pinned"
  },
  {
    id: "hit-volumes",
    title: "Hit Volumes",
    contract: "common.view/model-collision-source",
    icon: "shield"
  },
  { id: "lights", title: "Lights", contract: "common.view/model-light-source", icon: "lightbulb" },
  {
    id: "turrets",
    title: "Turrets",
    contract: "common.view/model-node-behaviour-source",
    kind: "turret",
    icon: "target"
  },
  {
    id: "cameras",
    title: "Cameras",
    contract: "common.view/model-camera-source",
    icon: "device-camera"
  },
  {
    id: "ribbons",
    title: "Ribbons",
    contract: "common.view/model-effect-source",
    kind: "ribbon",
    icon: "sparkle"
  },
  {
    id: "ribbon-splines",
    title: "Ribbon Splines",
    contract: "common.view/model-effect-source",
    kind: "ribbon-spline",
    icon: "sparkle"
  },
  {
    id: "particles",
    title: "Particles",
    contract: "common.view/model-effect-source",
    kind: "particle",
    icon: "sparkle"
  },
  {
    id: "particle-copies",
    title: "Particle Copies",
    contract: "common.view/model-effect-source",
    kind: "particle-copy",
    icon: "sparkle"
  },
  {
    id: "projections",
    title: "Projections",
    contract: "common.view/model-effect-source",
    kind: "projection",
    icon: "sparkle"
  },
  {
    id: "forces",
    title: "Forces",
    contract: "common.view/model-effect-source",
    kind: "force",
    icon: "sparkle"
  },
  {
    id: "billboards",
    title: "Billboards",
    contract: "common.view/model-node-behaviour-source",
    kind: "billboard",
    icon: "target"
  },
  {
    id: "warps",
    title: "Warps",
    contract: "common.view/model-effect-source",
    kind: "warp",
    icon: "sparkle"
  },
  {
    id: "shadow-boxes",
    title: "Shadow Boxes",
    contract: "common.view/model-effect-source",
    kind: "shadow-box",
    icon: "sparkle"
  },
  {
    id: "rigid-bodies",
    title: "Rigid Bodies",
    contract: "common.view/model-physics-source",
    kind: "rigid-body",
    icon: "circuit-board"
  },
  {
    id: "physics-shapes",
    title: "Physics Shapes",
    contract: "common.view/model-physics-source",
    kind: "shape",
    icon: "circuit-board"
  },
  {
    id: "physics-joints",
    title: "Physics Joints",
    contract: "common.view/model-physics-source",
    kind: "joint",
    icon: "circuit-board"
  },
  {
    id: "physics-cloths",
    title: "Physics Cloths",
    contract: "common.view/model-physics-source",
    kind: "cloth",
    icon: "circuit-board"
  },
  {
    id: "cloth-constraints",
    title: "Cloth Constraints",
    contract: "common.view/model-physics-source",
    kind: "cloth-constraint",
    icon: "circuit-board"
  },
  {
    id: "ik",
    title: "Inverse Kinematics",
    contract: "common.view/model-node-behaviour-source",
    kind: "ik",
    icon: "target"
  }
]);
var MODEL_TEAM_COLOR_PRESETS = Object.freeze([
  "#d9140f",
  "#2563eb",
  "#16a34a",
  "#facc15",
  "#9333ea",
  "#06b6d4",
  "#f97316",
  "#e5e7eb"
]);
function modelRecordRows(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record))
    return [];
  const rows = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === void 0 || value === null)
      continue;
    if (key === "properties" && Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
          continue;
        const property = entry;
        if (typeof property.key !== "string")
          continue;
        rows.push([property.key, describeModelValue(property.value)]);
      }
      continue;
    }
    rows.push([key, describeModelValue(value)]);
  }
  return rows;
}
function describeModelValue(value) {
  if (value === null || value === void 0)
    return "";
  if (Array.isArray(value))
    return value.map((item) => typeof item === "number" ? Number(item.toFixed(4)) : describeModelValue(item)).join(", ");
  if (typeof value === "number")
    return String(Number(value.toFixed(4)));
  if (typeof value === "object")
    return JSON.stringify(value);
  return String(value);
}
async function readModelFacets(sources, slot, scope, signal, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  const parts = [];
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract);
    if (lease === void 0)
      continue;
    scope.lease(lease);
    const readout = FACET_READOUT[contract];
    const source = lease.value;
    const info = await source.info(signal);
    const value = info[readout?.key ?? ""];
    if (typeof value === "number") {
      parts.push(`${value} ${readout === void 0 ? contract : localizer.text(readout.labelKey)}`);
    }
  }
  return parts;
}
function short(value) {
  const text = String(value ?? "").trim();
  return text.length <= 160 ? text : `${text.slice(0, 157)}\u2026`;
}
function facetItem(contract, value, localizer) {
  if (contract === "common.view/model-resource-refs-source") {
    const item2 = value;
    return `${short(item2.id)} \xB7 ${item2.role} \xB7 ${item2.provenance}`;
  }
  if (contract === "common.view/model-skeleton-source") {
    const item2 = value;
    const parent = item2.parentBoneIndex === void 0 ? "?" : item2.parentBoneIndex ?? "root";
    return `#${item2.boneIndex} ${short(item2.boneName ?? localizer.text("viewer.modelUnnamed"))} \xB7 ${localizer.text("viewer.modelParent", { parent })} \xB7 ${item2.flagNames?.join(", ") || localizer.text("viewer.modelNoNamedFlags")}`;
  }
  if (contract === "common.view/model-animation-source") {
    const item2 = value;
    const samples = item2.channels.reduce((total, channel) => total + (channel.samples?.length ?? 0), 0);
    return `${short(item2.name)} \xB7 ${localizer.text("viewer.modelClipDetail", {
      frames: item2.frames,
      channels: item2.channels.length,
      samples
    })}`;
  }
  if (contract === "common.view/model-collision-source") {
    const item2 = value;
    return `${short(item2.id)} \xB7 ${item2.kind} \xB7 ${item2.origin}`;
  }
  if (contract === "common.view/model-material-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.type ?? localizer.text("viewer.modelMaterial")} \xB7 ${item2.blendMode ?? localizer.text("viewer.modelBlendUnknown")} \xB7 ${localizer.text("viewer.modelLayers", { count: item2.layers?.length ?? 0 })}`;
  }
  if (contract === "common.view/model-light-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-camera-source") {
    const item2 = value;
    const fov = item2.fieldOfViewRadians === void 0 ? "\u2014" : `${(item2.fieldOfViewRadians * 180 / Math.PI).toFixed(1)}\xB0`;
    return `${short(item2.name ?? item2.id)} \xB7 ${fov} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-physics-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind}${item2.shape === void 0 ? "" : ` \xB7 ${item2.shape}`} \xB7 ${item2.nodeId ?? "\u2014"}`;
  }
  if (contract === "common.view/model-node-behaviour-source") {
    const item2 = value;
    const spans = item2.nodeIds === void 0 ? "" : ` \xB7 ${String(item2.nodeIds.length)}`;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"}${spans}`;
  }
  if (contract === "common.view/model-effect-source") {
    const item2 = value;
    return `${short(item2.name ?? item2.id)} \xB7 ${item2.kind} \xB7 ${item2.nodeId ?? "\u2014"} \xB7 ${localizer.text("viewer.modelEffectProperties", { count: item2.properties?.length ?? 0 })}`;
  }
  const item = value;
  return `${short(item.sourceName ?? item.id)} \xB7 ${item.role} \xB7 ${item.nodeId}`;
}
var FACET_PAGE_METHOD = Object.freeze({
  "common.view/model-resource-refs-source": "references",
  "common.view/model-skeleton-source": "bindings",
  "common.view/model-animation-source": "clips",
  "common.view/model-collision-source": "volumes",
  "common.view/model-material-source": "materials",
  "common.view/model-socket-source": "sockets",
  "common.view/model-effect-source": "effects",
  "common.view/model-light-source": "lights",
  "common.view/model-camera-source": "cameras",
  "common.view/model-physics-source": "bodies",
  "common.view/model-node-behaviour-source": "behaviours"
});
async function readModelFacetPages(sources, slot, scope, signal) {
  const pages = /* @__PURE__ */ new Map();
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract);
    if (lease === void 0)
      continue;
    scope.lease(lease);
    const source = lease.value;
    const method = source[FACET_PAGE_METHOD[contract]];
    if (method === void 0)
      continue;
    const items = await readModelRecords((request, abort) => method.call(source, request, abort), MODEL_MAXIMUM_RECORDS, signal);
    pages.set(contract, { items, truncated: false });
  }
  return pages;
}
function describeModelFacetPages(pages, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  const details = [];
  for (const contract of MODEL_FACET_CONTRACTS) {
    const page = pages.get(contract);
    if (page === void 0)
      continue;
    const readout = FACET_READOUT[contract];
    details.push(Object.freeze({
      contract,
      label: readout === void 0 ? contract : localizer.text(readout.labelKey),
      items: Object.freeze(page.items.slice(0, MODEL_FACET_DETAIL_LIMIT).map((item) => facetItem(contract, item, localizer))),
      truncated: page.truncated || page.items.length > MODEL_FACET_DETAIL_LIMIT
    }));
  }
  return Object.freeze(details);
}
async function readModelFacetDetails(sources, slot, scope, signal, localizer = withEnglishUiFallback(void 0, MODEL_FALLBACK_MESSAGES)) {
  return describeModelFacetPages(await readModelFacetPages(sources, slot, scope, signal), localizer);
}
function drawPrimitive(canvas, primitive, viewProjection) {
  const context = canvas.getContext("2d");
  if (context === null)
    throw new TypeError("2d canvas context is unavailable");
  const positions = primitive.positions;
  if (positions.length % 3 !== 0 || !positions.every(Number.isFinite))
    throw new TypeError("model primitive positions are malformed");
  const matrix2 = primitive.transform === void 0 ? viewProjection : multiply4x4(viewProjection, primitive.transform);
  const point = (vertex) => projectPoint(matrix2, [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]], { width: canvas.width, height: canvas.height });
  const indices = primitive.indices ?? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const vertexCount = positions.length / 3;
  if (indices.some((index) => index >= vertexCount)) {
    throw new RangeError("model primitive index is outside the position buffer");
  }
  const stroke = getComputedStyle(canvas).getPropertyValue("--mk-chart-categorical-1").trim() || "#4daafc";
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = 1;
  const edge = (from, to) => {
    const a = point(from);
    const b = point(to);
    if (a === void 0 || b === void 0)
      return;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  };
  const triangle = (first, second, third) => {
    const a = point(first);
    const b = point(second);
    const c = point(third);
    if (a === void 0 || b === void 0 || c === void 0)
      return;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.lineTo(c[0], c[1]);
    context.closePath();
    context.stroke();
  };
  if (primitive.topology === "points") {
    for (const vertex of indices) {
      const value = point(vertex);
      if (value === void 0)
        continue;
      context.fillRect(value[0] - 1, value[1] - 1, 3, 3);
    }
  } else if (primitive.topology === "lines") {
    for (let index = 0; index + 1 < indices.length; index += 2) {
      edge(indices[index], indices[index + 1]);
    }
  } else if (primitive.topology === "line-strip") {
    for (let index = 0; index + 1 < indices.length; index += 1) {
      edge(indices[index], indices[index + 1]);
    }
  } else if (primitive.topology === "triangles") {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      triangle(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else if (primitive.topology === "triangle-strip") {
    for (let index = 0; index + 2 < indices.length; index += 1) {
      triangle(indices[index], indices[index + 1], indices[index + 2]);
    }
  } else {
    for (let index = 1; index + 1 < indices.length; index += 1) {
      triangle(indices[0], indices[index], indices[index + 1]);
    }
  }
}
var MODEL_STAGE_WIDTH = 720;
var MODEL_STAGE_HEIGHT = 480;
function drawSkeleton(context, joints, viewProjection, viewport, stroke) {
  const projected = joints.map((joint) => projectPoint(viewProjection, joint.position, viewport));
  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = 1.5;
  let drawn = 0;
  for (const [index, joint] of joints.entries()) {
    const point = projected[index];
    if (point === void 0)
      continue;
    drawn += 1;
    context.beginPath();
    context.arc(point[0], point[1], 2.5, 0, Math.PI * 2);
    context.fill();
    const parent = joint.parent === void 0 ? void 0 : projected[joint.parent];
    if (parent === void 0)
      continue;
    context.beginPath();
    context.moveTo(parent[0], parent[1]);
    context.lineTo(point[0], point[1]);
    context.stroke();
  }
  context.restore();
  return drawn;
}
function themeColor(canvas, token, fallback) {
  return getComputedStyle(canvas).getPropertyValue(token).trim() || fallback;
}
async function resolveModelViewerTextures(port, references, signal) {
  const maximumBytes = 64 * 1024 * 1024;
  let remaining = maximumBytes;
  let index = 0;
  const textures = /* @__PURE__ */ new Map();
  const wanted = new Set(references.filter((item) => item.role === "texture").map((item) => item.id));
  const share = Math.max(4 * 1024 * 1024, Math.floor(maximumBytes / Math.max(1, wanted.size)));
  for (const reference of references) {
    signal?.throwIfAborted();
    if (reference.role !== "texture" || textures.has(reference.id) || remaining <= 0)
      continue;
    const textureId = `model-texture-${index++}`;
    const result = await port.read({
      kind: "logical",
      requirement: {
        id: textureId,
        logicalId: reference.id,
        role: "texture",
        scopes: [
          "sibling-directory",
          "workspace-dependency-layer",
          "current-mount",
          "enclosing-container"
        ]
      },
      maxBytes: Math.min(remaining, share),
      selection: { face: "all", mipLevel: "fit" }
    }, signal);
    signal?.throwIfAborted();
    if (result.state === "unresolved")
      continue;
    const faces = result.info.faces ?? 1;
    if (faces !== 1 && faces !== 6)
      continue;
    if (faces === 6 && result.info.width !== result.info.height)
      continue;
    const surfaces = result.state === "decoded-surfaces" ? result.surfaces : [
      {
        subresource: result.subresource ?? {
          frame: 0,
          mipLevel: 0,
          layer: 0,
          face: 0,
          slice: 0
        },
        region: result.region
      }
    ];
    const chosen = surfaces[0];
    if (chosen === void 0)
      continue;
    const { width, height } = chosen.region;
    const mipLevel = chosen.subresource.mipLevel;
    const faceBytes = width * height * 4;
    const byteLength = faceBytes * faces;
    if (surfaces.length !== faces || byteLength > remaining)
      continue;
    const rgba = new Uint8Array(byteLength);
    let valid = true;
    for (const [face, surface] of surfaces.entries()) {
      const selected = surface.subresource;
      const region = surface.region;
      if (selected.face !== face || selected.frame !== 0 || selected.mipLevel !== mipLevel || selected.layer !== 0 || selected.slice !== 0 || region.width !== width || region.height !== height || region.pixelFormat !== "rgba8" || region.rowStride < region.width * 4 || region.rowStride * (region.height - 1) + region.width * 4 > region.pixels.length) {
        valid = false;
        break;
      }
      for (let row = 0; row < region.height; row += 1) {
        const sourceOffset = row * region.rowStride;
        const targetOffset = face * faceBytes + row * region.width * 4;
        rgba.set(region.pixels.subarray(sourceOffset, sourceOffset + region.width * 4), targetOffset);
      }
    }
    if (!valid)
      continue;
    remaining -= byteLength;
    textures.set(reference.id, {
      id: textureId,
      width,
      height,
      rgba,
      ...faces === 6 ? { dimension: "cube" } : {},
      ...result.info.channelLayout === void 0 ? {} : { channelLayout: result.info.channelLayout },
      ...result.info.compression === void 0 ? {} : { compression: result.info.compression }
    });
  }
  return textures;
}
function clipNamePath(clip, ordinal) {
  const index = Number.isSafeInteger(clip.sequenceIndex) ? clip.sequenceIndex : ordinal;
  return ["animations", String(index), "name"];
}
function canRenameClips(route) {
  const operation = route.descriptor.operations.find((candidate) => candidate.id === CLIP_RENAME_OPERATION);
  if (operation === void 0 || operation.state !== "available")
    return false;
  return route.commit !== void 0 && route.authorization !== void 0;
}
function mountClipRename(toolbar, options) {
  if (!canRenameClips(options))
    return void 0;
  const field = element(toolbar, "input", { part: "model.animation-name" });
  field.type = "text";
  field.disabled = true;
  field.setAttribute("aria-label", options.localizer.text("viewer.modelAnimationName"));
  const status = element(toolbar, "output", { part: "model.animation-name-status" });
  const selectedClip = () => {
    const ordinal = options.clips.findIndex((candidate) => candidate.id === options.selector.value);
    const clip = options.clips[ordinal];
    return clip === void 0 ? void 0 : { clip, ordinal };
  };
  const syncToSelection = () => {
    const selected = selectedClip();
    field.disabled = selected === void 0;
    field.value = selected?.clip.name ?? "";
    status.textContent = "";
  };
  syncToSelection();
  options.selector.addEventListener("change", syncToSelection, {
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  const rename = async () => {
    const selected = selectedClip();
    const name = field.value.trim();
    if (selected === void 0 || name === "" || name === selected.clip.name) {
      syncToSelection();
      return;
    }
    field.disabled = true;
    status.textContent = options.localizer.text("viewer.modelAnimationRenaming");
    const refusal = await commitOperationWrite({
      descriptor: options.descriptor,
      operations: options.operations,
      ...options.commit === void 0 ? {} : { commit: options.commit },
      ...options.authorization === void 0 ? {} : { authorization: options.authorization }
    }, CLIP_RENAME_OPERATION, {
      groupId: "tree",
      path: [...clipNamePath(selected.clip, selected.ordinal)],
      key: "name",
      value: name
    }, options.signal);
    field.disabled = false;
    if (refusal !== void 0) {
      status.textContent = refusal;
      return;
    }
    status.textContent = "";
    const option = [...options.selector.options].find((candidate) => candidate.value === selected.clip.id);
    if (option !== void 0)
      option.text = name;
  };
  field.addEventListener("change", () => void rename(), {
    ...options.signal === void 0 ? {} : { signal: options.signal }
  });
  return () => {
    field.remove();
    status.remove();
  };
}
function createModelViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.model"));
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...args.gallery === void 0 ? {} : { gallery: args.gallery }
      });
      root.append(shell.root);
      scope.cleanup(() => shell.destroy());
      if (args.gallery !== void 0)
        void shell.refreshGallery(scope.signal).catch(() => void 0);
      const stage = element(shell.stage, "div", { part: "model" });
      const readout = element(stage, "output", { part: "model.readout" });
      const toolbar = element(stage, "div", { part: "model.toolbar", role: "toolbar" });
      toolbar.setAttribute("aria-label", localizer.text("viewer.modelView"));
      const canvas = element(stage, "canvas", { part: "model.canvas" });
      canvas.setAttribute("role", "img");
      canvas.setAttribute("data-model-renderer", MODEL_WIREFRAME_BACKEND);
      canvas.setAttribute("data-model-renderer-status", "unavailable");
      canvas.tabIndex = 0;
      const camera = createOrbitController();
      const gizmo = createViewGizmo(stage, { localizer, onAxis: (axis) => camera.snapTo(axis) });
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/model-scene-source");
      if (lease === void 0)
        throw new TypeError("model binding is unavailable");
      scope.lease(lease);
      setState(stage, ["loading"]);
      try {
        const sceneSource = lease.value;
        const model = await loadModelStage(sceneSource, scope.signal);
        const [facets, facetPages] = await Promise.all([
          readModelFacets(args.sources, args.slot, scope, scope.signal, localizer),
          readModelFacetPages(args.sources, args.slot, scope, scope.signal)
        ]);
        const facetDetails = describeModelFacetPages(facetPages, localizer);
        setViewerText(readout, localizer.text("viewer.modelSummary", {
          nodes: model.info.nodes,
          meshes: model.info.meshes,
          primitives: model.info.primitives,
          materials: model.info.materials,
          animations: model.info.animations,
          facets: facets.length === 0 ? "" : ` \xB7 ${facets.join(" \xB7 ")}`
        }));
        const panel = {
          rendering: shell.section("rendering", localizer.text("viewer.modelRendering"), {
            icon: "device-camera-video",
            collapsed: false
          }),
          animation: shell.section("animation", localizer.text("viewer.modelAnimation"), {
            icon: "play",
            collapsed: false
          }),
          editing: shell.section("editing", localizer.text("viewer.modelEditing"), {
            icon: "edit"
          }),
          teamColor: shell.section("team-color", localizer.text("viewer.modelTeamColor"), {
            icon: "symbol-color"
          }),
          export: shell.section("export", localizer.text("viewer.modelExport"), {
            icon: "export"
          })
        };
        const controlRow = (section, label) => {
          const grid = section.body.querySelector(`[${PART_ATTRIBUTE}="model.controls"]`) ?? element(section.body, "div", { part: "model.controls" });
          const row = element(grid, "div", { part: "model.control-row" });
          element(row, "span", { text: label, part: "model.control-label" });
          return { row, field: element(row, "span", { part: "model.control-field" }) };
        };
        const body = shell.section("properties", localizer.text("viewer.modelProperties"), {
          icon: "symbol-misc",
          collapsed: false
        }).body;
        const list = element(body, "dl", { part: "image.metadata" });
        for (const [label, value] of [
          [localizer.text("viewer.modelSceneCount"), String(model.info.scenes)],
          [localizer.text("viewer.modelNodeCount"), String(model.info.nodes)],
          [localizer.text("viewer.modelMeshCount"), String(model.info.meshes)],
          [localizer.text("viewer.modelPrimitiveCount"), String(model.info.primitives)],
          [localizer.text("viewer.modelMaterialCount"), String(model.info.materials)],
          [localizer.text("viewer.modelTextureCount"), String(model.info.textures)],
          [localizer.text("viewer.modelAnimationCount"), String(model.info.animations)],
          [localizer.text("viewer.modelUpAxis"), model.info.upAxis ?? "+y"],
          [localizer.text("viewer.modelGeometryAccess"), model.info.geometryAccess]
        ]) {
          const row = element(list, "div", { part: "metadata.row" });
          element(row, "dt", { text: label, part: "metadata.label" });
          setViewerText(element(row, "dd", { part: "metadata.value" }), value, 64);
        }
        if (model.info.bounds !== void 0) {
          const bounds = model.info.bounds;
          const boundsList = element(shell.section("bounds", localizer.text("viewer.modelBounds"), {
            icon: "symbol-ruler",
            collapsed: true
          }).body, "dl", { part: "image.metadata" });
          const extent = bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0));
          for (const [label, value] of [
            [localizer.text("viewer.modelBoundsMinimum"), describeModelValue(bounds.min)],
            [localizer.text("viewer.modelBoundsMaximum"), describeModelValue(bounds.max)],
            [localizer.text("viewer.modelBoundsExtent"), describeModelValue(extent)]
          ]) {
            const row = element(boundsList, "div", { part: "metadata.row" });
            element(row, "dt", { text: label, part: "metadata.label" });
            setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
          }
        }
        mountContributedSections(shell, options.sections, args, (unmount) => scope.cleanup(unmount));
        for (const spec of MODEL_PANEL_SECTIONS) {
          const page = facetPages.get(spec.contract);
          if (page === void 0)
            continue;
          const records = spec.kind === void 0 ? page.items : page.items.filter((item) => typeof item === "object" && item !== null && item.kind === spec.kind);
          if (records.length === 0)
            continue;
          const section = shell.section(spec.id, `${spec.title} (${records.length})`, {
            icon: spec.icon,
            collapsed: true
          });
          for (const record of records) {
            const rows = modelRecordRows(record);
            if (rows.length === 0)
              continue;
            const named = record;
            const entry = element(section.body, "details", { part: "model.facet-item" });
            element(entry, "summary", {
              text: String((typeof named.name === "string" && named.name !== "" ? named.name : void 0) ?? named.id ?? spec.title)
            });
            const list2 = element(entry, "dl", { part: "image.metadata" });
            for (const [key, value] of rows) {
              const row = element(list2, "div", { part: "metadata.row" });
              element(row, "dt", { text: key, part: "metadata.label" });
              setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
            }
          }
        }
        const diagnostics = shell.section("diagnostics", localizer.text("viewer.modelDiagnosticsSection"), { icon: "warning", collapsed: true });
        const diagnosticsList = element(diagnostics.body, "dl", { part: "image.metadata" });
        const diagnosticRow = (label, value) => {
          const row = element(diagnosticsList, "div", { part: "metadata.row" });
          element(row, "dt", { text: label, part: "metadata.label" });
          setViewerText(element(row, "dd", { part: "metadata.value" }), value, 160);
        };
        for (const detail of facetDetails) {
          diagnosticRow(detail.label, detail.items.join(" \xB7 ") + (detail.truncated ? " \u2026" : ""));
        }
        const sceneTotals = model.primitives.reduce((totals, primitive) => ({
          vertices: totals.vertices + Math.floor(primitive.positions.length / 3),
          triangles: totals.triangles + Math.floor((primitive.indices?.length ?? primitive.positions.length / 3) / 3)
        }), { vertices: 0, triangles: 0 });
        const boneCount = facetPages.get("common.view/model-skeleton-source")?.items.length ?? 0;
        const resourceCount = facetPages.get("common.view/model-resource-refs-source")?.items.length ?? 0;
        args.status?.set([
          {
            id: "scene",
            icon: "symbol-misc",
            text: localizer.text("viewer.modelSceneCounts", {
              meshes: model.info.meshes,
              materials: model.info.materials,
              animations: model.info.animations
            }),
            align: "start"
          },
          {
            id: "geometry",
            icon: "symbol-method",
            text: `${sceneTotals.vertices} v \xB7 ${sceneTotals.triangles} tri`,
            align: "start"
          },
          ...boneCount === 0 ? [] : [
            {
              id: "rig",
              icon: "type-hierarchy",
              text: `${boneCount} bones`,
              align: "start"
            }
          ],
          ...resourceCount === 0 ? [] : [
            {
              id: "resources",
              icon: "file-media",
              text: `${resourceCount} textures`,
              align: "start"
            }
          ]
        ]);
        scope.cleanup(() => args.status?.clear());
        if (model.primitive === void 0) {
          canvas.remove();
          gizmo.destroy();
          toolbar.remove();
          element(stage, "p", {
            part: "viewer.empty",
            text: localizer.text("viewer.modelGeometryUnavailable")
          });
        } else {
          const viewport = { width: MODEL_STAGE_WIDTH, height: MODEL_STAGE_HEIGHT };
          const view = canvas.ownerDocument.defaultView;
          const measureViewport = () => {
            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
              return false;
            const density = Math.min(2, view?.devicePixelRatio ?? 1);
            const scale = Math.min(density, 2048 / rect.width, 2048 / rect.height);
            const width = Math.max(1, Math.round(rect.width * scale));
            const height = Math.max(1, Math.round(rect.height * scale));
            if (viewport.width === width && viewport.height === height)
              return false;
            viewport.width = width;
            viewport.height = height;
            return true;
          };
          let provider;
          if (options.renderer !== void 0) {
            try {
              const acquisition = await options.renderer.acquire({
                outputKind: "rgba8",
                signal: scope.signal
              });
              if (acquisition.state === "resolved") {
                provider = acquisition.lease.renderer;
                scope.cleanup(() => acquisition.lease.release());
                canvas.setAttribute("data-model-renderer", modelRendererBackend(provider.rendererId));
                canvas.setAttribute("data-model-renderer-id", provider.rendererId);
                canvas.setAttribute("data-model-renderer-status", "resolved");
              } else {
                canvas.setAttribute("data-model-renderer-status", "unresolved");
                const reason = acquisition.diagnostics.at(-1);
                if (reason !== void 0) {
                  canvas.setAttribute("data-model-renderer-diagnostic", reason.code);
                }
              }
            } catch (error) {
              canvas.setAttribute("data-model-renderer-status", "unresolved");
              canvas.setAttribute("data-model-renderer-diagnostic", "x3.ui/renderer-acquire-threw");
              canvas.setAttribute("data-model-renderer-detail", error instanceof Error ? error.message : String(error));
            }
          }
          const materialRefs = facetPages.get("common.view/model-material-source")?.items ?? [];
          const resourceRefs = facetPages.get("common.view/model-resource-refs-source")?.items ?? [];
          const boneBindings = facetPages.get("common.view/model-skeleton-source")?.items ?? [];
          const clips = facetPages.get("common.view/model-animation-source")?.items ?? [];
          const projection = { ...model, skeleton: boneBindings };
          const correction = upAxisCorrection(model.info.upAxis);
          const orient = (sampled) => correction === void 0 ? sampled : {
            ...sampled,
            primitives: sampled.primitives.map((one) => orientPrimitive(one, correction))
          };
          let player = createModelSceneSampler(projection, { signal: scope.signal });
          let scene = orient(player.sample(0, scope.signal));
          let selectedPrimitive;
          let activeClip;
          let timeSeconds = 0;
          let teamColor = [0.851, 0.078, 0.059];
          const restFraming = framePrimitives(scene.primitives);
          const playbackStatus = element(stage, "output", { part: "model.playback-status" });
          const showDiagnostics = () => {
            setViewerText(playbackStatus, player.diagnostics.map((item) => item.message).join(" "));
            canvas.setAttribute("data-model-pose-diagnostics", player.diagnostics.map((item) => item.code).join(" "));
          };
          showDiagnostics();
          let texels = /* @__PURE__ */ new Map();
          if (options.textures !== void 0 && provider !== void 0 && resourceRefs.length > 0) {
            texels = await options.textures(args.descriptor, resourceRefs, scope.signal).catch(() => /* @__PURE__ */ new Map());
          }
          const surfaces = sceneMaterials(materialRefs, texels, true);
          canvas.setAttribute("data-model-textures", String(surfaces.textures.length));
          diagnosticRow(localizer.text("viewer.modelRendererLabel"), `${canvas.getAttribute("data-model-renderer") ?? ""} \xB7 ${canvas.getAttribute("data-model-renderer-status") ?? ""}${provider === void 0 ? "" : ` \xB7 ${provider.rendererId}`}`);
          diagnosticRow(localizer.text("viewer.modelTextureStatus"), `${surfaces.textures.length} / ${resourceRefs.filter((item) => item.role === "texture").length}`);
          canvas.setAttribute("data-model-skeleton", String(scene.joints.length));
          let skeletonVisible = scene.joints.length > 0;
          const framing = () => restFraming;
          let generation = 0;
          const drawWireframe = () => {
            measureViewport();
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const placement = modelCamera(framing(), camera.basis(), camera.pose.distanceScale, viewport);
            for (const primitive of scene.primitives)
              if (selectedPrimitive === void 0 || primitive.id === selectedPrimitive)
                drawPrimitive(canvas, primitive, placement.viewProjection);
            const context = canvas.getContext("2d");
            if (context !== null && skeletonVisible)
              drawSkeleton(context, scene.joints, placement.viewProjection, viewport, themeColor(canvas, "--mk-chart-categorical-3", "#f0a04b"));
            canvas.setAttribute("data-model-animation-time", String(timeSeconds));
          };
          let renderBusy = false;
          let redrawPending = false;
          let pendingFrame;
          const redraw = () => {
            measureViewport();
            const pose = camera.pose;
            gizmo.update(pose.yaw, pose.pitch);
            const request = generation;
            if (scope.signal.aborted)
              return;
            if (renderBusy) {
              redrawPending = true;
              return;
            }
            try {
              scene = orient(player.sample(timeSeconds, scope.signal));
            } catch (error) {
              setViewerText(playbackStatus, error instanceof Error ? error.message : String(error));
              canvas.setAttribute("data-model-pose-diagnostics", "common.model/pose-failed");
              return;
            }
            const drawnTime = timeSeconds;
            const joints = scene.joints;
            const primitives = scene.primitives.filter((item) => selectedPrimitive === void 0 || item.id === selectedPrimitive);
            canvas.setAttribute("data-model-primitives", String(primitives.length));
            canvas.setAttribute("data-model-skeleton", String(joints.length));
            if (provider === void 0) {
              drawWireframe();
              return;
            }
            measureViewport();
            const placement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport);
            const renderer = provider;
            renderBusy = true;
            pendingFrame = (async () => {
              try {
                const frame = await renderer.render(modelSceneRequest({
                  primitives,
                  camera: placement,
                  viewport,
                  materials: surfaces.materials,
                  textures: surfaces.textures,
                  clearColor: [0, 0, 0, 0],
                  light: MODEL_KEY_LIGHT,
                  materialContext: {
                    time: drawnTime,
                    sequenceTime: drawnTime,
                    teamColor,
                    ...activeClip?.sequenceIndex === void 0 ? {} : { sequenceIndex: activeClip.sequenceIndex }
                  },
                  signal: scope.signal
                }));
                if (request !== generation || scope.signal.aborted)
                  return;
                const context = canvas.getContext("2d");
                if (context === null)
                  throw new TypeError("2d canvas context is unavailable");
                const expected = frame.width * frame.height * 4;
                if (frame.rgba.length !== expected) {
                  throw new TypeError(`renderer returned ${frame.rgba.length} bytes for a ${frame.width}x${frame.height} frame`);
                }
                canvas.width = frame.width;
                canvas.height = frame.height;
                const pixels = new Uint8ClampedArray(expected);
                pixels.set(frame.rgba);
                context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
                canvas.setAttribute("data-model-animation-time", String(drawnTime));
                if (skeletonVisible && joints.length > 0) {
                  drawSkeleton(context, joints, placement.viewProjection, { width: frame.width, height: frame.height }, themeColor(canvas, "--mk-chart-categorical-3", "#f0a04b"));
                }
              } catch (error) {
                if (scope.signal.aborted)
                  return;
                provider = void 0;
                canvas.setAttribute("data-model-renderer", MODEL_WIREFRAME_BACKEND);
                canvas.removeAttribute("data-model-renderer-id");
                canvas.setAttribute("data-model-renderer-status", "failed");
                canvas.setAttribute("data-model-renderer-diagnostic", "x3.ui/renderer-frame-failed");
                canvas.setAttribute("data-model-renderer-detail", error instanceof Error ? error.message : String(error));
                canvas.setAttribute("data-model-textures", "0");
                drawWireframe();
              } finally {
                renderBusy = false;
                if (redrawPending && !scope.signal.aborted) {
                  redrawPending = false;
                  redraw();
                }
              }
            })();
          };
          scope.cleanup(async () => {
            await pendingFrame;
          });
          scope.cleanup(camera.onChange(redraw));
          camera.attach(canvas, scope.signal);
          const button = (parent, label, title, run) => {
            const node = element(parent, "button", { part: "operations.button", text: label });
            node.setAttribute("type", "button");
            node.title = title;
            node.addEventListener("click", run, { signal: scope.signal });
            return node;
          };
          const viewRow = controlRow(panel.rendering, localizer.text("viewer.modelView3d")).field;
          button(viewRow, localizer.text("viewer.reset"), localizer.text("viewer.resetCamera"), () => camera.reset());
          button(viewRow, "\u2212", localizer.text("viewer.zoomOut"), () => camera.zoom(1));
          button(viewRow, "+", localizer.text("viewer.zoomIn"), () => camera.zoom(-1));
          if (scene.joints.length > 0) {
            const toggle = button(viewRow, localizer.text("viewer.modelBones"), localizer.text("viewer.modelSkeletonOverlay"), () => {
              skeletonVisible = !skeletonVisible;
              toggle.setAttribute("aria-pressed", String(skeletonVisible));
              canvas.setAttribute("data-model-skeleton-visible", String(skeletonVisible));
              redraw();
            });
            toggle.setAttribute("aria-pressed", String(skeletonVisible));
            canvas.setAttribute("data-model-skeleton-visible", String(skeletonVisible));
          }
          if (materialRefs.length > 0) {
            const swatchRow = controlRow(panel.teamColor, localizer.text("viewer.modelTeamColorCustom"));
            const picker = element(swatchRow.field, "input", {
              part: "model.team-color"
            });
            picker.type = "color";
            picker.value = "#d9140f";
            picker.setAttribute("aria-label", localizer.text("viewer.modelTeamColorCustom"));
            const applyTeamColor = (hex) => {
              const value = /^#([0-9a-f]{6})$/iu.exec(hex)?.[1];
              if (value === void 0)
                return;
              teamColor = Object.freeze([
                Number.parseInt(value.slice(0, 2), 16) / 255,
                Number.parseInt(value.slice(2, 4), 16) / 255,
                Number.parseInt(value.slice(4, 6), 16) / 255
              ]);
              canvas.setAttribute("data-model-team-color", `#${value.toLowerCase()}`);
              generation++;
              redraw();
            };
            picker.addEventListener("input", () => applyTeamColor(picker.value), {
              signal: scope.signal
            });
            const presets = controlRow(panel.teamColor, localizer.text("viewer.modelTeamColorPresets")).field;
            presets.setAttribute("role", "group");
            for (const preset of MODEL_TEAM_COLOR_PRESETS) {
              const swatch = button(presets, "", preset, () => {
                picker.value = preset;
                applyTeamColor(preset);
              });
              swatch.style.setProperty("background", preset);
              swatch.setAttribute("aria-label", preset);
            }
            canvas.setAttribute("data-model-team-color", "#d9140f");
          }
          if (model.primitiveIds.length > 1) {
            const selector = element(controlRow(panel.rendering, localizer.text("viewer.modelPrimitive")).field, "select", { part: "model.primitive-selector" });
            selector.setAttribute("aria-label", localizer.text("viewer.modelPrimitive"));
            const all = element(selector, "option", {
              text: localizer.text("viewer.modelAllPrimitives")
            });
            all.value = "";
            for (const id of model.primitiveIds) {
              const option = element(selector, "option", { text: id });
              option.value = id;
            }
            selector.addEventListener("change", () => {
              generation++;
              selectedPrimitive = selector.value || void 0;
              redraw();
            }, { signal: scope.signal });
          }
          const conversions = modelConversions(args.descriptor);
          if (conversions.length > 0) {
            const exportRow = controlRow(panel.export, localizer.text("viewer.modelConvert"));
            const convert = element(exportRow.field, "select", {
              part: "model.convert-selector"
            });
            convert.setAttribute("aria-label", localizer.text("viewer.modelConvert"));
            const prompt = element(convert, "option", {
              text: localizer.text("viewer.modelConvert")
            });
            prompt.value = "";
            for (const preset of conversions) {
              const option = element(convert, "option", { text: preset.form.label });
              option.value = preset.form.id;
            }
            const convertStatus = element(exportRow.field, "output", {
              part: "model.convert-status"
            });
            const writeFiles = options.exportBytes;
            if (writeFiles === void 0) {
              convert.disabled = true;
              convertStatus.textContent = localizer.text("viewer.modelConvertUnavailable");
            } else
              convert.addEventListener("change", () => {
                const preset = conversions.find((item) => item.form.id === convert.value);
                convert.value = "";
                if (preset === void 0)
                  return;
                convertStatus.textContent = localizer.text("viewer.modelConverting", {
                  preset: preset.form.label
                });
                void (async () => {
                  try {
                    const result = await args.operations.invoke(preset.form.handlerId, preset.input, { signal: scope.signal });
                    if (result.state !== "ok")
                      throw new Error(result.reason);
                    const output = result.output;
                    if (output.kind !== "bytes" || !(output.value instanceof Uint8Array))
                      throw new Error(`the codec answered ${output.kind}, not bytes`);
                    const base = options.exportBaseName?.(args.descriptor) ?? "model";
                    const writes = preset.form.writes;
                    if (writes === void 0)
                      throw new Error(`${preset.form.id} declares no write target`);
                    const outcome = await writeFiles([
                      {
                        name: convertedFileName(base, preset.form.id, writes.extension),
                        mediaType: writes.mediaType,
                        bytes: output.value
                      }
                    ], scope.signal);
                    convertStatus.textContent = outcome.state === "written" ? localizer.text("viewer.modelConverted", { preset: preset.form.label }) : outcome.reason ?? outcome.state;
                  } catch (error) {
                    convertStatus.textContent = error instanceof Error ? error.message : String(error);
                  }
                })();
              }, { signal: scope.signal });
          }
          if (clips.length > 0) {
            const sequenceField = controlRow(panel.animation, localizer.text("viewer.modelAnimation")).field;
            const selector = element(sequenceField, "select", {
              part: "model.animation-selector"
            });
            const renameClip = mountClipRename(controlRow(panel.editing, localizer.text("viewer.modelAnimationRename")).field, {
              localizer,
              descriptor: args.descriptor,
              operations: args.operations,
              ...args.commit === void 0 ? {} : { commit: args.commit },
              ...args.authorization === void 0 ? {} : { authorization: args.authorization },
              selector,
              clips,
              signal: scope.signal
            });
            if (renameClip !== void 0)
              scope.cleanup(renameClip);
            selector.setAttribute("aria-label", localizer.text("viewer.modelAnimation"));
            const rest = element(selector, "option", {
              text: localizer.text("viewer.modelRestPose")
            });
            rest.value = "";
            for (const clip of clips) {
              const option = element(selector, "option", { text: clip.name });
              option.value = clip.id;
            }
            const playbackField = controlRow(panel.animation, localizer.text("viewer.modelPlayback")).field;
            const seek = element(controlRow(panel.animation, localizer.text("viewer.modelAnimationTime")).field, "input", { part: "model.animation-seek" });
            seek.type = "range";
            seek.min = "0";
            seek.max = "0";
            seek.step = "0.001";
            seek.value = "0";
            seek.disabled = true;
            seek.setAttribute("aria-label", localizer.text("viewer.modelAnimationTime"));
            let frameId = 0;
            let playing = false;
            let duration = 0;
            let startedAt = 0;
            const toggle = button(playbackField, "\u25B6", localizer.text("viewer.playPause"), () => {
              if (duration <= 0)
                return;
              playing = !playing;
              if (playing) {
                if (timeSeconds >= duration)
                  timeSeconds = 0;
                startedAt = performance.now() - timeSeconds * 1e3;
                frameId = requestAnimationFrame(tick);
              } else
                cancelAnimationFrame(frameId);
              toggle.setAttribute("aria-pressed", String(playing));
            });
            toggle.setAttribute("aria-pressed", "false");
            const stop = () => {
              playing = false;
              cancelAnimationFrame(frameId);
              toggle.setAttribute("aria-pressed", "false");
            };
            const tick = (now) => {
              if (!playing || scope.signal.aborted)
                return;
              timeSeconds = Math.min(duration, (now - startedAt) / 1e3);
              seek.value = String(timeSeconds);
              redraw();
              if (timeSeconds < duration)
                frameId = requestAnimationFrame(tick);
              else
                stop();
            };
            selector.addEventListener("change", () => {
              stop();
              try {
                const clip = clips.find((item) => item.id === selector.value);
                const nextPlayer = createModelSceneSampler(projection, {
                  signal: scope.signal,
                  ...clip === void 0 ? {} : { clip }
                });
                player = nextPlayer;
                activeClip = clip;
                duration = modelAnimationPlaybackDuration(clip);
                timeSeconds = 0;
                generation++;
                seek.max = String(duration);
                seek.value = "0";
                seek.disabled = duration <= 0;
                canvas.setAttribute("data-model-animation", clip?.id ?? "");
                showDiagnostics();
                redraw();
              } catch (error) {
                setViewerText(playbackStatus, error instanceof Error ? error.message : String(error));
              }
            }, { signal: scope.signal });
            seek.addEventListener("input", () => {
              stop();
              generation++;
              timeSeconds = Number(seek.value);
              redraw();
            }, { signal: scope.signal });
            scope.cleanup(stop);
          }
          scope.cleanup(() => gizmo.destroy());
          const resizeObserver = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(() => {
            if (measureViewport())
              redraw();
          });
          resizeObserver?.observe(canvas);
          scope.cleanup(() => resizeObserver?.disconnect());
          redraw();
        }
        for (const section of Object.values(panel)) {
          if (section.body.childElementCount === 0)
            section.root.remove();
        }
        if (toolbar.childElementCount === 0)
          toolbar.remove();
        setState(stage, []);
      } catch (error) {
        setState(stage, ["error"]);
        canvas.remove();
        element(stage, "p", {
          part: "viewer.empty",
          text: localizer.text("viewer.modelError", {
            reason: error instanceof Error ? error.message : String(error)
          })
        });
      }
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset["revision"] = descriptor.revision;
      });
    }
  });
}
var modelViewer = createModelViewer();

export {
  snapshotJson,
  sampleTrackValue,
  composeTrsMatrix,
  multiplyMat4,
  DEFAULT_MODEL_ANIMATION_BUDGET,
  snapshotModelAnimations,
  DEFAULT_MODEL_SKELETON_BUDGET,
  snapshotModelSkeleton,
  createModelSkeletonNodes,
  createModelSceneSampler,
  MODEL_MAXIMUM_PRIMITIVE_BYTES,
  MODEL_MAXIMUM_PRIMITIVES,
  loadModelStage,
  MODEL_FIELD_OF_VIEW,
  MODEL_DEFAULT_BASE_COLOR,
  MODEL_KEY_LIGHT,
  framePrimitive,
  framePrimitives,
  modelCamera,
  multiply4x4,
  projectPoint,
  materialColorFor,
  baseColorResourceOf,
  sceneMaterials,
  modelSceneRequest,
  skeletonJoints,
  mountFieldEditTarget,
  fieldWriteRefusal,
  commitOperationWrite,
  mountInlineField,
  createOrbitController,
  GIZMO_SIZE,
  createViewGizmo,
  modelAnimationPlaybackDuration,
  MODEL_RENDERER_BACKENDS,
  MODEL_WIREFRAME_BACKEND,
  modelConversions,
  modelRendererBackend,
  MODEL_FACET_CONTRACTS,
  readModelFacets,
  readModelFacetPages,
  describeModelFacetPages,
  readModelFacetDetails,
  resolveModelViewerTextures,
  clipNamePath,
  canRenameClips,
  createModelViewer,
  modelViewer
};
