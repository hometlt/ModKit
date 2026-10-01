import type {
  ModelLodLevelRef,
  ModelSceneInfo,
  ModelSceneSource,
  ModelPrimitive,
  ModelNode,
  ModelMesh,
  Page,
  PageRequest,
} from '@modkit/sdk'
import { modelPrimitiveByteLength } from '@modkit/codec-kit/model/geometry'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'

export const MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024
export const MODEL_MAXIMUM_PRIMITIVES = 4096
export const MODEL_MAXIMUM_RECORDS = 65_536

/** Complete bounded pagination; a repeated cursor or exceeded budget is never silent truncation. */
export async function readModelRecords<T>(
  read: (page: PageRequest, signal?: AbortSignal) => Promise<Page<T>>,
  maximum: number,
  signal?: AbortSignal,
): Promise<readonly T[]> {
  const records: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let bytes = 0
  do {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const limit = Math.min(256, maximum - records.length)
    if (limit <= 0) throw new RangeError('model source exceeds record budget')
    const page = await read({ limit, ...(cursor === undefined ? {} : { cursor }) }, signal)
    if (!Array.isArray(page.items) || page.items.length > limit)
      throw new TypeError('model source exceeded page limit')
    const items = snapshotJson(
      page.items,
      { maxDepth: 64, maxNodes: 1_000_000, maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes },
      signal,
    ) as unknown as readonly T[]
    bytes += new TextEncoder().encode(JSON.stringify(items)).byteLength
    records.push(...items)
    cursor = page.nextCursor
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || cursor.length > 4096 || seen.has(cursor))
        throw new TypeError('model source repeated or invalid cursor')
      if (items.length === 0)
        throw new TypeError('model source returned an empty page with a cursor')
      seen.add(cursor)
    }
  } while (cursor !== undefined)
  return Object.freeze(records)
}

export interface ModelStageModel {
  readonly info: ModelSceneInfo
  readonly primitiveIds: readonly string[]
  /** First primitive retained for older consumers; the stage renders the complete snapshot. */
  readonly primitive?: ModelPrimitive
  readonly primitives: readonly ModelPrimitive[]
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
}

export async function loadModelStage(
  source: ModelSceneSource,
  signal?: AbortSignal,
): Promise<ModelStageModel> {
  const info = await source.info(signal)
  const meshes = await readModelRecords(
    (page, abort) => source.meshes(page, abort),
    MODEL_MAXIMUM_PRIMITIVES,
    signal,
  )
  const nodes = await readModelRecords(
    (page, abort) => source.nodes(page, abort),
    MODEL_MAXIMUM_RECORDS,
    signal,
  )
  const ids = new Set<string>()
  for (const mesh of meshes)
    for (const id of mesh.primitiveIds) {
      if (typeof id !== 'string' || !id) throw new TypeError('invalid model primitive id')
      ids.add(id)
      if (ids.size > MODEL_MAXIMUM_PRIMITIVES)
        throw new RangeError('model source exceeds primitive budget')
    }
  const primitives: ModelPrimitive[] = []
  let bytes = 0
  if (source.primitive !== undefined)
    for (const id of ids) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const primitive = await source.primitive(
        id,
        { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES - bytes },
        signal,
      )
      if (primitive.id !== id) throw new TypeError('model source returned a different primitive')
      bytes += modelPrimitiveByteLength(primitive)
      if (bytes > MODEL_MAXIMUM_PRIMITIVE_BYTES)
        throw new RangeError('model geometry exceeds byte budget')
      primitives.push(primitive)
    }
  return {
    info,
    nodes,
    meshes,
    primitives: Object.freeze(primitives),
    primitiveIds: Object.freeze([...ids]),
    ...(primitives[0] === undefined ? {} : { primitive: primitives[0] }),
  }
}

export interface ModelLodPrimitives {
  readonly id: string
  readonly order: number
  readonly primitiveIds: ReadonlySet<string>
}

/**
 * Each level of detail as the primitives it draws, most detailed first: the meshes of the level's
 * nodes and of their descendants. A level that reaches no geometry is left out.
 */
export function modelLodPrimitives(
  levels: readonly ModelLodLevelRef[],
  model: Pick<ModelStageModel, 'nodes' | 'meshes'>,
): readonly ModelLodPrimitives[] {
  const nodes = new Map(model.nodes.map(node => [node.id, node]))
  const meshes = new Map(model.meshes.map(mesh => [mesh.id, mesh]))
  return [...levels]
    .sort((a, b) => a.order - b.order)
    .map(level => {
      const primitiveIds = new Set<string>()
      const seen = new Set<string>()
      const pending = [...level.nodeIds]
      for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        const node = seen.has(id) ? undefined : nodes.get(id)
        seen.add(id)
        if (node === undefined) continue
        for (const meshId of node.meshIds)
          for (const primitiveId of meshes.get(meshId)?.primitiveIds ?? [])
            primitiveIds.add(primitiveId)
        pending.push(...node.childIds)
      }
      return { id: level.id, order: level.order, primitiveIds }
    })
    .filter(level => level.primitiveIds.size > 0)
}
