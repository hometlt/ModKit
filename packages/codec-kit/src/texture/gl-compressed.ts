/**
 * OpenGL compressed internal formats (KTX1 `glInternalFormat`) → GPU block layouts, and one level
 * decoded to RGBA8. The table is MK2's `ktx1GpuBlockLayout` (extensions/common/images/codecs/ktx at
 * 1a14ba4e), in strict TS. BC1–BC5 decode inline through `texture/bc`; BC6H, BC7 and the ETC, EAC,
 * ASTC, PVRTC and ATC families through the lazily loaded Texture2DDecoder runtime.
 */
import { decodeBcSurface, type BcFormat } from './bc-decode.js'
import {
  astcBlockFromGl,
  bgraToRgba,
  decodeGpuPayload,
  type GpuBlockLayout,
} from './gpu-texture.js'
import type { RgbaImage } from '../raster/image.js'

const layout = (
  kind: GpuBlockLayout['kind'],
  blockBytes: number,
  extra: Partial<GpuBlockLayout> = {},
): GpuBlockLayout => ({ kind, blockWidth: 4, blockHeight: 4, blockBytes, ...extra })

const GL_LAYOUTS = new Map<number, GpuBlockLayout>([
  [0x8c01, layout('pvrtc2', 8, { blockWidth: 8 })], // RGB_PVRTC_2BPPV1_IMG
  [0x8c03, layout('pvrtc2', 8, { blockWidth: 8 })], // RGBA_PVRTC_2BPPV1_IMG
  [0x8c00, layout('pvrtc4', 8)], // RGB_PVRTC_4BPPV1_IMG
  [0x8c02, layout('pvrtc4', 8)], // RGBA_PVRTC_4BPPV1_IMG
  [0x8d64, layout('etc1', 8)], // ETC1_RGB8_OES
  [0x8c92, layout('atc-rgb', 8)], // ATC_RGB_AMD
  [0x87ee, layout('atc-rgba', 16)], // ATC_RGBA_INTERPOLATED_ALPHA_AMD
  [0x83f0, layout('dds', 8, { dxgiFormat: 71 })], // RGB_S3TC_DXT1
  [0x83f1, layout('dds', 8, { dxgiFormat: 71 })], // RGBA_S3TC_DXT1
  [0x83f2, layout('dds', 16, { dxgiFormat: 74 })], // RGBA_S3TC_DXT3
  [0x83f3, layout('dds', 16, { dxgiFormat: 77 })], // RGBA_S3TC_DXT5
  [0x8dbb, layout('dds', 8, { dxgiFormat: 80 })], // RED_RGTC1
  [0x8dbc, layout('dds', 8, { dxgiFormat: 81 })], // SIGNED_RED_RGTC1
  [0x8dbd, layout('dds', 16, { dxgiFormat: 83 })], // RG_RGTC2
  [0x8dbe, layout('dds', 16, { dxgiFormat: 84 })], // SIGNED_RG_RGTC2
  [0x8e8f, layout('dds', 16, { dxgiFormat: 95 })], // RGB_BPTC_UNSIGNED_FLOAT
  [0x8e8e, layout('dds', 16, { dxgiFormat: 96 })], // RGB_BPTC_SIGNED_FLOAT
  [0x8e8c, layout('dds', 16, { dxgiFormat: 98 })], // RGBA_BPTC_UNORM
  [0x8e8d, layout('dds', 16, { dxgiFormat: 98 })], // SRGB_ALPHA_BPTC_UNORM
  [0x9274, layout('etc2', 8)], // RGB8_ETC2
  [0x9275, layout('etc2', 8)], // SRGB8_ETC2
  [0x9276, layout('etc2a1', 8)], // RGB8_PUNCHTHROUGH_ALPHA1_ETC2
  [0x9277, layout('etc2a1', 8)], // SRGB8_PUNCHTHROUGH_ALPHA1_ETC2
  [0x9278, layout('etc2a8', 16)], // RGBA8_ETC2_EAC
  [0x9279, layout('etc2a8', 16)], // SRGB8_ALPHA8_ETC2_EAC
  [0x9270, layout('eacr', 8)], // R11_EAC
  [0x9271, layout('eacr-signed', 8)], // SIGNED_R11_EAC
  [0x9272, layout('eacrg', 16)], // RG11_EAC
  [0x9273, layout('eacrg-signed', 16)], // SIGNED_RG11_EAC
])

/** The block layout of a compressed `glInternalFormat`, or null for an uncompressed or unknown one. */
export function gpuBlockLayoutFromGl(internalFormat: number): GpuBlockLayout | null {
  const known = GL_LAYOUTS.get(internalFormat)
  if (known !== undefined) return known
  // RGBA_ASTC_4x4_KHR and SRGB8_ALPHA8_ASTC_4x4_KHR start the two ASTC runs
  const astc = astcBlockFromGl(internalFormat, 0x93b0, 0x93d0)
  return astc === null ? null : layout('astc', 16, { blockWidth: astc[0], blockHeight: astc[1] })
}

/** DXGI formats of the BC1–BC5 layouts above, decoded inline. */
const BC_BY_DXGI = new Map<number, readonly [BcFormat, boolean]>([
  [71, ['DXT1', false]],
  [74, ['DXT3', false]],
  [77, ['DXT5', false]],
  [80, ['BC4', false]],
  [81, ['BC4', true]],
  [83, ['BC5', false]],
  [84, ['BC5', true]],
])

/** One stored level of `internalFormat`, `width` × `height`, decoded to top-to-bottom-as-stored RGBA8. */
export async function decodeGlCompressed(
  payload: Uint8Array,
  internalFormat: number,
  width: number,
  height: number,
): Promise<RgbaImage> {
  const found = gpuBlockLayoutFromGl(internalFormat)
  if (found === null)
    throw new RangeError(
      `GL internal format 0x${internalFormat.toString(16)} is not a known compressed format`,
    )
  if (found.kind !== 'dds')
    return decodeGpuPayload(payload, found, width, height, 'GL', () => {
      throw new Error('a non-BC layout never reaches the DDS decoder')
    })
  const bc = BC_BY_DXGI.get(found.dxgiFormat ?? -1)
  if (bc !== undefined) {
    const required = Math.ceil(width / 4) * Math.ceil(height / 4) * found.blockBytes
    if (payload.byteLength < required) throw new RangeError('truncated GL BC block payload')
    return { width, height, pixels: decodeBcSurface(payload, 0, width, height, bc[0], bc[1]) }
  }
  const wasm = await import('./gpu-texture-wasm.js')
  const bgra = await (found.dxgiFormat === 98 ? wasm.decode_bc7 : wasm.decode_bc6)(
    payload,
    width,
    height,
  )
  if (bgra === null) throw new Error('GL BPTC decode failed')
  return { width, height, pixels: bgraToRgba(bgra, width, height, 'GL BPTC') }
}
