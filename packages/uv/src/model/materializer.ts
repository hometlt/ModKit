import type {
  ModelSceneInfo,
  ModelNode,
  ModelMesh,
  ModelPrimitive,
  ModelSocketRef,
  MaterializationRequest,
  MaterializationDiffEntry,
} from '@modkit/sdk'
export interface ModelProjection {
  readonly info: ModelSceneInfo
  readonly nodes?: readonly ModelNode[]
  readonly meshes?: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
  readonly sockets?: readonly ModelSocketRef[]
  readonly excludedFacetIds?: readonly string[]
  readonly resourceClosure?: {
    readonly mode: 'logical' | 'content-qualified'
    readonly entries?: readonly {
      readonly role: string
      readonly logicalId: string
      readonly mediaHint?: string
    }[]
    readonly unavailable?: readonly { readonly logicalId: string }[]
  }
}
export interface MaterializationOptions {
  readonly digest?: (bytes: Uint8Array) => string
}
export interface BufferView {
  buffer: number
  byteOffset: number
  byteLength: number
}
interface PrimitiveEntry {
  attributes: { POSITION?: number; NORMAL?: number; TEXCOORD_0?: number }
  indices: number
  material?: string
}
export interface DocumentPrimitive {
  attributes: PrimitiveEntry['attributes']
  indices: number
  material?: number | undefined
}
export interface DocumentNode {
  name?: string
  children?: number[]
  mesh?: number | undefined
  matrix?: number[]
  extensions?: object
}
/**
 * The common UVM/core materializer (block 11, slice 11C1, plan items 14 and 16).
 *
 * It turns a **drained faceted model projection** into UVM/core 1.0 bytes, and it is deliberately
 * the only thing in the tree that does so. Native model codecs and their live projectors do not
 * import this module — `packages/testkit/test/uv-materializer-boundary.test.ts` proves it rather
 * than trusting the convention — because a codec that could also write UVM would be two owners of
 * one format wearing one name.
 *
 * **What it will not do.** It never invents data. Texture identity is written only when the live
 * projection carries the scope's resolved resource closure; a bare count still produces no empty
 * texture objects. Animation channels remain outside UVM/core unless a future admitted scope says
 * how to carry them.
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
 * Dependency-free by design: no crypto, no Node built-ins, browser-safe. The digest of the produced
 * bytes is optional evidence supplied by the caller, exactly as `ProjectionReceipt` treats digests.
 */

const MATERIALIZER_ID = 'modkit/uvm-materializer'
const MATERIALIZER_VERSION = '1.0.0'
const PROFILE = 'UVM/core@1.0'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

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
  declare chunks: Uint8Array[]
  declare length: number
  declare views: BufferView[]
  constructor() {
    this.chunks = []
    this.length = 0
    this.views = []
  }

  /** Appends one 4-byte-aligned view and returns its bufferView index. */
  push(typed: Float32Array | Uint32Array) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const offset = this.length
    this.chunks.push(bytes)
    this.length += bytes.byteLength
    const padding = (4 - (this.length % 4)) % 4
    if (padding > 0) {
      this.chunks.push(new Uint8Array(padding))
      this.length += padding
    }
    this.views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength })
    return this.views.length - 1
  }

  build() {
    const result = new Uint8Array(this.length)
    let cursor = 0
    for (const chunk of this.chunks) {
      result.set(chunk, cursor)
      cursor += chunk.byteLength
    }
    return result
  }
}

function boundsOf(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis] as number
      if (value < (min[axis] as number)) min[axis] = value
      if (value > (max[axis] as number)) max[axis] = value
    }
  }
  return { min, max }
}

// ---------------------------------------------------------------------------------------------
// GLB packing — the rule pinned by `conformance/uvm-core/vectors.json`

function le32(value: number) {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function pad4(bytes: Uint8Array, fill: number) {
  const result = new Uint8Array((bytes.byteLength + 3) & ~3)
  result.fill(fill)
  result.set(bytes)
  return result
}

function concat(parts: readonly Uint8Array[]) {
  const total = parts.reduce((size, part) => size + part.byteLength, 0)
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

/** Deterministic `.uvm.glb` bytes for a GLB-shaped document plus its BIN payload. */
export function packUvmGlb(document: object, binary: Uint8Array) {
  const json = pad4(encoder.encode(JSON.stringify(document)), 0x20)
  const bin = pad4(binary, 0x00)
  const length = 12 + 8 + json.byteLength + 8 + bin.byteLength
  return concat([
    le32(GLB_MAGIC),
    le32(2),
    le32(length),
    le32(json.byteLength),
    le32(JSON_CHUNK),
    json,
    le32(bin.byteLength),
    le32(BIN_CHUNK),
    bin,
  ])
}

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
export function materializeUvmCore(
  projection: ModelProjection,
  request: MaterializationRequest,
  { digest }: MaterializationOptions = {},
) {
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
  const accessors = []
  const emittedMeshes = []
  const materialIds = new Set<string>()
  let emittedPrimitives = 0

  const primitiveById = new Map((primitives ?? []).map(item => [item.id, item]))

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
      attributes.POSITION = accessors.length
      const positionBounds = boundsOf(positions)
      accessors.push({
        bufferView: buffers.push(positions),
        componentType: FLOAT,
        count: vertexCount,
        type: 'VEC3',
        min: positionBounds.min,
        max: positionBounds.max,
      })
      if (primitive.normals !== undefined && primitive.normals !== null) {
        const normals = Float32Array.from(
          finite(primitive.normals, `primitive ${primitive.id} normals`),
        )
        attributes.NORMAL = accessors.length
        accessors.push({
          bufferView: buffers.push(normals),
          componentType: FLOAT,
          count: normals.length / 3,
          type: 'VEC3',
        })
      }
      if (primitive.textureCoordinates !== undefined && primitive.textureCoordinates !== null) {
        const uv = Float32Array.from(
          finite(primitive.textureCoordinates, `primitive ${primitive.id} texture coordinates`),
        )
        attributes.TEXCOORD_0 = accessors.length
        accessors.push({
          bufferView: buffers.push(uv),
          componentType: FLOAT,
          count: uv.length / 2,
          type: 'VEC2',
        })
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
      if (typeof primitive.materialId === 'string') {
        materialIds.add(primitive.materialId)
        entry.material = primitive.materialId
      }
      meshPrimitives.push(entry)
      emittedPrimitives += 1
    }
    emittedMeshes.push({ mesh, primitives: meshPrimitives })
  }

  // --- materials -----------------------------------------------------------------------------
  /*
   * The base contract publishes a material *count* and a material id per primitive, and nothing
   * else — no name, no parameters. So the document carries exactly as many neutral materials as
   * the projection counted, which reproduces the count without claiming to know what they looked
   * like. The optional `common.view/model-material-source@1` facet is what will carry the rest,
   * once a publisher exists for it.
   */
  const referenced = [...materialIds]
  const materialIndexById = new Map<string, number>()
  const materialCount = Math.max(Number(info.materials ?? 0), referenced.length)
  const positionalMaterials = referenced.every(id => {
    const match = /^material-(\d+)$/u.exec(id)
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
  }
  const materials = Array.from({ length: materialCount }, () => ({
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
  }))
  // --- planes this profile cannot carry from the base contract alone --------------------------
  const closure = projection.resourceClosure
  const resourceImages = []
  if (closure !== undefined && closure !== null) {
    if (closure.mode !== 'logical' && closure.mode !== 'content-qualified') {
      fail('resourceClosure.mode must be logical or content-qualified')
    }
    for (const entry of closure.entries ?? []) {
      if (entry?.role !== 'image') continue
      if (typeof entry.logicalId !== 'string' || entry.logicalId === '') {
        fail('every image resource-closure entry needs a non-empty logicalId')
      }
      resourceImages.push({
        uri: entry.logicalId,
        ...(typeof entry.mediaHint === 'string' ? { mimeType: entry.mediaHint } : {}),
      })
    }
    const uncarried = (closure.entries ?? []).filter(entry => entry?.role !== 'image')
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
  if (closure !== undefined && resourceImages.length !== Number(info.textures ?? 0)) {
    note(
      'uv.model/structure@1',
      'value-differs',
      '/textures',
      `the resource closure carries ${resourceImages.length} image identity or identities, while the base model contract counts ${Number(info.textures ?? 0)} texture(s)`,
    )
  }
  if (Number(info.animations ?? 0) > 0) {
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
  const rootIndices = orderedNodes
    .filter(node => childless.has(node.id))
    .map(node => nodeIndexById.get(node.id))

  const socketByNodeId = new Map()
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
    const index = roleOrdinals.get(socket.role) ?? 0
    roleOrdinals.set(socket.role, index + 1)
    socketByNodeId.set(socket.nodeId, {
      role: socket.role,
      index,
      ...(typeof socket.sourceName === 'string' ? { sourceName: socket.sourceName } : {}),
      ...(socket.orientation === undefined
        ? {}
        : { forward: socket.orientation.forward, up: socket.orientation.up }),
      // UV_game_socket's open `extras` is the standards-defined place for publisher identity.
      // The node supplies transform semantics; these two strings make the independent facet's
      // stable id and target join round-trip without a source-format branch in the reader.
      extras: { modkit: { id: socket.id, nodeId: socket.nodeId } },
    })
  }

  const documentNodes = orderedNodes.map(node => {
    const entry: DocumentNode = {}
    if (typeof node.name === 'string') entry.name = node.name
    const children = (node.childIds ?? [])
      .map(child => nodeIndexById.get(child))
      .filter(index => index !== undefined)
    if (children.length > 0) entry.children = children
    const meshId = (node.meshIds ?? [])[0]
    if (meshId !== undefined && meshIndexById.has(meshId)) entry.mesh = meshIndexById.get(meshId)
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
    if (transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0))) {
      entry.matrix = transform
    }
    const socket = socketByNodeId.get(node.id)
    if (socket !== undefined) entry.extensions = { UV_game_socket: socket }
    return entry
  })

  const documentMeshes = emittedMeshes.map(({ mesh, primitives: entries }) => {
    const value: { name?: string; primitives?: DocumentPrimitive[] } = {}
    if (typeof mesh.name === 'string') value.name = mesh.name
    value.primitives = entries.map(entry => {
      const primitive: DocumentPrimitive = { attributes: entry.attributes, indices: entry.indices }
      if (entry.material !== undefined) primitive.material = materialIndexById.get(entry.material)
      return primitive
    })
    return value
  })

  const binary = buffers.build()
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
    ],
    extensions: {
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
    meshes: documentMeshes,
    materials,
    ...(resourceImages.length === 0
      ? {}
      : {
          images: resourceImages,
          textures: resourceImages.map((_image, index) => ({ source: index })),
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
  return { bytes, document, binary, receipt }
}

export const MATERIALIZER_COORDINATE = Object.freeze({
  id: MATERIALIZER_ID,
  version: MATERIALIZER_VERSION,
  profile: PROFILE,
})
