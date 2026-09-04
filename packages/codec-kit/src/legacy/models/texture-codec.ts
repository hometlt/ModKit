import type { NormalMapFormat } from './material.js'
import type { TextureDecoderResult } from '../../legacy-model-support.js'

export interface DecodedTextureMip {
  width: number
  height: number
  /** Byte range inside the original file bytes. */
  offset: number
  length: number
}

export interface DecodedTexture extends TextureDecoderResult {
  /** Source format tag, e.g. 'dxt5', 'bc5', 'rgba8', 'png', 'tga'. */
  format: string
  /**
   * Present when this decode is an intentionally downscaled preview rather
   * than the full source image. Callers can use it for fast first paint and
   * then schedule a full decode off the critical path.
   */
  preview?: {
    sourceWidth: number
    sourceHeight: number
    /** Source-native preview level, e.g. DDS mip index. */
    level?: number
    reason: 'codec-preview'
  }
  /**
   * Present for block-compressed sources: raw mip layout inside the original
   * bytes, so the GPU upload path can submit compressed data + file mip chains
   * instead of the CPU-decoded RGBA fallback.
   */
  compressed?: { format: string; snorm?: boolean; mipLevels: DecodedTextureMip[] }
  /**
   * Decode convention to use when this texture is bound as a normal map
   * (P4 1.9 swizzle table): dxt5nm → (w,y), bc5 → (x,y), rgb8 → xyz.
   */
  normalMapFormat: NormalMapFormat
}

export interface TextureCodec {
  readonly id: string
  /** Lowercase extensions with the leading dot, e.g. [".dds"]. */
  readonly extensions: readonly string[]
  canDecode(header: Uint8Array): boolean
  decode(bytes: Uint8Array, hint?: string): DecodedTexture
  /**
   * Optional fast preview decode. Codecs should implement this only when they
   * can avoid full-resolution work, e.g. by decoding a lower source mip.
   * Return undefined when no cheaper preview is available.
   */
  decodePreview?(
    bytes: Uint8Array,
    hint: string | undefined,
    options: TexturePreviewDecodeOptions,
  ): DecodedTexture | undefined
}

export interface TexturePreviewDecodeOptions {
  /** Maximum preferred width/height for first-paint previews. */
  maxDimension: number
}

export interface TextureDecodeDiagnostic {
  code: string
  message: string
}

export type TextureDecodeResult =
  { ok: true; texture: DecodedTexture } | { ok: false; diagnostic: TextureDecodeDiagnostic }

/** Map a source format tag onto the normal-map decode convention (P4 1.9). */
export function classifyNormalMapFormat(formatTag: string): NormalMapFormat {
  if (formatTag === 'bc5') return 'bc5'
  // SC2 normal maps ship as DXT5nm (x in alpha, y in green).
  if (formatTag === 'dxt5') return 'dxt5nm'
  return 'rgb8'
}
