import {
  crc32Range
} from "./chunk-R3U752LL.js";
import {
  compressPortable
} from "./chunk-QQJVD7VT.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

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

// ../MODDING/modkit-core/packages/scene/dist/model/billboards.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

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
  const m = (at2) => matrix2[at2] ?? (at2 % 5 === 0 ? 1 : 0);
  const determinant = m(0) * (m(5) * m(10) - m(9) * m(6)) - m(4) * (m(1) * m(10) - m(9) * m(2)) + m(8) * (m(1) * m(6) - m(5) * m(2));
  const sx = (determinant < 0 ? -1 : 1) * Math.hypot(m(0), m(1), m(2));
  const sy = Math.hypot(m(4), m(5), m(6));
  const sz = Math.hypot(m(8), m(9), m(10));
  const tiny = 1e-12 * Math.max(1, Math.abs(sx), sy, sz);
  const unit3 = (scale, at2) => Math.abs(scale) <= tiny ? void 0 : [m(at2) / scale, m(at2 + 1) / scale, m(at2 + 2) / scale];
  let x = unit3(sx, 0);
  let y = unit3(sy, 4);
  let z = unit3(sz, 8);
  if (x === void 0 && y === void 0 && z === void 0)
    [x, y, z] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  if (x !== void 0 && y === void 0 && z === void 0)
    y = perpendicular(x);
  else if (y !== void 0 && z === void 0 && x === void 0)
    z = perpendicular(y);
  else if (z !== void 0 && x === void 0 && y === void 0)
    x = perpendicular(z);
  if (z === void 0)
    z = cross(x, y);
  if (x === void 0)
    x = cross(y, z);
  if (y === void 0)
    y = cross(z, x);
  return {
    translation: [m(12), m(13), m(14)],
    scaling: [sx, sy, sz],
    rotation: quaternionFromRotationMatrix([...x, ...y, ...z])
  };
}
function cross(a, b) {
  const c = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const length = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / length, c[1] / length, c[2] / length];
}
function perpendicular(v) {
  return cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
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
var AIM_LOCKS = ["free", "frame-x", "frame-y", "frame-z", "own-x", "own-y"];
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
    } else if (item.mode === "aim") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "aim", "lock", "correction", "rootCorrection"].includes(key)) || item.aim !== "view" && item.aim !== "eye" || !AIM_LOCKS.includes(item.lock))
        throw new TypeError("invalid aim billboard constraint");
      if (item.correction !== void 0)
        rotation(item.correction);
      if (item.rootCorrection !== void 0)
        rotation(item.rootCorrection);
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
function billboardCameraRotation(view) {
  const inverse = invertMatrix4OrNull(matrix(view));
  if (inverse === null)
    throw new TypeError("billboard camera view is singular");
  return decomposeMatrix4(inverse).rotation;
}
function applyModelBillboards(pose, bindings, constraints, cameraRotation, hierarchyFrame, maxBytes, signal, cameraPosition) {
  signal?.throwIfAborted();
  const inverseConstraints = constraints.filter((item) => item.mode === "inverse-camera" || item.mode === "aim");
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
  const cameraInFrame = multiplyQuat(invertQuat(decomposeMatrix4(matrix(hierarchyFrame)).rotation), rotation(cameraRotation));
  const frameInverse = invertMatrix4OrNull(matrix(hierarchyFrame));
  const eye = cameraPosition === void 0 || frameInverse === null ? void 0 : transformPoint(frameInverse, position(cameraPosition));
  const camera = {
    forward: rotateVector(cameraInFrame, [0, 0, -1]),
    up: rotateVector(cameraInFrame, [0, 1, 0]),
    axisX: rotateVector(cameraInFrame, [1, 0, 0]),
    ...eye === void 0 ? {} : { eye }
  };
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
        let facing;
        if (constraint.mode === "inverse-camera") {
          facing = multiplyQuat(parentInverse, cameraInFrame);
          for (const basis of constraint.basisRotations)
            facing = multiplyQuat(facing, rotation(basis));
          facing = multiplyQuat(facing, localTransform.rotation);
        } else {
          const aimed = aimRotation(constraint, camera, world, parent === null, localTransform.rotation);
          if (aimed !== void 0)
            facing = multiplyQuat(parentInverse, aimed);
        }
        if (facing !== void 0) {
          const billboardLocal = rotationTranslationScaleOriginMatrix(normalizeQuat(facing), localTransform.translation, localTransform.scaling, [0, 0, 0]);
          world = adjustedParent === void 0 ? billboardLocal : multiplyMatrix4(adjustedParent, billboardLocal);
        }
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
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross2 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
};
var unit2 = (a, b) => {
  const length = Math.hypot(a, b);
  return length > 0 ? [a / length, b / length] : [a, b];
};
function rotateVector(q, v) {
  const u = [q[0], q[1], q[2]];
  const c1 = cross2(u, v);
  const t = [c1[0] * 2, c1[1] * 2, c1[2] * 2];
  const c2 = cross2(u, t);
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]];
}
function transformPoint(m, p) {
  const row = (r) => (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0);
  return [row(0), row(1), row(2)];
}
var AXIS_EPSILON = 2384185791015625e-22;
var DEGENERATE_LENGTH_SQUARED = 1e-4;
var ORTHONORMAL_TOLERANCE = 1e-3;
function aimRotation(constraint, camera, world, root, spin) {
  let d;
  if (constraint.aim === "eye") {
    if (camera.eye === void 0)
      return void 0;
    d = unit(sub([world[12] ?? 0, world[13] ?? 0, world[14] ?? 0], camera.eye));
  } else
    d = camera.forward;
  if (d.every((component) => Math.abs(component) < AXIS_EPSILON))
    return void 0;
  let rows = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  switch (constraint.lock) {
    case "frame-x": {
      let v = [0, d[1], d[2]];
      if (d[1] * d[1] + d[2] * d[2] < DEGENERATE_LENGTH_SQUARED)
        v = camera.axisX;
      v = unit(v);
      const p = unit2(-v[2], v[1]);
      rows = [[1, 0, 0], v, [0, p[0], p[1]]];
      break;
    }
    case "frame-y": {
      let v = [d[0], 0, d[2]];
      if (d[2] * d[2] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(-v[2], v[0]);
      rows = [v, [0, 1, 0], [p[0], 0, p[1]]];
      break;
    }
    case "frame-z": {
      let v = [d[0], d[1], 0];
      if (d[1] * d[1] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(v[1], -v[0]);
      rows = [[p[0], p[1], 0], v, [0, 0, 1]];
      break;
    }
    case "own-x":
    case "own-y": {
      const column = constraint.lock === "own-x" ? 0 : 4;
      const a = unit([world[column] ?? 0, world[column + 1] ?? 0, world[column + 2] ?? 0]);
      const c = cross2(a, d);
      if (dot(c, c) < DEGENERATE_LENGTH_SQUARED)
        return void 0;
      const cn = unit(c);
      rows = constraint.lock === "own-x" ? [a, cn, cross2(a, cn)] : [cn, cross2(a, cn), a];
      break;
    }
    case "free": {
      const e = cross2(d, camera.up);
      if (dot(e, e) < DEGENERATE_LENGTH_SQUARED)
        break;
      const en = unit(e);
      rows = [en, d, unit(cross2(en, d))];
      break;
    }
  }
  if (rows.some((row) => Math.abs(dot(row, row) - 1) >= ORTHONORMAL_TOLERANCE))
    return void 0;
  let q = normalizeQuat(quaternionFromRotationMatrix([...rows[0], ...rows[1], ...rows[2]]));
  if (root) {
    q = multiplyQuat(q, spin);
    if (constraint.rootCorrection !== void 0)
      q = multiplyQuat(q, rotation(constraint.rootCorrection));
  } else if (constraint.correction !== void 0)
    q = multiplyQuat(q, rotation(constraint.correction));
  return q;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/model/animation.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

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

// ../MODDING/modkit-core/packages/codec-kit/dist/model/animation.js
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
      for (let at2 = time + (Math.floor((fromSeconds - time) / period) + 1) * period; at2 <= toSeconds && found.length < MAX_EVENT_OCCURRENCES; at2 += period)
        if (at2 > fromSeconds)
          found.push({ event, atSeconds: at2 });
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

// ../MODDING/modkit-core/packages/scene/dist/model/sampler.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/model/skeleton.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
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
      const transformed = transformPoint2(matrix2, px, py, pz);
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
function transformPoint2(matrix2, x, y, z) {
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
function skinVertices(primitive, slots) {
  const authored = present(primitive.boneIndices, "skin indices");
  const source = present(primitive.boneWeights, "skin weights");
  const identity = slots.size;
  const joints = identity < 256 ? new Uint8Array(authored.length) : new Uint16Array(authored.length);
  const weights = new Float32Array(authored.length);
  for (let vertex = 0; vertex < authored.length; vertex += 4) {
    let sum = 0;
    for (let influence = 0; influence < 4; influence++)
      sum += source[vertex + influence];
    for (let influence = 0; influence < 4; influence++) {
      const weight = source[vertex + influence];
      joints[vertex + influence] = weight > 0 ? present(slots.get(authored[vertex + influence]), "skin slot") : identity;
      weights[vertex + influence] = weight > 0 ? weight / sum : 0;
    }
    if (sum === 0)
      weights[vertex] = 1;
  }
  return { joints, weights };
}
function skinPalette(bones, slots) {
  const palette = new Float32Array((slots.size + 1) * 16);
  const filled = new Uint8Array(slots.size);
  for (const bone of bones) {
    const slot = slots.get(bone.boneIndex);
    if (slot === void 0)
      continue;
    const matrix2 = bone.skinningMatrix;
    if (filled[slot] === 1 || matrix2?.length !== 16 || !matrix2.every(Number.isFinite))
      throw new TypeError("skin needs a unique explicit inverse-bind pose for each bone");
    palette.set(matrix2, slot * 16);
    filled[slot] = 1;
  }
  if (filled.includes(0))
    throw new TypeError("skin pose is incomplete");
  palette.set(IDENTITY, slots.size * 16);
  for (let index = 0; index < palette.length; index++)
    if (!Number.isFinite(palette[index]))
      throw new RangeError("deformed skin exceeds finite float range");
  return palette;
}
function present(value, label) {
  if (value === void 0)
    throw new TypeError(`missing scene ${label}`);
  return value;
}
function morphPrimitive(primitive, weights) {
  const targets = present(primitive.morphTargets, "morph targets");
  const positions = Float32Array.from(primitive.positions);
  const normals = primitive.normals === void 0 ? void 0 : Float32Array.from(primitive.normals);
  let normalsMoved = false;
  for (let target = 0; target < targets.length; target++) {
    const weight = weights[target] ?? 0;
    if (weight === 0)
      continue;
    const deltas = present(targets[target], "morph target");
    for (let index = 0; index < positions.length; index++)
      positions[index] = (positions[index] ?? 0) + weight * (deltas.positions[index] ?? 0);
    if (normals !== void 0 && deltas.normals !== void 0) {
      normalsMoved = true;
      for (let index = 0; index < normals.length; index++)
        normals[index] = (normals[index] ?? 0) + weight * (deltas.normals[index] ?? 0);
    }
  }
  if (normals !== void 0 && normalsMoved)
    for (let index = 0; index + 2 < normals.length; index += 3) {
      const x = normals[index] ?? 0;
      const y = normals[index + 1] ?? 0;
      const z = normals[index + 2] ?? 0;
      const length = Math.hypot(x, y, z);
      if (length > 0) {
        normals[index] = x / length;
        normals[index + 1] = y / length;
        normals[index + 2] = z / length;
      }
    }
  if (!positions.every(Number.isFinite))
    throw new RangeError("morphed positions exceed finite float range");
  const { bounds: _bounds, ...rest } = primitive;
  return { ...rest, positions, ...normals === void 0 ? {} : { normals } };
}
function drawn(primitive) {
  if (primitive.morphTargets === void 0 && primitive.hidden === void 0)
    return primitive;
  const { morphTargets: _targets, hidden: _hidden, ...rest } = primitive;
  return rest;
}
function createModelSceneSampler(projection, options = {}) {
  const { signal, clip } = options;
  const gpuSkinning = options.skinning === "gpu";
  const poseTime = options.poseTime ?? 0;
  if (!Number.isFinite(poseTime))
    throw new TypeError("pose reference time must be finite");
  const maxBytes = options.maxBytes ?? 134217728;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("invalid scene maxBytes");
  const budget = { maxDepth: 64, maxNodes: 1e6, maxBytes };
  const owned = snapshotJson({ nodes: projection.nodes, meshes: projection.meshes }, budget, signal);
  const bindings = snapshotModelSkeleton(projection.skeleton ?? [], budget, signal);
  const stated = new Set((options.billboards ?? []).map((item) => item.nodeId));
  const unusable = [];
  const declared = projection.nodes.flatMap((node) => {
    if (node.billboard === void 0 || stated.has(node.id))
      return [];
    const bound = bindings.some((bone) => bone.nodeId === node.id);
    if (node.billboard.mode === "face-camera" ? bound : !bound) {
      unusable.push(node.id);
      return [];
    }
    return [{ nodeId: node.id, ...node.billboard }];
  });
  const billboards = snapshotModelBillboards([...options.billboards ?? [], ...declared], maxBytes, signal);
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
  if (unusable.length > 0)
    report("billboard-node-unsupported", `Nodes ${unusable.join(", ")} declare a camera rule their binding cannot take; authored poses are retained.`);
  if (billboards.some((item) => item.mode === "inverse-camera" || item.mode === "aim") && billboardCamera === void 0 && options.billboardCameraPerSample !== true)
    report("billboard-camera-required", "Node billboard constraints require an explicit camera orientation; authored poses are retained.");
  if (billboards.some((item) => item.mode === "face-camera") && billboardPosition === void 0 && options.billboardCameraPerSample !== true)
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
  const morphs = clip?.channels.filter((channel) => channel.kind === "weights") ?? [];
  if ((clip?.channels.length ?? 0) > trs.length + visibility.length + morphs.length || (clip?.unsupportedChannels ?? 0) > 0)
    report("animation-channels-unrendered", "Some animation channels are not bone TRS, primitive visibility or morph weights; their effects are not rendered.");
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
  const gpuSkins = /* @__PURE__ */ new Map();
  const hierarchySlots = /* @__PURE__ */ new Map();
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
      if (gpuSkinning && primitive.normals !== void 0 && primitive.tangents !== void 0) {
        workingBytes += primitive.positions.length * 8;
        if (workingBytes > maxBytes)
          throw new RangeError("skin deformation exceeds maxBytes");
        let slots = hierarchySlots.get(hierarchyId);
        if (slots === void 0)
          hierarchySlots.set(hierarchyId, slots = new Map(bones.map((bone, slot) => [bone.boneIndex, slot])));
        const { bounds: _bounds, boneIndices: _indices, boneWeights: _weights, hierarchyId: _hierarchy, ...bindPose } = primitive;
        gpuSkins.set(primitive, { bindPose, vertices: skinVertices(primitive, slots) });
      }
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
  const meshOfPrimitive = /* @__PURE__ */ new Map();
  for (const mesh of owned.meshes)
    for (const primitive of mesh.primitiveIds)
      meshOfPrimitive.set(primitive, mesh);
  const morphed = projection.primitives.filter((primitive) => primitive.morphTargets !== void 0 && primitive.morphTargets.length > 0);
  for (const primitive of morphed) {
    if (deformers.has(primitive)) {
      report("morph-skinned-unrendered", `${primitive.id}: morph targets under a skin are drawn without their weights.`, primitive.id);
      continue;
    }
    workingBytes += (primitive.positions.byteLength + (primitive.normals?.byteLength ?? 0)) * (primitiveNodes.get(primitive.id)?.length ?? 1);
    if (workingBytes > maxBytes)
      throw new RangeError("morphed geometry exceeds maxBytes");
  }
  const morphTargetCounts = /* @__PURE__ */ new Map();
  for (const primitive of morphed)
    for (const node of primitiveNodes.get(primitive.id) ?? [])
      if (node !== void 0)
        morphTargetCounts.set(node, primitive.morphTargets?.length ?? 0);
  let morphSampler;
  if (morphs.length > 0) {
    for (const channel of morphs)
      if (!morphTargetCounts.has(channel.target))
        report("animation-target-unrendered", `Morph weights target ${channel.target} is not a scene node drawing morph targets.`);
    try {
      morphSampler = createModelAnimationSampler({ ...present(clip, "morph clip"), channels: morphs }, { ...budget, maxBytes: Math.floor(maxBytes / 4) }, signal);
    } catch (error) {
      if (signal?.aborted || error instanceof RangeError)
        throw error;
      report("morph-unavailable", `Morph weights are not sampleable: ${error instanceof Error ? error.message : String(error)}`);
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
    /** The clip's events passed after `fromSeconds` up to `toSeconds` (see clipEventsBetween). */
    eventsBetween: (fromSeconds, toSeconds) => clip === void 0 ? [] : clipEventsBetween(clip, fromSeconds, toSeconds),
    sample(timeSeconds, requestSignal, camera) {
      if (!Number.isFinite(timeSeconds))
        throw new TypeError("scene time must be finite");
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const cameraRotation = camera?.rotation === void 0 ? billboardCamera : sampleRotation(camera.rotation);
      const cameraPosition = camera?.position === void 0 ? billboardPosition : samplePosition(camera.position);
      const poses = /* @__PURE__ */ new Map();
      const animatedWorlds = /* @__PURE__ */ new Map();
      const hiddenPrimitives = new Set(projection.primitives.filter((primitive) => primitive.hidden === true).map((primitive) => primitive.id));
      const fades = /* @__PURE__ */ new Map();
      for (const value of visibilitySampler?.sample(timeSeconds, requestSignal) ?? [])
        if (primitiveIds.has(value.target)) {
          const visibility2 = value.value[0] ?? 0;
          if (visibility2 > 0)
            hiddenPrimitives.delete(value.target);
          else
            hiddenPrimitives.add(value.target);
          if (visibility2 > 0 && visibility2 < 1)
            fades.set(value.target, visibility2);
        }
      const faded = (primitive) => {
        const fade = fades.get(primitive.id);
        return fade === void 0 ? {} : { tint: [1, 1, 1, fade] };
      };
      const nodeWeights = /* @__PURE__ */ new Map();
      for (const value of morphSampler?.sample(timeSeconds, requestSignal) ?? [])
        if (value.value.length === morphTargetCounts.get(value.target))
          nodeWeights.set(value.target, value.value);
      const localPoses = nodeSampler?.sample(timeSeconds, requestSignal);
      const faceBillboards = new Map(billboards.flatMap((item) => item.mode === "face-camera" ? [[item.nodeId, item]] : []));
      const joints = [];
      const palettes = /* @__PURE__ */ new Map();
      for (const [hierarchyId, sampler] of poseSamplers) {
        const originalPose = sampler.sample(timeSeconds, requestSignal).bones;
        const pose = applyModelBillboards(originalPose, [...present(hierarchyBindings.get(hierarchyId), "billboard bindings").values()], billboards, cameraRotation, present(hierarchyFrames.get(hierarchyId), "billboard frame"), billboardBytes, requestSignal, cameraPosition);
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
          const adjusted = face === void 0 || cameraPosition === void 0 ? matrix2 : applyModelFaceCameraBillboard(matrix2, face, cameraPosition);
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
          const hierarchyId = present(primitive.hierarchyId, "skin hierarchy");
          const pose = present(poses.get(hierarchyId), "skin pose");
          const gpu = gpuSkins.get(primitive);
          let deformed;
          let skin;
          if (gpu === void 0)
            deformed = deformer.deform(pose, requestSignal);
          else {
            let palette = palettes.get(hierarchyId);
            if (palette === void 0)
              palettes.set(hierarchyId, palette = skinPalette(pose, present(hierarchySlots.get(hierarchyId), "skin slots")));
            skin = Object.freeze({
              ...gpu.vertices,
              palette,
              deformed: () => deformed ??= deformer.deform(pose)
            });
          }
          const frame = hierarchyFrames.get(hierarchyId);
          const transformed = frame !== void 0 && !frame.every((value, i) => value === IDENTITY[i]);
          const instances2 = primitiveNodes.get(primitive.id)?.length ?? 1;
          for (let instance = 0; instance < instances2; instance++) {
            const posed = {
              ...drawn(skin === void 0 ? present(deformed, "deformed skin") : gpu.bindPose),
              ...transformed ? { transform: new Float32Array(frame) } : {},
              ...skin === void 0 ? {} : { skin },
              ...faded(primitive)
            };
            primitives.push(posed);
          }
        } else {
          const targets = primitive.morphTargets?.length ?? 0;
          const defaults = meshOfPrimitive.get(primitive.id)?.morphWeights;
          for (const node of primitiveNodes.get(primitive.id) ?? [void 0]) {
            const transform = node === void 0 ? void 0 : animatedWorlds.get(node) ?? worlds.get(node);
            const weights = (node === void 0 ? void 0 : nodeWeights.get(node)) ?? defaults;
            const shaped = targets > 0 && weights !== void 0 && weights.some((weight) => weight !== 0) ? morphPrimitive(primitive, weights) : primitive;
            primitives.push({
              ...drawn(shaped),
              ...transform === void 0 ? {} : { transform: new Float32Array(transform) },
              ...faded(primitive)
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
function sampleRotation(value) {
  if (value.length !== 4 || !value.every(Number.isFinite) || Math.hypot(...value) === 0)
    throw new TypeError("sample camera rotation must be a finite nonzero quaternion");
  return [value[0], value[1], value[2], value[3]];
}
function samplePosition(value) {
  if (value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError("sample camera position must contain three finite numbers");
  return [value[0], value[1], value[2]];
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/ops.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var at = (pixels, index) => pixels[index];
function checked(image) {
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError(`image: expected ${image.width * image.height * 4} bytes, got ${image.pixels.length}`);
  }
  return image;
}
function applyColorKeyTransparency(image, options) {
  checked(image);
  const tolerance = options.tolerance ?? 0;
  const replacement = options.replacement ?? { r: 0, g: 0, b: 0, a: 0 };
  const out = image.pixels.slice();
  for (let index = 0; index < out.length; index += 4) {
    const close = Math.abs(at(out, index) - options.target.r) <= tolerance && Math.abs(at(out, index + 1) - options.target.g) <= tolerance && Math.abs(at(out, index + 2) - options.target.b) <= tolerance;
    if (close) {
      out[index] = replacement.r;
      out[index + 1] = replacement.g;
      out[index + 2] = replacement.b;
      out[index + 3] = replacement.a;
    }
  }
  return { width: image.width, height: image.height, pixels: out };
}
function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value) {
  return value <= 31308e-7 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/encoders.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
var ascii = new TextEncoder();
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength, false);
  out.set(ascii.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32Range(out, 4, 8 + data.byteLength), false);
  return out;
}
async function writePng(width, height, bitDepth, colorType, rowBytes, row, signal) {
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1)
    row(y, raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header[8] = bitDepth;
  header[9] = colorType;
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", await compressPortable(raw, "deflate", signal)),
    pngChunk("IEND", new Uint8Array(0))
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.byteLength;
  }
  return png;
}
async function encodePng(width, height, pixels, signal) {
  const rowBytes = width * 4;
  return writePng(width, height, 8, 6, rowBytes, (y, into) => into.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes)), signal);
}

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/png.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
var DEFAULT_MAX_PIXELS = 64 * 1024 * 1024;

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/jpeg.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var ZIGZAG = Int32Array.from([
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63
]);
var MAX_DIMENSION = 1 << 15;
var COS = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) {
    const scale = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x += 1)
      table[u * 8 + x] = scale * Math.cos((2 * x + 1) * u * Math.PI / 16);
  }
  return table;
})();

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/surfaces.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/embedded.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/tga.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

// ../MODDING/modkit-core/packages/codec-kit/dist/raster/pcx.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();

export {
  snapshotJson,
  decomposeMatrix4,
  quaternionFromRotationMatrix,
  invertQuat,
  multiplyQuat,
  snapshotModelBillboards,
  billboardCameraRotation,
  sampleTrackValue,
  composeTrsMatrix,
  multiplyMat4,
  DEFAULT_MODEL_ANIMATION_BUDGET,
  snapshotModelAnimations,
  createModelAnimationSampler,
  DEFAULT_MODEL_SKELETON_BUDGET,
  snapshotModelSkeleton,
  createModelSkeletonNodes,
  modelPrimitiveByteLength,
  createModelSceneSampler,
  encodePng,
  applyColorKeyTransparency,
  srgbToLinear,
  linearToSrgb
};
