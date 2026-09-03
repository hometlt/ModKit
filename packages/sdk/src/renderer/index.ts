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

/**
 * How a material turns geometry into colour.
 *
 * `unlit` is what every provider did before shading existed — the base colour, flat — and stays the
 * default so a scene written against the first version of this contract renders identically. A
 * material asking for `lambert` is asking for the scene's light to be applied, and a provider that
 * cannot shade says so with a diagnostic and falls back to `unlit` rather than refusing the frame.
 */
export type SceneRendererShadingModel = 'unlit' | 'lambert'

/** Sampler behaviour outside the unit UV square. */
export type SceneRendererTextureWrap = 'repeat' | 'clamp'

/**
 * Decoded texels a renderer samples, owned by the scene for the duration of one render call.
 *
 * RGBA8 and nothing else, for the same reason `outputKind` is: the decoding of a native texture
 * container belongs to whoever published it, and a renderer that had to know DDS, BLP or PNG would
 * be a second codec host. The producer hands over pixels; this contract carries them.
 */
export interface SceneRendererTexture {
  readonly id: string
  readonly width: number
  readonly height: number
  /** Tightly packed row-major RGBA8 texels, `width * height * 4` bytes, top-left origin. */
  readonly rgba: Uint8Array
  readonly wrapU?: SceneRendererTextureWrap
  readonly wrapV?: SceneRendererTextureWrap
}

export interface SceneRendererMaterial {
  readonly id: string
  readonly baseColor: SceneRendererColor
  /**
   * Id of a `SceneRendererScene.textures` entry modulated with `baseColor`.
   *
   * Named rather than inlined so one texture serves many materials without being copied, and so a
   * material whose texture failed to decode is still a material: the reference dangles, the
   * renderer reports `…/texture-missing` and draws the base colour.
   */
  readonly baseColorTexture?: string
  /** Defaults to `unlit`, which is exactly the behaviour of the first version of this contract. */
  readonly shading?: SceneRendererShadingModel
  /** Draw back faces too. Absent means the provider's own default, as before. */
  readonly doubleSided?: boolean
}

/**
 * One directional light, in world space.
 *
 * A single light rather than a list: the parity target is a shaded model with readable form, which
 * one key light plus an ambient term gives, and a light *graph* belongs with the scene-node work
 * the draft contract describes rather than in the minimum slice that makes shading possible.
 */
export interface SceneRendererDirectionalLight {
  /** Points from the surface towards the light. Normalised by the renderer if it is not already. */
  readonly direction: readonly [number, number, number]
  readonly color?: SceneRendererColor
  /** Fraction of base colour surviving where the light does not reach. Defaults to 0.25. */
  readonly ambient?: number
}

/** Existing decoded primitive plus an optional column-major model transform. */
export interface SceneRendererPrimitive extends ModelPrimitive {
  readonly transform?: Float32Array
}

/** Bounded snapshot consumed by one render call; the renderer does not retain it. */
export interface SceneRendererScene {
  readonly primitives: readonly SceneRendererPrimitive[]
  readonly materials?: readonly SceneRendererMaterial[]
  /** Texel sources named by `SceneRendererMaterial.baseColorTexture`. */
  readonly textures?: readonly SceneRendererTexture[]
  /** Absent means unlit, whatever the materials ask for: no light, no shading. */
  readonly light?: SceneRendererDirectionalLight
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

// ---------------------------------------------------------------------------------------------
// the consumer half of the same contract

/** An activated renderer and the release that ends its lease. */
export interface SceneRendererLease {
  readonly renderer: SceneRenderer
  release(): Promise<void>
}

/**
 * The answer to one acquisition, refusal included.
 *
 * `unresolved` is a *stated* outcome carrying the reason, not an exception and not an empty
 * optional: a viewer that degrades to its own fallback has to be able to say why it did, and
 * "no provider offered rgba8 in this realm" and "the provider refused activation" are different
 * sentences a user is entitled to read.
 */
export type SceneRendererAcquisition =
  | Readonly<{
      readonly state: 'resolved'
      readonly lease: SceneRendererLease
      readonly diagnostics: readonly SceneRendererDiagnostic[]
    }>
  | Readonly<{
      readonly state: 'unresolved'
      readonly diagnostics: readonly SceneRendererDiagnostic[]
    }>

export interface SceneRendererAcquireRequest {
  readonly outputKind: SceneRendererOutputKind
  readonly rendererId?: string
  readonly signal?: AbortSignal
}

/**
 * What a host hands a consumer that may want a renderer.
 *
 * The consumer — a viewer, an export command, a headless prober — never composes an inventory, a
 * grant or an execution backend of its own; it holds this and nothing else. The single first-party
 * implementation wraps the host's `resolveSceneRenderer`, so "the viewer asks for a provider" and
 * "the standard resolver selects one" remain the same sentence, and a page that must not hold host
 * authority still cannot obtain one by construction: it is given a port or it is not.
 */
export interface SceneRendererPort {
  acquire(request: SceneRendererAcquireRequest): Promise<SceneRendererAcquisition>
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
