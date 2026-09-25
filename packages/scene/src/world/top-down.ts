import type { WorldWebGlBatch, WorldWebGlPlan } from './webgl.js'

/** Largest side of a top-down image: 2048² RGBA is 16 MiB. */
export const WORLD_TOP_DOWN_MAX_SIZE = 2048

export interface WorldTopDownOptions {
  /** Longest image side in pixels, 1..WORLD_TOP_DOWN_MAX_SIZE; the other side keeps the world's aspect. */
  readonly maxSize: number
}

/** The pixel box an object covers, so a client can choose it by id from the picture. */
export interface WorldTopDownObject {
  readonly objectId: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WorldTopDownImage {
  readonly width: number
  readonly height: number
  /** Row-major RGBA8; row 0 is the world's north edge (canonical −Z), column 0 its west edge. */
  readonly rgba: Uint8Array
  /** The world rectangle the image covers: x grows to the right, z grows downward. */
  readonly world: Readonly<{ minimumX: number; maximumX: number; minimumZ: number; maximumZ: number }>
  readonly objects: readonly WorldTopDownObject[]
}

const BACKGROUND = [24, 24, 24] as const
const AMBIENT = 0.35

/**
 * An orthographic view from above of the plan `createWorldWebGlPlan` built for the world viewer:
 * the highest surface of every opaque batch at each pixel, vertex colour shaded by the plan's key
 * light, transparent surfaces (water) blended over it, line batches (regions, gateways) on top.
 * Materials and textures are not sampled; the picture shows shape and placement, not final look.
 * Pure arithmetic over the plan, so the same plan gives the same pixels.
 */
export function renderWorldTopDown(plan: WorldWebGlPlan, options: WorldTopDownOptions): WorldTopDownImage {
  const { maxSize } = options
  if (!Number.isSafeInteger(maxSize) || maxSize < 1 || maxSize > WORLD_TOP_DOWN_MAX_SIZE)
    throw new RangeError(`top-down maxSize must be 1..${WORLD_TOP_DOWN_MAX_SIZE}, not ${maxSize}`)
  const [minimumX, , minimumZ] = plan.bounds.minimum
  const [maximumX, , maximumZ] = plan.bounds.maximum
  const scale = maxSize / Math.max(maximumX - minimumX, maximumZ - minimumZ, Number.EPSILON)
  const width = Math.max(1, Math.round((maximumX - minimumX) * scale))
  const height = Math.max(1, Math.round((maximumZ - minimumZ) * scale))
  const rgba = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set([...BACKGROUND, 255], pixel * 4)
  const depth = new Float32Array(width * height).fill(-Infinity)
  const px = (x: number) => (x - minimumX) * scale
  const py = (z: number) => (z - minimumZ) * scale
  const light = normalized(plan.light.direction.map(value => -value) as [number, number, number])

  const surface = (batch: WorldWebGlBatch, opacity: number) => {
    const { positions, normals, colors } = batch
    for (let vertex = 0; vertex + 2 < positions.length / 3; vertex += 3) {
      const a = vertex * 3
      const b = a + 3
      const c = a + 6
      const n = normalized([
        normals[a]! + normals[b]! + normals[c]!,
        normals[a + 1]! + normals[b + 1]! + normals[c + 1]!,
        normals[a + 2]! + normals[b + 2]! + normals[c + 2]!,
      ])
      const shade = AMBIENT + (1 - AMBIENT) * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2])
      const color = [0, 1, 2].map(
        channel =>
          ((colors[vertex * 4 + channel]! + colors[vertex * 4 + 4 + channel]! + colors[vertex * 4 + 8 + channel]!) / 3) *
          shade *
          255,
      )
      fillTriangle(
        [px(positions[a]!), py(positions[a + 2]!), positions[a + 1]!],
        [px(positions[b]!), py(positions[b + 2]!), positions[b + 1]!],
        [px(positions[c]!), py(positions[c + 2]!), positions[c + 1]!],
        (index, y) => {
          if (y < depth[index]!) return
          if (opacity >= 1) depth[index] = y
          for (let channel = 0; channel < 3; channel += 1) {
            const at = index * 4 + channel
            rgba[at] = Math.round(rgba[at]! * (1 - opacity) + Math.min(255, Math.max(0, color[channel]!)) * opacity)
          }
        },
      )
    }
  }
  function fillTriangle(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    write: (index: number, y: number) => void,
  ) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (area === 0) return
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
    const right = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
    const bottom = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const x = column + 0.5
        const y = row + 0.5
        const wa = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / area
        const wb = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / area
        const wc = 1 - wa - wb
        if (wa < 0 || wb < 0 || wc < 0) continue
        write(row * width + column, wa * a[2] + wb * b[2] + wc * c[2])
      }
    }
  }

  for (const batch of [
    plan.opaqueTriangles,
    ...plan.shadowControlledOpaqueTriangles,
    ...plan.splatTriangles,
    ...plan.texturedTriangles,
  ])
    surface(batch, 1)
  surface(plan.transparentTriangles, 0.5)
  for (const batch of plan.transparentTexturedTriangles) surface(batch, 0.5)

  const { positions, colors } = plan.lines
  for (let vertex = 0; vertex + 1 < positions.length / 3; vertex += 2) {
    const color = [0, 1, 2].map(channel => Math.round(Math.min(1, Math.max(0, colors[vertex * 4 + channel]!)) * 255))
    const x0 = px(positions[vertex * 3]!)
    const y0 = py(positions[vertex * 3 + 2]!)
    const x1 = px(positions[vertex * 3 + 3]!)
    const y1 = py(positions[vertex * 3 + 5]!)
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let step = 0; step <= steps; step += 1) {
      const column = Math.floor(x0 + ((x1 - x0) * step) / steps)
      const row = Math.floor(y0 + ((y1 - y0) * step) / steps)
      if (column >= 0 && column < width && row >= 0 && row < height) rgba.set(color, (row * width + column) * 4)
    }
  }

  const objects = plan.picking.objects.map(object => {
    let left = px(object.center[0])
    let right = left
    let top = py(object.center[2])
    let bottom = top
    for (let at = 0; at + 2 < object.triangles.length; at += 3) {
      const x = px(object.triangles[at]!)
      const y = py(object.triangles[at + 2]!)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    const x = Math.min(width - 1, Math.max(0, Math.floor(left)))
    const y = Math.min(height - 1, Math.max(0, Math.floor(top)))
    return Object.freeze({
      objectId: object.objectId,
      x,
      y,
      width: Math.max(1, Math.min(width, Math.ceil(right)) - x),
      height: Math.max(1, Math.min(height, Math.ceil(bottom)) - y),
    })
  })
  return Object.freeze({
    width,
    height,
    rgba,
    world: Object.freeze({ minimumX, maximumX, minimumZ, maximumZ }),
    objects: Object.freeze(objects.sort((left, right) => left.objectId - right.objectId)),
  })
}

function normalized(vector: readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(...vector)
  return length < 1e-12 ? [0, 1, 0] : [vector[0] / length, vector[1] / length, vector[2] / length]
}
