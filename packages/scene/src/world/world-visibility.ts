/** Common Scene owner: render-only opaque boundary fog in the renderer's X/Z world space.
 * The caller supplies the already-inset visible rectangle. Geometry, native data, shadows and
 * picking are preserved; CPU and GPU color paths share this half-open visibility policy. */
import { uniformLocation } from '../materials/webgl.js'
export type WorldVisibilityBounds = readonly [
  minimumX: number,
  minimumZ: number,
  maximumX: number,
  maximumZ: number,
]

export function checkedWorldVisibilityBounds(
  bounds?: WorldVisibilityBounds,
): WorldVisibilityBounds | undefined {
  if (bounds === undefined) return undefined
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0]! > bounds[2]! ||
    bounds[1]! > bounds[3]!
  )
    throw new TypeError('world visibility bounds must be a finite ordered X/Z rectangle')
  return bounds
}

export function worldPointVisible(
  bounds: WorldVisibilityBounds | undefined,
  point: readonly number[],
): boolean {
  return (
    bounds === undefined ||
    (point[0]! >= bounds[0] &&
      point[0]! < bounds[2] &&
      point[2]! >= bounds[1] &&
      point[2]! < bounds[3])
  )
}

export const WORLD_VISIBILITY_GLSL = `
uniform float u_worldVisibilityEnabled;
uniform vec4 u_worldVisibilityBounds;
bool worldPointVisible(vec3 p) {
  return u_worldVisibilityEnabled < 0.5 ||
    (p.x >= u_worldVisibilityBounds.x && p.z >= u_worldVisibilityBounds.y &&
     p.x < u_worldVisibilityBounds.z && p.z < u_worldVisibilityBounds.w);
}
`

const heldVisibility = new WeakMap<WebGLProgram, WorldVisibilityBounds | null>()

export function bindWorldVisibility(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  bounds?: WorldVisibilityBounds,
): void {
  const held = heldVisibility.get(program)
  // New linked programs default to zero. Normal model/world draws need no additional uploads.
  if (bounds === undefined && (held === undefined || held === null)) return
  if (bounds !== undefined && held && bounds.every((v, i) => Math.fround(v) === held[i])) return
  gl.uniform1f(
    uniformLocation(gl, program, 'u_worldVisibilityEnabled'),
    bounds === undefined ? 0 : 1,
  )
  if (bounds !== undefined)
    gl.uniform4fv(uniformLocation(gl, program, 'u_worldVisibilityBounds'), bounds)
  heldVisibility.set(
    program,
    bounds === undefined
      ? null
      : [
          Math.fround(bounds[0]),
          Math.fround(bounds[1]),
          Math.fround(bounds[2]),
          Math.fround(bounds[3]),
        ],
  )
}
