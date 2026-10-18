import type { Diagnostic } from '@modkit/core'
import type {
  CompressedTextureDescriptorV1,
  CompressedTextureFormat,
  RasterImageInfo,
  RasterRegion,
} from './asset-capabilities/media-data-sources.js'
import type { LogicalResourceRequirement, ResourceProvenanceRecord } from './resource-session.js'
import type { SceneRendererTexture } from './renderer/index.js'

/** Copy an admitted raster reply into the renderer's owned, top-left RGBA surface layout.
 * Cube faces stay in +X,-X,+Y,-Y,+Z,-Z order; a partial cube is never a 2D texture.
 * This transport conversion performs no decoding, sampling or material interpretation. */
export function rasterResourceTexture(
  id: string,
  result: Extract<RasterResourceResult, { readonly state: 'decoded' | 'decoded-surfaces' }>,
  maxBytes: number,
): SceneRendererTexture | undefined {
  const faces = result.info.faces ?? 1
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || result.info.orientation === 'unknown' ||
      (faces !== 1 && faces !== 6) || (faces === 6 && result.info.width !== result.info.height)) return undefined
  const surfaces = result.state === 'decoded-surfaces' ? result.surfaces : [{
    subresource: result.subresource ?? { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 },
    region: result.region,
  }]
  const first = surfaces[0]
  if (first === undefined || surfaces.length !== faces ||
      !Number.isSafeInteger(first.subresource.mipLevel) || first.subresource.mipLevel < 0) return undefined
  const { width, height } = first.region
  const rowBytes = width * 4, faceBytes = rowBytes * height, bytes = faceBytes * faces
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      (faces === 6 && width !== height) || !Number.isSafeInteger(bytes) || bytes > maxBytes)
    return undefined
  for (const [face, surface] of surfaces.entries()) {
    const { subresource: selected, region } = surface
    if (selected.face !== face || selected.frame !== 0 || selected.layer !== 0 || selected.slice !== 0 ||
        selected.mipLevel !== first.subresource.mipLevel || region.width !== width || region.height !== height ||
        region.pixelFormat !== 'rgba8' || !Number.isSafeInteger(region.rowStride) || region.rowStride < rowBytes ||
        region.rowStride * (height - 1) + rowBytes > region.pixels.byteLength) return undefined
  }
  const rgba = new Uint8Array(bytes)
  for (const [face, { region }] of surfaces.entries()) for (let row = 0; row < height; row++) {
    const sourceRow = result.info.orientation === 'bottom-left' ? height - row - 1 : row
    const offset = sourceRow * region.rowStride
    rgba.set(region.pixels.subarray(offset, offset + rowBytes), face * faceBytes + row * rowBytes)
  }
  return {
    id, width, height, rgba,
    ...(faces === 6 ? { dimension: 'cube' as const } : {}),
    ...(result.info.channelLayout === undefined ? {} : { channelLayout: result.info.channelLayout }),
    ...(result.info.compression === undefined ? {} : { compression: result.info.compression }),
  }
}

export interface RasterSubresource {
  readonly frame: number
  readonly mipLevel: number
  readonly layer: number
  /** Cube faces use +X, -X, +Y, -Y, +Z, -Z order. */
  readonly face: number
  readonly slice: number
}

/** Omitted coordinates select zero. `face: 'all'` acquires all faces in one codec lease.
 * `mipLevel: 'fit'` selects the most detailed available mip that fits the request byte budget. */
export type RasterResourceSelection = Partial<Omit<RasterSubresource, 'face' | 'mipLevel'>> & {
  readonly face?: number | 'all'
  readonly mipLevel?: number | 'fit'
}

/** Read selected image surfaces through the host's ordinary codec inventory.
 * Logical references use the opened subject's resource origin. Embedded bytes carry no path authority.
 * Pixel ownership and all underlying source/codec leases stay with the host until the result is copied.
 */
export type RasterResourceRequest = {
  readonly maxBytes: number
  readonly selection?: RasterResourceSelection
  /**
   * Block formats the caller takes as stored GPU blocks rather than decoded pixels. An image in
   * one of them is answered `compressed`, and `mipLevel: 'fit'` counts its block bytes, so one
   * budget holds a more detailed level; any other image, or a codec that cannot hand its blocks
   * over, is answered decoded as before.
   */
  readonly compressedFormats?: readonly CompressedTextureFormat[]
} & (
  | { readonly kind: 'logical'; readonly requirement: LogicalResourceRequirement }
  | { readonly kind: 'embedded'; readonly bytes: Uint8Array; readonly mediaType?: string }
)

export type RasterResourceResult =
  | {
      readonly state: 'decoded'
      readonly info: RasterImageInfo
      readonly region: RasterRegion
      readonly subresource?: RasterSubresource
      readonly diagnostics: readonly Diagnostic[]
      readonly provenance?: ResourceProvenanceRecord
    }
  | {
      /** Returned only for an explicit `selection.face: 'all'`, including a one-face image. */
      readonly state: 'decoded-surfaces'
      readonly info: RasterImageInfo
      readonly surfaces: readonly {
        readonly subresource: RasterSubresource
        readonly region: RasterRegion
      }[]
      readonly diagnostics: readonly Diagnostic[]
      readonly provenance?: ResourceProvenanceRecord
    }
  | {
      /**
       * Returned only for a format the request's `compressedFormats` names: the selected level of
       * one layer and face and every smaller level the image stores, as the GPU takes them
       * (`texture` level 0 is the selected level). `subresource` names the selected one.
       */
      readonly state: 'compressed'
      readonly info: RasterImageInfo
      readonly texture: CompressedTextureDescriptorV1
      readonly subresource: RasterSubresource
      readonly diagnostics: readonly Diagnostic[]
      readonly provenance?: ResourceProvenanceRecord
    }
  | {
      readonly state: 'unresolved'
      readonly diagnostics: readonly Diagnostic[]
      readonly provenance?: ResourceProvenanceRecord
    }

/** Optional, subject-bound host capability. Never a filesystem or codec-selection handle. */
export interface RasterResourcePort {
  read(request: RasterResourceRequest, signal?: AbortSignal): Promise<RasterResourceResult>
}
