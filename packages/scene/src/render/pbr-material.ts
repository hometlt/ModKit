import type {
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { linearToSrgb, srgbToLinear } from '@modkit/codec-kit/raster'
import { shadePbr, type PbrVec3 } from '@modkit/codec-kit/model-math/pbr'

/** A `pbr` material as a base-route draw shades it, its textures resolved. */
export interface DrawPbr {
  readonly metallic: number
  readonly roughness: number
  readonly metallicRoughness?: SceneRendererTexture
  readonly occlusion?: SceneRendererTexture
  readonly occlusionStrength: number
  /** Linear. */
  readonly emissive: PbrVec3
  readonly emissiveTexture?: SceneRendererTexture
  readonly normal?: SceneRendererTexture
  readonly normalScale: number
}

const factor = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new TypeError(`${label} must be in 0..1`)
  return value
}

/**
 * The metallic-roughness inputs of a `pbr` material, or undefined for another shading model. A
 * texture the scene did not carry as a 2D texture is left out and reported; the factors still hold.
 */
export function drawPbr(
  material: SceneRendererMaterial,
  textures: ReadonlyMap<string, SceneRendererTexture>,
  diagnostics: SceneRendererDiagnostic[],
): DrawPbr | undefined {
  if (material.shading !== 'pbr') return undefined
  const pbr = material.pbr ?? { metallic: 1, roughness: 1 }
  const texture = (id: string | undefined, role: string) => {
    if (id === undefined) return undefined
    const found = textures.get(id)
    if (found !== undefined && found.dimension !== 'cube') return found
    diagnostics.push({
      severity: 'warning',
      code: 'common.scene/pbr-texture-missing',
      message: `material ${material.id} names ${role} texture ${id}, which the scene did not carry as a 2D texture`,
    })
    return undefined
  }
  const emissive = pbr.emissive ?? [0, 0, 0]
  const metallicRoughness = texture(pbr.metallicRoughnessTexture, 'metallic-roughness')
  const occlusion = texture(pbr.occlusionTexture, 'occlusion')
  const emissiveTexture = texture(pbr.emissiveTexture, 'emissive')
  const normal = texture(pbr.normalTexture, 'normal')
  const normalScale = pbr.normalScale ?? 1
  if (!Number.isFinite(normalScale))
    throw new TypeError(`material ${material.id} normal scale must be finite`)
  return {
    metallic: factor(pbr.metallic, `material ${material.id} metallic`),
    roughness: factor(pbr.roughness, `material ${material.id} roughness`),
    ...(metallicRoughness === undefined ? {} : { metallicRoughness }),
    ...(occlusion === undefined ? {} : { occlusion }),
    occlusionStrength: factor(pbr.occlusionStrength ?? 1, `material ${material.id} occlusion`),
    emissive: emissive.map((value, index) =>
      srgbToLinear(factor(value, `material ${material.id} emissive ${index}`)),
    ) as unknown as PbrVec3,
    ...(emissiveTexture === undefined ? {} : { emissiveTexture }),
    ...(normal === undefined ? {} : { normal }),
    normalScale,
  }
}

/**
 * The normal a normal-map texel names (glTF: tangent space, +Y up, X and Y scaled), around the
 * interpolated `normal`: `tangent` is the primitive's TANGENT (with its handedness `sign`) or the
 * triangle's dP/du, made orthogonal to the normal; the bitangent is normal × tangent × sign, as
 * glTF and its sample viewer define it. A degenerate tangent leaves the normal as it is.
 */
export function perturbedNormal(
  normal: PbrVec3,
  tangent: PbrVec3,
  sign: number,
  texel: readonly number[],
  scale: number,
): PbrVec3 {
  const along = normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2]
  const t = [0, 1, 2].map(axis => tangent[axis]! - normal[axis]! * along)
  const length = Math.hypot(t[0]!, t[1]!, t[2]!)
  if (!(length > 1e-10)) return normal
  const unit = t.map(value => value / length)
  const b = [
    (normal[1] * unit[2]! - normal[2] * unit[1]!) * sign,
    (normal[2] * unit[0]! - normal[0] * unit[2]!) * sign,
    (normal[0] * unit[1]! - normal[1] * unit[0]!) * sign,
  ]
  const x = ((texel[0] ?? 0.5) * 2 - 1) * scale
  const y = ((texel[1] ?? 0.5) * 2 - 1) * scale
  const z = (texel[2] ?? 1) * 2 - 1
  const n = [0, 1, 2].map(axis => unit[axis]! * x + b[axis]! * y + normal[axis]! * z)
  const size = Math.hypot(n[0]!, n[1]!, n[2]!)
  return size > 0 ? ([n[0]! / size, n[1]! / size, n[2]! / size] as const) : normal
}

/**
 * One pixel of a `pbr` material: `albedo` the base colour in the texture's (sRGB) space, the
 * texels of its metallic-roughness, occlusion and emissive textures when it has them; the result
 * is sRGB again. The light is the scene light, its `ambient` fraction lighting from everywhere.
 */
export function shadeDrawPbr(
  pbr: DrawPbr,
  albedo: readonly [number, number, number],
  texels: Readonly<{
    metallicRoughness?: readonly number[]
    occlusion?: readonly number[]
    emissive?: readonly number[]
  }>,
  normal: PbrVec3,
  view: PbrVec3,
  light: Readonly<{ direction: PbrVec3; color: readonly number[]; ambient: number }>,
): [number, number, number] {
  const metallic = pbr.metallic * (texels.metallicRoughness?.[2] ?? 1)
  const roughness = pbr.roughness * (texels.metallicRoughness?.[1] ?? 1)
  const occlusion =
    texels.occlusion === undefined
      ? 1
      : 1 + pbr.occlusionStrength * ((texels.occlusion[0] ?? 1) - 1)
  const emissive = pbr.emissive.map(
    (value, channel) => value * srgbToLinear(texels.emissive?.[channel] ?? 1),
  ) as unknown as PbrVec3
  const lightColor = [0, 1, 2].map(channel => light.color[channel] ?? 1)
  const shaded = shadePbr(
    {
      baseColor: albedo.map(channel =>
        srgbToLinear(Math.min(1, Math.max(0, channel))),
      ) as unknown as PbrVec3,
      metallic,
      roughness,
      occlusion,
      emissive,
    },
    normal,
    view,
    {
      direction: light.direction,
      color: lightColor.map(value => value * (1 - light.ambient)) as unknown as PbrVec3,
    },
    lightColor.map(value => value * light.ambient) as unknown as PbrVec3,
  )
  return shaded.map(value => linearToSrgb(Math.min(1, Math.max(0, value)))) as [
    number,
    number,
    number,
  ]
}
