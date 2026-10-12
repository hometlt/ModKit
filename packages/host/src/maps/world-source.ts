/** Host-owned, read-only map-world source from resolved map semantics (SDK maps contract).
 * Publishes native facts and only projects UVW positions/coverage through admitted transforms.
 * Rejects malformed lattice coverage; does not infer gameplay masks, edit maps or decode assets.
 */

import { diagnostic } from '@modkit/core'
import { mapQualificationTupleBytes } from '@modkit/sdk'
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
  MapLatticeObjectCoverage,
  MapTerrainNativeTransform,
  MapTerrainSample,
  MapPlacedObject,
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
  const semanticObjectItems: readonly WorldSceneItem[] = Object.freeze(
    semanticObjects.map(item => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`
      const ref = item.catalog?.ref
      const uvwRotation = canonicalObjectRotation(
        item.presentationRotation ?? item.rotation,
        item.nativeRotationUnit,
        item.nativeRotationSense,
      )
      const groundHeight = terrainHeightAt(item.position, semantic.terrain, terrainTransform)
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
            ...(snapshot.lighting.model === undefined ? {} : { model: snapshot.lighting.model }),
            ...(snapshot.lighting.unlitColor === undefined
              ? {}
              : { unlitColor: snapshot.lighting.unlitColor }),
            ambientColor: snapshot.lighting.ambientColor,
            ambientIntensity: snapshot.lighting.ambientIntensity,
            directional: snapshot.lighting.directional,
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
                selection: { mipLevel: 'fit' },
                ...(request.compressedFormats === undefined
                  ? {}
                  : { compressedFormats: request.compressedFormats }),
              },
              signal,
            )
            if (raster.state !== 'decoded' && raster.state !== 'compressed') {
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
