/** Draw-local polygon offset. Units use the provider's depth representation, as WebGL does. */
export interface SceneDepthBias {
  readonly slopeScale: number
  readonly units: number
}
/** Terrain writes slightly farther depth so coplanar surface models win without moving geometry. */
export const TERRAIN_DEPTH_BIAS: SceneDepthBias = Object.freeze({ slopeScale: 0.1, units: 1 })
export function readSceneDepthBias(value: SceneDepthBias | undefined): SceneDepthBias | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value.slopeScale) || !Number.isFinite(value.units))
    throw new TypeError('invalid scene depth bias')
  return { slopeScale: value.slopeScale, units: value.units }
}
export function applyWebGlDepthBias(
  gl: WebGL2RenderingContext,
  value: SceneDepthBias | undefined,
): void {
  const bias = readSceneDepthBias(value)
  if (bias === undefined) {
    gl.disable(gl.POLYGON_OFFSET_FILL)
    return
  }
  gl.enable(gl.POLYGON_OFFSET_FILL)
  gl.polygonOffset(bias.slopeScale, bias.units)
}
interface ScreenVertex {
  readonly x: number
  readonly y: number
  readonly z: number
}
/** Headless stores NDC depth in Float32Array. One unit is the next representable positive
 * float32 step at the triangle's maximum absolute depth; slope is depth change per pixel.
 * Hardware's depth format is implementation-defined, so cross-provider pixel identity is not
 * asserted by this API. Absent bias returns exactly zero and leaves old arithmetic unchanged. */
export function headlessDepthBias(
  vertices: readonly [ScreenVertex, ScreenVertex, ScreenVertex],
  value: SceneDepthBias | undefined,
): number {
  const bias = readSceneDepthBias(value)
  if (bias === undefined) return 0
  const [a, b, c] = vertices,
    determinant = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return 0
  const dx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / determinant
  const dy = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / determinant
  const depth = Math.fround(Math.max(Math.abs(a.z), Math.abs(b.z), Math.abs(c.z)))
  if (!Number.isFinite(depth)) throw new RangeError('invalid biased scene depth')
  const unit = depth === 0 ? 2 ** -149 : 2 ** Math.max(-149, Math.floor(Math.log2(depth)) - 23)
  const result = bias.slopeScale * Math.max(Math.abs(dx), Math.abs(dy)) + bias.units * unit
  if (!Number.isFinite(result)) throw new RangeError('scene depth bias overflow')
  return result
}
