import type { SceneRendererTexture } from '@modkit/sdk/renderer'

export type CubeFace = 0 | 1 | 2 | 3 | 4 | 5
type Direction = readonly [number, number, number]
type Color = readonly [number, number, number, number]

/** OpenGL/DDS cube coordinates. The image's first row is the t=0 row; no loader-specific flips.
 * https://registry.khronos.org/OpenGL/extensions/OES/OES_texture_cube_map.txt */
export function cubeFaceCoordinates(direction: Direction): {
  face: CubeFace
  u: number
  v: number
} {
  const [x, y, z] = direction
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z)
  if (!direction.every(Number.isFinite) || Math.max(ax, ay, az) === 0)
    throw new TypeError('cube direction must be finite and nonzero')
  let face: CubeFace, s: number, t: number, major: number
  if (ax >= ay && ax >= az) {
    face = x >= 0 ? 0 : 1
    s = x >= 0 ? -z : z
    t = -y
    major = ax
  } else if (ay >= az) {
    face = y >= 0 ? 2 : 3
    s = x
    t = y >= 0 ? z : -z
    major = ay
  } else {
    face = z >= 0 ? 4 : 5
    s = z >= 0 ? x : -x
    t = -y
    major = az
  }
  return { face, u: (s / major + 1) * 0.5, v: (t / major + 1) * 0.5 }
}

/** Inverse projection, also valid just outside a face for filtering across its edge. */
export function cubeFaceDirection(face: CubeFace, u: number, v: number): Direction {
  const s = u * 2 - 1,
    t = v * 2 - 1
  if (!Number.isFinite(s) || !Number.isFinite(t))
    throw new TypeError('invalid cube face coordinates')
  switch (face) {
    case 0:
      return [1, -t, -s]
    case 1:
      return [-1, -t, s]
    case 2:
      return [s, 1, t]
    case 3:
      return [s, -1, -t]
    case 4:
      return [s, -t, 1]
    case 5:
      return [-s, -t, -1]
    default:
      throw new TypeError('invalid cube face')
  }
}

/** Shared validation for packed scene images, including all six faces of a cube. */
export function sceneTextureBytes(texture: SceneRendererTexture): number {
  const { width, height, dimension = '2d' } = texture
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    (dimension !== '2d' && dimension !== 'cube') ||
    (dimension === 'cube' && width !== height)
  )
    throw new TypeError('scene texture requires valid dimensions and square cube faces')
  const bytes = width * height * 4 * (dimension === 'cube' ? 6 : 1)
  if (
    !Number.isSafeInteger(bytes) ||
    !(texture.rgba instanceof Uint8Array) ||
    texture.rgba.length !== bytes
  )
    throw new TypeError('scene texture must contain complete tightly packed RGBA8 surfaces')
  return bytes
}

/** Cube filtering over six decoded faces. Linear filtering follows neighbouring faces at edges. */
export function sampleCubeTexture(texture: SceneRendererTexture, direction: Direction): Color {
  if (texture.dimension !== 'cube') throw new TypeError('cube sampling requires a cube image')
  const size = texture.width
  const { face, u, v } = cubeFaceCoordinates(direction)
  const pixel = (face: CubeFace, x: number, y: number): Color => {
    const offset =
      ((face * size + Math.max(0, Math.min(size - 1, y))) * size +
        Math.max(0, Math.min(size - 1, x))) *
      4
    return [0, 1, 2, 3].map(
      channel => (texture.rgba[offset + channel] ?? 0) / 255,
    ) as unknown as Color
  }
  if (texture.filter === 'nearest') return pixel(face, Math.floor(u * size), Math.floor(v * size))
  const tap = (x: number, y: number): Color => {
    if (x >= 0 && y >= 0 && x < size && y < size) return pixel(face, x, y)
    if ((x < 0 || x >= size) && (y < 0 || y >= size)) {
      const cx = Math.max(0, Math.min(size - 1, x)),
        cy = Math.max(0, Math.min(size - 1, y))
      const samples = [pixel(face, cx, cy), tap(x, cy), tap(cx, y)]
      return [0, 1, 2, 3].map(
        channel => samples.reduce((sum, value) => sum + (value[channel] ?? 0), 0) / 3,
      ) as unknown as Color
    }
    const adjacent = cubeFaceCoordinates(
      cubeFaceDirection(face, (x + 0.5) / size, (y + 0.5) / size),
    )
    return pixel(adjacent.face, Math.floor(adjacent.u * size), Math.floor(adjacent.v * size))
  }
  const x = u * size - 0.5,
    y = v * size - 0.5,
    left = Math.floor(x),
    top = Math.floor(y),
    fx = x - left,
    fy = y - top
  const a = tap(left, top),
    b = tap(left + 1, top),
    c = tap(left, top + 1),
    d = tap(left + 1, top + 1)
  return [0, 1, 2, 3].map(
    channel =>
      ((a[channel] ?? 0) * (1 - fx) + (b[channel] ?? 0) * fx) * (1 - fy) +
      ((c[channel] ?? 0) * (1 - fx) + (d[channel] ?? 0) * fx) * fy,
  ) as unknown as Color
}
