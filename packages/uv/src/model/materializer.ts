import { packUvmGlb } from './container.js'
export { packUvmGlb } from './container.js'
import type {
  ModelSceneInfo,
  ModelNode,
  ModelMesh,
  ModelPrimitive,
  ModelSocketRef,
  ModelLodLevelRef,
  ModelMaterialLayerRef,
  ModelMaterialRef,
  ModelBoneBinding,
  ModelAnimationClip,
  MaterializationRequest,
  MaterializationDiffEntry,
} from '@modkit/sdk'
import {
  snapshotModelMaterials,
  DEFAULT_MODEL_MATERIAL_BUDGET,
} from '@modkit/codec-kit/model/materials'
import { DEFAULT_MODEL_SKELETON_BUDGET } from '@modkit/codec-kit/model/skeleton'
import { DEFAULT_MODEL_ANIMATION_BUDGET } from '@modkit/codec-kit/model/animation'
import { boundsOf } from '@modkit/codec-kit/model/bounds'
import { composeTrsMatrix } from '@modkit/codec-kit/model-math/sequence-pose'
import { BufferBuilder as RigBufferBuilder } from './legacy/rig-kernels.js'
import type { UvmJsonObject } from './legacy/rig-types.js'
import { prepareUvmSkeleton, writeUvmSkinAttributes, writeUvmAnimations } from './rig.js'
import { materializeUvmAnimationMaterialTargets } from './animation-materials.js'
export interface ModelProjection {
  readonly info: ModelSceneInfo
  readonly nodes?: readonly ModelNode[]
  readonly meshes?: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
  readonly sockets?: readonly ModelSocketRef[]
  /** Complete material definitions, when the material facet is available. Absence remains valid. */
  readonly materials?: readonly ModelMaterialRef[]
  /** Complete explicit scene-node bindings; unknown bind transforms are never guessed. */
  readonly skeleton?: readonly ModelBoneBinding[]
  readonly animations?: readonly ModelAnimationClip[]
  /** Discrete levels of detail over whole scene-root nodes (the `model-lod-source` shape). */
  readonly lods?: readonly ModelLodLevelRef[]
  readonly excludedFacetIds?: readonly string[]
  readonly resourceClosure?: {
    readonly mode: 'logical' | 'content-qualified'
    readonly entries?: readonly {
      readonly role: string
      readonly logicalId: string
      readonly mediaHint?: string | null
      /**
       * How the image is meant to be magnified: `nearest` keeps pixel art sharp (Minecraft's
       * 16×16 block textures). Written as the texture's glTF sampler; absent means the renderer's
       * default (linear).
       */
      readonly filter?: 'nearest' | 'linear'
    }[]
    readonly unavailable?: readonly { readonly logicalId: string }[]
  }
  /**
   * A game's own records on the document root (SPEC_UVM §16.2): `UV_game_<id>` names mapped to
   * JSON objects, written as given and declared in `extensionsUsed` — a Spring model's
   * `UV_game_spring` header (radius, height, midPos) that the S3O writer reads back. The records
   * the materializer writes itself (sockets, materials, clips, variants) are not among them.
   */
  readonly gameExtensions?: Readonly<Record<string, UvmJsonObject>>
}
/**
 * The one table from a publisher's material layer slot to the glTF slot a consumer that knows only
 * glTF reads (SPEC_UVM §11.1: the PBR core is always present), so a model's textures survive into
 * other tools and other games' exporters. Slots are compared case-insensitively; the first layer of a
 * slot wins. A team-colour layer becomes UV_game_material_team_color (§11.2).
 */
const GLTF_LAYER_SLOTS: Readonly<
  Record<string, 'baseColor' | 'normal' | 'occlusion' | 'emissive' | 'teamColor'>
> = Object.freeze({
  diffuse: 'baseColor',
  basecolor: 'baseColor',
  'base-color': 'baseColor',
  albedo: 'baseColor',
  color: 'baseColor',
  normal: 'normal',
  occlusion: 'occlusion',
  ao: 'occlusion',
  ambientocclusion: 'occlusion',
  'ambient-occlusion': 'occlusion',
  emissive: 'emissive',
  emission: 'emissive',
  teamcolor: 'teamColor',
  'team-color': 'teamColor',
  team: 'teamColor',
})

/** A single colour channel a publisher's channel mask names (bits r, g, b, a), if exactly one. */
function singleChannel(mask: number | undefined): 'r' | 'g' | 'b' | 'a' | undefined {
  return mask === 1 ? 'r' : mask === 2 ? 'g' : mask === 4 ? 'b' : mask === 8 ? 'a' : undefined
}

/** glTF filter enums (NEAREST 9728, LINEAR 9729). */
const GLTF_FILTER = { nearest: 9728, linear: 9729 } as const

/** One texture per image; an image with a stated filter gets a sampler naming it, shared by filter. */
function texturesWithSamplers(filters: readonly ('nearest' | 'linear' | undefined)[]): {
  readonly textures: UvmJsonObject[]
  readonly samplers?: UvmJsonObject[]
} {
  const samplers: UvmJsonObject[] = []
  const samplerOf = new Map<'nearest' | 'linear', number>()
  const textures = filters.map((filter, index) => {
    if (filter === undefined) return { source: index }
    let sampler = samplerOf.get(filter)
    if (sampler === undefined) {
      sampler = samplers.length
      samplerOf.set(filter, sampler)
      samplers.push({ magFilter: GLTF_FILTER[filter], minFilter: GLTF_FILTER[filter] })
    }
    return { source: index, sampler }
  })
  return samplers.length === 0 ? { textures } : { textures, samplers }
}

/** `UV_game_material.blendMode` values of SPEC_UVM_EXTENSIONS; any other name stays in extras. */
const UVM_GAME_BLEND_MODES = [
  'opaque',
  'alpha-blend',
  'alpha-test',
  'additive',
  'modulate',
  'modulate2x',
  'alpha-key',
  'screen',
  'subtract',
] as const
type UvmGameBlendMode = (typeof UVM_GAME_BLEND_MODES)[number]
const isUvmGameBlendMode = (value: unknown): value is UvmGameBlendMode =>
  (UVM_GAME_BLEND_MODES as readonly unknown[]).includes(value)

export interface MaterializationOptions {
  readonly digest?: (bytes: Uint8Array) => string
  /** Bounds the aggregate material definitions, including shader keys and composite passes. */
  readonly materialBudget?: typeof DEFAULT_MODEL_MATERIAL_BUDGET
  readonly skeletonBudget?: typeof DEFAULT_MODEL_SKELETON_BUDGET
  readonly animationBudget?: typeof DEFAULT_MODEL_ANIMATION_BUDGET
  readonly signal?: AbortSignal
}
export interface BufferView extends UvmJsonObject {
  buffer: number
  byteOffset: number
  byteLength: number
}
export interface DocumentAccessor extends UvmJsonObject {
  bufferView: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}
interface UvmTextureRef {
  index: number
  texCoord?: number
  channel?: 'r' | 'g' | 'b' | 'a'
}
export interface UvmMaterial {
  pbrMetallicRoughness: {
    metallicFactor: number
    roughnessFactor: number
    baseColorTexture?: UvmTextureRef
  }
  normalTexture?: UvmTextureRef
  occlusionTexture?: UvmTextureRef
  emissiveTexture?: UvmTextureRef
  emissiveFactor?: [number, number, number]
  name?: string
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  extensions?: {
    UV_game_material?: {
      shader: string
      blendMode?: UvmGameBlendMode
      params: NonNullable<ModelMaterialRef['shader']>['parameters']
    }
    UV_game_material_team_color?: {
      maskSource: 'texture'
      maskTexture: UvmTextureRef
      targets: ['baseColor']
      blend: NonNullable<ModelMaterialLayerRef['blend']>
    }
  }
  extras?: {
    modkit: {
      material: {
        version: 1
        fields: Omit<ModelMaterialRef, 'id' | 'name' | 'shader' | 'contracts'>
      }
    }
  }
}
interface PrimitiveEntry {
  attributes: { [semantic: string]: number }
  indices: number
  material?: string
  targets?: PrimitiveEntry['attributes'][]
}
export interface DocumentPrimitive {
  attributes: PrimitiveEntry['attributes']
  indices: number
  material?: number | undefined
  targets?: PrimitiveEntry['attributes'][]
}
export interface DocumentNode {
  name?: string
  children?: number[]
  mesh?: number | undefined
  matrix?: number[]
  skin?: number
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  extensions?: object
}
/**
 * The common UVM/core materializer (block 11, slice 11C1, plan items 14 and 16).
 *
 * It turns a **drained faceted model projection** into UVM/core 1.0 bytes, and it is deliberately
 * the only thing in the tree that does so. Native model codecs and their live projectors do not
 * import this module — `scripts/test/uv-materializer-boundary.test.ts` proves it rather
 * than trusting the convention — because a codec that could also write UVM would be two owners of
 * one format wearing one name.
 *
 * **What it will not do.** It never invents data. Texture identity is written only when the live
 * projection carries the scope's resolved resource closure; a bare count still produces no empty
 * texture objects. Optional explicit skeleton and animation facets supply standard glTF skinning
 * and TRS channels; unsupported channels remain named losses in the receipt.
 *
 * **Determinism.** Emission order, buffer layout and JSON key order are fixed by this code, not by
 * iteration order of anything. `JSON.stringify` of a freshly built object, a JSON chunk padded with
 * 0x20 and a BIN chunk padded with 0x00 — the packing rule the pinned specs fix in
 * `conformance/uvm-core/vectors.json`. Materialising the same projection twice therefore produces
 * the same bytes, which is checkable rather than asserted.
 *
 * **Identity.** Reopening a UVM document assigns ids positionally (`node-3`, `mesh-1`,
 * `mesh-1-primitive-0`), because that is the artifact binding the registered
 * `model-interchange-v1` descriptor fixes. A projection whose ids already follow that convention —
 * a UVM, glTF, or native publisher using that stable artifact convention — round-trips with its
 * identity intact and its scope hash unchanged. Other identities are renumbered and every affected
 * plane becomes a diff entry in the receipt. It does not pretend the two hashes match.
 *
 * No crypto or Node built-ins; the bounded JSON/material helper is also browser-safe. The digest of the produced
 * bytes is optional evidence supplied by the caller, exactly as `ProjectionReceipt` treats digests.
 */

const MATERIALIZER_ID = 'modkit/uvm-materializer'
const MATERIALIZER_VERSION = '1.0.0'
const PROFILE = 'UVM/core@1.0'

const FLOAT = 5126
const UINT32 = 5125

const encoder = new TextEncoder()

// ---------------------------------------------------------------------------------------------
// small helpers

function fail(message: string): never {
  throw new TypeError(`UVM materialization refused: ${message}`)
}

function finite<T extends Iterable<number>>(values: T, label: string): T {
  for (const value of values) {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`)
  }
  return values
}

/** The request's `options.units` as the UV_units root extension, or undefined when absent. */
function uvUnits(
  value: unknown,
): { metersPerSourceUnit: number; [key: string]: unknown } | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) fail('options.units must be an object')
  const units = value as Record<string, unknown>
  const positive = (key: string, required: boolean): number | undefined => {
    const one = units[key]
    if (one === undefined && !required) return undefined
    if (typeof one !== 'number' || !Number.isFinite(one) || one <= 0)
      fail(`options.units.${key} must be a positive finite number`)
    return one
  }
  const metersPerSourceUnit = positive('metersPerSourceUnit', true)!
  const sourceUnitsPerCell = positive('sourceUnitsPerCell', false)
  const sourceFrameRate = positive('sourceFrameRate', false)
  const { sourceUnit, footprintCells } = units
  if (sourceUnit !== undefined && (typeof sourceUnit !== 'string' || sourceUnit.trim() === ''))
    fail('options.units.sourceUnit must be a non-empty string')
  if (
    footprintCells !== undefined &&
    (!Array.isArray(footprintCells) ||
      footprintCells.length !== 2 ||
      !footprintCells.every(cell => typeof cell === 'number' && Number.isFinite(cell) && cell > 0))
  )
    fail('options.units.footprintCells must be two positive numbers')
  return {
    ...(sourceUnit === undefined ? {} : { sourceUnit }),
    metersPerSourceUnit,
    ...(sourceUnitsPerCell === undefined ? {} : { sourceUnitsPerCell }),
    ...(footprintCells === undefined ? {} : { footprintCells: [...(footprintCells as number[])] }),
    ...(sourceFrameRate === undefined ? {} : { sourceFrameRate }),
  }
}

/** A stated TRS and its matrix agree to float32 precision, not bit for bit. */
function closeTo(composed: number, stated: number): boolean {
  return Math.abs(composed - stated) <= 1e-4 * Math.max(1, Math.abs(stated))
}

const byUtf8 = (left: string, right: string) => {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number)
  }
  return a.length - b.length
}

/**
 * The positional order a set of ids implies, or `null` when they do not follow the convention.
 *
 * `null` is not a failure — it is the honest answer "these ids carry meaning this profile cannot
 * store", and the caller turns it into a receipt entry instead of a silent reordering.
 */
function positionalOrder(ids: readonly string[], pattern: RegExp): string[] | null {
  const slots = new Array(ids.length).fill(undefined)
  for (const id of ids) {
    const match = pattern.exec(id)
    if (match === null) return null
    const index = Number(match[1])
    if (!Number.isSafeInteger(index) || index < 0 || index >= ids.length) return null
    if (slots[index] !== undefined) return null
    slots[index] = id
  }
  return slots.every(slot => slot !== undefined) ? slots : null
}

// ---------------------------------------------------------------------------------------------
// buffer assembly

class BufferBuilder {
  readonly buffer = new RigBufferBuilder()
  readonly views: BufferView[] = []

  /** Appends one 4-byte-aligned view and returns its bufferView index. */
  push(typed: Float32Array | Uint32Array) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const offset = this.buffer.append(bytes)
    this.views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength })
    return this.views.length - 1
  }

  build() {
    return this.buffer.finish()
  }
}

// ---------------------------------------------------------------------------------------------
// GLB packing — the rule pinned by `conformance/uvm-core/vectors.json`

// ---------------------------------------------------------------------------------------------
// the materializer

/**
 * Materialise a drained model projection into UVM/core bytes and a `MaterializationReceipt`.
 *
 * `projection`: `{ info, nodes, meshes, primitives?, resourceClosure? }` — the shape
 * `common.view/model-scene-source@1` publishes, already drained by the caller because paging must
 * not reach a hash.
 *
 * `request`: `{ scope, profile, subjectRevision, options? }` — `MaterializationRequest` as the SDK
 * freezes it. `options.assetId` names the artifact; `options.sourceFormat` records where it came
 * from. Both end up in `UV_asset`/`UV_provenance`, which the profile requires and this module will
 * not guess.
 *
 * `digest`: optional `(bytes) => string` returning an algorithm-qualified digest. Supplied by the
 * caller so this module stays free of crypto and of platform built-ins.
 */
/** Records the materializer writes itself: a projection's game records cannot replace them. */
const MATERIALIZER_GAME_EXTENSIONS = new Set([
  'UV_game_socket',
  'UV_game_material',
  'UV_game_material_team_color',
  'UV_game_animation_clips',
  'UV_game_variants',
])

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1))
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.values(value).every(item => isJsonValue(item, depth + 1))
}

/** The projection's game records, checked and in name order. */
function gameExtensionsOf(projection: ModelProjection): [string, UvmJsonObject][] {
  const entries = Object.entries(projection.gameExtensions ?? {})
  for (const [name, value] of entries) {
    if (!/^UV_game_[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(name) || MATERIALIZER_GAME_EXTENSIONS.has(name))
      throw new TypeError(`game extension ${name} is not a UV_game_<id> record a projection writes`)
    if (typeof value !== 'object' || Array.isArray(value) || !isJsonValue(value, 0))
      throw new TypeError(`game extension ${name} is not a JSON object`)
  }
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export function materializeUvmCore(
  projection: ModelProjection,
  request: MaterializationRequest,
  {
    digest,
    materialBudget = DEFAULT_MODEL_MATERIAL_BUDGET,
    skeletonBudget = DEFAULT_MODEL_SKELETON_BUDGET,
    animationBudget = DEFAULT_MODEL_ANIMATION_BUDGET,
    signal,
  }: MaterializationOptions = {},
) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const info = projection?.info
  if (info === undefined) fail('the projection carries no info')
  if (request?.scope === undefined) fail('a materialization request must name its semantic scope')
  const assetId = (request.options as { assetId?: string } | undefined)?.assetId
  if (typeof assetId !== 'string' || assetId.trim() === '') {
    fail(
      'the request must carry options.assetId: the profile requires an identity, and inventing one would be a lie about provenance',
    )
  }
  const sourceFormat = (request.options as { sourceFormat?: string } | undefined)?.sourceFormat
  if (typeof sourceFormat !== 'string' || sourceFormat.trim() === '') {
    fail(
      'the request must carry options.sourceFormat: UV_provenance records where the artifact came from',
    )
  }

  const diff: MaterializationDiffEntry[] = []
  const lostFacetIds: string[] = []
  const excludedFacetIds = [...(projection.excludedFacetIds ?? [])]
  const losses = []

  const note = (
    facetId: string,
    change: MaterializationDiffEntry['change'],
    path: string | undefined,
    message: string,
  ) => {
    diff.push({ facetId, change, ...(path === undefined ? {} : { path }), note: message })
  }

  // --- identity ------------------------------------------------------------------------------
  const liveNodes = [...(projection.nodes ?? [])]
  const liveMeshes = [...(projection.meshes ?? [])]
  const primitives = projection.primitives === undefined ? undefined : [...projection.primitives]

  if (info.geometryAccess === 'decoded' && primitives === undefined) {
    fail('geometryAccess is decoded but the projection carries no primitives')
  }
  if (info.geometryAccess === 'metadata-only' && primitives !== undefined) {
    fail('geometryAccess is metadata-only but the projection carries primitives')
  }

  const nodeOrder = positionalOrder(
    liveNodes.map(node => node.id),
    /^node-(\d+)$/u,
  )
  const meshOrder = positionalOrder(
    liveMeshes.map(mesh => mesh.id),
    /^mesh-(\d+)$/u,
  )
  const identityPreserved = nodeOrder !== null && meshOrder !== null

  const orderedNodes = identityPreserved
    ? nodeOrder.map(id => liveNodes.find(node => node.id === id) as ModelNode)
    : [...liveNodes].sort((left, right) => byUtf8(left.id, right.id))
  const orderedMeshes = identityPreserved
    ? meshOrder.map(id => liveMeshes.find(mesh => mesh.id === id) as ModelMesh)
    : [...liveMeshes].sort((left, right) => byUtf8(left.id, right.id))

  /*
   * Primitive identity is checked on its own, and that is not pedantry.
   *
   * A reopened document names a primitive `mesh-<meshIndex>-primitive-<indexInMesh>`. A source
   * could easily have canonical node and mesh ids while naming its primitives something else, and
   * then identity would *look* preserved while the geometry facet quietly changed. Checking the
   * two separately is what keeps an unexplained difference from slipping through.
   */
  const primitiveIdentityPreserved =
    identityPreserved &&
    orderedMeshes.every((mesh, meshIndex) =>
      (mesh.primitiveIds ?? []).every((id, index) => id === `mesh-${meshIndex}-primitive-${index}`),
    )

  if (!identityPreserved) {
    /*
     * The publisher's ids carry meaning the artifact binding cannot store: a reopened document
     * names its nodes positionally. Renumbering is the honest outcome, and it is recorded per
     * plane rather than smoothed over — a consumer comparing the two hashes must see why.
     */
    note(
      'uv.model/hierarchy@1',
      'value-differs',
      '/nodes/*/id',
      'the source names its nodes outside the positional convention of the artifact binding, so reopening renumbers them',
    )
    note(
      'uv.model/mesh-index@1',
      'value-differs',
      '/meshes/*/id',
      'the source names its meshes outside the positional convention of the artifact binding, so reopening renumbers them',
    )
    losses.push('node and mesh identity renumbered to the positional artifact convention')
  }
  if (!primitiveIdentityPreserved && primitives !== undefined) {
    note(
      'uv.model/geometry@1',
      'value-differs',
      '/primitives/*/id',
      'a primitive is named after the mesh that owns it and its place in that mesh, so reopening renames it whenever the source did not already use that form',
    )
    note(
      'uv.model/mesh-index@1',
      'value-differs',
      '/meshes/*/primitiveIds',
      'the primitive ids a mesh lists are renamed with the primitives themselves',
    )
    losses.push('primitive identity renumbered to the positional artifact convention')
  }

  const nodeIndexById = new Map(orderedNodes.map((node, index) => [node.id, index]))
  const meshIndexById = new Map(orderedMeshes.map((mesh, index) => [mesh.id, index]))

  // --- geometry ------------------------------------------------------------------------------
  const buffers = new BufferBuilder()
  const accessors: DocumentAccessor[] = []
  const rigStorage = { buffer: buffers.buffer, views: buffers.views, accessors }
  const skeleton =
    projection.skeleton === undefined
      ? undefined
      : prepareUvmSkeleton(projection.skeleton, orderedNodes, rigStorage, skeletonBudget, signal)
  const meshSkins = new Map<string, number | null>()
  const emittedMeshes = []
  const materialIds = new Set<string>()
  let emittedPrimitives = 0

  const primitiveById = new Map((primitives ?? []).map(item => [item.id, item]))
  const primitiveIndices = new Map<string, { mesh: number; primitive: number }>()
  const ambiguousPrimitiveIds = new Set<string>()

  // Morph targets per mesh: glTF requires the same count in every primitive; names come along.
  const meshTargetNames = new Map<string, readonly (string | undefined)[]>()
  for (const mesh of orderedMeshes) {
    const meshPrimitives = []
    for (const primitiveId of mesh.primitiveIds ?? []) {
      const primitive = primitiveById.get(primitiveId)
      if (primitive === undefined) {
        if (primitives === undefined) continue
        fail(
          `mesh «${mesh.id}» names primitive «${primitiveId}», which the projection does not publish`,
        )
      }
      const positions = Float32Array.from(
        finite(primitive.positions, `primitive ${primitive.id} positions`),
      )
      if (positions.length === 0 || positions.length % 3 !== 0) {
        fail(`primitive «${primitive.id}» does not carry VEC3 positions`)
      }
      if (primitive.topology !== 'triangles') {
        // UVM/core is triangles-only; a line or point set is a real model this profile cannot hold
        losses.push(
          `primitive ${primitive.id} is ${primitive.topology}, which UVM/core does not carry`,
        )
        note(
          'uv.model/geometry@1',
          'absent-in-artifact',
          `/primitives/${primitive.id}`,
          `UVM/core carries triangles only; «${primitive.topology}» was not written`,
        )
        continue
      }
      const vertexCount = positions.length / 3
      const attributes: PrimitiveEntry['attributes'] = {}
      attributes['POSITION'] = accessors.length
      const positionBounds = boundsOf(positions)
      accessors.push({
        bufferView: buffers.push(positions),
        componentType: FLOAT,
        count: vertexCount,
        type: 'VEC3',
        min: positionBounds.min,
        max: positionBounds.max,
      })
      const attribute = (semantic: string, values: Float32Array, width: 2 | 3 | 4) => {
        const data = Float32Array.from(finite(values, `primitive ${primitive.id} ${semantic}`))
        if (data.length !== vertexCount * width || !data.every(Number.isFinite)) {
          fail(
            `primitive ${primitive.id} ${semantic} must contain ${vertexCount} finite VEC${width} values`,
          )
        }
        if (
          semantic === 'TANGENT' &&
          data.some((value, index) => index % 4 === 3 && value !== -1 && value !== 1)
        ) {
          fail(`primitive ${primitive.id} tangent handedness must be -1 or 1`)
        }
        if (semantic === 'NORMAL' || semantic === 'TANGENT') {
          // A zero-length direction is no direction: the primitive goes without the attribute (a
          // viewer computes flat normals), said in the receipt, rather than refusing the model.
          for (let offset = 0; offset < data.length; offset += width) {
            if (Math.hypot(data[offset]!, data[offset + 1]!, data[offset + 2]!) !== 0) continue
            const message = `${semantic} omitted: a vertex has a zero-length direction`
            losses.push(`primitive ${primitive.id}: ${message}`)
            note(
              'uv.model/geometry@1',
              'absent-in-artifact',
              `/primitives/${primitive.id}/${semantic}`,
              message,
            )
            return
          }
          let normalized = 0
          for (let offset = 0; offset < data.length; offset += width) {
            const length = Math.hypot(data[offset]!, data[offset + 1]!, data[offset + 2]!)
            if (Math.abs(length - 1) <= 0.0001) continue
            for (let axis = 0; axis < 3; axis++) data[offset + axis] = data[offset + axis]! / length
            normalized++
          }
          if (normalized > 0) {
            const message = `${normalized} ${semantic} directions normalized to the unit vectors required by glTF`
            losses.push(`primitive ${primitive.id}: ${message}`)
            note(
              'uv.model/geometry@1',
              'value-differs',
              `/primitives/${primitive.id}/${semantic}`,
              message,
            )
          }
        }
        attributes[semantic] = accessors.length
        accessors.push({
          bufferView: buffers.push(data),
          componentType: FLOAT,
          count: vertexCount,
          type: `VEC${width}`,
        })
      }
      if (primitive.normals != null) attribute('NORMAL', primitive.normals, 3)
      if (primitive.tangents != null && attributes['NORMAL'] === undefined) {
        // glTF allows tangents only beside normals
        const message = 'TANGENT omitted: the primitive has no normals'
        losses.push(`primitive ${primitive.id}: ${message}`)
        note(
          'uv.model/geometry@1',
          'absent-in-artifact',
          `/primitives/${primitive.id}/TANGENT`,
          message,
        )
      } else if (primitive.tangents != null) attribute('TANGENT', primitive.tangents, 4)
      if (primitive.colors != null) attribute('COLOR_0', primitive.colors, 4)
      const uvSets = new Map<number, Float32Array>()
      for (const channel of primitive.textureCoordinateSets ?? []) {
        if (!Number.isSafeInteger(channel.set) || channel.set < 0 || uvSets.has(channel.set)) {
          fail(`primitive ${primitive.id} has an invalid or duplicate UV set`)
        }
        uvSets.set(channel.set, channel.coordinates)
      }
      if (primitive.textureCoordinates != null) {
        const setZero = uvSets.get(0)
        if (
          setZero !== undefined &&
          (setZero.length !== primitive.textureCoordinates.length ||
            setZero.some((value, index) => value !== primitive.textureCoordinates?.[index]))
        ) {
          fail(`primitive ${primitive.id} has conflicting UV set zero values`)
        }
        uvSets.set(0, primitive.textureCoordinates)
      }
      const orderedUvSets = [...uvSets].sort(([a], [b]) => a - b)
      if (orderedUvSets.some(([set], index) => set !== index)) {
        fail(`primitive ${primitive.id} UV sets must be consecutive from zero for UVM/core`)
      }
      for (const [set, coordinates] of orderedUvSets) {
        attribute(`TEXCOORD_${set}`, coordinates, 2)
      }
      if (primitive.boneIndices !== undefined || primitive.boneWeights !== undefined) {
        if (skeleton === undefined) {
          losses.push(`primitive ${primitive.id} skin bindings require a skeleton projection`)
          note(
            'uv.model/geometry@1',
            'absent-in-artifact',
            `/primitives/${primitive.id}/skin`,
            'bone indices and weights cannot be materialized without their skeleton and bind transforms',
          )
        } else {
          const skin = writeUvmSkinAttributes(primitive, attributes, skeleton, rigStorage)
          if (meshSkins.has(mesh.id) && meshSkins.get(mesh.id) !== skin)
            fail(`mesh ${mesh.id} mixes different skin bindings`)
          meshSkins.set(mesh.id, skin)
        }
      } else {
        if (meshSkins.has(mesh.id) && meshSkins.get(mesh.id) !== null)
          fail(`mesh ${mesh.id} mixes skinned and unskinned primitives`)
        meshSkins.set(mesh.id, null)
      }
      const indexValues =
        primitive.indices === undefined || primitive.indices === null
          ? Uint32Array.from({ length: vertexCount }, (_unused, index) => index)
          : Uint32Array.from(primitive.indices)
      const indicesAccessor = accessors.length
      accessors.push({
        bufferView: buffers.push(indexValues),
        componentType: UINT32,
        count: indexValues.length,
        type: 'SCALAR',
      })
      const entry: PrimitiveEntry = { attributes, indices: indicesAccessor }
      const morphTargets = primitive.morphTargets ?? []
      const names = morphTargets.map(target => target.name)
      const priorNames = meshTargetNames.get(mesh.id)
      if (
        priorNames !== undefined &&
        (priorNames.length !== names.length || priorNames.some((name, at) => name !== names[at]))
      )
        fail(`mesh ${mesh.id} primitives disagree on their morph targets`)
      meshTargetNames.set(mesh.id, names)
      if (morphTargets.length > 0) {
        entry.targets = morphTargets.map((target, at) => {
          const delta = (values: Float32Array, semantic: string) => {
            const data = Float32Array.from(
              finite(values, `primitive ${primitive.id} morph target ${at} ${semantic}`),
            )
            if (data.length !== vertexCount * 3)
              fail(
                `primitive ${primitive.id} morph target ${at} ${semantic} must contain ${vertexCount} VEC3 deltas`,
              )
            return data
          }
          const positionDeltas = delta(target.positions, 'POSITION')
          const deltaBounds = boundsOf(positionDeltas)
          const target_: PrimitiveEntry['attributes'] = { POSITION: accessors.length }
          accessors.push({
            bufferView: buffers.push(positionDeltas),
            componentType: FLOAT,
            count: vertexCount,
            type: 'VEC3',
            min: deltaBounds.min,
            max: deltaBounds.max,
          })
          for (const [semantic, values] of [
            ['NORMAL', target.normals],
            ['TANGENT', target.tangents],
          ] as const) {
            if (values === undefined) continue
            target_[semantic] = accessors.length
            accessors.push({
              bufferView: buffers.push(delta(values, semantic)),
              componentType: FLOAT,
              count: vertexCount,
              type: 'VEC3',
            })
          }
          return target_
        })
      }
      if (typeof primitive.materialId === 'string') {
        materialIds.add(primitive.materialId)
        entry.material = primitive.materialId
      }
      if (primitiveIndices.has(primitive.id)) ambiguousPrimitiveIds.add(primitive.id)
      if (ambiguousPrimitiveIds.has(primitive.id)) primitiveIndices.delete(primitive.id)
      else
        primitiveIndices.set(primitive.id, {
          mesh: emittedMeshes.length,
          primitive: meshPrimitives.length,
        })
      meshPrimitives.push(entry)
      emittedPrimitives += 1
    }
    emittedMeshes.push({ mesh, primitives: meshPrimitives })
  }

  // --- materials -----------------------------------------------------------------------------
  /*
   * A base-only projection still carries neutral materials. The optional material facet adds the
   * definitions, including unused materials. Artifact bindings remain positional; renumbering is
   * reported, and a missing definition in a supplied complete facet is a contradiction.
   */
  const definitions =
    projection.materials === undefined
      ? undefined
      : snapshotModelMaterials(projection.materials, materialBudget, signal)
  if (definitions !== undefined && definitions.length !== Number(info.materials ?? 0)) {
    fail('material definitions do not match the declared material count')
  }
  const definitionsById = new Map(definitions?.map(material => [material.id, material]))
  if (definitions !== undefined) {
    for (const id of materialIds)
      if (!definitionsById.has(id)) fail(`primitive refers to undefined material ${id}`)
  }
  const referenced = [...new Set([...materialIds, ...definitionsById.keys()])]
  const materialIndexById = new Map<string, number>()
  const materialCount = Math.max(Number(info.materials ?? 0), referenced.length)
  if (
    !Number.isSafeInteger(materialCount) ||
    materialCount < 0 ||
    materialCount > materialBudget.maxNodes
  ) {
    fail('material count exceeds the material budget')
  }
  const positionalMaterials = referenced.every(id => {
    const match = /^material-(0|[1-9]\d*)$/u.exec(id)
    if (match === null) return false
    const index = Number(match[1])
    if (!Number.isSafeInteger(index) || index < 0 || index >= materialCount) return false
    if ([...materialIndexById.values()].includes(index)) return false
    materialIndexById.set(id, index)
    return true
  })
  if (!positionalMaterials) {
    materialIndexById.clear()
    for (const [index, id] of [...referenced].sort(byUtf8).entries())
      materialIndexById.set(id, index)
    if (referenced.length > 0) {
      note(
        'uv.model/geometry@1',
        'value-differs',
        '/primitives/*/materialId',
        'the source names its materials outside the positional convention, so reopening renumbers them',
      )
    }
    if (definitions !== undefined)
      note(
        'common.view/model-material-source@1',
        'value-differs',
        '/materials/*/id',
        'material identity was renumbered to the positional UVM artifact convention',
      )
  }
  const materials: UvmMaterial[] = Array.from({ length: materialCount }, () => ({
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
  }))
  for (const definition of definitions ?? []) {
    const index = materialIndexById.get(definition.id)!
    const target = materials[index]!
    const { id: _id, name, shader, contracts, alphaMode, alphaCutoff, ...fields } = definition
    if (name !== undefined) target.name = name
    if (alphaMode !== undefined)
      target.alphaMode = alphaMode === 'opaque' ? 'OPAQUE' : alphaMode === 'mask' ? 'MASK' : 'BLEND'
    if (alphaCutoff !== undefined) target.alphaCutoff = alphaCutoff
    if (Object.keys(fields).length > 0)
      target.extras = { modkit: { material: { version: 1, fields } } }
    const artifactContracts: string[] = []
    if (shader !== undefined) {
      // the publisher's blend equation, when it is one the extension names (an additive light cone
      // is black where it adds nothing: without it, the reader draws a black card)
      const blendMode = fields['blendMode']
      target.extensions = {
        UV_game_material: {
          shader: shader.id,
          ...(isUvmGameBlendMode(blendMode) ? { blendMode } : {}),
          params: shader.parameters,
        },
      }
      const renderModel = shader.parameters['renderModel']
      if (renderModel !== null && typeof renderModel === 'object' && !Array.isArray(renderModel)) {
        const snapshot = renderModel as Readonly<Record<string, unknown>>
        if (snapshot['version'] === 1 && snapshot['standard'] !== undefined)
          artifactContracts.push('UV_game_material/standard')
        if (snapshot['version'] === 1 && snapshot['composite'] !== undefined)
          artifactContracts.push('UV_game_material/composite')
      }
    }
    if (
      JSON.stringify([...(contracts ?? [])].sort(byUtf8)) !==
      JSON.stringify(artifactContracts.sort(byUtf8))
    ) {
      note(
        'common.view/model-material-source@1',
        'value-differs',
        `/materials/${definition.id}/contracts`,
        'contract coverage is derived from the extensions actually written to UVM',
      )
    }
    const omitted = (contracts ?? []).filter(contract => !artifactContracts.includes(contract))
    if (omitted.length > 0) {
      lostFacetIds.push('common.view/model-material-source@1')
      losses.push(
        `material ${definition.id}: contract payloads not available: ${omitted.join(', ')}`,
      )
    }
  }
  // --- planes this profile cannot carry from the base contract alone --------------------------
  const closure = projection.resourceClosure
  const resourceImages = []
  /** glTF filter per image index, for the images whose closure entry names one. */
  const imageFilters: ('nearest' | 'linear' | undefined)[] = []
  if (closure !== undefined && closure !== null) {
    if (closure.mode !== 'logical' && closure.mode !== 'content-qualified') {
      fail('resourceClosure.mode must be logical or content-qualified')
    }
    for (const entry of closure.entries ?? []) {
      if (entry?.role !== 'image' && entry?.role !== 'texture') continue
      if (typeof entry.logicalId !== 'string' || entry.logicalId === '') {
        fail('every image/texture resource-closure entry needs a non-empty logicalId')
      }
      if (entry.filter !== undefined && entry.filter !== 'nearest' && entry.filter !== 'linear') {
        fail('a resource-closure filter is nearest or linear')
      }
      resourceImages.push({
        uri: entry.logicalId,
        ...(typeof entry.mediaHint === 'string' ? { mimeType: entry.mediaHint } : {}),
      })
      imageFilters.push(entry.filter)
    }
    const uncarried = (closure.entries ?? []).filter(
      entry => entry?.role !== 'image' && entry?.role !== 'texture',
    )
    if (uncarried.length > 0) {
      lostFacetIds.push('uv.model/resource-closure@1')
      note(
        'uv.model/resource-closure@1',
        'value-differs',
        undefined,
        `${uncarried.length} non-image resource closure entry or entries have no UVM/core artifact binding`,
      )
    }
    if ((closure.unavailable ?? []).length > 0) {
      lostFacetIds.push('uv.model/resource-closure@1')
      const ids = (closure.unavailable as readonly { readonly logicalId: string }[])
        .map(entry => entry.logicalId)
        .join(', ')
      losses.push(
        `${(closure.unavailable as readonly { readonly logicalId: string }[]).length} resource reference(s) were unavailable: ${ids}`,
      )
      note(
        'uv.model/resource-closure@1',
        'value-differs',
        undefined,
        `${(closure.unavailable as readonly { readonly logicalId: string }[]).length} resource reference(s) did not resolve through ResourceSessionPort: ${ids}`,
      )
    }
  }
  if (Number(info.textures ?? 0) > 0 && closure === undefined) {
    losses.push(`${info.textures} texture reference(s) were not carried`)
    note(
      'uv.model/structure@1',
      'value-differs',
      '/textures',
      'the base model contract publishes a texture count but no texture identity; writing empty texture objects to make the count match would be inventing data',
    )
  }
  // the glTF slots of every material whose layers name an image of the closure (GLTF_LAYER_SLOTS)
  const imageIndex = new Map(resourceImages.map((image, index) => [image.uri, index] as const))
  for (const definition of imageIndex.size === 0 ? [] : (definitions ?? [])) {
    const target = materials[materialIndexById.get(definition.id)!]!
    for (const layer of definition.layers ?? []) {
      const slot = GLTF_LAYER_SLOTS[layer.slot.toLowerCase()]
      const index = layer.resourceId === undefined ? undefined : imageIndex.get(layer.resourceId)
      if (slot === undefined || index === undefined) continue
      const ref: UvmTextureRef = {
        index,
        ...(layer.uvSource !== undefined &&
        Number.isSafeInteger(layer.uvSource) &&
        layer.uvSource > 0
          ? { texCoord: layer.uvSource }
          : {}),
      }
      if (slot === 'baseColor') target.pbrMetallicRoughness.baseColorTexture ??= ref
      else if (slot === 'normal') target.normalTexture ??= ref
      else if (slot === 'occlusion') target.occlusionTexture ??= ref
      else if (slot === 'emissive' && target.emissiveTexture === undefined) {
        target.emissiveTexture = ref
        // glTF multiplies the emissive texture by emissiveFactor, black by default
        target.emissiveFactor = [1, 1, 1]
      } else if (
        slot === 'teamColor' &&
        target.extensions?.UV_game_material_team_color === undefined
      ) {
        const channel = singleChannel(layer.colorChannels)
        target.extensions = {
          ...target.extensions,
          UV_game_material_team_color: {
            maskSource: 'texture',
            maskTexture: { ...ref, ...(channel === undefined ? {} : { channel }) },
            targets: ['baseColor'],
            blend: layer.blend ?? 'multiply',
          },
        }
      }
    }
  }
  if (closure !== undefined && resourceImages.length !== Number(info.textures ?? 0)) {
    note(
      'uv.model/structure@1',
      'value-differs',
      '/textures',
      `the resource closure carries ${resourceImages.length} image identity or identities, while the base model contract counts ${Number(info.textures ?? 0)} texture(s)`,
    )
  }
  if (Number(info.animations ?? 0) > 0 && projection.animations === undefined) {
    losses.push(`${info.animations} animation(s) were not carried`)
    note(
      'uv.model/structure@1',
      'value-differs',
      '/animations',
      'the base model contract publishes an animation count but no clips or channels; the optional animation facet is what will carry them',
    )
  }
  if (Number(info.scenes ?? 1) !== 1) {
    note(
      'uv.model/structure@1',
      'value-differs',
      '/scenes',
      'UVM/core describes a single game object, so exactly one scene is written',
    )
  }
  if (primitives === undefined) {
    excludedFacetIds.push('uv.model/geometry@1')
    note(
      'uv.model/geometry@1',
      'absent-in-live',
      undefined,
      'the source is metadata-only, so there was no geometry to carry',
    )
    /*
     * `geometryAccess` cannot round-trip out of a metadata-only source, and the reason is in the
     * artifact binding rather than in this materializer: a reopened UVM document always reports
     * `decoded`, because a UVM file either carries buffers or is not a UVM file. There is nothing
     * to write that would make the two agree — found by the first real W3X container run of block
     * 12, where a projection with no decoded mesh produced an otherwise unexplained structure diff.
     */
    note(
      'uv.model/structure@1',
      'value-differs',
      '/geometryAccess',
      'a metadata-only projection materialises into a document the artifact binding reopens as «decoded»; the flag describes the reader, and no byte written here could carry the source’s answer',
    )
  }

  /*
   * Bounds are asymmetric in the artifact binding, and pretending otherwise would hide a real
   * difference.
   *
   * A reopened UVM document derives its bounds from the decoded positions, always. So a source
   * that publishes geometry without bounds *gains* the facet on reopen, and a source that
   * publishes bounds without geometry *loses* it. Neither is a defect in the materializer and
   * neither can be fixed by writing something into the file — the reader computes, it does not
   * read. Both are recorded so that the hash difference has a name.
   */
  const liveBounds = info.bounds !== undefined && info.bounds !== null
  const artifactBounds = emittedPrimitives > 0
  if (liveBounds && !artifactBounds) {
    note(
      'uv.model/bounds@1',
      'absent-in-artifact',
      undefined,
      'the artifact binding derives bounds from decoded geometry, and this materialization wrote none',
    )
  }
  if (!liveBounds && artifactBounds) {
    note(
      'uv.model/bounds@1',
      'absent-in-live',
      undefined,
      'the artifact binding derives bounds from decoded geometry, so reopening publishes bounds this source did not',
    )
  }
  if (primitives === undefined && Number(info.primitives ?? 0) > 0) {
    note(
      'uv.model/structure@1',
      'value-differs',
      '/primitives',
      'a metadata-only source counts primitives it does not publish; the artifact carries only what was written',
    )
  }

  // --- document ------------------------------------------------------------------------------
  const childless = new Set(orderedNodes.map(node => node.id))
  for (const node of orderedNodes) {
    for (const child of node.childIds ?? []) childless.delete(child)
  }
  let rootIndices = orderedNodes
    .filter(node => childless.has(node.id))
    .map(node => nodeIndexById.get(node.id)!)

  const socketByNodeId = new Map()
  const socketIds = new Set<string>()
  const roleOrdinals = new Map<string, number>()
  for (const socket of projection.sockets ?? []) {
    if (
      typeof socket?.id !== 'string' ||
      socket.id.length === 0 ||
      typeof socket.nodeId !== 'string' ||
      typeof socket.role !== 'string' ||
      socket.role.length === 0
    ) {
      fail('every socket needs non-empty id, nodeId and role')
    }
    if (!nodeIndexById.has(socket.nodeId)) {
      fail(`socket «${socket.id}» targets absent node «${socket.nodeId}»`)
    }
    if (socketByNodeId.has(socket.nodeId)) {
      fail(`node «${socket.nodeId}» carries more than one socket`)
    }
    if (socketIds.has(socket.id)) fail(`socket «${socket.id}» is duplicated`)
    socketIds.add(socket.id)
    const index = roleOrdinals.get(socket.role) ?? 0
    roleOrdinals.set(socket.role, index + 1)
    socketByNodeId.set(socket.nodeId, {
      ...(/^[a-z][a-z0-9-]*$/u.test(socket.id) ? { id: socket.id } : {}),
      role: socket.role,
      index,
      ...(typeof socket.sourceName === 'string' ? { sourceName: socket.sourceName } : {}),
      ...(socket.orientation === undefined
        ? {}
        : { forward: socket.orientation.forward, up: socket.orientation.up }),
      // Preserve the previous publisher metadata while the shared socket ID is authoritative.
      extras: { modkit: { id: socket.id, nodeId: socket.nodeId } },
    })
  }

  const documentNodes = orderedNodes.map(node => {
    const entry: DocumentNode = {}
    const bone = skeleton?.boneByNode.get(node.id)
    if (typeof node.name === 'string') entry.name = node.name
    else if (typeof bone?.boneName === 'string' && bone.boneName.length > 0)
      entry.name = bone.boneName
    const children = (node.childIds ?? [])
      .map(child => nodeIndexById.get(child))
      .filter(index => index !== undefined)
    if (children.length > 0) entry.children = children
    const meshId = (node.meshIds ?? [])[0]
    if (meshId !== undefined && meshIndexById.has(meshId)) entry.mesh = meshIndexById.get(meshId)
    const skin = meshId === undefined ? undefined : meshSkins.get(meshId)
    if (skin !== undefined && skin !== null) entry.skin = skin
    if ((node.meshIds ?? []).length > 1) {
      note(
        'uv.model/hierarchy@1',
        'value-differs',
        `/nodes/${node.id}/meshIds`,
        'a glTF node carries at most one mesh; only the first was written',
      )
    }
    const transform = finite([...(node.transform ?? [])], `node ${node.id} transform`)
    if (transform.length !== 16) fail(`node «${node.id}» transform must carry 16 numbers`)
    // identity is the reader's default; writing it back would be noise, and it reopens the same
    if (bone !== undefined) {
      entry.translation = [...bone.localPose!.translation]
      entry.rotation = [...bone.localPose!.rotation]
      entry.scale = [...bone.localPose!.scale]
    } else if (node.trs !== undefined) {
      // The publisher stated the decomposition; it must be the transform it also published.
      const { translation, rotation, scale } = node.trs
      finite([...translation, ...rotation, ...scale], `node ${node.id} trs`)
      if (Math.abs(Math.hypot(...rotation) - 1) > 1e-4)
        fail(`node «${node.id}» trs rotation must be a unit quaternion`)
      const composed = new Float32Array(16)
      composeTrsMatrix(composed, 0, translation, rotation, scale)
      if (composed.some((value, index) => !closeTo(value, transform[index]!)))
        fail(`node «${node.id}» trs does not compose to its transform`)
      entry.translation = [...translation]
      entry.rotation = [...rotation]
      entry.scale = [...scale]
    } else if (transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0))) {
      entry.matrix = transform
    }
    const socket = socketByNodeId.get(node.id)
    if (socket !== undefined) entry.extensions = { UV_game_socket: socket }
    return entry
  })

  const documentMeshes = emittedMeshes.map(({ mesh, primitives: entries }) => {
    const value: {
      name?: string
      primitives?: DocumentPrimitive[]
      weights?: number[]
      extras?: { targetNames: string[] }
    } = {}
    if (typeof mesh.name === 'string') value.name = mesh.name
    value.primitives = entries.map(entry => {
      const primitive: DocumentPrimitive = { attributes: entry.attributes, indices: entry.indices }
      if (entry.material !== undefined) primitive.material = materialIndexById.get(entry.material)
      if (entry.targets !== undefined) primitive.targets = entry.targets
      return primitive
    })
    // glTF: default weights on the mesh, target names by the common `extras.targetNames` convention
    const names = meshTargetNames.get(mesh.id) ?? []
    if (names.length > 0) {
      const weights = mesh.morphWeights ?? names.map(() => 0)
      if (weights.length !== names.length || !weights.every(Number.isFinite))
        fail(`mesh ${mesh.id} morph weights must be ${names.length} finite numbers`)
      value.weights = [...weights]
      if (names.every(name => typeof name === 'string'))
        value.extras = { targetNames: names as string[] }
    } else if (mesh.morphWeights !== undefined && mesh.morphWeights.length > 0) {
      fail(`mesh ${mesh.id} has morph weights but no morph targets`)
    }
    return value
  })

  for (const group of skeleton?.groupingRoots ?? []) {
    // A glTF skin needs one common ancestor. An identity grouping node changes no bind or pose.
    // Retain an existing common identity ancestor on re-export instead of nesting more wrappers.
    const existing =
      group.children.length === 1
        ? group.children[0]!
        : documentNodes.findIndex(node =>
            group.children.every(child => node.children?.includes(child)),
          )
    if (existing >= 0) {
      skeleton!.skins[group.skin]!.skeleton = existing
      continue
    }
    const root = documentNodes.length
    documentNodes.push({ children: [...group.children] })
    const children = new Set(group.children)
    rootIndices = [...rootIndices.filter(index => !children.has(index)), root]
    skeleton!.skins[group.skin]!.skeleton = root
    note(
      'uv.model/hierarchy@1',
      'absent-in-live',
      `/nodes/node-${root}`,
      'an identity grouping node gives the independent skeleton roots a common glTF ancestor',
    )
    note(
      'uv.model/structure@1',
      'value-differs',
      '/nodes',
      'glTF skin grouping adds one identity scene node',
    )
  }

  // `projection.lods`: each level's root nodes go under one group node; the order-0 group stays in
  // the scene and names the lower groups in MSFT_lod (they replace it in place, so the units and
  // up-axis wrappers below apply to them too). A node in no level is drawn at every level.
  let lodSelection: object | undefined
  if (projection.lods !== undefined && projection.lods.length > 0) {
    const levels = [...projection.lods].sort((a, b) => a.order - b.order)
    if (levels.length < 2) fail('discrete LOD needs at least two levels')
    if (levels.some((level, at) => at > 0 && level.order === levels[at - 1]!.order))
      fail('two LOD levels share an order')
    const claimed = new Set<number>()
    const groups = levels.map(level => {
      if (level.nodeIds.length === 0) fail(`LOD level ${level.id} names no nodes`)
      const members = level.nodeIds.map(id => {
        const index = nodeIndexById.get(id)
        if (index === undefined) fail(`LOD level ${level.id} names unknown node ${id}`)
        if (!rootIndices.includes(index))
          fail(
            `LOD level ${level.id} node ${id} is not a scene root; levels group whole root nodes`,
          )
        if (claimed.has(index)) fail(`node ${id} belongs to two LOD levels`)
        claimed.add(index)
        return index
      })
      const group = documentNodes.length
      documentNodes.push({ name: `uv:lod-${level.order}`, children: members })
      return { level, group }
    })
    documentNodes[groups[0]!.group]!.extensions = {
      MSFT_lod: { ids: groups.slice(1).map(entry => entry.group) },
    }
    rootIndices = [...rootIndices.filter(index => !claimed.has(index)), groups[0]!.group]
    const thresholds = groups.filter(
      ({ level }) => level.screenCoverage !== undefined || level.maxDistance !== undefined,
    )
    if (thresholds.length > 0)
      lodSelection = {
        policy: groups.some(({ level }) => level.screenCoverage !== undefined)
          ? 'screen-coverage'
          : 'distance',
        levels: groups.map(({ level, group }) => ({
          node: group,
          ...(level.screenCoverage === undefined ? {} : { screenCoverage: level.screenCoverage }),
          ...(level.maxDistance === undefined ? {} : { maxDistance: level.maxDistance }),
        })),
      }
    note(
      'uv.model/structure@1',
      'value-differs',
      '/nodes',
      `${groups.length} LOD levels are grouped under one node each (MSFT_lod)`,
    )
  }

  // Materials whose published params carry sequence tracks (UV offset, tiling, colour) are the
  // clip catalog's material targets; one index for every codec, not a pass after materialization.
  const materialTargets =
    projection.materials === undefined
      ? []
      : materializeUvmAnimationMaterialTargets(projection.materials, materialBudget, signal)

  // A +z-up source (ModelSceneInfo.upAxis) is turned to UVM's +y-up by one rotation node — the same
  // (x, y, z) → (x, z, -y) the model viewer applies — so the geometry itself stays as published.
  if (info.upAxis === '+z') {
    const root = documentNodes.length
    documentNodes.push({
      name: 'uv:up-axis',
      rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      children: [...rootIndices],
    })
    rootIndices = [root]
    note(
      'uv.model/structure@1',
      'value-differs',
      '/nodes',
      'one rotation node turns the +z-up source to +y-up',
    )
  }

  // `options.units`: the projection is in source units. One scale node puts the scene in metres and
  // UV_units records the factor, so an exporter inverts it exactly (SPEC_UVM_EXTENSIONS, UV_units).
  const unitsExtension = uvUnits((request.options as { units?: unknown } | undefined)?.units)
  if (unitsExtension !== undefined && unitsExtension.metersPerSourceUnit !== 1) {
    const scale = unitsExtension.metersPerSourceUnit
    const root = documentNodes.length
    documentNodes.push({
      name: 'uv:units',
      scale: [scale, scale, scale],
      children: [...rootIndices],
    })
    rootIndices = [root]
    note(
      'uv.model/structure@1',
      'value-differs',
      '/nodes',
      'one scale node brings the source units to metres (UV_units)',
    )
  }

  const animation =
    projection.animations === undefined
      ? undefined
      : writeUvmAnimations(
          projection.animations,
          nodeIndexById,
          skeleton?.boneByNode ?? new Map(),
          rigStorage,
          animationBudget,
          signal,
          primitiveIndices,
          // Identity scene nodes have explicit TRS defaults without inventing skin membership.
          // Authored matrix nodes remain ineligible: decomposition is not an implicit export step.
          new Set(
            orderedNodes
              .filter(node => {
                const index = nodeIndexById.get(node.id)
                return index !== undefined && documentNodes[index]?.matrix === undefined
              })
              .map(node => node.id),
          ),
          new Map(
            orderedNodes.flatMap(node => {
              const count = meshTargetNames.get((node.meshIds ?? [])[0] ?? '')?.length ?? 0
              return count > 0 ? [[node.id, count] as const] : []
            }),
          ),
        )
  for (const loss of animation?.losses ?? []) {
    losses.push(`animation ${loss.clipId}: ${loss.reason}`)
    note(
      'common.view/model-animation-source@1',
      'value-differs',
      `/animations/${loss.clipId}${loss.channel === undefined ? '' : `/channels/${loss.channel}`}`,
      loss.reason,
    )
    lostFacetIds.push('common.view/model-animation-source@1')
  }
  if (animation !== undefined && animation.animations.length !== Number(info.animations ?? 0))
    note(
      'uv.model/structure@1',
      'value-differs',
      '/animations',
      'only clips with writable channels appear as glTF animations; the complete selectable set is retained in UV_game_animation_clips',
    )
  if (skeleton !== undefined && skeleton.skins.length > 0) {
    note(
      'common.view/model-skeleton-source@1',
      'value-differs',
      undefined,
      'bone indices and hierarchy identities use positional skin joints; publisher-native flags, part identity and matrix annotations are not glTF skin fields',
    )
    note(
      'uv.model/geometry@1',
      'value-differs',
      '/primitives/*/skin',
      'bone indices are remapped to their positional skin joint slots',
    )
  }
  if (animation !== undefined && animation.animations.length > 0)
    note(
      'common.view/model-animation-source@1',
      'value-differs',
      undefined,
      'clip and target identities are positional; native frame indices, provenance, bounds and movement speed are not glTF TRS fields',
    )
  const binary = buffers.build()
  const gameExtensions = gameExtensionsOf(projection)
  const document = {
    asset: {
      version: '2.0',
      generator: `${MATERIALIZER_ID}/${MATERIALIZER_VERSION}`,
      extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
    },
    extensionsUsed: [
      'UV_asset',
      'UV_provenance',
      ...(socketByNodeId.size === 0 ? [] : ['UV_game_socket']),
      ...(materials.some(material => material.extensions?.UV_game_material !== undefined)
        ? ['UV_game_material']
        : []),
      ...(materials.some(material => material.extensions?.UV_game_material_team_color !== undefined)
        ? ['UV_game_material_team_color']
        : []),
      ...(animation === undefined || animation.catalog.length === 0
        ? []
        : ['UV_game_animation_clips']),
      ...(animation === undefined || animation.visibility.length === 0
        ? []
        : ['UV_game_variants', 'KHR_animation_pointer']),
      ...(unitsExtension === undefined ? [] : ['UV_units']),
      ...(projection.lods !== undefined && projection.lods.length > 0 ? ['MSFT_lod'] : []),
      ...(lodSelection === undefined ? [] : ['MODKITX_lod_selection']),
      ...gameExtensions.map(([name]) => name),
    ],
    extensions: {
      ...Object.fromEntries(gameExtensions),
      ...(unitsExtension === undefined ? {} : { UV_units: unitsExtension }),
      ...(lodSelection === undefined ? {} : { MODKITX_lod_selection: lodSelection }),
      ...(animation === undefined || animation.visibility.length === 0
        ? {}
        : {
            UV_game_variants: { visibility: animation.visibility },
          }),
      ...(animation === undefined || animation.catalog.length === 0
        ? {}
        : {
            UV_game_animation_clips: {
              clips: animation.catalog,
              ...(materialTargets.length === 0 ? {} : { materialTargets }),
            },
          }),
      UV_asset: {
        id: assetId,
        class: (request.options as { assetClass?: string } | undefined)?.assetClass ?? 'prop',
        coreRenderable: emittedPrimitives > 0,
        ...(socketByNodeId.size === 0 ? {} : { sockets: socketByNodeId.size }),
      },
      UV_provenance: {
        source: { format: sourceFormat },
        importer: { id: MATERIALIZER_ID, version: MATERIALIZER_VERSION },
        lost: losses,
      },
    },
    scene: 0,
    scenes: [{ nodes: rootIndices }],
    nodes: documentNodes,
    ...(documentMeshes.length === 0 ? {} : { meshes: documentMeshes }),
    ...(materials.length === 0 ? {} : { materials }),
    ...(skeleton === undefined || skeleton.skins.length === 0 ? {} : { skins: skeleton.skins }),
    ...(animation === undefined || animation.animations.length === 0
      ? {}
      : { animations: animation.animations }),
    ...(resourceImages.length === 0
      ? {}
      : {
          images: resourceImages,
          ...texturesWithSamplers(imageFilters),
        }),
    accessors,
    bufferViews: buffers.views,
    buffers: [{ byteLength: binary.byteLength }],
  }

  const bytes = packUvmGlb(document, binary)
  const receipt = {
    materializer: {
      id: MATERIALIZER_ID,
      version: MATERIALIZER_VERSION,
      ...(request.options === undefined ? {} : { options: request.options }),
    },
    scope: request.scope,
    profile: request.profile ?? PROFILE,
    subjectRevision: request.subjectRevision,
    lostFacetIds: [...new Set(lostFacetIds)].sort(byUtf8),
    excludedFacetIds: [...new Set(excludedFacetIds)].sort(byUtf8),
    diff,
    ...(digest === undefined ? {} : { artifactDigest: digest(bytes) }),
  }
  // Native importers retain these exact correspondences beside their original fields. The
  // materializer owns ordering; callers must not reconstruct it from names or source array order.
  const bindings = {
    nodes: Object.fromEntries(nodeIndexById),
    meshes: Object.fromEntries(meshIndexById),
    materials: Object.fromEntries(materialIndexById),
  }
  return { bytes, document, binary, receipt, bindings }
}

export const MATERIALIZER_COORDINATE = Object.freeze({
  id: MATERIALIZER_ID,
  version: MATERIALIZER_VERSION,
  profile: PROFILE,
})
