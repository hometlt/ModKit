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
  /** Meaningful channel layout before RGBA padding/replication. This does not assign material usage. */
  readonly channelLayout?: 'r' | 'rg' | 'rgb' | 'rgba' | 'luminance' | 'luminance-alpha' | 'alpha'
  /** Source block compression, if known; consumers must not infer it from filenames. */
  readonly compression?: 'none' | 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'bc6h' | 'bc7'
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly layers: number
  readonly faces: number
  readonly mipLevels: number
  /**
   * Levels the file stores, when fewer than `mipLevels`: the rest are computed by downscaling the
   * smallest stored level, so an image larger than a viewer's budget still shows. Absent: all stored.
   */
  readonly storedMipLevels?: number
  readonly frames: number
  readonly channels: number
  readonly bitDepth: number
  readonly colorSpace: 'srgb' | 'linear' | 'display-p3' | 'unknown'
  readonly alphaMode: 'none' | 'straight' | 'premultiplied' | 'unknown'
  readonly orientation: 'top-left' | 'bottom-left' | 'unknown'
  /** Whether the optional decoded-region method is available. */
  readonly decodedAccess: boolean
  /**
   * Sub-images of an atlas, in pixels of mip level 0 (a Diablo III texture's animation frames of
   * different sizes). Cropping one is `readRegion` with its rectangle; absent means no atlas.
   */
  readonly atlasRegions?: readonly RasterAtlasRegion[]
  /**
   * The image stores palette indices: `readRegion` with `plane: 'indices'` returns each pixel's
   * index as `gray8` (a team-colour ramp reads them; a resource id names the plane `#plane=indices`).
   */
  readonly indexed?: true
}

export interface RasterAtlasRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** The format's own name or ordinal for the region, when it has one. */
  readonly name?: string
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
  /** `indices`: each pixel's palette index instead of its colour, `gray8` (`RasterImageInfo.indexed`). */
  readonly plane?: 'indices'
  readonly maxBytes: number
}

export interface RasterRegion {
  readonly width: number
  readonly height: number
  readonly rowStride: number
  readonly pixelFormat: RasterPixelFormat
  readonly pixels: Uint8Array
}

/*
 * A compressed texture as the GPU stores it: the blocks of S3TC/RGTC/BPTC/ETC/ASTC/PVRTC, with the
 * block geometry, colour space and alpha mode that say how to upload them. Not a container: a
 * renderer that takes it knows GPU formats, not DDS or KTX. Moved unchanged from codec-kit's image
 * texture profile (MK2 `image.compressed.read`), which re-exports it.
 */
export type CompressedTextureFormat =
  | 'astc-rgba-unorm'
  | 'bc1-rgb-unorm'
  | 'bc1-rgba-unorm'
  | 'bc2-rgba-unorm'
  | 'bc3-rgba-unorm'
  | 'bc4-r-unorm'
  | 'bc4-r-snorm'
  | 'bc5-rg-unorm'
  | 'bc5-rg-snorm'
  | 'bc6h-rgb-ufloat'
  | 'bc6h-rgb-sfloat'
  | 'bc7-rgba-unorm'
  | 'etc1-rgb8-unorm'
  | 'etc2-rgb8-unorm'
  | 'etc2-rgb8a1-unorm'
  | 'etc2-rgba8-unorm'
  | 'eac-r11-unorm'
  | 'eac-r11-snorm'
  | 'eac-rg11-unorm'
  | 'eac-rg11-snorm'
  | 'pvrtc1-rgb-2bpp-unorm'
  | 'pvrtc1-rgba-2bpp-unorm'
  | 'pvrtc1-rgb-4bpp-unorm'
  | 'pvrtc1-rgba-4bpp-unorm'
  | (string & Record<never, never>)

export interface CompressedTextureBlockLayout {
  width: number
  height: number
  depth: number
  bytes: number
  minimumBlocksWide?: number
  minimumBlocksHigh?: number
  minimumBlocksDeep?: number
}

/** One payload in canonical mip -> layer -> face -> depth-slice order. */
export interface CompressedTextureSubresource<TData = Uint8Array> {
  mipLevel: number
  layer: number
  face: number
  depthSlice: number
  width: number
  height: number
  /** Always 1 in v1: volume textures are split into explicitly indexed depth slices. */
  depth: 1
  /** Exact compressed payload for this subresource; never a whole unbounded source file. */
  data: TData
  /** Optional provenance range in the original container. */
  sourceByteRange?: { offset: number; length: number }
}

/** Renderer-neutral data returned by `image.compressed.read`. */
export interface CompressedTextureDescriptorV1<TData = Uint8Array> {
  schemaVersion: 1
  format: CompressedTextureFormat
  dimensions: { width: number; height: number; depth: number }
  mipLevelCount: number
  layerCount: number
  faceCount: number
  colorSpace: 'linear' | 'srgb' | 'unknown'
  alphaMode: 'none' | 'straight' | 'premultiplied' | 'unknown'
  block: CompressedTextureBlockLayout
  subresources: readonly CompressedTextureSubresource<TData>[]
  source: {
    codecId: string
    containerFormat: string
    preservation: 'source-bytes' | 'transcoded'
  }
  notes?: readonly string[]
}

/** Which stored levels of a block-compressed image a raster source hands over. */
export interface CompressedTextureRequest {
  /** The most detailed level wanted; every smaller level the file stores follows it. Default 0. */
  readonly mipLevel?: number
  readonly layer?: number
  readonly face?: number
  /** Bound on the summed block bytes; a source refuses rather than exceed it. */
  readonly maxBytes: number
}

export interface RasterImageSource {
  info(signal?: AbortSignal): Promise<RasterImageInfo>
  encoded(signal?: AbortSignal): Promise<EncodedMediaSource>
  /** Optional when decoding belongs to a separately selected decoder provider. */
  readRegion?(request: RasterRegionRequest, signal?: AbortSignal): Promise<RasterRegion>
  /**
   * The stored blocks of a block-compressed image (`info.compression` other than `none`), without
   * decoding: one layer and face, `mipLevel` and each smaller stored level, in mip order. Levels
   * the source computes rather than stores are not blocks and are not included.
   */
  readCompressed?(
    request: CompressedTextureRequest,
    signal?: AbortSignal,
  ): Promise<CompressedTextureDescriptorV1>
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

/**
 * One decoded window, as a single interleaved buffer.
 *
 * Not an array of per-channel buffers, which is what this carried until Wave 2B. The capability
 * boundary requires every typed array to own its whole buffer, so N channels can never be views
 * over one allocation: they are necessarily N allocations, N encodings and N transferables per
 * window, and the installed VS Code bridge — which turns each frame into a JSON string — paid that
 * N times over. `readRegion` has always returned one `pixels` buffer for the same reason.
 *
 * Samples are interleaved frame-major: frame 0 channel 0, frame 0 channel 1, frame 1 channel 0, …
 * De-interleaving belongs to the consumer, which is also the form `AudioBuffer.copyToChannel`
 * wants a stride into.
 */
export interface AudioPcmBlock {
  readonly sampleRate: number
  readonly fromFrame: bigint
  readonly frameCount: number
  readonly channelCount: number
  /** `frameCount * channelCount` samples in [-1, 1], interleaved frame-major. */
  readonly samples: Float32Array
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

/**
 * Which way is up in the coordinates this scene publishes.
 *
 * A viewer cannot orient geometry it has no orientation for, and guessing gets it wrong half the
 * time: glTF and UVM are y-up, while StarCraft II's M3, Warcraft III's MDX and Diablo III's APP
 * are all z-up. A publisher that omits it is read as `+y`, which is what every consumer assumed
 * before this existed.
 */
export type ModelUpAxis = '+y' | '+z'

export interface ModelSceneInfo {
  readonly scenes: number
  readonly nodes: number
  readonly meshes: number
  readonly primitives: number
  readonly materials: number
  readonly textures: number
  readonly animations: number
  readonly bounds?: ModelBounds
  /** Defaults to `+y` when absent. */
  readonly upAxis?: ModelUpAxis
  /**
   * `left`: the coordinates are left-handed (Direct3D games: Emperor, Westwood), so they are a
   * mirror image of glTF's right-handed frame. A consumer mirrors the axis that is neither up nor
   * sideways - z of a `+y`-up scene, y of a `+z`-up one - before turning it upright; the UVM
   * materializer does it with one mirror node. Defaults to `right` when absent.
   */
  readonly handedness?: 'right' | 'left'
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
  /**
   * The same local transform as translation, unit rotation quaternion `[x, y, z, w]` and scale,
   * when the publisher states it: its format authors TRS, or it decomposes a matrix it knows to be
   * a pure TRS (an HVA section pose). It composes as T · R · S to `transform`. Only a node that
   * carries it can be driven by translation/rotation/scale animation channels on export: a bare
   * matrix is never decomposed implicitly.
   */
  readonly trs?: ModelNodeTrs
  /**
   * The rule the engine turns this node toward the camera by, when it does (`UV_node_billboard`).
   * A renderer applies it every frame for the camera it draws with; the authored pose is what it
   * shows without one.
   */
  readonly billboard?: ModelNodeBillboard
}

/**
 * A camera-facing node, in the vocabulary of `UV_node_billboard` (schema 1).
 *
 * `inverse-camera`: the node's rotation becomes its parent's inverse, the camera's rotation (camera
 * to model frame), the format's ordered `basisRotations` (unit quaternions `[x, y, z, w]`) and then
 * its own — mdx-m3-viewer's skeletal billboard, which turns Warcraft III's and StarCraft II's cards
 * toward the viewer from every side. It applies to a node the skeleton binds.
 * `face-camera`: a rigid node's local +Y faces the camera position about its local `pivot`,
 * turning about local Z (`z`) or pitching about local X first (`xz`).
 * `aim`: a bound joint's world orientation is built from an aim direction d — the camera's view
 * direction (`view`) or the camera's eye to the joint (`eye`), both pointing away from the viewer —
 * in the skeleton's authored frame, with one axis locked (`ModelAimBillboardLock`). A joint without
 * a joint parent then keeps its sampled rotation and takes `rootCorrection`; any other takes
 * `correction` (unit quaternions `[x, y, z, w]`, applied after, in the joint's own axes). A basis
 * whose rows fail to be unit (a lock axis along d) leaves the joint as animated.
 */
export type ModelNodeBillboard =
  | {
      readonly mode: 'inverse-camera'
      readonly basisRotations: readonly (readonly [number, number, number, number])[]
    }
  | {
      readonly mode: 'face-camera'
      readonly rotationAxes: 'z' | 'xz'
      readonly pivot: readonly [number, number, number]
    }
  | {
      readonly mode: 'aim'
      readonly aim: 'view' | 'eye'
      readonly lock: ModelAimBillboardLock
      readonly correction?: readonly [number, number, number, number]
      readonly rootCorrection?: readonly [number, number, number, number]
    }

/**
 * How an `aim` billboard builds its basis (rows are the joint's local X, Y, Z in the frame):
 * - `free`: X = d × up_camera, Y = d, Z = X × d (identity where d is along the camera's up);
 * - `frame-x`: X = frame X, Y = d flattened into YZ (the camera's X where that vanishes), Z = X × Y;
 * - `frame-y`: Y = frame Y, X = d flattened into XZ (the camera's up where that vanishes), Z = X × Y;
 * - `frame-z`: Z = frame Z, Y = d flattened into XY (the camera's up where that vanishes), X = Y × Z;
 * - `own-x`: X = the joint's current X, Y = normalise(X × d), Z = X × Y;
 * - `own-y`: Z = the joint's current Y, X = normalise(Z × d), Y = Z × X.
 */
export type ModelAimBillboardLock = 'free' | 'frame-x' | 'frame-y' | 'frame-z' | 'own-x' | 'own-y'

export interface ModelNodeTrs {
  readonly translation: readonly [number, number, number]
  readonly rotation: readonly [number, number, number, number]
  readonly scale: readonly [number, number, number]
}

export interface ModelMesh {
  readonly id: string
  readonly name?: string
  readonly primitiveIds: readonly string[]
  /**
   * Default weight of each morph target, in target order (glTF `mesh.weights`); every primitive of
   * the mesh carries the same number of targets. Absent with targets present means all zero.
   */
  readonly morphWeights?: readonly number[]
}

/** A blend shape (glTF morph target): per-vertex deltas added in proportion to its weight. */
export interface ModelMorphTarget {
  /** The shape's name (a FACS pose, `Smile`), the same for this target in every primitive. */
  readonly name?: string
  /** Three floats per vertex. */
  readonly positions: Float32Array
  /** Three floats per vertex. */
  readonly normals?: Float32Array
  /** Three floats per vertex: tangent xyz deltas; the handedness does not morph. */
  readonly tangents?: Float32Array
}

export interface ModelPrimitive {
  readonly id: string
  readonly topology: ModelPrimitiveTopology
  readonly positions: Float32Array
  readonly indices?: Uint32Array
  readonly normals?: Float32Array
  /** Four floats per vertex: tangent xyz and bitangent handedness. */
  readonly tangents?: Float32Array
  /** Normalized RGBA, four floats per vertex in the source color space. */
  readonly colors?: Float32Array
  /** UV set zero, retained for consumers that only support one texture coordinate set. */
  readonly textureCoordinates?: Float32Array
  /** Authored UV sets, including set zero when present; each has two floats per vertex. */
  readonly textureCoordinateSets?: readonly {
    readonly set: number
    readonly coordinates: Float32Array
  }[]
  /** Four indices per vertex, resolved against ModelSkeletonSource boneIndex values. */
  readonly boneIndices?: Uint32Array
  /** Four weights per vertex, paired with boneIndices. */
  readonly boneWeights?: Float32Array
  /** Exact hierarchy for boneIndices. Absence leaves the buffers without a portable skin binding. */
  readonly hierarchyId?: string
  readonly materialId?: string
  readonly bounds?: ModelBounds
  /** Blend shapes over these vertices, in the mesh's target order. */
  readonly morphTargets?: readonly ModelMorphTarget[]
  /**
   * Not drawn until an animation clip's `visibility` channel shows it: geometry the game keeps but
   * never draws on its own — an authoring helper box, or an overlay a unit shows only in one state (a
   * Tleilaxu leech on an infected unit). The geometry stays published; a viewer may still offer it.
   * UVM stores it as primitive visibility with value 0 (SPEC_UVM §15.2).
   */
  readonly hidden?: true
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
