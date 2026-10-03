import {
  decodeBcSurface
} from "../../../chunks/chunk-Y4UL3XCN.js";
import {
  astcBlockFromGl,
  bgraToRgba,
  decodeGpuPayload
} from "../../../chunks/chunk-GPUJGK4E.js";
import "../../../chunks/chunk-LX6GSJ3D.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/texture/gl-compressed.js
var layout = (kind, blockBytes, extra = {}) => ({ kind, blockWidth: 4, blockHeight: 4, blockBytes, ...extra });
var GL_LAYOUTS = /* @__PURE__ */ new Map([
  [35841, layout("pvrtc2", 8, { blockWidth: 8 })],
  // RGB_PVRTC_2BPPV1_IMG
  [35843, layout("pvrtc2", 8, { blockWidth: 8 })],
  // RGBA_PVRTC_2BPPV1_IMG
  [35840, layout("pvrtc4", 8)],
  // RGB_PVRTC_4BPPV1_IMG
  [35842, layout("pvrtc4", 8)],
  // RGBA_PVRTC_4BPPV1_IMG
  [36196, layout("etc1", 8)],
  // ETC1_RGB8_OES
  [35986, layout("atc-rgb", 8)],
  // ATC_RGB_AMD
  [34798, layout("atc-rgba", 16)],
  // ATC_RGBA_INTERPOLATED_ALPHA_AMD
  [33776, layout("dds", 8, { dxgiFormat: 71 })],
  // RGB_S3TC_DXT1
  [33777, layout("dds", 8, { dxgiFormat: 71 })],
  // RGBA_S3TC_DXT1
  [33778, layout("dds", 16, { dxgiFormat: 74 })],
  // RGBA_S3TC_DXT3
  [33779, layout("dds", 16, { dxgiFormat: 77 })],
  // RGBA_S3TC_DXT5
  [36283, layout("dds", 8, { dxgiFormat: 80 })],
  // RED_RGTC1
  [36284, layout("dds", 8, { dxgiFormat: 81 })],
  // SIGNED_RED_RGTC1
  [36285, layout("dds", 16, { dxgiFormat: 83 })],
  // RG_RGTC2
  [36286, layout("dds", 16, { dxgiFormat: 84 })],
  // SIGNED_RG_RGTC2
  [36495, layout("dds", 16, { dxgiFormat: 95 })],
  // RGB_BPTC_UNSIGNED_FLOAT
  [36494, layout("dds", 16, { dxgiFormat: 96 })],
  // RGB_BPTC_SIGNED_FLOAT
  [36492, layout("dds", 16, { dxgiFormat: 98 })],
  // RGBA_BPTC_UNORM
  [36493, layout("dds", 16, { dxgiFormat: 98 })],
  // SRGB_ALPHA_BPTC_UNORM
  [37492, layout("etc2", 8)],
  // RGB8_ETC2
  [37493, layout("etc2", 8)],
  // SRGB8_ETC2
  [37494, layout("etc2a1", 8)],
  // RGB8_PUNCHTHROUGH_ALPHA1_ETC2
  [37495, layout("etc2a1", 8)],
  // SRGB8_PUNCHTHROUGH_ALPHA1_ETC2
  [37496, layout("etc2a8", 16)],
  // RGBA8_ETC2_EAC
  [37497, layout("etc2a8", 16)],
  // SRGB8_ALPHA8_ETC2_EAC
  [37488, layout("eacr", 8)],
  // R11_EAC
  [37489, layout("eacr-signed", 8)],
  // SIGNED_R11_EAC
  [37490, layout("eacrg", 16)],
  // RG11_EAC
  [37491, layout("eacrg-signed", 16)]
  // SIGNED_RG11_EAC
]);
function gpuBlockLayoutFromGl(internalFormat) {
  const known = GL_LAYOUTS.get(internalFormat);
  if (known !== void 0)
    return known;
  const astc = astcBlockFromGl(internalFormat, 37808, 37840);
  return astc === null ? null : layout("astc", 16, { blockWidth: astc[0], blockHeight: astc[1] });
}
var BC_BY_DXGI = /* @__PURE__ */ new Map([
  [71, ["DXT1", false]],
  [74, ["DXT3", false]],
  [77, ["DXT5", false]],
  [80, ["BC4", false]],
  [81, ["BC4", true]],
  [83, ["BC5", false]],
  [84, ["BC5", true]]
]);
async function decodeGlCompressed(payload, internalFormat, width, height) {
  const found = gpuBlockLayoutFromGl(internalFormat);
  if (found === null)
    throw new RangeError(`GL internal format 0x${internalFormat.toString(16)} is not a known compressed format`);
  if (found.kind !== "dds")
    return decodeGpuPayload(payload, found, width, height, "GL", () => {
      throw new Error("a non-BC layout never reaches the DDS decoder");
    });
  const bc = BC_BY_DXGI.get(found.dxgiFormat ?? -1);
  if (bc !== void 0) {
    const required = Math.ceil(width / 4) * Math.ceil(height / 4) * found.blockBytes;
    if (payload.byteLength < required)
      throw new RangeError("truncated GL BC block payload");
    return { width, height, pixels: decodeBcSurface(payload, 0, width, height, bc[0], bc[1]) };
  }
  const wasm = await import("../../../chunks/gpu-texture-wasm-BI7XZOQX.js");
  const bgra = await (found.dxgiFormat === 98 ? wasm.decode_bc7 : wasm.decode_bc6)(payload, width, height);
  if (bgra === null)
    throw new Error("GL BPTC decode failed");
  return { width, height, pixels: bgraToRgba(bgra, width, height, "GL BPTC") };
}
export {
  decodeGlCompressed,
  gpuBlockLayoutFromGl
};
