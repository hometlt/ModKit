/** Bounded, game-neutral inspection harness for publisher-qualified world candidates. */

import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneItem,
  WorldSceneLayerItem,
  WorldSceneObjectItem,
  WorldScenePage,
  WorldSceneSource,
  WorldSceneTerrainItem,
} from '@modkitx-x3/sdk/maps'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkitx-x3/sdk/maps'
import type { ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export const WORLD_VIEWER_MAX_LAYERS = 16
export const WORLD_VIEWER_MAX_ITEMS_PER_LAYER = 1_024

export interface CandidateWorldViewerOptions {
  readonly maxLayers: number
  readonly maxItemsPerLayer: number
  readonly signal?: AbortSignal
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
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

/**
 * Reads one bounded page per advertised layer and never branches on game, publisher or format.
 * The harness is structural and accepts both publisher-qualified and common candidate identities.
 */
export async function inspectCandidateWorld(
  source: CandidateWorldSceneSource,
  options: CandidateWorldViewerOptions,
): Promise<CandidateWorldViewerModel> {
  const maxLayers = positiveLimit(options.maxLayers, 'maxLayers')
  const maxItemsPerLayer = positiveLimit(options.maxItemsPerLayer, 'maxItemsPerLayer')
  options.signal?.throwIfAborted()
  const info = await source.info(options.signal)
  if (
    source.contract !== info.contract ||
    source.major !== info.major ||
    source.snapshotId !== info.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    throw new TypeError('world candidate identity changed between source and info')
  }
  const layerPage = await source.page({ facet: 'layers', limit: maxLayers }, options.signal)
  const layers = layerPage.items.filter(
    (item): item is WorldSceneLayerItem => item.facet === 'layers',
  )
  if (layers.length !== layerPage.items.length) {
    throw new TypeError('world layers page contains a non-layer item')
  }
  const inspected = await Promise.all(
    layers.map(async layer => {
      options.signal?.throwIfAborted()
      const lod = layer.lods.includes('sampled') ? 'sampled' : layer.lods[0]
      const page = await source.page(
        {
          facet: layer.kind,
          layerId: layer.layerId,
          ...(lod === undefined ? {} : { lod }),
          limit: maxItemsPerLayer,
        },
        options.signal,
      )
      return Object.freeze({ layer, page })
    }),
  )
  return Object.freeze({
    contract: source.contract,
    major: source.major,
    snapshotId: source.snapshotId,
    info,
    layers: Object.freeze(inspected),
    ...(layerPage.nextCursor === undefined ? {} : { nextLayerCursor: layerPage.nextCursor }),
  })
}

interface WorldPreviewPoint {
  readonly x: number
  readonly y: number
  readonly height: number
  readonly kind: 'terrain' | WorldSceneObjectItem['kind']
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

/** Draws a bounded, game-neutral top-down view without interpreting publisher-specific fields. */
export function drawCandidateWorld(
  canvas: HTMLCanvasElement,
  model: CandidateWorldViewerModel,
): void {
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
  if (points.length === 0) return
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
  const margin = 16
  const extentX = Math.max(1, maximumX - minimumX)
  const extentY = Math.max(1, maximumY - minimumY)
  const scale = Math.min((width - margin * 2) / extentX, (height - margin * 2) / extentY)
  const offsetX = (width - extentX * scale) / 2
  const offsetY = (height - extentY * scale) / 2
  const screen = (point: WorldPreviewPoint): readonly [number, number] => [
    offsetX + (point.x - minimumX) * scale,
    height - offsetY - (point.y - minimumY) * scale,
  ]
  const terrainSize = Math.max(1, Math.min(6, scale + 0.75))
  for (const point of terrain) {
    const [x, y] = screen(point)
    const normalized = (point.height - minimumHeight) / Math.max(1, maximumHeight - minimumHeight)
    const channel = Math.round(42 + normalized * 150)
    context.fillStyle = `rgb(${Math.round(channel * 0.72)} ${channel} ${Math.round(channel * 0.68)})`
    context.fillRect(x - terrainSize / 2, y - terrainSize / 2, terrainSize, terrainSize)
  }

  const colors: Readonly<Record<Exclude<WorldPreviewPoint['kind'], 'terrain'>, string>> = {
    unit: '#56b4e9',
    structure: '#e69f00',
    feature: '#7fc97f',
    doodad: '#cc79a7',
    point: '#f0e442',
    camera: '#d55e00',
  }
  for (const point of points) {
    if (point.kind === 'terrain') continue
    const [x, y] = screen(point)
    context.fillStyle = colors[point.kind]
    context.beginPath()
    context.arc(x, y, point.kind === 'structure' ? 4 : 3, 0, Math.PI * 2)
    context.fill()
  }
}

/** Common viewer for every world publisher that implements the shared candidate source contract. */
export const worldViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'World viewer')
    const stage = element(root, 'div', { part: 'model' })
    const readout = element(stage, 'output', { part: 'model.readout' })
    const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', 'Top-down world preview')

    const lease = await unknownSourceLease(args.sources, args.slot, WORLD_SCENE_SOURCE_CONTRACT)
    if (lease === undefined) throw new TypeError('world binding is unavailable')
    scope.lease(lease)

    setState(stage, ['loading'])
    try {
      const model = await inspectCandidateWorld(lease.value as WorldSceneSource, {
        maxLayers: WORLD_VIEWER_MAX_LAYERS,
        maxItemsPerLayer: WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
        signal: scope.signal,
      })
      const available = model.layers.filter(layer => layer.page.state === 'available')
      const itemCount = available.reduce((total, layer) => total + layer.page.items.length, 0)
      const partial =
        model.nextLayerCursor !== undefined ||
        model.layers.some(
          layer => layer.page.nextCursor !== undefined || layer.layer.state !== 'available',
        )
      setViewerText(
        readout,
        `${model.info.mapId} · ${available.length} layers · ${itemCount} items` +
          (partial ? ' · bounded preview' : ''),
      )
      drawCandidateWorld(canvas, model)
      if (itemCount === 0) {
        canvas.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: 'World metadata is available; no drawable terrain or objects were published.',
        })
      }
      setState(stage, [])
    } catch (error) {
      setState(stage, ['error'])
      canvas.remove()
      element(stage, 'p', {
        part: 'viewer.empty',
        text: `The world cannot be rendered: ${error instanceof Error ? error.message : String(error)}`,
      })
    }

    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})
