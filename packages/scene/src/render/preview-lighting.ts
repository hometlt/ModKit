/** Shared CPU/GLSL light geometry and the existing bounded preview-light policy.
 * Spatial samples contain vector, distance and attenuation only. Admission, uniforms, preview
 * diffuse floor, color clamping and averaging remain separate from material BRDF evaluation. */
import type { SceneRendererLight } from '@modkit/sdk/renderer'

type Vec3 = readonly [number, number, number]
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const vector = (value: unknown, label: string): Vec3 => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(x => typeof x === 'number' && Number.isFinite(Math.fround(x)))
  )
    throw new TypeError(`invalid preview light ${label}`)
  return [Math.fround(value[0]), Math.fround(value[1]), Math.fround(value[2])]
}
const unit = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value)
  if (length <= 1e-8) throw new TypeError('preview light direction is zero')
  return [value[0] / length, value[1] / length, value[2] / length]
}
export interface PreviewLighting {
  readonly lights: readonly SceneRendererLight[]
  readonly ambient: Vec3
}
/** Own a bounded draw snapshot before any asynchronous renderer work. */
export function readPreviewLighting(
  lights: readonly SceneRendererLight[] | undefined,
  ambient?: Vec3,
): PreviewLighting | undefined {
  if (lights === undefined) {
    if (ambient !== undefined) throw new TypeError('ambientLight requires a lights array')
    return undefined
  }
  if (!Array.isArray(lights) || lights.length > 64)
    throw new RangeError('preview supports at most 64 lights')
  const ambientColor = vector(ambient ?? [0, 0, 0], 'ambient')
  if (ambientColor.some(x => x < 0 || x > 1))
    throw new RangeError('preview ambient must be in 0..1')
  return {
    ambient: ambientColor,
    lights: lights.map(light => {
      if (
        light === null ||
        typeof light !== 'object' ||
        !['directional', 'point', 'spot'].includes(light.type)
      )
        throw new TypeError('invalid preview light type')
      const direction = unit(vector(light.direction, 'direction')),
        color = vector(light.color, 'color')
      if (color.some(x => x < 0)) throw new RangeError('preview light color must be nonnegative')
      if (light.specularColor !== undefined && vector(light.specularColor, 'specularColor').some(x => x < 0))
        throw new RangeError('preview light specular color must be nonnegative')
      for (const key of ['affectsOpaque', 'affectsTransparent', 'useAmbientOcclusion'] as const)
        if (light[key] !== undefined && typeof light[key] !== 'boolean') throw new TypeError(`invalid preview light ${key}`)
      const position = light.position === undefined ? undefined : vector(light.position, 'position')
      if (light.type !== 'directional' && position === undefined)
        throw new TypeError('local preview light requires position')
      const values: {
        range?: number
        attenuationStart?: number
        attenuationEnd?: number
        decayExponent?: number
        innerConeAngle?: number
        outerConeAngle?: number
        coneExponent?: number
      } = {}
      for (const key of [
        'range',
        'attenuationStart',
        'attenuationEnd',
        'decayExponent',
        'innerConeAngle',
        'outerConeAngle',
        'coneExponent',
      ] as const) {
        const value = light[key]
        if (value === undefined) continue
        if (typeof value !== 'number' || value < 0 || !Number.isFinite(Math.fround(value)))
          throw new TypeError(`invalid preview light ${key}`)
        values[key] = Math.fround(value)
      }
      return {
        type: light.type,
        direction,
        color,
        ...(light.specularColor === undefined ? {} : { specularColor: vector(light.specularColor, 'specularColor') }),
        affectsOpaque: light.affectsOpaque ?? true, affectsTransparent: light.affectsTransparent ?? true,
        ...(light.useAmbientOcclusion === undefined ? {} : { useAmbientOcclusion: light.useAmbientOcclusion }),
        ...(position === undefined ? {} : { position }),
        ...values,
      }
    }),
  }
}

/** Spatial sample of an already admitted light. Caller owns validation and lifetime; no BRDF,
 * normal/color policy, normalization, light-count limit or preview floor is applied here. */
export function sampleLightGeometry(light: SceneRendererLight, position: Vec3): Readonly<{
  vector: Vec3
  distance: number
  attenuation: number
}> {
  const local = light.type !== 'directional' && light.position !== undefined
  const vector: Vec3 =
    local && light.position !== undefined
      ? [
          light.position[0] - position[0],
          light.position[1] - position[1],
          light.position[2] - position[2],
        ]
      : light.direction
  const distance = Math.hypot(...vector)
  let attenuation = 1
  if (local) {
    if (light.range !== undefined && light.range > 0 && distance > light.range) attenuation = 0
    else if (
      light.attenuationStart !== undefined &&
      light.attenuationEnd !== undefined &&
      light.attenuationEnd > light.attenuationStart
    ) {
      const fade =
        1 -
        clamp(
          (distance - light.attenuationStart) / (light.attenuationEnd - light.attenuationStart),
        )
      attenuation =
        light.decayExponent !== undefined && light.decayExponent > 0
          ? Math.pow(fade, light.decayExponent)
          : fade
    }
    if (
      light.type === 'spot' &&
      light.innerConeAngle !== undefined &&
      light.outerConeAngle !== undefined &&
      light.outerConeAngle > 0
    ) {
      const inner = Math.cos(
        Math.max(0, Math.min(light.innerConeAngle, light.outerConeAngle)) / 2,
      )
      const outer = Math.cos(Math.max(light.innerConeAngle, light.outerConeAngle) / 2)
      const cosine =
        distance > 0
          ? -(
              light.direction[0] * vector[0] +
              light.direction[1] * vector[1] +
              light.direction[2] * vector[2]
            ) / distance
          : 0
      const t = clamp((cosine - outer) / (inner - outer))
      attenuation *= inner <= outer + 1e-6 ? (cosine >= outer ? 1 : 0) : light.coneExponent === undefined ? t * t * (3 - 2 * t) : Math.pow(t, light.coneExponent)
    }
  }
  return { vector, distance, attenuation }
}

/** Pinned MK2 fixtureLightColor/lightAttenuation/lightConeAttenuation equations
 * (webgl-core commit 1a14ba4eddd0ae88de273348ebd44cfb98a0581d). GPU uses the same bounded
 * color/decay policy here: this corrects the old GPU omission of decay and unclamped light RGB. */
export function samplePreviewLighting(rig: PreviewLighting, normal: Vec3, position: Vec3): Vec3 {
  const nLength = Math.hypot(...normal),
    n: Vec3 =
      nLength > 0 ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength] : [0, 0, 1]
  const total = [0, 0, 0]
  for (const light of rig.lights) {
    const { vector, distance, attenuation } = sampleLightGeometry(light, position)
    const strength =
      (distance === 0
        ? 0.25
        : Math.max((n[0] * vector[0] + n[1] * vector[1] + n[2] * vector[2]) / distance, 0.25)) *
      attenuation
    for (const axis of [0, 1, 2] as const)
      total[axis] = (total[axis] ?? 0) + strength * clamp(light.color[axis])
  }
  const component = (axis: 0 | 1 | 2) =>
    clamp(rig.ambient[axis] + (total[axis] ?? 0) / Math.max(1, rig.lights.length))
  return [component(0), component(1), component(2)]
}

/** Shared spatial equations only; caller supplies its admitted fields and BRDF independently. */
export const LIGHT_GEOMETRY_GLSL = `
void sceneLightGeometry(int type, vec3 direction, vec3 lightPosition, vec4 f, vec3 cone,
  vec3 position, out vec3 v, out float d, out float attenuation) {
  bool local=type!=0;
  v=local?lightPosition-position:direction;
  d=length(v); attenuation=1.0;
  if(local) {
    if(f.x>0.0 && d>f.x) attenuation=0.0;
    else if(f.z>f.y) { float fade=1.0-clamp((d-f.y)/(f.z-f.y),0.0,1.0); attenuation=f.w>0.0?pow(fade,f.w):fade; }
    if(type==2 && cone.y>0.0 && cone.x>=0.0) {
      float inner=cos(max(0.0,min(cone.x,cone.y))*0.5), outer=cos(max(cone.x,cone.y)*0.5);
      float cosine=d>0.0?-dot(direction,v)/d:0.0;
      attenuation*=inner<=outer+0.000001?step(outer,cosine):cone.z>0.0?pow(clamp((cosine-outer)/(inner-outer),0.0,1.0),cone.z):smoothstep(outer,inner,cosine);
    }
  }
}`

/** The same preview policy in GLSL; uniform arrays retain their validated 64-light ceiling. */
export const PREVIEW_LIGHT_GLSL = `${LIGHT_GEOMETRY_GLSL}
uniform int previewLightingEnabled;
uniform int previewLightCount;
uniform vec3 previewAmbient;
uniform vec3 previewDirections[64];
uniform vec3 previewColors[64];
uniform vec3 previewPositions[64];
uniform int previewTypes[64];
uniform vec4 previewFades[64];
uniform vec3 previewCones[64];
vec3 previewLighting(vec3 normal, vec3 position) {
  vec3 total=vec3(0.0);
  float nl=length(normal); vec3 n=nl>0.0?normal/nl:vec3(0.0,0.0,1.0);
  for(int i=0;i<64;i++) {
    if(i>=previewLightCount) break;
    vec3 v; float d, attenuation;
    sceneLightGeometry(previewTypes[i],previewDirections[i],previewPositions[i],
      previewFades[i],previewCones[i],position,v,d,attenuation);
    float strength=(d==0.0?0.25:max(dot(n,v)/d,0.25))*attenuation;
    total+=strength*clamp(previewColors[i],0.0,1.0);
  }
  return clamp(previewAmbient+total/float(max(1,previewLightCount)),0.0,1.0);
}`

export function bindPreviewLighting(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  rig: PreviewLighting | undefined,
): void {
  gl.uniform1i(gl.getUniformLocation(program, 'previewLightingEnabled'), rig === undefined ? 0 : 1)
  gl.uniform1i(gl.getUniformLocation(program, 'previewLightCount'), rig?.lights.length ?? 0)
  gl.uniform3fv(gl.getUniformLocation(program, 'previewAmbient'), rig?.ambient ?? [0, 0, 0])
  for (const [index, light] of (rig?.lights ?? []).entries()) {
    const at = (name: string) => gl.getUniformLocation(program, `${name}[${index}]`)
    gl.uniform3fv(at('previewDirections'), light.direction)
    gl.uniform3fv(at('previewColors'), light.color)
    gl.uniform3fv(at('previewPositions'), light.position ?? [0, 0, 0])
    gl.uniform1i(
      at('previewTypes'),
      light.type === 'directional' ? 0 : light.type === 'point' ? 1 : 2,
    )
    const hasFade = light.attenuationStart !== undefined && light.attenuationEnd !== undefined
    gl.uniform4f(
      at('previewFades'),
      light.range ?? 0,
      hasFade ? (light.attenuationStart ?? 0) : 0,
      hasFade ? (light.attenuationEnd ?? 0) : 0,
      light.decayExponent ?? 0,
    )
    gl.uniform3f(at('previewCones'), light.innerConeAngle ?? -1, light.outerConeAngle ?? 0, light.coneExponent ?? 0)
    gl.uniform3fv(at('previewSpecularColors'), light.specularColor ?? light.color)
    gl.uniform2f(at('previewAffects'), light.affectsOpaque === false ? 0 : 1, light.affectsTransparent === false ? 0 : 1)
    gl.uniform1f(at('previewUsesAo'), light.useAmbientOcclusion === true ? 1 : 0)
  }
}
