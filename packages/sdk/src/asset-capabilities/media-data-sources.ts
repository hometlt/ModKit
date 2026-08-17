/**
 * Presentation-neutral media data sources.
 *
 * Codecs own native parsing and expose these bounded, lazy views. Viewers consume the views and
 * never import a format codec. UVG/UVA/UVV/UVM serializers may be layered over the same views for
 * interchange and caches without forcing an eager conversion during every open.
 */

import type { Page, PageRequest } from './data-sources.js'

export interface EncodedMediaDescriptor {
  readonly mediaType: string
  readonly bytes: bigint
  readonly codecs?: readonly string[]
}

/** Bounded access to the original or a codec-owned encoded representation. */
export interface EncodedMediaSource {
  descriptor(): Promise<EncodedMediaDescriptor>
  read(offset: bigint, length: number, signal?: AbortSignal): Promise<Uint8Array>
}

export type RasterPixelFormat =
  'gray8' | 'gray-alpha8' | 'rgb8' | 'rgba8' | 'bgra8' | 'rgba16' | 'rgba32f'

export interface RasterImageInfo {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly layers: number
  readonly faces: number
  readonly mipLevels: number
  readonly frames: number
  readonly channels: number
  readonly bitDepth: number
  readonly colorSpace: 'srgb' | 'linear' | 'display-p3' | 'unknown'
  readonly alphaMode: 'none' | 'straight' | 'premultiplied' | 'unknown'
  readonly orientation: 'top-left' | 'bottom-left' | 'unknown'
  /** Whether the optional decoded-region method is available. */
  readonly decodedAccess: boolean
}

export interface RasterRegionRequest {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly frame?: number
  readonly mipLevel?: number
  readonly layer?: number
  readonly face?: number
  readonly slice?: number
  readonly pixelFormat: RasterPixelFormat
  readonly maxBytes: number
}

export interface RasterRegion {
  readonly width: number
  readonly height: number
  readonly rowStride: number
  readonly pixelFormat: RasterPixelFormat
  readonly pixels: Uint8Array
}

export interface RasterImageSource {
  info(signal?: AbortSignal): Promise<RasterImageInfo>
  encoded(signal?: AbortSignal): Promise<EncodedMediaSource>
  /** Optional when decoding belongs to a separately selected decoder provider. */
  readRegion?(request: RasterRegionRequest, signal?: AbortSignal): Promise<RasterRegion>
}

export interface VectorSceneInfo {
  readonly width?: number
  readonly height?: number
  readonly viewBox?: readonly [number, number, number, number]
  readonly nodes: number
  readonly paths: number
  readonly shapes: number
  readonly textNodes: number
  readonly gradients: number
}

export interface VectorSceneDocument {
  readonly mediaType: 'image/svg+xml'
  /** Static, script-free UVG-compatible profile safe to render as an isolated image. */
  readonly profile: 'uvg.secure-static.v1'
  readonly text: string
}

export interface VectorSceneSource {
  info(signal?: AbortSignal): Promise<VectorSceneInfo>
  document(signal?: AbortSignal): Promise<VectorSceneDocument>
}

export interface AudioTrackInfo {
  readonly id: string
  readonly codec: string
  readonly channels: number | 'unknown'
  readonly sampleRate: number | 'unknown'
  readonly bitrateKbps?: number
  readonly language?: string
  readonly selected: boolean
}

export interface AudioMediaInfo {
  readonly durationMs: number | 'unknown'
  readonly seekable: boolean
  readonly tracks: readonly AudioTrackInfo[]
  /** Whether the optional bounded PCM method is available. */
  readonly pcmAccess: boolean
}

export interface AudioPcmRequest {
  readonly trackId: string
  readonly fromFrame: bigint
  readonly frameCount: number
  readonly maxBytes: number
}

export interface AudioPcmBlock {
  readonly sampleRate: number
  readonly fromFrame: bigint
  readonly frameCount: number
  readonly channels: readonly Float32Array[]
}

export interface AudioMediaSource {
  info(signal?: AbortSignal): Promise<AudioMediaInfo>
  encoded(trackId?: string, signal?: AbortSignal): Promise<EncodedMediaSource>
  /** Optional when PCM decoding belongs to a separately selected decoder provider. */
  readPcm?(request: AudioPcmRequest, signal?: AbortSignal): Promise<AudioPcmBlock>
}

export interface VideoTrackInfo {
  readonly id: string
  readonly kind: 'video' | 'audio' | 'subtitle' | 'data'
  readonly codec: string
  readonly selected: boolean
  readonly width?: number
  readonly height?: number
  readonly frameRate?: number
  readonly language?: string
}

export interface VideoMediaInfo {
  readonly durationMs: number | 'unknown'
  readonly seekable: boolean
  readonly tracks: readonly VideoTrackInfo[]
  readonly frameAccess: boolean
}

export interface VideoFrameRequest {
  readonly trackId: string
  readonly timestampMs: number
  readonly pixelFormat: RasterPixelFormat
  readonly maxBytes: number
}

export interface VideoFrame extends RasterRegion {
  readonly timestampMs: number
}

export interface VideoMediaSource {
  info(signal?: AbortSignal): Promise<VideoMediaInfo>
  encoded(signal?: AbortSignal): Promise<EncodedMediaSource>
  /** Optional when frame decoding belongs to a separately selected decoder provider. */
  readFrame?(request: VideoFrameRequest, signal?: AbortSignal): Promise<VideoFrame>
}

export type ModelPrimitiveTopology =
  'points' | 'lines' | 'line-strip' | 'triangles' | 'triangle-strip' | 'triangle-fan'

export interface ModelBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

export interface ModelSceneInfo {
  readonly scenes: number
  readonly nodes: number
  readonly meshes: number
  readonly primitives: number
  readonly materials: number
  readonly textures: number
  readonly animations: number
  readonly bounds?: ModelBounds
  /** Metadata-only sources remain useful while buffer resolution is unavailable. */
  readonly geometryAccess: 'decoded' | 'metadata-only'
}

export interface ModelNode {
  readonly id: string
  readonly name?: string
  readonly childIds: readonly string[]
  readonly meshIds: readonly string[]
  /** Column-major 4x4 local transform. */
  readonly transform: readonly number[]
}

export interface ModelMesh {
  readonly id: string
  readonly name?: string
  readonly primitiveIds: readonly string[]
}

export interface ModelPrimitive {
  readonly id: string
  readonly topology: ModelPrimitiveTopology
  readonly positions: Float32Array
  readonly indices?: Uint32Array
  readonly normals?: Float32Array
  readonly textureCoordinates?: Float32Array
  readonly materialId?: string
  readonly bounds?: ModelBounds
}

export interface ModelPrimitiveRequest {
  readonly maxBytes: number
}

export interface ModelSceneSource {
  info(signal?: AbortSignal): Promise<ModelSceneInfo>
  nodes(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelNode>>
  meshes(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelMesh>>
  /** Optional for metadata-only scenes with unresolved or unsupported native buffers. */
  primitive?(
    primitiveId: string,
    request: ModelPrimitiveRequest,
    signal?: AbortSignal,
  ): Promise<ModelPrimitive>
}
