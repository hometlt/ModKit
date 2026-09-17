/**
 * Pseudo-3D relation graph maths — DOM-free.
 *
 * `layoutRelationGraph` and `layoutGalaxyGraph` are a mechanical port of MK2's
 * `apps/modkit-vscode/src/webview/relation-graph-main.ts` (same constants, same FNV hash, same
 * golden-angle shells, same 150-step cooled force pass), with `THREE.Vector3` replaced by tuples so
 * the UI package stays renderer-free. MK2 drew through three.js; MK3 projects the same world onto
 * a Canvas 2D with the shared orbit camera (`../model/orbit.ts`) and MK2's 48° perspective camera.
 */
import type { OrbitBasis } from '../model/orbit.js'

export type Vec3 = [number, number, number]
type Point = readonly [number, number, number]

export interface LayoutNode {
  readonly id: string
  readonly type: string
}

export interface LayoutEdge {
  readonly from: string
  readonly to: string
}

export interface LayoutInput {
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly LayoutEdge[]
  /** Anchor pinned at the origin (default: the first node, as MK2 passed the root first). */
  readonly root?: string
  /** MK2 `scope: 'all'` — forces the clustered layout and leaves the root in its cluster. */
  readonly clustered?: boolean
}

export const FORCE_LAYOUT_LIMIT = 220
/** MK2 `PerspectiveCamera(48, …)`. */
export const FIELD_OF_VIEW = (48 * Math.PI) / 180
const NEAR = 0.1

export function hash(value: string): number {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function sphericalPoint(index: number, count: number, seed: number, radius: number): Vec3 {
  const y = 1 - 2 * ((index + 0.5) / Math.max(1, count))
  const radial = Math.sqrt(Math.max(0, 1 - y * y))
  const angle = Math.PI * 2 * (index * 0.61803398875 + seed)
  return [Math.cos(angle) * radial * radius, y * radius, Math.sin(angle) * radial * radius]
}

const rootIndexOf = (input: LayoutInput): number =>
  input.root === undefined ? 0 : input.nodes.findIndex(node => node.id === input.root)

/** Linear-time clustered layout for hundreds through tens of thousands of entities. */
export function layoutGalaxyGraph(input: LayoutInput): Vec3[] {
  const groups = new Map<string, LayoutNode[]>()
  for (const node of input.nodes) {
    const group = groups.get(node.type)
    if (group) group.push(node)
    else groups.set(node.type, [node])
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  const cloudRadius = Math.max(280, Math.cbrt(input.nodes.length) * 65)
  const placed = new Map<LayoutNode, Vec3>()
  entries.forEach(([type, members], groupIndex) => {
    const seed = hash(type) / 0xffffffff
    const shell = cloudRadius * (0.35 + 0.65 * ((hash(`${type}:shell`) % 1000) / 1000))
    const center = sphericalPoint(groupIndex, entries.length, seed, shell)
    const localRadius = 24 + Math.cbrt(members.length) * 19
    members.forEach((node, localIndex) => {
      const localSeed = hash(node.id) / 0xffffffff
      const local = sphericalPoint(localIndex, members.length, localSeed, localRadius)
      placed.set(node, [center[0] + local[0], center[1] + local[1], center[2] + local[2]])
    })
  })
  const rootIndex = input.clustered === true ? -1 : rootIndexOf(input)
  return input.nodes.map((node, index): Vec3 =>
    index === rootIndex ? [0, 0, 0] : (placed.get(node) ?? [0, 0, 0]),
  )
}

/** Hop distance from the root over undirected edges; MK2 received it from the traversal. */
function depths(input: LayoutInput, indexById: ReadonlyMap<string, number>): number[] {
  const result = input.nodes.map(() => 1)
  const rootIndex = rootIndexOf(input)
  if (rootIndex < 0) return result
  const adjacent = input.nodes.map((): number[] => [])
  for (const edge of input.edges) {
    const from = indexById.get(edge.from)
    const to = indexById.get(edge.to)
    if (from === undefined || to === undefined) continue
    adjacent[from]?.push(to)
    adjacent[to]?.push(from)
  }
  const seen = new Set([rootIndex])
  result[rootIndex] = 0
  let frontier = [rootIndex]
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: number[] = []
    for (const index of frontier) {
      for (const neighbour of adjacent[index] ?? []) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        result[neighbour] = depth
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return result
}

interface Body {
  p: Vec3
  readonly v: Vec3
}

/** Deterministic force layout for small focused relation neighbourhoods. */
export function layoutRelationGraph(input: LayoutInput): Vec3[] {
  const count = input.nodes.length
  if (count === 0) return []
  if (count > FORCE_LAYOUT_LIMIT || input.clustered === true) return layoutGalaxyGraph(input)
  const indexById = new Map(input.nodes.map((node, index) => [node.id, index]))
  const depth = depths(input, indexById)
  const rootIndex = rootIndexOf(input)
  const bodies = input.nodes.map((node, index): Body => {
    const seed = hash(node.id) / 0xffffffff
    const p: Vec3 =
      index === rootIndex
        ? [0, 0, 0]
        : sphericalPoint(index, count, seed, 95 + Math.max(1, depth[index] ?? 1) * 115)
    return { p, v: [0, 0, 0] }
  })
  const pairs = input.edges.flatMap(edge => {
    const from = bodies[indexById.get(edge.from) ?? -1]
    const to = bodies[indexById.get(edge.to) ?? -1]
    return from === undefined || to === undefined ? [] : [[from, to] as const]
  })
  const root = bodies[rootIndex]
  for (let iteration = 0; iteration < 150; iteration++) {
    const cooling = 1 - iteration / 175
    bodies.forEach((a, i) => {
      for (let j = i + 1; j < count; j++) {
        const b = bodies[j]
        if (b === undefined) continue
        const dx = a.p[0] - b.p[0]
        const dy = a.p[1] - b.p[1]
        const dz = a.p[2] - b.p[2]
        const lengthSq = dx * dx + dy * dy + dz * dz
        const distanceSq = Math.max(100, lengthSq)
        // THREE.Vector3.normalize() leaves a zero vector at zero.
        const length = Math.sqrt(lengthSq)
        const k = (55_000 / distanceSq) * cooling
        const fx = length === 0 ? 0 : (dx / length) * k
        const fy = length === 0 ? 0 : (dy / length) * k
        const fz = length === 0 ? 0 : (dz / length) * k
        a.v[0] += fx
        a.v[1] += fy
        a.v[2] += fz
        b.v[0] -= fx
        b.v[1] -= fy
        b.v[2] -= fz
      }
    })
    for (const [from, to] of pairs) {
      const dx = to.p[0] - from.p[0]
      const dy = to.p[1] - from.p[1]
      const dz = to.p[2] - from.p[2]
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const k = (Math.max(1, length) - 130) * 0.0035 * cooling
      const fx = length === 0 ? 0 : (dx / length) * k
      const fy = length === 0 ? 0 : (dy / length) * k
      const fz = length === 0 ? 0 : (dz / length) * k
      from.v[0] += fx
      from.v[1] += fy
      from.v[2] += fz
      to.v[0] -= fx
      to.v[1] -= fy
      to.v[2] -= fz
    }
    // MK2 skipped index 0 (its root) and re-pinned it; the root body plays that role here.
    const damping = -0.00015 * cooling
    for (const body of bodies) {
      if (body === root) continue
      const { p, v } = body
      v[0] = (v[0] + p[0] * damping) * 0.82
      v[1] = (v[1] + p[1] * damping) * 0.82
      v[2] = (v[2] + p[2] * damping) * 0.82
      p[0] += v[0]
      p[1] += v[1]
      p[2] += v[2]
    }
    if (root !== undefined) root.p = [0, 0, 0]
  }
  return bodies.map(body => body.p)
}

export interface Framing {
  readonly center: Vec3
  /** MK2 `resetView`: camera distance from the centre. */
  readonly distance: number
}

/** MK2 `resetView`: bounding-box sphere, distance `max(360, r × 2.45)`. */
export function frame(positions: readonly Point[]): Framing {
  if (positions.length === 0) return { center: [0, 0, 0], distance: 360 }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const [x, y, z] of positions) {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
  return { center, distance: Math.max(360, radius * 2.45) }
}

export interface Camera {
  /** Point the camera looks at. */
  readonly target: Point
  readonly eye: Point
  readonly basis: OrbitBasis
  readonly width: number
  readonly height: number
}

export interface Projected {
  readonly x: number
  readonly y: number
  /** Distance in front of the camera; larger is farther. */
  readonly depth: number
  /** Pixels per world unit at this depth. */
  readonly scale: number
}

const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Perspective projection to canvas pixels; `undefined` behind the near plane. */
export function project(point: Point, camera: Camera): Projected | undefined {
  const rel: Point = [point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]]
  const depth = -dot(rel, camera.basis.backward)
  if (depth <= NEAR) return undefined
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2)
  const scale = focal / depth
  return {
    x: camera.width / 2 + dot(rel, camera.basis.right) * scale,
    y: camera.height / 2 - dot(rel, camera.basis.up) * scale,
    depth,
    scale,
  }
}

/** Screen-space pixel delta to a world-space offset in the view plane at `depth`. */
export function unproject(dx: number, dy: number, depth: number, camera: Camera): Vec3 {
  const focal = camera.height / 2 / Math.tan(FIELD_OF_VIEW / 2)
  const perPixel = depth / focal
  const { right, up } = camera.basis
  return [
    (right[0] * dx - up[0] * dy) * perPixel,
    (right[1] * dx - up[1] * dy) * perPixel,
    (right[2] * dx - up[2] * dy) * perPixel,
  ]
}

export interface Hit {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly depth: number
}

/**
 * Index of the node under a pointer: inside its drawn disc (plus `slop` pixels), nearest to the
 * camera when discs overlap — MK2's raycaster returned the first intersection the same way.
 */
export function pick(hits: readonly (Hit | undefined)[], x: number, y: number, slop = 3): number {
  let best = -1
  let bestDepth = Infinity
  hits.forEach((hit, index) => {
    if (hit === undefined) return
    if (Math.hypot(hit.x - x, hit.y - y) > hit.radius + slop) return
    if (hit.depth < bestDepth) {
      best = index
      bestDepth = hit.depth
    }
  })
  return best
}

/** Opacity for depth fading: 1 at the nearest node, `floor` at the farthest. */
export function depthFade(depth: number, near: number, far: number, floor = 0.25): number {
  if (far <= near) return 1
  const t = Math.min(1, Math.max(0, (depth - near) / (far - near)))
  return 1 - t * (1 - floor)
}
