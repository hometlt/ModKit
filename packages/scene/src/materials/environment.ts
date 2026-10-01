import type { SceneRendererEnvironment, SceneRendererTexture } from '@modkit/sdk/renderer'
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

/**
 * The resource an `envi` layer with `sceneEnvironment: true` reads: the environment of the scene the
 * model is drawn in, not a file of the model (a level's sky, a map's reflection). A scene without
 * one of its own - a model viewer, a world whose lighting names none - gives the neutral default.
 */
export const SCENE_ENVIRONMENT_RESOURCE = 'modkit:scene-environment'

const SKY_SIZE = 16
const ZENITH = [168, 180, 196],
  HORIZON = [216, 216, 212],
  NADIR = [92, 88, 84]

/**
 * The neutral default environment: a soft grey sky, lighter above the horizon than below it (cube
 * space +Y up), so glass and metal reflect something readable without tinting the model.
 */
export const DEFAULT_SCENE_ENVIRONMENT: SceneRendererTexture = Object.freeze({
  id: SCENE_ENVIRONMENT_RESOURCE,
  dimension: 'cube',
  width: SKY_SIZE,
  height: SKY_SIZE,
  rgba: (() => {
    const rgba = new Uint8Array(SKY_SIZE * SKY_SIZE * 4 * 6)
    for (let face = 0; face < 6; face++)
      for (let row = 0; row < SKY_SIZE; row++)
        for (let column = 0; column < SKY_SIZE; column++) {
          // the face's texel direction, as cube sampling defines it (+X,-X,+Y,-Y,+Z,-Z; rows down)
          const x = ((column + 0.5) / SKY_SIZE) * 2 - 1,
            y = ((row + 0.5) / SKY_SIZE) * 2 - 1
          const up = (face === 2 ? 1 : face === 3 ? -1 : -y) / Math.hypot(1, x, y)
          const [toward, amount] = up >= 0 ? [ZENITH, up] : [NADIR, Math.min(1, -up * 1.5)]
          const at = ((face * SKY_SIZE + row) * SKY_SIZE + column) * 4
          for (let channel = 0; channel < 3; channel++)
            rgba[at + channel] = Math.round(
              HORIZON[channel]! + (toward[channel]! - HORIZON[channel]!) * amount,
            )
          rgba[at + 3] = 255
        }
    return rgba
  })(),
})

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
