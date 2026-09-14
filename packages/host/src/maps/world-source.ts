/** Generic structural adapter from authoritative map semantics to a paged publisher candidate. */

import { diagnostic } from '@modkit/core'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  Lease,
  MapTerrainMaterialDefinition,
  MapTerrainNativeTransform,
  MapTerrainSample,
  MapTerrainWeightRaster,
  MapWorldCanonicalTransform,
  ModelResourcePort,
  RasterResourcePort,
  RasterResourceResult,
  ResolvedMapWorkspaceSnapshot,
  ResourceProvenanceRecord,
  SceneRendererTexture,
  WorldSceneFacetState,
  WorldSceneItem,
  WorldSceneLayerKind,
  WorldSceneModelRequest,
  WorldSceneTextureRequest,
  WorldSceneObjectItem,
  WorldScenePage,
  WorldScenePageRequest,
  WorldSceneRegionShape,
} from '@modkit/sdk'

function positiveLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`world page limit must be between 1 and ${maximum}`)
  }
  return value
}

function childResourceLogicalId(parentLogicalId: string, childLogicalId: string): string {
  const childRoot = childLogicalId.split('/')[0]
  if (childRoot === undefined || childRoot.length === 0) return childLogicalId
  const parent = parentLogicalId.split('/')
  const sharedRoot = parent.findIndex(segment => segment.toLowerCase() === childRoot.toLowerCase())
  if (sharedRoot <= 0) return childLogicalId
  return [...parent.slice(0, sharedRoot), childLogicalId].join('/')
}

function worldTexture(
  id: string,
  result: Extract<RasterResourceResult, { readonly state: 'decoded' }>,
): SceneRendererTexture | undefined {
  if (result.info.orientation === 'unknown') return undefined
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

function resourceId(namespace: string, entityId: string): string {
  return `resource:${encodeURIComponent(namespace)}/${encodeURIComponent(entityId)}`
}

function modelResourceId(requirementId: string): string {
  return `model-resource:${encodeURIComponent(requirementId)}`
}

function layerId(kind: WorldSceneLayerKind): string {
  return `main/${kind}`
}

function layerContentRevision(items: readonly WorldSceneItem[]): string {
  const text = JSON.stringify(items, (key, value) =>
    key === 'id' || key === 'layerId' ? undefined : value,
  )
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${items.length}`
}

function terrainMaterialContentRevision(
  items: readonly WorldSceneItem[],
  rasters: readonly MapTerrainWeightRaster[],
): string {
  const text = JSON.stringify(
    [items, rasters.map(({ rgba: _rgba, ...metadata }) => metadata)],
    (key, value) => (key === 'id' || key === 'layerId' ? undefined : value),
  )
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  for (const raster of rasters) {
    for (const value of raster.rgba ?? []) {
      hash ^= value
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}:${items.length}:${rasters.length}`
}

function canonicalQuery(request: WorldScenePageRequest): string {
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
    throw new TypeError('world bounds must be finite ordered minimum/maximum coordinates')
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

function cursor(snapshotId: string, query: string, offset: number): string {
  return `${encodeURIComponent(snapshotId)}|${encodeURIComponent(query)}|${String(offset)}`
}

function cursorOffset(value: string | undefined, snapshotId: string, query: string): number {
  if (value === undefined) return 0
  const parts = value.split('|')
  if (parts.length !== 3) throw new TypeError('world cursor is malformed')
  let cursorSnapshot: string
  let cursorQuery: string
  try {
    cursorSnapshot = decodeURIComponent(parts[0] ?? '')
    cursorQuery = decodeURIComponent(parts[1] ?? '')
  } catch {
    throw new TypeError('world cursor is malformed')
  }
  const offset = Number(parts[2])
  if (cursorSnapshot !== snapshotId) {
    throw new TypeError('world cursor belongs to another or stale source snapshot')
  }
  if (cursorQuery !== query || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('world cursor does not match the requested layer, LOD or spatial query')
  }
  return offset
}

function numericPair(value: string | undefined): Readonly<{ x: number; y: number }> | undefined {
  if (value === undefined) return undefined
  const parts = value.split(',').map(item => Number(item.trim()))
  return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])
    ? Object.freeze({ x: parts[0] as number, y: parts[1] as number })
    : undefined
}

function regionShape(shape: {
  readonly type: string
  readonly parameters: Readonly<Record<string, string>>
}): WorldSceneRegionShape {
  const center = numericPair(shape.parameters['center'])
  const radiusValue = shape.parameters['radius']
  const radius = radiusValue === undefined ? undefined : Number(radiusValue)
  return Object.freeze({
    kind: shape.type,
    ...(center === undefined ? {} : { center }),
    ...(radius !== undefined && Number.isFinite(radius) ? { radius } : {}),
    rawParameters: shape.parameters,
  })
}

function pageItems(
  items: readonly WorldSceneItem[],
  request: WorldScenePageRequest,
  snapshotId: string,
  maximum: number,
): WorldScenePage {
  const limit = positiveLimit(request.limit, maximum)
  const query = canonicalQuery(request)
  const offset = cursorOffset(request.cursor, snapshotId, query)
  if (offset > items.length) throw new TypeError('world cursor offset is outside this facet')
  const selected = Object.freeze(items.slice(offset, offset + limit))
  const nextOffset = offset + selected.length
  return Object.freeze({
    snapshotId,
    facet: request.facet,
    state: 'available',
    items: selected,
    ...(nextOffset < items.length ? { nextCursor: cursor(snapshotId, query, nextOffset) } : {}),
  })
}

function hasExactTerrainGrid(
  terrain: NonNullable<ResolvedMapWorkspaceSnapshot['semantic']['terrain']> | undefined,
): boolean {
  if (terrain === undefined || terrain.samples.length !== terrain.cellCount) return false
  const expectedCellCount = terrain.width * terrain.height
  if (
    !Number.isSafeInteger(expectedCellCount) ||
    expectedCellCount <= 0 ||
    expectedCellCount !== terrain.cellCount
  ) {
    return false
  }
  return terrain.samples.every(
    (sample, index) =>
      sample.x === index % terrain.width && sample.y === Math.floor(index / terrain.width),
  )
}

function terrainMapNativePosition(
  sample: MapTerrainSample,
  transform: MapTerrainNativeTransform,
): Readonly<{ x: number; y: number; z: number }> {
  const vertical =
    'vertData' in transform
      ? (sample.heightBase * transform.vertData.quantizeScale - transform.vertData.quantizeBias) *
          transform.heightMap.scale.z +
        transform.heightMap.offset.z +
        (sample.heightAdjustment * transform.vertData.quantizeScale -
          transform.vertData.quantizeBias)
      : sample.heightBase * transform.heightMap.scale.z + transform.heightMap.offset.z
  return Object.freeze({
    x: transform.heightMap.offset.x + sample.x * transform.heightMap.scale.x,
    y: transform.heightMap.offset.y + sample.y * transform.heightMap.scale.y,
    z: vertical,
  })
}

function terrainHeightAt(
  position: Readonly<{ x: number; y: number }>,
  terrain: NonNullable<ResolvedMapWorkspaceSnapshot['semantic']['terrain']> | undefined,
  transform: MapTerrainNativeTransform | undefined,
): number | undefined {
  if (transform === undefined || terrain === undefined || !hasExactTerrainGrid(terrain))
    return undefined
  const gridX = (position.x - transform.heightMap.offset.x) / transform.heightMap.scale.x
  const gridY = (position.y - transform.heightMap.offset.y) / transform.heightMap.scale.y
  if (
    !Number.isFinite(gridX) ||
    !Number.isFinite(gridY) ||
    gridX < 0 ||
    gridY < 0 ||
    gridX > terrain.width - 1 ||
    gridY > terrain.height - 1
  ) {
    return undefined
  }
  const x0 = Math.floor(gridX)
  const y0 = Math.floor(gridY)
  const x1 = Math.min(x0 + 1, terrain.width - 1)
  const y1 = Math.min(y0 + 1, terrain.height - 1)
  const tx = gridX - x0
  const ty = gridY - y0
  const height = (x: number, y: number): number =>
    terrainMapNativePosition(terrain.samples[y * terrain.width + x]!, transform).z
  const lower = height(x0, y0) * (1 - tx) + height(x1, y0) * tx
  const upper = height(x0, y1) * (1 - tx) + height(x1, y1) * tx
  return lower * (1 - ty) + upper * ty
}

function canonicalPosition(
  position: Readonly<{ x: number; y: number; z: number }>,
  transform: MapWorldCanonicalTransform,
): Readonly<{ x: number; y: number; z: number }> {
  const axis = (output: 'x' | 'y' | 'z'): number => {
    const mapping = transform.axes[output]
    const value = position[mapping.sourceAxis] * mapping.scale + mapping.offset
    return value === 0 ? 0 : value
  }
  return Object.freeze({ x: axis('x'), y: axis('y'), z: axis('z') })
}

function canonicalObjectRotation(
  rotation: number | undefined,
  nativeUnit: string | undefined,
): readonly [number, number, number, number] | undefined {
  let radians: number
  if (rotation === undefined) radians = 0
  else if (nativeUnit === 'radians') radians = rotation
  else if (nativeUnit === 'degrees') radians = (rotation * Math.PI) / 180
  else if (nativeUnit === 'uint16-turn') radians = (rotation * Math.PI * 2) / 65_536
  else return undefined
  if (!Number.isFinite(radians)) return undefined
  const half = radians / 2
  const y = Math.sin(half)
  const w = Math.cos(half)
  return Object.freeze([0, y === 0 ? 0 : y, 0, w === 0 ? 0 : w])
}

function canonicalObjectScale(
  scale: Readonly<{ x: number; y: number; z: number }> | undefined,
  transform: MapWorldCanonicalTransform,
): Readonly<{ x: number; y: number; z: number }> {
  const source = scale ?? { x: 1, y: 1, z: 1 }
  return Object.freeze({
    x: source[transform.axes.x.sourceAxis],
    y: source[transform.axes.y.sourceAxis],
    z: source[transform.axes.z.sourceAxis],
  })
}

function canonicalRegionShape(
  shape: WorldSceneRegionShape,
  transform: MapWorldCanonicalTransform,
): WorldSceneRegionShape | undefined {
  const point = (value: Readonly<{ x: number; y: number }>) => {
    const canonical = canonicalPosition({ x: value.x, y: value.y, z: 0 }, transform)
    return Object.freeze({ x: canonical.x, y: canonical.z })
  }
  const horizontalScaleX = Math.abs(transform.axes.x.scale)
  const horizontalScaleZ = Math.abs(transform.axes.z.scale)
  if (shape.center !== undefined && shape.radius !== undefined) {
    if (horizontalScaleX !== horizontalScaleZ) return undefined
    return Object.freeze({
      ...shape,
      center: point(shape.center),
      radius: shape.radius * horizontalScaleX,
    })
  }
  if (shape.minimum !== undefined && shape.maximum !== undefined) {
    const corners = [
      point(shape.minimum),
      point({ x: shape.minimum.x, y: shape.maximum.y }),
      point(shape.maximum),
      point({ x: shape.maximum.x, y: shape.minimum.y }),
    ]
    return Object.freeze({
      ...shape,
      minimum: Object.freeze({
        x: Math.min(...corners.map(corner => corner.x)),
        y: Math.min(...corners.map(corner => corner.y)),
      }),
      maximum: Object.freeze({
        x: Math.max(...corners.map(corner => corner.x)),
        y: Math.max(...corners.map(corner => corner.y)),
      }),
    })
  }
  if (shape.points !== undefined) {
    return Object.freeze({ ...shape, points: Object.freeze(shape.points.map(point)) })
  }
  return undefined
}

function admittedTerrainTransform(
  snapshot: ResolvedMapWorkspaceSnapshot,
  terrain: ResolvedMapWorkspaceSnapshot['semantic']['terrain'],
  exact: boolean,
): MapTerrainNativeTransform | undefined {
  const transform = snapshot.terrainTransform
  if (transform === undefined || terrain === undefined || !exact) return undefined
  const finite = (value: number): boolean => Number.isFinite(value)
  const positive = (value: number): boolean => finite(value) && value > 0
  const verticalMappingValid = (value: MapTerrainNativeTransform): boolean => {
    if ('vertData' in value) {
      return (
        finite(value.vertData.quantizeBias) &&
        positive(value.vertData.quantizeScale) &&
        finite(value.vertData.standardHeight) &&
        value.mapping.vertical ===
          'dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment'
      )
    }
    return (
      value.mapping.vertical === 'direct-base-times-scale-plus-offset' &&
      value.source.format.length > 0 &&
      value.source.heightEncoding.length > 0 &&
      terrain.samples.every(sample => sample.heightAdjustment === 0)
    )
  }
  if (
    transform.schemaVersion !== 1 ||
    !Number.isSafeInteger(transform.descriptorVersion) ||
    transform.descriptorVersion <= 0 ||
    transform.snapshotId !== snapshot.snapshotId ||
    transform.heightMap.dim.length !== 2 ||
    transform.heightMap.dim[0] !== terrain.width ||
    transform.heightMap.dim[1] !== terrain.height ||
    !Object.values(transform.heightMap.offset).every(finite) ||
    !Object.values(transform.heightMap.scale).every(positive) ||
    transform.mapping.horizontal !== 'offset-plus-grid-index-times-scale' ||
    !verticalMappingValid(transform) ||
    transform.bounds.coordinateSpaceId !== 'map-native'
  ) {
    return undefined
  }
  let minimum = { x: Infinity, y: Infinity, z: Infinity }
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const sample of terrain.samples) {
    const position = terrainMapNativePosition(sample, transform)
    if (!Object.values(position).every(finite)) return undefined
    minimum = {
      x: Math.min(minimum.x, position.x),
      y: Math.min(minimum.y, position.y),
      z: Math.min(minimum.z, position.z),
    }
    maximum = {
      x: Math.max(maximum.x, position.x),
      y: Math.max(maximum.y, position.y),
      z: Math.max(maximum.z, position.z),
    }
  }
  return (['x', 'y', 'z'] as const).every(
    axis =>
      transform.bounds.minimum[axis] === minimum[axis] &&
      transform.bounds.maximum[axis] === maximum[axis],
  )
    ? transform
    : undefined
}

function admittedWorldCanonicalTransform(
  snapshot: ResolvedMapWorkspaceSnapshot,
  terrainTransform: MapTerrainNativeTransform | undefined,
): MapWorldCanonicalTransform | undefined {
  const transform = snapshot.uvwTransform
  if (transform === undefined || terrainTransform === undefined) return undefined
  const finite = (value: number): boolean => Number.isFinite(value)
  const positive = (value: number): boolean => finite(value) && value > 0
  const basis = transform.basis
  const axes = Object.values(transform.axes)
  const sourceAxes = axes.map(item => item.sourceAxis)
  if (
    transform.schemaVersion !== 1 ||
    transform.snapshotId !== snapshot.snapshotId ||
    transform.sourceCoordinateSpaceId !== 'map-native' ||
    transform.targetCoordinateSpaceId !== 'uvw-canonical' ||
    basis.handedness !== 'right' ||
    basis.upAxis !== 'y' ||
    basis.forwardAxis !== '+z' ||
    (basis.unit !== 'meter' && basis.unit !== 'source-unit') ||
    (basis.unit === 'source-unit' &&
      (basis.sourceUnit === undefined ||
        basis.sourceUnit.length === 0 ||
        basis.metersPerUnit !== undefined)) ||
    (basis.unitsPerCell !== undefined && !positive(basis.unitsPerCell)) ||
    axes.some(item => !finite(item.scale) || item.scale === 0 || !finite(item.offset)) ||
    new Set(sourceAxes).size !== 3 ||
    !Number.isSafeInteger(transform.heightfield.columns) ||
    !Number.isSafeInteger(transform.heightfield.rows) ||
    transform.heightfield.columns !== terrainTransform.heightMap.dim[0] ||
    transform.heightfield.rows !== terrainTransform.heightMap.dim[1] ||
    !positive(transform.heightfield.cellSize) ||
    (basis.unitsPerCell !== undefined && basis.unitsPerCell !== transform.heightfield.cellSize) ||
    transform.heightfield.origin.length !== 3 ||
    !transform.heightfield.origin.every(finite) ||
    transform.heightfield.sourceRowOrder !== 'reverse' ||
    transform.bounds.coordinateSpaceId !== 'uvw-canonical' ||
    !Object.values(transform.bounds.minimum).every(finite) ||
    !Object.values(transform.bounds.maximum).every(finite) ||
    !(['x', 'y', 'z'] as const).every(
      axis => transform.bounds.minimum[axis] <= transform.bounds.maximum[axis],
    ) ||
    !Number.isSafeInteger(transform.proof.tupleCount) ||
    transform.proof.tupleCount <= 0 ||
    transform.proof.kind !== 'adapter-qualification' ||
    transform.proof.oracle.length === 0 ||
    transform.proof.corpus.length === 0 ||
    Object.keys(transform.proof.sourceDigests).length === 0 ||
    !Object.values(transform.proof.sourceDigests).every(value =>
      /^sha256:[0-9a-f]{64}$/u.test(value),
    ) ||
    !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.nativeTupleDigest) ||
    (transform.proof.presentationTupleDigest !== undefined &&
      !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.presentationTupleDigest)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.canonicalTupleDigest) ||
    transform.proof.comparison !== 'ieee-754-binary64-exact'
  ) {
    return undefined
  }

  const nativeBounds = terrainTransform.bounds
  const corners = [nativeBounds.minimum.x, nativeBounds.maximum.x].flatMap(x =>
    [nativeBounds.minimum.y, nativeBounds.maximum.y].flatMap(y =>
      [nativeBounds.minimum.z, nativeBounds.maximum.z].map(z => ({ x, y, z })),
    ),
  )
  let minimum = { x: Infinity, y: Infinity, z: Infinity }
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const corner of corners) {
    const value = canonicalPosition(corner, transform)
    minimum = {
      x: Math.min(minimum.x, value.x),
      y: Math.min(minimum.y, value.y),
      z: Math.min(minimum.z, value.z),
    }
    maximum = {
      x: Math.max(maximum.x, value.x),
      y: Math.max(maximum.y, value.y),
      z: Math.max(maximum.z, value.z),
    }
  }
  return (['x', 'y', 'z'] as const).every(
    axis =>
      transform.bounds.minimum[axis] === minimum[axis] &&
      transform.bounds.maximum[axis] === maximum[axis],
  )
    ? transform
    : undefined
}

/** Creates a lease whose release makes every page/cursor stale immediately. */
export function createCandidateWorldSceneLease(
  snapshot: ResolvedMapWorkspaceSnapshot,
  provenance: readonly ResourceProvenanceRecord[],
  maxPageSize: number,
  modelResources?: ModelResourcePort,
  releaseModelResources?: () => Promise<void>,
  rasterResources?: RasterResourcePort,
): Lease<CandidateWorldSceneSource> {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER)
  const modelTextureCache = new Map<
    string,
    Promise<
      Readonly<{
        texture?: SceneRendererTexture
        diagnostics: readonly ReturnType<typeof diagnostic>[]
      }>
    >
  >()
  const semantic = snapshot.semantic
  const terrainLayerId = layerId('terrain')
  const terrainMaterialLayerId = layerId('terrain-materials')
  const waterLayerId = layerId('water')
  const cliffLayerId = layerId('cliffs')
  const objectLayerId = layerId('objects')
  const regionLayerId = layerId('regions')
  const resourceLayerId = layerId('resources')
  const navigationLayerId = layerId('navigation')
  const gatewayLayerId = layerId('gateways')
  const lightingLayerId = layerId('lighting')
  const terrainSummary = semantic.terrain
  const terrainExact = hasExactTerrainGrid(terrainSummary)
  const terrainTransform = admittedTerrainTransform(snapshot, terrainSummary, terrainExact)
  const uvwTransform = admittedWorldCanonicalTransform(snapshot, terrainTransform)
  const terrainLod = terrainExact ? ('exact' as const) : ('sampled' as const)
  const terrainMaterialExact =
    snapshot.terrainMaterials?.exact === true &&
    (uvwTransform === undefined ||
      (snapshot.terrainMaterials.width === uvwTransform.heightfield.columns &&
        snapshot.terrainMaterials.height === uvwTransform.heightfield.rows))
  const terrainWeightRasterExact =
    (snapshot.terrainMaterials?.weightRasters?.length ?? 0) > 0 &&
    snapshot.terrainMaterials!.weightRasters!.every(
      raster =>
        Number.isSafeInteger(raster.width) &&
        raster.width > 0 &&
        Number.isSafeInteger(raster.height) &&
        raster.height > 0 &&
        raster.materialIds.length > 0 &&
        raster.materialIds.length <= 4 &&
        raster.rgba?.byteLength === raster.width * raster.height * 4,
    )
  const terrainMaterialLod = terrainMaterialExact ? ('exact' as const) : ('sampled' as const)
  const cliffExact =
    snapshot.cliffs?.exact === true &&
    (uvwTransform === undefined ||
      (snapshot.cliffs.width <= uvwTransform.heightfield.columns &&
        snapshot.cliffs.height <= uvwTransform.heightfield.rows))
  const cliffLod = cliffExact ? ('exact' as const) : ('sampled' as const)
  const objectIdentities = new Set<number>()
  const semanticObjects = semantic.objects.filter(item => {
    if (objectIdentities.has(item.objectId)) return false
    objectIdentities.add(item.objectId)
    return true
  })
  const regionIdentities = new Set<number>()
  const semanticRegions = semantic.regions.filter(item => {
    if (regionIdentities.has(item.regionId)) return false
    regionIdentities.add(item.regionId)
    return true
  })
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length
  const incompleteObjectPositionCount = semanticObjects.filter(
    item => item.sourcePositionDimensions === 2,
  ).length

  const terrain: readonly WorldSceneItem[] = Object.freeze(
    (semantic.terrain?.samples ?? []).map(item => {
      const mapNativePosition =
        terrainTransform === undefined
          ? undefined
          : terrainMapNativePosition(item, terrainTransform)
      return Object.freeze({
        facet: 'terrain' as const,
        id: `${terrainLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainLayerId,
        coordinateSpaceId: 'height-grid',
        lod: terrainLod,
        ...item,
        ...(mapNativePosition === undefined ? {} : { mapNativePosition }),
        ...(mapNativePosition === undefined || uvwTransform === undefined
          ? {}
          : { uvwPosition: canonicalPosition(mapNativePosition, uvwTransform) }),
      })
    }),
  )
  const terrainByGrid = new Map(
    terrain.flatMap(item =>
      item.facet === 'terrain' ? [[`${String(item.x)}:${String(item.y)}`, item]] : [],
    ),
  )
  const terrainMaterials: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.terrainMaterials?.samples ?? []).map(item => {
      const terrainItem = terrainByGrid.get(`${String(item.x)}:${String(item.y)}`)
      const materialId =
        snapshot.terrainMaterials?.materials?.find(
          material => material.sourceIndex === item.textureIndex,
        )?.materialId ?? `material-${String(item.textureIndex)}`
      return Object.freeze({
        facet: 'terrain-materials' as const,
        id: `${terrainMaterialLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainMaterialLayerId,
        coordinateSpaceId: 'height-grid' as const,
        lod: terrainMaterialLod,
        ...item,
        weights: item.weights ?? Object.freeze([Object.freeze({ materialId, weight: 1 })]),
        ...(terrainItem?.facet === 'terrain' && terrainItem.uvwPosition !== undefined
          ? { uvwPosition: terrainItem.uvwPosition }
          : {}),
      })
    }),
  )
  const water: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.water?.zones ?? []).map(item => {
      const canonicalCorners =
        item.elevation === undefined || uvwTransform === undefined
          ? undefined
          : [item.minimum.x, item.maximum.x].flatMap(x =>
              [item.minimum.y, item.maximum.y].map(y =>
                canonicalPosition({ x, y, z: item.elevation as number }, uvwTransform),
              ),
            )
      return Object.freeze({
        facet: 'water' as const,
        id: `${waterLayerId}:zone:${String(item.zoneId)}`,
        layerId: waterLayerId,
        coordinateSpaceId: 'map-native' as const,
        ...item,
        ...(canonicalCorners === undefined
          ? {}
          : {
              uvwMinimum: Object.freeze({
                x: Math.min(...canonicalCorners.map(corner => corner.x)),
                z: Math.min(...canonicalCorners.map(corner => corner.z)),
              }),
              uvwMaximum: Object.freeze({
                x: Math.max(...canonicalCorners.map(corner => corner.x)),
                z: Math.max(...canonicalCorners.map(corner => corner.z)),
              }),
              uvwElevation: canonicalCorners[0]!.y,
            }),
      })
    }),
  )
  const unresolvedWaterElevationCount = water.filter(
    item => item.facet === 'water' && item.elevation === undefined,
  ).length
  const cliffs: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.cliffs?.samples ?? []).map(item => {
      const terrainItem = terrainByGrid.get(`${String(item.x)}:${String(item.y)}`)
      return Object.freeze({
        facet: 'cliffs' as const,
        id: `${cliffLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: cliffLayerId,
        coordinateSpaceId: 'height-grid' as const,
        lod: cliffLod,
        ...item,
        ...(terrainItem?.facet === 'terrain' && terrainItem.uvwPosition !== undefined
          ? { uvwPosition: terrainItem.uvwPosition }
          : {}),
      })
    }),
  )
  const objects: readonly WorldSceneItem[] = Object.freeze(
    semanticObjects.map(item => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`
      const ref = item.catalog?.ref
      const uvwRotation = canonicalObjectRotation(item.rotation, item.nativeRotationUnit)
      const groundHeight = terrainHeightAt(item.position, semantic.terrain, terrainTransform)
      const mapNativePresentationPosition =
        groundHeight === undefined || item.heightReference === undefined || item.heightReference === 'absolute'
          ? item.position
          : Object.freeze({
              ...item.position,
              z:
                item.heightReference === 'terrain-relative'
                  ? groundHeight + item.position.z
                  : groundHeight,
            })
      const compoundResourceIds = (item.modelResources ?? []).map(requirement =>
        modelResourceId(requirement.id),
      )
      const modelComponents = item.modelComponents?.map(component =>
        Object.freeze({
          ...component,
          resourceId: modelResourceId(component.resourceId),
        }),
      )
      return Object.freeze({
        facet: 'objects' as const,
        id,
        layerId: objectLayerId,
        coordinateSpaceId: 'map-native',
        ...item,
        ...(mapNativePresentationPosition === item.position
          ? {}
          : { mapNativePresentationPosition }),
        ...(uvwTransform === undefined || item.sourcePositionDimensions === 2
          ? {}
          : {
              uvwPosition: canonicalPosition(mapNativePresentationPosition, uvwTransform),
              ...(uvwRotation === undefined ? {} : { uvwRotation }),
              uvwScale: canonicalObjectScale(item.scale, uvwTransform),
            }),
        ...(ref === undefined ? {} : { resourceId: resourceId(ref.namespace, ref.entityId) }),
        ...(compoundResourceIds.length === 0
          ? {}
          : { resourceIds: Object.freeze(compoundResourceIds) }),
        ...(modelComponents === undefined
          ? {}
          : { modelComponents: Object.freeze(modelComponents) }),
      })
    }),
  )
  const regions: readonly WorldSceneItem[] = Object.freeze(
    semanticRegions.map(item => {
      const shapes = Object.freeze(item.shapes.map(regionShape))
      const uvwShapes =
        uvwTransform === undefined
          ? undefined
          : shapes.map(shape => canonicalRegionShape(shape, uvwTransform))
      return Object.freeze({
        facet: 'regions' as const,
        id: `${regionLayerId}:region:${String(item.regionId)}`,
        layerId: regionLayerId,
        coordinateSpaceId: 'map-native',
        regionId: item.regionId,
        name: item.name,
        ...(item.color === undefined ? {} : { color: item.color }),
        shapes,
        ...(uvwShapes === undefined || uvwShapes.some(shape => shape === undefined)
          ? {}
          : { uvwShapes: Object.freeze(uvwShapes as WorldSceneRegionShape[]) }),
      })
    }),
  )
  const incompleteRegionGeometryCount = regions.filter(
    item => item.facet === 'regions' && item.uvwShapes === undefined,
  ).length
  const resourceJoins = new Map<
    string,
    {
      namespace?: string
      entityId?: string
      resolved: boolean
      objectIds: string[]
      modelResource?: NonNullable<WorldSceneObjectItem['modelResource']>
    }
  >()
  for (const item of objects) {
    if (item.facet !== 'objects') continue
    if (item.catalog !== undefined) {
      const key = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId)
      const current = resourceJoins.get(key) ?? {
        namespace: item.catalog.ref.namespace,
        entityId: item.catalog.ref.entityId,
        resolved: item.catalog.entity !== undefined,
        objectIds: [],
        ...(item.modelResource === undefined ? {} : { modelResource: item.modelResource }),
      }
      current.resolved ||= item.catalog.entity !== undefined
      if (current.modelResource === undefined && item.modelResource !== undefined) {
        current.modelResource = item.modelResource
      }
      current.objectIds.push(item.id)
      resourceJoins.set(key, current)
    }
    for (const modelResource of item.modelResources ?? []) {
      const key = modelResourceId(modelResource.id)
      const current = resourceJoins.get(key) ?? {
        resolved: true,
        objectIds: [],
        modelResource,
      }
      current.objectIds.push(item.id)
      resourceJoins.set(key, current)
    }
  }
  const resources: readonly WorldSceneItem[] = Object.freeze(
    [...resourceJoins.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, item]) =>
        Object.freeze({
          facet: 'resources' as const,
          id,
          layerId: resourceLayerId,
          ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
          ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
          resolved: item.resolved,
          ...(item.modelResource === undefined ? {} : { modelResource: item.modelResource }),
          objectIds: Object.freeze([...item.objectIds]),
        }),
      ),
  )
  const navigation: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.navigation?.samples ?? []).map(item =>
      Object.freeze({
        facet: 'navigation' as const,
        id: `${navigationLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: navigationLayerId,
        coordinateSpaceId: 'navigation-grid',
        lod: 'sampled' as const,
        ...item,
      }),
    ),
  )
  const gateways: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.gateways?.segments ?? []).map(item => {
      const uvwStart =
        uvwTransform === undefined
          ? undefined
          : canonicalPosition({ x: item.x1, y: item.y1, z: 0 }, uvwTransform)
      const uvwEnd =
        uvwTransform === undefined
          ? undefined
          : canonicalPosition({ x: item.x2, y: item.y2, z: 0 }, uvwTransform)
      return Object.freeze({
        facet: 'gateways' as const,
        ...item,
        id: `${gatewayLayerId}:${item.id}`,
        layerId: gatewayLayerId,
        coordinateSpaceId: 'map-native',
        ...(uvwStart === undefined || uvwEnd === undefined ? {} : { uvwStart, uvwEnd }),
      })
    }),
  )
  const lighting: readonly WorldSceneItem[] = Object.freeze(
    snapshot.lighting === undefined
      ? []
      : [
          Object.freeze({
            facet: 'lighting' as const,
            id: `${lightingLayerId}:environment`,
            layerId: lightingLayerId,
            coordinateSpaceId: snapshot.lighting.coordinateSpaceId,
            ambientColor: snapshot.lighting.ambientColor,
            ambientIntensity: snapshot.lighting.ambientIntensity,
            directional: snapshot.lighting.directional,
          }),
        ],
  )
  const contentRevisions = Object.freeze({
    terrain: layerContentRevision(terrain),
    'terrain-materials': terrainMaterialContentRevision(
      terrainMaterials,
      snapshot.terrainMaterials?.weightRasters ?? [],
    ),
    water: layerContentRevision(water),
    cliffs: layerContentRevision(cliffs),
    objects: layerContentRevision(objects),
    regions: layerContentRevision(regions),
    resources: layerContentRevision(resources),
    navigation: layerContentRevision(navigation),
    gateways: layerContentRevision(gateways),
    lighting: layerContentRevision(lighting),
  })
  const commonTerrainMaterials: readonly MapTerrainMaterialDefinition[] = Object.freeze(
    snapshot.terrainMaterials?.materials ??
      (snapshot.terrainMaterials?.textureNames ?? []).map((label, sourceIndex) =>
        Object.freeze({ materialId: `material-${String(sourceIndex)}`, label, sourceIndex }),
      ),
  )
  const commonWaterMaterials = Object.freeze(snapshot.water?.materials ?? [])
  const commonTerrainWeightRasters = Object.freeze(
    (snapshot.terrainMaterials?.weightRasters ?? []).map(raster =>
      Object.freeze({
        resourceId: raster.resourceId,
        width: raster.width,
        height: raster.height,
        materialIds: raster.materialIds,
        encoding: raster.encoding,
        normalization: raster.normalization,
      }),
    ),
  )
  const terrainWeightTextures = new Map(
    (snapshot.terrainMaterials?.weightRasters ?? []).flatMap(raster =>
      raster.rgba === undefined
        ? []
        : [
            [
              raster.resourceId,
              Object.freeze({
                id: raster.resourceId,
                width: raster.width,
                height: raster.height,
                rgba: raster.rgba.slice(),
                wrapU: 'clamp' as const,
                wrapV: 'clamp' as const,
                filter: 'linear' as const,
              }),
            ] as const,
          ],
    ),
  )

  const facets: readonly WorldSceneFacetState[] = Object.freeze([
    Object.freeze({
      facet: 'terrain' as const,
      layerId: terrainLayerId,
      state:
        terrainSummary === undefined
          ? ('unavailable' as const)
          : terrainExact
            ? ('available' as const)
            : ('partial' as const),
      itemCount: semantic.terrain?.cellCount ?? 0,
      lods: Object.freeze(
        terrainSummary === undefined ? [] : terrainExact ? ['exact'] : ['summary', 'sampled'],
      ),
      contentRevision: contentRevisions.terrain,
      ...(terrainSummary === undefined
        ? { reason: 'authoritative semantic snapshot contains no terrain height grid' }
        : terrainExact
          ? {}
          : {
              reason: 'candidate exposes bounded deterministic samples, not the full native grid',
            }),
    }),
    Object.freeze({
      facet: 'terrain-materials' as const,
      layerId: terrainMaterialLayerId,
      state:
        snapshot.terrainMaterials === undefined
          ? ('unavailable' as const)
          : terrainMaterialExact || terrainWeightRasterExact
            ? ('available' as const)
            : ('partial' as const),
      itemCount: snapshot.terrainMaterials?.cellCount ?? 0,
      lods: Object.freeze(
        snapshot.terrainMaterials === undefined
          ? []
          : terrainMaterialExact
            ? ['exact']
            : terrainWeightRasterExact
              ? ['raster-exact', 'sampled']
              : ['summary', 'sampled'],
      ),
      contentRevision: contentRevisions['terrain-materials'],
      ...(snapshot.terrainMaterials === undefined
        ? { reason: 'publisher reported terrain materials unavailable' }
        : terrainMaterialExact || terrainWeightRasterExact
          ? {}
          : {
              reason:
                'publisher exposes bounded material samples without a grid matching the admitted UVW heightfield',
            }),
    }),
    Object.freeze({
      facet: 'water' as const,
      layerId: waterLayerId,
      state:
        snapshot.water === undefined
          ? ('unavailable' as const)
          : unresolvedWaterElevationCount === 0 && snapshot.water.exact !== false
            ? ('available' as const)
            : ('partial' as const),
      itemCount: snapshot.water?.zones.length ?? 0,
      lods: Object.freeze(snapshot.water === undefined ? [] : ['exact']),
      contentRevision: contentRevisions.water,
      ...(snapshot.water === undefined
        ? { reason: 'publisher reported water unavailable' }
        : unresolvedWaterElevationCount > 0
          ? {
              reason: `${String(unresolvedWaterElevationCount)} native water zone elevations remain unresolved`,
            }
          : snapshot.water.exact === false
            ? { reason: 'native water geometry exceeds the common constant-elevation zone profile' }
            : {}),
    }),
    Object.freeze({
      facet: 'cliffs' as const,
      layerId: cliffLayerId,
      state:
        snapshot.cliffs === undefined
          ? ('unavailable' as const)
          : cliffExact
            ? ('available' as const)
            : ('partial' as const),
      itemCount: snapshot.cliffs?.cellCount ?? 0,
      lods: Object.freeze(
        snapshot.cliffs === undefined ? [] : cliffExact ? ['exact'] : ['sampled'],
      ),
      contentRevision: contentRevisions.cliffs,
      ...(snapshot.cliffs === undefined
        ? { reason: 'publisher reported synchronized cliff levels unavailable' }
        : cliffExact
          ? {}
          : {
              reason:
                'publisher cliff grid is sampled or does not match the admitted UVW heightfield grid',
            }),
    }),
    Object.freeze({
      facet: 'objects' as const,
      layerId: objectLayerId,
      state:
        semanticObjects.length === 0
          ? ('unavailable' as const)
          : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0
            ? ('partial' as const)
            : ('available' as const),
      itemCount: semanticObjects.length,
      lods: Object.freeze(['exact']),
      contentRevision: contentRevisions.objects,
      ...(semanticObjects.length === 0
        ? { reason: 'semantic snapshot contains no objects' }
        : duplicateObjectCount > 0 || incompleteObjectPositionCount > 0
          ? {
              reason: [
                ...(duplicateObjectCount > 0
                  ? [`${duplicateObjectCount} duplicate object identities were omitted`]
                  : []),
                ...(incompleteObjectPositionCount > 0
                  ? [
                      `${incompleteObjectPositionCount} objects publish two-dimensional source positions; elevation remains unknown`,
                    ]
                  : []),
              ].join('; '),
            }
          : {}),
    }),
    Object.freeze({
      facet: 'regions' as const,
      layerId: regionLayerId,
      state:
        semanticRegions.length === 0
          ? ('unavailable' as const)
          : duplicateRegionCount > 0 || incompleteRegionGeometryCount > 0
            ? ('partial' as const)
            : ('available' as const),
      itemCount: semanticRegions.length,
      lods: Object.freeze(['exact']),
      contentRevision: contentRevisions.regions,
      ...(semanticRegions.length === 0
        ? { reason: 'semantic snapshot contains no regions' }
        : duplicateRegionCount > 0 || incompleteRegionGeometryCount > 0
          ? {
              reason: [
                ...(duplicateRegionCount > 0
                  ? [`${duplicateRegionCount} duplicate region identities were omitted`]
                  : []),
                ...(incompleteRegionGeometryCount > 0
                  ? [
                      `${incompleteRegionGeometryCount} regions contain shapes without canonical UVW geometry`,
                    ]
                  : []),
              ].join('; '),
            }
          : {}),
    }),
    Object.freeze({
      facet: 'resources' as const,
      layerId: resourceLayerId,
      state: resources.length === 0 ? ('unavailable' as const) : ('available' as const),
      itemCount: resources.length,
      lods: Object.freeze(['exact']),
      contentRevision: contentRevisions.resources,
      ...(resources.length === 0
        ? { reason: 'no placed object publishes a catalog resource reference' }
        : {}),
    }),
    Object.freeze({
      facet: 'navigation' as const,
      layerId: navigationLayerId,
      state: snapshot.navigation === undefined ? ('unavailable' as const) : ('partial' as const),
      itemCount: snapshot.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot.navigation === undefined ? [] : ['summary', 'sampled']),
      contentRevision: contentRevisions.navigation,
      ...(snapshot.navigation === undefined
        ? { reason: 'publisher reported navigation unavailable' }
        : { reason: 'native flags are sampled and their bit semantics remain publisher-defined' }),
    }),
    Object.freeze({
      facet: 'gateways' as const,
      layerId: gatewayLayerId,
      state:
        snapshot.gateways === undefined
          ? ('unavailable' as const)
          : snapshot.gateways.exact && uvwTransform !== undefined
            ? ('available' as const)
            : ('partial' as const),
      itemCount: snapshot.gateways?.segments.length ?? 0,
      lods: Object.freeze(snapshot.gateways === undefined ? [] : ['exact']),
      contentRevision: contentRevisions.gateways,
      ...(snapshot.gateways === undefined
        ? { reason: 'publisher reported gateways unavailable' }
        : snapshot.gateways.exact && uvwTransform !== undefined
          ? {}
          : { reason: 'gateway endpoints lack an exact canonical transform' }),
    }),
    Object.freeze({
      facet: 'lighting' as const,
      layerId: lightingLayerId,
      state: snapshot.lighting === undefined ? ('unavailable' as const) : ('available' as const),
      itemCount: lighting.length,
      lods: Object.freeze(snapshot.lighting === undefined ? [] : ['exact']),
      contentRevision: contentRevisions.lighting,
      ...(snapshot.lighting === undefined
        ? { reason: 'publisher reported world lighting unavailable' }
        : {}),
    }),
  ])
  const layers: readonly WorldSceneItem[] = Object.freeze(
    facets.map(item =>
      Object.freeze({
        facet: 'layers' as const,
        id: item.layerId,
        layerId: item.layerId,
        kind: item.facet,
        state: item.state,
        itemCount: item.itemCount,
        lods: item.lods,
        ...(item.contentRevision === undefined ? {} : { contentRevision: item.contentRevision }),
        ...(uvwTransform !== undefined &&
        (item.facet === 'terrain' ||
          item.facet === 'terrain-materials' ||
          item.facet === 'cliffs') &&
        item.state === 'available' &&
        (item.lods.includes('exact') ||
          (item.facet === 'terrain-materials' && item.lods.includes('raster-exact')))
          ? {
              grid: Object.freeze({
                columns:
                  item.facet === 'cliffs'
                    ? snapshot.cliffs!.width
                    : uvwTransform.heightfield.columns,
                rows:
                  item.facet === 'cliffs' ? snapshot.cliffs!.height : uvwTransform.heightfield.rows,
                cellSize: uvwTransform.heightfield.cellSize,
                origin:
                  item.facet === 'cliffs' &&
                  uvwTransform.heightfield.sourceRowOrder === 'reverse' &&
                  snapshot.cliffs!.height < uvwTransform.heightfield.rows
                    ? Object.freeze([
                        uvwTransform.heightfield.origin[0],
                        uvwTransform.heightfield.origin[1],
                        uvwTransform.heightfield.origin[2] + uvwTransform.heightfield.cellSize,
                      ] as const)
                    : uvwTransform.heightfield.origin,
                coordinateSpaceId: 'uvw-canonical',
              }),
            }
          : {}),
        ...(item.facet === 'terrain-materials' && commonTerrainMaterials.length > 0
          ? {
              materials: commonTerrainMaterials,
              ...(commonTerrainWeightRasters.length === 0
                ? {}
                : { weightRasters: commonTerrainWeightRasters }),
            }
          : {}),
        ...(item.facet === 'water' && commonWaterMaterials.length > 0
          ? { waterMaterials: commonWaterMaterials }
          : {}),
      }),
    ),
  )
  const byFacet = new Map<string, readonly WorldSceneItem[]>([
    ['layers', layers],
    ['terrain', terrain],
    ['terrain-materials', terrainMaterials],
    ['water', water],
    ['cliffs', cliffs],
    ['objects', objects],
    ['regions', regions],
    ['resources', resources],
    ['navigation', navigation],
    ['gateways', gateways],
    ['lighting', lighting],
  ])
  const info: CandidateWorldSceneInfo = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    maturity: snapshot.worldCandidate.maturity,
    snapshotId: snapshot.snapshotId,
    mapId: snapshot.mapId,
    coordinateSpaces: snapshot.worldCandidate.coordinateSpaces,
    crossSpaceTransforms: Object.freeze(
      snapshot.worldCandidate.crossSpaceTransforms.map(item => {
        if (
          item.from === 'height-grid' &&
          item.to === 'map-native' &&
          terrainTransform === undefined
        ) {
          return Object.freeze({
            ...item,
            state: 'unknown' as const,
            reason: 'host rejected or did not receive an exact native terrain transform',
          })
        }
        if (
          item.from === 'map-native' &&
          item.to === 'uvw-canonical' &&
          uvwTransform === undefined
        ) {
          return Object.freeze({
            ...item,
            state: 'unknown' as const,
            reason: 'host rejected or did not receive a measured canonical world transform',
          })
        }
        return item
      }),
    ),
    bounds: Object.freeze([
      Object.freeze({
        facet: 'terrain' as const,
        coordinateSpaceId: terrainTransform === undefined ? 'height-grid' : 'map-native',
        x:
          terrainTransform !== undefined
            ? Object.freeze({
                state: 'known' as const,
                minimum: terrainTransform.bounds.minimum.x,
                maximum: terrainTransform.bounds.maximum.x,
              })
            : terrainSummary === undefined
              ? Object.freeze({ state: 'unknown' as const, reason: 'terrain bounds unavailable' })
              : Object.freeze({
                  state: 'known' as const,
                  minimum: 0,
                  maximum: terrainSummary.width - 1,
                }),
        y:
          terrainTransform !== undefined
            ? Object.freeze({
                state: 'known' as const,
                minimum: terrainTransform.bounds.minimum.y,
                maximum: terrainTransform.bounds.maximum.y,
              })
            : terrainSummary === undefined
              ? Object.freeze({ state: 'unknown' as const, reason: 'terrain bounds unavailable' })
              : Object.freeze({
                  state: 'known' as const,
                  minimum: 0,
                  maximum: terrainSummary.height - 1,
                }),
        z:
          terrainTransform === undefined
            ? Object.freeze({
                state: 'unknown' as const,
                reason:
                  'publisher-native height quantization has no validated exact map-native conversion',
              })
            : Object.freeze({
                state: 'known' as const,
                minimum: terrainTransform.bounds.minimum.z,
                maximum: terrainTransform.bounds.maximum.z,
              }),
      }),
      Object.freeze({
        facet: 'objects' as const,
        coordinateSpaceId: 'map-native',
        x:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(...semanticObjects.map(item => item.position.x)),
                maximum: Math.max(...semanticObjects.map(item => item.position.x)),
              }),
        y:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(...semanticObjects.map(item => item.position.y)),
                maximum: Math.max(...semanticObjects.map(item => item.position.y)),
              }),
        z:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : incompleteObjectPositionCount > 0
              ? Object.freeze({
                  state: 'unknown' as const,
                  reason: 'one or more objects have no publisher-defined elevation',
                })
              : Object.freeze({
                  state: 'known' as const,
                  minimum: Math.min(...semanticObjects.map(item => item.position.z)),
                  maximum: Math.max(...semanticObjects.map(item => item.position.z)),
                }),
      }),
      Object.freeze({
        facet: 'regions' as const,
        coordinateSpaceId: 'map-native',
        x: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
        y: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
        z: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
      }),
      Object.freeze({
        facet: 'navigation' as const,
        coordinateSpaceId: 'navigation-grid',
        x:
          snapshot.navigation === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'navigation bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: snapshot.navigation.width - 1,
              }),
        y:
          snapshot.navigation === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'navigation bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: snapshot.navigation.height - 1,
              }),
        z: Object.freeze({
          state: 'unknown' as const,
          reason: 'navigation grid has no vertical axis',
        }),
      }),
      Object.freeze({
        facet: 'gateways' as const,
        coordinateSpaceId: uvwTransform === undefined ? 'map-native' : 'uvw-canonical',
        x:
          gateways.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'gateway bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(
                  ...gateways.flatMap(item =>
                    item.facet === 'gateways'
                      ? [item.uvwStart?.x ?? item.x1, item.uvwEnd?.x ?? item.x2]
                      : [],
                  ),
                ),
                maximum: Math.max(
                  ...gateways.flatMap(item =>
                    item.facet === 'gateways'
                      ? [item.uvwStart?.x ?? item.x1, item.uvwEnd?.x ?? item.x2]
                      : [],
                  ),
                ),
              }),
        y: Object.freeze({ state: 'unknown' as const, reason: 'gateways have no vertical extent' }),
        z:
          gateways.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'gateway bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(
                  ...gateways.flatMap(item =>
                    item.facet === 'gateways'
                      ? [item.uvwStart?.z ?? item.y1, item.uvwEnd?.z ?? item.y2]
                      : [],
                  ),
                ),
                maximum: Math.max(
                  ...gateways.flatMap(item =>
                    item.facet === 'gateways'
                      ? [item.uvwStart?.z ?? item.y1, item.uvwEnd?.z ?? item.y2]
                      : [],
                  ),
                ),
              }),
      }),
    ]),
    ...(terrainTransform === undefined ? {} : { terrainTransform }),
    ...(uvwTransform === undefined ? {} : { uvwTransform }),
    facets,
    provenance: Object.freeze(provenance.map(item => Object.freeze({ ...item }))),
    unknownFacets: snapshot.worldCandidate.unknownFacets,
    ...(snapshot.worldCandidate.edit === undefined ? {} : { edit: snapshot.worldCandidate.edit }),
    lossPolicy: 'explicit-partial',
    complete:
      snapshot.complete &&
      duplicateObjectCount === 0 &&
      duplicateRegionCount === 0 &&
      incompleteRegionGeometryCount === 0 &&
      incompleteObjectPositionCount === 0,
  })
  let live = true
  const assertLive = (signal?: AbortSignal): void => {
    signal?.throwIfAborted()
    if (!live) throw new TypeError('world scene source lease is released or stale')
  }
  const source: CandidateWorldSceneSource = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    snapshotId: snapshot.snapshotId,
    async info(signal?: AbortSignal) {
      assertLive(signal)
      return Promise.resolve(info)
    },
    async page(request: WorldScenePageRequest, signal?: AbortSignal) {
      assertLive(signal)
      positiveLimit(request.limit, maxPageSize)
      cursorOffset(request.cursor, snapshot.snapshotId, canonicalQuery(request))
      const items = byFacet.get(request.facet)
      if (items === undefined) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unsupported' as const,
            items: Object.freeze([]),
            reason: `publisher candidate does not expose facet ${request.facet}`,
          }),
        )
      }
      const facetState = facets.find(item => item.facet === request.facet)
      if (request.facet !== 'layers') {
        if (request.layerId !== facetState?.layerId) {
          throw new TypeError(`world facet ${request.facet} requires its exact layerId`)
        }
        const expectedLod =
          request.facet === 'terrain'
            ? terrainLod
            : request.facet === 'terrain-materials'
              ? terrainMaterialLod
              : request.facet === 'cliffs'
                ? cliffLod
                : request.facet === 'navigation'
                  ? 'sampled'
                  : undefined
        if (expectedLod !== undefined && request.lod !== expectedLod) {
          return Promise.resolve(
            Object.freeze({
              snapshotId: snapshot.snapshotId,
              facet: request.facet,
              state: 'unsupported' as const,
              items: Object.freeze([]),
              reason: `facet ${request.facet} only pages ${expectedLod} LOD items`,
            }),
          )
        }
      }
      if (
        request.bounds !== undefined &&
        (request.facet === 'layers' ||
          request.facet === 'regions' ||
          request.facet === 'resources' ||
          request.facet === 'lighting')
      ) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unsupported' as const,
            items: Object.freeze([]),
            reason: `facet ${request.facet} does not support spatial bounds`,
          }),
        )
      }
      if (request.facet !== 'layers' && facetState?.state === 'unavailable') {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unavailable' as const,
            items: Object.freeze([]),
            reason: facetState.reason ?? 'facet unavailable',
          }),
        )
      }
      const bounds = request.bounds
      const bounded =
        bounds === undefined
          ? items
          : items.filter(item => {
              if (item.facet === 'objects') {
                return (
                  item.position.x >= bounds.minimumX &&
                  item.position.x <= bounds.maximumX &&
                  item.position.y >= bounds.minimumY &&
                  item.position.y <= bounds.maximumY
                )
              }
              if (item.facet === 'water') {
                return !(
                  item.maximum.x < bounds.minimumX ||
                  item.minimum.x > bounds.maximumX ||
                  item.maximum.y < bounds.minimumY ||
                  item.minimum.y > bounds.maximumY
                )
              }
              if (item.facet === 'gateways') {
                const startX = item.uvwStart?.x ?? item.x1
                const startY = item.uvwStart?.z ?? item.y1
                const endX = item.uvwEnd?.x ?? item.x2
                const endY = item.uvwEnd?.z ?? item.y2
                return !(
                  Math.max(startX, endX) < bounds.minimumX ||
                  Math.min(startX, endX) > bounds.maximumX ||
                  Math.max(startY, endY) < bounds.minimumY ||
                  Math.min(startY, endY) > bounds.maximumY
                )
              }
              if (
                item.facet !== 'terrain' &&
                item.facet !== 'terrain-materials' &&
                item.facet !== 'cliffs' &&
                item.facet !== 'navigation'
              )
                return false
              if (item.facet === 'terrain' && item.mapNativePosition !== undefined) {
                return (
                  item.mapNativePosition.x >= bounds.minimumX &&
                  item.mapNativePosition.x <= bounds.maximumX &&
                  item.mapNativePosition.y >= bounds.minimumY &&
                  item.mapNativePosition.y <= bounds.maximumY
                )
              }
              return (
                item.x >= bounds.minimumX &&
                item.x <= bounds.maximumX &&
                item.y >= bounds.minimumY &&
                item.y <= bounds.maximumY
              )
            })
      return Promise.resolve(pageItems(bounded, request, snapshot.snapshotId, maxPageSize))
    },
    ...(modelResources === undefined
      ? {}
      : {
          async model(
            requestedResourceId: string,
            request: WorldSceneModelRequest,
            signal?: AbortSignal,
          ) {
            assertLive(signal)
            const maxNodes = request.maxNodes ?? request.maxMeshes
            const maxResources = request.maxResources ?? maxNodes
            const maxTextureBytes =
              request.maxTextureBytes ?? Math.min(16 * 1024 * 1024, request.maxBytes)
            const maxTextureTotalBytes =
              request.maxTextureTotalBytes ?? Math.min(32 * 1024 * 1024, request.maxBytes)
            positiveLimit(maxNodes, maxPageSize)
            positiveLimit(request.maxMeshes, maxPageSize)
            positiveLimit(request.maxPrimitives, maxPageSize)
            positiveLimit(request.maxPrimitiveBytes, request.maxBytes)
            positiveLimit(maxResources, maxPageSize)
            positiveLimit(maxTextureBytes, request.maxBytes)
            positiveLimit(maxTextureTotalBytes, request.maxBytes)
            const item = resources.find(
              candidate => candidate.facet === 'resources' && candidate.id === requestedResourceId,
            )
            if (item?.facet !== 'resources' || item.modelResource === undefined) {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([
                  diagnostic(
                    'warning',
                    'x3.host/world-model-resource-unavailable',
                    `world resource ${requestedResourceId} has no resolved logical model requirement`,
                  ),
                ]),
              })
            }
            const modelRequirement = item.modelResource
            const metersPerSourceUnit =
              request.metersPerSourceUnit ?? snapshot.semantic.modelMetersPerSourceUnit
            const lease = await modelResources.acquire(
              {
                maxBytes: request.maxBytes,
                ...(metersPerSourceUnit === undefined ? {} : { metersPerSourceUnit }),
                requirement: modelRequirement,
              },
              signal,
            )
            try {
              const result = lease.value.result
              if (result.state === 'unresolved') {
                return Object.freeze({
                  ...result,
                  diagnostics: Object.freeze([...result.diagnostics]),
                })
              }
              if (lease.value.meshes === undefined || lease.value.primitive === undefined) {
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
              const meshPage = await lease.value.meshes({ limit: request.maxMeshes }, signal)
              const nodePage =
                lease.value.nodes === undefined
                  ? undefined
                  : await lease.value.nodes({ limit: maxNodes }, signal)
              const [skeletonPage, animationPage, materialPage, resourcePage, socketPage] =
                await Promise.all([
                  lease.value.skeletonBindings?.({ limit: maxNodes }, signal),
                  lease.value.animationClips?.({ limit: maxNodes }, signal),
                  lease.value.materials?.({ limit: maxNodes }, signal),
                  lease.value.resourceReferences?.({ limit: maxResources }, signal),
                  lease.value.sockets?.({ limit: maxNodes }, signal),
                ])
              const allPrimitiveIds = meshPage.items.flatMap(mesh => mesh.primitiveIds)
              const primitiveIds = allPrimitiveIds.slice(0, request.maxPrimitives)
              const primitives = await Promise.all(
                primitiveIds.map(primitiveId =>
                  lease.value.primitive!(
                    primitiveId,
                    { maxBytes: request.maxPrimitiveBytes },
                    signal,
                  ),
                ),
              )
              const textureDiagnostics: ReturnType<typeof diagnostic>[] = []
              const textures: SceneRendererTexture[] = []
              const publishedResources = [...(resourcePage?.items ?? [])]
              const resourceIds = new Set(publishedResources.map(reference => reference.id))
              // Material layers are authoritative render dependencies even when an intermediate
              // UVM/resource-refs facet omitted the redundant reference list. Acquire their
              // logical textures and publish the derived reference instead of silently falling
              // back to hashed material colours.
              for (const material of materialPage?.items ?? []) {
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
              const textureReferences = publishedResources.filter(
                reference => reference.role === 'texture',
              )
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
                const cacheKey = `${logicalId}\u0000${String(previewTextureBytes)}`
                let pending = modelTextureCache.get(cacheKey)
                if (pending === undefined) {
                  pending = (async () => {
                    const raster = await lease.value.readRaster(
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
                      },
                      signal,
                    )
                    if (raster.state !== 'decoded')
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
                  modelTextureCache.set(cacheKey, pending)
                }
                const loaded = await pending
                textureDiagnostics.push(...loaded.diagnostics)
                const texture = loaded.texture
                if (texture === undefined) continue
                if (texture.rgba.byteLength > remaining) {
                  textureDiagnostics.push(
                    diagnostic(
                      'warning',
                      'x3.host/world-model-texture-budget-exhausted',
                      `decoded model texture ${reference.id} exceeds the aggregate texture budget`,
                    ),
                  )
                  continue
                }
                textureBytes += texture.rgba.byteLength
                textures.push(texture)
              }
              return Object.freeze({
                state: 'converted' as const,
                sourceKey: result.sourceKey,
                uvmBytes: result.bytes.slice(),
                ...(nodePage === undefined ? {} : { nodes: Object.freeze([...nodePage.items]) }),
                ...(skeletonPage === undefined
                  ? {}
                  : { skeleton: Object.freeze([...skeletonPage.items]) }),
                ...(animationPage === undefined
                  ? {}
                  : { animations: Object.freeze([...animationPage.items]) }),
                ...(materialPage === undefined
                  ? {}
                  : { materials: Object.freeze([...materialPage.items]) }),
                ...(publishedResources.length === 0
                  ? {}
                  : { resources: Object.freeze(publishedResources) }),
                ...(socketPage === undefined
                  ? {}
                  : { sockets: Object.freeze([...socketPage.items]) }),
                ...(publishedResources.length === 0 ? {} : { textures: Object.freeze(textures) }),
                meshes: Object.freeze([...meshPage.items]),
                primitives: Object.freeze(primitives),
                diagnostics: Object.freeze([...result.diagnostics, ...textureDiagnostics]),
                complete:
                  meshPage.nextCursor === undefined &&
                  nodePage?.nextCursor === undefined &&
                  skeletonPage?.nextCursor === undefined &&
                  animationPage?.nextCursor === undefined &&
                  materialPage?.nextCursor === undefined &&
                  resourcePage?.nextCursor === undefined &&
                  socketPage?.nextCursor === undefined &&
                  textureReferences.length === textures.length &&
                  allPrimitiveIds.length <= request.maxPrimitives,
              })
            } finally {
              await lease.release()
            }
          },
        }),
    ...(rasterResources === undefined && terrainWeightTextures.size === 0
      ? {}
      : {
          async texture(
            requestedResourceId: string,
            request: WorldSceneTextureRequest,
            signal?: AbortSignal,
          ) {
            assertLive(signal)
            positiveLimit(request.maxBytes, Number.MAX_SAFE_INTEGER)
            const weightTexture = terrainWeightTextures.get(requestedResourceId)
            if (weightTexture !== undefined) {
              if (weightTexture.rgba.byteLength > request.maxBytes) {
                return Object.freeze({
                  state: 'unresolved' as const,
                  diagnostics: Object.freeze([
                    diagnostic(
                      'warning',
                      'x3.host/world-terrain-weight-raster-budget-exceeded',
                      `terrain weight raster ${requestedResourceId} exceeds maxBytes`,
                    ),
                  ]),
                })
              }
              return Object.freeze({
                state: 'decoded' as const,
                texture: weightTexture,
                diagnostics: Object.freeze([]),
              })
            }
            if (rasterResources === undefined) {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([
                  diagnostic(
                    'warning',
                    'x3.host/world-terrain-raster-port-unavailable',
                    `terrain resource ${requestedResourceId} requires a raster resource port`,
                  ),
                ]),
              })
            }
            const requirement = [
              ...commonTerrainMaterials.flatMap(candidate => [
                ...(candidate.baseColorResourceId === requestedResourceId &&
                candidate.baseColorResource !== undefined
                  ? [candidate.baseColorResource]
                  : []),
                ...(candidate.normalResourceId === requestedResourceId &&
                candidate.normalResource !== undefined
                  ? [candidate.normalResource]
                  : []),
                ...(candidate.specularResourceId === requestedResourceId &&
                candidate.specularResource !== undefined
                  ? [candidate.specularResource]
                  : []),
              ]),
              ...commonWaterMaterials.flatMap(candidate => [
                ...(candidate.baseColorResourceId === requestedResourceId &&
                candidate.baseColorResource !== undefined
                  ? [candidate.baseColorResource]
                  : []),
                ...(candidate.secondaryColorResourceId === requestedResourceId &&
                candidate.secondaryColorResource !== undefined
                  ? [candidate.secondaryColorResource]
                  : []),
                ...(candidate.causticsResourceId === requestedResourceId &&
                candidate.causticsResource !== undefined
                  ? [candidate.causticsResource]
                  : []),
              ]),
            ][0]
            if (requirement === undefined) {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([
                  diagnostic(
                    'warning',
                    'x3.host/world-texture-resource-unavailable',
                    `world resource ${requestedResourceId} has no scoped logical requirement`,
                  ),
                ]),
              })
            }
            const raster = await rasterResources.read(
              {
                kind: 'logical',
                requirement,
                maxBytes: request.maxBytes,
              },
              signal,
            )
            if (raster.state !== 'decoded') {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([...raster.diagnostics]),
              })
            }
            const texture = worldTexture(requestedResourceId, raster)
            if (texture === undefined) {
              return Object.freeze({
                state: 'unresolved' as const,
                diagnostics: Object.freeze([
                  ...raster.diagnostics,
                  diagnostic(
                    'warning',
                    'x3.host/world-terrain-texture-orientation-unknown',
                    `terrain texture ${requestedResourceId} has no proven row orientation`,
                  ),
                ]),
              })
            }
            return Object.freeze({
              state: 'decoded' as const,
              texture,
              diagnostics: Object.freeze([...raster.diagnostics]),
            })
          },
        }),
  })
  return Object.freeze({
    value: source,
    async release() {
      live = false
      await releaseModelResources?.()
    },
  })
}
