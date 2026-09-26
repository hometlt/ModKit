import type {
  PageRequest,
  Page,
  ModelAnimationClip,
  ModelAnimationSource,
  ModelBoneBinding,
  ModelCollisionSource,
  ModelCollisionVolume,
  ModelMaterialRef,
  ModelMaterialSource,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelResourceRef,
  ModelResourceRefsSource,
  ModelSceneInfo,
  ModelSceneSource,
  ModelSkeletonSource,
  ModelCameraRef,
  ModelCameraSource,
  ModelEffectProperty,
  ModelLightRef,
  ModelLightSource,
  ModelNodeBehaviourRef,
  ModelNodeBehaviourSource,
  ModelPhysicsRef,
  ModelPhysicsSource,
  ModelEffectRef,
  ModelEffectSource,
  ModelSocketRef,
  ModelSocketSource,
} from '@modkit/sdk'
import type { JsonSnapshotBudget } from '../json-snapshot.js'
import { pageStart } from '../paging.js'
import { snapshotModelMaterials } from './materials.js'
import { snapshotModelAnimations } from './animation.js'
import { snapshotModelSkeleton } from './skeleton.js'
import { modelPrimitiveByteLength } from './geometry.js'

function frozenModelNode(node: ModelNode): ModelNode {
  return Object.freeze<ModelNode>({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    meshIds: Object.freeze([...node.meshIds]),
    transform: Object.freeze([...node.transform]),
    ...(node.trs === undefined
      ? {}
      : {
          trs: Object.freeze({
            translation: Object.freeze([...node.trs.translation]) as typeof node.trs.translation,
            rotation: Object.freeze([...node.trs.rotation]) as typeof node.trs.rotation,
            scale: Object.freeze([...node.trs.scale]) as typeof node.trs.scale,
          }),
        }),
  })
}

function frozenModelMesh(mesh: ModelMesh): ModelMesh {
  return Object.freeze<ModelMesh>({ ...mesh, primitiveIds: Object.freeze([...mesh.primitiveIds]) })
}

function clonePrimitive(primitive: ModelPrimitive): ModelPrimitive {
  return Object.freeze<ModelPrimitive>({
    ...primitive,
    positions: primitive.positions.slice(),
    ...(primitive.indices === undefined ? {} : { indices: primitive.indices.slice() }),
    ...(primitive.normals === undefined ? {} : { normals: primitive.normals.slice() }),
    ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents.slice() }),
    ...(primitive.colors === undefined ? {} : { colors: primitive.colors.slice() }),
    ...(primitive.boneIndices === undefined ? {} : { boneIndices: primitive.boneIndices.slice() }),
    ...(primitive.boneWeights === undefined ? {} : { boneWeights: primitive.boneWeights.slice() }),
    ...(primitive.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: primitive.textureCoordinates.slice() }),
    ...(primitive.textureCoordinateSets === undefined
      ? {}
      : {
          textureCoordinateSets: Object.freeze(
            primitive.textureCoordinateSets.map(channel =>
              Object.freeze({ set: channel.set, coordinates: channel.coordinates.slice() }),
            ),
          ),
        }),
  })
}

/** Create a lazy model-scene source; decoded primitive buffers are returned as owned copies. */
export function createModelSceneSource({
  info,
  nodes,
  meshes,
  primitives = [],
}: {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
}): ModelSceneSource {
  const ownedInfo = Object.freeze({ ...info })
  const ownedNodes = Object.freeze(nodes.map(frozenModelNode))
  const ownedMeshes = Object.freeze(meshes.map(frozenModelMesh))
  const ownedPrimitives = new Map(primitives.map(value => [value.id, clonePrimitive(value)]))
  const page = <T>(items: readonly T[], request: PageRequest): Page<T> => {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new TypeError('model page limit must be a positive safe integer')
    }
    const start = pageStart(request.cursor)
    const values = items.slice(start, start + request.limit)
    return Object.freeze({
      items: Object.freeze(values),
      ...(start + values.length < items.length
        ? { nextCursor: String(start + values.length) }
        : {}),
    })
  }
  const source: ModelSceneSource = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async nodes(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return page(ownedNodes, request)
    },
    async meshes(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return page(ownedMeshes, request)
    },
  }
  if (ownedPrimitives.size > 0) {
    source.primitive = async (primitiveId, request, signal) => {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 0) {
        throw new TypeError('model primitive maxBytes must be a non-negative safe integer')
      }
      const primitive = ownedPrimitives.get(primitiveId)
      if (primitive === undefined) throw new RangeError(`unknown model primitive ${primitiveId}`)
      const bytes = modelPrimitiveByteLength(primitive)
      if (bytes > request.maxBytes) throw new RangeError('model primitive exceeds maxBytes budget')
      return clonePrimitive(primitive)
    }
  }
  return Object.freeze(source)
}

// ---------------------------------------------------------------------------------------------
// optional model facet sources (block 12, slice 12-1 — migration of the ad hoc summaries)
//
// The five contracts of `model-facet-sources.ts` were derived from what these codecs already
// computed; these builders are the other half of that move. Each derives its `info()` counts from
// the records it was handed rather than accepting them from the caller, so a publisher physically
// cannot say "seven references" and then page four: the summary and the page are the same data.
//
// A publisher that cannot answer does not call the builder at all. None of these fills a missing
// field with a zero, an empty array or an invented name — an absent facet is absent (§2.7).

/** Shared page rule for the facet sources: same cursor grammar as the base model source. */
function facetPage<T>(items: readonly T[], request: PageRequest): Page<T> {
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
    throw new TypeError('model facet page limit must be a positive safe integer')
  }
  const start = pageStart(request.cursor)
  const values = items.slice(start, start + request.limit)
  return Object.freeze<Page<T>>({
    items: Object.freeze(values),
    ...(start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}),
  })
}

function facetSource<Info, Key extends string, Item extends object>(
  info: Info,
  key: Key,
  items: readonly Item[],
): Readonly<
  { info(signal?: AbortSignal): Promise<Info> } & Record<
    Key,
    (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
  >
> {
  const owned = Object.freeze(items.map(item => Object.freeze({ ...item })))
  const source = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return info
    },
  }
  ;(
    source as unknown as Record<
      Key,
      (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
    >
  )[key] = async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    return facetPage(owned, request)
  }
  return Object.freeze(source) as Readonly<
    { info(signal?: AbortSignal): Promise<Info> } & Record<
      Key,
      (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
    >
  >
}

/**
 * `common.view/model-resource-refs-source@1` — logical requirements, never opened here.
 *
 * `bound` counts the entries the host actually bound, which is why `bindingId` is the only thing
 * that may promote a reference: a codec that guessed a companion existed would be reporting the
 * resolver's job as its own.
 */
export function createModelResourceRefsSource({
  references,
  truncated = false,
}: {
  readonly references: readonly ModelResourceRef[]
  readonly truncated?: boolean
}): ModelResourceRefsSource {
  const items = [...references]
  const info = Object.freeze({
    references: items.length,
    bound: items.filter(item => item.bindingId !== undefined).length,
    truncated: truncated === true,
  })
  return facetSource(info, 'references', items)
}

/** `common.view/model-skeleton-source@1` — bone bindings and where each name came from. */
export function createModelSkeletonSource({
  bindings,
  hierarchies,
  budget,
}: {
  readonly bindings: readonly ModelBoneBinding[]
  readonly hierarchies?: number
  readonly budget?: JsonSnapshotBudget
}): ModelSkeletonSource {
  const items = snapshotModelSkeleton(bindings, budget)
  const info = Object.freeze({
    bindings: items.length,
    named: items.filter(item => item.boneName !== null).length,
    companionBound: items.filter(item => item.provenance === 'companion').length,
    // absent, not zero, when the publisher does not enumerate hierarchies
    ...(hierarchies === undefined ? {} : { hierarchies }),
  })
  return facetSource(info, 'bindings', items)
}

/** `common.view/model-animation-source@1` — clips, and a rest pose stays a rest pose. */
export function createModelAnimationSource({
  clips,
  budget,
}: {
  readonly clips: readonly ModelAnimationClip[]
  readonly budget?: JsonSnapshotBudget
}): ModelAnimationSource {
  const items = snapshotModelAnimations(clips, budget)
  const info = Object.freeze({
    clips: items.length,
    channelled: items.filter(clip => clip.channels.length > 0).length,
    companionBound: items.filter(clip => clip.provenance === 'companion').length,
  })
  return facetSource(info, 'clips', items)
}

/** `common.view/model-collision-source@1` — declared volumes and mesh roles, kept apart. */
export function createModelCollisionSource({
  volumes,
}: {
  readonly volumes: readonly ModelCollisionVolume[]
}): ModelCollisionSource {
  const items = volumes.map(volume => ({
    ...volume,
    ...(volume.types === undefined ? {} : { types: Object.freeze([...volume.types]) }),
  }))
  const byKind: Record<string, number> = {}
  for (const volume of items) byKind[volume.kind] = (byKind[volume.kind] ?? 0) + 1
  const info = Object.freeze({ volumes: items.length, byKind: Object.freeze(byKind) })
  return facetSource(info, 'volumes', items)
}

/** Material identity, contract coverage and preserved parameters; pixel equivalence is not implied. */
export function createModelMaterialSource({
  materials,
  libraries,
  budget,
}: {
  readonly materials: readonly ModelMaterialRef[]
  readonly libraries?: number
  /** Bound the complete facet, including shader parameters and native metadata. */
  readonly budget?: JsonSnapshotBudget
}): ModelMaterialSource {
  const items = snapshotModelMaterials(materials, budget)
  const byContract: Record<string, number> = {}
  for (const material of items) {
    for (const contract of material.contracts ?? []) {
      byContract[contract] = (byContract[contract] ?? 0) + 1
    }
  }
  const info = Object.freeze({
    materials: items.length,
    // absent, not zero, when the format has no library concept at all
    ...(libraries === undefined ? {} : { libraries }),
    ...(Object.keys(byContract).length === 0 ? {} : { byContract: Object.freeze(byContract) }),
  })
  return facetSource(info, 'materials', items)
}

/** `common.view/model-socket-source@1` — stable attachment identity and native source name. */
/**
 * Emitters and fields, as the model declares them.
 *
 * Properties are carried in the publisher's own words and order: emitter parameters do not
 * generalise across games, and a shared vocabulary would silently drop whatever did not fit.
 */
export function createModelEffectSource({
  effects,
  profile,
}: {
  readonly effects: readonly ModelEffectRef[]
  readonly profile?: string
}): ModelEffectSource {
  const items = effects.map(effect => ({
    ...effect,
    ...(effect.properties === undefined
      ? {}
      : {
          properties: Object.freeze(
            effect.properties.map((one: ModelEffectProperty) => Object.freeze({ ...one })),
          ),
        }),
  }))
  const byKind: Record<string, number> = {}
  for (const effect of items) byKind[effect.kind] = (byKind[effect.kind] ?? 0) + 1
  return facetSource(
    Object.freeze({
      effects: items.length,
      byKind: Object.freeze(byKind),
      ...(profile === undefined ? {} : { profile }),
    }),
    'effects',
    items,
  )
}

/** Lights, as the model declares them. */
export function createModelLightSource({
  lights,
}: {
  readonly lights: readonly ModelLightRef[]
}): ModelLightSource {
  const items = lights.map(light => ({
    ...light,
    ...(light.color === undefined ? {} : { color: Object.freeze([...light.color] as const) }),
    ...(light.properties === undefined
      ? {}
      : {
          properties: Object.freeze(
            light.properties.map((one: ModelEffectProperty) => Object.freeze({ ...one })),
          ),
        }),
  }))
  const byKind: Record<string, number> = {}
  for (const light of items) byKind[light.kind] = (byKind[light.kind] ?? 0) + 1
  return facetSource(
    Object.freeze({ lights: items.length, byKind: Object.freeze(byKind) }),
    'lights',
    items,
  ) as unknown as ModelLightSource
}

/** Cameras, as the model declares them. */
export function createModelCameraSource({
  cameras,
}: {
  readonly cameras: readonly ModelCameraRef[]
}): ModelCameraSource {
  const items = cameras.map(camera => ({
    ...camera,
    ...(camera.properties === undefined
      ? {}
      : {
          properties: Object.freeze(
            camera.properties.map((one: ModelEffectProperty) => Object.freeze({ ...one })),
          ),
        }),
  }))
  return facetSource(
    Object.freeze({ cameras: items.length }),
    'cameras',
    items,
  ) as unknown as ModelCameraSource
}

/** Simulation bodies and their relations. */
export function createModelPhysicsSource({
  bodies,
}: {
  readonly bodies: readonly ModelPhysicsRef[]
}): ModelPhysicsSource {
  const items = bodies.map(body => ({
    ...body,
    ...(body.properties === undefined
      ? {}
      : {
          properties: Object.freeze(
            body.properties.map((one: ModelEffectProperty) => Object.freeze({ ...one })),
          ),
        }),
  }))
  const byKind: Record<string, number> = {}
  for (const body of items) byKind[body.kind] = (byKind[body.kind] ?? 0) + 1
  return facetSource(
    Object.freeze({ bodies: items.length, byKind: Object.freeze(byKind) }),
    'bodies',
    items,
  ) as unknown as ModelPhysicsSource
}

/** Turrets, inverse-kinematics chains and billboards: what the engine drives on its own. */
export function createModelNodeBehaviourSource({
  behaviours,
}: {
  readonly behaviours: readonly ModelNodeBehaviourRef[]
}): ModelNodeBehaviourSource {
  const items = behaviours.map(behaviour => ({
    ...behaviour,
    ...(behaviour.nodeIds === undefined ? {} : { nodeIds: Object.freeze([...behaviour.nodeIds]) }),
    ...(behaviour.properties === undefined
      ? {}
      : {
          properties: Object.freeze(
            behaviour.properties.map((one: ModelEffectProperty) => Object.freeze({ ...one })),
          ),
        }),
  }))
  const byKind: Record<string, number> = {}
  for (const behaviour of items) byKind[behaviour.kind] = (byKind[behaviour.kind] ?? 0) + 1
  return facetSource(
    Object.freeze({ behaviours: items.length, byKind: Object.freeze(byKind) }),
    'behaviours',
    items,
  ) as unknown as ModelNodeBehaviourSource
}

export function createModelSocketSource({
  sockets,
}: {
  readonly sockets: readonly ModelSocketRef[]
}): ModelSocketSource {
  const items = sockets.map(socket => ({
    ...socket,
    ...(socket.orientation === undefined
      ? {}
      : { orientation: Object.freeze({ ...socket.orientation }) }),
  }))
  const byRole: Record<string, number> = {}
  for (const socket of items) byRole[socket.role] = (byRole[socket.role] ?? 0) + 1
  return facetSource(
    Object.freeze({ sockets: items.length, byRole: Object.freeze(byRole) }),
    'sockets',
    items,
  )
}
