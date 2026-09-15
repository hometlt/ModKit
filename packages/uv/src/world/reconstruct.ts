import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneItem,
  WorldSceneLayerItem,
  WorldSceneObjectItem,
  WorldSceneTerrainItem,
} from '@modkit/sdk/maps'

import type {
  UvwHeightfieldSpaceLayer,
  UvwBasis,
  UvwProfileDocument,
  UvwRegionShape,
  UvwTerrainMaterialSample,
} from './index.js'

export interface CanonicalUvwReconstructionOptions {
  readonly maxPageItems: number
  readonly maxFacetItems: number
  readonly signal?: AbortSignal
}

export interface CanonicalUvwReconstruction {
  readonly document: UvwProfileDocument
  readonly pageRequests: number
  readonly observedItems: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function localId(id: string, prefix = 'item'): string {
  const index = id.lastIndexOf(':')
  const candidate = index < 0 ? id : id.slice(index + 1)
  if (/^[a-z][a-z0-9-]*$/u.test(candidate)) return candidate
  const suffix = candidate
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return `${prefix}-${suffix.length === 0 ? 'unknown' : suffix}`
}

function localResourceId(id: string, spaceId: string): string {
  const prefix = `uvw-resource:${encodeURIComponent(spaceId)}/`
  if (!id.startsWith(prefix))
    throw new TypeError(`resource ${id} does not belong to UVW space ${spaceId}`)
  try {
    return decodeURIComponent(id.slice(prefix.length))
  } catch {
    throw new TypeError(`resource ${id} has an invalid encoded local id`)
  }
}

async function drain(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  facet: string,
  layerId: string | undefined,
  options: CanonicalUvwReconstructionOptions,
  state: { pageRequests: number; observedItems: number },
): Promise<readonly WorldSceneItem[]> {
  const items: WorldSceneItem[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    options.signal?.throwIfAborted()
    state.pageRequests += 1
    const page = await source.page(
      {
        facet,
        ...(layerId === undefined ? {} : { layerId, lod: 'exact' }),
        ...(cursor === undefined ? {} : { cursor }),
        limit: options.maxPageItems,
      },
      options.signal,
    )
    if (
      page.snapshotId !== info.snapshotId ||
      page.facet !== facet ||
      page.state !== 'available' ||
      page.items.length > options.maxPageItems ||
      page.items.some(
        item => item.facet !== facet || (layerId !== undefined && item.layerId !== layerId),
      )
    ) {
      throw new TypeError(`UVW canonical ${facet} page has an invalid identity, state or item`)
    }
    state.observedItems += page.items.length
    if (state.observedItems > options.maxFacetItems) {
      throw new RangeError(
        `UVW canonical facet drain exceeds maxFacetItems ${String(options.maxFacetItems)}`,
      )
    }
    items.push(...page.items)
    const next = page.nextCursor
    if (next !== undefined && (next === cursor || cursors.has(next))) {
      throw new TypeError(`UVW canonical ${facet} page cursor repeats`)
    }
    if (next !== undefined) cursors.add(next)
    cursor = next
  } while (cursor !== undefined)
  return Object.freeze(items)
}

function gridIndex(
  item: { readonly x: number; readonly y: number },
  columns: number,
  rows: number,
): number {
  if (
    !Number.isSafeInteger(item.x) ||
    !Number.isSafeInteger(item.y) ||
    item.x < 0 ||
    item.y < 0 ||
    item.x >= columns ||
    item.y >= rows
  ) {
    throw new TypeError('UVW canonical grid item has an out-of-range coordinate')
  }
  return item.y * columns + item.x
}

function canonicalGridIndex(
  item: {
    readonly x: number
    readonly y: number
    readonly uvwPosition?: Readonly<{ readonly x: number; readonly z: number }>
  },
  grid: NonNullable<WorldSceneLayerItem['grid']>,
): number {
  if (item.uvwPosition === undefined) return gridIndex(item, grid.columns, grid.rows)
  const x = Math.round((item.uvwPosition.x - grid.origin[0]) / grid.cellSize)
  const y = Math.round((item.uvwPosition.z - grid.origin[2]) / grid.cellSize)
  const expectedX = grid.origin[0] + x * grid.cellSize
  const expectedZ = grid.origin[2] + y * grid.cellSize
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(expectedX), Math.abs(expectedZ)) * 8
  if (
    Math.abs(item.uvwPosition.x - expectedX) > tolerance ||
    Math.abs(item.uvwPosition.z - expectedZ) > tolerance
  ) {
    throw new TypeError('UVW canonical grid item does not lie on its declared grid')
  }
  return gridIndex({ x, y }, grid.columns, grid.rows)
}

function gridRows<Value>(
  values: readonly Value[],
  columns: number,
  rows: number,
): readonly (readonly Value[])[] {
  return Object.freeze(
    Array.from({ length: rows }, (_, row) =>
      Object.freeze(values.slice(row * columns, (row + 1) * columns)),
    ),
  )
}

function layerLabel(layer: WorldSceneLayerItem): Readonly<{ label?: string }> {
  return layer.label === undefined ? Object.freeze({}) : Object.freeze({ label: layer.label })
}

function regionShape(
  shape: Extract<WorldSceneItem, { facet: 'regions' }>['shapes'][number],
): UvwRegionShape {
  if (
    shape.kind === 'circle' &&
    shape.center !== undefined &&
    finite(shape.radius) &&
    shape.radius > 0
  ) {
    return Object.freeze({
      kind: 'circle',
      center: Object.freeze([shape.center.x, shape.center.y] as const),
      radius: shape.radius,
    })
  }
  if (shape.kind === 'rectangle' && shape.minimum !== undefined && shape.maximum !== undefined) {
    return Object.freeze({
      kind: 'rectangle',
      minimum: Object.freeze([shape.minimum.x, shape.minimum.y] as const),
      maximum: Object.freeze([shape.maximum.x, shape.maximum.y] as const),
    })
  }
  if (shape.kind === 'polygon' && shape.points !== undefined && shape.points.length >= 3) {
    return Object.freeze({
      kind: 'polygon',
      points: Object.freeze(shape.points.map(point => Object.freeze([point.x, point.y] as const))),
    })
  }
  throw new TypeError(`UVW canonical region shape ${shape.kind} is not representable`)
}

async function reconstructLayer(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  layer: WorldSceneLayerItem,
  spaceId: string,
  options: CanonicalUvwReconstructionOptions,
  state: { pageRequests: number; observedItems: number },
): Promise<UvwHeightfieldSpaceLayer> {
  const id = layer.localLayerId ?? localId(layer.layerId)
  const label = layerLabel(layer)
  if (
    layer.kind === 'terrain-materials' &&
    layer.weightRasters !== undefined &&
    layer.weightRasters.length > 0 &&
    !layer.lods.includes('exact')
  ) {
    const grid = layer.grid
    const definitions = layer.materials
    if (grid === undefined || definitions === undefined || definitions.length === 0)
      throw new TypeError('UVW raster terrain-materials layer is missing grid or material metadata')
    const resource = (value: string | undefined): string | undefined =>
      value?.startsWith('uvw-resource:') === true ? localResourceId(value, spaceId) : undefined
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'terrain-materials',
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      materials: Object.freeze(
        definitions.map(material =>
          Object.freeze({
            id: material.materialId,
            ...(material.label === undefined ? {} : { label: material.label }),
            ...(material.classification === undefined
              ? {}
              : { classification: material.classification }),
            ...(material.sourceIndex === undefined ? {} : { sourceIndex: material.sourceIndex }),
            ...(resource(material.baseColorResourceId) === undefined
              ? {}
              : { baseColorResourceId: resource(material.baseColorResourceId)! }),
            ...(resource(material.normalResourceId) === undefined
              ? {}
              : { normalResourceId: resource(material.normalResourceId)! }),
            ...(resource(material.specularResourceId) === undefined
              ? {}
              : { specularResourceId: resource(material.specularResourceId)! }),
            ...(material.uvTransform === undefined ? {} : { uvTransform: material.uvTransform }),
          }),
        ),
      ),
      weightRasters: Object.freeze(
        layer.weightRasters.map((raster, index) =>
          Object.freeze({
            resourceId: raster.resourceId.startsWith('uvw-resource:')
              ? localResourceId(raster.resourceId, spaceId)
              : `terrain-weight-${String(index).padStart(4, '0')}`,
            width: raster.width,
            height: raster.height,
            materialIds: raster.materialIds,
            encoding: raster.encoding,
            normalization: raster.normalization,
          }),
        ),
      ),
    })
  }
  const items = await drain(source, info, layer.kind, layer.layerId, options, state)
  if (layer.kind === 'terrain') {
    const grid = layer.grid
    if (grid === undefined)
      throw new TypeError('UVW canonical terrain layer is missing exact grid metadata')
    const fill = grid.noDataValue
    const values = new Array<number | undefined>(grid.columns * grid.rows).fill(fill)
    for (const raw of items) {
      const item = raw as WorldSceneTerrainItem
      if (
        item.facet !== 'terrain' ||
        item.lod !== 'exact' ||
        item.uvwPosition === undefined ||
        !finite(item.uvwPosition.y)
      ) {
        throw new TypeError('UVW canonical terrain item is invalid')
      }
      const index = gridIndex(item, grid.columns, grid.rows)
      if (values[index] !== fill)
        throw new TypeError('UVW canonical terrain grid contains a duplicate coordinate')
      values[index] = item.uvwPosition.y
    }
    if (values.some(value => value === undefined))
      throw new TypeError('UVW canonical terrain has holes without noDataValue')
    return Object.freeze({
      id,
      kind: 'heightfield',
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      ...(fill === undefined ? {} : { noDataValue: fill }),
      samples: gridRows(values as number[], grid.columns, grid.rows),
    })
  }
  if (layer.kind === 'terrain-materials') {
    const grid = layer.grid
    const definitions = layer.materials
    if (grid === undefined || definitions === undefined || definitions.length === 0) {
      throw new TypeError(
        'UVW canonical terrain-materials layer is missing grid or material metadata',
      )
    }
    const values = new Array<UvwTerrainMaterialSample | undefined>(grid.columns * grid.rows)
    for (const raw of items) {
      if (raw.facet !== 'terrain-materials' || raw.lod !== 'exact')
        throw new TypeError('UVW canonical terrain-material item is invalid')
      const index = canonicalGridIndex(raw, grid)
      if (values[index] !== undefined)
        throw new TypeError('UVW canonical terrain-material grid contains a duplicate coordinate')
      const weights = raw.weights ?? [
        Object.freeze({
          materialId:
            definitions.find(item => item.sourceIndex === raw.textureIndex)?.materialId ??
            definitions[0]!.materialId,
          weight: 1,
        }),
      ]
      values[index] = Object.freeze({
        weights: Object.freeze(
          weights.map(weight =>
            Object.freeze({ materialId: weight.materialId, weight: weight.weight }),
          ),
        ),
        ...(raw.uvTransform === undefined ? {} : { uvTransform: raw.uvTransform }),
      })
    }
    if (values.some(value => value === undefined))
      throw new TypeError('UVW canonical terrain-material grid is incomplete')
    const resources = (value: string | undefined): string | undefined =>
      value?.startsWith('uvw-resource:') === true ? localResourceId(value, spaceId) : undefined
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'terrain-materials',
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      materials: Object.freeze(
        definitions.map(material =>
          Object.freeze({
            id: material.materialId,
            ...(material.label === undefined ? {} : { label: material.label }),
            ...(material.classification === undefined
              ? {}
              : { classification: material.classification }),
            ...(material.sourceIndex === undefined ? {} : { sourceIndex: material.sourceIndex }),
            ...(resources(material.baseColorResourceId) === undefined
              ? {}
              : { baseColorResourceId: resources(material.baseColorResourceId)! }),
            ...(resources(material.normalResourceId) === undefined
              ? {}
              : { normalResourceId: resources(material.normalResourceId)! }),
            ...(resources(material.specularResourceId) === undefined
              ? {}
              : { specularResourceId: resources(material.specularResourceId)! }),
            ...(material.uvTransform === undefined ? {} : { uvTransform: material.uvTransform }),
          }),
        ),
      ),
      samples: gridRows(values as UvwTerrainMaterialSample[], grid.columns, grid.rows),
      ...(layer.weightRasters === undefined
        ? {}
        : {
            weightRasters: Object.freeze(
              layer.weightRasters.map((raster, index) =>
                Object.freeze({
                  resourceId: raster.resourceId.startsWith('uvw-resource:')
                    ? localResourceId(raster.resourceId, spaceId)
                    : `terrain-weight-${String(index).padStart(4, '0')}`,
                  width: raster.width,
                  height: raster.height,
                  materialIds: raster.materialIds,
                  encoding: raster.encoding,
                  normalization: raster.normalization,
                }),
              ),
            ),
          }),
    })
  }
  if (layer.kind === 'cliffs') {
    const grid = layer.grid
    if (grid === undefined)
      throw new TypeError('UVW canonical cliffs layer is missing grid metadata')
    const levels = new Array<number | undefined>(grid.columns * grid.rows)
    const authored = new Array<boolean | undefined>(grid.columns * grid.rows)
    for (const raw of items) {
      if (raw.facet !== 'cliffs' || raw.lod !== 'exact')
        throw new TypeError('UVW canonical cliff item is invalid')
      const index = canonicalGridIndex(raw, grid)
      if (levels[index] !== undefined)
        throw new TypeError('UVW canonical cliff grid contains a duplicate coordinate')
      levels[index] = raw.level
      authored[index] = raw.authored
    }
    if (levels.some(value => value === undefined) || authored.some(value => value === undefined))
      throw new TypeError('UVW canonical cliff grid is incomplete')
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'cliffs',
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      levels: gridRows(levels as number[], grid.columns, grid.rows),
      authored: gridRows(authored as boolean[], grid.columns, grid.rows),
    })
  }
  if (layer.kind === 'water') {
    const waterMaterials = layer.waterMaterials
    const resources = (value: string | undefined): string | undefined =>
      value?.startsWith('uvw-resource:') === true ? localResourceId(value, spaceId) : undefined
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'water',
      ...label,
      ...(waterMaterials === undefined
        ? {}
        : {
            materials: Object.freeze(
              waterMaterials.map(material =>
                Object.freeze({
                  id: material.materialId,
                  ...(material.label === undefined ? {} : { label: material.label }),
                  ...(material.classification === undefined
                    ? {}
                    : { classification: material.classification }),
                  ...(material.shorelineMode === undefined
                    ? {}
                    : { shorelineMode: material.shorelineMode }),
                  color: material.color,
                  ...(resources(material.baseColorResourceId) === undefined
                    ? {}
                    : { baseColorResourceId: resources(material.baseColorResourceId)! }),
                  ...(resources(material.secondaryColorResourceId) === undefined
                    ? {}
                    : {
                        secondaryColorResourceId: resources(material.secondaryColorResourceId)!,
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
                  ...(resources(material.causticsResourceId) === undefined
                    ? {}
                    : { causticsResourceId: resources(material.causticsResourceId)! }),
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
          }),
      zones: Object.freeze(
        items.map(raw => {
          if (
            raw.facet !== 'water' ||
            raw.uvwMinimum === undefined ||
            raw.uvwMaximum === undefined ||
            !finite(raw.uvwElevation)
          ) {
            throw new TypeError('UVW canonical water item lacks canonical bounds or elevation')
          }
          return Object.freeze({
            id: localId(raw.id, 'zone'),
            minimum: Object.freeze([raw.uvwMinimum.x, raw.uvwMinimum.z] as const),
            maximum: Object.freeze([raw.uvwMaximum.x, raw.uvwMaximum.z] as const),
            elevation: raw.uvwElevation,
            ...(raw.materialId === undefined ? {} : { materialId: raw.materialId }),
          })
        }),
      ),
    })
  }
  if (layer.kind === 'resources') {
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'resources',
      ...label,
      resources: Object.freeze(
        items.map(raw => {
          if (
            raw.facet !== 'resources' ||
            (raw.kind !== 'uvm' && raw.kind !== 'media') ||
            raw.uri === undefined
          ) {
            throw new TypeError('UVW canonical resource item is not a confined portable resource')
          }
          return Object.freeze({
            id: localResourceId(raw.id, spaceId),
            kind: raw.kind,
            uri: raw.uri,
            ...(raw.digest === undefined ? {} : { digest: raw.digest }),
          })
        }),
      ),
    })
  }
  if (layer.kind === 'objects') {
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'objects',
      ...label,
      instances: Object.freeze(
        // Presentation-only instances (authored cliff meshes) belong to their source facet.
        items.flatMap(raw => ((raw as WorldSceneObjectItem).derivedFrom === undefined ? [raw] : [])).map(raw => {
          const item = raw as WorldSceneObjectItem
          if (
            item.facet !== 'objects' ||
            item.uvwPosition === undefined ||
            item.uvwRotation === undefined
          ) {
            throw new TypeError('UVW canonical object item lacks canonical transform')
          }
          const scale = item.uvwScale ?? { x: 1, y: 1, z: 1 }
          return Object.freeze({
            id: localId(item.id, 'instance'),
            objectKind: item.kind,
            position: Object.freeze([
              item.uvwPosition.x,
              item.uvwPosition.y,
              item.uvwPosition.z,
            ] as const),
            rotation: item.uvwRotation,
            scale: Object.freeze([scale.x, scale.y, scale.z] as const),
            resourceIds: Object.freeze(
              (item.resourceIds ?? []).flatMap(resourceId =>
                resourceId.startsWith('uvw-resource:')
                  ? [localResourceId(resourceId, spaceId)]
                  : [],
              ),
            ),
            ...(item.modelComponents === undefined
              ? {}
              : {
                  modelComponents: Object.freeze(
                    item.modelComponents.flatMap(component =>
                      component.resourceId.startsWith('uvw-resource:')
                        ? [
                            Object.freeze({
                              ...component,
                              resourceId: localResourceId(component.resourceId, spaceId),
                            }),
                          ]
                        : [],
                    ),
                  ),
                }),
            ...(item.typeId === undefined ? {} : { typeId: item.typeId }),
            ...(item.player === undefined ? {} : { player: item.player }),
            ...(item.variation === undefined ? {} : { variation: item.variation }),
            ...(item.name === undefined ? {} : { name: item.name }),
          })
        }),
      ),
    })
  }
  if (layer.kind === 'regions') {
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'regions',
      ...label,
      regions: Object.freeze(
        items.map(raw => {
          if (raw.facet !== 'regions' || raw.uvwShapes === undefined) {
            throw new TypeError('UVW canonical region item lacks canonical geometry')
          }
          return Object.freeze({
            id: localId(raw.id, 'region'),
            name: raw.name,
            ...(raw.color === undefined ? {} : { color: raw.color }),
            shapes: Object.freeze(raw.uvwShapes.map(regionShape)),
          })
        }),
      ),
    })
  }
  if (layer.kind === 'navigation') {
    const grid = layer.grid
    if (grid === undefined)
      throw new TypeError('UVW canonical navigation layer is missing grid metadata')
    const values = new Array<number | undefined>(grid.columns * grid.rows)
    for (const raw of items) {
      if (raw.facet !== 'navigation' || raw.lod !== 'exact')
        throw new TypeError('UVW canonical navigation item is invalid')
      const index = canonicalGridIndex(raw, grid)
      if (values[index] !== undefined)
        throw new TypeError('UVW canonical navigation grid contains a duplicate coordinate')
      values[index] = raw.flags
    }
    if (values.some(value => value === undefined))
      throw new TypeError('UVW canonical navigation grid is incomplete')
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'navigation',
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      samples: gridRows(values as number[], grid.columns, grid.rows),
    })
  }
  if (layer.kind === 'gateways') {
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'gateways',
      ...label,
      segments: Object.freeze(
        items.map(raw => {
          if (raw.facet !== 'gateways' || raw.uvwStart === undefined || raw.uvwEnd === undefined) {
            throw new TypeError('UVW canonical gateway item lacks canonical endpoints')
          }
          return Object.freeze({
            id: localId(raw.id, 'gateway'),
            start: Object.freeze([raw.uvwStart.x, raw.uvwStart.z] as const),
            end: Object.freeze([raw.uvwEnd.x, raw.uvwEnd.z] as const),
          })
        }),
      ),
    })
  }
  if (layer.kind === 'lighting') {
    if (items.length !== 1 || items[0]?.facet !== 'lighting')
      throw new TypeError('UVW canonical lighting layer must contain one environment')
    const environment = items[0]
    const localDirectionalIds = environment.directional.map(light => localId(light.id, 'source'))
    const preserveDirectionalIds = environment.directional.every(
      (light, index) =>
        localDirectionalIds[index] === light.id &&
        (index === 0 || localDirectionalIds[index - 1]!.localeCompare(light.id) <= 0),
    )
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'lighting',
      ...label,
      ambientColor: environment.ambientColor,
      ambientIntensity: environment.ambientIntensity,
      directional: Object.freeze(
        environment.directional.map((light, index) =>
          Object.freeze({
            ...light,
            // UVW canonicalization sorts ids. Preserve the publisher's key/fill/back priority so
            // renderers that consume the first directional light keep the intended key light.
            // A canonical source already has valid sorted ids and must round-trip byte-for-byte.
            id: preserveDirectionalIds
              ? light.id
              : `light-${String(index).padStart(4, '0')}-${localDirectionalIds[index]}`,
          }),
        ),
      ),
    })
  }
  throw new TypeError(`UVW canonical layer facet ${layer.kind} is unsupported`)
}

export async function reconstructCanonicalUvw(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  options: CanonicalUvwReconstructionOptions,
): Promise<CanonicalUvwReconstruction> {
  const artifact = info.canonicalArtifact
  if (artifact?.format !== 'UVW' || artifact.version !== '1.0')
    throw new TypeError('source is not a canonical UVW artifact')
  const state = { pageRequests: 0, observedItems: 0 }
  const rawLayers = await drain(source, info, 'layers', undefined, options, state)
  const layers = rawLayers.map(item => {
    if (item.facet !== 'layers' || item.spaceId === undefined || item.localLayerId === undefined) {
      throw new TypeError('canonical UVW layer catalog omits local space/layer identity')
    }
    return item
  })
  const spaces = []
  for (const space of artifact.spaces) {
    const spaceLayers = layers.filter(layer => layer.spaceId === space.id)
    if (spaceLayers.length === 0)
      throw new TypeError(`canonical UVW space ${space.id} has no layers`)
    const reconstructed: UvwHeightfieldSpaceLayer[] = []
    for (const layer of spaceLayers)
      reconstructed.push(await reconstructLayer(source, info, layer, space.id, options, state))
    if (
      space.basis.handedness !== 'right' ||
      space.basis.upAxis !== 'y' ||
      space.basis.forwardAxis !== '+z' ||
      (space.basis.unit !== 'meter' && space.basis.unit !== 'source-unit')
    )
      throw new TypeError(`canonical UVW space ${space.id} has a non-canonical basis`)
    const basis: UvwBasis = Object.freeze({
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: space.basis.unit,
      ...(space.basis.metersPerUnit === undefined
        ? {}
        : { metersPerUnit: space.basis.metersPerUnit }),
      ...(space.basis.sourceUnit === undefined ? {} : { sourceUnit: space.basis.sourceUnit }),
      ...(space.basis.unitsPerCell === undefined ? {} : { unitsPerCell: space.basis.unitsPerCell }),
    })
    spaces.push(
      Object.freeze({
        id: space.id,
        topology: 'heightfield' as const,
        ...(space.label === undefined ? {} : { label: space.label }),
        basis,
        bounds: space.bounds,
        layers: Object.freeze(reconstructed),
      }),
    )
  }
  return Object.freeze({
    document: Object.freeze({
      uv: Object.freeze({ format: 'UVW', version: '1.0', status: 'profile' }),
      spaces: Object.freeze(spaces),
      connections: Object.freeze([]) as readonly [],
    }),
    pageRequests: state.pageRequests,
    observedItems: state.observedItems,
  })
}

export interface AdditionalExactLayers {
  readonly layers: readonly UvwHeightfieldSpaceLayer[]
  readonly retainedFacets: readonly string[]
  readonly pageRequests: number
  readonly observedItems: number
}

/** Reconstruct the exact native facets whose current common contract already proves UVW geometry. */
export async function reconstructAdditionalExactLayers(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  options: CanonicalUvwReconstructionOptions,
): Promise<AdditionalExactLayers> {
  const state = { pageRequests: 0, observedItems: 0 }
  const supported = new Set([
    'terrain-materials',
    'cliffs',
    'water',
    'objects',
    'regions',
    'gateways',
    'lighting',
  ])
  const candidates = info.facets.filter(
    facet =>
      supported.has(facet.facet) &&
      facet.state === 'available' &&
      (facet.lods.includes('exact') ||
        (facet.facet === 'terrain-materials' && facet.lods.includes('raster-exact'))),
  )
  if (candidates.length === 0) {
    return Object.freeze({
      layers: Object.freeze([]),
      retainedFacets: Object.freeze([]),
      pageRequests: 0,
      observedItems: 0,
    })
  }
  const catalog = (await drain(source, info, 'layers', undefined, options, state)).map(item => {
    if (item.facet !== 'layers')
      throw new TypeError('world layer catalog contains a non-layer item')
    return item
  })
  const layers: UvwHeightfieldSpaceLayer[] = []
  const retainedFacets: string[] = []
  for (const facet of candidates) {
    const layer = catalog.find(item => item.layerId === facet.layerId && item.kind === facet.facet)
    if (layer === undefined)
      throw new TypeError(`exact ${facet.facet} facet is absent from the world layer catalog`)
    const reconstructed = await reconstructLayer(source, info, layer, 'main', options, state)
    layers.push(reconstructed)
    if (reconstructed.kind === 'terrain-materials' && reconstructed.weightRasters !== undefined) {
      layers.push(
        Object.freeze({
          schemaVersion: 1,
          id: `${reconstructed.id}-weight-resources`,
          kind: 'resources',
          label: 'Terrain weight raster resources',
          resources: Object.freeze(
            reconstructed.weightRasters.map(raster =>
              Object.freeze({
                id: raster.resourceId,
                kind: 'media',
                uri: `media/terrain/${raster.resourceId}.rgba`,
              }),
            ),
          ),
        }),
      )
    }
    retainedFacets.push(facet.facet)
  }
  return Object.freeze({
    layers: Object.freeze(layers),
    retainedFacets: Object.freeze(retainedFacets),
    pageRequests: state.pageRequests,
    observedItems: state.observedItems,
  })
}
