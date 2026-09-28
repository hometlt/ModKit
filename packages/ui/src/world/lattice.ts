/** Fast top-down height preview. Uses only published world facets, never model/texture ports. */
import type { MapObjectKind, WorldSceneItem, WorldSceneTerrainItem } from '@modkit/sdk/maps'

type Point = readonly [number, number]
type Quad<Value> = readonly [Value, Value, Value, Value]
interface LatticeVertex {
  readonly point: Point
  readonly height: number
  readonly level?: number
}
export interface WorldLatticePlan {
  readonly cells: readonly {
    readonly vertices: Quad<LatticeVertex>
    readonly colors: Quad<string>
  }[]
  readonly contours: readonly (readonly [Point, Point])[]
  readonly objects: readonly { readonly point: Point; readonly objectId: number; readonly kind: MapObjectKind }[]
  readonly bounds: readonly [number, number, number, number]
}

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

export function createWorldLatticePlan(items: readonly WorldSceneItem[]): WorldLatticePlan {
  const terrain = items.filter((item): item is WorldSceneTerrainItem => item.facet === 'terrain')
  const canonical = terrain.length > 0 && terrain.every(item => item.uvwPosition !== undefined)
  const native =
    !canonical && terrain.length > 0 && terrain.every(item => item.mapNativePosition !== undefined)
  const cliffs = new Map(
    items.filter(item => item.facet === 'cliffs').map(item => [`${item.x}:${item.y}`, item.level]),
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
    const level = cliffs.get(`${item.x}:${item.y}`)
    vertices.set(`${item.layerId}:${item.x}:${item.y}`, {
      point,
      height,
      ...(level === undefined ? {} : { level }),
    })
  }
  const water = items.filter(item => item.facet === 'water')
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
        worldLatticeColor(vertex.height, minimumHeight, maximumHeight, submerged(vertex)),
      ) as unknown as Quad<string>,
    })
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
    if (item.facet !== 'objects' || item.derivedFrom === 'cliffs') return []
    // Do not mix grid coordinates with an untransformed map-native placement.
    const uvw = item.uvwPosition
    if (canonical && uvw === undefined) return []
    if (!canonical && !native && terrain.length > 0 && item.coordinateSpaceId !== 'height-grid')
      return []
    const point: Point =
      canonical && uvw !== undefined
        ? [uvw.x, uvw.z]
        : [item.position.x, native || terrain.length === 0 ? -item.position.y : item.position.y]
    include(point)
    return [{ point, objectId: item.objectId, kind: item.kind }]
  })
  return {
    cells,
    contours,
    objects,
    bounds: Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 1, 1],
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

export function drawWorldLattice(
  canvas: HTMLCanvasElement,
  plan: WorldLatticePlan,
  selectedObjectId?: number,
  kindLabels?: Readonly<Partial<Record<MapObjectKind, string>>>,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2D lattice canvas is unavailable')
  const screen = latticeScreen(canvas, plan)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineWidth = 0.35
  context.strokeStyle = 'rgba(15, 25, 25, 0.18)'
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
  context.lineWidth = 1.4
  context.strokeStyle = '#d8dec4'
  context.beginPath()
  for (const [a, b] of plan.contours) {
    context.moveTo(...screen(a))
    context.lineTo(...screen(b))
  }
  context.stroke()
  for (const object of plan.objects) {
    const selected = object.objectId === selectedObjectId
    context.fillStyle = WORLD_OBJECT_KIND_COLORS[object.kind]
    context.beginPath()
    context.arc(...screen(object.point), selected ? 4 : 2, 0, Math.PI * 2)
    context.fill()
    if (selected) {
      context.lineWidth = 1.5
      context.strokeStyle = '#ffe082'
      context.stroke()
    }
  }
  // Legend: the kinds present, in the viewer's language when the caller names them.
  const kinds = (Object.keys(WORLD_OBJECT_KIND_COLORS) as MapObjectKind[]).filter(kind =>
    plan.objects.some(object => object.kind === kind),
  )
  if (kinds.length === 0) return
  context.font = '11px sans-serif'
  context.textBaseline = 'middle'
  const rowHeight = 15
  const width = Math.max(...kinds.map(kind => context.measureText(kindLabels?.[kind] ?? kind).width)) + 22
  context.fillStyle = 'rgba(12, 14, 18, 0.72)'
  context.fillRect(6, 6, width, kinds.length * rowHeight + 6)
  kinds.forEach((kind, index) => {
    const y = 6 + 3 + index * rowHeight + rowHeight / 2
    context.fillStyle = WORLD_OBJECT_KIND_COLORS[kind]
    context.beginPath()
    context.arc(15, y, 4, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#e8eaed'
    context.fillText(kindLabels?.[kind] ?? kind, 24, y)
  })
}
