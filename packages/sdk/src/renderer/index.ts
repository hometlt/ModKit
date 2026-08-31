/**
 * Protocol-neutral 3D scene rendering contract.
 *
 * Decoders and renderers stay independent: a consumer assembles a bounded snapshot from the
 * existing model-scene source, then sends typed geometry and a camera to the selected renderer.
 * The result is an owned RGBA frame that can cross the capability RPC unchanged.
 */

import type { ModelPrimitive } from '../asset-capabilities/media-data-sources.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for renderer-neutral 3D scene frames. */
export const SCENE_RENDERER_CONTRACT = 'common.render/scene-3d' as const

/** Host-owned matcher profile for renderer id and output routing. */
export const SCENE_RENDERER_MATCHER_PROFILE = 'modkit/scene-renderer-matcher' as const

export type SceneRendererOutputKind = 'rgba8'

/** Linear RGBA color with components in the inclusive range 0..1. */
export type SceneRendererColor = readonly [number, number, number, number]

export interface SceneRendererMaterial {
  readonly id: string
  readonly baseColor: SceneRendererColor
}

/** Existing decoded primitive plus an optional column-major model transform. */
export interface SceneRendererPrimitive extends ModelPrimitive {
  readonly transform?: Float32Array
}

/** Bounded snapshot consumed by one render call; the renderer does not retain it. */
export interface SceneRendererScene {
  readonly primitives: readonly SceneRendererPrimitive[]
  readonly materials?: readonly SceneRendererMaterial[]
}

export interface SceneRendererCamera {
  /** Column-major 4x4 view-projection matrix. */
  readonly viewProjection: Float32Array
}

export interface SceneRendererViewport {
  readonly width: number
  readonly height: number
}

export interface SceneRenderRequest {
  readonly scene: SceneRendererScene
  readonly camera: SceneRendererCamera
  readonly viewport: SceneRendererViewport
  readonly clearColor?: SceneRendererColor
  readonly outputKind: SceneRendererOutputKind
  readonly signal?: AbortSignal
}

export type SceneRendererDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface SceneRendererDiagnostic {
  readonly severity: SceneRendererDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly primitiveId?: string
}

export interface SceneRendererStatistics {
  readonly primitives: number
  readonly triangles: number
  readonly fragments: number
}

export interface SceneRenderFrame {
  readonly outputKind: SceneRendererOutputKind
  readonly width: number
  readonly height: number
  /** Tightly packed row-major RGBA8 pixels owned by this frame. */
  readonly rgba: Uint8Array
  readonly diagnostics: readonly SceneRendererDiagnostic[]
  readonly statistics: SceneRendererStatistics
}

/** Activated renderer surface, independent of DOM, canvas and a particular graphics API. */
export interface SceneRenderer {
  readonly contract: typeof SCENE_RENDERER_CONTRACT
  readonly rendererId: string
  readonly outputKinds: readonly SceneRendererOutputKind[]
  render(request: SceneRenderRequest): Promise<SceneRenderFrame>
}

/** JSON-safe route advertised by a renderer contribution. */
export interface SceneRendererOfferFacet {
  readonly rendererIds: readonly string[]
  readonly outputKinds: readonly SceneRendererOutputKind[]
}

/** JSON-safe route supplied by a headless or interactive render consumer. */
export interface SceneRendererRequestFacet {
  readonly rendererId?: string
  readonly outputKind: SceneRendererOutputKind
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.render/scene-3d': { 1: SceneRenderer }
  }

  interface ContractRequestMap {
    'common.render/scene-3d': {
      1: { presence: 'required'; facet: SceneRendererRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.render/scene-3d': {
      1: { presence: 'required'; facet: SceneRendererOfferFacet }
    }
  }
}

export type SceneRendererProviderModule = ServiceProviderModule<typeof SCENE_RENDERER_CONTRACT, 1>
