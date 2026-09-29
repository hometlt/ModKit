import {
  ModkitError
} from "./chunk-W2UBWFML.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/legacy/assets/profiles/image-texture.js
var MAX_VALIDATED_SUBRESOURCES_V1 = 1048576;
function compressedTextureBlockByteLengthV1(width, height, depth, block) {
  if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height) || !isPositiveSafeInteger(depth) || !validBlockLayout(block)) {
    return void 0;
  }
  const wide = Math.max(block.minimumBlocksWide ?? 1, Math.ceil(width / block.width));
  const high = Math.max(block.minimumBlocksHigh ?? 1, Math.ceil(height / block.height));
  const deep = Math.max(block.minimumBlocksDeep ?? 1, Math.ceil(depth / block.depth));
  const length = wide * high * deep * block.bytes;
  return Number.isSafeInteger(length) && length >= 0 ? length : void 0;
}
function validateCompressedTextureDescriptorV1(input) {
  const issues = [];
  const issue = (code, path, message) => {
    issues.push({ code, path, message });
  };
  if (!isRecord(input)) {
    issue("descriptor-shape", "", "descriptor must be an object");
    return issues;
  }
  if (!isRecord(input["dimensions"]))
    issue("descriptor-shape", "dimensions", "dimensions must be an object");
  if (!isRecord(input["block"]))
    issue("descriptor-shape", "block", "block must be an object");
  if (!Array.isArray(input["subresources"]))
    issue("descriptor-shape", "subresources", "subresources must be an array");
  if (!isRecord(input["source"]))
    issue("descriptor-shape", "source", "source must be an object");
  if (issues.length > 0)
    return issues;
  const descriptor = input;
  if (descriptor.schemaVersion !== 1)
    issue("schema-version", "schemaVersion", "schemaVersion must equal 1");
  if (typeof descriptor.format !== "string" || descriptor.format.length === 0)
    issue("format", "format", "format must be a non-empty string");
  const { width, height, depth } = descriptor.dimensions;
  const dimensionsValid = [width, height, depth].every(isPositiveSafeInteger);
  if (!dimensionsValid)
    issue("dimensions", "dimensions", "dimensions must be positive safe integers");
  const mipCountValid = isPositiveSafeInteger(descriptor.mipLevelCount);
  if (!mipCountValid) {
    issue("mip-level-count", "mipLevelCount", "mipLevelCount must be a positive safe integer");
  } else if (dimensionsValid) {
    const naturalMipCount = Math.floor(Math.log2(Math.max(width, height, depth))) + 1;
    if (descriptor.mipLevelCount > naturalMipCount) {
      issue("mip-level-count", "mipLevelCount", `mipLevelCount ${descriptor.mipLevelCount} exceeds the natural chain length ${naturalMipCount}`);
    }
  }
  if (!isPositiveSafeInteger(descriptor.layerCount))
    issue("layer-count", "layerCount", "layerCount must be a positive safe integer");
  if (!isPositiveSafeInteger(descriptor.faceCount))
    issue("face-count", "faceCount", "faceCount must be a positive safe integer");
  if (!["linear", "srgb", "unknown"].includes(descriptor.colorSpace))
    issue("color-space", "colorSpace", "colorSpace is not a v1 value");
  if (!["none", "straight", "premultiplied", "unknown"].includes(descriptor.alphaMode))
    issue("alpha-mode", "alphaMode", "alphaMode is not a v1 value");
  const blockValid = validBlockLayout(descriptor.block);
  if (!blockValid)
    issue("block-layout", "block", "block dimensions, byte size, and optional minimum footprints must be positive safe integers");
  const countsValid = dimensionsValid && mipCountValid && descriptor.mipLevelCount <= Math.floor(Math.log2(Math.max(width, height, depth))) + 1 && isPositiveSafeInteger(descriptor.layerCount) && isPositiveSafeInteger(descriptor.faceCount);
  let expectedSubresources;
  if (countsValid) {
    let depthSlices = 0;
    for (let mipLevel = 0; mipLevel < descriptor.mipLevelCount; mipLevel += 1)
      depthSlices += Math.max(1, Math.floor(depth / 2 ** mipLevel));
    const count = depthSlices * descriptor.layerCount * descriptor.faceCount;
    if (Number.isSafeInteger(count))
      expectedSubresources = count;
    else
      issue("subresource-count", "subresources", "expected subresource count is unsafe");
  }
  if (expectedSubresources !== void 0 && descriptor.subresources.length !== expectedSubresources) {
    issue("subresource-count", "subresources", `descriptor has ${descriptor.subresources.length} subresources; expected ${expectedSubresources}`);
  }
  if (descriptor.subresources.length > MAX_VALIDATED_SUBRESOURCES_V1 || (expectedSubresources ?? 0) > MAX_VALIDATED_SUBRESOURCES_V1) {
    issue("subresource-count", "subresources", `subresource count exceeds the v1 validation ceiling ${MAX_VALIDATED_SUBRESOURCES_V1}`);
  }
  let previousTuple;
  const inspectedSubresourceCount = countsValid && descriptor.subresources.length <= MAX_VALIDATED_SUBRESOURCES_V1 && (expectedSubresources ?? 0) <= MAX_VALIDATED_SUBRESOURCES_V1 ? descriptor.subresources.length : 0;
  for (let index = 0; index < inspectedSubresourceCount; index += 1) {
    const path = `subresources[${index}]`;
    const candidate = descriptor.subresources[index];
    if (!isRecord(candidate)) {
      issue("descriptor-shape", path, "subresource must be an object");
      continue;
    }
    const subresource = candidate;
    const indexesValid = countsValid && isNonNegativeSafeInteger(subresource.mipLevel) && subresource.mipLevel < descriptor.mipLevelCount && isNonNegativeSafeInteger(subresource.layer) && subresource.layer < descriptor.layerCount && isNonNegativeSafeInteger(subresource.face) && subresource.face < descriptor.faceCount;
    const mipDepth = indexesValid && dimensionsValid ? Math.max(1, Math.floor(depth / 2 ** subresource.mipLevel)) : void 0;
    if (!indexesValid || !isNonNegativeSafeInteger(subresource.depthSlice) || mipDepth === void 0 || subresource.depthSlice >= mipDepth) {
      issue("subresource-index", path, "subresource index is outside the descriptor bounds");
      continue;
    }
    const mipWidth = Math.max(1, Math.floor(width / 2 ** subresource.mipLevel));
    const mipHeight = Math.max(1, Math.floor(height / 2 ** subresource.mipLevel));
    if (subresource.width !== mipWidth || subresource.height !== mipHeight || subresource.depth !== 1) {
      issue("subresource-dimensions", path, "subresource dimensions do not match its mip level");
    }
    const tuple = [
      subresource.mipLevel,
      subresource.layer,
      subresource.face,
      subresource.depthSlice
    ];
    if (previousTuple !== void 0 && compareIndexTuples(previousTuple, tuple) >= 0)
      issue("subresource-order", path, "subresources are not in canonical order");
    previousTuple = tuple;
    if (blockValid) {
      const required = compressedTextureBlockByteLengthV1(subresource.width, subresource.height, subresource.depth, descriptor.block);
      const actual = dataByteLength(subresource.data);
      if (required === void 0 || actual !== required) {
        issue("subresource-byte-length", `${path}.data`, `subresource has ${actual ?? "unknown"} bytes; expected ${required ?? "a safe size"}`);
      }
      const range = subresource.sourceByteRange;
      if (range !== void 0) {
        if (!isRecord(range)) {
          issue("descriptor-shape", `${path}.sourceByteRange`, "sourceByteRange must be an object");
        } else if (!isNonNegativeSafeInteger(range.offset) || !isNonNegativeSafeInteger(range.length) || !Number.isSafeInteger(range.offset + range.length)) {
          issue("source-byte-range", `${path}.sourceByteRange`, "sourceByteRange must contain safe non-negative integers");
        } else if (range.length !== actual) {
          issue("source-byte-range", `${path}.sourceByteRange.length`, "sourceByteRange length does not match subresource data");
        }
      }
    }
  }
  if (typeof descriptor.source.codecId !== "string" || descriptor.source.codecId.length === 0 || typeof descriptor.source.containerFormat !== "string" || descriptor.source.containerFormat.length === 0 || !["source-bytes", "transcoded"].includes(descriptor.source.preservation)) {
    issue("source", "source", "source identity and preservation must be valid v1 values");
  }
  return issues;
}
function validBlockLayout(block) {
  if (!isRecord(block))
    return false;
  return [block["width"], block["height"], block["depth"], block["bytes"]].every(isPositiveSafeInteger) && optionalPositiveSafeInteger(block["minimumBlocksWide"]) && optionalPositiveSafeInteger(block["minimumBlocksHigh"]) && optionalPositiveSafeInteger(block["minimumBlocksDeep"]);
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function optionalPositiveSafeInteger(value) {
  return value === void 0 || isPositiveSafeInteger(value);
}
function isPositiveSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function dataByteLength(data) {
  if (Array.isArray(data))
    return data.length;
  if (typeof data !== "object" || data === null || !("byteLength" in data))
    return void 0;
  const byteLength = data.byteLength;
  return typeof byteLength === "number" && isNonNegativeSafeInteger(byteLength) ? byteLength : void 0;
}
function compareIndexTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    if (delta !== 0)
      return delta;
  }
  return 0;
}

// ../MODDING/modkit-core/packages/codec-kit/dist/texture/compressed-texture.js
var IMAGE_COMPRESSED_READ_OPERATION = "image.compressed.read";
var DEFAULT_MAX_RGBA8_DECODE_BYTES = 256 * 1024 * 1024;
function compressedTextureByteLength(width, height, depth, block) {
  const length = compressedTextureBlockByteLengthV1(width, height, depth, block);
  if (length === void 0)
    throw new ModkitError({
      code: "ASSET_LIMIT_EXCEEDED",
      message: "Compressed texture subresource size is not safely representable",
      context: { width, height, depth, block }
    });
  return length;
}
function assertRgba8DecodeWithinLimit(width, height, depth = 1, maxBytes = DEFAULT_MAX_RGBA8_DECODE_BYTES) {
  const length = width * height * depth * 4;
  if (!Number.isSafeInteger(length) || width <= 0 || height <= 0 || depth <= 0 || length > maxBytes)
    throw new ModkitError({
      code: "ASSET_LIMIT_EXCEEDED",
      message: "Decoded RGBA8 texture exceeds the configured safety limit",
      context: { width, height, depth, requiredBytes: length, maxBytes }
    });
  return length;
}
function validateCompressedTextureDescriptor(descriptor) {
  return validateCompressedTextureDescriptorV1(descriptor).map((issue) => issue.message);
}

// ../MODDING/modkit-core/packages/codec-kit/dist/texture/binary.js
function byteView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function ascii(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}
function clamp8(value) {
  if (!Number.isFinite(value))
    return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
function normalizedSampleToByte(value) {
  if (!Number.isFinite(value))
    return 0;
  return value >= 0 && value <= 1 ? clamp8(value * 255) : clamp8(value);
}
function halfFloatToNumber(bits) {
  const sign = bits & 32768 ? -1 : 1;
  const exponent = bits >>> 10 & 31;
  const fraction = bits & 1023;
  if (exponent === 0)
    return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31)
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

// ../MODDING/modkit-core/packages/codec-kit/dist/texture/gpu-texture.js
var gpuTextureWasmPromise;
function gpuTextureWasm() {
  gpuTextureWasmPromise ??= import("./gpu-texture-wasm-2Q2CDSF4.js");
  return gpuTextureWasmPromise;
}
function astcBlockFromGl(internalFormat, rgba4x4, srgb4x4) {
  const index = internalFormat >= srgb4x4 ? internalFormat - srgb4x4 : internalFormat - rgba4x4;
  const blocks = [
    [4, 4],
    [5, 4],
    [5, 5],
    [6, 5],
    [6, 6],
    [8, 5],
    [8, 6],
    [8, 8],
    [10, 5],
    [10, 6],
    [10, 8],
    [10, 10],
    [12, 10],
    [12, 12]
  ];
  return index >= 0 && index < blocks.length ? blocks[index] : null;
}
function astcBlockFromVk(format, astc4x4Unorm) {
  const index = Math.floor((format - astc4x4Unorm) / 2);
  const blocks = [
    [4, 4],
    [5, 4],
    [5, 5],
    [6, 5],
    [6, 6],
    [8, 5],
    [8, 6],
    [8, 8],
    [10, 5],
    [10, 6],
    [10, 8],
    [10, 10],
    [12, 10],
    [12, 12]
  ];
  return format >= astc4x4Unorm && format <= astc4x4Unorm + blocks.length * 2 - 1 && (format - astc4x4Unorm) % 2 <= 1 ? blocks[index] ?? null : null;
}
async function decodeGpuPayload(payload, layout, width, height, label, decodeDds) {
  assertRgba8DecodeWithinLimit(width, height);
  const required = compressedTextureByteLength(width, height, 1, {
    width: layout.blockWidth,
    height: layout.blockHeight,
    depth: 1,
    bytes: layout.blockBytes,
    ...layout.minimumBlocksWide === void 0 && !layout.kind.startsWith("pvrtc") ? {} : { minimumBlocksWide: layout.minimumBlocksWide ?? 2 },
    ...layout.minimumBlocksHigh === void 0 && !layout.kind.startsWith("pvrtc") ? {} : { minimumBlocksHigh: layout.minimumBlocksHigh ?? 2 }
  });
  if (payload.length < required)
    throw new Error(`truncated ${label} GPU block payload`);
  if (layout.kind === "dds") {
    if (layout.dxgiFormat === void 0)
      throw new Error(`${label} GPU block layout is missing DXGI mapping`);
    return decodeDds(wrapDx10Dds(width, height, layout.dxgiFormat, payload));
  }
  const decoder = await gpuTextureWasm();
  if (layout.kind === "astc") {
    return decodeBgraGpuPayload(await decoder.decode_astc(payload, width, height, layout.blockWidth, layout.blockHeight), width, height, `${label} ASTC`);
  }
  if (layout.kind === "pvrtc2" || layout.kind === "pvrtc4")
    return decodeBgraGpuPayload(await decoder.decode_pvrtc(payload, width, height, layout.kind === "pvrtc2"), width, height, `${label} PVRTC`);
  if (layout.kind === "etc1")
    return decodeBgraGpuPayload(await decoder.decode_etc1(payload, width, height), width, height, `${label} ETC1`);
  if (layout.kind === "atc-rgb")
    return decodeBgraGpuPayload(await decoder.decode_atc_rgb4(payload, width, height), width, height, `${label} ATC RGB`);
  if (layout.kind === "atc-rgba")
    return decodeBgraGpuPayload(await decoder.decode_atc_rgba8(payload, width, height), width, height, `${label} ATC RGBA`);
  if (layout.kind === "etc2")
    return decodeBgraGpuPayload(await decoder.decode_etc2(payload, width, height), width, height, `${label} ETC2`);
  if (layout.kind === "etc2a1")
    return decodeBgraGpuPayload(await decoder.decode_etc2a1(payload, width, height), width, height, `${label} ETC2A1`);
  if (layout.kind === "etc2a8")
    return decodeBgraGpuPayload(await decoder.decode_etc2a8(payload, width, height), width, height, `${label} ETC2A8`);
  if (layout.kind === "eacr")
    return decodeBgraGpuPayload(await decoder.decode_eacr(payload, width, height), width, height, `${label} EAC R11`);
  if (layout.kind === "eacr-signed")
    return decodeBgraGpuPayload(await decoder.decode_eacr_signed(payload, width, height), width, height, `${label} EAC R11 signed`);
  if (layout.kind === "eacrg")
    return decodeBgraGpuPayload(await decoder.decode_eacrg(payload, width, height), width, height, `${label} EAC RG11`);
  if (layout.kind === "eacrg-signed")
    return decodeBgraGpuPayload(await decoder.decode_eacrg_signed(payload, width, height), width, height, `${label} EAC RG11 signed`);
  throw new Error(`${label} GPU block decoder not implemented`);
}
function wrapDx10Dds(width, height, dxgiFormat, payload) {
  const out = new Uint8Array(128 + 20 + payload.length);
  out.set([68, 68, 83, 32], 0);
  const dv = byteView(out);
  dv.setUint32(4, 124, true);
  dv.setUint32(8, 1 | 2 | 4 | 4096 | 524288, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, width, true);
  dv.setUint32(20, payload.length, true);
  dv.setUint32(76, 32, true);
  dv.setUint32(80, 4, true);
  dv.setUint32(84, fourCC("DX10"), true);
  dv.setUint32(108, 4096, true);
  dv.setUint32(128, dxgiFormat, true);
  dv.setUint32(132, 3, true);
  dv.setUint32(136, 0, true);
  dv.setUint32(140, 1, true);
  dv.setUint32(144, 0, true);
  out.set(payload, 148);
  return out;
}
function bgraToRgba(bgra, width, height, label) {
  const expected = width * height * 4;
  if (bgra.length < expected)
    throw new Error(`${label} decoder returned ${bgra.length} bytes, expected ${expected}`);
  const rgba = new Uint8Array(expected);
  for (let i = 0; i < expected; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return rgba;
}
function fourCC(s) {
  return s.charCodeAt(0) | s.charCodeAt(1) << 8 | s.charCodeAt(2) << 16 | s.charCodeAt(3) << 24;
}
function decodeBgraGpuPayload(bgra, width, height, label) {
  if (!bgra)
    throw new Error(`${label} decode failed`);
  return { width, height, pixels: bgraToRgba(bgra, width, height, label) };
}

export {
  IMAGE_COMPRESSED_READ_OPERATION,
  DEFAULT_MAX_RGBA8_DECODE_BYTES,
  compressedTextureByteLength,
  assertRgba8DecodeWithinLimit,
  validateCompressedTextureDescriptor,
  byteView,
  ascii,
  clamp8,
  normalizedSampleToByte,
  halfFloatToNumber,
  astcBlockFromGl,
  astcBlockFromVk,
  decodeGpuPayload,
  wrapDx10Dds,
  bgraToRgba
};
