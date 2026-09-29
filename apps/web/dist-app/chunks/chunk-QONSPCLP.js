import {
  ModkitError
} from "./chunk-W2UBWFML.js";

// ../MODDING/modkit-core/packages/uv/dist/model/legacy/rig-kernels.js
var BufferBuilder = class {
  chunks = [];
  length = 0;
  append(bytes) {
    const aligned = this.length + 3 & ~3;
    if (aligned > this.length)
      this.push(new Uint8Array(aligned - this.length));
    const offset = this.length;
    this.push(bytes);
    return offset;
  }
  finish() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
};
var IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function encodeSkeleton(model, nodes, buffer, bufferViews, accessors) {
  if (model.skeleton.bones.length === 0) {
    return { skins: [], rootNodes: [], boneNodes: [], encodedBones: 0 };
  }
  const bones = [...model.skeleton.bones].sort((left, right) => left.index - right.index);
  for (const [index, bone] of bones.entries()) {
    if (bone.index !== index || bone.parentIndex < -1 || bone.parentIndex >= bones.length) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "UVM skeleton bone indices must be contiguous and parents must be in range.",
        context: { bone: bone.index, parent: bone.parentIndex, expected: index }
      });
    }
    const visited = /* @__PURE__ */ new Set([bone.index]);
    let parent = bone.parentIndex;
    while (parent >= 0) {
      if (visited.has(parent)) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM skeleton hierarchy contains a cycle.",
          context: { bone: bone.index, parent }
        });
      }
      visited.add(parent);
      parent = bones[parent]?.parentIndex ?? -1;
    }
  }
  for (const [meshIndex, mesh] of model.meshes.entries()) {
    for (const joint of mesh.boneIndices ?? []) {
      if (joint >= bones.length) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM mesh joint index is outside the skeleton.",
          context: { meshIndex, joint, bones: bones.length }
        });
      }
    }
  }
  const firstBoneNode = nodes.length;
  const boneNodes = bones.map((_bone, index) => firstBoneNode + index);
  const children = bones.map(() => []);
  const rootNodes = [];
  for (const bone of bones) {
    const node = firstBoneNode + bone.index;
    if (bone.parentIndex < 0)
      rootNodes.push(node);
    else
      children[bone.parentIndex]?.push(node);
  }
  for (const bone of bones) {
    const boneChildren = children[bone.index] ?? [];
    nodes.push({
      name: bone.name || `Bone_${bone.index}`,
      ...boneChildren.length > 0 ? { children: boneChildren } : {},
      ...bone.flags === void 0 ? {} : { extras: { sourceFlags: bone.flags } }
    });
  }
  const matrices = new Float32Array(bones.length * 16);
  for (const bone of bones) {
    const offset = bone.index * 16;
    const source = model.skeleton.skinningInverses === "identity" ? IDENTITY_MATRIX : bone.inverseBindMatrix ?? IDENTITY_MATRIX;
    if (source.length !== 16 || Array.from(source).some((value) => !Number.isFinite(value))) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "UVM inverse bind matrices must contain sixteen finite values.",
        context: { bone: bone.index, values: source.length }
      });
    }
    matrices.set(source, offset);
  }
  const inverseBindMatrices = addAccessor(buffer, bufferViews, accessors, matrices, "MAT4", 5126);
  return {
    skins: [
      {
        joints: boneNodes,
        inverseBindMatrices,
        ...rootNodes[0] === void 0 ? {} : { skeleton: rootNodes[0] }
      }
    ],
    rootNodes,
    boneNodes,
    encodedBones: bones.length
  };
}
function addJointAttribute(attributes, mesh, vertexCount, buffer, bufferViews, accessors) {
  if (mesh.boneIndices) {
    if (mesh.boneIndices.length !== vertexCount * 4)
      throw invalidAttribute("JOINTS_0", mesh.boneIndices.length, vertexCount * 4);
    attributes.JOINTS_0 = addAccessor(buffer, bufferViews, accessors, mesh.boneIndices, "VEC4", 5123, 34962);
  }
  if (mesh.boneWeights)
    addAttribute(attributes, "WEIGHTS_0", mesh.boneWeights, vertexCount, 4, buffer, bufferViews, accessors);
}
function addAttribute(attributes, semantic, values, vertexCount, width, buffer, bufferViews, accessors) {
  if (!values)
    return;
  if (values.length !== vertexCount * width)
    throw invalidAttribute(semantic, values.length, vertexCount * width);
  attributes[semantic] = addAccessor(buffer, bufferViews, accessors, values, vectorType(width), 5126, 34962);
}
function encodeAnimationChannel(track, width, node, path, samplers, channels, buffer, bufferViews, accessors, concurrent, wrapSeconds) {
  if (track.keys.length === 0)
    return false;
  if (track.globalSeqId !== null && (!Number.isSafeInteger(track.globalSeqId) || track.globalSeqId < 0)) {
    return false;
  }
  if (track.globalSeqId !== null && concurrent)
    return false;
  if (track.lineType < 0 || track.lineType > 3)
    return false;
  let previous = Number.NEGATIVE_INFINITY;
  const times = new Float32Array(track.keys.length);
  const cubic = track.lineType === 2 || track.lineType === 3;
  const values = new Float32Array(track.keys.length * width * (cubic ? 3 : 1));
  for (const [index, key] of track.keys.entries()) {
    if (!Number.isFinite(key.frame) || key.frame < 0 || key.frame <= previous || key.vector.length !== width || key.vector.some((value) => !Number.isFinite(value))) {
      return false;
    }
    previous = key.frame;
    times[index] = key.frame;
  }
  if (cubic) {
    if (!encodeCubicEffectValues(track, times, width, values))
      return false;
  } else {
    for (const [index, key] of track.keys.entries())
      values.set(key.vector, index * width);
  }
  const input = addAccessor(buffer, bufferViews, accessors, times, "SCALAR", 5126, void 0, bounds(times, 1));
  const output = addAccessor(buffer, bufferViews, accessors, values, width === 4 ? "VEC4" : "VEC3", 5126);
  const sampler = samplers.push({
    input,
    output,
    interpolation: track.lineType === 0 ? "STEP" : cubic ? "CUBICSPLINE" : "LINEAR"
  }) - 1;
  channels.push({
    sampler,
    target: { node, path },
    ...cubic || track.globalSeqId !== null || concurrent ? {
      extras: {
        uv: {
          sourceLineType: track.lineType,
          ...track.globalSeqId === null ? {} : { globalSeqId: track.globalSeqId },
          ...concurrent ? { concurrent: true, wrapSeconds } : {}
        }
      }
    } : {}
  });
  return true;
}
function encodeCubicEffectValues(track, times, components, values) {
  for (const [index, key] of track.keys.entries()) {
    const previous = track.keys[index - 1];
    const next = track.keys[index + 1];
    const previousSpan = index > 0 ? times[index] - times[index - 1] : 0;
    const nextSpan = index + 1 < times.length ? times[index + 1] - times[index] : 0;
    const incoming = cubicDerivative(track.lineType, key.inTan, key.vector, previous?.vector, previousSpan, false, components);
    const outgoing = cubicDerivative(track.lineType, key.outTan, key.vector, next?.vector, nextSpan, true, components);
    if (!incoming || !outgoing)
      return false;
    const base = index * components * 3;
    values.set(incoming, base);
    values.set(key.vector, base + components);
    values.set(outgoing, base + components * 2);
  }
  return true;
}
function cubicDerivative(lineType, tangent, value, adjacent, span, outgoing, components) {
  if (span === 0)
    return Array.from({ length: components }, () => 0);
  if (!(span > 0) || value.length !== components || adjacent?.length !== components)
    return void 0;
  const result = [];
  for (let component = 0; component < components; component += 1) {
    const current = value[component];
    const neighboring = adjacent[component];
    const authored = tangent?.[component];
    let derivative;
    if (Number.isFinite(authored)) {
      derivative = lineType === 2 ? authored / span : outgoing ? 3 * (authored - current) / span : 3 * (current - authored) / span;
    } else {
      derivative = outgoing ? (neighboring - current) / span : (current - neighboring) / span;
    }
    if (!Number.isFinite(derivative))
      return void 0;
    result.push(derivative);
  }
  return result;
}
function addAccessor(buffer, bufferViews, accessors, values, type, componentType, target, range) {
  const bytes = littleEndianBytes(values);
  const byteOffset = buffer.append(bytes);
  const bufferView = bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: bytes.length,
    ...target === void 0 ? {} : { target }
  }) - 1;
  const width = accessorWidth(type);
  const accessor = {
    bufferView,
    componentType,
    count: values.length / width,
    type,
    ...range ? { min: range.min, max: range.max } : {}
  };
  accessors.push(accessor);
  return accessors.length - 1;
}
function littleEndianBytes(values) {
  const bytes = new Uint8Array(values.length * values.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    const offset = index * values.BYTES_PER_ELEMENT;
    if (values instanceof Float32Array)
      view.setFloat32(offset, value, true);
    else if (values instanceof Uint32Array)
      view.setUint32(offset, value, true);
    else
      view.setUint16(offset, value, true);
  });
  return bytes;
}
function bounds(values, width) {
  const min = Array(width).fill(Number.POSITIVE_INFINITY);
  const max = Array(width).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += width) {
    for (let component = 0; component < width; component += 1) {
      const value = values[index + component];
      const currentMin = min[component];
      const currentMax = max[component];
      if (value === void 0 || currentMin === void 0 || currentMax === void 0) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM attribute bounds cannot be computed from an incomplete vector.",
          context: { index, component, width }
        });
      }
      min[component] = Math.min(currentMin, value);
      max[component] = Math.max(currentMax, value);
    }
  }
  return { min, max };
}
function accessorWidth(type) {
  if (type === "VEC2")
    return 2;
  if (type === "VEC3")
    return 3;
  if (type === "VEC4")
    return 4;
  if (type === "MAT4")
    return 16;
  return 1;
}
function vectorType(width) {
  if (width === 2)
    return "VEC2";
  if (width === 3)
    return "VEC3";
  if (width === 4)
    return "VEC4";
  throw new ModkitError({
    code: "CONFIG_INVALID",
    message: "Unsupported UVM accessor width.",
    context: { width }
  });
}
function invalidAttribute(semantic, actual, expected) {
  return new ModkitError({
    code: "CONFIG_INVALID",
    message: "UVM mesh attribute length does not match its vertex count.",
    context: { semantic, actual, expected }
  });
}

export {
  BufferBuilder,
  encodeSkeleton,
  addJointAttribute,
  encodeAnimationChannel,
  addAccessor
};
