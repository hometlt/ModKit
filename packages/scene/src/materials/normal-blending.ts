import type {
  StandardMaterialDefines,
  Vec3,
  Vec4,
} from '@modkit/codec-kit/model-math/standard-material-glsl'

/** Combine two detail normals by the sign of one mask sum, after each enters the shading frame. */
export interface NormalBlendPolicy {
  readonly mode: 'signed-two-detail'
  readonly secondMask: boolean
}

/** Columns mapping decoded tangent normals into the caller's shading frame. */
export interface MaterialNormalBasis {
  readonly tangent: Vec3
  readonly bitangent: Vec3
  readonly normal: Vec3
}

export const WORLD_NORMAL_VARYINGS =
  'in vec3 v_sceneWorldPosition, v_sceneWorldNormal, v_sceneWorldTangent, v_sceneWorldBitangent;'

/** Adapt the common primary-normal stage for an authored object-space map. The supplied transform
 * maps decoded texture axes into object axes; the draw's inverse-transpose then maps into world. */
export function objectSpaceNormalLayerShader(source: string): string {
  const main = source.indexOf('void main() {')
  const start = source.indexOf('  vec3 normal = ', main)
  const lineEnd = source.indexOf('\n', start)
  if (main < 0 || start < main || lineEnd < start)
    throw new TypeError('built-in material primary normal stage is absent')
  source =
    source.slice(0, lineEnd + 1) +
    '  normal = sceneObjectUnit(u_sceneWorldNormalMatrix * (u_normalMapTransform * normal));\n' +
    source.slice(lineEnd + 1)
  return source
    .replaceAll('dot(normal, v_lightDir)', 'dot(normal, u_sceneLightDirection)')
    .replaceAll('-dot(v_halfVec, normal)', '-dot(sceneObjectHalfVector(), normal)')
    .replace(
      'precision highp float;',
      `precision highp float;
uniform mat3 u_normalMapTransform, u_sceneWorldNormalMatrix;
uniform vec3 u_sceneLightDirection, u_sceneLightingEye, u_sceneLightingViewDirection;
uniform float u_sceneLightingOrthographic;
vec3 sceneObjectUnit(vec3 value){float size=length(value);return size>1e-9?value/size:vec3(0.0,0.0,1.0);}
vec3 sceneObjectHalfVector(){
  vec3 eye=u_sceneLightingOrthographic>0.5?u_sceneLightingViewDirection:sceneObjectUnit(u_sceneLightingEye-v_sceneWorldPosition);
  return -sceneObjectUnit(eye+u_sceneLightDirection);
}`,
    )
}

const unit = (v: Vec3, threshold = 1e-8): Vec3 => {
  const length = Math.hypot(...v)
  return length > threshold ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1]
}

/** Normalize after the complete interpolated basis transform, never its columns separately. */
export function normalInBasis(value: Vec3, basis?: MaterialNormalBasis): Vec3 {
  return unit(
    basis === undefined
      ? value
      : [
          basis.tangent[0] * value[0] + basis.bitangent[0] * value[1] + basis.normal[0] * value[2],
          basis.tangent[1] * value[0] + basis.bitangent[1] * value[1] + basis.normal[1] * value[2],
          basis.tangent[2] * value[0] + basis.bitangent[2] * value[1] + basis.normal[2] * value[2],
        ],
  )
}

export function blendSignedNormals(
  base: Vec3,
  first: Vec3,
  second: Vec3,
  maskSum: number,
  basis?: MaterialNormalBasis,
): Vec3 {
  const factor = Math.max(-1, Math.min(1, maskSum))
  const source = normalInBasis(base, basis)
  const detail = normalInBasis(factor < 0 ? first : second, basis)
  const weight = factor * factor
  // An almost antipodal blend has no stable float32 direction; do not amplify its rounding noise.
  return unit(
    [
      source[0] + (detail[0] - source[0]) * weight,
      source[1] + (detail[1] - source[1]) * weight,
      source[2] + (detail[2] - source[2]) * weight,
    ],
    1e-6,
  )
}

/** Scale before either dot product; opposite large terms must not become Infinity - Infinity. */
export function signedNormalFactor(
  first: Vec4,
  firstFactors: Vec4,
  second: Vec4,
  secondFactors: Vec4,
): number {
  const maskScale = Math.max(1, ...first.map(Math.abs), ...second.map(Math.abs))
  const factorScale = Math.max(1, ...firstFactors.map(Math.abs), ...secondFactors.map(Math.abs))
  const dot = (mask: Vec4, factors: Vec4) =>
    mask.reduce(
      (sum, value, index) => sum + (value / maskScale) * ((factors[index] ?? 0) / factorScale),
      0,
    )
  const value = dot(first, firstFactors) + dot(second, secondFactors)
  if (value === 0) return 0
  return Math.abs(value) >= 1 / factorScale / maskScale
    ? Math.sign(value)
    : value * factorScale * maskScale
}

/** Adapt only the known built-in normal stage; the frozen generator remains an immutable oracle. */
export function signedNormalLayerShader(
  source: string,
  defines: StandardMaterialDefines,
  policy: NormalBlendPolicy,
  perLayerFormats: boolean,
): string {
  const main = source.indexOf('void main() {')
  const start = source.indexOf('  vec3 normal = ', main)
  const end = source.indexOf('  vec3 color = vec3(0.0);', start)
  if (main < 0 || start < main || end < start)
    throw new TypeError('built-in material normal stage is absent')
  const decode = (slot: 'normal' | 'normalBlend1' | 'normalBlend2') => {
    const layer = defines.layers.find(layer => layer.slot === slot)
    if (layer === undefined) {
      if (slot !== 'normal') throw new TypeError('signed normal policy requires both detail layers')
      return 'vec3(0.0,0.0,1.0)'
    }
    const texel = layer.hasTexture ? `sampleLayerTexel_${slot}()` : `u_${slot}Color`
    return `${perLayerFormats ? `sceneDecode_${slot}` : 'decodeNormal'}(${texel})`
  }
  const mask = (slot: 'normalBlend1Mask' | 'normalBlend2Mask') =>
    defines.layers.some(layer => layer.slot === slot)
      ? `computeLayer_${slot}()`
      : 'vec4(1.0,0.0,0.0,0.0)'
  const stage = `  mat3 sceneBasis=mat3(v_sceneWorldTangent,v_sceneWorldBitangent,v_sceneWorldNormal);
  vec3 sceneBase=sceneSignedNormalUnit(sceneBasis*${decode('normal')});
  vec3 sceneFirst=sceneSignedNormalUnit(sceneBasis*${decode('normalBlend1')});
  vec3 sceneSecond=sceneSignedNormalUnit(sceneBasis*${decode('normalBlend2')});
  float sceneFactor=sceneSignedFactor(${mask('normalBlend1Mask')},u_normalBlend1Factors,${policy.secondMask ? `${mask('normalBlend2Mask')},u_normalBlend2Factors` : 'vec4(0.0),vec4(0.0)'});
  vec3 normal=sceneSignedUnit(mix(sceneBase,sceneFactor<0.0?sceneFirst:sceneSecond,sceneFactor*sceneFactor),1e-6);
`
  source = source.slice(0, start) + stage + source.slice(end)
  source = source
    .replaceAll('dot(normal, v_lightDir)', 'dot(normal, u_sceneLightDirection)')
    .replaceAll('-dot(v_halfVec, normal)', '-dot(sceneSignedHalfVector(), normal)')
  return source.replace(
    'precision highp float;',
    `precision highp float;
uniform vec3 u_sceneLightDirection, u_sceneLightingEye, u_sceneLightingViewDirection;
uniform float u_sceneLightingOrthographic;
vec3 sceneSignedUnit(vec3 value, float threshold) {
  float scale=max(max(abs(value.x),abs(value.y)),abs(value.z));
  if (scale==0.0) return vec3(0.0,0.0,1.0);
  vec3 scaled=value/scale;
  float magnitude=length(scaled);
  return scale>threshold/magnitude?scaled/magnitude:vec3(0.0,0.0,1.0);
}
float sceneSignedAbsMax(vec4 value) {
  return max(max(abs(value.x),abs(value.y)),max(abs(value.z),abs(value.w)));
}
float sceneSignedFactor(vec4 first,vec4 firstFactors,vec4 second,vec4 secondFactors) {
  float maskScale=max(1.0,max(sceneSignedAbsMax(first),sceneSignedAbsMax(second)));
  float factorScale=max(1.0,max(sceneSignedAbsMax(firstFactors),sceneSignedAbsMax(secondFactors)));
  float value=dot(first/maskScale,firstFactors/factorScale)+dot(second/maskScale,secondFactors/factorScale);
  if (value==0.0) return 0.0;
  return abs(value)>=(1.0/factorScale)/maskScale?sign(value):(value*factorScale)*maskScale;
}
vec3 sceneSignedNormalUnit(vec3 value) {
  return sceneSignedUnit(value,1e-8);
}
vec3 sceneSignedHalfVector() {
  vec3 eye=u_sceneLightingOrthographic>0.5?u_sceneLightingViewDirection:sceneSignedUnit(u_sceneLightingEye-v_sceneWorldPosition,1e-9);
  return -sceneSignedUnit(eye+u_sceneLightDirection,1e-9);
}`,
  )
}
