/**
 * One converted model as the world viewer draws it: the asset's facets read to their caps, its
 * primitives within the byte budget, a node graph that names only what is present, and its
 * textures decoded through the asset's raster port. The host's map world (`world-source.ts`) and a
 * codec that publishes its own world scene (a Diablo III scene) convert models with this, so the
 * two never differ.
 */
import { diagnostic, type Diagnostic } from '@modkit/core'
import type {
  LogicalResourceRequirement,
  ModelMaterialRef,
  ModelResourceAsset,
  RasterResourceResult,
  SceneRendererTexture,
  WorldSceneModelRequest,
  WorldSceneModelResult,
} from '@modkit/sdk'

export function positiveLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`world page limit must be between 1 and ${maximum}`)
  }
  return value
}

export function childResourceLogicalId(parentLogicalId: string, childLogicalId: string): string {
  const childRoot = childLogicalId.split('/')[0]
  if (childRoot === undefined || childRoot.length === 0) return childLogicalId
  const parent = parentLogicalId.split('/')
  const sharedRoot = parent.findIndex(segment => segment.toLowerCase() === childRoot.toLowerCase())
  if (sharedRoot <= 0) return childLogicalId
  return [...parent.slice(0, sharedRoot), childLogicalId].join('/')
}

export function worldTexture(
  id: string,
  result: Extract<RasterResourceResult, { readonly state: 'decoded' | 'compressed' }>,
): SceneRendererTexture | undefined {
  if (result.info.orientation === 'unknown') return undefined
  if (result.state === 'compressed') {
    // Blocks are not turned over row by row: only a top-left image arrives as its blocks.
    if (result.info.orientation !== 'top-left') return undefined
    return Object.freeze({
      id,
      width: result.texture.dimensions.width,
      height: result.texture.dimensions.height,
      rgba: new Uint8Array(0),
      compressed: result.texture,
      ...(result.info.channelLayout === undefined
        ? {}
        : { channelLayout: result.info.channelLayout }),
      ...(result.info.compression === undefined ? {} : { compression: result.info.compression }),
      wrapU: 'repeat',
      wrapV: 'repeat',
    })
  }
  const { region } = result
  const rowBytes = region.width * 4
  const rgba = new Uint8Array(rowBytes * region.height)
  for (let y = 0; y < region.height; y += 1) {
    const sourceY = result.info.orientation === 'bottom-left' ? region.height - 1 - y : y
    rgba.set(
      region.pixels.subarray(sourceY * region.rowStride, sourceY * region.rowStride + rowBytes),
      y * rowBytes,
    )
  }
  return Object.freeze({
    id,
    width: region.width,
    height: region.height,
    rgba,
    ...(result.info.channelLayout === undefined
      ? {}
      : { channelLayout: result.info.channelLayout }),
    ...(result.info.compression === undefined ? {} : { compression: result.info.compression }),
    wrapU: 'repeat',
    wrapV: 'repeat',
  })
}

/** Bytes a world texture holds: its stored blocks, or its RGBA8 texels. */
export function worldTextureBytes(texture: SceneRendererTexture): number {
  if (texture.compressed === undefined) return texture.rgba.byteLength
  let bytes = 0
  for (const level of texture.compressed.subresources) bytes += level.data.byteLength
  return bytes
}

/**
 * Every page of a model facet, up to `cap` items: a large model (a Roblox place tree of 2 280
 * parts) is not cut at the first page. `complete` is false when the cap stopped it.
 */
export async function readAllPages<Item>(
  read: (page: { limit: number; cursor?: string }) => Promise<{
    readonly items: readonly Item[]
    readonly nextCursor?: string
  }>,
  pageLimit: number,
  cap: number,
): Promise<{ readonly items: readonly Item[]; readonly complete: boolean }> {
  const items: Item[] = []
  let cursor: string | undefined
  do {
    const page = await read({
      limit: Math.min(pageLimit, cap - items.length),
      ...(cursor === undefined ? {} : { cursor }),
    })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined && items.length < cap)
  return { items, complete: cursor === undefined }
}

/** Most items one model facet may publish to the world viewer (nodes, clips, materials, ...). */
export const MODEL_FACET_ITEM_CAP = 65_536

/** Bytes of the typed arrays a primitive carries (positions, indices, attributes). */
function primitiveByteLength(primitive: unknown): number {
  let total = 0
  const visit = (value: unknown, depth: number) => {
    if (ArrayBuffer.isView(value)) total += value.byteLength
    else if (depth < 3 && typeof value === 'object' && value !== null)
      for (const child of Object.values(value)) visit(child, depth + 1)
  }
  visit(primitive, 0)
  return total
}

/**
 * A node graph that names only what is present: when a model was cut, a child or mesh the cut left
 * out is dropped from its parent, so one large model cannot make the scene sampler refuse the
 * whole world ("scene child is absent"). Returns whether anything was dropped.
 */
function consistentNodes<
  Node extends Readonly<{ id: string; childIds: readonly string[]; meshIds?: readonly string[] }>,
>(
  nodes: readonly Node[],
  meshIds: ReadonlySet<string>,
): { nodes: readonly Node[]; pruned: boolean } {
  const present = new Set(nodes.map(node => node.id))
  let pruned = false
  const out = nodes.map(node => {
    const childIds = node.childIds.filter(id => present.has(id))
    const meshes = node.meshIds?.filter(id => meshIds.has(id))
    if (childIds.length === node.childIds.length && meshes?.length === node.meshIds?.length)
      return node
    pruned = true
    return Object.freeze({
      ...node,
      childIds,
      ...(meshes === undefined ? {} : { meshIds: meshes }),
    })
  })
  return { nodes: out, pruned }
}

function yawRootNodes<
  Node extends Readonly<{ id: string; childIds: readonly string[]; transform: readonly number[] }>,
>(nodes: readonly Node[], yaw: number): readonly Node[] {
  if (yaw === 0) return [...nodes]
  const children = new Set(nodes.flatMap(node => node.childIds))
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // Column-major rotation about +Y: rows [[c,0,s],[0,1,0],[-s,0,c]].
  const rotate = (m: readonly number[]) => {
    const out = [...m]
    for (let column = 0; column < 4; column += 1) {
      const x = m[column * 4]!
      const z = m[column * 4 + 2]!
      out[column * 4] = c * x + s * z
      out[column * 4 + 2] = -s * x + c * z
    }
    return Object.freeze(out)
  }
  return nodes.map(node =>
    children.has(node.id) ? node : Object.freeze({ ...node, transform: rotate(node.transform) }),
  )
}

/** A decoded model texture, or why there is none; shared across the models of one world. */
export type WorldModelTexture = Readonly<{
  texture?: SceneRendererTexture
  diagnostics: readonly Diagnostic[]
}>

export interface WorldSceneModelOptions {
  /** What the asset was acquired for: its logical id names the textures' folder, its scopes find them. */
  readonly requirement: LogicalResourceRequirement
  /** Radians about +Y applied to the root nodes (a cliff piece's baked yaw). */
  readonly yaw?: number
  /**
   * Materials that replace the asset's own by index (a separately authored skin). When it returns
   * materials, the asset's own texture references are no dependencies of what is drawn.
   */
  readonly skin?: (
    materials: readonly ModelMaterialRef[],
  ) => Promise<
    Readonly<{ materials?: readonly ModelMaterialRef[]; diagnostics: readonly Diagnostic[] }>
  >
  /** Decoded textures by logical id and budget, kept across calls (one map per world lease). */
  readonly textureCache?: Map<string, Promise<WorldModelTexture>>
  /** The largest page the caller admits for the request's page limits. */
  readonly maxPageSize?: number
}

/** The request's page limits and budgets, checked; call before acquiring the asset. */
export function worldSceneModelLimits(request: WorldSceneModelRequest, maxPageSize: number) {
  const maxNodes = request.maxNodes ?? request.maxMeshes
  const maxResources = request.maxResources ?? maxNodes
  const maxTextureBytes = request.maxTextureBytes ?? Math.min(16 * 1024 * 1024, request.maxBytes)
  const maxTextureTotalBytes =
    request.maxTextureTotalBytes ?? Math.min(32 * 1024 * 1024, request.maxBytes)
  positiveLimit(maxNodes, maxPageSize)
  positiveLimit(request.maxMeshes, maxPageSize)
  positiveLimit(request.maxPrimitives, maxPageSize)
  positiveLimit(request.maxPrimitiveBytes, request.maxBytes)
  positiveLimit(maxResources, maxPageSize)
  positiveLimit(maxTextureBytes, request.maxBytes)
  positiveLimit(maxTextureTotalBytes, request.maxBytes)
  return Object.freeze({ maxNodes, maxResources, maxTextureBytes, maxTextureTotalBytes })
}

/**
 * One acquired model asset converted for the world viewer. The caller acquires the asset (through
 * `ContributionContext.modelResources` or the host's model port) and releases it afterwards.
 */
export async function worldSceneModel(
  asset: ModelResourceAsset,
  request: WorldSceneModelRequest,
  options: WorldSceneModelOptions,
  signal?: AbortSignal,
): Promise<WorldSceneModelResult> {
  const { maxNodes, maxResources, maxTextureBytes, maxTextureTotalBytes } = worldSceneModelLimits(
    request,
    options.maxPageSize ?? Number.MAX_SAFE_INTEGER,
  )
  const modelRequirement = options.requirement
  const textureCache = options.textureCache ?? new Map<string, Promise<WorldModelTexture>>()
  const result = asset.result
  if (result.state === 'unresolved') {
    return Object.freeze({
      ...result,
      diagnostics: Object.freeze([...result.diagnostics]),
    })
  }
  if (asset.meshes === undefined) {
    return Object.freeze({
      state: 'converted' as const,
      sourceKey: result.sourceKey,
      uvmBytes: result.bytes.slice(),
      meshes: Object.freeze([]),
      primitives: Object.freeze([]),
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          'information',
          'x3.host/world-model-render-facets-unavailable',
          `model ${modelRequirement.logicalId} converted successfully but publishes no common geometry; optional effects, lights or decals require their own admitted world facets`,
        ),
      ]),
      complete: false,
    })
  }
  // Request limits are page sizes; every page is read up to the facet cap.
  const facet = <Item>(
    read:
      | ((
          page: { limit: number; cursor?: string },
          signal?: AbortSignal,
        ) => Promise<{ readonly items: readonly Item[]; readonly nextCursor?: string }>)
      | undefined,
    pageLimit: number,
  ) =>
    read === undefined
      ? undefined
      : readAllPages(page => read(page, signal), pageLimit, MODEL_FACET_ITEM_CAP)
  const meshPage = (await facet(asset.meshes.bind(asset), request.maxMeshes))!
  const [nodePage, skeletonPage, animationPage, materialPage, resourcePage, socketPage] =
    await Promise.all([
      facet(asset.nodes?.bind(asset), maxNodes),
      facet(asset.skeletonBindings?.bind(asset), maxNodes),
      facet(asset.animationClips?.bind(asset), maxNodes),
      facet(asset.materials?.bind(asset), maxNodes),
      facet(asset.resourceReferences?.bind(asset), maxResources),
      facet(asset.sockets?.bind(asset), maxNodes),
    ])
  // A separately authored skin replaces the materials by index; the mesh's own texture
  // references are then not dependencies of what is drawn.
  let materials = materialPage?.items
  let resourceItems = resourcePage?.items ?? []
  const skinDiagnostics: Diagnostic[] = []
  if (options.skin !== undefined && materials !== undefined) {
    const skinned = await options.skin(materials)
    skinDiagnostics.push(...skinned.diagnostics)
    if (skinned.materials !== undefined) {
      materials = skinned.materials
      resourceItems = []
    }
  }
  const allPrimitiveIds = meshPage.items.flatMap(mesh => mesh.primitiveIds)
  if (allPrimitiveIds.length > 0 && asset.primitive === undefined)
    throw new TypeError('model publishes primitive ids without a primitive reader')
  // Primitives are read in batches until the model's byte budget is spent (each one also
  // bounded by maxPrimitiveBytes); maxPrimitives is the batch size, not a total.
  const primitives: Awaited<ReturnType<NonNullable<typeof asset.primitive>>>[] = []
  let primitiveBytes = 0
  for (
    let start = 0;
    start < allPrimitiveIds.length && primitiveBytes < request.maxBytes;
    start += request.maxPrimitives
  ) {
    const batch = await Promise.all(
      allPrimitiveIds
        .slice(start, start + request.maxPrimitives)
        .map(primitiveId =>
          asset.primitive!(primitiveId, { maxBytes: request.maxPrimitiveBytes }, signal),
        ),
    )
    for (const primitive of batch) {
      const bytes = primitiveByteLength(primitive)
      if (primitiveBytes + bytes > request.maxBytes) break
      primitiveBytes += bytes
      primitives.push(primitive)
    }
    if (primitives.length < Math.min(start + request.maxPrimitives, allPrimitiveIds.length)) break
  }
  // A mesh is drawn only with all its primitives; a node names only what is present.
  const loadedPrimitives = new Set(primitives.map(primitive => primitive.id))
  const meshes = meshPage.items.filter(mesh =>
    mesh.primitiveIds.every(id => loadedPrimitives.has(id)),
  )
  const graph =
    nodePage === undefined
      ? undefined
      : consistentNodes(nodePage.items, new Set(meshes.map(mesh => mesh.id)))
  const textureDiagnostics: Diagnostic[] = []
  const textures: SceneRendererTexture[] = []
  const publishedResources = [...resourceItems]
  const resourceIds = new Set(publishedResources.map(reference => reference.id))
  // Material layers are authoritative render dependencies even when an intermediate
  // UVM/resource-refs facet omitted the redundant reference list. Acquire their
  // logical textures and publish the derived reference instead of silently falling
  // back to hashed material colours.
  for (const material of materials ?? []) {
    for (const layer of material.layers ?? []) {
      if (layer.resourceId === undefined || resourceIds.has(layer.resourceId)) continue
      resourceIds.add(layer.resourceId)
      publishedResources.push(
        Object.freeze({
          id: layer.resourceId,
          role: 'texture' as const,
          provenance: 'reference-only' as const,
        }),
      )
    }
  }
  const textureReferences = publishedResources.filter(reference => reference.role === 'texture')
  const sharedTextureBytes = Math.max(
    1,
    Math.floor(maxTextureTotalBytes / Math.max(1, textureReferences.length)),
  )
  let textureBytes = 0
  for (const reference of textureReferences) {
    const remaining = maxTextureTotalBytes - textureBytes
    if (remaining <= 0) {
      textureDiagnostics.push(
        diagnostic(
          'warning',
          'x3.host/world-model-texture-budget-exhausted',
          `model texture budget omitted ${reference.id}`,
        ),
      )
      continue
    }
    const logicalId = childResourceLogicalId(modelRequirement.logicalId, reference.id)
    const previewTextureBytes = Math.max(
      1,
      Math.min(maxTextureBytes, remaining, sharedTextureBytes),
    )
    const compressedFormats = request.compressedTextureFormats
    const cacheKey = `${logicalId}\u0000${String(previewTextureBytes)}\u0000${compressedFormats?.join(',') ?? ''}`
    let pending = textureCache.get(cacheKey)
    if (pending === undefined) {
      pending = (async () => {
        const raster = await asset.readRaster(
          {
            kind: 'logical',
            requirement: {
              id: `world-texture:${encodeURIComponent(logicalId)}`,
              logicalId,
              role: reference.role,
              scopes: modelRequirement.scopes,
              parentResourceId: modelRequirement.id,
            },
            maxBytes: previewTextureBytes,
            selection: { mipLevel: 'fit' },
            ...(compressedFormats === undefined ? {} : { compressedFormats }),
          },
          signal,
        )
        if (raster.state !== 'decoded' && raster.state !== 'compressed')
          return Object.freeze({
            diagnostics: Object.freeze([...raster.diagnostics]),
          })
        const texture = worldTexture(reference.id, raster)
        const mipLevel = raster.subresource?.mipLevel ?? 0
        return Object.freeze({
          ...(texture === undefined ? {} : { texture }),
          diagnostics: Object.freeze([
            ...raster.diagnostics,
            ...(mipLevel === 0
              ? []
              : [
                  diagnostic(
                    'information',
                    'x3.host/world-model-texture-preview-mip-selected',
                    `model texture ${reference.id} uses preview mip ${String(mipLevel)} to stay within its decoded byte budget`,
                  ),
                ]),
            ...(texture === undefined
              ? [
                  diagnostic(
                    'warning',
                    'x3.host/world-model-texture-orientation-unknown',
                    `model texture ${reference.id} has no proven top/bottom row orientation`,
                  ),
                ]
              : []),
          ]),
        })
      })()
      textureCache.set(cacheKey, pending)
    }
    const loaded = await pending
    textureDiagnostics.push(...loaded.diagnostics)
    const texture = loaded.texture
    if (texture === undefined) continue
    const bytes = worldTextureBytes(texture)
    if (bytes > remaining) {
      textureDiagnostics.push(
        diagnostic(
          'warning',
          'x3.host/world-model-texture-budget-exhausted',
          `decoded model texture ${reference.id} exceeds the aggregate texture budget`,
        ),
      )
      continue
    }
    textureBytes += bytes
    textures.push(texture)
  }
  return Object.freeze({
    state: 'converted' as const,
    sourceKey: result.sourceKey,
    uvmBytes: result.bytes.slice(),
    ...(graph === undefined
      ? {}
      : { nodes: Object.freeze(yawRootNodes(graph.nodes, options.yaw ?? 0)) }),
    ...(skeletonPage === undefined ? {} : { skeleton: Object.freeze([...skeletonPage.items]) }),
    ...(animationPage === undefined ? {} : { animations: Object.freeze([...animationPage.items]) }),
    ...(materials === undefined ? {} : { materials: Object.freeze([...materials]) }),
    ...(publishedResources.length === 0 ? {} : { resources: Object.freeze(publishedResources) }),
    ...(socketPage === undefined ? {} : { sockets: Object.freeze([...socketPage.items]) }),
    ...(publishedResources.length === 0 ? {} : { textures: Object.freeze(textures) }),
    meshes: Object.freeze(meshes),
    primitives: Object.freeze(primitives),
    diagnostics: Object.freeze([
      ...result.diagnostics,
      ...skinDiagnostics,
      ...textureDiagnostics,
      ...(graph?.pruned === true
        ? [
            diagnostic(
              'warning',
              'x3.host/world-model-graph-truncated',
              `model ${modelRequirement.logicalId} was cut (${MODEL_FACET_ITEM_CAP} items per facet, ${request.maxBytes} primitive bytes); nodes and meshes left out are dropped from their parents`,
            ),
          ]
        : []),
    ]),
    complete:
      meshPage.complete &&
      nodePage?.complete !== false &&
      skeletonPage?.complete !== false &&
      animationPage?.complete !== false &&
      materialPage?.complete !== false &&
      resourcePage?.complete !== false &&
      socketPage?.complete !== false &&
      textureReferences.length === textures.length &&
      primitives.length === allPrimitiveIds.length,
  })
}
