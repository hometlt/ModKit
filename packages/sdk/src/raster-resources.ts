import type { Diagnostic } from '@modkit/core'
import type {
  CompressedTextureDescriptorV1,
  CompressedTextureFormat,
  RasterImageInfo,
  RasterRegion,
} from './asset-capabilities/media-data-sources.js'
import type { LogicalResourceRequirement, ResourceProvenanceRecord } from './resource-session.js'

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
