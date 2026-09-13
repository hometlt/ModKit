import type { Diagnostic } from '@modkit/core'
import type { Lease, Page, PageRequest } from './asset-capabilities/data-sources.js'
import type {
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelPrimitiveRequest,
  ModelSceneInfo,
} from './asset-capabilities/media-data-sources.js'
import type {
  ModelAnimationClip,
  ModelBoneBinding,
  ModelMaterialRef,
  ModelResourceRef,
  ModelSocketRef,
} from './asset-capabilities/model-facet-sources.js'
import type { LogicalResourceRequirement } from './resource-session.js'
import type { RasterResourceRequest, RasterResourceResult } from './raster-resources.js'

export interface ModelResourceRequest {
  readonly requirement: LogicalResourceRequirement
  readonly maxBytes: number
  /** Explicit native conversion scale. Omit when the source does not prove physical meters. */
  readonly metersPerSourceUnit?: number
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
  /** Common scene facet retained from the exported, independently reopened UVM session. */
  sceneInfo?(signal?: AbortSignal): Promise<ModelSceneInfo>
  nodes?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelNode>>
  meshes?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelMesh>>
  primitive?(
    primitiveId: string,
    request: ModelPrimitiveRequest,
    signal?: AbortSignal,
  ): Promise<ModelPrimitive>
  skeletonBindings?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelBoneBinding>>
  animationClips?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelAnimationClip>>
  materials?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelMaterialRef>>
  resourceReferences?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelResourceRef>>
  sockets?(request: PageRequest, signal?: AbortSignal): Promise<Page<ModelSocketRef>>
  readRaster(request: RasterResourceRequest, signal?: AbortSignal): Promise<RasterResourceResult>
  acquire(request: ModelResourceRequest, signal?: AbortSignal): Promise<Lease<ModelResourceAsset>>
}
export interface ModelResourcePort {
  acquire(request: ModelResourceRequest, signal?: AbortSignal): Promise<Lease<ModelResourceAsset>>
}
