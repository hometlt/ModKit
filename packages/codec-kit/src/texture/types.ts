import type { AssetResolver, CompanionSpec } from '../legacy/assets/index.js'
import type {
  CompressedTextureDescriptorV1,
  CompressedTextureFormat,
} from './compressed-texture.js'

/**
 * A decoded raster: what every image codec in this domain returns and what every operation
 * consumes.
 *
 * It is declared here rather than imported because it is this package's own vocabulary. It
 * used to live in `@modkitx/ext-common-images`'s DDS codec and be re-exported from here,
 * which inverted the dependency: the game-neutral package could not name its central type
 * without one extension's codec being installed. The DDS codec now takes it from here, as
 * every other extension codec already takes its domain types from its domain package.
 */
export interface RgbaImage {
  width: number
  height: number
  /** Row-major RGBA8 pixels. Length must be width * height * 4. */
  pixels: Uint8Array
}

/**
 * A decoder for a standard payload that a proprietary container wraps, handed in by the
 * codec that owns the container.
 *
 * Several of the shapes in this package unwrap an ordinary DDS, PNG or TGA payload from
 * behind a game's header, and they used to call those decoders directly. That made a
 * game-neutral package name three formats and hard-require the extension that implements
 * them — the coupling `MODKIT_ARCHITECTURE.md` §6.0 forbids, and the reason
 * `@modkitx/image-processing` could not be installed without `@modkitx/ext-common-images`.
 *
 * Knowing *which* standard payload sits inside a container is the container codec's own
 * knowledge, so the decoder travels with it: a codec lives in an extension and may import
 * DDS, PNG or TGA by name, where this package may not. The shapes here take what they are
 * given and name nothing.
 */
export type EmbeddedImageDecoder = (bytes: Uint8Array) => RgbaImage

/** {@link EmbeddedImageDecoder} for a decoder that may resolve asynchronously. */
export type EmbeddedImageDecoderAsync = (bytes: Uint8Array) => Promise<RgbaImage> | RgbaImage

/**
 * A block-compressing encoder handed in the same way, producing a complete file of the
 * encoder's own format. Callers in this package take only the parts they need from it.
 */
export type EmbeddedImageEncoder = (image: RgbaImage) => Uint8Array

/** Lowercase raster format tag used across the viewer (extension without the dot). */
export type ImageFormat =
  | 'dds'
  | 'tga'
  | 'png'
  | 'jpg'
  | 'webp'
  | 'avif'
  | 'svg'
  | 'emf'
  | 'wmf'
  | 'psd'
  | 'bmp'
  | 'gif'
  | 'ico'
  | 'cur'
  | 'ani'
  | 'pcx'
  | 'tiff'
  | 'hdr'
  | 'exr'
  | 'basis'
  | 'astc'
  | 'pvr'
  | 'pkm'
  | 'shp'
  | 'pal'
  | 'vpl'
  | 'unity'
  | 'uasset'
  | 'ktx'
  | 'ktx2'
  | 'blp'
  | 'rsh'
  | 'wtp'
  | 'rtx'
  | 'rgt'
  | 'tmp'
  | 'cps'
  | 'wsa'
  | 'r8'
  | 'r16'
  | 'slp'
  | 'smx'
  | 'smp'
  | 'sld'
  | 'def'
  | 'gaf'
  | 'ddt'
  | 'bti'
  | 'cub'
  | 'prt'
  | 'mtrl'
  | 'rrtex'
  | 'sst'
  | 'texcache'
  | 'earth-tex'
  | 'diablo3-tex'

/**
 * One row of parsed container metadata. `group` lets the UI cluster fields
 * (e.g. "DDS Header", "PNG Chunks") without the processing layer knowing about panels.
 */
export interface MetadataEntry {
  group: string
  key: string
  value: string
}

/** Everything the viewer shows about an image, computed off the UI thread. */
export interface ImageMetadata {
  format: ImageFormat
  width: number
  height: number
  /** Bits per pixel of the decoded/source representation, when known. */
  bitDepth?: number
  hasAlpha?: boolean
  mipCount?: number
  /** On-disk byte size of the source file. */
  byteSize: number
  /** Human-readable pixel/compression format, e.g. "BC3 / DXT5", "RGBA8". */
  pixelFormat?: string
  /** Complete key→value dump of the parsed header, grouped for display. */
  entries: MetadataEntry[]
  /** Present when the container holds more than one frame (sprite sheet, GIF/ANI/…). */
  frames?: FrameSetInfo
}

/** Frame-enumeration summary for sprite/animation containers — dumb transport data, no pixels. */
export interface FrameSetInfo {
  frameCount: number
  /** Per-frame delay in ms where the container stores timing (GIF/ANI/animated WebP). */
  durations?: number[]
  loop?: boolean
}

export interface EncodeOptions {
  /** For DDS targets: block format. Ignored by other encoders. */
  ddsFormat?: 'dxt1' | 'dxt3' | 'dxt5' | 'rgba8'
  /** For BLP targets: container/pixel layout. Defaults to BLP2 BGRA8. */
  blpFormat?: 'blp1-paletted' | 'blp2-bgra8'
  /** For ICO/CUR targets: icon container type and cursor hotspot. Defaults to ICO. */
  icoFormat?: 'ico' | 'cur'
  cursorHotspotX?: number
  cursorHotspotY?: number
  /** Explicit companion bytes, keyed by role. */
  companions?: Record<string, Uint8Array>
}

export interface ImageDecodeOptions {
  /** Mip level to decode where the format exposes a mip chain. Defaults to 0. */
  mipLevel?: number
  /** Standalone Basis image index. Defaults to 0. */
  imageIndex?: number
  /** KTX2 array layer. Defaults to 0. */
  layer?: number
  /** KTX2 cubemap face. Defaults to 0. */
  face?: number
  /** DDS volume depth slice. Defaults to 0. */
  depthSlice?: number
  /** Frame index for sprite/animation containers. Defaults to 0. */
  frameIndex?: number
  /** Host-provided companion resolver; codecs stay filesystem-free. */
  resolver?: AssetResolver
  /** Explicit companion bytes, keyed by role. Wins over resolver discovery. */
  companions?: Record<string, Uint8Array>
  /** Optional sibling/companion resolver for multi-file texture containers. */
  resolveSibling?: (path: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>
}

/** Options for preserving or producing renderer-neutral GPU block payloads. */
export interface ImageCompressedReadOptions extends ImageDecodeOptions {
  /**
   * Explicit transcode target for supercompressed sources such as Basis Universal.
   * Omit it when source-native blocks should be preserved. A codec must never guess this
   * from the operating system: the active renderer/device chooses the target.
   */
  targetFormat?: CompressedTextureFormat
}

/** Runtime implementation actually selected for an image operation. */
export type ImageImplementationKind = 'software' | 'wasm' | 'gpu-native' | 'external-tool'

/**
 * A format plugin. Native formats (dds/tga/png) ship eagerly; everything else is
 * a separate file loaded lazily by the registry. `decode`/`encode` are optional so a
 * codec can be preview-only or export-only.
 */
export interface ImageCodec {
  readonly id: string
  /** Stable viewer metadata tag when the globally unique registry ID is more specific. */
  readonly metadataFormat?: ImageFormat
  /** Lowercase extensions with the leading dot, e.g. [".dds"]. */
  readonly extensions: readonly string[]
  /** Companion files this codec can use, e.g. a palette for indexed sprites. */
  readonly companions?: readonly CompanionSpec[]
  /** Magic-byte sniff; extension matching handles formats without a magic number. */
  canDecode?(header: Uint8Array): boolean
  /** Bytes → RGBA pixels. Absent for export-only codecs. */
  decode?(
    bytes: Uint8Array,
    hint?: string,
    options?: ImageDecodeOptions,
  ): RgbaImage | Promise<RgbaImage>
  /** Provider-owned runtime classification; unlike badges this is not a support claim. */
  readonly decodeImplementation?:
    | Exclude<ImageImplementationKind, 'gpu-native' | 'external-tool'>
    | ((
        bytes: Uint8Array,
        hint?: string,
        options?: ImageDecodeOptions,
      ) => Exclude<ImageImplementationKind, 'gpu-native' | 'external-tool'>)
  /** Preserve source-native GPU blocks for renderer/headless consumers without forcing RGBA. */
  readCompressed?(
    bytes: Uint8Array,
    hint?: string,
    options?: ImageCompressedReadOptions,
  ): CompressedTextureDescriptorV1 | Promise<CompressedTextureDescriptorV1>
  /**
   * Why this codec has no `decode`, as a stable token for the viewer's diagnostic.
   *
   * Defaults to `<id>-host`, meaning "the host's own image pipeline renders this". A
   * codec that is unrenderable for a different reason — it produces vectors, or only a
   * flattened preview — says so here rather than leaving the registry to keep a table of
   * which format means what.
   */
  readonly decodeUnsupportedReason?: string
  /** RGBA pixels → bytes in this format. Absent for read-only codecs. */
  encode?(image: RgbaImage, options?: EncodeOptions): Uint8Array
  /** Parse the container header into displayable metadata (never throws for a valid image). */
  describe?(bytes: Uint8Array, hint?: string): Omit<ImageMetadata, 'format' | 'byteSize'>
  /** Frame count/timing for containers `decode` can select by `frameIndex`. Cheap — header-only. */
  describeFrames?(bytes: Uint8Array, hint?: string): FrameSetInfo | undefined
}

export interface ImageDecodeDiagnostic {
  code: string
  message: string
}

export type ImageDecodeResult =
  | { ok: true; image: RgbaImage; implementation: ImageImplementationKind }
  | { ok: false; diagnostic: ImageDecodeDiagnostic }
