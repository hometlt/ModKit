/** Core-owned standalone UVW world source: paged geometry, authored tile order/atlas/coverage,
 * weights, UVs and package resources; no game installation or publisher dependency. */
import { diagnostic } from '@modkit/core'
import type { RasterResourcePort, RasterResourceResult, SceneRendererTexture } from '@modkit/sdk'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkit/sdk/maps'
import type {
  WorldSceneInfo,
  WorldSceneItem,
  WorldSceneLayerItem,
  WorldScenePage,
  WorldScenePageRequest,
  WorldSceneModelRequest,
  WorldSceneModelResult,
  WorldSceneSource,
  WorldSceneTerrainItem,
  WorldSceneTextureRequest,
} from '@modkit/sdk/maps'

import {
  canonicalizeUvwProfile,
  type UvwHeightfieldLayer,
  type UvwHeightfieldSpace,
  type UvwHeightfieldSpaceLayer,
  type UvwParseLimits,
  type UvwProfileDocument,
} from './index.js'

export interface UvwWorldSceneSourceOptions {
  readonly snapshotId: string
  readonly mapId?: string
  readonly maxPageSize?: number
  /** Package-owned bytes keyed by canonical world resource id; no ambient URI access is allowed. */
  readonly embeddedResources?: ReadonlyMap<
    string,
    Readonly<{ readonly bytes: Uint8Array; readonly mediaType?: string }>
  >
  /** Host-owned decoder used only for explicitly supplied UVW package resources. */
  readonly rasterResources?: RasterResourcePort
  /** Game-neutral UVM decoder supplied by the scene layer. The UVW package owns every byte and
   * passes a confined URI table; the decoder receives no ambient filesystem authority. */
  readonly modelDecoder?: UvwEmbeddedModelDecoder
  /** The limits the document was parsed under; the defaults refuse a large terrain's weights. */
  readonly limits?: UvwParseLimits
}

export interface UvwEmbeddedModelInput {
  readonly resourceId: string
  readonly uri: string
  readonly digest?: `sha256:${string}`
  readonly bytes: Uint8Array
  readonly mediaByUri: ReadonlyMap<
    string,
    Readonly<{ readonly bytes: Uint8Array; readonly mediaType?: string }>
  >
}

export type UvwEmbeddedModelDecoder = (
  input: UvwEmbeddedModelInput,
  request: WorldSceneModelRequest,
  signal?: AbortSignal,
) => Promise<WorldSceneModelResult>

interface LayerRecord {
  readonly id: string
  readonly coordinateSpaceId: string
  readonly space: UvwHeightfieldSpace
  readonly layer: UvwHeightfieldSpaceLayer
  readonly itemCount: number
  readonly contentRevision: string
  readonly cliffCells?: ReadonlySet<number>
}

function positiveLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`UVW world page limit must be between 1 and ${String(maximum)}`)
  }
  return value
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function worldTexture(
  id: string,
  result: Extract<RasterResourceResult, { readonly state: 'decoded' }>,
): SceneRendererTexture | undefined {
  if (result.info.orientation === 'unknown') return undefined
  const rowBytes = result.region.width * 4
  const rgba = new Uint8Array(rowBytes * result.region.height)
  for (let y = 0; y < result.region.height; y += 1) {
    const sourceY = result.info.orientation === 'bottom-left' ? result.region.height - 1 - y : y
    rgba.set(
      result.region.pixels.subarray(
        sourceY * result.region.rowStride,
        sourceY * result.region.rowStride + rowBytes,
      ),
      y * rowBytes,
    )
  }
  return Object.freeze({
    id,
    width: result.region.width,
    height: result.region.height,
    rgba,
    wrapU: 'repeat',
    wrapV: 'repeat',
  })
}

function contentRevision(layer: UvwHeightfieldSpaceLayer): string {
  return `fnv1a32:${fnv1a(JSON.stringify(layer))}:${String(layerItemCount(layer))}`
}

function sameNumber(left: number, right: number | undefined): boolean {
  return right !== undefined && Object.is(left === 0 ? 0 : left, right === 0 ? 0 : right)
}

function presentSamples(layer: UvwHeightfieldLayer): number {
  let count = 0
  for (const row of layer.samples) {
    for (const sample of row) if (!sameNumber(sample, layer.noDataValue)) count += 1
  }
  return count
}

function layerItemCount(layer: UvwHeightfieldSpaceLayer): number {
  switch (layer.kind) {
    case 'heightfield':
      return presentSamples(layer)
    case 'terrain-materials':
      return layer.samples === undefined ? 0 : layer.columns * layer.rows
    case 'cliffs':
      return layer.columns * layer.rows
    case 'water':
      return layer.zones.length
    case 'objects':
      return layer.instances.length
    case 'resources':
      return layer.resources.length
    case 'regions':
      return layer.regions.length
    case 'navigation':
      return layer.columns * layer.rows
    case 'gateways':
      return layer.segments.length
    case 'lighting':
      return 1
  }
}

function worldFacet(layer: UvwHeightfieldSpaceLayer): Exclude<WorldSceneLayerItem['kind'], never> {
  return layer.kind === 'heightfield' ? 'terrain' : layer.kind
}

function worldResourceId(spaceId: string, resourceId: string): string {
  return `uvw-resource:${encodeURIComponent(spaceId)}/${encodeURIComponent(resourceId)}`
}

function gridPosition(
  origin: readonly [number, number, number],
  cellSize: number,
  x: number,
  y: number,
): Readonly<{ x: number; y: number; z: number }> {
  return Object.freeze({ x: origin[0] + x * cellSize, y: origin[1], z: origin[2] + y * cellSize })
}

function inBounds(
  position: Readonly<{ x: number; z: number }>,
  bounds: WorldScenePageRequest['bounds'],
): boolean {
  return (
    bounds === undefined ||
    (position.x >= bounds.minimumX &&
      position.x <= bounds.maximumX &&
      position.z >= bounds.minimumY &&
      position.z <= bounds.maximumY)
  )
}

function recordItems(
  record: LayerRecord,
  bounds: WorldScenePageRequest['bounds'],
): readonly WorldSceneItem[] {
  const { layer, coordinateSpaceId } = record
  switch (layer.kind) {
    case 'terrain-materials': {
      const materialIndex = new Map(layer.materials.map((material, index) => [material.id, index]))
      return Object.freeze(
        (layer.samples ?? []).flatMap((row, y) =>
          row.flatMap((sample, x) => {
            const uvwPosition = gridPosition(layer.origin, layer.cellSize, x, y)
            if (!inBounds(uvwPosition, bounds)) return []
            const weights = sample.weights
            const dominant = [...(weights ?? [])].sort(
              (left, right) =>
                right.weight - left.weight || left.materialId.localeCompare(right.materialId),
            )[0]
            const materialId = sample.layers?.[0]?.materialId ?? dominant!.materialId
            const material = layer.materials[materialIndex.get(materialId) ?? 0]!
            return [
              Object.freeze({
                facet: 'terrain-materials' as const,
                id: `${record.id}:${String(x)}:${String(y)}`,
                layerId: record.id,
                coordinateSpaceId: 'height-grid' as const,
                lod: 'exact' as const,
                x,
                y,
                textureIndex: material.sourceIndex ?? materialIndex.get(material.id) ?? 0,
                textureName: material.label ?? material.id,
                ...(weights === undefined
                  ? {}
                  : {
                      weights: Object.freeze(weights.map(weight => Object.freeze({ ...weight }))),
                    }),
                ...(sample.layers === undefined ? {} : { layers: sample.layers }),
                ...(sample.uvTransform === undefined ? {} : { uvTransform: sample.uvTransform }),
                ...(sample.cornerUv === undefined ? {} : { cornerUv: sample.cornerUv }),
                uvwPosition,
              }),
            ]
          }),
        ),
      )
    }
    case 'cliffs':
      return Object.freeze(
        layer.levels.flatMap((row, y) =>
          row.flatMap((level, x) => {
            const uvwPosition = gridPosition(layer.origin, layer.cellSize, x, y)
            return inBounds(uvwPosition, bounds)
              ? [
                  Object.freeze({
                    facet: 'cliffs' as const,
                    id: `${record.id}:${String(x)}:${String(y)}`,
                    layerId: record.id,
                    coordinateSpaceId: 'height-grid' as const,
                    lod: 'exact' as const,
                    x,
                    y,
                    level,
                    authored: layer.authored[y]?.[x] ?? false,
                    uvwPosition,
                  }),
                ]
              : []
          }),
        ),
      )
    case 'water':
      return Object.freeze(
        layer.zones.flatMap(zone => {
          const center = {
            x: (zone.minimum[0] + zone.maximum[0]) / 2,
            z: (zone.minimum[1] + zone.maximum[1]) / 2,
          }
          return inBounds(center, bounds)
            ? [
                Object.freeze({
                  facet: 'water' as const,
                  id: `${record.id}:${zone.id}`,
                  layerId: record.id,
                  coordinateSpaceId,
                  zoneId: layer.zones.indexOf(zone),
                  templateId: zone.materialId ?? 'uvw-water',
                  minimum: Object.freeze({ x: zone.minimum[0], y: zone.minimum[1] }),
                  maximum: Object.freeze({ x: zone.maximum[0], y: zone.maximum[1] }),
                  elevation: zone.elevation,
                  uvwMinimum: Object.freeze({ x: zone.minimum[0], z: zone.minimum[1] }),
                  uvwMaximum: Object.freeze({ x: zone.maximum[0], z: zone.maximum[1] }),
                  uvwElevation: zone.elevation,
                  ...(zone.materialId === undefined ? {} : { materialId: zone.materialId }),
                }),
              ]
            : []
        }),
      )
    case 'objects':
      return Object.freeze(
        layer.instances.flatMap((instance, instanceIndex) => {
          const uvwPosition = Object.freeze({
            x: instance.position[0],
            y: instance.position[1],
            z: instance.position[2],
          })
          return inBounds(uvwPosition, bounds)
            ? [
                Object.freeze({
                  facet: 'objects' as const,
                  id: `${record.id}:${instance.id}`,
                  layerId: record.id,
                  coordinateSpaceId,
                  kind: instance.objectKind,
                  ...(instance.derivedFrom === undefined ? {} : { derivedFrom: instance.derivedFrom }),
                  objectId: instanceIndex,
                  position: uvwPosition,
                  sourcePositionDimensions: 3 as const,
                  scale: Object.freeze({
                    x: instance.scale[0],
                    y: instance.scale[1],
                    z: instance.scale[2],
                  }),
                  uvwPosition,
                  uvwRotation: instance.rotation,
                  ...(instance.presentationRotation === undefined
                    ? {}
                    : { uvwPresentationRotation: instance.presentationRotation }),
                  uvwScale: Object.freeze({
                    x: instance.scale[0],
                    y: instance.scale[1],
                    z: instance.scale[2],
                  }),
                  ...(instance.latticeCoverage === undefined
                    ? {}
                    : {
                        latticeCoverage: Object.freeze({
                          coordinateSpaceId,
                          ...instance.latticeCoverage,
                        }),
                        uvwLatticeCoverage: Object.freeze({
                          ...Object.fromEntries(
                            (['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const)
                              .flatMap(channel => instance.latticeCoverage?.[channel] === undefined
                                ? []
                                : [[channel, instance.latticeCoverage[channel]]]),
                          ),
                        }),
                      }),
                  resourceIds: Object.freeze(
                    instance.resourceIds.map(id => worldResourceId(record.space.id, id)),
                  ),
                  ...(instance.modelComponents === undefined
                    ? {}
                    : {
                        modelComponents: Object.freeze(
                          instance.modelComponents.map(component =>
                            Object.freeze({
                              ...component,
                              resourceId: worldResourceId(record.space.id, component.resourceId),
                            }),
                          ),
                        ),
                      }),
                  ...(instance.typeId === undefined ? {} : { typeId: instance.typeId }),
                  ...(instance.player === undefined ? {} : { player: instance.player }),
                  ...(instance.variation === undefined ? {} : { variation: instance.variation }),
                  ...(instance.name === undefined ? {} : { name: instance.name }),
                  ...(instance.presentationTint === undefined
                    ? {}
                    : { presentationTint: instance.presentationTint }),
                  ...(instance.presentationAnimation === undefined
                    ? {}
                    : { presentationAnimation: instance.presentationAnimation }),
                }),
              ]
            : []
        }),
      )
    case 'resources':
      return Object.freeze(
        layer.resources.map(resource =>
          Object.freeze({
            facet: 'resources' as const,
            id: worldResourceId(record.space.id, resource.id),
            layerId: record.id,
            resolved: false,
            kind: resource.kind,
            uri: resource.uri,
            ...(resource.digest === undefined ? {} : { digest: resource.digest }),
            objectIds: Object.freeze(
              layer.kind === 'resources'
                ? record.space.layers.flatMap(candidate =>
                    candidate.kind === 'objects'
                      ? candidate.instances
                          .filter(instance => instance.resourceIds.includes(resource.id))
                          .map(
                            instance =>
                              `${encodeURIComponent(record.space.id)}/${encodeURIComponent(candidate.id)}:${instance.id}`,
                          )
                      : [],
                  )
                : [],
            ),
          }),
        ),
      )
    case 'regions':
      return Object.freeze(
        layer.regions.map((region, regionIndex) => {
          const shapes = Object.freeze(
            region.shapes.map(shape => {
              if (shape.kind === 'circle')
                return Object.freeze({
                  kind: shape.kind,
                  center: Object.freeze({ x: shape.center[0], y: shape.center[1] }),
                  radius: shape.radius,
                  rawParameters: Object.freeze({}),
                })
              if (shape.kind === 'rectangle')
                return Object.freeze({
                  kind: shape.kind,
                  minimum: Object.freeze({ x: shape.minimum[0], y: shape.minimum[1] }),
                  maximum: Object.freeze({ x: shape.maximum[0], y: shape.maximum[1] }),
                  rawParameters: Object.freeze({}),
                })
              return Object.freeze({
                kind: shape.kind,
                points: Object.freeze(
                  shape.points.map(point => Object.freeze({ x: point[0], y: point[1] })),
                ),
                rawParameters: Object.freeze({}),
              })
            }),
          )
          return Object.freeze({
            facet: 'regions' as const,
            id: `${record.id}:${region.id}`,
            layerId: record.id,
            coordinateSpaceId,
            regionId: regionIndex,
            name: region.name,
            ...(region.color === undefined ? {} : { color: region.color }),
            shapes,
            uvwShapes: shapes,
          })
        }),
      )
    case 'navigation':
      return Object.freeze(
        layer.samples.flatMap((row, y) =>
          row.flatMap((flags, x) => {
            const uvwPosition = gridPosition(layer.origin, layer.cellSize, x, y)
            return inBounds(uvwPosition, bounds)
              ? [
                  Object.freeze({
                    facet: 'navigation' as const,
                    id: `${record.id}:${String(x)}:${String(y)}`,
                    layerId: record.id,
                    coordinateSpaceId,
                    lod: 'exact' as const,
                    x,
                    y,
                    flags,
                    uvwPosition,
                  }),
                ]
              : []
          }),
        ),
      )
    case 'gateways':
      return Object.freeze(
        layer.segments.flatMap(segment => {
          const center = {
            x: (segment.start[0] + segment.end[0]) / 2,
            z: (segment.start[1] + segment.end[1]) / 2,
          }
          return inBounds(center, bounds)
            ? [
                Object.freeze({
                  facet: 'gateways' as const,
                  id: `${record.id}:${segment.id}`,
                  layerId: record.id,
                  coordinateSpaceId,
                  x1: segment.start[0],
                  y1: segment.start[1],
                  x2: segment.end[0],
                  y2: segment.end[1],
                  uvwStart: Object.freeze({ x: segment.start[0], y: 0, z: segment.start[1] }),
                  uvwEnd: Object.freeze({ x: segment.end[0], y: 0, z: segment.end[1] }),
                }),
              ]
            : []
        }),
      )
    case 'lighting':
      return Object.freeze([
        Object.freeze({
          facet: 'lighting' as const,
          id: `${record.id}:environment`,
          layerId: record.id,
          coordinateSpaceId,
          ambientColor: layer.ambientColor,
          ambientIntensity: layer.ambientIntensity,
          ...(layer.toneMapping === undefined ? {} : { toneMapping: layer.toneMapping }),
          ...(layer.terrain === undefined ? {} : { terrain: layer.terrain }),
          directional: layer.directional,
        }),
      ])
    case 'heightfield':
      return Object.freeze([])
  }
}

function query(request: WorldScenePageRequest): string {
  const bounds = request.bounds
  if (
    bounds !== undefined &&
    (!Number.isFinite(bounds.minimumX) ||
      !Number.isFinite(bounds.minimumY) ||
      !Number.isFinite(bounds.maximumX) ||
      !Number.isFinite(bounds.maximumY) ||
      bounds.minimumX > bounds.maximumX ||
      bounds.minimumY > bounds.maximumY)
  ) {
    throw new TypeError('UVW world bounds must be finite ordered minimum/maximum coordinates')
  }
  return JSON.stringify([
    request.facet,
    request.layerId ?? null,
    request.lod ?? null,
    bounds === undefined
      ? null
      : [bounds.minimumX, bounds.minimumY, bounds.maximumX, bounds.maximumY],
  ])
}

function cursor(snapshotId: string, requestKey: string, offset: number): string {
  return `${encodeURIComponent(snapshotId)}|${encodeURIComponent(requestKey)}|${String(offset)}`
}

function cursorOffset(value: string | undefined, snapshotId: string, requestKey: string): number {
  if (value === undefined) return 0
  const parts = value.split('|')
  if (parts.length !== 3) throw new TypeError('UVW world cursor is malformed')
  let foundSnapshot: string
  let foundQuery: string
  try {
    foundSnapshot = decodeURIComponent(parts[0] ?? '')
    foundQuery = decodeURIComponent(parts[1] ?? '')
  } catch {
    throw new TypeError('UVW world cursor is malformed')
  }
  const offset = Number(parts[2])
  if (foundSnapshot !== snapshotId)
    throw new TypeError('UVW world cursor belongs to another snapshot')
  if (foundQuery !== requestKey || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('UVW world cursor does not match the requested facet')
  }
  return offset
}

function paged<Value>(
  values: readonly Value[],
  request: WorldScenePageRequest,
  snapshotId: string,
  maximum: number,
): Readonly<{ items: readonly Value[]; nextCursor?: string }> {
  const limit = positiveLimit(request.limit, maximum)
  const requestKey = query(request)
  const offset = cursorOffset(request.cursor, snapshotId, requestKey)
  if (offset > values.length) throw new TypeError('UVW world cursor offset is outside this facet')
  const items = Object.freeze(values.slice(offset, offset + limit))
  const nextOffset = offset + items.length
  return Object.freeze({
    items,
    ...(nextOffset < values.length
      ? { nextCursor: cursor(snapshotId, requestKey, nextOffset) }
      : {}),
  })
}

function unsupported(snapshotId: string, facet: string, reason: string): WorldScenePage {
  return Object.freeze({
    snapshotId,
    facet,
    state: 'unsupported',
    items: Object.freeze([]),
    reason,
  })
}

/** Adapt a validated UVW profile to the bounded common world viewer contract. */
export function createUvwWorldSceneSource(
  input: UvwProfileDocument,
  options: UvwWorldSceneSourceOptions,
): WorldSceneSource {
  if (options.snapshotId.length === 0) throw new TypeError('UVW snapshotId must not be empty')
  const maxPageSize = options.maxPageSize ?? 65_536
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER)
  const document = canonicalizeUvwProfile(input, options.limits)
  const layers: LayerRecord[] = document.spaces.flatMap(space =>
    space.layers.map(layer => {
      const id = `${encodeURIComponent(space.id)}/${encodeURIComponent(layer.id)}`
      return Object.freeze({
        id,
        coordinateSpaceId: `uvw-space:${space.id}`,
        space,
        layer,
        itemCount: layerItemCount(layer),
        contentRevision: contentRevision(layer),
        ...(layer.kind !== 'heightfield' || layer.cliffFaces === undefined
          ? {}
          : { cliffCells: new Set(layer.cliffFaces.map(cell => cell.y * layer.columns + cell.x)) }),
      })
    }),
  )
  const mediaResources = new Map(
    layers.flatMap(record =>
      record.layer.kind !== 'resources'
        ? []
        : record.layer.resources
            .filter(resource => resource.kind === 'media')
            .map(resource => [worldResourceId(record.space.id, resource.id), resource] as const),
    ),
  )
  const editableObjectLayers = layers.filter(record => record.layer.kind === 'objects')
  const uvmResources = new Map(
    layers.flatMap(record =>
      record.layer.kind !== 'resources'
        ? []
        : record.layer.resources
            .filter(resource => resource.kind === 'uvm')
            .map(resource => [worldResourceId(record.space.id, resource.id), resource] as const),
    ),
  )
  const mediaByUri = new Map<
    string,
    Readonly<{ readonly bytes: Uint8Array; readonly mediaType?: string }>
  >()
  for (const [resourceId, resource] of mediaResources) {
    const embedded = options.embeddedResources?.get(resourceId)
    if (embedded !== undefined) mediaByUri.set(resource.uri, embedded)
  }
  const layerItems = Object.freeze<readonly WorldSceneLayerItem[]>(
    layers.map(record =>
      Object.freeze({
        facet: 'layers',
        id: `layer:${record.id}`,
        layerId: record.id,
        kind: worldFacet(record.layer),
        ...(record.layer.label === undefined ? {} : { label: record.layer.label }),
        state: 'available',
        itemCount: record.itemCount,
        lods: Object.freeze(
          record.layer.kind === 'terrain-materials' && record.layer.samples === undefined
            ? ['raster-exact']
            : ['exact'],
        ),
        contentRevision: record.contentRevision,
        spaceId: record.space.id,
        localLayerId: record.layer.id,
        ...(record.layer.kind === 'heightfield' && record.layer.latticeOverview !== undefined ? {latticeOverview:record.layer.latticeOverview} : {}),
        ...(record.layer.kind === 'navigation' && record.layer.flagEncoding !== undefined ? { navigationFlagEncoding: record.layer.flagEncoding } : {}),
        ...('columns' in record.layer && 'cellSize' in record.layer && 'origin' in record.layer
          ? {
              grid: Object.freeze({
                columns: record.layer.columns,
                rows: record.layer.rows,
                cellSize: record.layer.cellSize,
                origin: record.layer.origin,
                coordinateSpaceId: record.coordinateSpaceId,
                ...(record.layer.kind === 'heightfield' && record.layer.noDataValue !== undefined
                  ? { noDataValue: record.layer.noDataValue }
                  : {}),
              }),
            }
          : {}),
        ...(record.layer.kind === 'terrain-materials'
          ? {
              materials: Object.freeze(
                record.layer.materials.map(material =>
                  Object.freeze({
                    materialId: material.id,
                    ...(material.label === undefined ? {} : { label: material.label }),
                    ...(material.classification === undefined
                      ? {}
                      : { classification: material.classification }),
                    ...(material.sourceIndex === undefined
                      ? {}
                      : { sourceIndex: material.sourceIndex }),
                    ...(material.atlas === undefined ? {} : { atlas: material.atlas }),
                    ...(material.baseColorFactor === undefined
                      ? {}
                      : { baseColorFactor: material.baseColorFactor }),
                    ...(material.baseColorResourceId === undefined
                      ? {}
                      : {
                          baseColorResourceId: worldResourceId(
                            record.space.id,
                            material.baseColorResourceId,
                          ),
                        }),
                    ...(material.normalResourceId === undefined
                      ? {}
                      : {
                          normalResourceId: worldResourceId(
                            record.space.id,
                            material.normalResourceId,
                          ),
                        }),
                    ...(material.specularResourceId === undefined
                      ? {}
                      : {
                          specularResourceId: worldResourceId(
                            record.space.id,
                            material.specularResourceId,
                          ),
                        }),
                    ...(material.uvTransform === undefined
                      ? {}
                      : { uvTransform: material.uvTransform }),
                    ...(material.normalEncoding === undefined ? {} : { normalEncoding: material.normalEncoding }),
                    ...(material.specularEncoding === undefined ? {} : { specularEncoding: material.specularEncoding }),
                  }),
                ),
              ),
              ...(record.layer.weightRasters === undefined
                ? {}
                : {
                    weightRasters: Object.freeze(
                      record.layer.weightRasters.map(raster =>
                        Object.freeze({
                          resourceId: worldResourceId(record.space.id, raster.resourceId),
                          width: raster.width,
                          height: raster.height,
                          materialIds: raster.materialIds,
                          encoding: raster.encoding,
                          normalization: raster.normalization,
                        }),
                      ),
                    ),
                  }),
            }
          : {}),
        ...(record.layer.kind === 'water' && record.layer.materials !== undefined
          ? {
              waterMaterials: Object.freeze(
                record.layer.materials.map(material =>
                  Object.freeze({
                    materialId: material.id,
                    ...(material.label === undefined ? {} : { label: material.label }),
                    ...(material.classification === undefined
                      ? {}
                      : { classification: material.classification }),
                    ...(material.shorelineMode === undefined
                      ? {}
                      : { shorelineMode: material.shorelineMode }),
                    color: material.color,
                    ...(material.baseColorResourceId === undefined
                      ? {}
                      : {
                          baseColorResourceId: worldResourceId(
                            record.space.id,
                            material.baseColorResourceId,
                          ),
                        }),
                    ...(material.secondaryColorResourceId === undefined
                      ? {}
                      : {
                          secondaryColorResourceId: worldResourceId(
                            record.space.id,
                            material.secondaryColorResourceId,
                          ),
                        }),
                    ...(material.uvScale === undefined ? {} : { uvScale: material.uvScale }),
                    ...(material.scroll === undefined ? {} : { scroll: material.scroll }),
                    ...(material.colorFalloff === undefined
                      ? {}
                      : { colorFalloff: material.colorFalloff }),
                    ...(material.specularity === undefined
                      ? {}
                      : { specularity: material.specularity }),
                    ...(material.specularScale === undefined
                      ? {}
                      : { specularScale: material.specularScale }),
                    ...(material.reflectivityPower === undefined
                      ? {}
                      : { reflectivityPower: material.reflectivityPower }),
                    ...(material.normalResourceId === undefined ? {} : {
                      normalResourceId: worldResourceId(record.space.id, material.normalResourceId),
                    }),
                    ...(material.causticsFrameResourceIds === undefined ? {} : {
                      causticsFrameResourceIds: Object.freeze(material.causticsFrameResourceIds.map(id => worldResourceId(record.space.id, id))),
                    }),
                    ...(material.causticsFalloff === undefined ? {} : { causticsFalloff: material.causticsFalloff }),
                    ...(material.causticsResourceId === undefined
                      ? {}
                      : {
                          causticsResourceId: worldResourceId(
                            record.space.id,
                            material.causticsResourceId,
                          ),
                        }),
                    ...(material.causticsScale === undefined
                      ? {}
                      : { causticsScale: material.causticsScale }),
                    ...(material.causticsFramesPerSecond === undefined
                      ? {}
                      : { causticsFramesPerSecond: material.causticsFramesPerSecond }),
                    ...(material.receiveShadows === undefined
                      ? {}
                      : { receiveShadows: material.receiveShadows }),
                  }),
                ),
              ),
            }
          : {}),
      }),
    ),
  )
  const singleSpacePlayers = document.spaces.length === 1 ? document.spaces[0]?.players : undefined
  const info = Object.freeze<WorldSceneInfo>({
    contract: WORLD_SCENE_SOURCE_CONTRACT,
    major: 1,
    maturity: 'publisher-candidate',
    snapshotId: options.snapshotId,
    mapId: options.mapId ?? `uvw:${options.snapshotId}`,
    coordinateSpaces: Object.freeze(
      document.spaces.map(space =>
        Object.freeze({
          id: `uvw-space:${space.id}`,
          horizontalAxes: Object.freeze(['x', 'z'] as const),
          verticalAxis: 'y',
          handedness: 'right',
          linearUnit:
            space.basis.unit === 'meter' ? 'meter' : (space.basis.sourceUnit ?? 'source-unit'),
          rotationUnit: 'radian',
          origin: 'heightfield-layer-origin',
        }),
      ),
    ),
    crossSpaceTransforms: Object.freeze([]),
    bounds: Object.freeze(
      layers.map(record =>
        Object.freeze({
          facet: worldFacet(record.layer),
          coordinateSpaceId: record.coordinateSpaceId,
          x: Object.freeze({
            state: 'known' as const,
            minimum: record.space.bounds.min[0],
            maximum: record.space.bounds.max[0],
          }),
          y: Object.freeze({
            state: 'known' as const,
            minimum: record.space.bounds.min[1],
            maximum: record.space.bounds.max[1],
          }),
          z: Object.freeze({
            state: 'known' as const,
            minimum: record.space.bounds.min[2],
            maximum: record.space.bounds.max[2],
          }),
        }),
      ),
    ),
    facets: Object.freeze(
      layers.map(record =>
        Object.freeze({
          facet: worldFacet(record.layer),
          layerId: record.id,
          state: 'available' as const,
          itemCount: record.itemCount,
          lods: Object.freeze(
            record.layer.kind === 'terrain-materials' && record.layer.samples === undefined
              ? ['raster-exact']
              : ['exact'],
          ),
          contentRevision: record.contentRevision,
        }),
      ),
    ),
    provenance: Object.freeze([]),
    unknownFacets: Object.freeze([]),
    lossPolicy: 'explicit-partial',
    complete: true,
    ...(editableObjectLayers.length === 1
      ? {
          edit: Object.freeze({
            operationId: 'edit.structure',
            moveObjectKind: 'object.update' as const,
          }),
        }
      : {}),
    canonicalArtifact: Object.freeze({
      format: 'UVW',
      version: '1.0',
      spaces: Object.freeze(
        document.spaces.map(space =>
          Object.freeze({
            id: space.id,
            ...(space.topology === 'heightfield' ? {} : { topology: space.topology }),
            ...(space.label === undefined ? {} : { label: space.label }),
            basis: space.basis,
            bounds: space.bounds,
            ...(space.players === undefined ? {} : { players: space.players }),
            ...(space.startPositions === undefined ? {} : { startPositions: space.startPositions }),
            ...(space.camera === undefined ? {} : { camera: space.camera }),
          }),
        ),
      ),
    }),
    // A single space can use the viewer's native slot palette without merging unrelated rosters.
    ...(singleSpacePlayers === undefined
      ? {}
      : {
          players: Object.freeze(
            singleSpacePlayers.map(player =>
              Object.freeze({
                id: player.slot,
                ...(player.name === undefined ? {} : { name: player.name }),
                ...(player.color === undefined ? {} : { color: player.color }),
                ...(player.ramp === undefined ? {} : { colorRamp: player.ramp }),
              }),
            ),
          ),
        }),
    // the viewer opens on the game's view of the world: the first space's preset
    ...(document.spaces.find(space => space.camera !== undefined)?.camera === undefined
      ? {}
      : { camera: document.spaces.find(space => space.camera !== undefined)!.camera! }),
  })

  return Object.freeze<WorldSceneSource>({
    contract: WORLD_SCENE_SOURCE_CONTRACT,
    major: 1,
    snapshotId: options.snapshotId,
    async info(signal) {
      signal?.throwIfAborted()
      return info
    },
    async page(request, signal) {
      signal?.throwIfAborted()
      if (request.facet === 'layers') {
        const result = paged(layerItems, request, options.snapshotId, maxPageSize)
        return Object.freeze({
          snapshotId: options.snapshotId,
          facet: 'layers',
          state: 'available' as const,
          items: result.items,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        })
      }
      if (request.layerId === undefined) {
        return unsupported(options.snapshotId, request.facet, 'UVW facet requests require layerId')
      }
      const record = layers.find(candidate => candidate.id === request.layerId)
      if (record === undefined) {
        return unsupported(
          options.snapshotId,
          request.facet,
          `unknown UVW layer ${request.layerId}`,
        )
      }
      const facet = worldFacet(record.layer)
      if (request.facet !== facet) {
        return unsupported(
          options.snapshotId,
          request.facet,
          `UVW layer ${request.layerId} belongs to facet ${facet}`,
        )
      }
      if (request.lod !== undefined && request.lod !== 'exact') {
        return unsupported(
          options.snapshotId,
          request.facet,
          `UVW layer ${request.layerId} supports exact LOD only`,
        )
      }
      if (record.layer.kind !== 'heightfield') {
        const result = paged(
          recordItems(record, request.bounds),
          request,
          options.snapshotId,
          maxPageSize,
        )
        return Object.freeze({
          snapshotId: options.snapshotId,
          facet,
          state: 'available' as const,
          items: result.items,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        })
      }
      const limit = positiveLimit(request.limit, maxPageSize)
      const requestKey = query(request)
      const total = record.layer.columns * record.layer.rows
      let offset = cursorOffset(request.cursor, options.snapshotId, requestKey)
      if (offset > total)
        throw new TypeError('UVW terrain cursor offset is outside the heightfield')
      const items: WorldSceneTerrainItem[] = []
      while (offset < total && items.length < limit) {
        if ((offset & 0xfff) === 0) signal?.throwIfAborted()
        const x = offset % record.layer.columns
        const y = Math.floor(offset / record.layer.columns)
        const sample = record.layer.samples[y]?.[x]
        offset += 1
        if (sample === undefined || sameNumber(sample, record.layer.noDataValue)) continue
        const uvwPosition = Object.freeze({
          x: record.layer.origin[0] + x * record.layer.cellSize,
          y: sample,
          z: record.layer.origin[2] + y * record.layer.cellSize,
        })
        const bounds = request.bounds
        if (
          bounds !== undefined &&
          (uvwPosition.x < bounds.minimumX ||
            uvwPosition.x > bounds.maximumX ||
            uvwPosition.z < bounds.minimumY ||
            uvwPosition.z > bounds.maximumY)
        ) {
          continue
        }
        items.push(
          Object.freeze({
            facet: 'terrain',
            id: `${record.id}:${String(x)}:${String(y)}`,
            layerId: record.id,
            coordinateSpaceId: record.coordinateSpaceId,
            x,
            y,
            heightBase: sample,
            heightAdjustment: 0,
            mask: 0,
            ...(record.cliffCells === undefined || x >= record.layer.columns - 1 || y >= record.layer.rows - 1
              ? {}
              : { cliffFace: record.cliffCells.has(y * record.layer.columns + x) }),
            uvwPosition,
            lod: 'exact',
          }),
        )
      }
      return Object.freeze({
        snapshotId: options.snapshotId,
        facet: 'terrain',
        state: 'available' as const,
        items: Object.freeze(items),
        ...(offset < total ? { nextCursor: cursor(options.snapshotId, requestKey, offset) } : {}),
      })
    },
    ...(options.modelDecoder === undefined
      ? {}
      : {
          async model(resourceId: string, request: WorldSceneModelRequest, signal?: AbortSignal) {
            signal?.throwIfAborted()
            const resource = uvmResources.get(resourceId)
            const embedded = options.embeddedResources?.get(resourceId)
            if (resource === undefined || embedded === undefined) {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([
                  diagnostic(
                    'warning',
                    'x3.uv/uvw-model-resource-unavailable',
                    `UVW resource ${resourceId} has no package-owned UVM bytes`,
                  ),
                ]),
              })
            }
            return options.modelDecoder!(
              Object.freeze({
                resourceId,
                uri: resource.uri,
                ...(resource.digest === undefined ? {} : { digest: resource.digest }),
                bytes: embedded.bytes.slice(),
                mediaByUri,
              }),
              request,
              signal,
            )
          },
        }),
    async texture(resourceId: string, request: WorldSceneTextureRequest, signal) {
      signal?.throwIfAborted()
      positiveLimit(request.maxBytes, Number.MAX_SAFE_INTEGER)
      const resource = mediaResources.get(resourceId)
      if (resource === undefined) {
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([
            diagnostic(
              'warning',
              'modkit.uv/world-texture-resource-unavailable',
              `UVW texture resource ${resourceId} is not declared as media`,
            ),
          ]),
        })
      }
      if (options.rasterResources === undefined) {
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([
            diagnostic(
              'warning',
              'modkit.uv/world-texture-decoder-unavailable',
              'UVW embedded media requires the host raster decoder port',
            ),
          ]),
        })
      }
      try {
        const embedded = options.embeddedResources?.get(resourceId)
        if (embedded === undefined)
          throw new TypeError(
            `UVW texture resource ${resourceId} has no bytes supplied by its package opener`,
          )
        if (embedded.bytes.byteLength > request.maxBytes)
          throw new RangeError(`UVW portable media exceeds maxBytes ${String(request.maxBytes)}`)
        if (resource.digest !== undefined && (await sha256(embedded.bytes)) !== resource.digest)
          throw new TypeError(`UVW texture resource ${resourceId} digest does not match its bytes`)
        const decoded = await options.rasterResources.read(
          {
            kind: 'embedded',
            bytes: embedded.bytes,
            ...(embedded.mediaType === undefined ? {} : { mediaType: embedded.mediaType }),
            maxBytes: request.maxBytes,
          },
          signal,
        )
        if (decoded.state !== 'decoded')
          return Object.freeze({
            state: 'unresolved' as const,
            diagnostics: Object.freeze([...decoded.diagnostics]),
          })
        const texture = worldTexture(resourceId, decoded)
        if (texture === undefined)
          throw new TypeError(`UVW texture resource ${resourceId} has unknown row orientation`)
        return Object.freeze({
          state: 'decoded' as const,
          texture,
          diagnostics: Object.freeze([...decoded.diagnostics]),
        })
      } catch (error) {
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([
            diagnostic(
              'warning',
              'modkit.uv/world-texture-invalid',
              error instanceof Error ? error.message : String(error),
            ),
          ]),
        })
      }
    },
  })
}
