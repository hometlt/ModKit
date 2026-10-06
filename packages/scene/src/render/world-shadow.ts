/**
 * The world's directional shadow, one formula for every surface that receives it: the world's own
 * batches (`world/webgl.ts`, its fragment shader's `directionalShadow`) and the material programs the
 * world draws (`render/material-webgl.ts`, the `sceneLighting` key light).
 *
 * The key light's depth map is read with a 3x3 percentage-closer filter and a bias that grows as the
 * surface turns from the light; SC2 draws shadows only within its camera's ShadowClip of the eye, so
 * the shadow fades out over the last tenth of that reach. A position outside the map's frustum is lit.
 *
 * Owner: scene (world rendering). The depth map, its view-projection and the reach come from the
 * world renderer's shadow pass; nothing here knows a game.
 */

/**
 * `modkitWorldShadow(map, position, world, lightCosine, texelSize, rangeEye, rangeDistance)`: the
 * lit share (0..1) of a surface point. `position` is the point in the depth map's clip space,
 * `world` the point itself (for the reach), `lightCosine` the surface's cosine to the key light
 * clamped to 0 (the slope of the bias), `rangeDistance` 0 for no reach limit.
 */
export const WORLD_SHADOW_GLSL = `float modkitWorldShadow(sampler2D map, vec4 position, vec3 world, float lightCosine, vec2 texelSize, vec3 rangeEye, float rangeDistance) {
  if (position.w <= 0.0) return 1.0;
  vec3 projected = position.xyz / position.w * 0.5 + 0.5;
  if (
    projected.x <= 0.0 || projected.x >= 1.0 ||
    projected.y <= 0.0 || projected.y >= 1.0 ||
    projected.z <= 0.0 || projected.z >= 1.0
  ) return 1.0;
  // SC2 draws shadows only within its camera's ShadowClip of the eye: fade over the last tenth.
  float reach = rangeDistance > 0.0
    ? distance(world, rangeEye) / rangeDistance
    : 0.0;
  if (reach >= 1.0) return 1.0;
  float slope = 1.0 - lightCosine;
  float bias = max(0.00035, 0.0015 * slope);
  float visible = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float closest = texture(
        map,
        projected.xy + vec2(float(x), float(y)) * texelSize
      ).r;
      visible += projected.z - bias <= closest ? 1.0 : 0.0;
    }
  }
  return mix(visible / 9.0, 1.0, smoothstep(0.9, 1.0, reach));
}`

/**
 * The world's shadow as a material program receives it (`MaterialSceneLight.shadow`): the key
 * light's depth texture, its view-projection, one texel of it, and the reach around the eye
 * (distance 0: none).
 */
export interface WorldShadowReceiver {
  readonly texture: WebGLTexture
  readonly viewProjection: Float32Array
  readonly texelSize: readonly [number, number]
  readonly rangeEye: readonly [number, number, number]
  readonly rangeDistance: number
}
