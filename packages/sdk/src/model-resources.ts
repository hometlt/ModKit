import type { Diagnostic } from '@modkit/core'
import type { Lease } from './asset-capabilities/data-sources.js'
import type { LogicalResourceRequirement } from './resource-session.js'
import type { RasterResourceRequest, RasterResourceResult } from './raster-resources.js'

export interface ModelResourceRequest {
  readonly requirement: LogicalResourceRequirement
  readonly maxBytes: number
  /** Explicit native conversion scale; already-normalized UVM ignores this value. */
  readonly metersPerSourceUnit: number
}
export type ModelResourceResult =
  | {
      readonly state: 'converted'
      readonly bytes: Uint8Array
      readonly sourceKey: string
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly state: 'unresolved'; readonly diagnostics: readonly Diagnostic[] }

/** A scoped read-only child asset. Release also closes all of its descendants. */
export interface ModelResourceAsset {
  readonly result: ModelResourceResult
  readRaster(request: RasterResourceRequest, signal?: AbortSignal): Promise<RasterResourceResult>
  acquire(request: ModelResourceRequest, signal?: AbortSignal): Promise<Lease<ModelResourceAsset>>
}
export interface ModelResourcePort {
  acquire(request: ModelResourceRequest, signal?: AbortSignal): Promise<Lease<ModelResourceAsset>>
}
