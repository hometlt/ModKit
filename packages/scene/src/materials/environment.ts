import type { SceneRendererEnvironment } from '@modkit/sdk/renderer'
import type { Vec3 } from '@modkit/codec-kit/model-math/standard-material-glsl'
import type { StandardMaterialProgram, MaterialTextureBinding } from './standard-program.js'

function vector(value: unknown, length: number, name: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new TypeError(`${name} requires ${length} finite float32 components`)
  const captured: number[] = []
  for (let index = 0; index < length; index++) {
    const item: unknown = value[index]
    if (typeof item !== 'number' || !Number.isFinite(item) || !Number.isFinite(Math.fround(item)))
      throw new TypeError(`${name} requires ${length} finite float32 components`)
    captured.push(Math.fround(item))
  }
  return Object.freeze(captured)
}

/** Own the explicit frame before raster/renderer awaits. No guessed camera or native defaults. */
export function snapshotEnvironment(value: unknown): SceneRendererEnvironment | undefined {
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => key !== 'worldToEnvironment')
  )
    throw new TypeError('invalid environment frame')
  const worldToEnvironment = vector(
    Reflect.get(value, 'worldToEnvironment'),
    16,
    'worldToEnvironment',
  )
  if ([3, 7, 11].some(index => worldToEnvironment[index] !== 0) || worldToEnvironment[15] !== 1)
    throw new TypeError('worldToEnvironment must be affine')
  // Unit world normal/incident inputs yield components bounded by this affine row envelope.
  // Reflection is V - 2*dot(V,N)*N: B + 6*B^3 bounds its intermediates and final components.
  const envelope = Math.max(
    ...[0, 1, 2].map(row =>
      [0, 4, 8, 12].reduce(
        (sum, column) => sum + Math.abs(worldToEnvironment[row + column] ?? 0),
        0,
      ),
    ),
  )
  if (envelope + 6 * envelope ** 3 > 3.4028234663852886e38 / 2)
    throw new TypeError('worldToEnvironment exceeds safe float32 reflection arithmetic')
  return Object.freeze({ worldToEnvironment })
}

export function snapshotEyePosition(value: unknown): Vec3 | undefined {
  return value === undefined ? undefined : (vector(value, 3, 'eyePosition') as Vec3)
}

export const isEnvironmentBinding = (binding: MaterialTextureBinding): boolean =>
  binding.dimension === 'cube' && (binding.slot === 'envi' || binding.slot === 'enviMask')

export function requiresEnvironmentEye(program: StandardMaterialProgram): boolean {
  return (
    program.environment !== undefined &&
    program.textures.some(
      binding =>
        isEnvironmentBinding(binding) &&
        program.defines.layers.some(layer => layer.slot === binding.slot && layer.uvSource === 2),
    )
  )
}

/** Both vectors use affine w=1, matching the explicit environment vocabulary. Normalization
 * after this transform would change reflection for affine scale/translation and is not applied. */
export function environmentVector(environment: SceneRendererEnvironment, value: Vec3): Vec3 {
  const m = environment.worldToEnvironment
  const row = (r: number) =>
    (m[r] ?? 0) * value[0] +
    (m[r + 4] ?? 0) * value[1] +
    (m[r + 8] ?? 0) * value[2] +
    (m[r + 12] ?? 0)
  return [row(0), row(1), row(2)]
}
