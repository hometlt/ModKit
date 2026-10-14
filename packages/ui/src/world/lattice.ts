/** Format-neutral, read-only 2D lattice for published WorldScene facets (SDK maps contract).
 * Draws height, authored contours/ramps, explicit cliff faces and multi-channel object coverage.
 * The opt-in overview profile outlines published cliff coverage and fills known object outlines.
 * Uses no model/texture ports and never infers gameplay masks or native export capability.
 */
import type {
  MapLatticeObjectCoverage,
  MapObjectKind,
  WorldSceneItem,
  WorldSceneTerrainItem,
} from '@modkit/sdk/maps'

type Point = readonly [number, number]
type Quad<Value> = readonly [Value, Value, Value, Value]
interface LatticeVertex {
  readonly point: Point
  readonly height: number
  readonly level?: number
  /** The publisher marked this sample as ramp ground: no cliff line crosses it. */
  readonly ramp?: boolean
}
export interface WorldLatticePlan {
  /** Omission retains the original lattice presentation. No gameplay semantics change. */
  readonly style?: 'overview'
  readonly cells: readonly {
    readonly vertices: Quad<LatticeVertex>
    readonly colors: Quad<string>
  }[]
  readonly contours: readonly (readonly [Point, Point])[]
  /** Cells touching a ramp sample: the ramp's shape, drawn over the height colours. */
  readonly ramps: readonly Quad<Point>[]
  /** Explicit publisher cliff-face cells, independent of level contours and ramps. */
  readonly cliffFaces: readonly Quad<Point>[]
  /** Layer-local exposed edges of published cliff quads, not inferred native cliff lines. */
  readonly cliffBoundaries?: readonly (readonly [Point, Point])[]
  readonly objects: readonly {
    readonly point: Point
    readonly objectId: number
    readonly kind: MapObjectKind
    readonly roles?: MapLatticeObjectCoverage['roles']
    readonly resourceKind?: string
    readonly coverage?: Readonly<
      Partial<
        Record<
          'blocked' | 'noBuild' | 'vision' | 'nearResources' | 'outline',
          readonly (readonly Point[])[]
        >
      >
    >
  }[]
  readonly bounds: readonly [number, number, number, number]
  /** Terrain of one height (a 2D game's map): its cells all draw the same colour. */
  readonly flat: boolean
}

/** Ramp cells: translucent over the height colours, so the slope still reads. */
export const WORLD_RAMP_COLOR = 'rgba(240, 200, 120, 0.55)'
export const WORLD_CLIFF_FACE_COLOR = 'rgba(91, 65, 47, 0.65)'
export const WORLD_LATTICE_ROLE_COLORS = Object.freeze({
  resource: '#35d1d0',
  destructible: '#ef6c5b',
  start: '#f6df61',
})

/** One colour per placed-object kind, shared by the lattice, its legend and the isometric fallback. */
export const WORLD_OBJECT_KIND_COLORS: Readonly<Record<MapObjectKind, string>> = Object.freeze({
  unit: '#56b4e9',
  structure: '#e69f00',
  feature: '#7fc97f',
  doodad: '#cc79a7',
  point: '#f0e442',
  camera: '#d55e00',
})

/** Low ground is darker; submerged terrain is blue. Colors do not depend on texture readiness. */
export function worldLatticeColor(
  height: number,
  minimum: number,
  maximum: number,
  submerged = false,
): string {
  const value = Math.max(0, Math.min(1, (height - minimum) / Math.max(1e-6, maximum - minimum)))
  return submerged ? `hsl(207 48% ${18 + value * 22}%)` : `hsl(90 23% ${25 + value * 48}%)`
}

/** A continuous brown height palette; only published water coverage produces blue ground. */
function overviewColor(
  height: number,
  minimum: number,
  maximum: number,
  submerged: boolean,
): string {
  if (submerged) return worldLatticeColor(height, minimum, maximum, true)
  const value = Math.max(0, Math.min(1, (height - minimum) / Math.max(1e-6, maximum - minimum)))
  return `hsl(${28 + value * 8} 48% ${18 + value * 60}%)`
}

/** Cancel layer-local shared edges; retain holes and ignore repeated published cells. */
function recordCliffBoundary(
  layerId: string,
  x: number,
  y: number,
  quad: Quad<LatticeVertex>,
  edges: Map<string, readonly [Point, Point]>,
  cells: Set<string>,
): void {
  const cell = JSON.stringify([layerId, x, y])
  if (cells.has(cell)) return
  cells.add(cell)
  const corners = [`${x},${y}`, `${x + 1},${y}`, `${x + 1},${y + 1}`, `${x},${y + 1}`] as const
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ] as const) {
    const first = corners[a],
      second = corners[b]
    const key = JSON.stringify([layerId, ...(first < second ? [first, second] : [second, first])])
    if (edges.has(key)) edges.delete(key)
    else edges.set(key, [quad[a].point, quad[b].point])
  }
}

/** Build one neutral plan; the overview profile changes presentation of published facts only. */
export function createWorldLatticePlan(
  items: readonly WorldSceneItem[],
  selectedSpaceId?: string,
  style: 'lattice' | 'overview' = 'lattice',
): WorldLatticePlan {
  if (style !== 'lattice' && style !== 'overview')
    throw new TypeError('Unknown world lattice style')
  const layerSpaces = new Map(
    items.flatMap(item =>
      item.facet === 'layers' && item.spaceId !== undefined
        ? [[item.layerId, item.spaceId] as const]
        : [],
    ),
  )
  const firstTerrain = items.find((item): item is WorldSceneTerrainItem => item.facet === 'terrain')
  const spaceId =
    selectedSpaceId ??
    (firstTerrain === undefined ? undefined : layerSpaces.get(firstTerrain.layerId))
  const compatible = (item: WorldSceneItem) =>
    spaceId === undefined || layerSpaces.get(item.layerId) === spaceId
  const terrain = items.filter(
    (item): item is WorldSceneTerrainItem => item.facet === 'terrain' && compatible(item),
  )
  const placedObjects = items.filter(
    (item): item is Extract<WorldSceneItem, { facet: 'objects' }> =>
      item.facet === 'objects' && item.derivedFrom !== 'cliffs' && compatible(item),
  )
  const canonical =
    terrain.length > 0
      ? terrain.every(item => item.uvwPosition !== undefined)
      : placedObjects.length > 0 && placedObjects.every(item => item.uvwPosition !== undefined)
  const native =
    !canonical &&
    (terrain.length > 0
      ? terrain.every(item => item.mapNativePosition !== undefined)
      : placedObjects.length > 0 &&
        placedObjects.every(item => item.coordinateSpaceId === 'map-native'))
  const cliffs = new Map(
    items.flatMap(item =>
      item.facet === 'cliffs' && compatible(item) ? [[`${item.x}:${item.y}`, item] as const] : [],
    ),
  )
  const vertices = new Map<string, LatticeVertex>()
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  let minimumHeight = Infinity,
    maximumHeight = -Infinity
  const include = (point: Point) => {
    if (!point.every(Number.isFinite))
      throw new TypeError('world lattice contains a non-finite position')
    minX = Math.min(minX, point[0])
    maxX = Math.max(maxX, point[0])
    minY = Math.min(minY, point[1])
    maxY = Math.max(maxY, point[1])
  }
  for (const item of terrain) {
    const position = canonical ? item.uvwPosition : native ? item.mapNativePosition : undefined
    const point: Point =
      position === undefined
        ? [item.x, item.y]
        : canonical
          ? [position.x, position.z]
          : [position.x, -position.y]
    const height =
      position === undefined
        ? item.heightBase + item.heightAdjustment
        : canonical
          ? position.y
          : position.z
    if (!Number.isFinite(height)) throw new TypeError('world lattice contains a non-finite height')
    include(point)
    minimumHeight = Math.min(minimumHeight, height)
    maximumHeight = Math.max(maximumHeight, height)
    const cliff = cliffs.get(`${item.x}:${item.y}`)
    vertices.set(`${item.layerId}:${item.x}:${item.y}`, {
      point,
      height,
      ...(cliff === undefined ? {} : { level: cliff.level }),
      ...(cliff?.ramp === true ? { ramp: true } : {}),
    })
  }
  const water = items.filter(
    (item): item is Extract<WorldSceneItem, { facet: 'water' }> =>
      item.facet === 'water' && compatible(item),
  )
  const submerged = (vertex: LatticeVertex): boolean =>
    water.some(zone => {
      const a = canonical ? zone.uvwMinimum : zone.minimum
      const b = canonical ? zone.uvwMaximum : zone.maximum
      const height = canonical ? zone.uvwElevation : zone.elevation
      if (a === undefined || b === undefined || height === undefined) return false
      const y1 = 'z' in a ? a.z : native ? -a.y : a.y
      const y2 = 'z' in b ? b.z : native ? -b.y : b.y
      return (
        vertex.height < height &&
        vertex.point[0] >= Math.min(a.x, b.x) &&
        vertex.point[0] <= Math.max(a.x, b.x) &&
        vertex.point[1] >= Math.min(y1, y2) &&
        vertex.point[1] <= Math.max(y1, y2)
      )
    })
  const cells: WorldLatticePlan['cells'][number][] = []
  const contours: (readonly [Point, Point])[] = []
  const ramps: Quad<Point>[] = []
  const cliffFaces: Quad<Point>[] = []
  const cliffEdges = style === 'overview' ? new Map<string, readonly [Point, Point]>() : undefined
  const cliffCells = style === 'overview' ? new Set<string>() : undefined
  for (const item of terrain) {
    const at = (dx: number, dy: number) =>
      vertices.get(`${item.layerId}:${item.x + dx}:${item.y + dy}`)
    const a = at(0, 0),
      b = at(1, 0),
      c = at(1, 1),
      d = at(0, 1)
    if (a === undefined || b === undefined || c === undefined || d === undefined) continue
    const quad: Quad<LatticeVertex> = [a, b, c, d]
    cells.push({
      vertices: quad,
      colors: quad.map(vertex =>
        (style === 'overview' ? overviewColor : worldLatticeColor)(
          vertex.height,
          minimumHeight,
          maximumHeight,
          submerged(vertex),
        ),
      ) as unknown as Quad<string>,
    })
    if (item.cliffFace === true) {
      cliffFaces.push(quad.map(vertex => vertex.point) as unknown as Quad<Point>)
      if (cliffEdges !== undefined && cliffCells !== undefined)
        recordCliffBoundary(item.layerId, item.x, item.y, quad, cliffEdges, cliffCells)
    }
    if (quad.some(vertex => vertex.ramp === true)) {
      // Ramp ground rises between the levels without a cliff: its cells carry no cliff line.
      ramps.push(quad.map(vertex => vertex.point) as unknown as Quad<Point>)
      continue
    }
    if (quad.some(vertex => vertex.level === undefined)) continue
    // A contour joins the midpoints of edges crossing a cliff level. Diagonals stay diagonal.
    const levels = [
      ...new Set(quad.flatMap(vertex => (vertex.level === undefined ? [] : [vertex.level]))),
    ]
      .sort((a, b) => a - b)
      .slice(1)
    for (const level of levels) {
      const crossings: Point[] = []
      for (const [a, b] of [
        [quad[0], quad[1]],
        [quad[1], quad[2]],
        [quad[2], quad[3]],
        [quad[3], quad[0]],
      ] as const) {
        if ((a.level ?? 0) >= level === (b.level ?? 0) >= level) continue
        crossings.push([(a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2])
      }
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const start = crossings[index],
          end = crossings[index + 1]
        if (start !== undefined && end !== undefined) contours.push([start, end])
      }
    }
  }
  const objects = items.flatMap(item => {
    if (item.facet !== 'objects' || item.derivedFrom === 'cliffs' || !compatible(item)) return []
    // Do not mix grid coordinates with an untransformed map-native placement.
    const uvw = item.uvwPosition
    if (canonical && uvw === undefined) return []
    if (terrain.length === 0 && !canonical && !native) return []
    if (!canonical && !native && terrain.length > 0 && item.coordinateSpaceId !== 'height-grid')
      return []
    const point: Point =
      canonical && uvw !== undefined
        ? [uvw.x, uvw.z]
        : [item.position.x, native || terrain.length === 0 ? -item.position.y : item.position.y]
    include(point)
    const published = canonical
      ? item.uvwLatticeCoverage
      : item.latticeCoverage?.coordinateSpaceId ===
          (native || terrain.length === 0 ? 'map-native' : 'height-grid')
        ? item.latticeCoverage
        : undefined
    const coverage =
      published === undefined
        ? undefined
        : (Object.fromEntries(
            (['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const).flatMap(
              channel =>
                published[channel] === undefined
                  ? []
                  : [
                      [
                        channel,
                        published[channel].map(polygon =>
                          polygon.map(vertex => {
                            const point: Point = [
                              vertex.x,
                              canonical || (!native && terrain.length > 0) ? vertex.y : -vertex.y,
                            ]
                            include(point)
                            return point
                          }),
                        ),
                      ],
                    ],
            ),
          ) as WorldLatticePlan['objects'][number]['coverage'])
    return [
      {
        point,
        objectId: item.objectId,
        kind: item.kind,
        ...(item.latticeCoverage?.roles === undefined ? {} : { roles: item.latticeCoverage.roles }),
        ...(item.latticeCoverage?.resourceKind === undefined
          ? {}
          : { resourceKind: item.latticeCoverage.resourceKind }),
        ...(coverage === undefined ? {} : { coverage }),
      },
    ]
  })
  return {
    cells,
    contours,
    ramps,
    cliffFaces,
    objects,
    bounds: Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 1, 1],
    flat: cells.length > 0 && minimumHeight === maximumHeight,
    ...(style === 'overview' ? { style, cliffBoundaries: [...cliffEdges!.values()] } : {}),
  }
}

/** The lattice's world-to-canvas mapping: the plan's bounds fitted into the canvas with a margin. */
function latticeScreen(
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  plan: WorldLatticePlan,
): (point: Point) => Point {
  const [minX, minY, maxX, maxY] = plan.bounds
  const scale = Math.min(
    (canvas.width - 32) / Math.max(1, maxX - minX),
    (canvas.height - 32) / Math.max(1, maxY - minY),
  )
  const offsetX = (canvas.width - (maxX - minX) * scale) / 2
  const offsetY = (canvas.height - (maxY - minY) * scale) / 2
  return point => [offsetX + (point[0] - minX) * scale, offsetY + (point[1] - minY) * scale]
}

/** The object drawn nearest to a canvas pixel, within `radius` pixels. */
export function worldLatticeObjectAt(
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  plan: WorldLatticePlan,
  x: number,
  y: number,
  radius = 6,
): number | undefined {
  const screen = latticeScreen(canvas, plan)
  let best: number | undefined
  let bestDistance = radius * radius
  for (const object of plan.objects) {
    const [sx, sy] = screen(object.point)
    const distance = (sx - x) ** 2 + (sy - y) ** 2
    if (distance <= bestDistance) {
      bestDistance = distance
      best = object.objectId
    }
  }
  return best
}

/** Draw either presentation with the same coordinates, published facets and selection behavior. */
export function drawWorldLattice(
  canvas: HTMLCanvasElement,
  plan: WorldLatticePlan,
  selectedObjectId?: number,
  kindLabels?: Readonly<
    Partial<
      Record<
        | MapObjectKind
        | 'ramp'
        | 'cliffFace'
        | 'resource'
        | 'destructible'
        | 'start'
        | 'blocked'
        | 'noBuild'
        | 'vision'
        | 'nearResources'
        | 'outline',
        string
      >
    >
  >,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2D lattice canvas is unavailable')
  const screen = latticeScreen(canvas, plan)
  const overview = plan.style === 'overview'
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (overview) {
    context.fillStyle = '#0f172a'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.lineWidth = 0.35
  context.strokeStyle = overview ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 25, 25, 0.18)'
  for (const cell of plan.cells) {
    const points = cell.vertices.map(vertex => screen(vertex.point)) as unknown as Quad<Point>
    let low: 0 | 1 | 2 | 3 = 0,
      high: 0 | 1 | 2 | 3 = 0
    for (const index of [1, 2, 3] as const) {
      if (cell.vertices[index].height < cell.vertices[low].height) low = index
      if (cell.vertices[index].height > cell.vertices[high].height) high = index
    }
    if (low === high) context.fillStyle = cell.colors[0]
    else {
      const gradient = context.createLinearGradient(...points[low], ...points[high])
      gradient.addColorStop(0, cell.colors[low])
      gradient.addColorStop(1, cell.colors[high])
      context.fillStyle = gradient
    }
    context.beginPath()
    context.moveTo(...points[0])
    for (const point of points.slice(1)) context.lineTo(...point)
    context.closePath()
    context.fill()
    context.stroke()
  }
  context.fillStyle = WORLD_CLIFF_FACE_COLOR
  for (const face of plan.cliffFaces) {
    context.beginPath()
    context.moveTo(...screen(face[0]))
    for (const point of face.slice(1)) context.lineTo(...screen(point))
    context.closePath()
    context.fill()
  }
  context.fillStyle = WORLD_RAMP_COLOR
  for (const ramp of plan.ramps) {
    context.beginPath()
    context.moveTo(...screen(ramp[0]))
    for (const point of ramp.slice(1)) context.lineTo(...screen(point))
    context.closePath()
    context.fill()
  }
  context.lineWidth = 1.4
  if (overview && (plan.cliffBoundaries?.length ?? 0) > 0) {
    context.strokeStyle = '#fff'
    context.beginPath()
    for (const [a, b] of plan.cliffBoundaries!) {
      context.moveTo(...screen(a))
      context.lineTo(...screen(b))
    }
    context.stroke()
  }
  context.strokeStyle = '#d8dec4'
  context.beginPath()
  for (const [a, b] of plan.contours) {
    context.moveTo(...screen(a))
    context.lineTo(...screen(b))
  }
  context.stroke()
  const channelColors = {
    blocked: '#ed583e',
    noBuild: '#f59f42',
    vision: '#af72d6',
    nearResources: '#36c9ca',
    outline: '#fafafa',
  } as const
  for (const object of plan.objects)
    for (const channel of Object.keys(channelColors) as (keyof typeof channelColors)[]) {
      const polygons = object.coverage?.[channel]
      if (polygons === undefined) continue
      context.strokeStyle = overview && channel === 'outline' ? '#141414' : channelColors[channel]
      context.lineWidth = channel === 'outline' ? 1.5 : 1
      for (const polygon of polygons) {
        if (polygon.length < 3) continue
        context.beginPath()
        context.moveTo(...screen(polygon[0]!))
        for (const point of polygon.slice(1)) context.lineTo(...screen(point))
        context.closePath()
        if (overview && channel === 'outline') {
          context.fillStyle = object.roles?.includes('resource')
            ? WORLD_LATTICE_ROLE_COLORS.resource
            : object.roles?.includes('destructible')
              ? '#fff'
              : '#b8b8b8'
          context.fill()
        }
        context.stroke()
      }
    }
  for (const object of plan.objects) {
    const selected = object.objectId === selectedObjectId
    context.fillStyle = WORLD_OBJECT_KIND_COLORS[object.kind]
    context.beginPath()
    context.arc(...screen(object.point), selected ? 4 : 2, 0, Math.PI * 2)
    context.fill()
    for (const [index, role] of (object.roles ?? []).entries()) {
      context.fillStyle = WORLD_LATTICE_ROLE_COLORS[role]
      context.beginPath()
      const [x, y] = screen(object.point)
      context.arc(x + (index - 1) * 5, y - 6, 2.5, 0, Math.PI * 2)
      context.fill()
    }
    if (object.roles?.includes('resource') && object.resourceKind !== undefined) {
      const [x, y] = screen(object.point)
      context.fillStyle = WORLD_LATTICE_ROLE_COLORS.resource
      context.font = '9px sans-serif'
      context.fillText(object.resourceKind.slice(0, 24), x + 7, y - 5)
    }
    if (selected) {
      context.lineWidth = 1.5
      context.strokeStyle = '#ffe082'
      context.stroke()
    }
  }
  // Legend: the kinds present and ramps, in the viewer's language when the caller names them.
  const kinds: (
    | MapObjectKind
    | 'ramp'
    | 'cliffFace'
    | 'resource'
    | 'destructible'
    | 'start'
    | keyof typeof channelColors
  )[] = [
    ...(Object.keys(WORLD_OBJECT_KIND_COLORS) as MapObjectKind[]).filter(kind =>
      plan.objects.some(object => object.kind === kind),
    ),
    ...(plan.ramps.length > 0 ? (['ramp'] as const) : []),
    ...(plan.cliffFaces.length > 0 ? (['cliffFace'] as const) : []),
    ...(['resource', 'destructible', 'start'] as const).filter(role =>
      plan.objects.some(object => object.roles?.includes(role)),
    ),
    ...(Object.keys(channelColors) as (keyof typeof channelColors)[]).filter(channel =>
      plan.objects.some(object => (object.coverage?.[channel]?.length ?? 0) > 0),
    ),
  ]
  if (kinds.length === 0) return
  const defaultLabels: Readonly<Partial<Record<(typeof kinds)[number], string>>> = {
    cliffFace: overview ? 'Cliff coverage boundary' : 'Cliff face',
    blocked: 'Blocked footprint',
    noBuild: 'No-build footprint',
    vision: 'Vision blocker',
    nearResources: 'Resource exclusion',
    outline: 'Object outline',
  }
  /** Preserve caller localization while keeping a readable fallback for new facets. */
  const label = (kind: (typeof kinds)[number]) => kindLabels?.[kind] ?? defaultLabels[kind] ?? kind
  context.font = '11px sans-serif'
  context.textBaseline = 'middle'
  const rowHeight = 15
  const width = Math.max(...kinds.map(kind => context.measureText(label(kind)).width)) + 22
  context.fillStyle = 'rgba(12, 14, 18, 0.72)'
  context.fillRect(6, 6, width, kinds.length * rowHeight + 6)
  kinds.forEach((kind, index) => {
    const y = 6 + 3 + index * rowHeight + rowHeight / 2
    context.fillStyle =
      kind === 'ramp'
        ? WORLD_RAMP_COLOR
        : kind === 'cliffFace'
          ? overview
            ? '#fff'
            : WORLD_CLIFF_FACE_COLOR
          : kind in WORLD_LATTICE_ROLE_COLORS
            ? WORLD_LATTICE_ROLE_COLORS[kind as keyof typeof WORLD_LATTICE_ROLE_COLORS]
            : kind in channelColors
              ? channelColors[kind as keyof typeof channelColors]
              : WORLD_OBJECT_KIND_COLORS[kind as MapObjectKind]
    context.beginPath()
    if (kind === 'ramp') context.rect(11, y - 4, 8, 8)
    else context.arc(15, y, 4, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#e8eaed'
    context.fillText(label(kind), 24, y)
  })
}
