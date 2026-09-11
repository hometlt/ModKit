import type { StandardMaterialDefines } from '@modkit/codec-kit/model-math/standard-material-glsl'
import type { MaterialTextureBinding } from './standard-program.js'
import { isEnvironmentBinding } from './environment.js'

export class UnsupportedCubeCoordinatesError extends TypeError {}

/** Resolve nearest addressing before hardware cube-coordinate quantization. Sampling the chosen
 * texel center preserves a real cube image while matching the CPU's canonical face/texel rule. */
export function cubeNearestSamplerSource(name: string, uniform: string): string {
  return `vec4 ${name}(vec3 direction) {
  vec3 a=abs(direction);
  int face; vec2 uv;
  if(a.x>=a.y && a.x>=a.z) {
    face=direction.x>=0.0?0:1;
    uv=vec2(direction.x>=0.0?-direction.z:direction.z,-direction.y)/a.x;
  } else if(a.y>=a.z) {
    face=direction.y>=0.0?2:3;
    uv=vec2(direction.x,direction.y>=0.0?direction.z:-direction.z)/a.y;
  } else {
    face=direction.z>=0.0?4:5;
    uv=vec2(direction.z>=0.0?direction.x:-direction.x,-direction.y)/a.z;
  }
  vec2 size=vec2(textureSize(${uniform},0));
  vec2 pixel=clamp(floor((uv+1.0)*0.5*size),vec2(0.0),size-1.0);
  vec2 centered=(pixel+0.5)/size*2.0-1.0;
  vec3 sampleDirection;
  if(face==0) sampleDirection=vec3(1.0,-centered.y,-centered.x);
  else if(face==1) sampleDirection=vec3(-1.0,-centered.y,centered.x);
  else if(face==2) sampleDirection=vec3(centered.x,1.0,centered.y);
  else if(face==3) sampleDirection=vec3(centered.x,-1.0,-centered.y);
  else if(face==4) sampleDirection=vec3(centered.x,-centered.y,1.0);
  else sampleDirection=vec3(-centered.x,-centered.y,-1.0);
  return texture(${uniform},sampleDirection);
}`
}

/** Only validated, built-in layer sampling functions are rewritten, never caller-provided GLSL. */
export function cubeLayerShader(
  source: string,
  defines: StandardMaterialDefines,
  bindings: readonly MaterialTextureBinding[],
  worldEnvironment = false,
  worldNormalReady = false,
): string {
  if (worldEnvironment) {
    const marker = '  vec3 color = vec3(0.0);'
    if (!source.includes(marker)) throw new TypeError('built-in material normal stage is absent')
    const blend = '  return normalize(mix(baseNormal, detailNormal, clamp(amount, 0.0, 1.0)));'
    if (!source.includes(blend)) throw new TypeError('built-in material normal blend is absent')
    source = source.replace(
      blend,
      `  vec3 mixed=mix(baseNormal,detailNormal,clamp(amount,0.0,1.0));
  float magnitude=length(mixed);
  return magnitude>1e-8?mixed/magnitude:vec3(0.0,0.0,1.0);`,
    )
    source = source.replace(
      'precision highp float;',
      `precision highp float;
uniform vec4 u_sceneEnvironment0, u_sceneEnvironment1, u_sceneEnvironment2;
uniform vec3 u_sceneEyePosition;
vec3 g_sceneEnvironmentNormal;
vec3 sceneEnvironmentUnit(vec3 value) {
  float magnitude=length(value);
  return magnitude>1e-9?value/magnitude:vec3(0.0,0.0,1.0);
}
vec3 sceneEnvironmentVector(vec3 value) {
  vec4 v=vec4(value,1.0);
  return vec3(dot(u_sceneEnvironment0,v),dot(u_sceneEnvironment1,v),dot(u_sceneEnvironment2,v));
}
vec3 sceneEnvironmentCubeDirection(vec3 value) {
  return all(equal(value,vec3(0.0)))?vec3(0.0,0.0,1.0):value;
}
vec3 sceneEnvironmentDirection(bool reflected) {
  vec3 n=sceneEnvironmentVector(g_sceneEnvironmentNormal);
  if(!reflected) return sceneEnvironmentCubeDirection(n);
  vec3 v=sceneEnvironmentVector(sceneEnvironmentUnit(v_sceneWorldPosition-u_sceneEyePosition));
  return sceneEnvironmentCubeDirection(v-2.0*dot(v,n)*n);
}`,
    )
    source = source.replace(
      marker,
      `  g_sceneEnvironmentNormal=${worldNormalReady ? 'normal' : 'sceneEnvironmentUnit(mat3(v_sceneWorldTangent,v_sceneWorldBitangent,v_sceneWorldNormal)*normal)'};
${marker}`,
    )
  }
  for (const binding of bindings) {
    if (binding.dimension !== 'cube') continue
    const layer = defines.layers.find(layer => layer.slot === binding.slot)
    if (layer === undefined || (layer.uvSource !== 2 && layer.uvSource !== 7))
      throw new UnsupportedCubeCoordinatesError(
        `${binding.slot}: a cube image requires reflection or normal-direction coordinates`,
      )
    const pattern = new RegExp(`vec4 sampleLayerTexel_${binding.slot}\\(\\) \\{[^}]*\\}`)
    if (!pattern.test(source)) throw new TypeError('built-in cube sampler function is absent')
    source = source.replace(
      `uniform sampler2D ${binding.uniform};`,
      `uniform highp samplerCube ${binding.uniform};`,
    )
    const direction =
      worldEnvironment && isEnvironmentBinding(binding)
        ? `sceneEnvironmentDirection(${layer.uvSource === 2 ? 'true' : 'false'})`
        : layer.uvSource === 2
          ? 'reflectionDirection()'
          : 'normalize(v_viewNormal)'
    source = source.replace(
      pattern,
      `vec4 sampleLayerTexel_${binding.slot}() { return texture(${binding.uniform}, ${direction}); }`,
    )
  }
  return source
}
