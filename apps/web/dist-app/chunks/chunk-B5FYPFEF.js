import {
  ModkitError
} from "./chunk-AMCLMQ4O.js";

// ../../MODDING/modkit-core/packages/codec-kit/dist/texture/compressed-texture.js
var DEFAULT_MAX_RGBA8_DECODE_BYTES = 256 * 1024 * 1024;
var positiveSafeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
function compressedTextureByteLength(width, height, depth, block) {
  const valid = typeof block === "object" && block !== null && [width, height, depth, block.width, block.height, block.depth, block.bytes].every(positiveSafeInteger) && [block.minimumBlocksWide, block.minimumBlocksHigh, block.minimumBlocksDeep].every((minimum) => minimum === void 0 || positiveSafeInteger(minimum));
  const length = valid ? Math.max(block.minimumBlocksWide ?? 1, Math.ceil(width / block.width)) * Math.max(block.minimumBlocksHigh ?? 1, Math.ceil(height / block.height)) * Math.max(block.minimumBlocksDeep ?? 1, Math.ceil(depth / block.depth)) * block.bytes : void 0;
  if (length === void 0 || !Number.isSafeInteger(length))
    throw new ModkitError({
      code: "codec-kit/texture-size-limit",
      message: "Compressed texture subresource size is not safely representable",
      context: { width, height, depth, block }
    });
  return length;
}
function assertRgba8DecodeWithinLimit(width, height, depth = 1, maxBytes = DEFAULT_MAX_RGBA8_DECODE_BYTES) {
  const length = width * height * depth * 4;
  if (!Number.isSafeInteger(length) || width <= 0 || height <= 0 || depth <= 0 || length > maxBytes)
    throw new ModkitError({
      code: "codec-kit/texture-size-limit",
      message: "Decoded RGBA8 texture exceeds the configured safety limit",
      context: { width, height, depth, requiredBytes: length, maxBytes }
    });
  return length;
}

// ../../MODDING/modkit-core/packages/codec-kit/dist/texture/binary.js
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

// ../../MODDING/modkit-core/packages/codec-kit/dist/texture/gpu-texture.js
var gpuTextureWasmPromise;
function gpuTextureWasm() {
  gpuTextureWasmPromise ??= import("./gpu-texture-wasm-CC5RLRSY.js");
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
  DEFAULT_MAX_RGBA8_DECODE_BYTES,
  compressedTextureByteLength,
  assertRgba8DecodeWithinLimit,
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
