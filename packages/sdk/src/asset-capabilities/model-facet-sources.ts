/**
 * Optional versioned model facet sources (block 11, slice 11C0, plan item 11).
 *
 * `common.view/model-scene-source@1` stays exactly as it is: it is the admitted base contract, and
 * nothing here changes, widens or replaces it. These are *additional* small facets a model
 * publisher may offer beside it, on the independent data-source axis — a trait does not promise a
 * source, and a source does not promise an operation or a viewer (§2.6).
 *
 * **Every shape below is derived from a codec that already publishes those facts ad hoc today.**
 * That is the §2.7 rule, applied literally: a facet family with no publisher is not a contract, it
 * is a wish. The publishers, named per facet, are the block-9 model codecs — M3 and W3D texture
 * references, W3X bone provenance, W3D animation channels and mesh collision roles, VXL companion
 * poses, OBJ material libraries, UVM collision volumes and material contracts. Nothing here has a
 * field that no publisher can fill.
 *
 * All five were declared at `publisher-candidate` maturity in slice 11C0. Slice 12-1 admitted four
 * after independent publishers exercised their shapes; skeleton followed only when a publisher
 * M3 reader decoded BONE bindings independently of the SAGE/Westwood W3D/W3X family.
 * `DATA_SOURCE_MATURITY` carries the verdict and reason. Declaring the contract first and migrating
 * publishers second was deliberate: it is the order that let the two be reviewed separately.
 *
 * An absent facet is absent. A publisher that cannot answer does not publish the source, and never
 * publishes it filled with zeroes, empty arrays or invented names.
 */

import type { Page, PageRequest } from './data-sources.js'
import type { JsonValue } from './types.js'

// ---------------------------------------------------------------------------------------------
// resource references — publishers: M3 (`textureReferences`), W3D (`textures` + `textureBindings`)

export type ModelResourceRole = 'texture' | 'sidecar'

/**
 * Where the resource stands, from the model's point of view.
 *
 * `reference-only` is a first-class answer, not a failure: a model that names a texture living in
 * another archive is a complete, readable model, and both M3 and W3D say so today.
 */
export type ModelResourceProvenance = 'reference-only' | 'companion'

export interface ModelResourceRef {
  /** The logical name exactly as the native document spells it; never normalised or resolved. */
  readonly id: string
  readonly role: ModelResourceRole
  readonly provenance: ModelResourceProvenance
  /** Host-minted binding id, present only when the host actually bound this reference. */
  readonly bindingId?: string
  /** Size of the bound resource. Absent for a `reference-only` entry, which has no bytes. */
  readonly bytes?: number
  /** A texture the game loads with a colour key: that colour is transparent (see ModelTextureColorKey). */
  readonly colorKey?: ModelTextureColorKey
  /**
   * The game reads the texture without its stored alpha: every texel is opaque before a colour key,
   * filtering and the material's alpha apply (Emperor). UVM states it as the texture's
   * `UV_texture_alpha`; the image bytes stay as they are.
   */
  readonly ignoreStoredAlpha?: true
  /**
   * How the game samples the texture: `nearest` for pixel art (no blending, no mips that bleed
   * transparent texels into a cut-out). UVM states it as the texture sampler's filters.
   */
  readonly filter?: 'nearest' | 'linear'
}

/**
 * A colour a game's texture loader turns transparent — a DirectDraw/Direct3D colour key. Texels
 * whose stored 8-bit RGB lies within `tolerance` (0 by default: exact) of `color` in every channel
 * become transparent black before the texture is sampled. It is how the game loads the image, not a
 * property of the image file: Emperor: Battle for Dune keys magenta, `[255, 0, 255]`. UVM states it
 * as `UV_texture_color_key` on the texture (SPEC_UVM §11.6).
 */
export interface ModelTextureColorKey {
  /** Stored 8-bit red, green, blue, each 0–255. */
  readonly color: readonly [number, number, number]
  readonly tolerance?: number
}

export interface ModelResourceRefsInfo {
  readonly references: number
  readonly bound: number
  /** True when the publisher stopped at its scan budget rather than reaching the end. */
  readonly truncated: boolean
}

/**
 * The resources a model depends on, as *logical requirements* — `common.view/model-resource-refs-source@1`.
 *
 * The source publishes names and binding facts. It does not open anything: opening a reference
 * discovered after `Codec.open` is the host-owned `ResourceSessionPort`'s job, and a codec,
 * projector, viewer or renderer that constructed a URI of its own would be crossing exactly the
 * line block 9 drew.
 */
export interface ModelResourceRefsSource {
  info(signal?: AbortSignal): Promise<ModelResourceRefsInfo>
  references(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelResourceRef>>
}

// ---------------------------------------------------------------------------------------------
// skeleton — publishers: W3X (`boneName` / `boneProvenance`), W3D (hierarchy pivots)

/**
 * Where a bone name came from, or why there is none.
 *
 * W3X already answers exactly this: `direct` when the document itself declares the hierarchy,
 * `companion` when a bound skeleton does, `absent` when neither — and in the `absent` case the
 * name stays `null`, because a reader that invents a name from a sub-object id is guessing.
 */
export type ModelBoneProvenance = 'direct' | 'companion' | 'absent'

/** Authored default local TRS, in the same space as the scene and animation channels. */
export interface ModelBoneLocalPose {
  readonly translation: readonly [number, number, number]
  readonly rotation: readonly [number, number, number, number]
  readonly scale: readonly [number, number, number]
}

export interface ModelBoneBinding {
  /** The model part this binding belongs to; ids come from the publisher's own part space. */
  readonly partId: string
  readonly boneIndex: number
  /** `null` when nothing named the bone. Never a fabricated name. */
  readonly boneName: string | null
  readonly provenance: ModelBoneProvenance
  /** The hierarchy the index is resolved against, when the publisher names one. */
  readonly hierarchyId?: string
  /** Parent in the same hierarchy. `null` is an explicitly declared root; absent is unknown. */
  readonly parentBoneIndex?: number | null
  /** Native publisher flags, retained without assigning cross-format meaning to unnamed bits. */
  readonly nativeFlags?: number
  /** Names for the native flag bits the publisher understands. */
  readonly flagNames?: readonly string[]
  /** Publisher-native rest/bind matrix with format-specific role/order. Use inverseBindMatrix for portable skin. */
  readonly restMatrix?: readonly number[]
  /** Exact ModelNode id used by portable animation channels; absent means no scene-node join. */
  readonly nodeId?: string
  /** Authored default local pose. This is not an inverse bind matrix or a sampled animation frame. */
  readonly localPose?: ModelBoneLocalPose
  /** Authored column-major affine 4x4 local matrix, alternative to localPose (never both).
   * Supports static full-shear poses. Animation/blending requires an explicitly supported pose
   * representation; a consumer must not decompose this matrix or fabricate a TRS default.
   */
  readonly localMatrix?: readonly number[]
  /** Column-major 4x4 matrix from model-space bind vertices into this bone's bind space. */
  readonly inverseBindMatrix?: readonly number[]
}

export interface ModelSkeletonInfo {
  readonly bindings: number
  readonly named: number
  readonly companionBound: number
  /** Absent when the publisher does not enumerate hierarchies; never reported as zero instead. */
  readonly hierarchies?: number
}

/** Bone bindings and their provenance — `common.view/model-skeleton-source@1`. */
export interface ModelSkeletonSource {
  info(signal?: AbortSignal): Promise<ModelSkeletonInfo>
  bindings(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelBoneBinding>>
}

// ---------------------------------------------------------------------------------------------
// animation — publishers: W3D (clips with channels), VXL (companion HVA pose or track)

/**
 * One frame is a rest pose, not an animation.
 *
 * The VXL codec already refuses to call a single-frame sidecar an animation, and that distinction
 * is the reason this is an enum rather than a boolean `animated`: a bound pose and a bound track
 * are different facts, and collapsing them would report an identity pose as motion.
 */
export type ModelAnimationKind = 'animation' | 'rest-pose'

/** Explicit numerical interpolation; absent means that the channel cannot be sampled generically. */
export type ModelAnimationInterpolation = 'step' | 'linear' | 'spherical-linear' | 'cubic-spline'

export interface ModelAnimationChannel {
  /** What the channel drives, in the publisher's own target space (a W3D pivot, for instance). */
  readonly target: string
  /** The publisher's channel kind, verbatim. A cross-format channel vocabulary is not invented here. */
  readonly kind: string
  readonly axis?: string
  readonly firstFrame: number
  readonly lastFrame: number
  /** Decoded samples. Their values use the publisher's native component order. */
  readonly samples?: readonly ModelAnimationSample[]
  /** Requires sequence-local `timeSeconds` on every sample. Quaternion order is x, y, z, w. */
  readonly interpolation?: ModelAnimationInterpolation
  /** An independent track clock, retained separately from the sequence's looping policy. */
  readonly concurrent?: boolean
  readonly wrapSeconds?: number
  /** Requires concurrent + wrapSeconds. Zero is unbounded; positive values count full cycles. */
  readonly repeatCount?: number
}

export interface ModelAnimationSample {
  /** Index in the clip's ordered sample timeline. */
  readonly frame: number
  /** Native timestamp when the publisher exposes one. */
  readonly timeMilliseconds?: number
  /** Sequence-local time, or the independent clock of a concurrent channel. */
  readonly timeSeconds?: number
  /** Scalar/vector/quaternion components in the publisher's documented order. */
  readonly value: readonly number[]
  /**
   * `cubic-spline` channels only, required on every key: the derivative of `value` per second
   * arriving at and leaving this key, as glTF CUBICSPLINE stores it (the sampler scales it by the
   * key interval). Hermite or Bezier tangents of a format are converted to this by the publisher.
   * A consumer that knows the channel is a rotation renormalizes the result, as glTF requires.
   */
  readonly inTangent?: readonly number[]
  readonly outTangent?: readonly number[]
}

export interface ModelAnimationClip {
  readonly id: string
  readonly name: string
  readonly kind: ModelAnimationKind
  /** `companion` when a bound sidecar supplies the motion, as an HVA does for a VXL. */
  readonly provenance: Exclude<ModelBoneProvenance, 'absent'>
  readonly frames: number
  readonly frameRate?: number
  readonly durationSeconds?: number
  /** Explicit nonnegative sequence key shared with material tracks; independent of clip order. */
  readonly sequenceIndex?: number
  readonly looping?: boolean
  /** Zero means unbounded looping; a positive integer is the authored number of complete cycles. */
  readonly repeatCount?: number
  /**
   * How the clip plays, as UVM's `UV_game_animation_clips` says it: `once`, `loop`, `ping-pong`
   * (forth and back) or `hold` (stays on its last frame). When absent, `looping` decides.
   */
  readonly loop?: 'once' | 'loop' | 'ping-pong' | 'hold'
  /** Playback rate over the authored timing; positive, default 1. */
  readonly speedScale?: number
  /** Among clips eligible at once, the higher wins (StarCraft II selects sequences so); integer. */
  readonly priority?: number
  /** Seconds to blend in from the clip before it, and out to the one after. */
  readonly blendInSeconds?: number
  readonly blendOutSeconds?: number
  /** Moments the game acts on, in time order of the clip. */
  readonly events?: readonly ModelAnimationEvent[]
  readonly movementSpeed?: number
  readonly boundsSphere?: {
    readonly center: readonly [number, number, number]
    readonly radius: number
  }
  readonly hierarchyId?: string
  /** Native inclusive time bounds; distinct from the normalized frame count. */
  readonly nativeTimeBounds?: ModelAnimationTimeBounds
  readonly channels: readonly ModelAnimationChannel[]
  /** Channels the publisher recognised but does not represent; stated rather than dropped. */
  readonly unsupportedChannels?: number
}

/**
 * A moment of a clip the game acts on (UVM `UV_game_animation_events`, SPEC_UVM §12.3): a shot, a
 * sound, a footstep, a variant swap (`swap_variant`). Names outside the registered set are kept.
 */
export interface ModelAnimationEvent {
  /** Seconds from the clip's start. */
  readonly timeSeconds: number
  readonly name: string
  /** The node it happens at (a socket), by facet node id. */
  readonly nodeId?: string
  /** Data only: a consumer never evaluates it as code. */
  readonly payload?: { readonly [key: string]: JsonValue }
  readonly durationSeconds?: number
}

export interface ModelAnimationTimeBounds {
  readonly startMilliseconds: number
  readonly endMilliseconds: number
}

export interface ModelAnimationInfo {
  readonly clips: number
  /** Clips carrying at least one channel; a clip list is not a proof of motion. */
  readonly channelled: number
  readonly companionBound: number
}

/** Animation clips and their channels — `common.view/model-animation-source@1`. */
export interface ModelAnimationSource {
  info(signal?: AbortSignal): Promise<ModelAnimationInfo>
  clips(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelAnimationClip>>
}

// ---------------------------------------------------------------------------------------------
// collision — publishers: UVM (`UV_game_collision` volumes by kind), W3D (mesh collision roles)

/**
 * How the publisher knows this is collision.
 *
 * A declared volume and a mesh flagged as collision geometry are not the same statement, and a
 * consumer that treats a render mesh carrying a collision role as a primitive volume would be
 * wrong about both. UVM publishes the first, W3D the second.
 */
export type ModelCollisionOrigin = 'declared-volume' | 'mesh-role'

export interface ModelCollisionVolume {
  readonly id: string
  /** The publisher's kind, verbatim (`box`, `sphere`, `capsule`, `convex-hull`, `mesh`, …). */
  readonly kind: string
  readonly origin: ModelCollisionOrigin
  /** The mesh carrying the role, for `mesh-role` entries. */
  readonly meshId?: string
  /** Publisher-qualified collision types, where the native format distinguishes them. */
  readonly types?: readonly string[]
  /**
   * The node a declared volume rides on: the materializer writes the volume as its own child of
   * that node, carrying `UV_game_collision` (SPEC_UVM_EXTENSIONS) with `role` and `shape`.
   */
  readonly nodeId?: string
  /** What the volume is for, default `physics`. */
  readonly role?: 'physics' | 'hit' | 'selection' | 'footprint' | 'effect' | 'vision'
  /** Its shape in the frame of `nodeId`. */
  readonly shape?: ModelCollisionShape
}

/**
 * A collision shape in the terms of `UV_game_collision` (SPEC_UVM_EXTENSIONS): `size` full extents
 * of a `box`; `radius` of a `sphere`, `capsule` or `cylinder`, which also take `height` and an `axis`
 * (default `y`); `normal` of a `plane`; the vertices of a `convex-hull` or `mesh` (with its triangle
 * `indices`), which the materializer writes to accessors. `matrix` places it, column-major.
 */
export interface ModelCollisionShape {
  readonly kind: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'convex-hull' | 'mesh' | 'plane'
  readonly matrix?: readonly number[]
  readonly size?: readonly [number, number, number]
  readonly radius?: number
  readonly height?: number
  readonly axis?: 'x' | 'y' | 'z'
  readonly normal?: readonly [number, number, number]
  readonly positions?: Float32Array
  readonly indices?: Uint32Array
  /** Effect collision channel bitmask. */
  readonly collisionMask?: number
}

export interface ModelCollisionInfo {
  readonly volumes: number
  /** Counts per publisher kind — the shape UVM already computes. */
  readonly byKind: Readonly<Record<string, number>>
}

/** Collision volumes and roles — `common.view/model-collision-source@1`. */
export interface ModelCollisionSource {
  info(signal?: AbortSignal): Promise<ModelCollisionInfo>
  volumes(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelCollisionVolume>>
}

// ---------------------------------------------------------------------------------------------
// materials — publishers: OBJ (names and libraries), UVM (per-material extension contracts)

export interface ModelMaterialLayerRef {
  /** Publisher-qualified layer role (`diffuse`, `normal`, `emissive`, …). */
  readonly slot: string
  /** Joins `ModelResourceRef.id` when the layer names a resolved logical resource. */
  readonly resourceId?: string
  /** Publisher-native UV set/source selector. */
  readonly uvSource?: number
  /** Publisher-native colour-channel mask. */
  readonly colorChannels?: number
  /**
   * How the layer combines with what it colours, in UVM terms (SPEC_UVM §11.2): a team-colour mask
   * that mixes the team colour in by its alpha is `lerp`; `multiply` when absent.
   */
  readonly blend?: 'multiply' | 'add' | 'replace' | 'overlay' | 'lerp'
  readonly nativeFlags?: number
  readonly flagNames?: readonly string[]
  /** How a team-colour layer recolours beyond its mask channel and blend (ModelTeamColorRule). */
  readonly teamColor?: ModelTeamColorRule
}

/**
 * The common recolouring of a team-colour layer (slot `teamColor`), in the terms of
 * `UV_game_material_team_color` (SPEC_UVM_EXTENSIONS, Runtime 02.10). The layer's resource is the
 * mask, its `colorChannels` the data channel and its `blend` the blend: `replace`, stated, for a key
 * or a ramp. No game is guessed from pixels or names: the native format's owner states the rule.
 */
export interface ModelTeamColorRule {
  /**
   * `channelKey`: the texels whose `keyChannels` are all at most `keyThreshold` (stored 8-bit, before
   * any colour conversion or filtering) take the colour times their `intensityChannel` (Emperor's
   * blue key: R and G zero, the shade in B); the source is the layer's resource, else the base colour.
   * `paletteRange`: the mask's channel holds palette indices as normalized data,
   * index = floor(sample × `paletteIndexScale` + 0.5), read nearest; an index within `range` takes
   * `ramp[index − range[0]]` (SC1, Dune 2000, RA2/TS house shades), any other keeps its colour.
   * Absent: the mask weighs the colour by its data channel, or the whole material without one.
   */
  readonly maskSource?: 'channelKey' | 'paletteRange'
  /** `channelKey` channels, default `['r', 'g']`. */
  readonly keyChannels?: readonly ('r' | 'g' | 'b')[]
  /** `channelKey` threshold 0–255, default 0. */
  readonly keyThreshold?: number
  /** `channelKey` shade channel, data / 255 multiplying the colour, default `b`. */
  readonly intensityChannel?: 'r' | 'g' | 'b' | 'a'
  /** `paletteRange` inclusive index range, ascending. */
  readonly range?: readonly [number, number]
  /**
   * `paletteRange` exact shades, linear RGB 0..1, one per index of `range`. A player's own ramp of
   * the same length replaces it (`SceneRendererMaterialContext.teamRamp`); none is ever generated.
   */
  readonly ramp?: readonly (readonly [number, number, number])[]
  /** `paletteRange` index scale 1–65535, default 255. */
  readonly paletteIndexScale?: number
  /** `object-tint`: the colour is the object's `presentationTint`, which then tints nothing else of this material. */
  readonly colorSource?: 'team' | 'object-tint'
  /** `mask-rgb`: the colour times the mask texel's colour; coverage stays the data channel. */
  readonly tint?: 'none' | 'mask-rgb'
  /** Weight of the blend, nonnegative, default 1. */
  readonly strength?: number
  /** The colour when the draw names none, linear RGB 0..1, default white. */
  readonly defaultColor?: readonly [number, number, number]
}

export interface ModelMaterialRef {
  /** Matches `ModelPrimitive.materialId`, so a primitive and its material can be joined. */
  readonly id: string
  readonly name?: string
  /** External material library the definition came from, where the format has one (OBJ `mtllib`). */
  readonly libraryId?: string
  /**
   * Publisher-qualified contracts this material carries beyond the base PBR block — a UVM
   * team-colour or game-material extension, for instance. Shader semantics are deliberately not
   * modelled: UV preserves shader *parameters* and does not define pixel output.
   */
  readonly contracts?: readonly string[]
  /** Publisher-native material family (`standard`, `composite`, …). */
  readonly type?: string
  /** Publisher-native blend operation name when known. */
  readonly blendMode?: string
  /** Common coverage mode when the publisher can state it without interpreting a native shader. */
  readonly alphaMode?: 'opaque' | 'mask' | 'blend'
  /** Nonnegative cutoff used only by `alphaMode: mask`; default is 0.5. */
  readonly alphaCutoff?: number
  /** False when this material must not contribute to a world shadow depth pass. */
  readonly castShadows?: boolean
  /** False when direct lighting on this material must ignore the world shadow map. */
  readonly receiveShadows?: boolean
  /** Both faces are fronts: nothing is culled (glTF `material.doubleSided`). */
  readonly doubleSided?: boolean
  /** Whether the material writes depth; absent follows the coverage (opaque and mask write, blend does not). */
  readonly depthWrite?: boolean
  /**
   * Linear RGBA in 0..1 multiplying the base-colour layer, or the base colour itself without one
   * (glTF `baseColorFactor`).
   */
  readonly baseColorFactor?: readonly [number, number, number, number]
  /**
   * Linear RGB in 0..1 multiplying the emissive layer, or the emitted colour itself without one
   * (glTF `emissiveFactor`).
   */
  readonly emissiveFactor?: readonly [number, number, number]
  /** Drawn without lighting: the base colour as it is (glTF `KHR_materials_unlit`). */
  readonly unlit?: boolean
  /**
   * glTF metallic-roughness factors in 0..1, multiplying a `metallicRoughness` layer (blue metallic,
   * green roughness). Absent: a rough dielectric (0 and 1), as Modkit writes a material that says
   * nothing.
   */
  readonly metallicFactor?: number
  readonly roughnessFactor?: number
  /** Among translucent draws, a higher priority draws later (UVM `UV_game_material.sortPriority`). */
  readonly priority?: number
  readonly nativeFlags?: number
  readonly flagNames?: readonly string[]
  readonly layers?: readonly ModelMaterialLayerRef[]
  /**
   * Preserved shader parameters, using the shader identity and params convention of
   * UV_game_material. An identity describes the parameter vocabulary, not pixel equivalence.
   * Logical texture paths in parameters do not grant access to resources; use the resource facet.
   */
  readonly shader?: {
    readonly id: string
    readonly parameters: Readonly<Record<string, JsonValue>>
  }
}

export interface ModelMaterialInfo {
  readonly materials: number
  /** Absent when the format has no library concept; never reported as zero instead. */
  readonly libraries?: number
  readonly byContract?: Readonly<Record<string, number>>
}

/** Material identity and contract coverage — `common.view/model-material-source@1`. */
export interface ModelMaterialSource {
  info(signal?: AbortSignal): Promise<ModelMaterialInfo>
  materials(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelMaterialRef>>
}

// ---------------------------------------------------------------------------------------------
// sockets — publisher: M3 (`MODL.attachment_points` → `ATT_`)

export interface ModelSocketOrientation {
  readonly forward: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
  readonly up: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
}

export interface ModelSocketRef {
  /** Stable identity in the publisher's socket space. */
  readonly id: string
  /** Target in the publisher's node/part space (`bone/<index>` for M3). */
  readonly nodeId: string
  /** Portable role. A publisher uses `attach` when the native name proves no narrower role. */
  readonly role: string
  /** The native attachment name, retained because scripts may reference it verbatim. */
  readonly sourceName?: string
  /** Present only when the native format explicitly declares both axes. */
  readonly orientation?: ModelSocketOrientation
}

export interface ModelSocketInfo {
  readonly sockets: number
  readonly byRole: Readonly<Record<string, number>>
}

/**
 * One publisher-native scalar an effect declares.
 *
 * The parameters of an emitter do not generalise — M3's `squirt` and `tailLength` have no MDX
 * counterpart, and inventing a shared vocabulary for them would mean dropping whatever did not
 * fit. They are carried as the publisher wrote them, in declaration order, so a viewer can show
 * an emitter's real settings without knowing the format.
 */
export interface ModelEffectProperty {
  readonly key: string
  readonly value: string | number | boolean
  /** True when the publisher stores this as an animated track rather than one fixed value. */
  readonly animated?: boolean
}

/**
 * One emitter or field the model declares: a particle system, a ribbon, a force, a warp.
 *
 * `kind` is the publisher's own word rather than a closed set, because the set is not closed: M3
 * has warps and projectors, Warcraft III has popcorn emitters, and a viewer that only knew a fixed
 * list would silently drop the rest.
 */
export interface ModelEffectRef {
  readonly id: string
  readonly kind: string
  readonly name?: string
  /** The node this effect rides on, in the publisher's node space. */
  readonly nodeId?: string
  /** Joins `ModelMaterialRef.id` when the effect draws with one of the model's materials. */
  readonly materialId?: string
  /** Joins `ModelResourceRef.id` when the effect names a logical resource of its own. */
  readonly resourceId?: string
  readonly properties?: readonly ModelEffectProperty[]
}

export interface ModelEffectInfo {
  readonly effects: number
  /** Counts per publisher kind. */
  readonly byKind: Readonly<Record<string, number>>
  /** The effect profile the publisher names, where it names one (`m3`, `mdx`, …). */
  readonly profile?: string
}

/** Emitters and fields — `common.view/model-effect-source@1`. */
export interface ModelEffectSource {
  info(signal?: AbortSignal): Promise<ModelEffectInfo>
  effects(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelEffectRef>>
}

/**
 * A light the model carries.
 *
 * `kind` is the publisher's own word — M3 writes `directional`, `point` and `spot`, another format
 * may write something else — and the two colours are the ones every light model in this family
 * separates. Everything beyond that stays in `properties`, because falloff, decay and hotspot do
 * not mean the same thing in two engines.
 */
export interface ModelLightRef {
  readonly id: string
  readonly kind: string
  readonly name?: string
  readonly nodeId?: string
  /** Linear RGB in 0..1. */
  readonly color?: readonly [number, number, number]
  readonly intensity?: number
  readonly properties?: readonly ModelEffectProperty[]
}

export interface ModelLightInfo {
  readonly lights: number
  readonly byKind: Readonly<Record<string, number>>
}

/** Lights — `common.view/model-light-source@1`. */
export interface ModelLightSource {
  info(signal?: AbortSignal): Promise<ModelLightInfo>
  lights(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelLightRef>>
}

/**
 * A camera the model carries.
 *
 * Field of view is in radians and the clip planes are in the model's own units, because those
 * three are the values every camera in this family states and a viewer can act on. The rest —
 * depth of field, bokeh, focus ranges — stays in `properties`.
 */
export interface ModelCameraRef {
  /** Authored lens convention supplied by the model codec; omitted for canonical vertical glTF. */
  readonly fieldOfViewAxis?: 'horizontal' | 'vertical'
  /** Exact camera index in model.export-uvm; null means this native camera is not projected. */
  readonly projectedCameraIndex?: number | null
  readonly id: string
  readonly name?: string
  readonly nodeId?: string
  readonly fieldOfViewRadians?: number
  readonly nearClip?: number
  readonly farClip?: number
  readonly properties?: readonly ModelEffectProperty[]
}

export interface ModelCameraInfo {
  readonly cameras: number
}

/** Cameras — `common.view/model-camera-source@1`. */
export interface ModelCameraSource {
  info(signal?: AbortSignal): Promise<ModelCameraInfo>
  cameras(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelCameraRef>>
}

/**
 * One simulated body, joint, constraint or cloth.
 *
 * Kind-tagged for the same reason effects are: the set is not closed, and a fixed list would drop
 * whatever a publisher has that this build had not heard of. A joint names two nodes, so both are
 * addressable rather than one being lost.
 */
export interface ModelPhysicsRef {
  readonly id: string
  /** `rigid-body`, `joint`, `cloth`, `constraint`, … in the publisher's own words. */
  readonly kind: string
  readonly name?: string
  readonly nodeId?: string
  /** The second node, for a relation that joins two of them. */
  readonly secondNodeId?: string
  /** The volume's own shape where it has one: `box`, `sphere`, `capsule`, `convex-hull`, `mesh`. */
  readonly shape?: string
  readonly properties?: readonly ModelEffectProperty[]
}

export interface ModelPhysicsInfo {
  readonly bodies: number
  readonly byKind: Readonly<Record<string, number>>
}

/** Simulation bodies and their relations — `common.view/model-physics-source@1`. */
export interface ModelPhysicsSource {
  info(signal?: AbortSignal): Promise<ModelPhysicsInfo>
  bodies(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelPhysicsRef>>
}

/**
 * Something that drives a node at runtime rather than a clip driving it.
 *
 * A turret aims, an inverse-kinematics chain solves, a billboard faces the camera. They are one
 * family because a consumer asks the same question of all three — which nodes does the engine move
 * on its own, and under what rule — and because none of them is animation data.
 */
export interface ModelNodeBehaviourRef {
  readonly id: string
  /** `turret`, `ik`, `billboard`, … in the publisher's own words. */
  readonly kind: string
  readonly name?: string
  /** The node this behaviour drives. */
  readonly nodeId?: string
  /** Every node the behaviour touches, for one that spans a chain or a group. */
  readonly nodeIds?: readonly string[]
  readonly properties?: readonly ModelEffectProperty[]
}

export interface ModelNodeBehaviourInfo {
  readonly behaviours: number
  readonly byKind: Readonly<Record<string, number>>
}

/** Runtime node behaviours — `common.view/model-node-behaviour-source@1`. */
export interface ModelNodeBehaviourSource {
  info(signal?: AbortSignal): Promise<ModelNodeBehaviourInfo>
  behaviours(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelNodeBehaviourRef>>
}

/**
 * One discrete level of detail. `order` 0 is the most detailed; a viewer draws the lowest order by
 * default. Nodes that no level names are drawn at every level.
 */
export interface ModelLodLevelRef {
  readonly id: string
  readonly order: number
  readonly nodeIds: readonly string[]
  /** Switch to this level below this fraction of viewport height (`MODKITX_lod_selection`). */
  readonly screenCoverage?: number
  /** Switch to this level beyond this distance, in metres. */
  readonly maxDistance?: number
}

export interface ModelLodInfo {
  readonly levels: number
}

/** Discrete levels of detail — `common.view/model-lod-source@1`. */
export interface ModelLodSource {
  info(signal?: AbortSignal): Promise<ModelLodInfo>
  levels(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelLodLevelRef>>
}

/**
 * One named variant of a model's look (SPEC_UVM §15.2 `UV_game_variants`): a choice among the
 * variants of its `slot` that shows and hides primitives of the one scene — a tank's treads as it
 * stands, moves or turns. One variant of a slot is chosen at a time; the slot's `default` one is
 * drawn when nothing is chosen, and the scene's own visibility is the default look. A variant
 * without a slot is a choice of the single unnamed slot.
 */
export interface ModelVariantRef {
  readonly id: string
  /** The name the game or the publisher gives it (`moving`, `damaged`). */
  readonly name: string
  readonly slot?: string
  readonly default?: boolean
  /** Primitives (`ModelPrimitive.id`) the variant draws; the scene's stored values still apply. */
  readonly showPrimitiveIds: readonly string[]
  /** Primitives the variant does not draw. */
  readonly hidePrimitiveIds: readonly string[]
}

export interface ModelVariantInfo {
  readonly variants: number
}

/** Named variants of the look — `common.view/model-variant-source@1`. */
export interface ModelVariantSource {
  info(signal?: AbortSignal): Promise<ModelVariantInfo>
  variants(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelVariantRef>>
}

/** Attachment points — `common.view/model-socket-source@1`. */
export interface ModelSocketSource {
  info(signal?: AbortSignal): Promise<ModelSocketInfo>
  sockets(page: PageRequest, signal?: AbortSignal): Promise<Page<ModelSocketRef>>
}

// ---------------------------------------------------------------------------------------------
// reserved facet ids — named, versioned, and deliberately not contracts yet

/**
 * A model facet family whose id and boundary are fixed, and whose contract does not exist.
 *
 * These are **not** registered in `DataSourceContractMap` and **not** in
 * `STANDARD_DATA_SOURCE_CONTRACTS`, which is the point: an id that this build cannot call is not a
 * published contract, and a manifest naming one is treated as foreign rather than standard. Fixing
 * the id now costs nothing and prevents two extensions from inventing two spellings for the same
 * facet; shipping an interface nobody can fill would cost the credibility of the whole table.
 *
 * `minimalShape` records what the contract would carry, so the reservation is reviewable rather
 * than a bare name. `blockedBy` names the missing publisher — the only thing that promotes a
 * reservation into a contract (§2.7).
 */
export interface ReservedModelFacetSource {
  readonly contract: string
  readonly major: 1
  readonly minimalShape: readonly string[]
  readonly blockedBy: string
}

// `model-variant-source` left this list once SAGE published its tread looks (K4): none remain.
export const RESERVED_MODEL_FACET_SOURCES: readonly ReservedModelFacetSource[] = Object.freeze([])

/** True for an id this build has reserved but deliberately does not publish as a contract. */
export function isReservedModelFacetSource(contract: string): boolean {
  return RESERVED_MODEL_FACET_SOURCES.some(entry => entry.contract === contract)
}
