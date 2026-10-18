import {
  invertAffine
} from "./chunk-ASFTMZAC.js";

// packages/codec-kit/dist/model/legacy/skinning-kernels.js
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
      const matrix = matrices[mesh.skin.boneIndices[skinBase + slot] ?? 0];
      if (!matrix)
        continue;
      const transformed = transformPoint(matrix, px, py, pz);
      const transformedNormal = transformVector(matrix, nx, ny, nz);
      const transformedTangent = transformVector(matrix, tx, ty, tz);
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
function transformPoint(matrix, x, y, z) {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0)
  ];
}
function transformVector(matrix, x, y, z) {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z,
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z,
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z
  ];
}

// packages/codec-kit/dist/model/skinning.js
var kernelOutput = new Float32Array(0);
function createModelSkinDeformer(primitive, boneIndices, maxBytes = 134217728, signal) {
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  const count = primitive.positions.length / 3;
  const influences = primitive.boneInfluences ?? 4;
  if (influences !== 4 && influences !== 8)
    throw new TypeError("unsupported skin influence count");
  if (!Number.isSafeInteger(count) || !primitive.positions.every(Number.isFinite))
    throw new TypeError("invalid skin positions");
  const workingBytes = count * (112 + influences * 8) + boneIndices.length * 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || workingBytes > maxBytes)
    throw new RangeError("skin deformation exceeds maxBytes");
  const slots = /* @__PURE__ */ new Map();
  for (const [slot, index] of boneIndices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || slots.has(index))
      throw new TypeError("ambiguous skin bone index");
    slots.set(index, slot);
  }
  const { boneWeights, boneIndices: authored } = primitive;
  if (!primitive.hierarchyId || authored?.length !== count * influences || boneWeights?.length !== count * influences)
    throw new TypeError("skin requires an explicit hierarchy and matching indices and weights per vertex");
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
    for (let influence = 0; influence < influences; influence++) {
      const index = vertex * influences + influence;
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
    skin: { maxInfluences: influences, boneIndices: indices, boneWeights: weights }
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
        const matrix = bone.skinningMatrix;
        if (matrices[slot] !== void 0 || matrix?.length !== 16 || !matrix.every(Number.isFinite))
          throw new TypeError("skin needs a unique explicit inverse-bind pose for each bone");
        matrices[slot] = new Float32Array(matrix);
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
      const { bounds: _bounds, boneIndices: _indices, boneWeights: _weights, boneInfluences: _influences, hierarchyId: _hierarchy, normals: _normals, tangents: _tangents, ...rest } = primitive;
      return {
        ...rest,
        positions,
        ...normals ? { normals } : {},
        ...tangents ? { tangents } : {}
      };
    }
  });
}
function applyPoint(matrix, x, y, z) {
  const at = (index) => {
    const one = matrix[index];
    return typeof one === "number" && Number.isFinite(one) ? one : 0;
  };
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14)
  ];
}
function applyDirection(matrix, x, y, z) {
  const at = (index) => {
    const one = matrix[index];
    return typeof one === "number" && Number.isFinite(one) ? one : 0;
  };
  const out = [
    at(0) * x + at(4) * y + at(8) * z,
    at(1) * x + at(5) * y + at(9) * z,
    at(2) * x + at(6) * y + at(10) * z
  ];
  const length = Math.hypot(out[0], out[1], out[2]);
  return length === 0 ? out : [out[0] / length, out[1] / length, out[2] / length];
}
function bakeSkinToRigidParts(primitive, options) {
  const { bindMatrices, signal } = options;
  signal?.throwIfAborted();
  const space = options.space ?? "bone-local";
  const epsilon = options.blendEpsilon ?? 1e-3;
  const count = primitive.positions.length / 3;
  if (!Number.isSafeInteger(count) || count === 0)
    throw new TypeError("invalid skin positions");
  const { boneIndices, boneWeights, indices } = primitive;
  const influences = primitive.boneInfluences ?? 4;
  if (influences !== 4 && influences !== 8 || boneIndices?.length !== count * influences || boneWeights?.length !== count * influences)
    throw new TypeError("baking a skin requires matching indices and weights per vertex");
  if (indices === void 0)
    throw new TypeError("baking a skin requires an index buffer");
  const maxBytes = options.maxBytes ?? 134217728;
  if (count * 64 + indices.length * 8 > maxBytes)
    throw new RangeError("skin bake exceeds maxBytes");
  const owner = new Int32Array(count);
  let blendedVertices = 0;
  let maxDroppedWeight = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if ((vertex & 1023) === 0)
      signal?.throwIfAborted();
    let best = -1;
    let bestWeight = -1;
    let secondWeight = 0;
    for (let influence = 0; influence < influences; influence += 1) {
      const weight = boneWeights[vertex * influences + influence] ?? 0;
      const slot = boneIndices[vertex * influences + influence] ?? 0;
      if (weight > bestWeight) {
        secondWeight = Math.max(secondWeight, bestWeight);
        bestWeight = weight;
        best = slot;
      } else
        secondWeight = Math.max(secondWeight, weight);
    }
    owner[vertex] = best < 0 ? 0 : best;
    if (secondWeight > epsilon) {
      blendedVertices += 1;
      maxDroppedWeight = Math.max(maxDroppedWeight, secondWeight);
    }
  }
  const triangleOwner = /* @__PURE__ */ new Map();
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const vertices = [indices[triangle], indices[triangle + 1], indices[triangle + 2]];
    let slot = owner[vertices[0]];
    let bestWeight = -1;
    for (const vertex of vertices) {
      const weight = boneWeights[vertex * influences] ?? 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        slot = owner[vertex];
      }
    }
    const list = triangleOwner.get(slot);
    if (list === void 0)
      triangleOwner.set(slot, [...vertices]);
    else
      list.push(...vertices);
  }
  const parts = [];
  for (const [slot, vertexList] of [...triangleOwner.entries()].sort((a, b) => a[0] - b[0])) {
    signal?.throwIfAborted();
    const bind = bindMatrices[slot];
    if (bind === void 0)
      throw new TypeError(`the skin names bone ${String(slot)} with no bind matrix`);
    const toLocal = space === "bone-local" ? invertAffine(bind) : void 0;
    const remap = /* @__PURE__ */ new Map();
    const positions = [];
    const normals = [];
    const uvs = [];
    const partIndices = new Uint32Array(vertexList.length);
    for (const [ordinal, vertex] of vertexList.entries()) {
      let mapped = remap.get(vertex);
      if (mapped === void 0) {
        mapped = remap.size;
        remap.set(vertex, mapped);
        const x = primitive.positions[vertex * 3] ?? 0;
        const y = primitive.positions[vertex * 3 + 1] ?? 0;
        const z = primitive.positions[vertex * 3 + 2] ?? 0;
        const point = toLocal === void 0 ? [x, y, z] : applyPoint(toLocal, x, y, z);
        positions.push(point[0], point[1], point[2]);
        if (primitive.normals !== void 0) {
          const nx = primitive.normals[vertex * 3] ?? 0;
          const ny = primitive.normals[vertex * 3 + 1] ?? 0;
          const nz = primitive.normals[vertex * 3 + 2] ?? 0;
          const direction = toLocal === void 0 ? [nx, ny, nz] : applyDirection(toLocal, nx, ny, nz);
          normals.push(direction[0], direction[1], direction[2]);
        }
        if (primitive.textureCoordinates !== void 0)
          uvs.push(primitive.textureCoordinates[vertex * 2] ?? 0, primitive.textureCoordinates[vertex * 2 + 1] ?? 0);
      }
      partIndices[ordinal] = mapped;
    }
    parts.push({
      boneSlot: slot,
      positions: Float32Array.from(positions),
      ...normals.length === 0 ? {} : { normals: Float32Array.from(normals) },
      ...uvs.length === 0 ? {} : { textureCoordinates: Float32Array.from(uvs) },
      indices: partIndices,
      transform: [...bind]
    });
  }
  return { parts, blendedVertices, maxDroppedWeight };
}
function splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, options) {
  const { maxBones, signal } = options;
  const influences = options.boneInfluences ?? 4;
  if (influences !== 4 && influences !== 8)
    throw new TypeError("unsupported skin influence count");
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxBones) || maxBones < 1)
    throw new RangeError("a bone budget must be a positive whole number");
  if (indices.length % 3 !== 0)
    throw new TypeError("splitting a mesh requires whole triangles");
  const maxBytes = options.maxBytes ?? 134217728;
  if (indices.length * 8 > maxBytes)
    throw new RangeError("bone split exceeds maxBytes");
  const bonesOf = (vertex) => {
    if (boneIndices === void 0 || boneWeights === void 0)
      return [];
    const out = [];
    for (let influence = 0; influence < influences; influence += 1) {
      const at = vertex * influences + influence;
      if (at >= boneIndices.length)
        break;
      const weight = boneWeights[at] ?? 0;
      const bone = boneIndices[at] ?? 0;
      if (weight > 0 && !out.includes(bone))
        out.push(bone);
    }
    return out;
  };
  const all = /* @__PURE__ */ new Set();
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    if ((triangle & 1023) === 0)
      signal?.throwIfAborted();
    for (let corner = 0; corner < 3; corner += 1)
      for (const bone of bonesOf(indices[triangle + corner] ?? 0))
        all.add(bone);
  }
  const whole = () => {
    const vertices2 = [];
    const remap2 = /* @__PURE__ */ new Map();
    const out = new Uint32Array(indices.length);
    for (let at = 0; at < indices.length; at += 1) {
      const vertex = indices[at] ?? 0;
      let mapped = remap2.get(vertex);
      if (mapped === void 0) {
        mapped = vertices2.length;
        remap2.set(vertex, mapped);
        vertices2.push(vertex);
      }
      out[at] = mapped;
    }
    return [
      {
        bones: [...all].sort((left, right) => left - right),
        vertices: Uint32Array.from(vertices2),
        indices: out
      }
    ];
  };
  if (all.size <= maxBones)
    return whole();
  const parts = [];
  let bones = /* @__PURE__ */ new Set();
  let vertices = [];
  let remap = /* @__PURE__ */ new Map();
  let partIndices = [];
  const close = () => {
    if (partIndices.length === 0)
      return;
    parts.push({
      bones: [...bones].sort((left, right) => left - right),
      vertices: Uint32Array.from(vertices),
      indices: Uint32Array.from(partIndices)
    });
    bones = /* @__PURE__ */ new Set();
    vertices = [];
    remap = /* @__PURE__ */ new Map();
    partIndices = [];
  };
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    signal?.throwIfAborted();
    const corners = [indices[triangle] ?? 0, indices[triangle + 1] ?? 0, indices[triangle + 2] ?? 0];
    const wanted = /* @__PURE__ */ new Set();
    for (const corner of corners)
      for (const bone of bonesOf(corner))
        wanted.add(bone);
    if (wanted.size > maxBones)
      throw new RangeError(`one triangle follows ${String(wanted.size)} bones, more than the budget of ${String(maxBones)}`);
    let added = 0;
    for (const bone of wanted)
      if (!bones.has(bone))
        added += 1;
    if (bones.size + added > maxBones)
      close();
    for (const bone of wanted)
      bones.add(bone);
    for (const corner of corners) {
      let mapped = remap.get(corner);
      if (mapped === void 0) {
        mapped = vertices.length;
        remap.set(corner, mapped);
        vertices.push(corner);
      }
      partIndices.push(mapped);
    }
  }
  close();
  return parts;
}

export {
  createModelSkinDeformer,
  bakeSkinToRigidParts,
  splitTrianglesByBoneLimit
};
