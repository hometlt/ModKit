import { projectLatticeOverview } from '@modkit/sdk/maps'
import { validateLatticeRamps } from '@modkit/sdk/maps'
/** Host-owned, read-only map-world source from resolved map semantics (SDK maps contract).
 * Publishes native facts and only projects UVW positions/coverage through admitted transforms.
 * Rejects malformed lattice coverage; does not infer gameplay masks, edit maps or decode assets.
 * Relative/surface object heights use the common drawn-cell triangles rather than a bilinear surface.
 */

import { diagnostic } from '@modkit/core'
import { terrainCellHeight } from './terrain.js'
import { mapQualificationTupleBytes, isNavigationFlagEncoding, isVersionedPublisherId, isGameRasterValue } from '@modkit/sdk'
import {
  MODEL_FACET_ITEM_CAP,
  positiveLimit,
  readAllPages,
  worldSceneModel,
  worldSceneModelLimits,
  worldTexture,
  type WorldModelTexture,
} from './world-model.js'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  Lease,
  LogicalResourceRequirement,
  MapTerrainMaterialDefinition,
  MapTerrainMaterialSample,
  MapLatticeObjectCoverage,
  MapTerrainNativeTransform,
  MapTerrainSample,
  MapPlacedObject,
  MapPosition,
  MapNavigationSummary,
  MapCliffSummary,
  MapQuerySurfaceSummary,
  MapGameRasterSummary,
  GameRasterValueMetadata,
  WorldSceneGameRasterItem,
  WorldSceneSurfaceItem,
  MapTraversalSummary,
  WorldSceneTraversalItem,
  WorldSceneLayerItem,
  MapTerrainWeightRaster,
  MapWorldCamera,
  MapWorldCanonicalTransform,
  MapWorldWindow,
  ModelResourcePort,
  RasterResourcePort,
  RasterResourceResult,
  ResolvedMapWorkspaceSnapshot,
  ResourceProvenanceRecord,
  SceneRendererTexture,
  ModelMaterialRef,
  WorldSceneFacetState,
  WorldSceneItem,
  WorldSceneLayerKind,
  WorldSceneModelRequest,
  WorldSceneTextureRequest,
  WorldSceneObjectItem,
  WorldSceneResourceItem,
  WorldSceneTerrainItem,
  WorldScenePage,
  WorldScenePageRequest,
  WorldSceneRegionShape,
  WorldSceneViewWindow,
} from '@modkit/sdk'

/** The proof methods sdk names (MapWorldCanonicalTransform.proof.method). */
const PROOF_METHODS: ReadonlySet<string> = new Set([
  'sealed-legacy-differential',
  'official-reference-differential',
  'third-party-reference-differential',
  'game-data-reference-differential',
])

/** The publisher's view of its world when every stated angle and distance is in range; else none. */
function worldCamera(camera: MapWorldCamera | undefined): MapWorldCamera | undefined {
  if (camera === undefined) return undefined
  const within = (value: number | undefined, low: number, high: number) =>
    value === undefined || (Number.isFinite(value) && value >= low && value <= high)
  return (camera.projection === 'orthographic' || camera.projection === 'perspective') &&
    within(camera.azimuthDegrees, -360, 360) &&
    within(camera.elevationDegrees, 0, 90) &&
    within(camera.fieldOfViewDegrees, 1, 170) &&
    within(camera.drawDistance, Number.MIN_VALUE, Number.MAX_VALUE)
    ? Object.freeze({ ...camera })
    : undefined
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

/** FNV-1a 32 over UTF-16 code units, continuing from `hash`; the content revisions and cursors share it. */
function fnv1a32(text: string, hash = 0x811c9dc5): number {
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

const hex32 = (hash: number) => (hash >>> 0).toString(16).padStart(8, '0')

function layerContentRevision(items: readonly WorldSceneItem[], catalogIdentity?: string): string {
  const text = JSON.stringify(catalogIdentity === undefined ? items : { items, catalogIdentity }, (key, value) =>
    key === 'id' || key === 'layerId' ? undefined : value,
  )
  return `fnv1a32:${hex32(fnv1a32(text))}:${items.length}`
}

function terrainMaterialContentRevision(
  items: readonly WorldSceneItem[],
  rasters: readonly MapTerrainWeightRaster[],
): string {
  const text = JSON.stringify(
    [items, rasters.map(({ rgba: _rgba, ...metadata }) => metadata)],
    (key, value) => (key === 'id' || key === 'layerId' ? undefined : value),
  )
  let hash = fnv1a32(text)
  for (const raster of rasters) {
    for (const value of raster.rgba ?? []) {
      hash ^= value
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `fnv1a32:${hex32(hash)}:${items.length}:${rasters.length}`
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

/**
 * A cursor names its snapshot and query by fingerprint and length, not by their text: a map
 * snapshot id carries every document revision, and a cursor holding it outgrew what MCP accepts.
 * ponytail: 32-bit fingerprint plus length; a colliding stale cursor would page the new snapshot.
 */
const cursorTag = (text: string) => `${hex32(fnv1a32(text))}.${text.length}`

function cursor(snapshotId: string, query: string, offset: number): string {
  return `${cursorTag(snapshotId)}|${cursorTag(query)}|${String(offset)}`
}

function cursorOffset(value: string | undefined, snapshotId: string, query: string): number {
  if (value === undefined) return 0
  const parts = value.split('|')
  if (parts.length !== 3) throw new TypeError('world cursor is malformed')
  const [cursorSnapshot, cursorQuery] = parts
  const offset = Number(parts[2])
  if (cursorSnapshot !== cursorTag(snapshotId)) {
    throw new TypeError('world cursor belongs to another or stale source snapshot')
  }
  if (cursorQuery !== cursorTag(query) || !Number.isSafeInteger(offset) || offset < 0) {
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

/**
 * A publisher's region shape as geometry: a circle (`center`, `radius`), a rectangle (`rect` or
 * `rectangle`: `min`/`max` or `minimum`/`maximum`, corners in either order — Warcraft III `w3r`,
 * SC2 `rect`), SC2's `diamond` (the rhombus inside its rectangle) and a polygon (`points`,
 * `x,y` pairs apart by spaces or semicolons). Anything else keeps its raw parameters only.
 */
function regionShape(shape: {
  readonly type: string
  readonly parameters: Readonly<Record<string, string>>
}): WorldSceneRegionShape {
  const { parameters } = shape
  const type = shape.type.toLowerCase()
  const center = numericPair(parameters['center'])
  const radiusValue = parameters['radius']
  const radius = radiusValue === undefined ? undefined : Number(radiusValue)
  const corner = (short: string, long: string) => numericPair(parameters[short] ?? parameters[long])
  const first = corner('min', 'minimum')
  const second = corner('max', 'maximum')
  const box =
    first === undefined || second === undefined
      ? undefined
      : {
          minimum: Object.freeze({
            x: Math.min(first.x, second.x),
            y: Math.min(first.y, second.y),
          }),
          maximum: Object.freeze({
            x: Math.max(first.x, second.x),
            y: Math.max(first.y, second.y),
          }),
        }
  if ((type === 'rect' || type === 'rectangle') && box !== undefined)
    return Object.freeze({ kind: 'rectangle', ...box, rawParameters: parameters })
  if (type === 'diamond' && box !== undefined) {
    const middle = {
      x: (box.minimum.x + box.maximum.x) / 2,
      y: (box.minimum.y + box.maximum.y) / 2,
    }
    return Object.freeze({
      kind: 'polygon',
      points: Object.freeze([
        Object.freeze({ x: middle.x, y: box.minimum.y }),
        Object.freeze({ x: box.maximum.x, y: middle.y }),
        Object.freeze({ x: middle.x, y: box.maximum.y }),
        Object.freeze({ x: box.minimum.x, y: middle.y }),
      ]),
      rawParameters: parameters,
    })
  }
  const points = parameters['points']
    ?.split(/[\s;]+/u)
    .filter(item => item !== '')
    .map(numericPair)
  if (type === 'polygon' && points !== undefined && points.length >= 3 && points.every(Boolean))
    return Object.freeze({
      kind: 'polygon',
      points: Object.freeze(points as Readonly<{ x: number; y: number }>[]),
      rawParameters: parameters,
    })
  return Object.freeze({
    kind: shape.type,
    ...(center === undefined ? {} : { center }),
    ...(radius !== undefined && Number.isFinite(radius) ? { radius } : {}),
    rawParameters: parameters,
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
        ((sample.presentationHeightAdjustment ?? sample.heightAdjustment) *
          transform.vertData.quantizeScale -
          transform.vertData.quantizeBias)
      : sample.heightBase * transform.heightMap.scale.z + transform.heightMap.offset.z
  return Object.freeze({
    x: transform.heightMap.offset.x + sample.x * transform.heightMap.scale.x,
    y: transform.heightMap.offset.y + sample.y * transform.heightMap.scale.y,
    z: vertical,
  })
}

/** Query a bounded exact height grid using the same diagonal policy as the world renderer. */
function terrainHeightAt(
  position: Readonly<{ x: number; y: number }>,
  terrain: NonNullable<ResolvedMapWorkspaceSnapshot['semantic']['terrain']> | undefined,
  transform: MapTerrainNativeTransform | undefined,
  materials: ReadonlyMap<string, MapTerrainMaterialSample>,
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
  return terrainCellHeight(
    [height(x0, y0), height(x1, y0), height(x1, y1), height(x0, y1)], tx, ty,
    materials.get(`${x0}:${y0}`)?.layers,
  )
}

/**
 * The map-native window under a viewer's window (MW5): through the world's canonical transform, each
 * uvw ground axis a scaled native one, or as the plan draws a world without it (native x and y as x
 * and z). Undefined when the ground's axes are not native x and y.
 */
export function nativeWorldWindow(
  view: WorldSceneViewWindow,
  transform: MapWorldCanonicalTransform | undefined,
): MapWorldWindow | undefined {
  const corners = [view.minimumX, view.minimumZ, view.maximumX, view.maximumZ]
  if (
    !corners.every(Number.isFinite) ||
    view.minimumX > view.maximumX ||
    view.minimumZ > view.maximumZ
  )
    throw new TypeError('a world view window has finite ordered minimum/maximum x and z')
  if (transform === undefined)
    return Object.freeze({
      minimumX: view.minimumX,
      minimumY: view.minimumZ,
      maximumX: view.maximumX,
      maximumY: view.maximumZ,
    })
  const native: Partial<Record<'x' | 'y' | 'z', readonly [number, number]>> = {}
  for (const [axis, low, high] of [
    ['x', view.minimumX, view.maximumX],
    ['z', view.minimumZ, view.maximumZ],
  ] as const) {
    const { sourceAxis, scale, offset } = transform.axes[axis]
    const a = (low - offset) / scale
    const b = (high - offset) / scale
    native[sourceAxis] = [Math.min(a, b), Math.max(a, b)]
  }
  const { x, y } = native
  if (x === undefined || y === undefined || ![...x, ...y].every(Number.isFinite)) return undefined
  return Object.freeze({ minimumX: x[0], minimumY: y[0], maximumX: x[1], maximumY: y[1] })
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

/** Admit authored lattice polygons without changing their declared native coordinate space. */
function admittedLatticeCoverage(
  snapshot: ResolvedMapWorkspaceSnapshot,
): ReadonlyMap<number, MapLatticeObjectCoverage> {
  const spaces = new Set(snapshot.worldCandidate.coordinateSpaces.map(space => space.id))
  const objects = new Set(snapshot.semantic.objects.map(object => object.objectId))
  const result = new Map<number, MapLatticeObjectCoverage>()
  for (const entry of snapshot.latticeCoverage?.objects ?? []) {
    if (
      !Number.isSafeInteger(entry.objectId) ||
      !objects.has(entry.objectId) ||
      result.has(entry.objectId)
    )
      throw new TypeError('lattice coverage has an unknown or duplicate objectId')
    if (!spaces.has(entry.coordinateSpaceId))
      throw new TypeError('lattice coverage has an undeclared coordinate space')
    if (
      entry.roles?.some(role => !['resource', 'destructible', 'start'].includes(role)) ||
      (entry.resourceKind !== undefined &&
        (typeof entry.resourceKind !== 'string' || entry.resourceKind.length === 0))
    )
      throw new TypeError('lattice coverage has an invalid role or resource kind')
    const channels = ['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const
    for (const channel of channels)
      for (const polygon of entry[channel] ?? []) {
        if (
          polygon.length < 3 ||
          polygon.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
        )
          throw new TypeError(`lattice coverage has an invalid ${channel} polygon`)
      }
    const copiedChannels = Object.fromEntries(
      channels.flatMap(channel =>
        entry[channel] === undefined
          ? []
          : [
              [
                channel,
                Object.freeze(
                  entry[channel].map(polygon =>
                    Object.freeze(polygon.map(point => Object.freeze({ x: point.x, y: point.y }))),
                  ),
                ),
              ],
            ],
      ),
    )
    result.set(
      entry.objectId,
      Object.freeze({
        coordinateSpaceId: entry.coordinateSpaceId,
        ...(entry.roles === undefined ? {} : { roles: Object.freeze([...entry.roles]) }),
        ...(entry.resourceKind === undefined ? {} : { resourceKind: entry.resourceKind }),
        ...copiedChannels,
      }),
    )
  }
  return result
}

function canonicalObjectRotation(
  rotation: number | undefined,
  nativeUnit: string | undefined,
  sense: MapPlacedObject['nativeRotationSense'],
): readonly [number, number, number, number] | undefined {
  let radians: number
  if (rotation === undefined) radians = 0
  else if (nativeUnit === 'radians') radians = rotation
  else if (nativeUnit === 'degrees') radians = (rotation * Math.PI) / 180
  else if (nativeUnit === 'uint16-turn') radians = (rotation * Math.PI * 2) / 65_536
  else return undefined
  if (!Number.isFinite(radians)) return undefined
  if (sense === 'clockwise') radians = -radians
  const half = radians / 2
  const y = Math.sin(half)
  const w = Math.cos(half)
  return Object.freeze([0, y === 0 ? 0 : y, 0, w === 0 ? 0 : w])
}

/**
 * Pre-rotates root nodes by a map-native yaw, matching `canonicalObjectRotation` (+Y in UVW).
 * Used when the chosen model candidate is a rotated variant of the authored piece.
 */

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
    // a sample with no ground spans the grid but has no height: its height is a placeholder
    const ground = sample.noGround !== true
    minimum = {
      x: Math.min(minimum.x, position.x),
      y: Math.min(minimum.y, position.y),
      z: ground ? Math.min(minimum.z, position.z) : minimum.z,
    }
    maximum = {
      x: Math.max(maximum.x, position.x),
      y: Math.max(maximum.y, position.y),
      z: ground ? Math.max(maximum.z, position.z) : maximum.z,
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

/**
 * The publisher's map-native to UVW transform when every check holds, or the first check it failed:
 * a refused transform is reported (`uvwTransformRefusal`), not dropped as if it was never published.
 *
 * A world without terrain (its ground is objects: Minecraft chunks, a Diablo III scene) has no
 * terrain to qualify the transform against: its heightfield is the declared grid frame and its
 * bounds stand as declared; its proof is the publisher's, as for any world.
 */
function admittedWorldCanonicalTransform(
  snapshot: ResolvedMapWorkspaceSnapshot,
  terrainTransform: MapTerrainNativeTransform | undefined,
  hasTerrain: boolean,
): Readonly<{ transform?: MapWorldCanonicalTransform; refusal?: string }> {
  const transform = snapshot.uvwTransform
  if (transform === undefined) return {}
  if (terrainTransform === undefined && hasTerrain) {
    return { refusal: 'the terrain has no admitted exact native transform to qualify it against' }
  }
  const finite = (value: number): boolean => Number.isFinite(value)
  const positive = (value: number): boolean => finite(value) && value > 0
  const sha256 = (value: string): boolean => /^sha256:[0-9a-f]{64}$/u.test(value)
  const { basis, heightfield, bounds, proof } = transform
  const axes = Object.values(transform.axes)
  const [columns, rows] = terrainTransform?.heightMap.dim ?? [0, 0]
  // In order: a check may rely on the ones before it.
  const checks: readonly (readonly [string, () => boolean])[] = [
    ['its schemaVersion is not 1', () => transform.schemaVersion !== 1],
    ['it belongs to another snapshot', () => transform.snapshotId !== snapshot.snapshotId],
    [
      'it does not map map-native to uvw-canonical',
      () =>
        transform.sourceCoordinateSpaceId !== 'map-native' ||
        transform.targetCoordinateSpaceId !== 'uvw-canonical',
    ],
    [
      'its basis is not right-handed with y up and +z forward',
      () => basis.handedness !== 'right' || basis.upAxis !== 'y' || basis.forwardAxis !== '+z',
    ],
    [
      'its unit is neither meter nor a named source unit without metersPerUnit',
      () =>
        (basis.unit !== 'meter' && basis.unit !== 'source-unit') ||
        (basis.unit === 'source-unit' &&
          (basis.sourceUnit === undefined ||
            basis.sourceUnit.length === 0 ||
            basis.metersPerUnit !== undefined)),
    ],
    [
      'an axis scale is zero or not finite, or an offset is not finite',
      () => axes.some(item => !finite(item.scale) || item.scale === 0 || !finite(item.offset)),
    ],
    [
      'its axes do not take three distinct source axes',
      () => new Set(axes.map(item => item.sourceAxis)).size !== 3,
    ],
    [
      terrainTransform === undefined
        ? `its heightfield ${String(heightfield.columns)}x${String(heightfield.rows)} is not a grid of positive size`
        : `its heightfield ${String(heightfield.columns)}x${String(heightfield.rows)} is not the terrain grid ${String(columns)}x${String(rows)}`,
      () =>
        !Number.isSafeInteger(heightfield.columns) ||
        !Number.isSafeInteger(heightfield.rows) ||
        (terrainTransform === undefined
          ? heightfield.columns <= 0 || heightfield.rows <= 0
          : heightfield.columns !== columns || heightfield.rows !== rows),
    ],
    [
      'its cellSize is not positive or unitsPerCell differs from it',
      () =>
        !positive(heightfield.cellSize) ||
        (basis.unitsPerCell !== undefined && basis.unitsPerCell !== heightfield.cellSize),
    ],
    [
      'its heightfield origin is not three finite numbers',
      () => heightfield.origin.length !== 3 || !heightfield.origin.every(finite),
    ],
    [
      `its sourceRowOrder ${String(heightfield.sourceRowOrder)} is neither forward nor reverse`,
      () => heightfield.sourceRowOrder !== 'forward' && heightfield.sourceRowOrder !== 'reverse',
    ],
    [
      'its bounds are not finite uvw-canonical bounds with minimum <= maximum',
      () =>
        bounds.coordinateSpaceId !== 'uvw-canonical' ||
        !(['x', 'y', 'z'] as const).every(
          axis =>
            finite(bounds.minimum[axis]) &&
            finite(bounds.maximum[axis]) &&
            bounds.minimum[axis] <= bounds.maximum[axis],
        ),
    ],
    [
      'its proof is not an adapter qualification over a positive tuple count',
      () =>
        proof.kind !== 'adapter-qualification' ||
        !Number.isSafeInteger(proof.tupleCount) ||
        proof.tupleCount <= 0,
    ],
    [
      `its proof method ${String(proof.method)} is none sdk names`,
      () => !PROOF_METHODS.has(proof.method),
    ],
    [
      'its proof names no oracle, corpus or sha256 source digests',
      () =>
        proof.oracle.length === 0 ||
        proof.corpus.length === 0 ||
        Object.keys(proof.sourceDigests).length === 0 ||
        !Object.values(proof.sourceDigests).every(sha256),
    ],
    [
      'a tuple digest of its proof is not sha256',
      () =>
        !sha256(proof.nativeTupleDigest) ||
        (proof.presentationTupleDigest !== undefined && !sha256(proof.presentationTupleDigest)) ||
        !sha256(proof.canonicalTupleDigest),
    ],
    [
      'its proof comparison is not ieee-754-binary64-exact',
      () => proof.comparison !== 'ieee-754-binary64-exact',
    ],
  ]
  const failed = checks.find(([, fails]) => fails())
  if (failed !== undefined) return { refusal: failed[0] }
  if (terrainTransform === undefined) return { transform }

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
    ? { transform }
    : { refusal: 'its bounds are not the canonical image of the terrain bounds' }
}

/**
 * Why a transform's proof fails on the map it was qualified on (С12), or undefined. When every
 * document its `sourceDigests` names by file name was read with that digest, this map is the
 * proof's corpus, and its terrain must give the proof's tuples: map-native positions in sample order
 * and canonical ones in heightfield order, each tuple three little-endian binary64 values
 * (mapQualificationTupleBytes, ADR-WORLD-001 and -002). On any other map the proof qualifies the
 * adapter, not the map, and nothing is recomputed. `readDigests` maps the file names of the
 * documents the analysis read, in lower case, to their `sha256:` digests.
 */
export async function worldTransformCorpusRefusal(
  snapshot: ResolvedMapWorkspaceSnapshot,
  readDigests: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const transform = snapshot.uvwTransform
  const terrain = snapshot.semantic.terrain
  const native =
    terrain === undefined
      ? undefined
      : admittedTerrainTransform(snapshot, terrain, hasExactTerrainGrid(terrain))
  if (transform === undefined || terrain === undefined || native === undefined) return undefined
  const { proof } = transform
  const named = Object.entries(proof.sourceDigests).flatMap(([name, digest]) => {
    const read = readDigests.get(name.toLowerCase())
    return read === undefined ? [] : [{ digest, read }]
  })
  if (named.length === 0 || named.some(item => item.digest !== item.read)) return undefined
  if (terrain.samples.length !== proof.tupleCount)
    return `its proof counts ${String(proof.tupleCount)} tuples; its corpus terrain has ${String(terrain.samples.length)}`
  const positions = terrain.samples.map(sample => terrainMapNativePosition(sample, native))
  const { columns, rows, sourceRowOrder } = transform.heightfield
  const canonical: [number, number, number][] = []
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = sourceRowOrder === 'reverse' ? rows - 1 - row : row
    for (let column = 0; column < columns; column += 1) {
      const value = canonicalPosition(positions[sourceRow * columns + column]!, transform)
      canonical.push([value.x, value.y, value.z])
    }
  }
  const digest = async (bytes: Uint8Array): Promise<string> => {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.slice()))
    return `sha256:${[...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  if (
    (await digest(mapQualificationTupleBytes(positions.map(item => [item.x, item.y, item.z])))) !==
    proof.nativeTupleDigest
  )
    return 'its native tuple digest is not that of its corpus terrain'
  if ((await digest(mapQualificationTupleBytes(canonical))) !== proof.canonicalTupleDigest)
    return 'its canonical tuple digest is not that of its corpus terrain'
  return undefined
}

/** One owner for complete independent native grids. Value semantics are validated by each facet. */
function admittedNativeSampleGrid(
  navigation: Pick<MapNavigationSummary, 'exact' | 'width' | 'height' | 'cellCount' | 'grid'> &
    Readonly<{ samples: readonly Readonly<{ x: number; y: number }>[] }>,
  transform: MapWorldCanonicalTransform | undefined,
): Readonly<{ grid?: NonNullable<WorldSceneLayerItem['grid']>; positions?: readonly MapPosition[]; directions?: readonly number[]; reason?: string }> {
  if (navigation?.exact !== true) return {}
  const reject = (reason: string) => Object.freeze({ reason: `exact grid refused: ${reason}` })
  if (transform === undefined) return reject('the native world frame is not qualified')
  const { width, height, cellCount, samples, grid } = navigation
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 ||
    !Number.isSafeInteger(width * height) || cellCount !== width * height || samples.length !== cellCount)
    return reject('the sample grid is not complete')
  const vector = (value: unknown): value is MapPosition => value !== null && typeof value === 'object' &&
    (['x', 'y', 'z'] as const).every(axis => Number.isFinite((value as MapPosition)[axis]))
  if (grid?.coordinateSpaceId !== 'map-native' || !vector(grid.origin) || !vector(grid.columnStep) || !vector(grid.rowStep))
    return reject('native sample origin and steps are missing or invalid')
  const seen = new Set<number>()
  for (const item of samples) {
    if (item === undefined || item === null || !Number.isSafeInteger(item.x) || !Number.isSafeInteger(item.y) || item.x < 0 || item.x >= width ||
      item.y < 0 || item.y >= height)
      return reject('a native sample coordinate is invalid')
    const index = item.y * width + item.x
    if (seen.has(index)) return reject('a native sample coordinate is repeated')
    seen.add(index)
  }
  const position = (x: number, y: number) => canonicalPosition({
    x: grid.origin.x + x * grid.columnStep.x + y * grid.rowStep.x,
    y: grid.origin.y + x * grid.columnStep.y + y * grid.rowStep.y,
    z: grid.origin.z + x * grid.columnStep.z + y * grid.rowStep.z,
  }, transform)
  const origin = position(0, 0), column = position(1, 0), row = position(0, 1)
  if (![origin, column, row].every(vector)) return reject('the projected frame is not finite')
  const cx = column.x - origin.x, cz = column.z - origin.z
  const rx = row.x - origin.x, rz = row.z - origin.z
  const aligned = cx !== 0 && cz === 0 && rx === 0 && rz !== 0
  const swapped = cx === 0 && cz !== 0 && rx !== 0 && rz === 0
  if ((!aligned && !swapped) || column.y !== origin.y || row.y !== origin.y ||
    (aligned ? Math.abs(cx) !== Math.abs(rz) : Math.abs(cz) !== Math.abs(rx)))
    return reject('the projected samples do not form an axis-aligned square grid')
  const cellSize = Math.abs(aligned ? cx : cz)
  const end = position(width - 1, height - 1)
  const minimumX = Math.min(origin.x, end.x), minimumZ = Math.min(origin.z, end.z)
  const maximumX = Math.max(origin.x, end.x), maximumZ = Math.max(origin.z, end.z)
  if (!vector(end) || minimumX < transform.bounds.minimum.x - 1e-9 || maximumX > transform.bounds.maximum.x + 1e-9 ||
    minimumZ < transform.bounds.minimum.z - 1e-9 || maximumZ > transform.bounds.maximum.z + 1e-9)
    return reject('the sample grid extends beyond the qualified world bounds')
  const positions = samples.map(item => Object.freeze(position(item.x, item.y)))
  if (!positions.every(vector)) return reject('a projected sample is not finite')
  return Object.freeze({
    grid: Object.freeze({ columns: swapped ? height : width, rows: swapped ? width : height,
      cellSize, origin: Object.freeze([minimumX, origin.y, minimumZ] as const), coordinateSpaceId: 'uvw-canonical' }),
    positions: Object.freeze(positions),
    directions: Object.freeze([cx > 0 ? 1 : cx < 0 ? 2 : cz > 0 ? 4 : 8,
      cx > 0 ? 2 : cx < 0 ? 1 : cz > 0 ? 8 : 4,
      rx > 0 ? 1 : rx < 0 ? 2 : rz > 0 ? 4 : 8,
      rx > 0 ? 2 : rx < 0 ? 1 : rz > 0 ? 8 : 4]),
  })
}

function admittedNavigationGrid(navigation: ResolvedMapWorkspaceSnapshot['navigation'], transform: MapWorldCanonicalTransform | undefined): ReturnType<typeof admittedNativeSampleGrid> {
  if (navigation?.exact !== true) return {}
  if (navigation.trailingBytes !== 0) return { reason: 'exact navigation refused: native trailing bytes are not represented by the flags grid' }
  if (!isNavigationFlagEncoding(navigation.flagEncoding)) return { reason: 'exact navigation refused: the flags vocabulary is not versioned and publisher-scoped' }
  if (navigation.samples.some(item => !Number.isSafeInteger(item.flags) || item.flags < 0))
    return { reason: 'exact navigation refused: a native flags value is invalid' }
  return admittedNativeSampleGrid(navigation, transform)
}

function admittedCliffGrid(cliffs: MapCliffSummary | undefined, transform: MapWorldCanonicalTransform | undefined): ReturnType<typeof admittedNativeSampleGrid> {
  if (cliffs?.grid === undefined) return {}
  const admitted = admittedNativeSampleGrid(cliffs, transform)
  if (admitted.grid === undefined) return { reason: admitted.reason ?? 'exact cliffs refused: the publisher did not provide a complete exact grid' }
  if (cliffs.samples.some(sample => !Number.isSafeInteger(sample.level) || sample.level < 0 || typeof sample.authored !== 'boolean' ||
    (sample.ramp !== undefined && typeof sample.ramp !== 'boolean')))
    return { reason: 'exact cliffs refused: a cliff classification is invalid' }
  return admitted
}

function admittedGameRaster(published: MapGameRasterSummary, transform: MapWorldCanonicalTransform | undefined): Readonly<{
  grid?: NonNullable<WorldSceneLayerItem['grid']>
  metadata?: GameRasterValueMetadata
  values?: readonly WorldSceneGameRasterItem[]
  reason?: string
}> {
  const refuse = (reason: string) => ({ reason: `exact game raster refused: ${reason}` })
  const { descriptor, values, metadata } = published
  if (published.trailingBytes !== 0) return refuse('unrepresented native bytes')
  if (!isVersionedPublisherId(metadata.valueMeaning) || !['u8','u16','u32','i32','f64'].includes(metadata.valueType))
    return refuse('unknown publisher vocabulary or numeric storage')
  if (descriptor.sampling !== 'cell' && descriptor.sampling !== 'vertex') return refuse('sample location is not declared')
  if (values.layer !== descriptor.id || values.width !== descriptor.width || values.height !== descriptor.height ||
    (values.x !== undefined && values.x !== 0) || (values.y !== undefined && values.y !== 0)) return refuse('native map.layers window is not the complete declared layer')
  if (!isGameRasterValue(descriptor.minimum, metadata.valueType) || !isGameRasterValue(descriptor.maximum, metadata.valueType) || descriptor.minimum > descriptor.maximum)
    return refuse('invalid declared value range')
  if (metadata.noDataValue !== undefined && !isGameRasterValue(metadata.noDataValue, metadata.valueType)) return refuse('invalid NoData marker')
  if (descriptor.unit !== undefined && (!descriptor.unit || descriptor.unit.length > 1024)) return refuse('invalid unit')
  for (const scalar of [descriptor.valueScale, descriptor.valueOffset]) if (scalar !== undefined && !Number.isFinite(scalar)) return refuse('invalid declared scale or offset')
  const categories = descriptor.categories
  if (categories !== undefined && (new Set(categories.map(entry => entry.value)).size !== categories.length || categories.some(entry =>
    !isGameRasterValue(entry.value, metadata.valueType) || entry.value < descriptor.minimum || entry.value > descriptor.maximum ||
    typeof entry.label !== 'string' || (entry.color !== undefined && !/^#[0-9a-fA-F]{6}$/u.test(entry.color)))))
    return refuse('invalid category legend')
  const samples = Array.from(values.values, (value, index) => ({ x: index % descriptor.width, y: Math.floor(index / descriptor.width), value }))
  if (samples.some(sample => !isGameRasterValue(sample.value, metadata.valueType) ||
    (sample.value !== metadata.noDataValue && (sample.value < descriptor.minimum || sample.value > descriptor.maximum))))
    return refuse('native sample is outside declared type or range')
  const admitted = admittedNativeSampleGrid({ exact: published.exact, width: descriptor.width, height: descriptor.height,
    cellCount: descriptor.width * descriptor.height, grid: published.grid, samples }, transform)
  if (admitted.grid === undefined || admitted.positions === undefined || transform === undefined)
    return refuse(admitted.reason ?? 'not a complete exact grid in a qualified frame')
  const { grid, positions } = admitted
  const half = descriptor.sampling === 'cell' ? grid.cellSize / 2 : 0
  const origin = [grid.origin[0] - half, grid.origin[1], grid.origin[2] - half] as const
  const maxX = grid.origin[0] + (grid.columns - 1) * grid.cellSize + half
  const maxZ = grid.origin[2] + (grid.rows - 1) * grid.cellSize + half
  if (origin[0] < transform.bounds.minimum.x - 1e-9 || origin[2] < transform.bounds.minimum.z - 1e-9 ||
    maxX > transform.bounds.maximum.x + 1e-9 || maxZ > transform.bounds.maximum.z + 1e-9)
    return refuse('the declared sample footprint extends beyond world bounds')
  const retained = Object.freeze({ ...metadata, sampling: descriptor.sampling, minimum: descriptor.minimum, maximum: descriptor.maximum,
    ...(descriptor.unit === undefined ? {} : { unit: descriptor.unit }),
    ...(descriptor.valueScale === undefined ? {} : { valueScale: descriptor.valueScale }),
    ...(descriptor.valueOffset === undefined ? {} : { valueOffset: descriptor.valueOffset }),
    ...(categories === undefined ? {} : { categories: Object.freeze(categories.map(entry => Object.freeze({ ...entry }))) }) })
  const id = `world.game-raster:${descriptor.id}`
  return { grid: Object.freeze({ ...grid, origin }), metadata: retained,
    values: Object.freeze(samples.map((sample, index) => {
      const point = positions[index]!
      return Object.freeze({ facet: 'game-raster' as const, id: `${id}:${sample.x}:${sample.y}`, layerId: id,
        coordinateSpaceId: 'uvw-canonical' as const, lod: 'exact' as const, value: sample.value,
        x: Math.round((point.x - grid.origin[0]) / grid.cellSize), y: Math.round((point.z - grid.origin[2]) / grid.cellSize), uvwPosition: point })
    })) }
}

function admittedQuerySurface(published: MapQuerySurfaceSummary, transform: MapWorldCanonicalTransform | undefined): Readonly<{
  grid?: NonNullable<WorldSceneLayerItem['grid']>
  values?: readonly WorldSceneSurfaceItem[]
  reason?: string
}> {
  const refuse = (reason: string) => ({ reason: `exact query surface refused: ${reason}` })
  if (published.trailingBytes !== 0) return refuse('unrepresented native bytes')
  const admitted = admittedNativeSampleGrid(published, transform)
  if (admitted.grid === undefined || admitted.positions === undefined || transform === undefined)
    return refuse(admitted.reason ?? 'not a complete exact grid in a qualified frame')
  const { grid, positions } = admitted
  const heightAt = (height: number) => canonicalPosition({ x: 0, y: 0, z: 0,
    [transform.axes.y.sourceAxis]: height }, transform).y
  if (published.noDataValue !== undefined && !Number.isFinite(published.noDataValue)) return refuse('invalid NoData marker')
  const noDataValue = published.noDataValue === undefined ? undefined : heightAt(published.noDataValue)
  if (noDataValue !== undefined && !Number.isFinite(noDataValue)) return refuse('non-finite transformed NoData marker')
  const values: WorldSceneSurfaceItem[] = []
  for (const [index, sample] of published.samples.entries()) {
    if (!Number.isFinite(sample.height)) return refuse('non-finite native height')
    const height = heightAt(sample.height)
    if (!Number.isFinite(height)) return refuse('non-finite projected height')
    const absent = sample.height === published.noDataValue
    if (!absent && (height < transform.bounds.minimum.y - 1e-9 || height > transform.bounds.maximum.y + 1e-9))
      return refuse('heights extend beyond qualified world bounds')
    const point = positions[index]!
    const x = Math.round((point.x - grid.origin[0]) / grid.cellSize), y = Math.round((point.z - grid.origin[2]) / grid.cellSize)
    if (!absent && height === noDataValue) return refuse('projected NoData marker collides with a valid height')
    if (!absent) values.push(Object.freeze({ facet: 'surfaces', id: `world.surfaces:${published.id}:${x}:${y}`,
      layerId: `world.surfaces:${published.id}`, coordinateSpaceId: 'uvw-canonical', lod: 'exact', x, y,
      heightBase: height, heightAdjustment: 0, mask: 0, uvwPosition: Object.freeze({ ...point, y: height }) }))
  }
  return { grid: Object.freeze({ ...grid, ...(noDataValue === undefined ? {} : { noDataValue }) }), values: Object.freeze(values) }
}

function admittedTraversalGrid(traversal: MapTraversalSummary, transform: MapWorldCanonicalTransform | undefined, topology: string | undefined, querySurfaces: ReadonlyMap<string, ReturnType<typeof admittedQuerySurface>>): Readonly<{
  grid?: NonNullable<WorldSceneLayerItem['grid']>
  values?: readonly Readonly<Pick<WorldSceneTraversalItem, 'x' | 'y' | 'walkable' | 'exits' | 'uvwPosition'>>[]
  reason?: string
}> {
  const refuse = (reason: string) => ({ reason: `exact traversal refused: ${reason}` })
  if (traversal.trailingBytes !== 0) return refuse('native trailing bytes are not represented by the traversal grid')
  const admitted = admittedNativeSampleGrid(traversal, transform)
  if (admitted.grid === undefined || admitted.positions === undefined || admitted.directions === undefined)
    return refuse(admitted.reason ?? 'the publisher did not provide a complete exact grid')
  const { grid, positions, directions } = admitted
  const origin = [grid.origin[0] - grid.cellSize / 2, grid.origin[1], grid.origin[2] - grid.cellSize / 2] as const
  const maxX = origin[0] + grid.columns * grid.cellSize, maxZ = origin[2] + grid.rows * grid.cellSize
  if (transform === undefined || origin[0] < transform.bounds.minimum.x - 1e-9 || maxX > transform.bounds.maximum.x + 1e-9 ||
    origin[2] < transform.bounds.minimum.z - 1e-9 || maxZ > transform.bounds.maximum.z + 1e-9 ||
    origin[1] < transform.bounds.minimum.y - 1e-9 || origin[1] > transform.bounds.maximum.y + 1e-9)
    return refuse('the cell footprint extends beyond the qualified world bounds')
  if (traversal.surfaceLayerId !== undefined) {
    const surface = traversal.surfaceLayerId === 'terrain'
      ? topology === 'mesh' ? undefined : transform.heightfield
      : querySurfaces.get(traversal.surfaceLayerId)?.grid
    if (surface === undefined) return refuse('the selected surface is unavailable or not admitted')
    if (grid.origin[0] < surface.origin[0] - 1e-9 || grid.origin[2] < surface.origin[2] - 1e-9 ||
      grid.origin[0] + (grid.columns - 1) * grid.cellSize > surface.origin[0] + (surface.columns - 1) * surface.cellSize + 1e-9 ||
      grid.origin[2] + (grid.rows - 1) * grid.cellSize > surface.origin[2] + (surface.rows - 1) * surface.cellSize + 1e-9)
      return refuse('the heightfield does not cover traversal cell centres')
  }
  const cells = new Map(traversal.samples.map(cell => [cell.y * traversal.width + cell.x, cell]))
  for (const cell of traversal.samples) {
    if (typeof cell.walkable !== 'boolean' || !Number.isSafeInteger(cell.exits) || cell.exits < 0 || cell.exits > 15 || (!cell.walkable && cell.exits !== 0))
      return refuse('a traversal cell or exits mask is invalid')
    for (const [dx, dy, bit] of [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]] as const) {
      if ((cell.exits & bit) === 0) continue
      const x = cell.x + dx, y = cell.y + dy
      if (x < 0 || x >= traversal.width || y < 0 || y >= traversal.height || cells.get(y * traversal.width + x)?.walkable !== true)
        return refuse('a directed edge leaves the walkable native grid')
    }
  }
  const values = traversal.samples.map((cell, index) => {
    const uvwPosition = positions[index]!
    const exits = directions.reduce((mask, canonical, direction) => (cell.exits & (1 << direction)) === 0 ? mask : mask | canonical, 0)
    return Object.freeze({ x: Math.round((uvwPosition.x - grid.origin[0]) / grid.cellSize),
      y: Math.round((uvwPosition.z - grid.origin[2]) / grid.cellSize), walkable: cell.walkable, exits, uvwPosition })
  })
  return { grid: Object.freeze({ ...grid, origin }), values: Object.freeze(values) }
}

/** Creates a lease whose release makes every page/cursor stale immediately. */
export function createCandidateWorldSceneLease(
  snapshot: ResolvedMapWorkspaceSnapshot,
  provenance: readonly ResourceProvenanceRecord[],
  maxPageSize: number,
  modelResources?: ModelResourcePort,
  releaseModelResources?: () => Promise<void>,
  rasterResources?: RasterResourcePort,
  /** Why the transform's proof failed on its own corpus (worldTransformCorpusRefusal). */
  corpusRefusal?: string,
): Lease<CandidateWorldSceneSource> {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER)
  // One material model skins hundreds of piece models; convert it once per lease.
  const materialModelCache = new Map<string, Promise<readonly ModelMaterialRef[] | undefined>>()
  const modelTextureCache = new Map<string, Promise<WorldModelTexture>>()
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
  const admitted = admittedWorldCanonicalTransform(
    snapshot,
    terrainTransform,
    terrainSummary !== undefined,
  )
  const { transform: uvwTransform, refusal: uvwTransformRefusal } =
    admitted.transform !== undefined && corpusRefusal !== undefined
      ? { transform: undefined, refusal: corpusRefusal }
      : admitted
  const latticeObjects = admittedLatticeCoverage(snapshot)
  const cliffFaces = snapshot.latticeCoverage?.cliffFaces
  let cliffFaceCells: ReadonlySet<string> | undefined
  if (cliffFaces !== undefined) {
    if (
      cliffFaces.coordinateSpaceId !== 'height-grid' ||
      !terrainExact ||
      terrainSummary === undefined
    )
      throw new TypeError('cliff-face coverage requires an exact height grid')
    const cells = new Set<string>()
    for (const cell of cliffFaces.cells) {
      if (
        !Number.isSafeInteger(cell.x) ||
        !Number.isSafeInteger(cell.y) ||
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= terrainSummary.width - 1 ||
        cell.y >= terrainSummary.height - 1
      )
        throw new TypeError('cliff-face coverage has an out-of-grid cell')
      const key = `${cell.x}:${cell.y}`
      if (cells.has(key)) throw new TypeError('cliff-face coverage has a duplicate cell')
      cells.add(key)
    }
    cliffFaceCells = cells
  }
  /** Project only horizontal polygons whose native axes are proved by this lease's transforms. */
  const projectLatticeCoverage = (
    coverage: MapLatticeObjectCoverage,
  ): WorldSceneObjectItem['uvwLatticeCoverage'] | undefined => {
    if (
      uvwTransform === undefined ||
      uvwTransform.axes.x.sourceAxis === 'z' ||
      uvwTransform.axes.z.sourceAxis === 'z' ||
      (coverage.coordinateSpaceId !== 'map-native' &&
        (coverage.coordinateSpaceId !== 'height-grid' || terrainTransform === undefined))
    )
      return undefined
    const point = (source: Readonly<{ x: number; y: number }>) => {
      const native =
        coverage.coordinateSpaceId === 'height-grid' && terrainTransform !== undefined
          ? {
              x:
                terrainTransform.heightMap.offset.x + source.x * terrainTransform.heightMap.scale.x,
              y:
                terrainTransform.heightMap.offset.y + source.y * terrainTransform.heightMap.scale.y,
              z: 0,
            }
          : { x: source.x, y: source.y, z: 0 }
      const projected = canonicalPosition(native, uvwTransform)
      return Object.freeze({ x: projected.x, y: projected.z })
    }
    const channels = ['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const
    return Object.freeze(
      Object.fromEntries(
        channels.flatMap(channel =>
          coverage[channel] === undefined
            ? []
            : [
                [
                  channel,
                  Object.freeze(
                    coverage[channel].map(polygon => Object.freeze(polygon.map(point))),
                  ),
                ],
              ],
        ),
      ),
    )
  }
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
  const cliffAdmission = admittedCliffGrid(snapshot.cliffs, uvwTransform)
  const cliffExact = snapshot.cliffs?.grid !== undefined ? cliffAdmission.grid !== undefined :
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
  // One resource per catalog entity, split per model requirement only when instances of that entity
  // resolve different models (e.g. authored doodad variations); otherwise every instance would draw
  // the first-seen model.
  const catalogModelRequirements = new Map<string, Set<string>>()
  for (const item of semanticObjects) {
    if (item.catalog === undefined || item.modelResource === undefined) continue
    const key = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId)
    catalogModelRequirements.set(
      key,
      (catalogModelRequirements.get(key) ?? new Set<string>()).add(item.modelResource.id),
    )
  }
  const objectResourceId = (
    ref: Readonly<{ namespace: string; entityId: string }>,
    modelResource: Readonly<{ id: string }> | undefined,
  ): string => {
    const base = resourceId(ref.namespace, ref.entityId)
    return modelResource !== undefined && (catalogModelRequirements.get(base)?.size ?? 0) > 1
      ? `${base}~${encodeURIComponent(modelResource.id)}`
      : base
  }
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length
  const incompleteObjectPositionCount = semanticObjects.filter(
    item => item.sourcePositionDimensions === 2,
  ).length

  const allTerrain: readonly WorldSceneTerrainItem[] = Object.freeze(
    (semantic.terrain?.samples ?? []).map(item => {
      const mapNativePosition =
        terrainTransform === undefined
          ? undefined
          : terrainMapNativePosition(item, terrainTransform)
      const baseOffset =
        terrainTransform !== undefined && 'vertData' in terrainTransform
          ? (item.heightBase * terrainTransform.vertData.quantizeScale -
              terrainTransform.vertData.quantizeBias -
              terrainTransform.vertData.standardHeight) *
            terrainTransform.heightMap.scale.z
          : undefined
      // Without quantized vertices the authored height is the position; a presentation adjustment
      // is only drawn (the vertData path folds it into the position, as SC2 always has).
      const presentationAdjustment =
        terrainTransform !== undefined &&
        !('vertData' in terrainTransform) &&
        item.presentationHeightAdjustment !== undefined &&
        Number.isFinite(item.presentationHeightAdjustment) &&
        item.presentationHeightAdjustment !== 0
          ? item.presentationHeightAdjustment * terrainTransform.heightMap.scale.z
          : undefined
      const presentationUvwPosition =
        presentationAdjustment === undefined ||
        mapNativePosition === undefined ||
        uvwTransform === undefined
          ? undefined
          : canonicalPosition(
              { ...mapNativePosition, z: mapNativePosition.z + presentationAdjustment },
              uvwTransform,
            )
      return Object.freeze({
        facet: 'terrain' as const,
        id: `${terrainLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainLayerId,
        coordinateSpaceId: 'height-grid',
        lod: terrainLod,
        ...item,
        ...(cliffFaceCells === undefined ||
        item.x >= terrainSummary!.width - 1 ||
        item.y >= terrainSummary!.height - 1
          ? {}
          : { cliffFace: cliffFaceCells.has(`${item.x}:${item.y}`) }),
        ...(mapNativePosition === undefined ? {} : { mapNativePosition }),
        ...(mapNativePosition === undefined || uvwTransform === undefined
          ? {}
          : { uvwPosition: canonicalPosition(mapNativePosition, uvwTransform) }),
        ...(presentationUvwPosition === undefined ? {} : { presentationUvwPosition }),
        ...(baseOffset === undefined ? {} : { baseOffset }),
      })
    }),
  )
  // A sample with no ground (an air column) is no terrain item: its cells are holes, and the layer
  // declares the sentinel UVW writes there, below every ground height. Materials keep its place.
  const terrain: readonly WorldSceneItem[] = Object.freeze(
    allTerrain.filter(item => item.noGround !== true),
  )
  const noGroundSamples = allTerrain.length - terrain.length
  const terrainNoDataValue =
    noGroundSamples === 0 || uvwTransform === undefined
      ? undefined
      : Math.min(
          -9999,
          Math.floor(
            terrain.reduce(
              (lowest, item) =>
                item.facet === 'terrain' && item.uvwPosition !== undefined
                  ? Math.min(lowest, item.uvwPosition.y)
                  : lowest,
              0,
            ),
          ) - 1,
        )
  const terrainByGrid = new Map(
    allTerrain.map(item => [`${String(item.x)}:${String(item.y)}`, item] as const),
  )
  const materialSamplesByGrid = new Map(
    (snapshot.terrainMaterials?.samples ?? []).map(item => [`${item.x}:${item.y}`, item] as const),
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
              ...(item.polygon === undefined
                ? {}
                : {
                    uvwPolygon: Object.freeze(
                      item.polygon.map(point => {
                        const p = canonicalPosition(
                          { x: point.x, y: point.y, z: item.elevation! },
                          uvwTransform!,
                        )
                        return Object.freeze({ x: p.x, z: p.z })
                      }),
                    ),
                  }),
            }),
      })
    }),
  )
  const unresolvedWaterElevationCount = water.filter(
    item => item.facet === 'water' && item.elevation === undefined,
  ).length
  const cliffs: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.cliffs?.samples ?? []).map((item, index) => {
      const terrainItem = terrainByGrid.get(`${String(item.x)}:${String(item.y)}`)
      const position = snapshot.cliffs?.grid === undefined
        ? terrainItem?.facet === 'terrain' ? terrainItem.uvwPosition : undefined
        : cliffAdmission.positions?.[index]
      return Object.freeze({
        ...item,
        facet: 'cliffs' as const,
        id: `${cliffLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: cliffLayerId,
        coordinateSpaceId: snapshot.cliffs?.grid === undefined ? 'height-grid' as const : 'uvw-canonical' as const,
        lod: cliffLod,
        ...(position === undefined ? {} : { uvwPosition: position }),
      })
    }),
  )
  const semanticObjectItems: readonly WorldSceneItem[] = Object.freeze(
    semanticObjects.map(item => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`
      const ref = item.catalog?.ref
      const uvwRotation = canonicalObjectRotation(
        item.rotation,
        item.nativeRotationUnit,
        item.nativeRotationSense,
      )
      const uvwPresentationRotation = item.presentationRotation === undefined
        ? undefined
        : canonicalObjectRotation(item.presentationRotation, item.nativeRotationUnit, item.nativeRotationSense)
      const groundHeight = terrainHeightAt(item.position, semantic.terrain, terrainTransform, materialSamplesByGrid)
      const mapNativePresentationPosition =
        groundHeight === undefined ||
        item.heightReference === undefined ||
        item.heightReference === 'absolute'
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
      const latticeCoverage = latticeObjects.get(item.objectId)
      const uvwLatticeCoverage =
        latticeCoverage === undefined ? undefined : projectLatticeCoverage(latticeCoverage)
      return Object.freeze({
        facet: 'objects' as const,
        id,
        layerId: objectLayerId,
        coordinateSpaceId: 'map-native',
        ...item,
        ...(latticeCoverage === undefined ? {} : { latticeCoverage }),
        ...(uvwLatticeCoverage === undefined ? {} : { uvwLatticeCoverage }),
        ...(mapNativePresentationPosition === item.position
          ? {}
          : { mapNativePresentationPosition }),
        ...(uvwTransform === undefined || item.sourcePositionDimensions === 2
          ? {}
          : {
              uvwPosition: canonicalPosition(mapNativePresentationPosition, uvwTransform),
              ...(uvwRotation === undefined ? {} : { uvwRotation }),
              ...(uvwPresentationRotation === undefined ? {} : { uvwPresentationRotation }),
              uvwScale: canonicalObjectScale(item.scale, uvwTransform),
            }),
        ...(ref === undefined ? {} : { resourceId: objectResourceId(ref, item.modelResource) }),
        ...(compoundResourceIds.length === 0
          ? {}
          : { resourceIds: Object.freeze(compoundResourceIds) }),
        ...(modelComponents === undefined
          ? {}
          : { modelComponents: Object.freeze(modelComponents) }),
      })
    }),
  )
  // Authored cliff meshes are presentation instances of the cliffs facet: drawn and picked with the
  // world, never exported or edited as placed objects.
  const cliffPieceModels = new Map(
    (snapshot.cliffs?.pieceModels ?? []).map(model => [model.id, model] as const),
  )
  const cliffModelResourceId = (modelId: string) => `cliff-model:${encodeURIComponent(modelId)}`
  const cliffPieceObjects: readonly WorldSceneObjectItem[] = Object.freeze(
    (snapshot.cliffs?.pieces ?? []).flatMap((piece, index) =>
      cliffPieceModels.get(piece.modelId)?.candidates.length
        ? [
            Object.freeze({
              facet: 'objects' as const,
              id: `${objectLayerId}:cliff:${piece.id}`,
              layerId: objectLayerId,
              coordinateSpaceId: 'map-native',
              kind: 'doodad' as const,
              objectId: -(index + 1),
              typeId: piece.modelId,
              position: piece.position,
              heightReference: 'absolute' as const,
              derivedFrom: 'cliffs' as const,
              // Terrain is never player-owned: no team colour in its materials.
              presentationTeamColor: Object.freeze([1, 1, 1] as const),
              presentationTeamColorIntensity: 0,
              ...(uvwTransform === undefined
                ? {}
                : {
                    uvwPosition: canonicalPosition(piece.position, uvwTransform),
                    uvwRotation: Object.freeze([0, 0, 0, 1] as const),
                    uvwScale: canonicalObjectScale(undefined, uvwTransform),
                  }),
              resourceId: cliffModelResourceId(piece.modelId),
            }),
          ]
        : [],
    ),
  )
  const objects: readonly WorldSceneItem[] = Object.freeze([
    ...semanticObjectItems,
    ...cliffPieceObjects,
  ])
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
      modelTextureVariant?: WorldSceneResourceItem['modelTextureVariant']
      modelCandidates?: WorldSceneResourceItem['modelCandidates']
      materialModel?: WorldSceneResourceItem['materialModel']
    }
  >()
  const cliffPieceObjectIds = new Map<string, string[]>()
  for (const item of cliffPieceObjects)
    cliffPieceObjectIds.set(item.typeId!, [
      ...(cliffPieceObjectIds.get(item.typeId!) ?? []),
      item.id,
    ])
  for (const [modelId, objectIds] of cliffPieceObjectIds) {
    const model = cliffPieceModels.get(modelId)!
    resourceJoins.set(cliffModelResourceId(modelId), {
      resolved: true,
      objectIds,
      modelResource: model.candidates[0]!.requirement,
      modelCandidates: model.candidates,
      ...(model.materialModel === undefined ? {} : { materialModel: model.materialModel }),
    })
  }
  for (const item of objects) {
    if (item.facet !== 'objects') continue
    if (item.catalog !== undefined) {
      const key = objectResourceId(item.catalog.ref, item.modelResource)
      const current = resourceJoins.get(key) ?? {
        namespace: item.catalog.ref.namespace,
        entityId: item.catalog.ref.entityId,
        resolved: item.catalog.entity !== undefined,
        objectIds: [],
        ...(item.modelResource === undefined ? {} : { modelResource: item.modelResource }),
        ...(item.modelTextureVariant === undefined
          ? {}
          : { modelTextureVariant: item.modelTextureVariant }),
      }
      current.resolved ||= item.catalog.entity !== undefined
      if (current.modelResource === undefined && item.modelResource !== undefined) {
        current.modelResource = item.modelResource
        if (item.modelTextureVariant !== undefined)
          current.modelTextureVariant = item.modelTextureVariant
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
          ...(item.modelTextureVariant === undefined
            ? {}
            : { modelTextureVariant: item.modelTextureVariant }),
          ...(item.modelCandidates === undefined ? {} : { modelCandidates: item.modelCandidates }),
          ...(item.materialModel === undefined ? {} : { materialModel: item.materialModel }),
          objectIds: Object.freeze([...item.objectIds]),
        }),
      ),
  )
  const navigationAdmission = admittedNavigationGrid(snapshot.navigation, uvwTransform)
  const navigation: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.navigation?.samples ?? []).map((item, index) =>
      Object.freeze({
        facet: 'navigation' as const,
        id: `${navigationLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: navigationLayerId,
        coordinateSpaceId: 'navigation-grid',
        lod: navigationAdmission.grid === undefined ? 'sampled' as const : 'exact' as const,
        ...(navigationAdmission.positions?.[index] === undefined ? {} : { uvwPosition: navigationAdmission.positions[index] }),
        x: item.x, y: item.y, flags: item.flags,
      }),
    ),
  )
  const rasterIds = new Set<string>()
  const rasterRecords = (snapshot.gameRasters ?? []).map(published => {
    if (!/^[a-z][a-z0-9-]*$/u.test(published.descriptor.id) || rasterIds.has(published.descriptor.id))
      throw new TypeError('game raster ids must be unique local ids')
    rasterIds.add(published.descriptor.id)
    const admission = admittedGameRaster(published, uvwTransform)
    return { id: `world.game-raster:${published.descriptor.id}`, published, admission,
      contentRevision: layerContentRevision(admission.values ?? [], JSON.stringify({ metadata: admission.metadata, grid: admission.grid })) }
  })
  const surfaceIds = new Set<string>()
  const surfaceRecords = (snapshot.querySurfaces ?? []).map(published => {
    if (!/^[a-z][a-z0-9-]*$/u.test(published.id) || published.id === 'terrain' || surfaceIds.has(published.id))
      throw new TypeError('query surface ids must be unique local ids distinct from terrain')
    surfaceIds.add(published.id)
    const admission = admittedQuerySurface(published, uvwTransform)
    return { id: `world.surfaces:${published.id}`, published, admission,
      contentRevision: layerContentRevision(admission.values ?? [], JSON.stringify(admission.grid)) }
  })
  const querySurfaces = new Map(surfaceRecords.map(record => [record.published.id, record.admission]))
  const traversalClasses = new Set<string>()
  const traversalRecords = (snapshot.traversals ?? []).map(published => {
    if (!/^[a-z][a-z0-9-]*$/u.test(published.classId) || traversalClasses.has(published.classId))
      throw new TypeError('native traversal classes must have unique local ids')
    traversalClasses.add(published.classId)
    const id = `${layerId('traversal')}:${published.classId}`
    const admission = admittedTraversalGrid(published, uvwTransform, snapshot.worldCandidate.topology, querySurfaces)
    const items: readonly WorldSceneTraversalItem[] = Object.freeze((admission.values ?? []).map(cell => Object.freeze({
      facet: 'traversal' as const, id: `${id}:${cell.x}:${cell.y}`, layerId: id,
      coordinateSpaceId: 'uvw-canonical', lod: 'exact' as const, ...cell })))
    const metadata = Object.freeze({ classId: published.classId, ...(published.surfaceLayerId === undefined ? {} : { surfaceLayerId: published.surfaceLayerId }) })
    return Object.freeze({ id, localLayerId: `traversal-${published.classId}`, published, admission, items, metadata,
      contentRevision: layerContentRevision(items, JSON.stringify({ metadata, grid: admission.grid })) })
  })
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
            ...(snapshot.lighting.model === undefined ? {} : { model: snapshot.lighting.model }),
            ...(snapshot.lighting.unlitColor === undefined
              ? {}
              : { unlitColor: snapshot.lighting.unlitColor }),
            ambientColor: snapshot.lighting.ambientColor,
            ambientIntensity: snapshot.lighting.ambientIntensity,
            directional: snapshot.lighting.directional,
            ...(snapshot.lighting.objects === undefined
              ? {}
              : { objects: snapshot.lighting.objects }),
            ...(snapshot.lighting.terrain === undefined
              ? {}
              : { terrain: snapshot.lighting.terrain }),
            ...(snapshot.lighting.toneMapping === undefined
              ? {}
              : { toneMapping: snapshot.lighting.toneMapping }),
            ...(snapshot.lighting.shadowRange === undefined
              ? {}
              : { shadowRange: snapshot.lighting.shadowRange }),
            ...(snapshot.lighting.fog === undefined ? {} : { fog: snapshot.lighting.fog }),
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
    cliffs: layerContentRevision(cliffs, snapshot.cliffs?.grid === undefined ? undefined : JSON.stringify(cliffAdmission.grid)),
    objects: layerContentRevision(objects),
    regions: layerContentRevision(regions),
    resources: layerContentRevision(resources),
    navigation: layerContentRevision(navigation, snapshot.navigation?.flagEncoding),
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
        ...(raster.derivation === undefined ? {} : { derivation: raster.derivation }),
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
      itemCount: (semantic.terrain?.cellCount ?? 0) - noGroundSamples,
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
                cliffAdmission.reason ?? 'publisher cliff grid is sampled or does not match the admitted UVW heightfield grid',
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
        : duplicateObjectCount > 0 ||
            incompleteObjectPositionCount > 0 ||
            uvwTransform === undefined
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
                // a viewer then places them by their native axes as (x, z, y)
                ...(uvwTransform === undefined
                  ? [
                      `objects have no canonical UVW placement: ${uvwTransformRefusal === undefined ? 'no map-native to UVW transform is published' : `the UVW transform was refused (${uvwTransformRefusal})`}`,
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
      state: snapshot.navigation === undefined ? ('unavailable' as const) : navigationAdmission.grid === undefined ? ('partial' as const) : ('available' as const),
      itemCount: snapshot.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot.navigation === undefined ? [] : navigationAdmission.grid === undefined ? ['summary', 'sampled'] : ['summary', 'sampled', 'exact']),
      contentRevision: contentRevisions.navigation,
      ...(snapshot.navigation === undefined
        ? { reason: 'publisher reported navigation unavailable' }
        : navigationAdmission.grid === undefined ? { reason: navigationAdmission.reason ?? 'native flags are sampled and their bit semantics remain publisher-defined' } : {}),
    }),
    ...rasterRecords.map(record => Object.freeze({ facet: 'game-raster' as const, layerId: record.id,
      state: record.admission.grid === undefined ? 'partial' as const : 'available' as const,
      itemCount: record.published.descriptor.width * record.published.descriptor.height,
      lods: Object.freeze(record.admission.grid === undefined ? [] : ['exact']), contentRevision: record.contentRevision,
      ...(record.admission.grid === undefined ? { reason: record.admission.reason ?? 'game raster is not admitted' } : {}) })),
    ...surfaceRecords.map(record => Object.freeze({ facet: 'surfaces' as const, layerId: record.id,
      state: record.admission.grid === undefined ? 'partial' as const : 'available' as const,
      itemCount: record.admission.values?.length ?? record.published.cellCount,
      lods: Object.freeze(record.admission.grid === undefined ? [] : ['exact']), contentRevision: record.contentRevision,
      ...(record.admission.grid === undefined ? { reason: record.admission.reason ?? 'query surface is not admitted' } : {}) })),
    ...traversalRecords.map(record => Object.freeze({ facet: 'traversal' as const, layerId: record.id,
      state: record.admission.grid === undefined ? 'partial' as const : 'available' as const,
      itemCount: record.published.cellCount, lods: Object.freeze(record.admission.grid === undefined ? [] : ['exact']),
      contentRevision: record.contentRevision,
      ...(record.admission.grid === undefined ? { reason: record.admission.reason ?? 'publisher traversal is not admitted' } : {}) })),
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
          ...(item.facet === 'terrain' && snapshot.latticeCoverage?.ramps !== undefined && uvwTransform !== undefined
            ? {latticeRamps:(() => {
              const {coordinateSpaceId,...value}=snapshot.latticeCoverage!.ramps!
              if(coordinateSpaceId!=='map-native')throw new TypeError('Unsupported ramp coordinate space')
              const ramps=validateLatticeRamps(value)
              return validateLatticeRamps({...ramps,polygons:ramps.polygons.map(polygon=>polygon.map(([x,y])=>{
                const p=canonicalPosition({x,y,z:0},uvwTransform);return [p.x,p.z]
              }))})
            })()} : {}),
        ...(item.facet === 'terrain' && snapshot.latticeCoverage?.overview !== undefined && uvwTransform !== undefined
          ? { latticeOverview: projectLatticeOverview(
              (() => {
                const {coordinateSpaceId,...overview}=snapshot.latticeCoverage.overview
                if (coordinateSpaceId !== 'map-native') throw new TypeError('Unsupported overview coordinate space')
                return overview
              })(),
              ([x,y]) => { const point=canonicalPosition({x,y,z:0},uvwTransform);return [point.x,point.z] },
            ) } : {}),
        ...(item.facet === 'game-raster' ? (() => {
          const record = rasterRecords.find(record => record.id === item.layerId)!
          return { localLayerId: record.published.descriptor.id, label: record.published.descriptor.label,
            ...(record.admission.metadata === undefined ? {} : { gameRaster: record.admission.metadata }),
            ...(record.admission.grid === undefined ? {} : { grid: record.admission.grid }) }
        })() : {}),
        ...(item.facet === 'surfaces' ? (() => {
          const record = surfaceRecords.find(record => record.id === item.layerId)!
          return { localLayerId: record.published.id, heightfieldRole: 'query' as const,
            ...(record.admission.grid === undefined ? {} : { grid: record.admission.grid }) }
        })() : {}),
        ...(item.facet === 'traversal' ? (() => {
          const record = traversalRecords.find(record => record.id === item.layerId)!
          return { localLayerId: record.localLayerId, traversal: record.metadata,
            ...(record.admission.grid === undefined ? {} : { grid: record.admission.grid }) }
        })() : {}),
        ...(item.facet === 'cliffs' && cliffAdmission.grid !== undefined ? { grid: cliffAdmission.grid } : {}),
        ...(item.facet === 'navigation' ? {
          ...(navigationAdmission.grid === undefined ? {} : { grid: navigationAdmission.grid }),
          ...(snapshot.navigation?.flagEncoding === undefined ? {} : { navigationFlagEncoding: snapshot.navigation.flagEncoding }),
        } : {}),
        state: item.state,
        itemCount: item.itemCount,
        lods: item.lods,
        ...(item.contentRevision === undefined ? {} : { contentRevision: item.contentRevision }),
        ...(uvwTransform !== undefined &&
        (item.facet === 'terrain' ||
          item.facet === 'terrain-materials' ||
          (item.facet === 'cliffs' && snapshot.cliffs?.grid === undefined)) &&
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
                ...(item.facet === 'terrain' && terrainNoDataValue !== undefined
                  ? { noDataValue: terrainNoDataValue }
                  : {}),
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
    ...(rasterRecords.length === 0 ? [] : [['game-raster', Object.freeze(rasterRecords.flatMap(record => record.admission.values ?? []))] as const]),
    ...(surfaceRecords.length === 0 ? [] : [['surfaces', Object.freeze(surfaceRecords.flatMap(record => record.admission.values ?? []))] as const]),
    ...(traversalRecords.length === 0 ? [] : [['traversal', Object.freeze(traversalRecords.flatMap(record => record.items))] as const]),
    ['gateways', gateways],
    ['lighting', lighting],
  ])
  const info: CandidateWorldSceneInfo = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    ...(snapshot.worldCandidate.topology === undefined ? {} : { topology: snapshot.worldCandidate.topology }),
    major: snapshot.worldCandidate.major,
    maturity: snapshot.worldCandidate.maturity,
    snapshotId: snapshot.snapshotId,
    mapId: snapshot.mapId,
    gameId: snapshot.gameId,
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
    ...(uvwTransformRefusal === undefined ? {} : { uvwTransformRefusal }),
    ...(semantic.players === undefined
      ? {}
      : { players: Object.freeze(semantic.players.map(player => Object.freeze({ ...player }))) }),
    ...(worldCamera(snapshot.camera) === undefined
      ? {}
      : { camera: worldCamera(snapshot.camera)! }),
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
    ...(snapshot.worldCandidate.topology === undefined ? {} : { topology: snapshot.worldCandidate.topology }),
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
      const facetItems = byFacet.get(request.facet)
      const items = (['traversal','surfaces','game-raster'].includes(request.facet)) ? facetItems?.filter(item => item.layerId === request.layerId) : facetItems
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
      const facetState = facets.find(item => item.facet === request.facet && (!['traversal', 'surfaces', 'game-raster'].includes(request.facet) || item.layerId === request.layerId))
      if (request.facet !== 'layers') {
        if (request.layerId !== facetState?.layerId) {
          throw new TypeError(`world facet ${request.facet} requires its exact layerId`)
        }
        if ((['traversal','surfaces','game-raster'].includes(request.facet)) && (facetState?.state !== 'available' || request.lod !== 'exact'))
          return Object.freeze({ snapshotId: snapshot.snapshotId, facet: request.facet, state: 'unsupported' as const,
            items: Object.freeze([]), reason: facetState?.reason ?? 'traversal only pages admitted exact cells' })
        const expectedLod =
          request.facet === 'terrain'
            ? terrainLod
            : request.facet === 'terrain-materials'
              ? terrainMaterialLod
              : request.facet === 'cliffs'
                ? cliffLod
                : request.facet === 'navigation'
                  ? navigationAdmission.grid === undefined ? 'sampled' : 'exact'
                  : undefined
        if (expectedLod !== undefined && request.lod !== expectedLod &&
          !(request.facet === 'navigation' && navigationAdmission.grid !== undefined && request.lod === 'sampled')) {
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
              const canonical = item.facet === 'traversal' || item.facet === 'surfaces' || item.facet === 'game-raster' || (item.facet === 'cliffs' && snapshot.cliffs?.grid !== undefined)
                ? item.uvwPosition : undefined
              if (canonical !== undefined) {
                return canonical.x >= bounds.minimumX && canonical.x <= bounds.maximumX &&
                  canonical.z >= bounds.minimumY && canonical.z <= bounds.maximumY
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
      const page = pageItems(bounded, request, snapshot.snapshotId, maxPageSize)
      return Promise.resolve(request.facet === 'navigation' && navigationAdmission.grid !== undefined && request.lod === 'sampled'
        ? Object.freeze({ ...page, items: Object.freeze(page.items.map(item => item.facet === 'navigation' ? Object.freeze({ ...item, lod: 'sampled' as const }) : item)) })
        : page)
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
            const { maxNodes } = worldSceneModelLimits(request, maxPageSize)
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
            const metersPerSourceUnit =
              request.metersPerSourceUnit ?? snapshot.semantic.modelMetersPerSourceUnit
            const candidates = item.modelCandidates ?? [
              Object.freeze({ requirement: item.modelResource, yaw: 0 }),
            ]
            let lease: Awaited<ReturnType<typeof modelResources.acquire>> | undefined
            let chosen = candidates[0]!
            for (const candidate of candidates) {
              const attempt = await modelResources.acquire(
                {
                  maxBytes: request.maxBytes,
                  ...(metersPerSourceUnit === undefined ? {} : { metersPerSourceUnit }),
                  requirement: candidate.requirement,
                },
                signal,
              )
              chosen = candidate
              lease = attempt
              if (attempt.value.result.state !== 'unresolved' || candidate === candidates.at(-1))
                break
              await attempt.release()
            }
            const modelRequirement = chosen.requirement
            if (lease === undefined) throw new TypeError('world model candidates are empty')
            // A separately authored skin replaces the materials by index (one per lease).
            const materialModel = item.materialModel
            const skinItemsOf = async (
              model: LogicalResourceRequirement,
            ): Promise<readonly ModelMaterialRef[] | undefined> => {
              let pendingSkin = materialModelCache.get(model.logicalId)
              if (pendingSkin === undefined) {
                pendingSkin = (async () => {
                  const skinned = await modelResources.acquire(
                    {
                      maxBytes: request.maxBytes,
                      ...(metersPerSourceUnit === undefined ? {} : { metersPerSourceUnit }),
                      requirement: model,
                    },
                    signal,
                  )
                  try {
                    if (skinned.value.result.state === 'unresolved') return undefined
                    const read = skinned.value.materials
                    return read === undefined
                      ? undefined
                      : (
                          await readAllPages(
                            page => read.call(skinned.value, page, signal),
                            maxNodes,
                            MODEL_FACET_ITEM_CAP,
                          )
                        ).items
                  } finally {
                    await skinned.release()
                  }
                })()
                materialModelCache.set(model.logicalId, pendingSkin)
              }
              return pendingSkin
            }
            try {
              return await worldSceneModel(
                lease.value,
                request,
                {
                  requirement: modelRequirement,
                  yaw: chosen.yaw,
                  maxPageSize,
                  textureCache: modelTextureCache,
                  ...(item.modelTextureVariant === undefined
                    ? {}
                    : { textureVariant: item.modelTextureVariant }),
                  ...(materialModel === undefined
                    ? {}
                    : {
                        async skin(materials: readonly ModelMaterialRef[]) {
                          const skinItems = await skinItemsOf(materialModel)
                          if (skinItems === undefined || skinItems.length === 0)
                            return Object.freeze({
                              diagnostics: Object.freeze([
                                diagnostic(
                                  'warning',
                                  'x3.host/world-model-material-model-unavailable',
                                  `material model ${materialModel.logicalId} published no materials; ${modelRequirement.logicalId} keeps its own`,
                                ),
                              ]),
                            })
                          return Object.freeze({
                            materials: materials.map((material, index) => {
                              const replacement = skinItems[Math.min(index, skinItems.length - 1)]!
                              return Object.freeze({ ...replacement, id: material.id })
                            }),
                            diagnostics: Object.freeze([]),
                          })
                        },
                      }),
                },
                signal,
              )
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
                ...(candidate.normalResourceId === requestedResourceId &&
                candidate.normalResource !== undefined
                  ? [candidate.normalResource]
                  : []),
                ...(candidate.causticsFrameResourceIds ?? []).flatMap((resourceId, index) => {
                  const frame = candidate.causticsFrameResources?.[index]
                  return resourceId === requestedResourceId && frame !== undefined ? [frame] : []
                }),
                ...[
                  ...(candidate.detailWaves?.normalResourceIds ?? []).map(
                    (resourceId, index) =>
                      [resourceId, candidate.detailWaves?.normalResources[index]] as const,
                  ),
                  ...(candidate.detailWaves?.foamResourceIds ?? []).map(
                    (resourceId, index) =>
                      [resourceId, candidate.detailWaves?.foamResources?.[index]] as const,
                  ),
                ].flatMap(([resourceId, resource]) =>
                  resourceId === requestedResourceId && resource !== undefined ? [resource] : [],
                ),
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
                // a texture bigger than the budget comes at the largest level that fits, not refused
                selection: { face: 'all', mipLevel: 'fit' },
                ...(request.compressedFormats === undefined
                  ? {}
                  : { compressedFormats: request.compressedFormats }),
              },
              signal,
            )
            if (raster.state !== 'decoded' && raster.state !== 'decoded-surfaces' && raster.state !== 'compressed') {
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
