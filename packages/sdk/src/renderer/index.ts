/**
 * Protocol-neutral 3D scene rendering contract.
 *
 * Decoders and renderers stay independent: a consumer assembles a bounded snapshot from the
 * existing model-scene source, then sends typed geometry and a camera to the selected renderer.
 * The result is an owned RGBA frame that can cross the capability RPC unchanged.
 */

import type { ModelPrimitive } from '../asset-capabilities/media-data-sources.js'
import type { ModelMaterialRef } from '../asset-capabilities/model-facet-sources.js'
import type {
  CompressedTextureDescriptorV1,
  RasterImageInfo,
} from '../asset-capabilities/media-data-sources.js'
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
/**
 * `pbr` is glTF metallic-roughness (`SceneRendererMaterial.pbr`, the one BRDF of codec-kit
 * model-math/pbr) under the scene light; like `lambert`, it needs a light and is unlit without one.
 */
export type SceneRendererShadingModel = 'unlit' | 'lambert' | 'pbr'

/** glTF metallic-roughness inputs of a `pbr` material; textures are scene texture ids. */
export interface SceneRendererPbr {
  readonly metallic: number
  readonly roughness: number
  /** glTF metallicRoughnessTexture: blue scales metallic, green roughness. */
  readonly metallicRoughnessTexture?: string
  /** glTF occlusionTexture (red), scaled by `occlusionStrength` (default 1); darkens the ambient. */
  readonly occlusionTexture?: string
  readonly occlusionStrength?: number
  /** Emitted colour, RGB 0..1 in the base colour's space; multiplies `emissiveTexture`. */
  readonly emissive?: readonly [number, number, number]
  readonly emissiveTexture?: string
  /**
   * glTF normalTexture in tangent space (+Y up), scaled in X and Y by `normalScale` (default 1). The
   * tangent frame is the primitive's TANGENT, or one derived from its UVs as glTF viewers do.
   */
  readonly normalTexture?: string
  readonly normalScale?: number
}

/** glTF-style coverage: opaque ignores alpha, mask tests it, blend uses source-over. */
export type SceneRendererAlphaMode = 'opaque' | 'mask' | 'blend'

/** Sampler behaviour outside the unit UV square. */
export type SceneRendererTextureWrap = 'repeat' | 'clamp'

/**
 * Decoded texels a renderer samples, owned by the scene for the duration of one render call.
 *
 * RGBA8, or the GPU's own compressed blocks (`compressed`), for the same reason `outputKind` is
 * narrow: the decoding of a native texture container belongs to whoever published it, and a
 * renderer that had to know DDS, BLP or PNG would be a second codec host. Block formats are the
 * hardware's, not a container's: the producer takes them out of the file, the renderer uploads them.
 */
export interface SceneRendererTexture {
  /** Defaults to 2d. Cube images contain six square faces in +X,-X,+Y,-Y,+Z,-Z order. */
  readonly dimension?: '2d' | 'cube'
  /** Decoder-supplied storage facts; the material vocabulary assigns their interpretation. */
  readonly channelLayout?: RasterImageInfo['channelLayout']
  readonly compression?: RasterImageInfo['compression']
  readonly id: string
  readonly width: number
  readonly height: number
  /** Tightly packed row-major RGBA8 texels, top-left origin. A 2D image has width * height * 4
   * bytes; a cube has six such faces concatenated without padding. Empty when `compressed` carries
   * the texture. */
  readonly rgba: Uint8Array
  /**
   * The stored GPU blocks instead of texels: one layer and face of a 2D texture, the level of
   * `width` x `height` first and each smaller stored level after it, top-left origin as `rgba`.
   * A renderer uploads them where the GPU takes the format and decodes them where it does not.
   */
  readonly compressed?: CompressedTextureDescriptorV1
  readonly wrapU?: SceneRendererTextureWrap
  readonly wrapV?: SceneRendererTextureWrap
  /** Explicit first-surface filtering. Material programs default to linear in both providers. */
  readonly filter?: 'nearest' | 'linear'
}

export interface SceneRendererSimpleEffect {
  /** Fragment coordinates use a bottom-left viewport origin; threshold is the larger dimension in pixels. */
  readonly screenUv?: {
    readonly offset: readonly [number, number]
    readonly tiling: readonly [number, number]
    readonly angle: number
    readonly threshold: number
  }
  /** `additive` retains SRC_COLOR, ONE; `additive-one-one` adds source RGB without weighting. */
  readonly blend:
    | 'opaque'
    | 'alpha-test'
    | 'blend'
    | 'premultiplied'
    | 'additive'
    | 'additive-one-one'
    | 'add-alpha'
    | 'modulate'
    | 'modulate2x'
  readonly depthTest: boolean
  readonly depthWrite: boolean
  readonly doubleSided: boolean
  readonly alphaCutoff: number
  readonly textureResource?: string
  readonly wrapU: 'repeat' | 'clamp'
  readonly wrapV: 'repeat' | 'clamp'
}
export interface SceneRendererMaterial {
  /** Optional instance playback/lighting context, e.g. the age of a nested model particle. */
  readonly context?: SceneRendererMaterialContext
  /** Explicit unlit texel-times-RGBA draw. Authored shader may remain for scoped resources. */
  readonly simpleEffect?: SceneRendererSimpleEffect
  readonly id: string
  readonly baseColor: SceneRendererColor
  /** Defaults to opaque. Blend draws after solid geometry, without writing depth. */
  readonly alphaMode?: SceneRendererAlphaMode
  /** Nonnegative mask threshold, default 0.5. Values above 1 discard the entire material. */
  readonly alphaCutoff?: number
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
  /** Metallic-roughness inputs, read when `shading` is `pbr`; textures use the base-colour UVs. */
  readonly pbr?: SceneRendererPbr
  /**
   * Team colour as `UV_game_material_team_color` states it (SPEC_UVM §11.2). The base route draws
   * it; a material program states its own team colour. The colour is the draw's
   * `materialContext.teamColor`, else `defaultColor`.
   */
  readonly teamColor?: SceneRendererTeamColor
  /** Whether the draw writes depth; absent follows `alphaMode` (opaque and mask write, blend does not). */
  readonly depthWrite?: boolean
  /** Among blended draws, a higher priority draws later; equal priorities keep back-to-front. */
  readonly priority?: number
  /** Inert, publisher-qualified material vocabulary, as published by model-material-source.
   * A provider must report an unsupported shader and use the base-color fallback explicitly.
   */
  readonly shader?: NonNullable<ModelMaterialRef['shader']>
  /** Logical shader resource ids bound to already decoded scene texture ids; no path authority. */
  readonly textureBindings?: readonly {
    readonly resourceId: string
    readonly textureId: string
  }[]
}

/** Where a material's team colour applies and how it combines (`UV_game_material_team_color`). */
export interface SceneRendererTeamColor {
  /**
   * `whole` tints the entire material; a mask texture (a scene texture id, sampled with the
   * base-colour UVs) weighs it by one channel, or per channel with `rgb`.
   */
  readonly mask:
    | 'whole'
    | Readonly<{ readonly texture: string; readonly channel: 'r' | 'g' | 'b' | 'a' | 'rgb' }>
  readonly blend: 'multiply' | 'add' | 'replace' | 'overlay' | 'lerp'
  /** Weight of the blend, default 1. */
  readonly strength?: number
  /** RGB in 0..1, as `materialContext.teamColor`, when the draw names none; default white. */
  readonly defaultColor?: readonly [number, number, number]
  /** `object-tint`: the colour is the object's tint, which then tints nothing else of this material. */
  readonly source?: 'team' | 'object-tint'
  /** `mask-rgb`: the colour times the mask texel's colour; the channel still weighs it. */
  readonly tint?: 'mask-rgb'
  /**
   * The mask texture's texels whose key channels are all at most `threshold` (stored 8-bit) take
   * the colour times their `intensity` channel; the others keep theirs (Emperor's blue key).
   */
  readonly key?: Readonly<{
    readonly channels: readonly ('r' | 'g' | 'b')[]
    readonly threshold: number
    readonly intensity: 'r' | 'g' | 'b' | 'a'
  }>
  /**
   * The mask channel holds palette indices, floor(sample × `scale` + 0.5), read nearest: an index from
   * `first` on takes `shades[index − first]` (or the draw's `teamRamp` of as many), any other keeps
   * its colour.
   */
  readonly ramp?: Readonly<{
    readonly shades: readonly (readonly [number, number, number])[]
    readonly first: number
    readonly scale: number
  }>
}

/** Explicit mapping for environment materials. Supplied by the scene, never inferred from a file. */
export interface SceneRendererEnvironment {
  /** Finite affine column-major 4x4. The render-material vocabulary transforms both the world
   * normal and unit eye-to-surface vector with w=1 before reflection, retaining affine offsets.
   * Matrices whose affine row bounds permit float32 reflection overflow are refused. */
  readonly worldToEnvironment: readonly number[]
}

export interface SceneRendererMaterialContext {
  /** Elapsed time for independent concurrent material tracks. Defaults to zero. */
  readonly time?: number
  /** Clip-local time. Defaults to time. */
  readonly sequenceTime?: number
  /** The selected index in the shader vocabulary's sequence table. */
  readonly sequenceIndex?: number
  readonly teamColor?: readonly [number, number, number]
  /**
   * A player's own shades for a material's indexed team-colour ramp (`SceneRendererTeamColor.ramp`),
   * used in its place when as long; another length keeps the material's shades.
   */
  readonly teamRamp?: readonly (readonly [number, number, number])[]
  /**
   * Exponent on the texel alpha of diffuse team-color layers, default 1. 0 marks an object
   * without team color (such layers keep their texel color). Only 0 and 1 are accepted.
   */
  readonly teamColorIntensity?: number
  readonly ambient?: SceneRendererColor
  readonly environment?: SceneRendererEnvironment
  /**
   * World scene lighting (fixed sun + ambient color) instead of the viewer's camera headlight model.
   * The renderer supplies the scene ambient and light colors per draw.
   */
  readonly sceneLighting?: boolean
}

/**
 * One directional light, in world space.
 *
 * A single light rather than a list: the parity target is a shaded model with readable form, which
 * one key light plus an ambient term gives, and a light *graph* belongs with the scene-node work
 * the draft contract describes rather than in the minimum slice that makes shading possible.
 */
export interface SceneRendererDirectionalLight {
  /** World-space direction from the surface towards the light. Normalised by the renderer. */
  readonly direction: readonly [number, number, number]
  readonly color?: SceneRendererColor
  /** Fraction of base colour surviving where the light does not reach. Defaults to 0.25. */
  readonly ambient?: number
}

/** Explicit world-space preview lights. The shared preview pass averages at most four lights;
 * material-specific shaders retain their own lighting model and the primary `light` input. */
export interface SceneRendererLight {
  readonly type: 'directional' | 'point' | 'spot'
  /** Surface-to-light for directional lights; emitted ray direction for spot lights. */
  readonly direction: readonly [number, number, number]
  readonly color: readonly [number, number, number]
  readonly position?: readonly [number, number, number]
  readonly range?: number
  readonly attenuationStart?: number
  readonly attenuationEnd?: number
  readonly decayExponent?: number
  /** Full cone angles in radians, matching the common preview vocabulary. */
  readonly innerConeAngle?: number
  readonly outerConeAngle?: number
}

/** Existing decoded primitive plus an optional column-major model transform. */
export interface SceneRendererPrimitive extends ModelPrimitive {
  /**
   * Instance color multiplier after material shading. Its alpha fades the primitive (a clip's
   * fractional visibility): coverage after the material's own alpha rule, so a primitive below 1
   * draws blended, back to front, whatever its material's alpha mode; depth writing stays the
   * material's.
   */
  readonly tint?: readonly [number, number, number, number]
  /** Draw-local polygon offset. Units are steps in the provider depth representation; absent disables it. */
  readonly depthBias?: { readonly slopeScale: number; readonly units: number }
  readonly transform?: Float32Array
}

/** Bounded snapshot consumed by one render call; the renderer does not retain it. */
export interface SceneRendererScene {
  readonly primitives: readonly SceneRendererPrimitive[]
  readonly materials?: readonly SceneRendererMaterial[]
  /** Texel sources named by `SceneRendererMaterial.baseColorTexture`. */
  readonly textures?: readonly SceneRendererTexture[]
  /** Base-colour Lambert materials require this light. Game-material vocabularies can supply
   * their own default: modkit.render-material.v1 uses world direction [0, 0, 1] when absent. */
  readonly light?: SceneRendererDirectionalLight
  readonly lights?: readonly SceneRendererLight[]
  readonly ambientLight?: readonly [number, number, number]
  readonly materialContext?: SceneRendererMaterialContext
}

export interface SceneRendererCamera {
  /** Column-major 4x4 view-projection matrix. */
  readonly viewProjection: Float32Array
  /** World-to-view frame for material lighting, Fresnel and generated texture coordinates. */
  readonly viewMatrix?: Float32Array
  /** Explicit world-space observer for environment reflection. This does not alter projection
   * or the existing lighting/viewMatrix behavior. Required by world-environment reflection. */
  readonly eyePosition?: readonly [number, number, number]
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
  /** Owned top-left, row-major straight RGBA8. Fully transparent pixels have zero RGB. */
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
