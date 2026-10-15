/** Core-owned reconstruction of qualified world facets into normative UVW. Preserves admitted
 * atlas tiles/coverage, corrects native reverse-row cell anchors, and reports unsupported fields. */
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  MapWorldCanonicalTransform,
  WorldSceneItem,
  WorldSceneLayerItem,
  WorldSceneObjectItem,
  WorldSceneTerrainItem,
  WorldSceneSurfaceItem,
} from '@modkit/sdk/maps'

import type {
  UvwHeightfieldSpaceLayer,
  UvwBasis,
  UvwProfileDocument,
  UvwRegionShape,
  UvwTerrainMaterialSample,
  UvwObjectLatticeCoverage,
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

/** A complete publisher classification is carried by cell anchors, not boundary vertices. */
export function cliffFacesFromTerrain(
  items: readonly WorldSceneTerrainItem[],
  columns: number,
  rows: number,
  sourceRowOrder: 'forward' | 'reverse',
): readonly Readonly<{ x: number; y: number }>[] | undefined {
  const cells: { x: number; y: number }[] = []
  let known = 0
  for (const item of items) {
    if (item.cliffFace === undefined) continue
    if (typeof item.cliffFace !== 'boolean' || item.x >= columns - 1 || item.y >= rows - 1)
      throw new TypeError('cliff classification must name an interior heightfield cell')
    known += 1
    if (item.cliffFace)
      cells.push({ x: item.x, y: sourceRowOrder === 'reverse' ? rows - 2 - item.y : item.y })
  }
  if (known === 0) return undefined
  if (known !== (columns - 1) * (rows - 1))
    throw new TypeError('cliff classification is incomplete')
  cells.sort((left, right) => left.y - right.y || left.x - right.x)
  return Object.freeze(cells.map(cell => Object.freeze(cell)))
}

/** A source id as a UVW id: its last `:` segment when already one, else `<prefix>-<slug>`. */
export function localId(id: string, prefix = 'item'): string {
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
  sampling: 'vertex' | 'cell' = 'vertex',
): number {
  const offset = sampling === 'cell' ? grid.cellSize / 2 : 0
  if (item.uvwPosition === undefined) return gridIndex(item, grid.columns, grid.rows)
  const x = Math.round((item.uvwPosition.x - (grid.origin[0] + offset)) / grid.cellSize)
  const y = Math.round((item.uvwPosition.z - (grid.origin[2] + offset)) / grid.cellSize)
  const expectedX = (grid.origin[0] + offset) + x * grid.cellSize
  const expectedZ = (grid.origin[2] + offset) + y * grid.cellSize
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

/**
 * Light directions in UVW axes: a canonical environment's as published, a map-native one's through
 * the linear part of the admitted transform, renormalized (Emperor's sun, z down in map-native,
 * would otherwise light UVW from below). A light in any other space has no way into UVW.
 */
function canonicalLightDirection(
  coordinateSpaceId: string,
  transform: MapWorldCanonicalTransform | undefined,
): (direction: readonly [number, number, number]) => readonly [number, number, number] {
  if (coordinateSpaceId === 'uvw-canonical' || coordinateSpaceId.startsWith('uvw-space:'))
    return direction => direction
  if (coordinateSpaceId !== 'map-native' || transform === undefined)
    throw new TypeError(`UVW lighting in ${coordinateSpaceId} has no transform into UVW axes`)
  const sourceIndex = { x: 0, y: 1, z: 2 } as const
  return direction => {
    const axis = (name: 'x' | 'y' | 'z'): number =>
      direction[sourceIndex[transform.axes[name].sourceAxis]] * transform.axes[name].scale
    const value = [axis('x'), axis('y'), axis('z')] as const
    const length = Math.hypot(...value)
    if (!(length > 0)) throw new TypeError('UVW light direction has no length')
    // `+ 0` turns the -0 of a negative scale into 0
    return Object.freeze([
      value[0] / length + 0,
      value[1] / length + 0,
      value[2] / length + 0,
    ] as const)
  }
}

const PLACING_FIELDS = [
  'facet',
  'id',
  'layerId',
  'coordinateSpaceId',
  'lod',
  'mapNativePosition',
  'zoneId',
]
/**
 * The item fields each facet writes into UVW, or that only place the item (its ids, the native
 * coordinates its canonical ones stand for). Any other field an item carries is not in the UVW, and
 * the receipt names it with how many items had it (lostFields).
 */
const KEPT_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  // Resource requirements are lookup context for retained IDs, not an additional authored field.
  // overlayAlpha has the value-sensitive coverage loss check in reconstructLayer below.
  'terrain-materials.materials': new Set([
    'materialId', 'label', 'classification', 'sourceIndex', 'atlas', 'baseColorFactor',
    'baseColorResourceId', 'baseColorResource', 'normalResourceId', 'normalResource',
    'specularResourceId', 'specularResource', 'uvTransform', 'overlayAlpha',
    'normalEncoding', 'specularEncoding',
  ]),
  'water.materials': new Set([
    'materialId', 'label', 'classification', 'shorelineMode', 'color',
    'baseColorResourceId', 'baseColorResource', 'secondaryColorResourceId', 'secondaryColorResource',
    'uvScale', 'scroll', 'colorFalloff', 'specularity', 'specularScale', 'reflectivityPower',
    'normalResourceId', 'normalResource', 'causticsFrameResourceIds', 'causticsFalloff', 'causticsResourceId', 'causticsResource', 'causticsFrameResources',
    'causticsScale', 'causticsFramesPerSecond', 'receiveShadows',
  ]),
  terrain: new Set(['x', 'y', 'heightBase', 'heightAdjustment', 'uvwPosition', 'cliffFace']),
  'terrain-materials': new Set([
    'x',
    'y',
    'uvwPosition',
    'weights',
    'textureIndex',
    'uvTransform',
    'cornerUv',
    'layers',
  ]),
  cliffs: new Set(['x', 'y', 'uvwPosition', 'level', 'authored']),
  water: new Set([
    'minimum',
    'maximum',
    'elevation',
    'uvwMinimum',
    'uvwMaximum',
    'uvwElevation',
    'materialId',
  ]),
  regions: new Set(['regionId', 'name', 'color', 'shapes', 'uvwShapes']),
  navigation: new Set(['x', 'y', 'flags', 'uvwPosition']),
  traversal: new Set(['x', 'y', 'walkable', 'exits', 'uvwPosition']),
  'game-raster': new Set(['x','y','value','uvwPosition']),
  gateways: new Set(['x1', 'y1', 'x2', 'y2', 'uvwStart', 'uvwEnd']),
  lighting: new Set(['ambientColor', 'ambientIntensity', 'toneMapping', 'terrain', 'directional', 'model', 'unlitColor']),
  objects: new Set([
    'kind',
    'objectId',
    'sourceObjectId',
    'sourceKey',
    'position',
    'sourcePositionDimensions',
    'heightReference',
    'rotation',
    'nativeRotationUnit',
    'nativeRotationSense',
    'presentationRotation',
    'scale',
    'mapNativePresentationPosition',
    'uvwPosition',
    'uvwRotation',
    'uvwPresentationRotation',
    'uvwScale',
    'derivedFrom',
    'typeId',
    'player',
    'variation',
    'name',
    'resourceIds',
    'modelComponents',
    'presentationTint',
    'presentationAnimation',
    'latticeCoverage',
    'uvwLatticeCoverage',
  ]),
})

/** A tint UVW holds: multiplication factors within 0..1. */
const unitTint = (tint: readonly number[]): boolean =>
  tint.every(factor => Number.isFinite(factor) && factor >= 0 && factor <= 1)

const LATTICE_CHANNELS = ['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const

function objectLatticeForUvw(
  item: WorldSceneObjectItem,
  info: CandidateWorldSceneInfo,
): UvwObjectLatticeCoverage | undefined {
  const native = item.latticeCoverage
  const projected = item.uvwLatticeCoverage
  if (native === undefined && projected === undefined) return undefined
  if (native !== undefined && LATTICE_CHANNELS.some(channel => native[channel] !== undefined && projected?.[channel] === undefined))
    throw new TypeError('publisher lattice polygons have no proved UVW projection')
  const kind = native?.resourceKind
  const scope = native?.resourceKindScope ?? info.gameId
  if ((kind !== undefined && scope === undefined) || (native?.resourceKindScope !== undefined && kind === undefined))
    throw new TypeError('publisher resource kind has no exact game scope')
  return Object.freeze({
    ...(native?.roles === undefined ? {} : { roles: native.roles }),
    ...(kind === undefined ? {} : { resourceKind: kind, resourceKindScope: scope! }),
    ...Object.fromEntries(LATTICE_CHANNELS.flatMap(channel => projected?.[channel] === undefined
      ? [] : [[channel, projected[channel]]])),
  })
}

/** Cliff presentation meshes have their own UVW marker; assembled-object helper instances do not. */
export function isRetainedWorldObject(item: Pick<WorldSceneObjectItem, 'derivedFrom' | 'kind'>): boolean {
  if (item.derivedFrom === 'cliffs' && item.kind !== 'doodad')
    throw new TypeError('only a doodad may be a derived cliff presentation piece')
  return item.derivedFrom === undefined || item.derivedFrom === 'cliffs'
}

/** One object-field loss, even when several references in that field are unresolved. */
export function hasUnpackagedWorldObjectResources(
  object: Pick<WorldSceneObjectItem, 'resourceIds' | 'modelComponents'>,
  isPackaged: (id: string) => boolean = id => id.startsWith('uvw-resource:'),
): boolean {
  return (object.resourceIds ?? []).some(id => !isPackaged(id)) ||
    (object.modelComponents ?? []).some(component => !isPackaged(component.resourceId))
}

/** One field-loss counter for source items and material catalogs; false and zero remain facts. */
function noteUnretainedFields(
  kind: string,
  record: Readonly<Record<string, unknown>>,
  lost: Map<string, number>,
): void {
  const kept = KEPT_FIELDS[kind]
  if (kept === undefined) return
  for (const [key, value] of Object.entries(record)) {
    const unretainedWaterResource = kind === 'water.materials' && (
      (key === 'normalResourceId' && typeof value === 'string' && !value.startsWith('uvw-resource:')) ||
      (key === 'causticsFrameResourceIds' && Array.isArray(value) &&
        value.some(id => typeof id !== 'string' || !id.startsWith('uvw-resource:')))
    )
    if (value !== undefined && !PLACING_FIELDS.includes(key) && (!kept.has(key) || unretainedWaterResource)) {
      const path = `world.${kind}.${key}`
      lost.set(path, (lost.get(path) ?? 0) + 1)
    }
  }
}

/** Counts, per facet field, the items whose field the UVW leaves out (see KEPT_FIELDS). */
function noteLostFields(
  kind: string,
  items: readonly WorldSceneItem[],
  lost: Map<string, number>,
): void {
  const kept = KEPT_FIELDS[kind]
  if (kept === undefined) return
  const add = (path: string) => lost.set(path, (lost.get(path) ?? 0) + 1)
  for (const item of items) {
    const record = item as unknown as Readonly<Record<string, unknown>>
    // An assembled-object helper belongs to its source facet and is never exported; an object
    // without a canonical place is left out whole (omittedObjects)
    if (
      (kind === 'objects' && !isRetainedWorldObject(item as WorldSceneObjectItem)) ||
      (kind === 'objects' &&
        (record['uvwPosition'] === undefined || record['uvwRotation'] === undefined))
    )
      continue
    noteUnretainedFields(kind, record, lost)
    if (item.facet === 'terrain-materials') {
      if (item.layers?.[0]?.cornerUv !== undefined || item.layers?.[0]?.clipPolygon !== undefined)
        add('world.terrain-materials.layers (base not representable)')
      for (const layer of item.layers ?? []) {
        if (layer.drawOrder !== undefined) add('world.terrain-materials.layers.drawOrder')
        if (layer.cornerUv !== undefined) add('world.terrain-materials.layers.cornerUv')
        if (layer.clipPolygon !== undefined) add('world.terrain-materials.layers.clipPolygon')
      }
    }
    if (kind !== 'objects') continue
    // only resources the UVW package holds are written; a model named only by the host is not
    const object = item as WorldSceneObjectItem
    if (object.presentationRotation !== undefined && object.uvwPresentationRotation === undefined)
      add('world.objects.presentationRotation')
    if (object.presentationTint !== undefined && !unitTint(object.presentationTint))
      add('world.objects.presentationTint (outside 0..1)')
    if (hasUnpackagedWorldObjectResources(object))
      add('world.objects.resourceIds (not packaged)')
  }
}

async function reconstructLayer(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  layer: WorldSceneLayerItem,
  spaceId: string,
  options: CanonicalUvwReconstructionOptions,
  state: {
    pageRequests: number
    observedItems: number
    omittedObjects?: number
    lostFields?: Map<string, number>
  },
): Promise<UvwHeightfieldSpaceLayer> {
  const id = layer.localLayerId ?? localId(layer.layerId)
  const label = layerLabel(layer)
  // Catalog metadata does not travel in facet pages. Count it once per material, including
  // raster-only layers that return before draining any terrain-material sample pages.
  if (state.lostFields !== undefined) {
    const catalog = layer.kind === 'terrain-materials' ? layer.materials
      : layer.kind === 'water' ? layer.waterMaterials : undefined
    for (const material of catalog ?? [])
      noteUnretainedFields(`${layer.kind}.materials`,
        material as unknown as Readonly<Record<string, unknown>>, state.lostFields)
  }
  // UVW currently cannot retain the publisher's overlay alpha policy; report the visual loss.
  const coverageMaterials = layer.materials?.filter(material => material.overlayAlpha === 'coverage').length ?? 0
  if (coverageMaterials > 0 && state.lostFields !== undefined)
    state.lostFields.set(
      'world.terrain-materials.materials.overlayAlpha',
      (state.lostFields.get('world.terrain-materials.materials.overlayAlpha') ?? 0) + coverageMaterials,
    )
  // UVW holds no derivation: a raster the publisher approximated reads there as the map's own
  const presentationRasters =
    layer.weightRasters?.filter(raster => raster.derivation === 'presentation').length ?? 0
  if (presentationRasters > 0 && state.lostFields !== undefined)
    state.lostFields.set(
      'world.layers.weightRasters.derivation',
      (state.lostFields.get('world.layers.weightRasters.derivation') ?? 0) + presentationRasters,
    )
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
            id: localId(material.materialId, 'material'),
            ...(material.label === undefined ? {} : { label: material.label }),
            ...(material.classification === undefined
              ? {}
              : { classification: material.classification }),
            ...(material.sourceIndex === undefined ? {} : { sourceIndex: material.sourceIndex }),
            ...(material.atlas === undefined ? {} : { atlas: material.atlas }),
            ...(material.baseColorFactor === undefined
              ? {}
              : { baseColorFactor: material.baseColorFactor }),
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
            ...(material.normalEncoding === undefined ? {} : { normalEncoding: material.normalEncoding }),
            ...(material.specularEncoding === undefined ? {} : { specularEncoding: material.specularEncoding }),
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
            materialIds: raster.materialIds.map(materialId => localId(materialId, 'material')),
            encoding: raster.encoding,
            normalization: raster.normalization,
          }),
        ),
      ),
    })
  }
  const items = await drain(source, info, layer.kind, layer.layerId, options, state)
  if (state.lostFields !== undefined) noteLostFields(layer.kind, items, state.lostFields)
  if (layer.kind === 'terrain' || layer.kind === 'surfaces') {
    if ((layer.kind === 'terrain' && layer.heightfieldRole === 'query') ||
      (layer.kind === 'surfaces' && layer.heightfieldRole !== undefined && layer.heightfieldRole !== 'query'))
      throw new TypeError('heightfield role conflicts with its published facet')
    const grid = layer.grid
    if (grid === undefined)
      throw new TypeError('UVW canonical terrain layer is missing exact grid metadata')
    const fill = grid.noDataValue
    const values = new Array<number | undefined>(grid.columns * grid.rows).fill(fill)
    if (items.length !== layer.itemCount)
      throw new TypeError('UVW canonical heightfield sample count differs from its catalog')
    const seen = new Set<number>()
    for (const raw of items) {
      const item = raw as WorldSceneTerrainItem | WorldSceneSurfaceItem
      if (
        item.facet !== layer.kind ||
        item.lod !== 'exact' ||
        item.uvwPosition === undefined ||
        !finite(item.uvwPosition.y)
      ) {
        throw new TypeError('UVW canonical terrain item is invalid')
      }
      const index = gridIndex(item, grid.columns, grid.rows)
      if (seen.has(index))
        throw new TypeError('UVW canonical terrain grid contains a duplicate coordinate')
      seen.add(index)
      values[index] = item.uvwPosition.y
    }
    if (values.some(value => value === undefined))
      throw new TypeError('UVW canonical terrain has holes without noDataValue')
    const cliffFaces = layer.kind === 'surfaces' ? undefined : cliffFacesFromTerrain(
      items as readonly WorldSceneTerrainItem[], grid.columns, grid.rows, 'forward',
    )
    return Object.freeze({
      id,
      kind: 'heightfield',
      ...(layer.kind === 'surfaces' ? { role: 'query' as const } : layer.heightfieldRole === undefined ? {} : { role: layer.heightfieldRole }),
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      ...(fill === undefined ? {} : { noDataValue: fill }),
      ...(cliffFaces === undefined ? {} : { cliffFaces }),
      ...(layer.latticeOverview === undefined ? {} : {latticeOverview:layer.latticeOverview}),
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
    const reverseCells =
      info.canonicalArtifact === undefined &&
      info.uvwTransform?.heightfield.sourceRowOrder === 'reverse'
    // Native vertex-sized material grids anchor cells at the south-west vertex. Reversing
    // vertices alone moves each cell one row north; the terminal padding row stays terminal.
    if (
      reverseCells &&
      (grid.rows !== info.uvwTransform!.heightfield.rows ||
        grid.columns !== info.uvwTransform!.heightfield.columns)
    )
      throw new TypeError('UVW reverse material grid must match the qualified vertex grid')
    const corners = <T>(value: readonly T[] | undefined): readonly T[] | undefined =>
      value === undefined || !reverseCells ? value : [value[3]!, value[2]!, value[1]!, value[0]!]
    for (const raw of items) {
      if (raw.facet !== 'terrain-materials' || raw.lod !== 'exact')
        throw new TypeError('UVW canonical terrain-material item is invalid')
      if (reverseCells) gridIndex(raw, grid.columns, grid.rows)
      const index = reverseCells
        ? gridIndex(
            { x: raw.x, y: raw.y === grid.rows - 1 ? raw.y : grid.rows - 2 - raw.y },
            grid.columns,
            grid.rows,
          )
        : canonicalGridIndex(raw, grid)
      if (values[index] !== undefined)
        throw new TypeError('UVW canonical terrain-material grid contains a duplicate coordinate')
      // A clipped/custom-UV layer cannot become an ordinary full-cell tile without changing its footprint.
      const base = raw.layers?.[0]
      const layers =
        base?.cornerUv !== undefined || base?.clipPolygon !== undefined
          ? undefined
          : raw.layers?.filter(
              layer => layer.cornerUv === undefined && layer.clipPolygon === undefined,
            )
      if (reverseCells && raw.uvTransform !== undefined)
        throw new TypeError('UVW reverse material sample transform is not qualified')
      const weights =
        raw.weights ??
        (layers !== undefined && layers.length > 0
          ? undefined
          : [
              Object.freeze({
                materialId:
                  definitions.find(item => item.sourceIndex === raw.textureIndex)?.materialId ??
                  definitions[0]!.materialId,
                weight: 1,
              }),
            ])
      values[index] = Object.freeze({
        ...(weights === undefined
          ? {}
          : {
              weights: Object.freeze(
                weights.map(weight =>
                  Object.freeze({
                    materialId: localId(weight.materialId, 'material'),
                    weight: weight.weight,
                  }),
                ),
              ),
            }),
        ...(layers === undefined || layers.length === 0
          ? {}
          : {
              layers: Object.freeze(
                layers.map(layer =>
                  Object.freeze({
                    materialId: localId(layer.materialId, 'material'),
                    tile: layer.tile,
                    ...(layer.cornerAlpha === undefined
                      ? {}
                      : { cornerAlpha: corners(layer.cornerAlpha) as typeof layer.cornerAlpha }),
                  }),
                ),
              ),
            }),
        ...(raw.uvTransform === undefined ? {} : { uvTransform: raw.uvTransform }),
        ...(raw.cornerUv === undefined
          ? {}
          : { cornerUv: corners(raw.cornerUv) as typeof raw.cornerUv }),
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
            id: localId(material.materialId, 'material'),
            ...(material.label === undefined ? {} : { label: material.label }),
            ...(material.classification === undefined
              ? {}
              : { classification: material.classification }),
            ...(material.sourceIndex === undefined ? {} : { sourceIndex: material.sourceIndex }),
            ...(material.atlas === undefined
              ? {}
              : {
                  atlas: reverseCells
                    ? {
                        ...material.atlas,
                        tileTop:
                          material.atlas.tileTop === 'local-y-0'
                            ? ('local-y-1' as const)
                            : ('local-y-0' as const),
                      }
                    : material.atlas,
                }),
            ...(material.baseColorFactor === undefined
              ? {}
              : { baseColorFactor: material.baseColorFactor }),
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
            ...(material.normalEncoding === undefined ? {} : { normalEncoding: material.normalEncoding }),
            ...(material.specularEncoding === undefined ? {} : { specularEncoding: material.specularEncoding }),
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
                  materialIds: raster.materialIds.map(materialId => localId(materialId, 'material')),
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
    const levels = new Array<number | undefined>(grid.columns * grid.rows).fill(undefined)
    const authored = new Array<boolean | undefined>(grid.columns * grid.rows).fill(undefined)
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
                  id: localId(material.materialId, 'material'),
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
                  ...(resources(material.normalResourceId) === undefined ? {} : { normalResourceId: resources(material.normalResourceId)! }),
                  ...(material.causticsFrameResourceIds === undefined || material.causticsFrameResourceIds.some(value => resources(value) === undefined)
                    ? {} : { causticsFrameResourceIds: Object.freeze(material.causticsFrameResourceIds.map(value => resources(value)!)) }),
                  ...(material.causticsFalloff === undefined ? {} : { causticsFalloff: material.causticsFalloff }),
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
            ...(raw.materialId === undefined
              ? {}
              : { materialId: waterMaterials?.some(material => material.materialId === raw.materialId)
                  ? localId(raw.materialId, 'material')
                  : raw.materialId }),
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
    const seenInstances = new Set<string>()
    return Object.freeze({
      schemaVersion: 1,
      id,
      kind: 'objects',
      ...label,
      instances: Object.freeze(
        items.flatMap(raw => {
          const item = raw as WorldSceneObjectItem
          if (item.facet !== 'objects') throw new TypeError('UVW object layer item is not an object')
          if (!isRetainedWorldObject(item)) return []
          // An object without a canonical place (a 2D unit) or a repeated id is lost alone and
          // counted, not the whole facet with it.
          const instanceId = localId(item.id, 'instance')
          if (
            item.uvwPosition === undefined ||
            item.uvwRotation === undefined ||
            seenInstances.has(instanceId)
          ) {
            state.omittedObjects = (state.omittedObjects ?? 0) + 1
            return []
          }
          seenInstances.add(instanceId)
          const scale = item.uvwScale ?? { x: 1, y: 1, z: 1 }
          const latticeCoverage = objectLatticeForUvw(item, info)
          return [
            Object.freeze({
              id: instanceId,
              objectKind: item.kind,
              ...(item.derivedFrom === 'cliffs' ? { derivedFrom: 'cliffs' as const } : {}),
              position: Object.freeze([
                item.uvwPosition.x,
                item.uvwPosition.y,
                item.uvwPosition.z,
              ] as const),
              rotation: item.uvwRotation,
              ...(item.uvwPresentationRotation === undefined
                ? {}
                : { presentationRotation: item.uvwPresentationRotation }),
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
              ...(item.presentationTint === undefined || !unitTint(item.presentationTint)
                ? {}
                : { presentationTint: item.presentationTint }),
              ...(item.presentationAnimation === undefined
                ? {}
                : { presentationAnimation: item.presentationAnimation }),
              ...(latticeCoverage === undefined ? {} : { latticeCoverage }),
            }),
          ]
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
    const values = new Array<number | undefined>(grid.columns * grid.rows).fill(undefined)
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
      ...(layer.navigationFlagEncoding === undefined ? {} : { flagEncoding: layer.navigationFlagEncoding }),
      ...label,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      origin: grid.origin,
      samples: gridRows(values as number[], grid.columns, grid.rows),
    })
  }
  if (layer.kind === 'game-raster') {
    const grid = layer.grid, metadata = layer.gameRaster
    if (grid === undefined || metadata === undefined) throw new TypeError('game raster lacks grid or value metadata')
    const values = new Array<number | undefined>(grid.columns * grid.rows).fill(undefined)
    for (const raw of items) {
      if (raw.facet !== 'game-raster' || raw.lod !== 'exact') throw new TypeError('game raster item is not exact')
      const index = canonicalGridIndex(raw, grid, metadata.sampling)
      if (values[index] !== undefined) throw new TypeError('game raster contains duplicate coordinates')
      values[index] = raw.value
    }
    if (values.some(value => value === undefined)) throw new TypeError('game raster is incomplete')
    return Object.freeze({ schemaVersion: 1, id, kind: 'game-raster', ...label, ...metadata,
      columns: grid.columns, rows: grid.rows, cellSize: grid.cellSize, origin: grid.origin,
      samples: gridRows(values as number[], grid.columns, grid.rows) })
  }
  if (layer.kind === 'traversal') {
    const grid = layer.grid, metadata = layer.traversal
    if (grid === undefined || metadata === undefined)
      throw new TypeError('UVW traversal lacks grid or class metadata')
    const cells = new Array<{ walkable: boolean; exits: number } | undefined>(grid.columns * grid.rows).fill(undefined)
    for (const raw of items) {
      if (raw.facet !== 'traversal' || raw.lod !== 'exact') throw new TypeError('UVW traversal item is not exact')
      const index = canonicalGridIndex(raw, grid, 'cell')
      if (cells[index] !== undefined) throw new TypeError('UVW traversal has duplicate cells')
      cells[index] = { walkable: raw.walkable, exits: raw.exits }
    }
    if (cells.some(cell => cell === undefined)) throw new TypeError('UVW traversal is incomplete')
    return Object.freeze({ schemaVersion: 1, id, kind: 'traversal', ...label,
      classId: metadata.classId, ...(metadata.surfaceLayerId === undefined ? {} : { surfaceLayerId: metadata.surfaceLayerId }),
      columns: grid.columns, rows: grid.rows, cellSize: grid.cellSize, origin: grid.origin,
      walkable: gridRows(cells.map(cell => cell!.walkable), grid.columns, grid.rows),
      exits: gridRows(cells.map(cell => cell!.exits), grid.columns, grid.rows) })
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
    const direction = canonicalLightDirection(environment.coordinateSpaceId, info.uvwTransform)
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
      ...(environment.model === undefined ? {} : { model: environment.model }),
      ...(environment.unlitColor === undefined ? {} : { unlitColor: environment.unlitColor }),
      ambientColor: environment.ambientColor,
      ambientIntensity: environment.ambientIntensity,
      ...(environment.toneMapping === undefined ? {} : { toneMapping: environment.toneMapping }),
      ...(environment.terrain === undefined ? {} : { terrain: environment.terrain }),
      directional: Object.freeze(
        environment.directional.map((light, index) =>
          Object.freeze({
            ...light,
            direction: direction(light.direction),
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
        topology: space.topology ?? 'heightfield',
        ...(space.label === undefined ? {} : { label: space.label }),
        basis,
        bounds: space.bounds,
        layers: Object.freeze(reconstructed),
        ...(space.camera === undefined ? {} : { camera: space.camera }),
        ...(space.players === undefined ? {} : { players: space.players }),
        ...(space.startPositions === undefined ? {} : { startPositions: space.startPositions }),
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
  readonly retainedLayerIds: readonly string[]
  readonly pageRequests: number
  readonly observedItems: number
  /** Objects left out alone: no canonical place (a 2D unit) or a repeated id. */
  readonly omittedObjects: number
  /** Item fields the UVW leaves out, by `world.<facet>.<field>`, with how many items had them. */
  readonly lostFields: readonly { readonly path: string; readonly count: number }[]
}

/** Reconstruct the exact native facets whose current common contract already proves UVW geometry. */
export async function reconstructAdditionalExactLayers(
  source: CandidateWorldSceneSource,
  info: CandidateWorldSceneInfo,
  options: CanonicalUvwReconstructionOptions,
  reservedLayerIds: readonly string[] = [],
): Promise<AdditionalExactLayers> {
  const state = {
    pageRequests: 0,
    observedItems: 0,
    omittedObjects: 0,
    lostFields: new Map<string, number>(),
  }
  const supported = new Set([
    'navigation',
    'game-raster',
    'surfaces',
    'traversal',
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
      // a partial object facet keeps its placed objects; the rest are counted, not the facet lost
      (facet.state === 'available' || (facet.facet === 'objects' && facet.state === 'partial')) &&
      (facet.lods.includes('exact') ||
        (facet.facet === 'terrain-materials' && facet.lods.includes('raster-exact'))),
  )
  if (candidates.length === 0) {
    return Object.freeze({
      layers: Object.freeze([]),
      retainedLayerIds: Object.freeze([]),
      pageRequests: 0,
      observedItems: 0,
      omittedObjects: 0,
      lostFields: Object.freeze([]),
    })
  }
  const catalog = (await drain(source, info, 'layers', undefined, options, state)).map(item => {
    if (item.facet !== 'layers')
      throw new TypeError('world layer catalog contains a non-layer item')
    return item
  })
  // Native opaque field names can coincide with ground or other facets. Preserve existing
  // names where possible and reserve every preferred name before allocating a fallback.
  // Canonical UVW uses the separate reconstruction path and retains authored identities.
  const preferredIds = new Set([...reservedLayerIds, ...catalog.flatMap(layer => {
    const id = layer.localLayerId ?? localId(layer.layerId)
    return layer.kind === 'terrain-materials' ? [id, `${id}-weight-resources`] : [id]
  })])
  const occupiedIds = new Set([...reservedLayerIds, ...catalog.flatMap(layer => {
    const id = layer.localLayerId ?? localId(layer.layerId)
    if (layer.kind === 'game-raster') return []
    return layer.kind === 'terrain-materials' ? [id, `${id}-weight-resources`] : [id]
  })])
  const layers: UvwHeightfieldSpaceLayer[] = []
  const retainedLayerIds: string[] = []
  for (const facet of candidates) {
    const layer = catalog.find(item => item.layerId === facet.layerId && item.kind === facet.facet)
    if (layer === undefined)
      throw new TypeError(`exact ${facet.facet} facet is absent from the world layer catalog`)
    let selected = layer
    if (layer.kind === 'game-raster') {
      const preferred = layer.localLayerId ?? localId(layer.layerId)
      let id = preferred
      if (occupiedIds.has(id)) {
        id = `${preferred}-game-raster`
        for (let suffix = 2; preferredIds.has(id); suffix += 1) id = `${preferred}-game-raster-${suffix}`
      }
      occupiedIds.add(id); preferredIds.add(id)
      selected = { ...layer, localLayerId: id }
    }
    const reconstructed = await reconstructLayer(source, info, selected, 'main', options, state)
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
    retainedLayerIds.push(facet.layerId)
  }
  return Object.freeze({
    layers: Object.freeze(layers),
    retainedLayerIds: Object.freeze(retainedLayerIds),
    pageRequests: state.pageRequests,
    observedItems: state.observedItems,
    omittedObjects: state.omittedObjects,
    lostFields: Object.freeze(
      [...state.lostFields]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, count]) => Object.freeze({ path, count })),
    ),
  })
}
