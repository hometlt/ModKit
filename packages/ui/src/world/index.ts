/** Bounded, game-neutral inspection harness for publisher-qualified world candidates. */

import { diagnostic, type Diagnostic } from '@modkit/core'
import { createModelSceneSampler } from '@modkit/scene/model'
import {
  createWorldWebGlRenderer,
  DEFAULT_WORLD_WEBGL_CAMERA,
  drawWorldWebGl,
  presentWorldModelTextures,
  orbitWorldWebGlCamera,
  panWorldWebGlCamera,
  pickWorldWebGl,
  SCENE_COMPRESSED_TEXTURE_FORMATS,
  WORLD_MAX_TERRAIN_WEIGHT_RASTERS,
  worldObjectModelResources,
  worldViewGroundWindow,
  zoomWorldWebGlCamera,
  type WorldWebGlCamera,
  type WorldWebGlFrame,
  type WorldWebGlInput,
  type WorldWebGlRenderer,
} from '@modkit/scene/world'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneItem,
  WorldSceneLayerItem,
  WorldSceneModelResult,
  WorldSceneObjectItem,
  WorldScenePage,
  WorldSceneResourceItem,
  WorldSceneSource,
  WorldSceneTerrainItem,
} from '@modkit/sdk/maps'
import type {
  AnyDescriptor,
  CommitCoordinator,
  EditAuthorizationPort,
  OperationSession,
  SceneRendererPrimitive,
  SceneRendererTexture,
  TransportSource,
} from '@modkit/sdk'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkit/sdk/maps'
import type { ViewerModule } from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  invokeOperation,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { WORLD_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import { createMediaShell } from '../media-shell/index.js'
import type { ImageSidebarSection } from '../image/index.js'
import {
  WORLD_OBJECT_KIND_COLORS,
  createWorldLatticePlan,
  drawWorldLattice,
  worldLatticeObjectAt,
  type WorldLatticePlan,
} from './lattice.js'
export {
  WORLD_OBJECT_KIND_COLORS,
  createWorldLatticePlan,
  drawWorldLattice,
  worldLatticeColor,
  worldLatticeObjectAt,
} from './lattice.js'

export const WORLD_VIEWER_MAX_LAYERS = 16
export const WORLD_VIEWER_MAX_ITEMS_PER_LAYER = 100_000
export const WORLD_VIEWER_MAX_PAGE_ITEMS = 1_024
/** Resources one preview may admit; a real map names a few hundred (Amphion 527). */
export const WORLD_VIEWER_MAX_MODELS = 4096
/**
 * What the models may hold before the rest load with the smallest textures. No model is left out
 * for bytes: past this only textures shrink.
 *
 * Amphion's 527 models hold 227.5 MiB in one process and 627 MiB across VS Code's JSON webview
 * channel, where a texture several models share arrives once for each of them.
 */
export const WORLD_VIEWER_MAX_MODEL_BYTES = 1024 * 1024 * 1024
/**
 * What a model is first asked for. Each conversion holds this much of the session's byte budget
 * (64 MiB in VS Code) while it runs, so a small ask keeps the acquisitions running in parallel.
 */
export const WORLD_VIEWER_MODEL_REQUEST_BYTES = 4 * 1024 * 1024
/**
 * The most a model that needs more is asked for again. Its UVM and its primitives come back in one
 * capability-RPC frame of at most 64 MiB, so both must fit. DefendersCity_Biker_Bar takes 4.07 MiB.
 */
export const WORLD_VIEWER_MAX_BYTES_PER_MODEL = 24 * 1024 * 1024
/** All textures of one model, each at the largest mip that fits. */
export const WORLD_VIEWER_TEXTURE_BYTES_PER_MODEL = 2 * 1024 * 1024
/** One model's textures once `maxModelBytes` is spent. */
export const WORLD_VIEWER_SPENT_TEXTURE_BYTES_PER_MODEL = 256 * 1024
export const WORLD_VIEWER_MAX_CONCURRENT_MODEL_ACQUISITIONS = 4
/**
 * A bound on terrain texture requests, not on their bytes: those share `maxModelBytes` out, one ask
 * per texture. Westwood's theater tiles are one texture per subtile — 911 small diamonds on a TS map.
 */
export const WORLD_VIEWER_MAX_TERRAIN_TEXTURES = 4096

export interface CandidateWorldViewerOptions {
  readonly maxLayers: number
  /** Total retained item budget for each layer across all pages. */
  readonly maxItemsPerLayer: number
  /** One source call size; defaults to the total for backwards-compatible bounded callers. */
  readonly maxPageItems?: number
  readonly maxModels?: number
  readonly maxModelBytes?: number
  readonly maxConcurrentModelAcquisitions?: number
  /**
   * Which model resources to acquire, by resource id. Everything else is reported unresolved
   * without being opened — a viewer showing only the terrain and its cliffs need not pay for the
   * map's doodad and unit models.
   */
  readonly modelResourceFilter?: (resourceId: string) => boolean
  readonly signal?: AbortSignal
  readonly previous?: CandidateWorldViewerModel
  /** Immutable bounded snapshots; geometry is published before any texture/model request. */
  readonly onProgress?: (model: CandidateWorldViewerModel, progress: WorldLoadProgress) => void
}

export interface WorldLoadProgress {
  readonly phase: 'geometry' | 'textures' | 'cliffs' | 'objects' | 'complete'
  readonly completed: number
  readonly total: number
}

export interface CandidateWorldViewerLayer {
  readonly layer: WorldSceneLayerItem
  readonly page: WorldScenePage
}

export interface CandidateWorldViewerModel {
  readonly contract: string
  readonly major: 1
  readonly snapshotId: string
  readonly info: CandidateWorldSceneInfo
  readonly layers: readonly CandidateWorldViewerLayer[]
  readonly nextLayerCursor?: string
  readonly reusedLayerKinds?: readonly string[]
  readonly models?: ReadonlyMap<string, WorldSceneModelResult>
  readonly terrainTextures?: ReadonlyMap<string, SceneRendererTexture>
  readonly terrainTextureDiagnostics?: readonly Diagnostic[]
  readonly modelRequestKey?: string
  /** Admission/request limits, not a measurement or hard cap of renderer CPU/GPU memory. */
  readonly modelBudget?: Readonly<{
    maxModels: number
    maxModelBytes: number
    bytesPerModel: number
    textureBytesPerModel: number
  }>
  readonly loadPerformance: CandidateWorldViewerLoadPerformance
}

/** Count the advertised resources, including ones absent from the results map. */
export function worldModelAssetStatus(
  model: Pick<CandidateWorldViewerModel, 'layers' | 'models'>,
): {
  total: number
  converted: number
  partial: boolean
} {
  const ids = new Set(
    model.layers.flatMap(({ page }) =>
      page.items.flatMap(item =>
        item.facet === 'resources' && item.modelResource !== undefined ? [item.id] : [],
      ),
    ),
  )
  let converted = 0
  let partial = false
  for (const id of ids) {
    const result = model.models?.get(id)
    if (result?.state === 'converted') {
      converted++
      if (!result.complete) partial = true
    } else partial = true
  }
  return { total: ids.size, converted, partial }
}

/** Wall-clock phase receipt for one bounded candidate inspection. */
export interface CandidateWorldViewerLoadPerformance {
  readonly coldStart: boolean
  readonly infoMilliseconds: number
  readonly layerCatalogMilliseconds: number
  readonly layerAcquisitionMilliseconds: number
  readonly modelAcquisitionMilliseconds: number
  readonly terrainTextureAcquisitionMilliseconds: number
  readonly totalMilliseconds: number
  readonly layerPageRequests: number
  readonly reusedLayers: number
  readonly modelRequests: number
  readonly reusedModels: number
  readonly terrainTextureRequests: number
  readonly reusedTerrainTextures: number
}

const inspectionClock = (): number => globalThis.performance?.now() ?? Date.now()
const elapsedInspectionMilliseconds = (startedAt: number): number =>
  Math.max(0, inspectionClock() - startedAt)

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

async function forEachConcurrent<Value>(
  values: readonly Value[],
  concurrency: number,
  worker: (value: Value) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const value = values[next++]!
        await worker(value)
      }
    }),
  )
}

/**
 * Reads bounded pages per advertised layer and never branches on game, publisher or format.
 * The harness is structural and accepts both publisher-qualified and common candidate identities.
 */
export async function inspectCandidateWorld(
  source: CandidateWorldSceneSource,
  options: CandidateWorldViewerOptions,
): Promise<CandidateWorldViewerModel> {
  const inspectionStartedAt = inspectionClock()
  const maxLayers = positiveLimit(options.maxLayers, 'maxLayers')
  const maxItemsPerLayer = positiveLimit(options.maxItemsPerLayer, 'maxItemsPerLayer')
  const maxPageItems = positiveLimit(options.maxPageItems ?? maxItemsPerLayer, 'maxPageItems')
  const maxModels = positiveLimit(options.maxModels ?? WORLD_VIEWER_MAX_MODELS, 'maxModels')
  const maxModelBytes = positiveLimit(
    options.maxModelBytes ?? WORLD_VIEWER_MAX_MODEL_BYTES,
    'maxModelBytes',
  )
  const maxConcurrentModelAcquisitions = positiveLimit(
    options.maxConcurrentModelAcquisitions ?? WORLD_VIEWER_MAX_CONCURRENT_MODEL_ACQUISITIONS,
    'maxConcurrentModelAcquisitions',
  )
  options.signal?.throwIfAborted()
  const infoStartedAt = inspectionClock()
  const info = await source.info(options.signal)
  const infoMilliseconds = elapsedInspectionMilliseconds(infoStartedAt)
  // A source materialized across an execution boundary carries only its methods, so its identity
  // is the one info() reports (a dynamic source pins its pages to that info() snapshot).
  const identity =
    (source as Partial<CandidateWorldSceneSource>).snapshotId === undefined ? info : source
  if (
    identity.contract !== info.contract ||
    identity.major !== info.major ||
    identity.snapshotId !== info.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    throw new TypeError('world candidate identity changed between source and info')
  }
  const layerCatalogStartedAt = inspectionClock()
  const layerPage = await source.page({ facet: 'layers', limit: maxLayers }, options.signal)
  const layerCatalogMilliseconds = elapsedInspectionMilliseconds(layerCatalogStartedAt)
  const layers = layerPage.items.filter(
    (item): item is WorldSceneLayerItem => item.facet === 'layers',
  )
  if (layers.length !== layerPage.items.length) {
    throw new TypeError('world layers page contains a non-layer item')
  }
  let layerPageRequests = 0
  const layerAcquisitionStartedAt = inspectionClock()
  const inspected = await Promise.all(
    layers.map(async layer => {
      options.signal?.throwIfAborted()
      const previous = options.previous?.layers.find(
        candidate => candidate.layer.kind === layer.kind,
      )
      const reusable = new Set(['terrain', 'terrain-materials', 'water', 'cliffs', 'navigation'])
      if (
        reusable.has(layer.kind) &&
        layer.contentRevision !== undefined &&
        layer.contentRevision === previous?.layer.contentRevision &&
        previous.page.state === 'available' &&
        previous.page.nextCursor === undefined
      ) {
        return Object.freeze({
          layer,
          page: Object.freeze({
            ...previous.page,
            snapshotId: identity.snapshotId,
            items: Object.freeze(
              previous.page.items.map((item, index) =>
                Object.freeze({
                  ...item,
                  id: `${layer.layerId}:cached:${String(index)}`,
                  layerId: layer.layerId,
                }),
              ),
            ),
          }),
          reused: true,
        })
      }
      const lod =
        layer.lods.includes('exact') && layer.itemCount <= maxItemsPerLayer
          ? 'exact'
          : layer.lods.includes('sampled')
            ? 'sampled'
            : layer.lods[0]
      const items: WorldSceneItem[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      let lastPage: WorldScenePage | undefined
      do {
        const remaining = maxItemsPerLayer - items.length
        if (remaining <= 0) break
        layerPageRequests += 1
        const page = await source.page(
          {
            facet: layer.kind,
            layerId: layer.layerId,
            ...(lod === undefined ? {} : { lod }),
            ...(cursor === undefined ? {} : { cursor }),
            limit: Math.min(maxPageItems, remaining),
          },
          options.signal,
        )
        if (
          page.snapshotId !== identity.snapshotId ||
          page.facet !== layer.kind ||
          page.items.length > Math.min(maxPageItems, remaining)
        ) {
          throw new TypeError(`world ${layer.kind} page has an invalid identity or item count`)
        }
        items.push(...page.items)
        lastPage = page
        const next = page.nextCursor
        if (next !== undefined && (next === cursor || cursors.has(next))) {
          throw new TypeError(`world ${layer.kind} page cursor repeats`)
        }
        if (next !== undefined) cursors.add(next)
        cursor = next
        if (page.state !== 'available') break
      } while (cursor !== undefined)
      if (lastPage === undefined) throw new TypeError(`world ${layer.kind} returned no page`)
      const { nextCursor: _lastCursor, ...lastPageWithoutCursor } = lastPage
      const page = Object.freeze({
        ...lastPageWithoutCursor,
        items: Object.freeze(items),
        ...(cursor === undefined ? {} : { nextCursor: cursor }),
      })
      return Object.freeze({ layer, page, reused: false })
    }),
  )
  const layerAcquisitionMilliseconds = elapsedInspectionMilliseconds(layerAcquisitionStartedAt)
  const cliffResources = new Set(
    inspected.flatMap(({ page }) =>
      page.items.flatMap(item =>
        item.facet === 'objects' && item.derivedFrom === 'cliffs'
          ? [
              ...(item.resourceId === undefined ? [] : [item.resourceId]),
              ...(item.resourceIds ?? []),
            ]
          : [],
      ),
    ),
  )
  // A resource used only as a socket child cannot be placed without its parent's model, so under a
  // model limit it must not take the place of a model that can be drawn on its own.
  const rootResources = new Set<string>()
  const childResources = new Set<string>()
  for (const { page } of inspected) {
    for (const item of page.items) {
      if (item.facet !== 'objects') continue
      if (item.modelComponents === undefined) {
        if (item.resourceId !== undefined) rootResources.add(item.resourceId)
        for (const resourceId of item.resourceIds ?? []) rootResources.add(resourceId)
        continue
      }
      for (const component of item.modelComponents) {
        ;(component.parentId === undefined ? rootResources : childResources).add(component.resourceId)
      }
    }
  }
  const childOnly = (id: string) => childResources.has(id) && !rootResources.has(id)
  const resourceItems = inspected
    .flatMap(item => item.page.items)
    .filter(
      (item): item is WorldSceneResourceItem =>
        item.facet === 'resources' && item.modelResource !== undefined,
    )
    .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index)
    .sort(
      (left, right) =>
        Number(cliffResources.has(right.id)) - Number(cliffResources.has(left.id)) ||
        Number(childOnly(left.id)) - Number(childOnly(right.id)) ||
        right.objectIds.length - left.objectIds.length ||
        left.id.localeCompare(right.id),
    )
  const models = new Map<string, WorldSceneModelResult>()
  const requestedResources =
    options.modelResourceFilter === undefined
      ? resourceItems
      : resourceItems.filter(item => options.modelResourceFilter!(item.id))
  const admittedResources = requestedResources.slice(0, maxModels)
  const perModelBytes = Math.min(WORLD_VIEWER_MODEL_REQUEST_BYTES, maxModelBytes)
  const maxTextureTotalBytes = Math.min(WORLD_VIEWER_TEXTURE_BYTES_PER_MODEL, perModelBytes)
  const maxTextureBytes = maxTextureTotalBytes
  const spentTextureBytes = Math.min(WORLD_VIEWER_SPENT_TEXTURE_BYTES_PER_MODEL, perModelBytes)
  const modelRequestKey = JSON.stringify({
    // Admission count, aggregate budget and worker count do not change an individual result.
    // Only actual per-resource limits belong here, so Load more can retain previous projections.
    perModelBytes,
    maxMeshes: Math.min(256, maxItemsPerLayer),
    maxNodes: Math.min(1_024, maxItemsPerLayer),
    maxPrimitives: Math.min(512, maxItemsPerLayer),
    maxPrimitiveBytes: Math.min(16 * 1024 * 1024, perModelBytes),
    maxResources: Math.min(64, maxItemsPerLayer),
    maxTextureBytes,
    maxTextureTotalBytes,
    metersPerSourceUnit: undefined,
  })
  const omitted = (item: WorldSceneResourceItem, reason: string): WorldSceneModelResult =>
    Object.freeze({
      state: 'unresolved' as const,
      diagnostics: Object.freeze([
        diagnostic('warning', 'x3.ui/world-model-budget-exhausted', `${reason} ${item.id}.`),
      ]),
    })
  for (const item of [
    ...requestedResources.slice(maxModels),
    ...resourceItems.filter(item => !requestedResources.includes(item)),
  ]) {
    models.set(item.id, omitted(item, `World preview model limit ${String(maxModels)} omitted resource`))
  }
  // What converted models actually hold; a texture that several cliff pieces share counts once.
  const counted = new WeakSet<ArrayBufferView>()
  let deliveredModelBytes = 0
  const deliveredBytes = (value: unknown, depth = 0): number => {
    if (ArrayBuffer.isView(value)) {
      if (counted.has(value)) return 0
      counted.add(value)
      return value.byteLength
    }
    if (depth > 6 || value === null || typeof value !== 'object') return 0
    let total = 0
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      total += deliveredBytes(child, depth + 1)
    }
    return total
  }
  let modelRequests = 0
  let reusedModels = 0
  let modelAcquisitionMilliseconds = 0
  if (
    options.previous?.snapshotId === identity.snapshotId &&
    options.previous.modelRequestKey === modelRequestKey
  ) {
    for (const item of admittedResources) {
      const previous = options.previous.models?.get(item.id)
      if (previous?.state === 'converted') {
        models.set(item.id, previous)
        deliveredModelBytes += deliveredBytes(previous)
        reusedModels++
      }
    }
  }
  const requestModel = async (
    item: WorldSceneResourceItem,
    maxBytes: number,
    textureBytes: number,
  ): Promise<WorldSceneModelResult> => {
    modelRequests += 1
    for (let attempt = 0; ; attempt += 1)
      try {
        return await source.model!(
          item.id,
          {
            maxBytes,
            maxNodes: Math.min(1_024, maxItemsPerLayer),
            maxMeshes: Math.min(256, maxItemsPerLayer),
            maxPrimitives: Math.min(512, maxItemsPerLayer),
            maxPrimitiveBytes: Math.min(16 * 1024 * 1024, maxBytes),
            maxResources: Math.min(64, maxItemsPerLayer),
            maxTextureBytes: textureBytes,
            maxTextureTotalBytes: textureBytes,
            // The world renderer uploads S3TC blocks as stored: no decode, a quarter to an eighth of
            // the bytes, and the budget buys a more detailed level.
            compressedTextureFormats: SCENE_COMPRESSED_TEXTURE_FORMATS,
          },
          options.signal,
        )
      } catch (error) {
        options.signal?.throwIfAborted()
        // a model whose source is still downloading it may outlast one call: asked twice more
        if (
          attempt < 2 &&
          (error as { readonly code?: unknown } | null)?.code === 'x3.host/rpc-deadline-exceeded'
        )
          continue
        // One model that cannot be read must not cost the map all the others.
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([
            diagnostic(
              'warning',
              'x3.ui/world-model-failed',
              `World preview could not load ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ]),
        })
      }
  }
  const largestModelBytes = Math.min(WORLD_VIEWER_MAX_BYTES_PER_MODEL, maxModelBytes)
  /**
   * What a model that did not fit its first ask is asked for again, if anything. Its UVM stays
   * reserved while each texture decodes, so both share `maxBytes`: a model whose UVM alone fits
   * can still come back without textures.
   */
  const retryBytes = (result: WorldSceneModelResult, textureBytes: number): number | undefined => {
    let uvmBytes: number | undefined
    for (const item of result.diagnostics) {
      const required = (item.data as { readonly requiredBytes?: unknown } | undefined)?.requiredBytes
      if (item.code === 'x3.host/model-resource-too-large' && typeof required === 'number')
        uvmBytes = required
      else if (item.code === 'x3.host/resource-budget-exceeded' && result.state === 'converted')
        uvmBytes = result.uvmBytes?.byteLength
      // A read that threw (a primitive over its share, say) is tried once with the most a reply carries.
      else if (item.code === 'x3.ui/world-model-failed')
        return perModelBytes < largestModelBytes ? largestModelBytes : undefined
    }
    if (uvmBytes === undefined || uvmBytes > largestModelBytes) return undefined
    const bytes = Math.min(largestModelBytes, uvmBytes + textureBytes)
    return bytes > perModelBytes ? bytes : undefined
  }
  const acquireModel = async (item: WorldSceneResourceItem) => {
    options.signal?.throwIfAborted()
    if (models.get(item.id)?.state === 'converted') return
    // Past the byte budget a model still loads; only its textures shrink.
    const spent = deliveredModelBytes >= maxModelBytes
    const textureBytes = spent ? spentTextureBytes : maxTextureTotalBytes
    let result = await requestModel(item, perModelBytes, textureBytes)
    const retry = retryBytes(result, textureBytes)
    if (retry !== undefined) result = await requestModel(item, retry, textureBytes)
    options.signal?.throwIfAborted()
    // colour keys and sampler filters of the model's textures apply once, as it enters the world
    result = presentWorldModelTextures(result, options.signal)
    deliveredModelBytes += deliveredBytes(result)
    models.set(
      item.id,
      spent && result.state === 'converted'
        ? Object.freeze({
            ...result,
            diagnostics: Object.freeze([
              ...result.diagnostics,
              diagnostic(
                'information',
                'x3.ui/world-model-textures-reduced',
                `World preview model budget of ${String(maxModelBytes)} bytes was spent; ${item.id} has ${String(textureBytes)} bytes of textures.`,
              ),
            ]),
          })
        : result,
    )
  }
  const terrainTextures = new Map<string, SceneRendererTexture>()
  const terrainTextureDiagnostics: Diagnostic[] = []
  const allTerrainTextureIds = [
    ...new Set(
      inspected.flatMap(({ layer }) => [
        ...(layer.materials ?? []).flatMap(material =>
          [
            material.baseColorResourceId,
            material.normalResourceId,
            material.specularResourceId,
          ].filter((resourceId): resourceId is string => resourceId !== undefined),
        ),
        ...(layer.waterMaterials ?? []).flatMap(material =>
          [
            material.baseColorResourceId,
            material.secondaryColorResourceId,
            material.causticsResourceId,
            material.normalResourceId,
            ...(material.causticsFrameResourceIds ?? []),
            ...(material.detailWaves?.normalResourceIds ?? []),
            ...(material.detailWaves?.foamResourceIds ?? []),
          ].filter((resourceId): resourceId is string => resourceId !== undefined),
        ),
        ...(layer.weightRasters ?? []).map(raster => raster.resourceId),
      ]),
    ),
  ]
  const weightRasters = inspected.flatMap(({ layer }) => layer.weightRasters ?? []).length
  if (weightRasters > WORLD_MAX_TERRAIN_WEIGHT_RASTERS)
    terrainTextureDiagnostics.push(
      diagnostic(
        'warning',
        'x3.ui/world-terrain-weight-rasters-capped',
        `the terrain blends ${String(weightRasters)} weight rasters; the world draws at most ${String(WORLD_MAX_TERRAIN_WEIGHT_RASTERS)}, so each cell shows its own weights instead.`,
      ),
    )
  const terrainTextureIds = allTerrainTextureIds.slice(0, WORLD_VIEWER_MAX_TERRAIN_TEXTURES)
  if (allTerrainTextureIds.length > terrainTextureIds.length)
    terrainTextureDiagnostics.push(
      diagnostic(
        'warning',
        'x3.ui/world-terrain-textures-capped',
        `the terrain names ${allTerrainTextureIds.length} textures; the first ${terrainTextureIds.length} are loaded.`,
      ),
    )
  if (options.previous?.snapshotId === identity.snapshotId) {
    for (const resourceId of terrainTextureIds) {
      const previous = options.previous.terrainTextures?.get(resourceId)
      if (previous !== undefined) terrainTextures.set(resourceId, previous)
    }
  }
  let terrainTextureRequests = 0
  let reusedTerrainTextures = 0
  let terrainTextureAcquisitionMilliseconds = 0
  const snapshot = (): CandidateWorldViewerModel =>
    Object.freeze({
      contract: identity.contract,
      major: identity.major,
      snapshotId: identity.snapshotId,
      info,
      layers: worldLayers,
      reusedLayerKinds,
      models: new Map(models),
      terrainTextures: new Map(terrainTextures),
      terrainTextureDiagnostics: Object.freeze([...terrainTextureDiagnostics]),
      modelRequestKey,
      modelBudget: Object.freeze({
        maxModels,
        maxModelBytes,
        bytesPerModel: perModelBytes,
        textureBytesPerModel: maxTextureTotalBytes,
      }),
      loadPerformance: Object.freeze({
        coldStart: options.previous === undefined,
        infoMilliseconds,
        layerCatalogMilliseconds,
        layerAcquisitionMilliseconds,
        modelAcquisitionMilliseconds,
        terrainTextureAcquisitionMilliseconds,
        totalMilliseconds: elapsedInspectionMilliseconds(inspectionStartedAt),
        layerPageRequests,
        reusedLayers: reusedLayerKinds.length,
        modelRequests,
        reusedModels,
        terrainTextureRequests,
        reusedTerrainTextures,
      }),
      ...(layerPage.nextCursor === undefined ? {} : { nextLayerCursor: layerPage.nextCursor }),
    })
  const worldLayers = Object.freeze(
    inspected.map(({ layer, page }) => Object.freeze({ layer, page })),
  )
  const reusedLayerKinds = Object.freeze(
    inspected.filter(item => item.reused).map(item => item.layer.kind),
  )
  let lastProgressAt = -Infinity
  const publish = (phase: WorldLoadProgress['phase'], completed: number, total: number) => {
    options.signal?.throwIfAborted()
    if (options.onProgress === undefined) return
    // Bound render-plan rebuilds while concurrent acquisitions complete. Phase boundaries always publish.
    const now = inspectionClock()
    if (completed !== 0 && completed !== total && now - lastProgressAt < 500) return
    options.onProgress(snapshot(), { phase, completed, total })
    // Measure from the end of the consumer's work: a slow WebGL rebuild must not make the very
    // next completed model eligible for another expensive rebuild.
    lastProgressAt = inspectionClock()
  }
  publish('geometry', 0, 0)
  publish('textures', 0, terrainTextureIds.length)
  const terrainTextureAcquisitionStartedAt = inspectionClock()
  if (source.texture !== undefined) {
    const perTextureBytes = Math.max(
      1,
      Math.min(16 * 1024 * 1024, Math.floor(maxModelBytes / Math.max(1, terrainTextureIds.length))),
    )
    await forEachConcurrent(terrainTextureIds, maxConcurrentModelAcquisitions, async resourceId => {
      options.signal?.throwIfAborted()
      const previous = options.previous?.terrainTextures?.get(resourceId)
      if (options.previous?.snapshotId === identity.snapshotId && previous !== undefined) {
        reusedTerrainTextures += 1
        terrainTextures.set(resourceId, previous)
        return
      }
      terrainTextureRequests += 1
      const weightRaster = inspected
        .flatMap(item => item.layer.weightRasters ?? [])
        .find(raster => raster.resourceId === resourceId)
      const requestedBytes = Math.max(
        perTextureBytes,
        weightRaster === undefined ? 0 : weightRaster.width * weightRaster.height * 4,
      )
      const result = await source.texture!(
        resourceId,
        { maxBytes: requestedBytes, compressedFormats: SCENE_COMPRESSED_TEXTURE_FORMATS },
        options.signal,
      )
      options.signal?.throwIfAborted()
      terrainTextureDiagnostics.push(...result.diagnostics)
      if (result.state === 'decoded') terrainTextures.set(resourceId, result.texture)
    })
  }
  terrainTextureAcquisitionMilliseconds = elapsedInspectionMilliseconds(
    terrainTextureAcquisitionStartedAt,
  )
  publish('textures', terrainTextures.size, terrainTextureIds.length)
  const modelAcquisitionStartedAt = inspectionClock()
  if (source.model !== undefined) {
    for (const phase of ['cliffs', 'objects'] as const) {
      const resources = admittedResources.filter(
        item => cliffResources.has(item.id) === (phase === 'cliffs'),
      )
      let completed = 0
      publish(phase, completed, resources.length)
      await forEachConcurrent(resources, maxConcurrentModelAcquisitions, async item => {
        await acquireModel(item)
        modelAcquisitionMilliseconds = elapsedInspectionMilliseconds(modelAcquisitionStartedAt)
        publish(phase, ++completed, resources.length)
      })
    }
  }
  modelAcquisitionMilliseconds = elapsedInspectionMilliseconds(modelAcquisitionStartedAt)
  publish('complete', admittedResources.length, requestedResources.length)
  return snapshot()
}

interface WorldPreviewPoint {
  readonly x: number
  readonly y: number
  readonly height: number
  readonly kind: 'terrain' | WorldSceneObjectItem['kind']
}

export interface WorldRenderStats {
  readonly terrainTriangles: number
  readonly terrainTexturedTriangles: number
  readonly terrainSplatFallbackCells: number
  readonly waterPolygons: number
  readonly cliffEdges: number
  readonly cliffTriangles: number
  readonly objectInstances: number
  readonly modelTriangles: number
  readonly navigationSamples: number
  readonly gatewaySegments: number
  readonly regionShapes: number
  readonly diagnosticPlaceholders: number
  readonly shadowCasterTriangles: number
  readonly shadowMapSize: number
  /** The drawn plan's camera frame; absent from the 2D fallback. */
  readonly frame?: WorldWebGlFrame
}

/** How long a camera rests before the viewer asks a growing world for what it shows (MW5). */
const WORLD_FOCUS_SETTLE_MS = 400

export type WorldEditStatus = 'idle' | 'preview' | 'committing' | 'stale' | 'error'

export interface WorldEditState {
  readonly sourceRevision: string
  readonly selectedObjectId?: number
  readonly confirmed?: Readonly<{ x: number; y: number; z: number }>
  readonly preview?: Readonly<{ x: number; y: number; z: number }>
  readonly status: WorldEditStatus
  readonly message?: string
}

/** Pure preview state machine; persistence stays behind the host commit coordinator. */
export function createWorldEditState(sourceRevision: string): WorldEditState {
  return Object.freeze({ sourceRevision, status: 'idle' })
}

export function selectWorldObject(
  state: WorldEditState,
  object: WorldSceneObjectItem | undefined,
): WorldEditState {
  if (object === undefined)
    return Object.freeze({ sourceRevision: state.sourceRevision, status: 'idle' })
  const position = Object.freeze({ ...object.position })
  return Object.freeze({
    sourceRevision: state.sourceRevision,
    selectedObjectId: object.objectId,
    confirmed: position,
    preview: position,
    status: 'idle',
  })
}

export function previewWorldObjectMove(
  state: WorldEditState,
  delta: Readonly<{ x: number; y: number; z?: number }>,
): WorldEditState {
  if (state.preview === undefined || state.selectedObjectId === undefined) return state
  if (![delta.x, delta.y, delta.z ?? 0].every(Number.isFinite)) {
    return Object.freeze({ ...state, status: 'error', message: 'move delta must be finite' })
  }
  const { message: _message, ...base } = state
  return Object.freeze({
    ...base,
    preview: Object.freeze({
      x: state.preview.x + delta.x,
      y: state.preview.y + delta.y,
      z: state.preview.z + (delta.z ?? 0),
    }),
    status: 'preview',
  })
}

export function rejectWorldObjectMove(
  state: WorldEditState,
  reason: string,
  stale = false,
): WorldEditState {
  return Object.freeze({
    ...state,
    ...(state.confirmed === undefined ? {} : { preview: state.confirmed }),
    status: stale ? 'stale' : 'error',
    message: reason,
  })
}

export function confirmWorldObjectMove(
  state: WorldEditState,
  sourceRevision: string,
): WorldEditState {
  if (state.preview === undefined)
    return Object.freeze({ ...state, sourceRevision, status: 'idle' })
  const { message: _message, ...base } = state
  return Object.freeze({
    ...base,
    sourceRevision,
    confirmed: state.preview,
    status: 'idle',
  })
}

export function pickWorldObject(
  model: CandidateWorldViewerModel,
  position: Readonly<{ x: number; y: number }>,
  maximumDistance: number,
): WorldSceneObjectItem | undefined {
  if (!Number.isFinite(maximumDistance) || maximumDistance < 0) {
    throw new TypeError('maximumDistance must be a finite non-negative number')
  }
  let selected: WorldSceneObjectItem | undefined
  let distance = maximumDistance
  for (const item of model.layers.flatMap(layer => layer.page.items)) {
    if (item.facet !== 'objects') continue
    const candidate = Math.hypot(item.position.x - position.x, item.position.y - position.y)
    if (candidate <= distance) {
      selected = item
      distance = candidate
    }
  }
  return selected
}

export interface WorldEditCommitPorts {
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly coordinator?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
  readonly operationId?: string
  readonly moveObjectKind?: 'object.update'
  readonly signal?: AbortSignal
}

/** Converts a visual move intent into the ordinary operation → authorization → host commit flow. */
export async function commitWorldObjectMove(
  state: WorldEditState,
  ports: WorldEditCommitPorts,
): Promise<WorldEditState> {
  if (
    state.selectedObjectId === undefined ||
    state.confirmed === undefined ||
    state.preview === undefined
  ) {
    return rejectWorldObjectMove(state, 'no object move is selected')
  }
  if (
    ports.operationId === undefined ||
    ports.moveObjectKind === undefined ||
    ports.coordinator === undefined ||
    ports.authorization === undefined
  ) {
    return rejectWorldObjectMove(state, 'host edit route is unavailable')
  }
  const operationId = ports.operationId
  const moveObjectKind = ports.moveObjectKind
  const selectedObjectId = state.selectedObjectId
  const previewPosition = state.preview
  const { message: _message, ...base } = state
  const committing: WorldEditState = Object.freeze({ ...base, status: 'committing' as const })
  const result = await (async () => {
    try {
      return await invokeOperation(
        ports.descriptor,
        ports.operations,
        operationId,
        {
          expectedSourceRevision: state.sourceRevision,
          edits: [
            {
              kind: moveObjectKind,
              objectId: selectedObjectId,
              patch: { position: previewPosition },
            },
          ],
        },
        ports.signal === undefined ? undefined : { signal: ports.signal },
      )
    } catch (error) {
      return Object.freeze({ state: 'threw' as const, error })
    }
  })()
  if (result.state === 'threw') {
    const message = result.error instanceof Error ? result.error.message : String(result.error)
    return rejectWorldObjectMove(committing, message, /stale|revision|conflict/iu.test(message))
  }
  if (result.state === 'rejected') {
    const stale = result.diagnostics.some(item => /stale|revision/iu.test(item.message))
    return rejectWorldObjectMove(committing, result.reason, stale)
  }
  const output = result.output as { readonly kind?: string; readonly plan?: unknown }
  if (output.kind !== 'edit-plan' || output.plan === undefined) {
    return rejectWorldObjectMove(committing, 'map operation returned no edit plan')
  }
  const plan = output.plan as Parameters<EditAuthorizationPort['request']>[0]
  const grant = await ports.authorization.request(plan, {
    ...(ports.signal === undefined ? {} : { signal: ports.signal }),
  })
  if (grant === undefined) return rejectWorldObjectMove(committing, 'map write was not authorized')
  const prepared = await ports.coordinator.prepare(plan, {
    grant: grant.grant,
    ...(ports.signal === undefined ? {} : { signal: ports.signal }),
  })
  if (prepared.state !== 'ready') {
    return rejectWorldObjectMove(
      committing,
      prepared.state === 'rejected'
        ? String(prepared.reason)
        : 'the map changed after this view opened',
      prepared.state === 'conflict',
    )
  }
  const receipt = await ports.coordinator.commit(prepared.prepared, {
    grant: grant.grant,
    ...(ports.signal === undefined ? {} : { signal: ports.signal }),
  })
  if (receipt.state !== 'committed') {
    return rejectWorldObjectMove(committing, `map write was not committed: ${receipt.state}`)
  }
  // The authoritative source refresh confirms the new position. Until then discard the preview.
  return Object.freeze({
    ...committing,
    preview: state.confirmed,
    status: 'idle',
    message: 'saved; awaiting refreshed world snapshot',
  })
}

function terrainPoint(item: WorldSceneTerrainItem): WorldPreviewPoint {
  // Objects are currently published in map-native coordinates, so the preview uses that shared
  // frame when it exists. UVW remains the fallback for a future canonical-only publisher.
  if (item.mapNativePosition !== undefined) {
    return {
      x: item.mapNativePosition.x,
      y: item.mapNativePosition.y,
      height: item.mapNativePosition.z,
      kind: 'terrain',
    }
  }
  if (item.uvwPosition !== undefined) {
    return {
      x: item.uvwPosition.x,
      y: item.uvwPosition.z,
      height: item.uvwPosition.y,
      kind: 'terrain',
    }
  }
  return {
    x: item.x,
    y: item.y,
    height: item.heightBase + item.heightAdjustment,
    kind: 'terrain',
  }
}

function previewPoint(item: WorldSceneItem): WorldPreviewPoint | undefined {
  if (item.facet === 'terrain') return terrainPoint(item)
  if (item.facet !== 'objects') return undefined
  return {
    x: item.position.x,
    y: item.position.y,
    height: item.position.z,
    kind: item.kind,
  }
}

function colorForMaterial(index: number, normalizedHeight: number): string {
  const hue = ((index * 67 + 92) % 210) + 45
  const lightness = Math.round(27 + normalizedHeight * 28)
  return `hsl(${hue} 34% ${lightness}%)`
}

// Picking uses the exact visible frame (including its animation clock and material inputs).
// Reconstructing a reduced/newer input would invalidate the renderer's retained plan on click.
const lastWorldWebGlInputs = new WeakMap<HTMLCanvasElement, WorldWebGlInput>()

// A model's layer list is frozen and shared by the snapshots of one load, so its flattened world
// items and terrain definitions are built once instead of on every animation frame (~100 000 items).
function flattenWorldLayers(layers: readonly CandidateWorldViewerLayer[]) {
  return Object.freeze({
    items: layers.flatMap(layer => layer.page.items),
    terrainMaterials: layers.flatMap(layer => layer.layer.materials ?? []),
    waterMaterials: layers.flatMap(layer => layer.layer.waterMaterials ?? []),
    terrainWeightRasters: layers.flatMap(layer => layer.layer.weightRasters ?? []),
  })
}

const flattenedWorldLayers = new WeakMap<
  readonly CandidateWorldViewerLayer[],
  ReturnType<typeof flattenWorldLayers>
>()

function flattenedWorldLayersOf(layers: readonly CandidateWorldViewerLayer[]) {
  let flattened = flattenedWorldLayers.get(layers)
  if (flattened === undefined) flattenedWorldLayers.set(layers, (flattened = flattenWorldLayers(layers)))
  return flattened
}

/** Draws a bounded game-neutral isometric scene from common terrain/world facets. */
/** Overlay facets the viewer can switch off; the terrain, water and objects always draw. */
export type WorldOverlayFacet = 'regions' | 'navigation' | 'gateways'
const WORLD_OVERLAY_FACETS: readonly WorldOverlayFacet[] = ['regions', 'navigation', 'gateways']
const shownItemsCache = new WeakMap<readonly WorldSceneItem[], Map<string, readonly WorldSceneItem[]>>()

/**
 * The items without the hidden overlay facets. The same filtered array comes back for the same
 * items and choice, so the renderer keeps its plan between frames.
 */
function shownWorldItems(
  items: readonly WorldSceneItem[],
  hidden: ReadonlySet<WorldOverlayFacet> | undefined,
): readonly WorldSceneItem[] {
  if (hidden === undefined || hidden.size === 0) return items
  const key = WORLD_OVERLAY_FACETS.filter(facet => hidden.has(facet)).join(',')
  let byChoice = shownItemsCache.get(items)
  if (byChoice === undefined) shownItemsCache.set(items, (byChoice = new Map()))
  let shown = byChoice.get(key)
  if (shown === undefined) {
    shown = Object.freeze(items.filter(item => !hidden.has(item.facet as WorldOverlayFacet)))
    byChoice.set(key, shown)
  }
  return shown
}

/** Each world's player colours by slot, once per scene info (the plan compares inputs by identity). */
const worldTeamColors = new WeakMap<
  object,
  ReadonlyMap<number, readonly [number, number, number]>
>()

function worldTeamColorsOf(
  info: CandidateWorldViewerModel['info'],
): ReadonlyMap<number, readonly [number, number, number]> {
  let colors = worldTeamColors.get(info)
  if (colors === undefined) {
    colors = new Map(
      (info.players ?? []).flatMap(player =>
        player.color === undefined ? [] : [[player.id, player.color] as const],
      ),
    )
    worldTeamColors.set(info, colors)
  }
  return colors
}

const worldTeamRamps = new WeakMap<
  CandidateWorldViewerModel['info'],
  ReadonlyMap<number, readonly (readonly [number, number, number])[]>
>()

/** Player slots' own shades for indexed team-colour ramps (MapPlayer.colorRamp). */
function worldTeamRampsOf(
  info: CandidateWorldViewerModel['info'],
): ReadonlyMap<number, readonly (readonly [number, number, number])[]> {
  let ramps = worldTeamRamps.get(info)
  if (ramps === undefined) {
    ramps = new Map(
      (info.players ?? []).flatMap(player =>
        player.colorRamp === undefined ? [] : [[player.id, player.colorRamp] as const],
      ),
    )
    worldTeamRamps.set(info, ramps)
  }
  return ramps
}

/**
 * The world renderer's input for an inspected world, without the viewer's selection, camera and
 * clock: its shown items, player colours, models and ground. The same model gives the same arrays,
 * so a renderer keeps its plan between frames; a headless render (MCP) draws from the same input.
 */
export function candidateWorldWebGlInput(
  model: CandidateWorldViewerModel,
  hiddenOverlays?: ReadonlySet<WorldOverlayFacet>,
): WorldWebGlInput {
  const flattened = flattenedWorldLayersOf(model.layers)
  // objects of a player slot take its colour (an object's own presentationTeamColor still wins)
  const teamColors = worldTeamColorsOf(model.info)
  const teamRamps = worldTeamRampsOf(model.info)
  return {
    items: shownWorldItems(flattened.items, hiddenOverlays),
    ...(teamColors.size === 0 ? {} : { teamColors }),
    ...(teamRamps.size === 0 ? {} : { teamRamps }),
    ...(model.models === undefined ? {} : { models: model.models }),
    terrainMaterials: flattened.terrainMaterials,
    waterMaterials: flattened.waterMaterials,
    terrainWeightRasters: flattened.terrainWeightRasters,
    ...(model.terrainTextures === undefined ? {} : { terrainTextures: model.terrainTextures }),
  }
}

export function drawCandidateWorld(
  canvas: HTMLCanvasElement,
  model: CandidateWorldViewerModel,
  selection?: number | WorldEditState,
  camera?: WorldWebGlCamera,
  animationTimes?: ReadonlyMap<number, number>,
  timeSeconds = 0,
  renderer?: WorldWebGlRenderer,
  hiddenOverlays?: ReadonlySet<WorldOverlayFacet>,
): WorldRenderStats {
  const selectedObjectId = typeof selection === 'number' ? selection : selection?.selectedObjectId
  const webGlInput = {
    ...candidateWorldWebGlInput(model, hiddenOverlays),
    ...(selectedObjectId === undefined ? {} : { selectedObjectId }),
    ...(typeof selection !== 'object' || selection.preview === undefined
      ? {}
      : { previewPosition: selection.preview }),
    ...(camera === undefined ? {} : { camera }),
    ...(animationTimes === undefined ? {} : { animationTimes }),
    timeSeconds,
    shadows: true,
  }
  const webGlStats = renderer?.draw(webGlInput) ?? drawWorldWebGl(canvas, webGlInput)
  if (webGlStats !== undefined) {
    lastWorldWebGlInputs.set(canvas, webGlInput)
    return webGlStats
  }
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  const width = 720
  const height = 480
  canvas.width = width
  canvas.height = height
  context.clearRect(0, 0, width, height)

  const points = model.layers.flatMap(layer =>
    layer.page.items.flatMap(item => {
      const point = previewPoint(item)
      return point === undefined ? [] : [point]
    }),
  )
  const emptyStats = Object.freeze({
    terrainTriangles: 0,
    terrainTexturedTriangles: 0,
    terrainSplatFallbackCells: 0,
    waterPolygons: 0,
    cliffEdges: 0,
    cliffTriangles: 0,
    objectInstances: 0,
    modelTriangles: 0,
    navigationSamples: 0,
    gatewaySegments: 0,
    regionShapes: 0,
    diagnosticPlaceholders: 0,
    shadowCasterTriangles: 0,
    shadowMapSize: 0,
  })
  if (points.length === 0) return emptyStats
  if (
    points.some(
      point =>
        !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.height),
    )
  ) {
    throw new TypeError('world preview contains a non-finite coordinate')
  }

  const terrain = points.filter(point => point.kind === 'terrain')
  let minimumX = Infinity
  let maximumX = -Infinity
  let minimumY = Infinity
  let maximumY = -Infinity
  let minimumHeight = 0
  let maximumHeight = 1
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x)
    maximumX = Math.max(maximumX, point.x)
    minimumY = Math.min(minimumY, point.y)
    maximumY = Math.max(maximumY, point.y)
    if (point.kind === 'terrain') {
      minimumHeight = Math.min(minimumHeight, point.height)
      maximumHeight = Math.max(maximumHeight, point.height)
    }
  }
  const raw = (point: WorldPreviewPoint): readonly [number, number] => [
    point.x - point.y,
    (point.x + point.y) * 0.5 - point.height * 0.8,
  ]
  const projected = points.map(raw)
  const rawMinX = Math.min(...projected.map(item => item[0]))
  const rawMaxX = Math.max(...projected.map(item => item[0]))
  const rawMinY = Math.min(...projected.map(item => item[1]))
  const rawMaxY = Math.max(...projected.map(item => item[1]))
  const margin = 24
  const scale = Math.min(
    (width - margin * 2) / Math.max(1, rawMaxX - rawMinX),
    (height - margin * 2) / Math.max(1, rawMaxY - rawMinY),
  )
  const screen = (point: WorldPreviewPoint): readonly [number, number] => {
    const [x, y] = raw(point)
    return [margin + (x - rawMinX) * scale, margin + (y - rawMinY) * scale]
  }

  const terrainItems = model.layers.flatMap(layer =>
    layer.page.items.filter((item): item is WorldSceneTerrainItem => item.facet === 'terrain'),
  )
  const materialItems = model.layers.flatMap(layer =>
    layer.page.items.filter(item => item.facet === 'terrain-materials'),
  )
  const materialByCell = new Map(
    materialItems.map(item => [`${item.x}:${item.y}`, item.textureIndex]),
  )
  const terrainByCell = new Map(terrainItems.map(item => [`${item.x}:${item.y}`, item]))
  let terrainTriangles = 0
  const orderedCells = [...terrainItems].sort((left, right) => left.y - right.y || left.x - right.x)
  for (const item of orderedCells) {
    const east = terrainByCell.get(`${item.x + 1}:${item.y}`)
    const south = terrainByCell.get(`${item.x}:${item.y + 1}`)
    const southEast = terrainByCell.get(`${item.x + 1}:${item.y + 1}`)
    if (east === undefined || south === undefined || southEast === undefined) continue
    const corners = [
      terrainPoint(item),
      terrainPoint(east),
      terrainPoint(southEast),
      terrainPoint(south),
    ]
    const normalized =
      (terrainPoint(item).height - minimumHeight) / Math.max(1, maximumHeight - minimumHeight)
    context.fillStyle = colorForMaterial(materialByCell.get(`${item.x}:${item.y}`) ?? 0, normalized)
    context.beginPath()
    const first = screen(corners[0] as WorldPreviewPoint)
    context.moveTo(first[0], first[1])
    for (const corner of corners.slice(1)) {
      const target = screen(corner)
      context.lineTo(target[0], target[1])
    }
    context.closePath()
    context.fill()
    terrainTriangles += 2
  }
  if (terrainTriangles === 0) {
    for (const point of terrain) {
      const [x, y] = screen(point)
      context.fillStyle = colorForMaterial(0, 0.5)
      context.fillRect(x - 1.5, y - 1.5, 3, 3)
    }
  }

  let waterPolygons = 0
  let diagnosticPlaceholders = 0
  for (const item of model.layers
    .flatMap(layer => layer.page.items)
    .filter(item => item.facet === 'water')) {
    const elevation = item.elevation ?? minimumHeight
    const corners: WorldPreviewPoint[] = [
      { x: item.minimum.x, y: item.minimum.y, height: elevation, kind: 'terrain' },
      { x: item.maximum.x, y: item.minimum.y, height: elevation, kind: 'terrain' },
      { x: item.maximum.x, y: item.maximum.y, height: elevation, kind: 'terrain' },
      { x: item.minimum.x, y: item.maximum.y, height: elevation, kind: 'terrain' },
    ]
    context.fillStyle = 'rgba(54, 151, 214, 0.48)'
    context.beginPath()
    const first = screen(corners[0] as WorldPreviewPoint)
    context.moveTo(first[0], first[1])
    for (const corner of corners.slice(1)) {
      const target = screen(corner)
      context.lineTo(target[0], target[1])
    }
    context.closePath()
    context.fill()
    waterPolygons += 1
    if (item.elevation === undefined) diagnosticPlaceholders += 1
  }

  let cliffEdges = 0
  const cliffs = model.layers
    .flatMap(layer => layer.page.items)
    .filter(item => item.facet === 'cliffs')
  const cliffByCell = new Map(cliffs.map(item => [`${item.x}:${item.y}`, item]))
  context.strokeStyle = '#2d2017'
  context.lineWidth = 2
  for (const item of cliffs) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const neighbor = cliffByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (neighbor === undefined || neighbor.level === item.level) continue
      const a = terrainByCell.get(`${item.x}:${item.y}`)
      const b = terrainByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (a === undefined || b === undefined) continue
      const from = screen(terrainPoint(a))
      const to = screen(terrainPoint(b))
      context.beginPath()
      context.moveTo(from[0], from[1])
      context.lineTo(to[0], to[1])
      context.stroke()
      cliffEdges += 1
    }
  }

  const colors = WORLD_OBJECT_KIND_COLORS
  const objectItems = model.layers.flatMap(layer =>
    layer.page.items.filter((item): item is WorldSceneObjectItem => item.facet === 'objects'),
  )
  let modelTriangles = 0
  for (const item of objectItems) {
    const previewPosition =
      item.objectId === selectedObjectId && typeof selection === 'object'
        ? selection.preview
        : undefined
    const point = previewPoint(
      previewPosition === undefined ? item : { ...item, position: previewPosition },
    ) as WorldPreviewPoint
    const [x, y] = screen(point)
    context.fillStyle = colors[item.kind]
    const modelResults = [
      ...new Set([
        ...(item.resourceId === undefined ? [] : [item.resourceId]),
        ...(item.resourceIds ?? []),
      ]),
    ].flatMap(resourceId => {
      const result = model.models?.get(resourceId)
      return result === undefined ? [] : [result]
    })
    let renderedModel = false
    let resolvedModel = false
    for (const modelResult of modelResults)
      if (modelResult.state === 'converted') {
        resolvedModel = true
        const nodes = modelResult.nodes ?? []
        const clip = modelResult.animations?.find(
          candidate => candidate.kind === 'animation' && candidate.channels.length > 0,
        )
        const renderPrimitives: readonly SceneRendererPrimitive[] =
          nodes.length === 0
            ? modelResult.primitives
            : createModelSceneSampler(
                {
                  nodes,
                  meshes: modelResult.meshes,
                  primitives: modelResult.primitives,
                  ...(modelResult.skeleton === undefined ? {} : { skeleton: modelResult.skeleton }),
                },
                {
                  ...(clip === undefined ? {} : { clip }),
                  maxBytes: 64 * 1024 * 1024,
                },
              ).sample(animationTimes?.get(item.objectId) ?? 0).primitives
        const scale = item.scale ?? { x: 1, y: 1, z: 1 }
        const rotation = item.rotation ?? 0
        const cosine = Math.cos(rotation)
        const sine = Math.sin(rotation)
        for (const primitive of renderPrimitives) {
          if (primitive.topology !== 'triangles') continue
          const vertex = (index: number): WorldPreviewPoint => {
            const sourceX = primitive.positions[index * 3] ?? 0
            const sourceY = primitive.positions[index * 3 + 1] ?? 0
            const sourceZ = primitive.positions[index * 3 + 2] ?? 0
            const transform = primitive.transform
            const modelX =
              (transform === undefined
                ? sourceX
                : transform[0]! * sourceX +
                  transform[4]! * sourceY +
                  transform[8]! * sourceZ +
                  transform[12]!) * scale.x
            const modelY =
              (transform === undefined
                ? sourceY
                : transform[1]! * sourceX +
                  transform[5]! * sourceY +
                  transform[9]! * sourceZ +
                  transform[13]!) * scale.y
            const modelZ =
              (transform === undefined
                ? sourceZ
                : transform[2]! * sourceX +
                  transform[6]! * sourceY +
                  transform[10]! * sourceZ +
                  transform[14]!) * scale.z
            return {
              x: point.x + cosine * modelX - sine * modelZ,
              y: point.y + sine * modelX + cosine * modelZ,
              height: point.height + modelY,
              kind: item.kind,
            }
          }
          const indices =
            primitive.indices ??
            Uint32Array.from(
              { length: Math.floor(primitive.positions.length / 3) },
              (_, index) => index,
            )
          for (let index = 0; index + 2 < indices.length; index += 3) {
            const triangle = [
              vertex(indices[index]!),
              vertex(indices[index + 1]!),
              vertex(indices[index + 2]!),
            ]
            const projected = triangle.map(screen)
            context.beginPath()
            context.moveTo(projected[0]![0], projected[0]![1])
            context.lineTo(projected[1]![0], projected[1]![1])
            context.lineTo(projected[2]![0], projected[2]![1])
            context.closePath()
            context.fill()
            modelTriangles += 1
            renderedModel = true
          }
        }
      }
    if (!renderedModel && !resolvedModel) {
      diagnosticPlaceholders += 1
      context.beginPath()
      context.arc(
        x,
        y,
        item.objectId === selectedObjectId ? 7 : point.kind === 'structure' ? 5 : 3.5,
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  }

  let navigationSamples = 0
  context.fillStyle = 'rgba(210, 60, 60, 0.32)'
  for (const item of model.layers
    .flatMap(layer => layer.page.items)
    .filter(item => item.facet === 'navigation')) {
    if (item.flags === 0) continue
    const [x, y] = screen({ x: item.x, y: item.y, height: minimumHeight, kind: 'terrain' })
    context.fillRect(x - 1, y - 1, 2, 2)
    navigationSamples += 1
  }

  let gatewaySegments = 0
  context.strokeStyle = 'rgba(30, 230, 220, 0.95)'
  context.lineWidth = 2
  for (const item of model.layers
    .flatMap(layer => layer.page.items)
    .filter(item => item.facet === 'gateways')) {
    const start = item.uvwStart ?? { x: item.x1, z: item.y1 }
    const end = item.uvwEnd ?? { x: item.x2, z: item.y2 }
    const projectedStart = screen({
      x: start.x,
      y: start.z,
      height: minimumHeight,
      kind: 'terrain',
    })
    const projectedEnd = screen({ x: end.x, y: end.z, height: minimumHeight, kind: 'terrain' })
    context.beginPath()
    context.moveTo(projectedStart[0], projectedStart[1])
    context.lineTo(projectedEnd[0], projectedEnd[1])
    context.stroke()
    gatewaySegments += 1
  }

  let regionShapes = 0
  context.strokeStyle = 'rgba(255, 215, 80, 0.9)'
  context.lineWidth = 1.5
  for (const item of model.layers
    .flatMap(layer => layer.page.items)
    .filter(item => item.facet === 'regions')) {
    for (const shape of item.shapes) {
      if (shape.center === undefined || shape.radius === undefined) continue
      const center = screen({ ...shape.center, height: minimumHeight, kind: 'terrain' })
      context.beginPath()
      context.arc(center[0], center[1], Math.max(2, shape.radius * scale), 0, Math.PI * 2)
      context.stroke()
      regionShapes += 1
    }
  }
  return Object.freeze({
    terrainTriangles,
    terrainTexturedTriangles: 0,
    terrainSplatFallbackCells: 0,
    waterPolygons,
    cliffEdges,
    cliffTriangles: 0,
    objectInstances: objectItems.length,
    modelTriangles,
    navigationSamples,
    gatewaySegments,
    regionShapes,
    diagnosticPlaceholders,
    shadowCasterTriangles: 0,
    shadowMapSize: 0,
  })
}

/** Common viewer for every world publisher that implements the shared candidate source contract. */
export interface WorldViewerModuleOptions {
  readonly localizer?: UiLocalizer
  /**
   * Maps can show their bounded height lattice immediately while assets load. `auto` does so
   * unless the terrain is of one height — a 2D game's map, whose lattice is one colour — and then
   * starts in 3D; it decides once, on the first terrain, so a later choice of view stays.
   */
  readonly initialView?: 'lattice' | '3d' | 'auto'
  /**
   * Sidebar sections the host contributes, beside the world's own readout.
   *
   * A map's identity documents are not opened on their own — `MapInfo` opens the map — so the
   * facts they carry have to be readable here or they are lost. A section whose module cannot
   * bind to this subject removes itself rather than showing an empty box.
   */
  readonly sections?: readonly ImageSidebarSection[]
  /** Objects play their clips and water moves (the default); false keeps the world still. */
  readonly animations?: boolean
}

/**
 * Re-reads a dynamic world snapshot whenever its optional transport publishes a position change.
 * The helper is format-neutral: replay, cutscene and future simulation codecs can share it.
 */
export async function watchTransportedWorld(
  transport: TransportSource,
  render: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  try {
    for await (const event of transport.events(signal)) {
      if (event.kind === 'snapshot') await render()
    }
  } catch (error) {
    if (!signal?.aborted) throw error
  }
}

export function createWorldViewer(options: WorldViewerModuleOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, WORLD_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.world'))
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'model' })
      const details = shell.section('world', localizer.text('viewer.world'), { icon: 'globe' }).body
      const readout = element(details, 'output', { part: 'model.readout' })
      readout.setAttribute('aria-live', 'polite')
      for (const contributed of options.sections ?? []) {
        const section = shell.section(contributed.id, contributed.title, {
          ...(contributed.icon === undefined ? {} : { icon: contributed.icon }),
          collapsed: contributed.collapsed ?? false,
        })
        void contributed.module
          .mount({ ...args, container: section.body })
          .then(mounted => scope.cleanup(() => void mounted.unmount()))
          .catch(() => section.root.remove())
      }
      const toolbar = element(stage, 'div', { part: 'model.toolbar', role: 'toolbar' })
      toolbar.setAttribute('aria-label', localizer.text('viewer.worldView'))
      const latticeButton = element(toolbar, 'button', {
        text: localizer.text('viewer.worldLattice'),
      }) as HTMLButtonElement
      const sceneButton = element(toolbar, 'button', {
        text: localizer.text('viewer.world3d'),
      }) as HTMLButtonElement
      latticeButton.type = sceneButton.type = 'button'
      latticeButton.dataset['worldView'] = 'lattice'
      sceneButton.dataset['worldView'] = '3d'
      // Overlays the 3D view can hide; each button shows once the map publishes that facet.
      const hiddenOverlays = new Set<WorldOverlayFacet>()
      const overlayLabels: Readonly<Record<WorldOverlayFacet, string>> = {
        regions: localizer.text('viewer.worldRegions'),
        navigation: localizer.text('viewer.worldNavigation'),
        gateways: localizer.text('viewer.worldGateways'),
      }
      const overlayButtons = new Map(
        WORLD_OVERLAY_FACETS.map(facet => {
          const button = element(toolbar, 'button', { text: overlayLabels[facet] }) as HTMLButtonElement
          button.type = 'button'
          button.hidden = true
          button.dataset['worldOverlay'] = facet
          button.title = `${localizer.text('viewer.worldOverlays')}: ${overlayLabels[facet]}`
          button.setAttribute('aria-pressed', 'true')
          return [facet, button] as const
        }),
      )
      const kindLabels: Readonly<Record<WorldSceneObjectItem['kind'], string>> = {
        unit: localizer.text('viewer.worldKindUnit'),
        structure: localizer.text('viewer.worldKindStructure'),
        feature: localizer.text('viewer.worldKindFeature'),
        doodad: localizer.text('viewer.worldKindDoodad'),
        point: localizer.text('viewer.worldKindPoint'),
        camera: localizer.text('viewer.worldKindCamera'),
      }
      const latticeLabels = { ...kindLabels, ramp: localizer.text('viewer.worldRamp') }
      const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
      const latticeCanvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
      canvas.width = 720
      canvas.height = 480
      latticeCanvas.width = 720
      latticeCanvas.height = 480
      latticeCanvas.setAttribute('role', 'img')
      latticeCanvas.setAttribute('aria-label', localizer.text('viewer.worldLattice'))
      latticeCanvas.dataset['worldRenderer'] = 'lattice-2d'
      element(details, 'p', { part: 'model.readout', text: localizer.text('viewer.worldControls') })
      const editStatus = element(details, 'output', { part: 'model.readout' })
      const saveMove = element(details, 'button', {
        text: localizer.text('viewer.worldSaveMove'),
      }) as HTMLButtonElement
      saveMove.type = 'button'
      saveMove.disabled = true
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', localizer.text('viewer.worldPreview'))
      canvas.tabIndex = 0

      const [lease, transportLease] = await Promise.all([
        unknownSourceLease(args.sources, args.slot, WORLD_SCENE_SOURCE_CONTRACT),
        unknownSourceLease(args.sources, args.slot, 'common.view/transport-source'),
      ])
      if (lease === undefined) {
        await transportLease?.release()
        await scope.close()
        throw new TypeError('world binding is unavailable')
      }
      scope.lease(lease)
      if (transportLease !== undefined) scope.lease(transportLease)
      let renderRevision = 0
      let descriptor = args.descriptor
      let currentModel: CandidateWorldViewerModel | undefined
      let viewMode: 'lattice' | '3d' =
        options.initialView === 'auto' ? 'lattice' : (options.initialView ?? '3d')
      let viewUndecided = options.initialView === 'auto'
      let latticePlan: WorldLatticePlan | undefined
      let latticeLayers: CandidateWorldViewerModel['layers'] | undefined
      let loading = false
      // the frame the last 3D draw measured its camera in, and a pending ask for the ground in view
      let lastFrame: WorldWebGlFrame | undefined
      let focusTimer: ReturnType<typeof setTimeout> | undefined
      let focusing = false
      const phaseKeys = {
        geometry: 'viewer.worldLoadingGeometry',
        textures: 'viewer.worldLoadingTextures',
        cliffs: 'viewer.worldLoadingCliffs',
        objects: 'viewer.worldLoadingObjects',
        complete: 'viewer.worldLoaded',
      } as const
      let edit = createWorldEditState(descriptor.revision)
      let camera = DEFAULT_WORLD_WEBGL_CAMERA
      const animationEpochs = new Map<number, number>()
      const view = canvas.ownerDocument.defaultView
      let webGlRenderer: WorldWebGlRenderer | undefined
      const worldEpoch = (view?.performance.now() ?? Date.now()) / 1000
      let animationFrame: number | undefined
      const animate = options.animations !== false
      const currentWorldTime = () =>
        animate ? (view?.performance.now() ?? Date.now()) / 1000 - worldEpoch : 0
      const hasAnimatedWater = () =>
        animate &&
        currentModel?.layers.some(layer =>
          layer.layer.waterMaterials?.some(
            material =>
              material.scroll?.some(component => component !== 0) ||
              ((material.causticsFrameResourceIds?.length ?? 0) > 1 &&
                (material.causticsFramesPerSecond ?? 0) > 0),
          ),
        ) === true
      const currentAnimationTimes = () => {
        const times = new Map<number, number>()
        if (currentModel === undefined || !animate) return times
        const now = (view?.performance.now() ?? Date.now()) / 1000
        const liveObjects = new Set<number>()
        for (const item of currentModel.layers
          .flatMap(layer => layer.page.items)
          .filter(
            (candidate): candidate is WorldSceneObjectItem => candidate.facet === 'objects',
          )) {
          liveObjects.add(item.objectId)
          // every model the object places: an object of components or a list has no resourceId
          const plays = worldObjectModelResources(item).some(resourceId => {
            const result = currentModel?.models?.get(resourceId)
            return (
              result?.state === 'converted' &&
              (result.animations?.some(
                clip => clip.kind === 'animation' && clip.channels.length > 0,
              ) === true ||
                (item.presentationAnimation !== undefined && (result.animations?.length ?? 0) > 0))
            )
          })
          if (!plays) continue
          const epoch = animationEpochs.get(item.objectId) ?? now
          animationEpochs.set(item.objectId, epoch)
          times.set(item.objectId, now - epoch)
        }
        for (const objectId of animationEpochs.keys())
          if (!liveObjects.has(objectId)) animationEpochs.delete(objectId)
        return times
      }
      const redraw = () => {
        if (viewUndecided && currentModel !== undefined) {
          const items = currentModel.layers.flatMap(layer => layer.page.items)
          if (items.some(item => item.facet === 'terrain')) {
            viewUndecided = false
            latticePlan = createWorldLatticePlan(items)
            latticeLayers = currentModel.layers
            if (latticePlan.flat) viewMode = '3d'
          }
        }
        canvas.hidden = viewMode !== '3d'
        latticeCanvas.hidden = viewMode !== 'lattice'
        latticeButton.setAttribute('aria-pressed', String(viewMode === 'lattice'))
        sceneButton.setAttribute('aria-pressed', String(viewMode === '3d'))
        if (currentModel !== undefined) {
          if (viewMode === 'lattice') {
            if (latticeLayers !== currentModel.layers) {
              latticePlan = createWorldLatticePlan(
                currentModel.layers.flatMap(layer => layer.page.items),
              )
              latticeLayers = currentModel.layers
            }
            if (latticePlan !== undefined)
              drawWorldLattice(latticeCanvas, latticePlan, edit.selectedObjectId, latticeLabels)
          } else {
            webGlRenderer ??= createWorldWebGlRenderer(canvas)
            const stats = drawCandidateWorld(
              canvas,
              currentModel,
              edit,
              camera,
              currentAnimationTimes(),
              currentWorldTime(),
              webGlRenderer,
              hiddenOverlays,
            )
            canvas.dataset['worldRenderer'] = webGlRenderer === undefined ? 'isometric-2d' : 'webgl'
            lastFrame = stats.frame
            canvas.dataset['worldModelTriangles'] = String(stats.modelTriangles)
            canvas.dataset['worldPlaceholders'] = String(stats.diagnosticPlaceholders)
          }
        }
        setViewerText(editStatus, edit.message ?? (edit.status === 'preview' ? 'Move preview' : ''))
        saveMove.disabled = edit.status !== 'preview'
      }
      const syncAnimationLoop = () => {
        const requestFrame = view?.requestAnimationFrame.bind(view)
        const cancelFrame = view?.cancelAnimationFrame.bind(view)
        if (
          viewMode !== '3d' ||
          loading ||
          (currentAnimationTimes().size === 0 && !hasAnimatedWater()) ||
          requestFrame === undefined
        ) {
          if (animationFrame !== undefined && cancelFrame !== undefined) cancelFrame(animationFrame)
          animationFrame = undefined
          return
        }
        if (animationFrame !== undefined) return
        animationFrame = requestFrame(() => {
          animationFrame = undefined
          if (scope.signal.aborted) return
          redraw()
          syncAnimationLoop()
        })
      }
      const render = async () => {
        const revision = ++renderRevision
        loading = true
        syncAnimationLoop()
        setState(stage, ['loading'])
        setViewerText(readout, localizer.text('viewer.worldLoadingGeometry'))
        let model: CandidateWorldViewerModel
        try {
          model = await inspectCandidateWorld(lease.value as WorldSceneSource, {
            maxLayers: WORLD_VIEWER_MAX_LAYERS,
            maxItemsPerLayer: WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
            maxPageItems: WORLD_VIEWER_MAX_PAGE_ITEMS,
            signal: scope.signal,
            ...(currentModel === undefined ? {} : { previous: currentModel }),
            onProgress(model, progress) {
              if (revision !== renderRevision || scope.signal.aborted) return
              currentModel = model
              stage.dataset['worldLoadingPhase'] = progress.phase
              setViewerText(
                readout,
                `${localizer.text(phaseKeys[progress.phase])} · ${progress.completed}/${progress.total}`,
              )
              redraw()
            },
          })
        } catch (error) {
          if (revision !== renderRevision || scope.signal.aborted) return
          loading = false
          setState(stage, ['error'])
          setViewerText(
            readout,
            localizer.text('viewer.worldError', {
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
          return
        }
        if (revision !== renderRevision || scope.signal.aborted) return
        loading = false
        currentModel = model
        if (edit.selectedObjectId !== undefined) {
          const refreshed = model.layers
            .flatMap(layer => layer.page.items)
            .find(
              (item): item is WorldSceneObjectItem =>
                item.facet === 'objects' && item.objectId === edit.selectedObjectId,
            )
          edit = selectWorldObject(createWorldEditState(descriptor.revision), refreshed)
        }
        const available = model.layers.filter(layer => layer.page.state === 'available')
        const itemCount = available.reduce((total, layer) => total + layer.page.items.length, 0)
        const allItems = model.layers.flatMap(layer => layer.page.items)
        for (const [facet, button] of overlayButtons)
          button.hidden = !allItems.some(item => item.facet === facet)
        // Placed objects by kind, in the legend's order (MK2's status line counted units and doodads).
        const kindCounts = new Map<WorldSceneObjectItem['kind'], number>()
        for (const item of allItems)
          if (item.facet === 'objects' && item.derivedFrom !== 'cliffs')
            kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1)
        const kindSummary = (Object.keys(kindLabels) as WorldSceneObjectItem['kind'][])
          .filter(kind => (kindCounts.get(kind) ?? 0) > 0)
          .map(kind => `${kindLabels[kind]} ${String(kindCounts.get(kind))}`)
          .join(' · ')
        const modelAssets = worldModelAssetStatus(model)
        const partial =
          model.nextLayerCursor !== undefined ||
          modelAssets.partial ||
          model.layers.some(
            layer => layer.page.nextCursor !== undefined || layer.layer.state !== 'available',
          )
        setViewerText(
          readout,
          localizer.text('viewer.worldSummary', {
            map: model.info.mapId,
            layers: available.length,
            items: itemCount,
            bounded: partial ? localizer.text('viewer.boundedPreview') : '',
          }) +
            ` · ${String(modelAssets.converted)}/${String(modelAssets.total)} ${localizer.text('viewer.modelResources')}` +
            (kindSummary.length === 0 ? '' : ` · ${kindSummary}`),
        )
        if (itemCount > 0) redraw()
        if (itemCount === 0) {
          setViewerText(readout, localizer.text('viewer.worldEmpty'))
        }
        setState(stage, [])
        syncAnimationLoop()
      }

      const setViewMode = (mode: 'lattice' | '3d') => {
        viewMode = mode
        redraw()
        syncAnimationLoop()
      }
      const onLattice = () => setViewMode('lattice')
      const onScene = () => setViewMode('3d')
      latticeButton.addEventListener('click', onLattice)
      sceneButton.addEventListener('click', onScene)
      for (const [facet, button] of overlayButtons) {
        const onOverlay = () => {
          if (hiddenOverlays.has(facet)) hiddenOverlays.delete(facet)
          else hiddenOverlays.add(facet)
          button.setAttribute('aria-pressed', String(!hiddenOverlays.has(facet)))
          redraw()
        }
        button.addEventListener('click', onOverlay)
        scope.cleanup(() => button.removeEventListener('click', onOverlay))
      }
      redraw()
      const resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(() => {
              const activeCanvas = viewMode === '3d' ? canvas : latticeCanvas
              const rect = activeCanvas.getBoundingClientRect()
              if (rect.width <= 0 || rect.height <= 0) return
              const density = Math.min(2, view?.devicePixelRatio ?? 1)
              const width = Math.max(1, Math.min(2048, Math.round(rect.width * density)))
              const height = Math.max(1, Math.min(2048, Math.round(rect.height * density)))
              if (
                canvas.width === width &&
                canvas.height === height &&
                latticeCanvas.width === width &&
                latticeCanvas.height === height
              )
                return
              canvas.width = latticeCanvas.width = width
              canvas.height = latticeCanvas.height = height
              redraw()
            })
      resizeObserver?.observe(stage)
      scope.cleanup(() => resizeObserver?.disconnect())

      const onPointer = (event: PointerEvent) => {
        if (event.button !== 0 || event.altKey) return
        if (currentModel === undefined) return
        const objects = currentModel.layers
          .flatMap(layer => layer.page.items)
          .filter((item): item is WorldSceneObjectItem => item.facet === 'objects')
        if (objects.length === 0) return
        const rect = canvas.getBoundingClientRect()
        const worldItems = currentModel.layers.flatMap(layer => layer.page.items)
        const pickInput = lastWorldWebGlInputs.get(canvas) ?? {
          items: worldItems,
          ...(currentModel.models === undefined ? {} : { models: currentModel.models }),
          camera,
          animationTimes: currentAnimationTimes(),
        }
        const screen = {
          x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
          y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
          width: canvas.width,
          height: canvas.height,
        }
        const hit =
          webGlRenderer === undefined
            ? pickWorldWebGl(pickInput, screen)
            : webGlRenderer.pick(pickInput, screen)
        edit = selectWorldObject(
          edit,
          hit?.kind === 'object' ? objects.find(item => item.objectId === hit.objectId) : undefined,
        )
        redraw()
      }
      // The lattice picks the object drawn nearest to the click, as the 3D view picks by ray.
      const onLatticePointer = (event: PointerEvent) => {
        if (event.button !== 0 || currentModel === undefined || latticePlan === undefined) return
        const rect = latticeCanvas.getBoundingClientRect()
        const objectId = worldLatticeObjectAt(
          latticeCanvas,
          latticePlan,
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * latticeCanvas.width,
          ((event.clientY - rect.top) / Math.max(1, rect.height)) * latticeCanvas.height,
        )
        edit = selectWorldObject(
          edit,
          objectId === undefined
            ? undefined
            : currentModel.layers
                .flatMap(layer => layer.page.items)
                .find(
                  (item): item is WorldSceneObjectItem =>
                    item.facet === 'objects' && item.objectId === objectId,
                ),
        )
        redraw()
      }
      let drag:
        | {
            pointerId: number
            mode: 'orbit' | 'pan'
            x: number
            y: number
          }
        | undefined
      const onCameraPointerDown = (event: PointerEvent) => {
        if (event.button !== 1 && event.button !== 2 && !event.altKey) return
        event.preventDefault()
        drag = {
          pointerId: event.pointerId,
          mode: event.button === 1 || event.shiftKey ? 'pan' : 'orbit',
          x: event.clientX,
          y: event.clientY,
        }
        canvas.setPointerCapture(event.pointerId)
      }
      const onCameraPointerMove = (event: PointerEvent) => {
        if (drag === undefined || drag.pointerId !== event.pointerId || currentModel === undefined)
          return
        const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y }
        drag.x = event.clientX
        drag.y = event.clientY
        if (drag.mode === 'orbit') camera = orbitWorldWebGlCamera(camera, delta)
        else {
          const worldItems = currentModel.layers.flatMap(layer => layer.page.items)
          camera = panWorldWebGlCamera(
            {
              items: worldItems,
              ...(currentModel.models === undefined ? {} : { models: currentModel.models }),
              camera,
            },
            camera,
            { ...delta, viewportHeight: canvas.height },
          )
        }
        redraw()
      }
      // A world larger than it holds (MW5) moves to the ground in view once the camera rests; the
      // camera keeps the frame it was measured in, so the view stays while the world under it changes.
      const focusView = async () => {
        const source = lease.value as WorldSceneSource
        const frame = camera.frame ?? lastFrame
        if (source.focus === undefined || frame === undefined) return
        if (loading || focusing || viewMode !== '3d' || scope.signal.aborted) return
        focusing = true
        canvas.dataset['worldFocus'] = 'asking'
        try {
          const window = worldViewGroundWindow(
            frame,
            camera,
            canvas.width / Math.max(1, canvas.height),
          )
          // a move takes a new analysis, longer than one call may wait: past its deadline, ask again
          let moved: boolean | undefined
          while (moved === undefined && !scope.signal.aborted)
            moved = await source
              .focus(window, scope.signal)
              .catch((error: unknown) =>
                (error as { readonly code?: unknown } | null)?.code ===
                'x3.host/rpc-deadline-exceeded'
                  ? undefined
                  : false,
              )
          if (scope.signal.aborted) return
          const shown = (await source.info(scope.signal)).snapshotId
          canvas.dataset['worldFocus'] = moved === true ? 'moved' : 'stayed'
          if (moved === true || shown !== currentModel?.snapshotId) {
            if (camera.frame === undefined) camera = Object.freeze({ ...camera, frame })
            await render()
          }
        } catch (error) {
          if (scope.signal.aborted) return
          canvas.dataset['worldFocus'] = 'failed'
          canvas.dataset['worldFocusError'] = error instanceof Error ? error.message : String(error)
        } finally {
          focusing = false
        }
      }
      const focusSoon = () => {
        if ((lease.value as WorldSceneSource).focus === undefined) return
        if (focusTimer !== undefined) clearTimeout(focusTimer)
        focusTimer = setTimeout(() => {
          focusTimer = undefined
          void focusView()
        }, WORLD_FOCUS_SETTLE_MS)
      }
      scope.cleanup(() => {
        if (focusTimer !== undefined) clearTimeout(focusTimer)
      })
      const onCameraPointerUp = (event: PointerEvent) => {
        if (drag?.pointerId !== event.pointerId) return
        drag = undefined
        canvas.releasePointerCapture(event.pointerId)
        focusSoon()
      }
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        camera = zoomWorldWebGlCamera(camera, event.deltaY)
        redraw()
        focusSoon()
      }
      const onContextMenu = (event: Event) => event.preventDefault()
      const onKey = (event: KeyboardEvent) => {
        const delta =
          event.key === 'ArrowLeft'
            ? { x: -1, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: 1, y: 0 }
              : event.key === 'ArrowUp'
                ? { x: 0, y: 1 }
                : event.key === 'ArrowDown'
                  ? { x: 0, y: -1 }
                  : undefined
        if (delta === undefined) return
        event.preventDefault()
        edit = previewWorldObjectMove(edit, delta)
        redraw()
      }
      const onSave = () => {
        const route = currentModel?.info.edit
        void commitWorldObjectMove(edit, {
          descriptor,
          operations: args.operations,
          ...(args.commit === undefined ? {} : { coordinator: args.commit }),
          ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
          ...(route === undefined
            ? {}
            : { operationId: route.operationId, moveObjectKind: route.moveObjectKind }),
          signal: scope.signal,
        })
          .then(next => {
            edit = next
            redraw()
          })
          .catch(error => {
            edit = rejectWorldObjectMove(
              edit,
              error instanceof Error ? error.message : String(error),
              /stale|revision|conflict/iu.test(String(error)),
            )
            redraw()
          })
      }
      canvas.addEventListener('pointerdown', onPointer)
      latticeCanvas.addEventListener('pointerdown', onLatticePointer)
      canvas.addEventListener('pointerdown', onCameraPointerDown)
      canvas.addEventListener('pointermove', onCameraPointerMove)
      canvas.addEventListener('pointerup', onCameraPointerUp)
      canvas.addEventListener('pointercancel', onCameraPointerUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('contextmenu', onContextMenu)
      canvas.addEventListener('keydown', onKey)
      saveMove.addEventListener('click', onSave)
      scope.cleanup(() => {
        latticeButton.removeEventListener('click', onLattice)
        sceneButton.removeEventListener('click', onScene)
        webGlRenderer?.dispose()
        if (animationFrame !== undefined) view?.cancelAnimationFrame(animationFrame)
        canvas.removeEventListener('pointerdown', onPointer)
        latticeCanvas.removeEventListener('pointerdown', onLatticePointer)
        canvas.removeEventListener('pointerdown', onCameraPointerDown)
        canvas.removeEventListener('pointermove', onCameraPointerMove)
        canvas.removeEventListener('pointerup', onCameraPointerUp)
        canvas.removeEventListener('pointercancel', onCameraPointerUp)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('contextmenu', onContextMenu)
        canvas.removeEventListener('keydown', onKey)
        saveMove.removeEventListener('click', onSave)
      })

      // Return the mount immediately: closing/switching views must be able to cancel asset loading.
      void render()
        .then(async () => {
          // a world shown before its catalog answered: the answered world, read over the shown one.
          // The answers may take longer than one call may wait (a cold catalog takes minutes): a call
          // past its deadline asks again; a refinement that fails keeps the world shown.
          const source = lease.value as WorldSceneSource
          let refined: boolean | undefined
          while (source.refined !== undefined && refined === undefined && !scope.signal.aborted)
            refined = await source
              .refined(scope.signal)
              .catch((error: unknown) =>
                (error as { readonly code?: unknown } | null)?.code ===
                'x3.host/rpc-deadline-exceeded'
                  ? undefined
                  : false,
              )
          if (refined === true && !scope.signal.aborted) await render()
          if (transportLease === undefined || scope.signal.aborted) return
          await watchTransportedWorld(transportLease.value as TransportSource, render, scope.signal)
        })
        .catch(error => {
          if (scope.signal.aborted) return
          setState(stage, ['error'])
          canvas.hidden = true
          setViewerText(
            readout,
            localizer.text('viewer.worldError', {
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
        })

      return createViewerMount(root, scope, args, ({ descriptor: nextDescriptor }) => {
        const changed = nextDescriptor.revision !== edit.sourceRevision
        descriptor = nextDescriptor
        root.dataset['revision'] = nextDescriptor.revision
        if (changed) edit = confirmWorldObjectMove(edit, nextDescriptor.revision)
      })
    },
  })
}

export const worldViewer: ViewerModule = createWorldViewer()
