/**
 * The metallic-roughness BRDF of glTF 2.0 (Appendix B) for one directional light and a uniform
 * ambient, the one formula every renderer of a glTF material draws: shadePbr on the CPU, PBR_GLSL
 * in shaders. The two must change together.
 *
 * Colours are linear. A light of colour `c` lights a white Lambert surface that faces it to `c` (the
 * BRDF times π), as the renderers' preview lights are authored. The ambient lights both lobes: the
 * diffuse colour, and the specular reflectance through Karis' analytic split-sum approximation, so a
 * metal without an environment map still shows its colour instead of black.
 */
export type PbrVec3 = readonly [number, number, number]

export interface PbrSurface {
  /** Linear base colour. */
  readonly baseColor: PbrVec3
  readonly metallic: number
  readonly roughness: number
  /** 0..1, darkening the ambient (glTF occlusionTexture × strength); default 1. */
  readonly occlusion?: number
  /** Linear emitted colour, added after light; default black. */
  readonly emissive?: PbrVec3
}

const dot = (a: PbrVec3, b: PbrVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Outgoing light of a surface: `normal`, `view` (surface to eye) and `light` (surface to light)
 * are unit vectors.
 */
export function shadePbr(
  surface: PbrSurface,
  normal: PbrVec3,
  view: PbrVec3,
  light: Readonly<{ direction: PbrVec3; color: PbrVec3 }>,
  ambient: PbrVec3,
): [number, number, number] {
  const roughness = clamp01(surface.roughness)
  const metallic = clamp01(surface.metallic)
  const alpha = Math.max(roughness * roughness, 1e-3)
  const alpha2 = alpha * alpha
  const nDotL = clamp01(dot(normal, light.direction))
  const nDotV = Math.max(dot(normal, view), 1e-4)
  const half = [
    light.direction[0] + view[0],
    light.direction[1] + view[1],
    light.direction[2] + view[2],
  ] as const
  const halfLength = Math.hypot(half[0], half[1], half[2]) || 1
  const nDotH = clamp01(dot(normal, half) / halfLength)
  const vDotH = clamp01(dot(view, half) / halfLength)
  const d = alpha2 / (Math.PI * (nDotH * nDotH * (alpha2 - 1) + 1) ** 2)
  const visibility =
    0.5 /
    Math.max(
      nDotL * Math.sqrt(nDotV * nDotV * (1 - alpha2) + alpha2) +
        nDotV * Math.sqrt(nDotL * nDotL * (1 - alpha2) + alpha2),
      1e-6,
    )
  // Karis' fit of the split-sum environment BRDF, for the ambient specular
  const r0 = roughness * -1 + 1
  const r1 = roughness * -0.0275 + 0.0425
  const r2 = roughness * -0.572 + 1.04
  const r3 = roughness * 0.022 - 0.04
  const a004 = Math.min(r0 * r0, 2 ** (-9.28 * nDotV)) * r0 + r1
  const scale = a004 * -1.04 + r2
  const bias = a004 * 1.04 + r3
  const occlusion = surface.occlusion ?? 1
  return [0, 1, 2].map(channel => {
    const base = surface.baseColor[channel]!
    const diffuse = base * (1 - metallic)
    const f0 = 0.04 + (base - 0.04) * metallic
    const fresnel = f0 + (1 - f0) * (1 - vDotH) ** 5
    const direct =
      ((1 - fresnel) * diffuse + Math.PI * fresnel * d * visibility) * light.color[channel]! * nDotL
    const environment = ambient[channel]! * (diffuse + f0 * scale + bias) * occlusion
    return direct + environment + (surface.emissive?.[channel] ?? 0)
  }) as [number, number, number]
}

/**
 * A filmic curve `x(ax + b) / (x(cx + d) + e)` per channel, taking linear light of any brightness
 * into 0..1 (BAR's TONEMAP; its defaults are 4.75, 0.75, 3.5, 0.85, 1). TONEMAP_GLSL is its twin.
 */
export type TonemapCurve = readonly [number, number, number, number, number]

export function tonemap(value: number, curve: TonemapCurve): number {
  const [a, b, c, d, e] = curve
  const x = Math.max(0, value)
  return clamp01((x * (a * x + b)) / (x * (c * x + d) + e))
}

export const TONEMAP_GLSL = `vec3 modkitTonemap(vec3 x, vec4 abcd, float e) {
  x = max(x, vec3(0.0));
  return clamp(x * (abcd.x * x + abcd.y) / (x * (abcd.z * x + abcd.w) + e), 0.0, 1.0);
}`

/** The sRGB transfer of codec-kit raster's srgbToLinear and linearToSrgb, for shaders. */
export const SRGB_GLSL = `vec3 modkitSrgbToLinear(vec3 value) {
  return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)), vec3(greaterThan(value, vec3(0.04045))));
}
vec3 modkitLinearToSrgb(vec3 value) {
  return mix(value * 12.92, 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055, vec3(greaterThan(value, vec3(0.0031308))));
}`

/** shadePbr for shaders; light and ambient as there. */
export const PBR_GLSL = `vec3 modkitPbr(vec3 baseColor, float metallic, float roughness, float occlusion, vec3 emissive,
    vec3 normal, vec3 view, vec3 lightDirection, vec3 lightColor, vec3 ambient) {
  roughness = clamp(roughness, 0.0, 1.0);
  metallic = clamp(metallic, 0.0, 1.0);
  float alpha = max(roughness * roughness, 1e-3);
  float alpha2 = alpha * alpha;
  float nDotL = clamp(dot(normal, lightDirection), 0.0, 1.0);
  float nDotV = max(dot(normal, view), 1e-4);
  vec3 halfVector = lightDirection + view;
  float halfLength = length(halfVector);
  halfVector = halfLength > 0.0 ? halfVector / halfLength : halfVector;
  float nDotH = clamp(dot(normal, halfVector), 0.0, 1.0);
  float vDotH = clamp(dot(view, halfVector), 0.0, 1.0);
  float distribution = alpha2 / (3.14159265358979 * pow(nDotH * nDotH * (alpha2 - 1.0) + 1.0, 2.0));
  float visibility = 0.5 / max(nDotL * sqrt(nDotV * nDotV * (1.0 - alpha2) + alpha2)
    + nDotV * sqrt(nDotL * nDotL * (1.0 - alpha2) + alpha2), 1e-6);
  vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  vec2 environmentBrdf = vec2(-1.04, 1.04) * a004 + r.zw;
  vec3 diffuse = baseColor * (1.0 - metallic);
  vec3 f0 = mix(vec3(0.04), baseColor, metallic);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vDotH, 5.0);
  vec3 direct = ((1.0 - fresnel) * diffuse + 3.14159265358979 * fresnel * distribution * visibility)
    * lightColor * nDotL;
  vec3 environment = ambient * (diffuse + f0 * environmentBrdf.x + environmentBrdf.y) * occlusion;
  return direct + environment + emissive;
}`
