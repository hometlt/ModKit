/** Bounded, game-neutral inspection harness for publisher-qualified world candidates. */

import { diagnostic, type Diagnostic } from '@modkit/core'
import { createModelSceneSampler } from '@modkit/scene/model'
import {
  createWorldWebGlRenderer,
  DEFAULT_WORLD_WEBGL_CAMERA,
  drawWorldWebGl,
  orbitWorldWebGlCamera,
  panWorldWebGlCamera,
  pickWorldWebGl,
  zoomWorldWebGlCamera,
  type WorldWebGlCamera,
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

export const WORLD_VIEWER_MAX_LAYERS = 16
export const WORLD_VIEWER_MAX_ITEMS_PER_LAYER = 100_000
export const WORLD_VIEWER_MAX_PAGE_ITEMS = 1_024
export const WORLD_VIEWER_MAX_MODELS = 64
export const WORLD_VIEWER_MAX_MODEL_BYTES = 256 * 1024 * 1024
export const WORLD_VIEWER_MAX_BYTES_PER_MODEL = 16 * 1024 * 1024
export const WORLD_VIEWER_MAX_CONCURRENT_MODEL_ACQUISITIONS = 4
export const WORLD_VIEWER_MAX_TERRAIN_TEXTURES = 64

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
  readonly loadPerformance: CandidateWorldViewerLoadPerformance
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
      const lod = layer.lods.includes('sampled') ? 'sampled' : layer.lods[0]
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
  const resourceItems = inspected
    .flatMap(item => item.page.items)
    .filter(
      (item): item is WorldSceneResourceItem =>
        item.facet === 'resources' && item.modelResource !== undefined,
    )
    .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index)
    .sort(
      (left, right) =>
        right.objectIds.length - left.objectIds.length || left.id.localeCompare(right.id),
    )
  const models = new Map<string, WorldSceneModelResult>()
  const requestedResources =
    options.modelResourceFilter === undefined
      ? resourceItems
      : resourceItems.filter(item => options.modelResourceFilter!(item.id))
  const admittedResources = requestedResources.slice(0, maxModels)
  const perModelBytes = Math.max(
    1,
    Math.min(
      WORLD_VIEWER_MAX_BYTES_PER_MODEL,
      Math.floor(maxModelBytes / Math.max(1, admittedResources.length)),
    ),
  )
  const maxTextureTotalBytes = Math.max(
    1,
    Math.min(32 * 1024 * 1024, Math.floor(perModelBytes / 2)),
  )
  const maxTextureBytes = Math.max(
    1,
    Math.min(16 * 1024 * 1024, Math.floor(perModelBytes / 2), maxTextureTotalBytes),
  )
  const modelRequestKey = JSON.stringify({
    maxModels,
    maxModelBytes,
    maxConcurrentModelAcquisitions,
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
  for (const item of [
    ...requestedResources.slice(maxModels),
    ...resourceItems.filter(item => !requestedResources.includes(item)),
  ]) {
    models.set(
      item.id,
      Object.freeze({
        state: 'unresolved' as const,
        diagnostics: Object.freeze([
          diagnostic(
            'warning',
            'x3.ui/world-model-budget-exhausted',
            `World preview model limit ${String(maxModels)} omitted resource ${item.id}.`,
          ),
        ]),
      }),
    )
  }
  let modelRequests = 0
  let reusedModels = 0
  const modelAcquisitionStartedAt = inspectionClock()
  if (source.model !== undefined) {
    await forEachConcurrent(admittedResources, maxConcurrentModelAcquisitions, async item => {
      const previous = options.previous?.models?.get(item.id)
      if (
        options.previous?.snapshotId === identity.snapshotId &&
        options.previous.modelRequestKey === modelRequestKey &&
        previous?.state === 'converted'
      ) {
        reusedModels += 1
        models.set(item.id, previous)
        return
      }
      modelRequests += 1
      const result = await source.model!(
        item.id,
        {
          maxBytes: perModelBytes,
          maxNodes: Math.min(1_024, maxItemsPerLayer),
          maxMeshes: Math.min(256, maxItemsPerLayer),
          maxPrimitives: Math.min(512, maxItemsPerLayer),
          maxPrimitiveBytes: Math.min(16 * 1024 * 1024, perModelBytes),
          maxResources: Math.min(64, maxItemsPerLayer),
          maxTextureBytes,
          maxTextureTotalBytes,
        },
        options.signal,
      )
      models.set(item.id, result)
    })
  }
  const modelAcquisitionMilliseconds = elapsedInspectionMilliseconds(modelAcquisitionStartedAt)
  const terrainTextures = new Map<string, SceneRendererTexture>()
  const terrainTextureDiagnostics: Diagnostic[] = []
  const terrainTextureIds = [
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
          ].filter((resourceId): resourceId is string => resourceId !== undefined),
        ),
        ...(layer.weightRasters ?? []).map(raster => raster.resourceId),
      ]),
    ),
  ].slice(0, WORLD_VIEWER_MAX_TERRAIN_TEXTURES)
  let terrainTextureRequests = 0
  let reusedTerrainTextures = 0
  const terrainTextureAcquisitionStartedAt = inspectionClock()
  if (source.texture !== undefined) {
    const perTextureBytes = Math.max(
      1,
      Math.min(16 * 1024 * 1024, Math.floor(maxModelBytes / Math.max(1, terrainTextureIds.length))),
    )
    await forEachConcurrent(terrainTextureIds, maxConcurrentModelAcquisitions, async resourceId => {
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
      const result = await source.texture!(resourceId, { maxBytes: requestedBytes }, options.signal)
      terrainTextureDiagnostics.push(...result.diagnostics)
      if (result.state === 'decoded') terrainTextures.set(resourceId, result.texture)
    })
  }
  const terrainTextureAcquisitionMilliseconds = elapsedInspectionMilliseconds(
    terrainTextureAcquisitionStartedAt,
  )
  return Object.freeze({
    contract: identity.contract,
    major: identity.major,
    snapshotId: identity.snapshotId,
    info,
    layers: Object.freeze(inspected.map(({ layer, page }) => Object.freeze({ layer, page }))),
    reusedLayerKinds: Object.freeze(
      inspected.filter(item => item.reused).map(item => item.layer.kind),
    ),
    models,
    terrainTextures,
    terrainTextureDiagnostics: Object.freeze(terrainTextureDiagnostics),
    modelRequestKey,
    loadPerformance: Object.freeze({
      coldStart: options.previous === undefined,
      infoMilliseconds,
      layerCatalogMilliseconds,
      layerAcquisitionMilliseconds,
      modelAcquisitionMilliseconds,
      terrainTextureAcquisitionMilliseconds,
      totalMilliseconds: elapsedInspectionMilliseconds(inspectionStartedAt),
      layerPageRequests,
      reusedLayers: inspected.filter(item => item.reused).length,
      modelRequests,
      reusedModels,
      terrainTextureRequests,
      reusedTerrainTextures,
    }),
    ...(layerPage.nextCursor === undefined ? {} : { nextLayerCursor: layerPage.nextCursor }),
  })
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
}

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

/** Draws a bounded game-neutral isometric scene from common terrain/world facets. */
export function drawCandidateWorld(
  canvas: HTMLCanvasElement,
  model: CandidateWorldViewerModel,
  selection?: number | WorldEditState,
  camera?: WorldWebGlCamera,
  animationTimes?: ReadonlyMap<number, number>,
  timeSeconds = 0,
  renderer?: WorldWebGlRenderer,
): WorldRenderStats {
  const worldItems = model.layers.flatMap(layer => layer.page.items)
  const selectedObjectId = typeof selection === 'number' ? selection : selection?.selectedObjectId
  const webGlInput = {
    items: worldItems,
    ...(model.models === undefined ? {} : { models: model.models }),
    terrainMaterials: model.layers.flatMap(layer => layer.layer.materials ?? []),
    waterMaterials: model.layers.flatMap(layer => layer.layer.waterMaterials ?? []),
    terrainWeightRasters: model.layers.flatMap(layer => layer.layer.weightRasters ?? []),
    ...(model.terrainTextures === undefined ? {} : { terrainTextures: model.terrainTextures }),
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
  if (webGlStats !== undefined) return webGlStats
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

  const colors: Readonly<Record<Exclude<WorldPreviewPoint['kind'], 'terrain'>, string>> = {
    unit: '#56b4e9',
    structure: '#e69f00',
    feature: '#7fc97f',
    doodad: '#cc79a7',
    point: '#f0e442',
    camera: '#d55e00',
  }
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
      const stage = element(root, 'div', { part: 'model' })
      const readout = element(stage, 'output', { part: 'model.readout' })
      const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
      canvas.width = 720
      canvas.height = 480
      const editStatus = element(stage, 'output', { part: 'model.readout' })
      const saveMove = element(stage, 'button', { text: 'Save selected move' }) as HTMLButtonElement
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', localizer.text('viewer.worldPreview'))
      canvas.tabIndex = 0

      const [lease, transportLease] = await Promise.all([
        unknownSourceLease(args.sources, args.slot, WORLD_SCENE_SOURCE_CONTRACT),
        unknownSourceLease(args.sources, args.slot, 'common.view/transport-source'),
      ])
      if (lease === undefined) {
        await transportLease?.release()
        throw new TypeError('world binding is unavailable')
      }
      scope.lease(lease)
      if (transportLease !== undefined) scope.lease(transportLease)
      let renderRevision = 0
      let descriptor = args.descriptor
      let currentModel: CandidateWorldViewerModel | undefined
      let edit = createWorldEditState(descriptor.revision)
      let camera = DEFAULT_WORLD_WEBGL_CAMERA
      const animationEpochs = new Map<number, number>()
      const view = canvas.ownerDocument.defaultView
      const webGlRenderer = createWorldWebGlRenderer(canvas)
      const worldEpoch = (view?.performance.now() ?? Date.now()) / 1000
      let animationFrame: number | undefined
      const currentWorldTime = () => (view?.performance.now() ?? Date.now()) / 1000 - worldEpoch
      const hasAnimatedWater = () =>
        currentModel?.layers.some(layer =>
          layer.layer.waterMaterials?.some(material =>
            material.scroll?.some(component => component !== 0),
          ),
        ) === true
      const currentAnimationTimes = () => {
        const times = new Map<number, number>()
        if (currentModel === undefined) return times
        const now = (view?.performance.now() ?? Date.now()) / 1000
        const liveObjects = new Set<number>()
        for (const item of currentModel.layers
          .flatMap(layer => layer.page.items)
          .filter(
            (candidate): candidate is WorldSceneObjectItem => candidate.facet === 'objects',
          )) {
          liveObjects.add(item.objectId)
          const result =
            item.resourceId === undefined ? undefined : currentModel.models?.get(item.resourceId)
          if (
            result?.state !== 'converted' ||
            !(result.animations?.some(clip => clip.kind === 'animation' && clip.channels.length > 0) ||
              (item.presentationAnimation !== undefined && (result.animations?.length ?? 0) > 0))
          )
            continue
          const epoch = animationEpochs.get(item.objectId) ?? now
          animationEpochs.set(item.objectId, epoch)
          times.set(item.objectId, now - epoch)
        }
        for (const objectId of animationEpochs.keys())
          if (!liveObjects.has(objectId)) animationEpochs.delete(objectId)
        return times
      }
      const redraw = () => {
        if (currentModel !== undefined)
          drawCandidateWorld(
            canvas,
            currentModel,
            edit,
            camera,
            currentAnimationTimes(),
            currentWorldTime(),
            webGlRenderer,
          )
        setViewerText(editStatus, edit.message ?? (edit.status === 'preview' ? 'Move preview' : ''))
        saveMove.disabled = edit.status !== 'preview'
      }
      const syncAnimationLoop = () => {
        const requestFrame = view?.requestAnimationFrame.bind(view)
        const cancelFrame = view?.cancelAnimationFrame.bind(view)
        if (
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
        setState(stage, ['loading'])
        let model: CandidateWorldViewerModel
        try {
          model = await inspectCandidateWorld(lease.value as WorldSceneSource, {
            maxLayers: WORLD_VIEWER_MAX_LAYERS,
            maxItemsPerLayer: WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
            maxPageItems: WORLD_VIEWER_MAX_PAGE_ITEMS,
            signal: scope.signal,
            ...(currentModel === undefined ? {} : { previous: currentModel }),
          })
        } catch (error) {
          if (revision !== renderRevision || scope.signal.aborted) return
          setState(stage, ['error'])
          canvas.hidden = true
          setViewerText(
            readout,
            localizer.text('viewer.worldError', {
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
          return
        }
        if (revision !== renderRevision || scope.signal.aborted) return
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
        const partial =
          model.nextLayerCursor !== undefined ||
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
          }),
        )
        canvas.hidden = itemCount === 0
        if (itemCount > 0) redraw()
        if (itemCount === 0) {
          setViewerText(readout, localizer.text('viewer.worldEmpty'))
        }
        setState(stage, [])
        syncAnimationLoop()
      }

      const onPointer = (event: PointerEvent) => {
        if (event.button !== 0 || event.altKey) return
        if (currentModel === undefined) return
        const objects = currentModel.layers
          .flatMap(layer => layer.page.items)
          .filter((item): item is WorldSceneObjectItem => item.facet === 'objects')
        if (objects.length === 0) return
        const rect = canvas.getBoundingClientRect()
        const worldItems = currentModel.layers.flatMap(layer => layer.page.items)
        const hit = pickWorldWebGl(
          {
            items: worldItems,
            ...(currentModel.models === undefined ? {} : { models: currentModel.models }),
            camera,
            animationTimes: currentAnimationTimes(),
          },
          {
            x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
            y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
            width: canvas.width,
            height: canvas.height,
          },
        )
        edit = selectWorldObject(
          edit,
          hit?.kind === 'object' ? objects.find(item => item.objectId === hit.objectId) : undefined,
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
      const onCameraPointerUp = (event: PointerEvent) => {
        if (drag?.pointerId !== event.pointerId) return
        drag = undefined
        canvas.releasePointerCapture(event.pointerId)
      }
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        camera = zoomWorldWebGlCamera(camera, event.deltaY)
        redraw()
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
      canvas.addEventListener('pointerdown', onCameraPointerDown)
      canvas.addEventListener('pointermove', onCameraPointerMove)
      canvas.addEventListener('pointerup', onCameraPointerUp)
      canvas.addEventListener('pointercancel', onCameraPointerUp)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('contextmenu', onContextMenu)
      canvas.addEventListener('keydown', onKey)
      saveMove.addEventListener('click', onSave)
      scope.cleanup(() => {
        webGlRenderer?.dispose()
        if (animationFrame !== undefined) view?.cancelAnimationFrame(animationFrame)
        canvas.removeEventListener('pointerdown', onPointer)
        canvas.removeEventListener('pointerdown', onCameraPointerDown)
        canvas.removeEventListener('pointermove', onCameraPointerMove)
        canvas.removeEventListener('pointerup', onCameraPointerUp)
        canvas.removeEventListener('pointercancel', onCameraPointerUp)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('contextmenu', onContextMenu)
        canvas.removeEventListener('keydown', onKey)
        saveMove.removeEventListener('click', onSave)
      })

      await render()
      if (transportLease !== undefined) {
        void watchTransportedWorld(
          transportLease.value as TransportSource,
          render,
          scope.signal,
        ).catch(error => {
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
      }

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
