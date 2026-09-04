import type { EmbeddedImageDecoderAsync, RgbaImage } from './types.js'
import { assertRgba8DecodeWithinLimit, compressedTextureByteLength } from './compressed-texture.js'
import { byteView } from './binary.js'

interface GpuTextureWasmDecoder {
  decode_astc(
    payload: Uint8Array,
    width: number,
    height: number,
    blockWidth: number,
    blockHeight: number,
  ): Promise<Uint8Array | null>
  decode_pvrtc(
    payload: Uint8Array,
    width: number,
    height: number,
    is2bpp: boolean,
  ): Promise<Uint8Array | null>
  decode_etc1(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2a1(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_etc2a8(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacr(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacr_signed(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacrg(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_eacrg_signed(
    payload: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8Array | null>
  decode_atc_rgb4(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
  decode_atc_rgba8(payload: Uint8Array, width: number, height: number): Promise<Uint8Array | null>
}

let gpuTextureWasmPromise: Promise<GpuTextureWasmDecoder> | undefined

function gpuTextureWasm(): Promise<GpuTextureWasmDecoder> {
  gpuTextureWasmPromise ??= import('./gpu-texture-wasm.js')
  return gpuTextureWasmPromise
}

export interface GpuBlockLayout {
  kind:
    | 'dds'
    | 'astc'
    | 'pvrtc2'
    | 'pvrtc4'
    | 'etc1'
    | 'etc2'
    | 'etc2a1'
    | 'etc2a8'
    | 'eacr'
    | 'eacr-signed'
    | 'eacrg'
    | 'eacrg-signed'
    | 'atc-rgb'
    | 'atc-rgba'
  blockWidth: number
  blockHeight: number
  blockBytes: number
  /** Some formats, notably PVRTC, require a minimum encoded block footprint. */
  minimumBlocksWide?: number
  /** Some formats, notably PVRTC, require a minimum encoded block footprint. */
  minimumBlocksHigh?: number
  dxgiFormat?: number
}

export function astcBlockFromGl(
  internalFormat: number,
  rgba4x4: number,
  srgb4x4: number,
): [number, number] | null {
  const index = internalFormat >= srgb4x4 ? internalFormat - srgb4x4 : internalFormat - rgba4x4
  const blocks: Array<[number, number]> = [
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
    [12, 12],
  ]
  return index >= 0 && index < blocks.length ? blocks[index]! : null
}

export function astcBlockFromVk(format: number, astc4x4Unorm: number): [number, number] | null {
  const index = Math.floor((format - astc4x4Unorm) / 2)
  const blocks: Array<[number, number]> = [
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
    [12, 12],
  ]
  return format >= astc4x4Unorm &&
    format <= astc4x4Unorm + blocks.length * 2 - 1 &&
    (format - astc4x4Unorm) % 2 <= 1
    ? (blocks[index] ?? null)
    : null
}

/**
 * Decode one GPU-compressed subresource.
 *
 * `decodeDds` is supplied by the calling codec and is used for exactly one family of
 * layouts: the BCn blocks a DDS decoder already implements, which this function reaches by
 * wrapping the payload in a DX10 header rather than by carrying a second copy of them. Every
 * other layout is decoded here. It is a parameter because a package that imports the DDS
 * codec cannot have that codec's extension be optional — see {@link EmbeddedImageDecoderAsync}.
 */
export async function decodeGpuPayload(
  payload: Uint8Array,
  layout: GpuBlockLayout,
  width: number,
  height: number,
  label: string,
  decodeDds: EmbeddedImageDecoderAsync,
): Promise<RgbaImage> {
  assertRgba8DecodeWithinLimit(width, height)
  const required = compressedTextureByteLength(width, height, 1, {
    width: layout.blockWidth,
    height: layout.blockHeight,
    depth: 1,
    bytes: layout.blockBytes,
    ...(layout.minimumBlocksWide === undefined && !layout.kind.startsWith('pvrtc')
      ? {}
      : { minimumBlocksWide: layout.minimumBlocksWide ?? 2 }),
    ...(layout.minimumBlocksHigh === undefined && !layout.kind.startsWith('pvrtc')
      ? {}
      : { minimumBlocksHigh: layout.minimumBlocksHigh ?? 2 }),
  })
  if (payload.length < required) throw new Error(`truncated ${label} GPU block payload`)
  if (layout.kind === 'dds') {
    if (layout.dxgiFormat === undefined)
      throw new Error(`${label} GPU block layout is missing DXGI mapping`)
    return decodeDds(wrapDx10Dds(width, height, layout.dxgiFormat, payload))
  }
  const decoder = await gpuTextureWasm()
  if (layout.kind === 'astc') {
    return decodeBgraGpuPayload(
      await decoder.decode_astc(payload, width, height, layout.blockWidth, layout.blockHeight),
      width,
      height,
      `${label} ASTC`,
    )
  }
  if (layout.kind === 'pvrtc2' || layout.kind === 'pvrtc4')
    return decodeBgraGpuPayload(
      await decoder.decode_pvrtc(payload, width, height, layout.kind === 'pvrtc2'),
      width,
      height,
      `${label} PVRTC`,
    )
  if (layout.kind === 'etc1')
    return decodeBgraGpuPayload(
      await decoder.decode_etc1(payload, width, height),
      width,
      height,
      `${label} ETC1`,
    )
  if (layout.kind === 'atc-rgb')
    return decodeBgraGpuPayload(
      await decoder.decode_atc_rgb4(payload, width, height),
      width,
      height,
      `${label} ATC RGB`,
    )
  if (layout.kind === 'atc-rgba')
    return decodeBgraGpuPayload(
      await decoder.decode_atc_rgba8(payload, width, height),
      width,
      height,
      `${label} ATC RGBA`,
    )
  if (layout.kind === 'etc2')
    return decodeBgraGpuPayload(
      await decoder.decode_etc2(payload, width, height),
      width,
      height,
      `${label} ETC2`,
    )
  if (layout.kind === 'etc2a1')
    return decodeBgraGpuPayload(
      await decoder.decode_etc2a1(payload, width, height),
      width,
      height,
      `${label} ETC2A1`,
    )
  if (layout.kind === 'etc2a8')
    return decodeBgraGpuPayload(
      await decoder.decode_etc2a8(payload, width, height),
      width,
      height,
      `${label} ETC2A8`,
    )
  if (layout.kind === 'eacr')
    return decodeBgraGpuPayload(
      await decoder.decode_eacr(payload, width, height),
      width,
      height,
      `${label} EAC R11`,
    )
  if (layout.kind === 'eacr-signed')
    return decodeBgraGpuPayload(
      await decoder.decode_eacr_signed(payload, width, height),
      width,
      height,
      `${label} EAC R11 signed`,
    )
  if (layout.kind === 'eacrg')
    return decodeBgraGpuPayload(
      await decoder.decode_eacrg(payload, width, height),
      width,
      height,
      `${label} EAC RG11`,
    )
  if (layout.kind === 'eacrg-signed')
    return decodeBgraGpuPayload(
      await decoder.decode_eacrg_signed(payload, width, height),
      width,
      height,
      `${label} EAC RG11 signed`,
    )
  throw new Error(`${label} GPU block decoder not implemented`)
}

export function wrapDx10Dds(
  width: number,
  height: number,
  dxgiFormat: number,
  payload: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(128 + 20 + payload.length)
  out.set([0x44, 0x44, 0x53, 0x20], 0)
  const dv = byteView(out)
  dv.setUint32(4, 124, true)
  dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, true)
  dv.setUint32(12, height, true)
  dv.setUint32(16, width, true)
  dv.setUint32(20, payload.length, true)
  dv.setUint32(76, 32, true)
  dv.setUint32(80, 0x4, true)
  dv.setUint32(84, fourCC('DX10'), true)
  dv.setUint32(108, 0x1000, true)
  dv.setUint32(128, dxgiFormat, true)
  dv.setUint32(132, 3, true)
  dv.setUint32(136, 0, true)
  dv.setUint32(140, 1, true)
  dv.setUint32(144, 0, true)
  out.set(payload, 148)
  return out
}

export function bgraToRgba(
  bgra: Uint8Array,
  width: number,
  height: number,
  label: string,
): Uint8Array {
  const expected = width * height * 4
  if (bgra.length < expected)
    throw new Error(`${label} decoder returned ${bgra.length} bytes, expected ${expected}`)
  const rgba = new Uint8Array(expected)
  for (let i = 0; i < expected; i += 4) {
    rgba[i] = bgra[i + 2]!
    rgba[i + 1] = bgra[i + 1]!
    rgba[i + 2] = bgra[i]!
    rgba[i + 3] = bgra[i + 3]!
  }
  return rgba
}

function fourCC(s: string): number {
  return (
    s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)
  )
}

function decodeBgraGpuPayload(
  bgra: Uint8Array | null,
  width: number,
  height: number,
  label: string,
): RgbaImage {
  if (!bgra) throw new Error(`${label} decode failed`)
  return { width, height, pixels: bgraToRgba(bgra, width, height, label) }
}
