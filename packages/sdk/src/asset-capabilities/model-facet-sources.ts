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
 * after independent publishers exercised their shapes; skeleton followed only when the Blizzard
 * M3 reader decoded BONE bindings independently of the SAGE/Westwood W3D/W3X family.
 * `DATA_SOURCE_MATURITY` carries the verdict and reason. Declaring the contract first and migrating
 * publishers second was deliberate: it is the order that let the two be reviewed separately.
 *
 * An absent facet is absent. A publisher that cannot answer does not publish the source, and never
 * publishes it filled with zeroes, empty arrays or invented names.
 */

import type { Page, PageRequest } from './data-sources.js'

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

export interface ModelBoneBinding {
  /** The model part this binding belongs to; ids come from the publisher's own part space. */
  readonly partId: string
  readonly boneIndex: number
  /** `null` when nothing named the bone. Never a fabricated name. */
  readonly boneName: string | null
  readonly provenance: ModelBoneProvenance
  /** The hierarchy the index is resolved against, when the publisher names one. */
  readonly hierarchyId?: string
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

export interface ModelAnimationChannel {
  /** What the channel drives, in the publisher's own target space (a W3D pivot, for instance). */
  readonly target: string
  /** The publisher's channel kind, verbatim. A cross-format channel vocabulary is not invented here. */
  readonly kind: string
  readonly axis?: string
  readonly firstFrame: number
  readonly lastFrame: number
}

export interface ModelAnimationClip {
  readonly id: string
  readonly name: string
  readonly kind: ModelAnimationKind
  /** `companion` when a bound sidecar supplies the motion, as an HVA does for a VXL. */
  readonly provenance: Exclude<ModelBoneProvenance, 'absent'>
  readonly frames: number
  readonly frameRate?: number
  readonly hierarchyId?: string
  readonly channels: readonly ModelAnimationChannel[]
  /** Channels the publisher recognised but does not represent; stated rather than dropped. */
  readonly unsupportedChannels?: number
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

export const RESERVED_MODEL_FACET_SOURCES: readonly ReservedModelFacetSource[] = Object.freeze([
  Object.freeze({
    contract: 'common.view/model-socket-source',
    major: 1,
    minimalShape: Object.freeze([
      'info(): { sockets }',
      'sockets(page): { id, nodeId, role, orientation? }',
    ]),
    blockedBy:
      'no codec publishes attachment points today: the UVM schema defines UV_game_socket, but the X3 UVM reader does not surface them and no native model codec extracts them',
  }),
  Object.freeze({
    contract: 'common.view/model-lod-source',
    major: 1,
    minimalShape: Object.freeze([
      'info(): { levels }',
      'levels(page): { id, nodeIds, order, selection? }',
    ]),
    blockedBy:
      'no codec publishes discrete LOD levels today: MSFT_lod topology is readable in principle, and nothing reads it',
  }),
  Object.freeze({
    contract: 'common.view/model-variant-source',
    major: 1,
    minimalShape: Object.freeze([
      'info(): { variants }',
      'variants(page): { id, name, kind, targets }',
    ]),
    blockedBy:
      'no codec publishes named variants today: UV_game_variants exists in the schema and no reader surfaces it',
  }),
  Object.freeze({
    contract: 'common.view/model-effect-source',
    major: 1,
    minimalShape: Object.freeze([
      'info(): { effects, byKind, profile? }',
      'effects(page): { id, kind, nodeId?, materialId? }',
    ]),
    blockedBy:
      'the UVM reader publishes effect *counts* by kind, which fills info() and nothing else; per-emitter records have no publisher, and a page method no publisher can fill is not a contract',
  }),
])

/** True for an id this build has reserved but deliberately does not publish as a contract. */
export function isReservedModelFacetSource(contract: string): boolean {
  return RESERVED_MODEL_FACET_SOURCES.some(entry => entry.contract === contract)
}
