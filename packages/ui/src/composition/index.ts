/** Shared visual-only world/model composition pipeline for browser, desktop and headless hosts. */

import {
  isMixedVisualPresentationSlot,
  type Lease,
  type MixedVisualCompositionDocument,
  type MixedVisualOverlayPlacement,
  type ModelPrimitive,
  type ModelSceneSource,
  type PresentationSlot,
  type ViewerModule,
  type ViewerSources,
  type VisualTransformReceipt,
} from '@modkitx-x3/sdk'
import type {
  MapPosition,
  MapWorldCanonicalTransform,
  WorldSceneItem,
  WorldSceneObjectItem,
  WorldSceneSource,
  WorldSceneTerrainItem,
} from '@modkitx-x3/sdk/maps'
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
import { inspectCandidateWorld, type CandidateWorldViewerModel } from '../world/index.js'
import { loadModelStage, type ModelStageModel } from '../model/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { COMPOSITION_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface MixedVisualOverlaySnapshot {
  readonly placement: MixedVisualOverlayPlacement
  readonly primitive: ModelPrimitive
}

export interface MixedVisualStageSnapshot {
  readonly workspace: MixedVisualCompositionDocument
  readonly world: CandidateWorldViewerModel
  readonly model: ModelStageModel
  readonly overlays: readonly MixedVisualOverlaySnapshot[]
}

export interface MixedVisualLoadScope {
  lease<T>(lease: Lease<T>): Lease<T>
}

const WORLD_MAX_LAYERS = 16
const WORLD_MAX_ITEMS_PER_LAYER = 1_024

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sourceCoordinate(position: readonly number[], axis: 'x' | 'y' | 'z'): number {
  return position[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] as number
}

function transformCoordinate(
  position: readonly number[],
  receipt: VisualTransformReceipt,
  targetAxis: 'x' | 'y' | 'z',
): number {
  const targetIndex = targetAxis === 'x' ? 0 : targetAxis === 'y' ? 1 : 2
  const mapping = receipt.axes[targetAxis]
  const sourceIndex = mapping.sourceAxis === 'x' ? 0 : mapping.sourceAxis === 'y' ? 1 : 2
  const sourceValue = sourceCoordinate(position, mapping.sourceAxis)
  return (
    (receipt.target.origin[targetIndex] as number) +
    (receipt.translation[targetIndex] as number) +
    (sourceValue - (receipt.source.origin[sourceIndex] as number)) *
      mapping.direction *
      (receipt.scale[targetIndex] as number)
  )
}

/** Applies only the transform recorded on the overlay; no basis or unit is inferred. */
export function transformVisualPrimitive(
  primitive: ModelPrimitive,
  receipt: VisualTransformReceipt,
): ModelPrimitive {
  if (primitive.positions.length % 3 !== 0 || !primitive.positions.every(Number.isFinite)) {
    throw new TypeError('mixed visual primitive positions are malformed')
  }
  const positions = new Float32Array(primitive.positions.length)
  for (let index = 0; index < primitive.positions.length; index += 3) {
    const position = [
      primitive.positions[index] as number,
      primitive.positions[index + 1] as number,
      primitive.positions[index + 2] as number,
    ] as const
    const transformed = [
      transformCoordinate(position, receipt, 'x'),
      transformCoordinate(position, receipt, 'y'),
      transformCoordinate(position, receipt, 'z'),
    ] as const
    const rounded = transformed.map(value => Math.fround(value))
    if (rounded.some(value => !Number.isFinite(value))) {
      throw new RangeError('mixed visual transform exceeds finite float32 geometry')
    }
    positions[index] = rounded[0] as number
    positions[index + 1] = rounded[1] as number
    positions[index + 2] = rounded[2] as number
  }
  const normals =
    primitive.normals === undefined
      ? undefined
      : (() => {
          if (
            primitive.normals.length !== primitive.positions.length ||
            !primitive.normals.every(Number.isFinite)
          ) {
            throw new TypeError('mixed visual primitive normals are malformed')
          }
          const transformed = new Float32Array(primitive.normals.length)
          for (let index = 0; index < primitive.normals.length; index += 3) {
            const normal = [
              primitive.normals[index] as number,
              primitive.normals[index + 1] as number,
              primitive.normals[index + 2] as number,
            ] as const
            const component = (targetAxis: 'x' | 'y' | 'z'): number => {
              const targetIndex = targetAxis === 'x' ? 0 : targetAxis === 'y' ? 1 : 2
              const mapping = receipt.axes[targetAxis]
              return (
                (sourceCoordinate(normal, mapping.sourceAxis) * mapping.direction) /
                (receipt.scale[targetIndex] as number)
              )
            }
            const candidate = [component('x'), component('y'), component('z')] as const
            const magnitude = Math.hypot(...candidate)
            if (!Number.isFinite(magnitude) || magnitude === 0) {
              throw new TypeError('mixed visual primitive contains a zero or non-finite normal')
            }
            transformed[index] = candidate[0] / magnitude
            transformed[index + 1] = candidate[1] / magnitude
            transformed[index + 2] = candidate[2] / magnitude
          }
          return transformed
        })()
  let bounds: ModelPrimitive['bounds']
  if (positions.length > 0) {
    const minimum = [Infinity, Infinity, Infinity]
    const maximum = [-Infinity, -Infinity, -Infinity]
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis] as number, positions[index + axis] as number)
        maximum[axis] = Math.max(maximum[axis] as number, positions[index + axis] as number)
      }
    }
    bounds = {
      min: minimum as [number, number, number],
      max: maximum as [number, number, number],
    }
  }
  return Object.freeze({
    id: primitive.id,
    topology: primitive.topology,
    positions,
    ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
    ...(normals === undefined ? {} : { normals }),
    ...(primitive.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: primitive.textureCoordinates }),
    ...(primitive.materialId === undefined ? {} : { materialId: primitive.materialId }),
    ...(bounds === undefined ? {} : { bounds }),
  })
}

function verifyWorldFrame(
  workspace: MixedVisualCompositionDocument,
  transform: MapWorldCanonicalTransform | undefined,
): void {
  if (transform === undefined) {
    throw new TypeError('mixed visual workspace requires a validated map-to-UVW transform')
  }
  if (
    workspace.worldFrame.coordinateSpaceId !== transform.targetCoordinateSpaceId ||
    !sameJson(workspace.worldFrame.basis, transform.basis) ||
    !sameJson(workspace.worldFrame.origin, transform.heightfield.origin)
  ) {
    throw new TypeError('mixed visual world frame does not match the selected world source')
  }
}

/**
 * Opens exactly the two contracts named by the dynamic PresentationPlan and builds one render
 * snapshot. The loader has no publisher, game or format routing data.
 */
export async function loadMixedVisualStage(
  sources: ViewerSources,
  slot: PresentationSlot,
  scope: MixedVisualLoadScope,
  signal?: AbortSignal,
): Promise<MixedVisualStageSnapshot> {
  if (!isMixedVisualPresentationSlot(slot)) {
    throw new TypeError('mixed visual presentation slot is invalid')
  }
  const [worldLease, modelLease] = await Promise.all([
    unknownSourceLease(sources, slot, 'common.view/world-scene-source'),
    unknownSourceLease(sources, slot, 'common.view/model-scene-source'),
  ])
  if (worldLease === undefined || modelLease === undefined) {
    worldLease?.release()
    modelLease?.release()
    throw new TypeError('mixed visual world/model bindings are unavailable')
  }
  const worldSource = worldLease.value as WorldSceneSource
  if (worldSource.contract !== 'common.view/world-scene-source' || worldSource.major !== 1) {
    await Promise.all([worldLease.release(), modelLease.release()])
    throw new TypeError('mixed visual world binding did not return the shared world source')
  }
  scope.lease(worldLease)
  scope.lease(modelLease)
  const [world, model] = await Promise.all([
    inspectCandidateWorld(worldSource, {
      maxLayers: WORLD_MAX_LAYERS,
      maxItemsPerLayer: WORLD_MAX_ITEMS_PER_LAYER,
      ...(signal === undefined ? {} : { signal }),
    }),
    loadModelStage(modelLease.value as ModelSceneSource, signal),
  ])
  verifyWorldFrame(slot.composition, world.info.uvwTransform)
  const overlays =
    model.primitive === undefined
      ? []
      : slot.composition.overlayPlacements.map(placement =>
          Object.freeze({
            placement,
            primitive: transformVisualPrimitive(
              model.primitive as ModelPrimitive,
              placement.transform,
            ),
          }),
        )
  return Object.freeze({
    workspace: slot.composition,
    world,
    model,
    overlays: Object.freeze(overlays),
  })
}

interface VisualPoint {
  readonly x: number
  readonly z: number
  readonly height: number
  readonly kind: 'terrain' | WorldSceneObjectItem['kind']
}

function canonicalPosition(
  position: MapPosition,
  transform: MapWorldCanonicalTransform,
): MapPosition {
  const coordinate = (axis: 'x' | 'y' | 'z'): number => {
    const rule = transform.axes[axis]
    return position[rule.sourceAxis] * rule.scale + rule.offset
  }
  return { x: coordinate('x'), y: coordinate('y'), z: coordinate('z') }
}

function worldPoint(
  item: WorldSceneItem,
  transform: MapWorldCanonicalTransform,
): VisualPoint | undefined {
  if (item.facet === 'terrain') {
    const terrain = item as WorldSceneTerrainItem
    if (terrain.uvwPosition === undefined) return undefined
    return {
      x: terrain.uvwPosition.x,
      z: terrain.uvwPosition.z,
      height: terrain.uvwPosition.y,
      kind: 'terrain',
    }
  }
  if (item.facet !== 'objects') return undefined
  const object = item as WorldSceneObjectItem
  const position = canonicalPosition(object.position, transform)
  return { x: position.x, z: position.z, height: position.y, kind: object.kind }
}

function primitiveEdges(primitive: ModelPrimitive): readonly (readonly [number, number])[] {
  const vertexCount = primitive.positions.length / 3
  const indices =
    primitive.indices ?? Uint32Array.from({ length: vertexCount }, (_, index) => index)
  if (indices.some(index => index >= vertexCount)) {
    throw new RangeError('mixed visual primitive index is outside the position buffer')
  }
  const edges: [number, number][] = []
  const triangle = (a: number, b: number, c: number): void => {
    edges.push([a, b], [b, c], [c, a])
  }
  if (primitive.topology === 'points') return []
  if (primitive.topology === 'lines') {
    for (let index = 0; index + 1 < indices.length; index += 2) {
      edges.push([indices[index] as number, indices[index + 1] as number])
    }
  } else if (primitive.topology === 'line-strip') {
    for (let index = 0; index + 1 < indices.length; index += 1) {
      edges.push([indices[index] as number, indices[index + 1] as number])
    }
  } else if (primitive.topology === 'triangles') {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      triangle(indices[index] as number, indices[index + 1] as number, indices[index + 2] as number)
    }
  } else if (primitive.topology === 'triangle-strip') {
    for (let index = 0; index + 2 < indices.length; index += 1) {
      triangle(indices[index] as number, indices[index + 1] as number, indices[index + 2] as number)
    }
  } else {
    for (let index = 1; index + 1 < indices.length; index += 1) {
      triangle(indices[0] as number, indices[index] as number, indices[index + 1] as number)
    }
  }
  return edges
}

/** Draws the canonical world and transformed overlays together; the result stays visual-only. */
export function drawMixedVisualWorkspace(
  canvas: HTMLCanvasElement,
  snapshot: MixedVisualStageSnapshot,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  const transform = snapshot.world.info.uvwTransform
  if (transform === undefined) throw new TypeError('mixed visual world transform is unavailable')
  const world = snapshot.world.layers.flatMap(layer =>
    layer.page.items.flatMap(item => {
      const point = worldPoint(item, transform)
      return point === undefined ? [] : [point]
    }),
  )
  const overlayPoints = snapshot.overlays.flatMap(overlay => {
    const points: VisualPoint[] = []
    for (let index = 0; index < overlay.primitive.positions.length; index += 3) {
      points.push({
        x: overlay.primitive.positions[index] as number,
        height: overlay.primitive.positions[index + 1] as number,
        z: overlay.primitive.positions[index + 2] as number,
        kind: 'feature',
      })
    }
    return points
  })
  const points = [...world, ...overlayPoints]
  const width = 720
  const height = 480
  canvas.width = width
  canvas.height = height
  context.clearRect(0, 0, width, height)
  if (points.length === 0) return
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
    throw new TypeError('mixed visual snapshot contains a non-finite coordinate')
  }
  const minimumX = Math.min(...points.map(point => point.x))
  const maximumX = Math.max(...points.map(point => point.x))
  const minimumZ = Math.min(...points.map(point => point.z))
  const maximumZ = Math.max(...points.map(point => point.z))
  const extentX = Math.max(1, maximumX - minimumX)
  const extentZ = Math.max(1, maximumZ - minimumZ)
  const margin = 16
  const scale = Math.min((width - margin * 2) / extentX, (height - margin * 2) / extentZ)
  const screen = (x: number, z: number): readonly [number, number] => [
    (width - extentX * scale) / 2 + (x - minimumX) * scale,
    height - ((height - extentZ * scale) / 2 + (z - minimumZ) * scale),
  ]
  const terrain = world.filter(point => point.kind === 'terrain')
  const minimumHeight = terrain.length === 0 ? 0 : Math.min(...terrain.map(point => point.height))
  const maximumHeight = terrain.length === 0 ? 1 : Math.max(...terrain.map(point => point.height))
  for (const point of terrain) {
    const [x, y] = screen(point.x, point.z)
    const normalized = (point.height - minimumHeight) / Math.max(1, maximumHeight - minimumHeight)
    const channel = Math.round(42 + normalized * 150)
    context.fillStyle = `rgb(${Math.round(channel * 0.72)} ${channel} ${Math.round(channel * 0.68)})`
    context.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
  for (const point of world) {
    if (point.kind === 'terrain') continue
    const [x, y] = screen(point.x, point.z)
    context.fillStyle = '#f0e442'
    context.beginPath()
    context.arc(x, y, point.kind === 'structure' ? 4 : 3, 0, Math.PI * 2)
    context.fill()
  }
  context.strokeStyle = '#4daafc'
  context.lineWidth = 1.5
  for (const overlay of snapshot.overlays) {
    const position = overlay.primitive.positions
    for (const [from, to] of primitiveEdges(overlay.primitive)) {
      const a = screen(position[from * 3] as number, position[from * 3 + 2] as number)
      const b = screen(position[to * 3] as number, position[to * 3 + 2] as number)
      context.beginPath()
      context.moveTo(a[0], a[1])
      context.lineTo(b[0], b[1])
      context.stroke()
    }
  }
}

export interface MixedVisualViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createMixedVisualViewer(options: MixedVisualViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, COMPOSITION_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.mixedWorkspace'))
      const stage = element(root, 'div', { part: 'model' })
      const readout = element(stage, 'output', { part: 'model.readout' })
      const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', localizer.text('viewer.composition'))
      setState(stage, ['loading'])
      try {
        const snapshot = await loadMixedVisualStage(args.sources, args.slot, scope, scope.signal)
        drawMixedVisualWorkspace(canvas, snapshot)
        setViewerText(
          readout,
          localizer.text('viewer.compositionSummary', {
            overlays: snapshot.workspace.overlayPlacements.length,
            resources: snapshot.workspace.resources.length,
          }),
        )
        setState(stage, [])
      } catch (error) {
        setState(stage, ['error'])
        canvas.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.compositionError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        })
      }
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const mixedVisualViewer: ViewerModule = createMixedVisualViewer()
