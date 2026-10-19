/**
 * [MK] Core CPU scene rasterizer: material programs and base/PBR draws, alpha/depth, texture
 * filtering, terrain splats and opaque-scene-depth water. Programs use the legacy light or the
 * admitted material-space directional/local lights; the base route retains the preview-light rig.
 * Shadows, water wave normals and caustics require the GPU renderer.
 */
import { readSimpleEffectColors } from './effect-colors.js'
import {
  readPreviewLighting,
  samplePreviewLighting,
  type PreviewLighting,
} from './preview-lighting.js'
import {
  bindSimpleEffectTexture,
  readSimpleEffect,
  blendSimpleEffectPixel,
  sampleScreenEffectUv,
  type SimpleEffectState,
} from './simple-effect.js'
import { sampleMaterialTexture } from './materials.js'
import {
  applyDrawTeamColor,
  drawTeamColor,
  teamMaskTexture,
  type DrawTeamColor,
} from './team-color.js'
import { drawPbr, perturbedNormal, shadeDrawPbr, type DrawPbr } from './pbr-material.js'
import { headlessDepthBias, type SceneDepthBias } from './depth-bias.js'
import type {
  SceneRenderRequest,
  SceneRenderFrame,
  SceneRenderer,
  SceneRendererTexture,
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererPrimitive,
  SceneRendererDirectionalLight,
  SceneRendererDiagnostic,
  SceneRendererScene,
} from '@modkit/sdk/renderer'
import { materialAlpha, straightenAlpha, type MaterialAlpha } from './alpha.js'
import { prepareSceneMaterialPrograms, type SceneMaterialPrograms } from './materials.js'
import {
  sceneMaterialDraws,
  blendMaterialPixel,
  materialIsSolid,
  materialIsTerrainOverlay,
  type MaterialDraw,
} from './material-draws.js'
import {
  materialGeometry,
  materialMirrors,
  materialModelMatrix,
  type MaterialVertex,
} from './material-geometry.js'
import { shadeMaterial, interpolateMaterialVertex } from './material-sampling.js'
import { sceneTextureBytes } from '../textures/cube.js'
import { sceneTexturePixels } from './compressed-textures.js'
import { invertMaterialFrame } from '../materials/frame.js'
import { waterDepthColor } from './water-color.js'
import { requiresEnvironmentEye, snapshotEyePosition } from '../materials/environment.js'
import type { WorldWebGlSplatBatch } from '../world/webgl.js'
import { checkedWorldVisibilityBounds, worldPointVisible, type WorldVisibilityBounds } from '../world/world-visibility.js'
type Vec3 = readonly [number, number, number]
type Vec4 = readonly [number, number, number, number]
type Triangle<T> = readonly [T, T, T]
interface Vertex {
  x: number
  y: number
  z: number
  invW: number
  world: Vec3
}
interface Light {
  direction: Vec3
  ambient: number
  color: Vec4
}
interface Surface {
  simpleEffect?: SimpleEffectState
  baseColor: Vec4
  alpha: MaterialAlpha
  shading: 'unlit' | 'lambert' | 'pbr'
  texture?: SceneRendererTexture
  /** glTF metallic-roughness of a `pbr` material. */
  pbr?: DrawPbr
  teamColor?: DrawTeamColor
  /** The team colour's mask texture; absent for a `whole` team colour. */
  teamMask?: SceneRendererTexture
}
interface RasterContext {
  visibilityBounds?: WorldVisibilityBounds | undefined
  water?: ReadonlyMap<string, number>
  inverseViewProjection?: Float32Array
  opaqueDepth?: Float32Array
  width: number
  height: number
  frame: Uint8Array | Float32Array
  depth: Float32Array
  viewProjection: Float32Array
  materials: Map<string, Surface>
  light: Light | undefined
  previewLighting: PreviewLighting | undefined
  /** The camera's world position, for the view direction of `pbr` specular light. */
  eye: Vec3 | undefined
  diagnostics: SceneRendererDiagnostic[]
  triangles: number
  fragments: number
  signal: AbortSignal | undefined
  splats?: ReadonlyMap<string, Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>>
}
import { SCENE_RENDERER_CONTRACT } from '@modkit/sdk/renderer'

const RENDERER_ID = 'modkit.headless'
const DEFAULT_COLOR: Vec4 = Object.freeze([0.78, 0.8, 0.84, 1])
const DEFAULT_CLEAR_COLOR: Vec4 = Object.freeze([0, 0, 0, 0])
const MAX_DIMENSION = 4_096
const MAX_PIXELS = 16_777_216

const recordOf = <T extends object>(value: T): T | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined

const nonEmptyString = (value: unknown) => typeof value === 'string' && value.trim().length > 0

function dimension(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DIMENSION) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${MAX_DIMENSION}`)
  }
  return value
}

function matrix(value: Float32Array, label: string) {
  if (!(value instanceof Float32Array) || value.length !== 16 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must be a finite 4x4 Float32Array`)
  }
  return value
}

function color(value: Vec4, label: string): Vec4 {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(component =>
      typeof component === 'number' && Number.isFinite(component)
        ? component >= 0 && component <= 1
        : false,
    )
  ) {
    throw new TypeError(`${label} must contain four finite components in the range 0..1`)
  }
  return value
}

const byte = (value: number) => Math.round(value * 255)

function clearFrame(rgba: Uint8Array | Float32Array, clearColor: Vec4) {
  const red = byte(clearColor[0] * clearColor[3])
  const green = byte(clearColor[1] * clearColor[3])
  const blue = byte(clearColor[2] * clearColor[3])
  const alpha = byte(clearColor[3])
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = red
    rgba[offset + 1] = green
    rgba[offset + 2] = blue
    rgba[offset + 3] = alpha
  }
}

function multiplyPoint(transform: Float32Array, x: number, y: number, z: number, w: number): Vec4 {
  return [
    (transform[0] as number) * x +
      (transform[4] as number) * y +
      (transform[8] as number) * z +
      (transform[12] as number) * w,
    (transform[1] as number) * x +
      (transform[5] as number) * y +
      (transform[9] as number) * z +
      (transform[13] as number) * w,
    (transform[2] as number) * x +
      (transform[6] as number) * y +
      (transform[10] as number) * z +
      (transform[14] as number) * w,
    (transform[3] as number) * x +
      (transform[7] as number) * y +
      (transform[11] as number) * z +
      (transform[15] as number) * w,
  ]
}

interface ClipVertex {
  readonly clip: Vec4
  readonly world: Vec3
  /** Coordinates in the original triangle, including after frustum clipping. */
  readonly weights: Vec3
}

function clipVertex(
  positions: Float32Array,
  index: number,
  model: Float32Array | undefined,
  viewProjection: Float32Array,
  weights: Vec3,
): ClipVertex | undefined {
  const offset = index * 3
  const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2]
  if (x === undefined || y === undefined || z === undefined) return undefined
  const world: Vec4 = model === undefined ? [x, y, z, 1] : multiplyPoint(model, x, y, z, 1)
  const clip = multiplyPoint(viewProjection, world[0], world[1], world[2], world[3])
  if (!clip.every(Number.isFinite)) return undefined
  return { clip, world: [world[0], world[1], world[2]], weights }
}

function weightedVector<T extends readonly number[]>(values: Triangle<T>, weights: Vec3): T {
  return values[0].map((_, i) => values[0][i]! * weights[0] +
    values[1][i]! * weights[1] + values[2][i]! * weights[2]) as unknown as T
}

function screenClipVertex(clip: Vec4, world: Vec3, width: number, height: number): Vertex {
  return { x: (clip[0] / clip[3] * 0.5 + 0.5) * width,
    y: (0.5 - clip[1] / clip[3] * 0.5) * height, z: clip[2] / clip[3],
    invW: 1 / clip[3], world }
}

const edge = (a: Vertex, b: Vertex, x: number, y: number) =>
  (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)

/** Model-space direction transformed by the upper 3x3 of a column-major model matrix. */
function transformDirection(
  model: Float32Array | undefined,
  x: number,
  y: number,
  z: number,
): Vec3 {
  if (model === undefined) return [x, y, z]
  return [
    (model[0] as number) * x + (model[4] as number) * y + (model[8] as number) * z,
    (model[1] as number) * x + (model[5] as number) * y + (model[9] as number) * z,
    (model[2] as number) * x + (model[6] as number) * y + (model[10] as number) * z,
  ]
}

function normalize(vector: Vec3): Vec3 | undefined {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return length < 1e-9 ? undefined : [vector[0] / length, vector[1] / length, vector[2] / length]
}

/** Geometric normal of a world-space triangle, for geometry that publishes no normals. */
function faceNormal(first: Vertex, second: Vertex, third: Vertex) {
  const ax = second.world[0] - first.world[0]
  const ay = second.world[1] - first.world[1]
  const az = second.world[2] - first.world[2]
  const bx = third.world[0] - first.world[0]
  const by = third.world[1] - first.world[1]
  const bz = third.world[2] - first.world[2]
  return normalize([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx])
}

/**
 * Lambert term for one surface normal.
 *
 * Two-sided on purpose: game meshes are full of triangles whose winding does not agree with their
 * intended facing, and a one-sided term would render half of a real model black. `abs` costs the
 * ability to distinguish inside from outside, which this renderer never had anyway.
 */
/** Consistent legacy precedence, otherwise the modern rig's ambient and primary directional. */
function sceneLightColors(light: Light | undefined, rig: PreviewLighting | undefined) {
  if (light !== undefined)
    return {
      ambientColor: [light.ambient, light.ambient, light.ambient] as Vec3,
      lightColor: [light.color[0], light.color[1], light.color[2]] as Vec3,
    }
  if (rig === undefined) return undefined
  return {
    ambientColor: rig.ambient,
    lightColor: rig.lights.find(item => item.type === 'directional')?.color ?? ([0, 0, 0] as Vec3),
  }
}

function lambert(normal: Vec3, light: Light) {
  const cosine = Math.abs(
    normal[0] * light.direction[0] +
      normal[1] * light.direction[1] +
      normal[2] * light.direction[2],
  )
  return Math.min(1, light.ambient + (1 - light.ambient) * cosine)
}

/** Sample in top-left-origin UV space with the same filter as material programs. */
function sampleTexture(texture: SceneRendererTexture, u: number, v: number): Vec4 {
  return sampleMaterialTexture(
    texture,
    Number.isFinite(u) ? u : 0.5 / texture.width,
    Number.isFinite(v) ? v : 0.5 / texture.height,
    texture.wrapU ?? 'repeat',
    texture.wrapV ?? 'repeat',
  )
}

/** The world plan's splat varying values at one fragment; weights are normalized per draw. */
function sampleSplat(
  splat: Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>,
  indices: Triangle<number>,
  weights: Triangle<number>,
): Readonly<{ color: Vec3; coverage: number }> | undefined {
  const { batch } = splat
  const varying = (buffer: Float32Array, components: number, component: number) =>
    weights[0] * (buffer[indices[0] * components + component] ?? 0) +
    weights[1] * (buffer[indices[1] * components + component] ?? 0) +
    weights[2] * (buffer[indices[2] * components + component] ?? 0)
  const uv = (buffer: Float32Array): readonly [number, number] => [
    varying(buffer, 2, 0), varying(buffer, 2, 1),
  ]
  if (batch.maskTexture !== undefined && batch.maskTextureCoordinates !== undefined) {
    const mask = sampleTexture(batch.maskTexture, ...uv(batch.maskTextureCoordinates))
    if (mask[Math.max(0, Math.min(3, batch.maskChannel ?? 3))]! >= 0.5) return undefined
  }
  const layerWeights: number[] = []
  const raster = batch.weightTextures !== undefined && batch.weightTextureCoordinates !== undefined
  if (raster) {
    const coordinates = uv(batch.weightTextureCoordinates)
    for (const texture of batch.weightTextures) layerWeights.push(...sampleTexture(texture, ...coordinates))
  } else {
    for (let layer = 0; layer < batch.textures.length; layer += 1) {
      const buffer = layer < 4 ? batch.textureWeights0 : batch.textureWeights1
      layerWeights.push(varying(buffer, 4, layer % 4))
    }
  }
  let coverage = 0
  for (let layer = 0; layer < batch.textures.length; layer += 1) coverage += layerWeights[layer] ?? 0
  if (coverage <= 0) {
    if (splat.overlay) return { color: [0, 0, 0], coverage: 0 }
    // The WebGL weight-map path chooses layer zero for an empty texel.
    if (!raster) return { color: [0, 0, 0], coverage: 1 }
    layerWeights[0] = coverage = 1
  }
  const mixed = [0, 0, 0]
  for (const [layer, texture] of batch.textures.entries()) {
    const share = (layerWeights[layer] ?? 0) / coverage
    if (share <= 0) continue
    const texel = sampleTexture(texture, ...uv(batch.textureCoordinates[layer]!))
    const tint = batch.layerColors?.[layer] ?? [1, 1, 1]
    for (const channel of [0, 1, 2] as const)
      mixed[channel] = (mixed[channel] ?? 0) + texel[channel] * tint[channel] * share
  }
  return { color: mixed as unknown as Vec3, coverage: splat.overlay ? Math.min(1, coverage) : 1 }
}

function rasterizeTriangle(
  context: RasterContext,
  vertices: Triangle<Vertex>,
  surface: Surface,
  uvs: Triangle<readonly [number, number]> | undefined,
  normals: Triangle<Vec3> | undefined,
  materialDraw?: {
    readonly draw: MaterialDraw
    readonly vertices: Triangle<MaterialVertex>
    /** The triangle's vertex tint (`vertexTints`), flat as WebGL takes it. */
    readonly vertexTint?: readonly [number, number, number, number]
  },
  depthBias?: SceneDepthBias,
  colors?: Triangle<Vec4>,
  tint: readonly [number, number, number, number] = [1, 1, 1, 1],
  /** The model matrix mirrors (negative determinant): front faces wind clockwise (glTF). */
  mirrored = false,
  /** The primitive's TANGENT at the corners (world xyz, handedness w), for a normal map. */
  tangents?: Triangle<Vec4>,
  splat?: Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean; indices: Triangle<number>; sourceWeights?: Triangle<Vec3> }>,
  waterFalloff?: number,
) {
  const [first, second, third] = vertices
  const effect = surface.simpleEffect
  const primitiveColor =
    materialDraw === undefined ? undefined : primitiveTint(materialDraw.draw.primitive)
  const vertexTint = materialDraw?.vertexTint
  const materialTint =
    primitiveColor === undefined || vertexTint === undefined
      ? primitiveColor
      : (primitiveColor.map((value, channel) => value * vertexTint[channel]!) as [
          number,
          number,
          number,
          number,
        ])
  const polygonOffset = headlessDepthBias(
    vertices,
    depthBias ?? materialDraw?.draw.primitive.depthBias,
  )
  const area = edge(first, second, third.x, third.y)
  if (!Number.isFinite(area) || Math.abs(area) < 0.000_001) return 0
  if (
    (materialDraw?.draw.program?.twoSided === false || effect?.doubleSided === false) &&
    area < 0 !== mirrored
  )
    return 0
  // A shared edge belongs to one triangle. Without a half-open coverage rule, alpha doubles
  // along the diagonal of a triangulated quad. Account for either authored winding.
  const inclusive = (a: Vertex, b: Vertex) =>
    area < 0 ? b.y < a.y || (b.y === a.y && b.x > a.x) : b.y > a.y || (b.y === a.y && b.x < a.x)
  const edges = [inclusive(second, third), inclusive(third, first), inclusive(first, second)]
  const minimumX = Math.max(0, Math.floor(Math.min(first.x, second.x, third.x)))
  const maximumX = Math.min(context.width - 1, Math.ceil(Math.max(first.x, second.x, third.x)))
  const minimumY = Math.max(0, Math.floor(Math.min(first.y, second.y, third.y)))
  const maximumY = Math.min(context.height - 1, Math.ceil(Math.max(first.y, second.y, third.y)))
  const base = surface.baseColor
  const light = context.light
  const shaded =
    (light !== undefined || context.previewLighting !== undefined) &&
    surface.shading === 'lambert' &&
    effect === undefined
  /*
   * Per-vertex normals when the primitive published them, one face normal otherwise. Computed once
   * per triangle rather than per fragment: a flat-shaded triangle needs one, and a smooth-shaded
   * one needs the three it already has.
   */
  // a `pbr` material under the scene light: the one glTF BRDF (codec-kit model-math/pbr)
  const pbr = light !== undefined && effect === undefined ? surface.pbr : undefined
  // a normal map without TANGENT: the triangle's dP/du, as glTF viewers derive it from the UVs
  const triangleTangent: Vec3 | undefined = (() => {
    if (pbr?.normal === undefined || tangents !== undefined || uvs === undefined) return undefined
    const e1 = [0, 1, 2].map(axis => second.world[axis]! - first.world[axis]!)
    const e2 = [0, 1, 2].map(axis => third.world[axis]! - first.world[axis]!)
    const du1 = uvs[1][0] - uvs[0][0],
      dv1 = uvs[1][1] - uvs[0][1],
      du2 = uvs[2][0] - uvs[0][0],
      dv2 = uvs[2][1] - uvs[0][1]
    const determinant = du1 * dv2 - du2 * dv1
    if (Math.abs(determinant) < 1e-12) return undefined
    return [0, 1, 2].map(
      axis => (dv2 * e1[axis]! - dv1 * e2[axis]!) / determinant,
    ) as unknown as Vec3
  })()
  const flatNormal =
    (shaded || pbr !== undefined) && normals === undefined
      ? faceNormal(first, second, third)
      : undefined
  const flatShade = flatNormal === undefined || light === undefined ? 1 : lambert(flatNormal, light)
  let fragments = 0
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const sampleX = x + 0.5
      const sampleY = y + 0.5
      const firstWeight = edge(second, third, sampleX, sampleY) / area
      const secondWeight = edge(third, first, sampleX, sampleY) / area
      const thirdWeight = edge(first, second, sampleX, sampleY) / area
      if (firstWeight < 0 || secondWeight < 0 || thirdWeight < 0) continue
      if (
        (firstWeight === 0 && !edges[0]) ||
        (secondWeight === 0 && !edges[1]) ||
        (thirdWeight === 0 && !edges[2])
      )
        continue
      const rawDepth = firstWeight * first.z + secondWeight * second.z + thirdWeight * third.z
      const sampleDepth = Math.fround(
        polygonOffset === 0 ? rawDepth : Math.max(-1, Math.min(1, rawDepth + polygonOffset)),
      )
      const pixel = y * context.width + x
      if (effect?.depthTest !== false && sampleDepth > (context.depth[pixel] as number)) continue
      if (context.visibilityBounds !== undefined) {
        const p = multiplyPoint(context.inverseViewProjection!, (sampleX / context.width) * 2 - 1,
          1 - (sampleY / context.height) * 2, rawDepth, 1)
        if (!worldPointVisible(context.visibilityBounds, [p[0] / p[3], p[1] / p[3], p[2] / p[3]])) continue
      }
      if (materialDraw !== undefined) {
        const { draw, vertices: attributes } = materialDraw
        if (draw.program === undefined || draw.material === undefined)
          throw new TypeError('missing material draw program')
        const weights: Triangle<number> = [
          firstWeight * first.invW,
          secondWeight * second.invW,
          thirdWeight * third.invW,
        ]
        const sum = weights[0] + weights[1] + weights[2]
        if (sum <= 1e-9) continue
        const fragment = interpolateMaterialVertex(attributes, [
          weights[0] / sum,
          weights[1] / sum,
          weights[2] / sum,
        ])
        const shaded = shadeMaterial(
          draw.program,
          draw.material.textures,
          fragment,
          sceneLightColors(context.light, context.previewLighting),
          context.light === undefined && context.previewLighting?.lights.some(light => light.type !== 'directional')
            ? context.previewLighting : undefined,
        )
        if (!shaded.alphaTestPassed) continue
        if (draw.depthOnly || materialIsSolid(draw.program)) context.depth[pixel] = sampleDepth
        if (!draw.depthOnly) {
          const multiplier = materialTint ?? [1, 1, 1, 1]
          // The GPU's modAlpha pass attenuates additive RGB by instance fade before blending.
          const rgbFade = draw.program.defines.modAlpha === true ? multiplier[3] : 1
          blendMaterialPixel(
            context.frame,
            pixel * 4,
            [
              shaded.rgba[0] * multiplier[0] * rgbFade,
              shaded.rgba[1] * multiplier[1] * rgbFade,
              shaded.rgba[2] * multiplier[2] * rgbFade,
              shaded.rgba[3] * multiplier[3],
            ],
            draw.program,
            multiplier[3],
          )
        }
        fragments++
        continue
      }
      let alpha = Math.fround(base[3])
      let red = base[0]
      let green = base[1]
      let blue = base[2]
      if (colors !== undefined) {
        const a = firstWeight * first.invW,
          b = secondWeight * second.invW,
          c = thirdWeight * third.invW,
          sum = a + b + c
        if (sum <= 1e-9) continue
        red *= (a * colors[0][0] + b * colors[1][0] + c * colors[2][0]) / sum
        green *= (a * colors[0][1] + b * colors[1][1] + c * colors[2][1]) / sum
        blue *= (a * colors[0][2] + b * colors[1][2] + c * colors[2][2]) / sum
        alpha = Math.fround(
          alpha * ((a * colors[0][3] + b * colors[1][3] + c * colors[2][3]) / sum),
        )
      }
      const splatWeights: Triangle<number> | undefined =
        splat === undefined
          ? undefined
          : (() => {
              const perspective = [
                firstWeight * first.invW,
                secondWeight * second.invW,
                thirdWeight * third.invW,
              ] as const
              const sum = perspective[0] + perspective[1] + perspective[2]
              return sum <= 1e-9
                ? undefined
                : (perspective.map(value => value / sum) as unknown as Triangle<number>)
            })()
      if (splat !== undefined) {
        if (splatWeights === undefined) continue
        const sampled = sampleSplat(splat, splat.indices, splat.sourceWeights === undefined
          ? splatWeights : weightedVector(splat.sourceWeights, splatWeights))
        if (sampled === undefined || sampled.coverage <= 0) continue
        red *= sampled.color[0]
        green *= sampled.color[1]
        blue *= sampled.color[2]
        // Terrain diffuse alpha is specular data; only an overlay raster's weight is coverage.
        alpha = sampled.coverage
      }
      if (
        waterFalloff !== undefined &&
        context.inverseViewProjection !== undefined &&
        context.opaqueDepth !== undefined
      ) {
        const sceneDepth = context.opaqueDepth[pixel]!
        const bottom = multiplyPoint(
          context.inverseViewProjection,
          (sampleX / context.width) * 2 - 1,
          1 - (sampleY / context.height) * 2,
          sceneDepth,
          1,
        )
        // Clear depth is open water, not a fabricated sea-floor height.
        const waterDepth =
          !Number.isFinite(sceneDepth) || Math.abs(bottom[3]) < 1e-9
            ? Number.POSITIVE_INFINITY
            : first.world[1] - bottom[1] / bottom[3]
        if (waterDepth <= 0) continue
        const shadedWater = waterDepthColor([red, green, blue, alpha], waterDepth, waterFalloff)
        ;[red, green, blue, alpha] = shadedWater
      }
      let maskTexel: Vec4 | undefined
      let pbrTexels: {
        metallicRoughness?: Vec4
        occlusion?: Vec4
        emissive?: Vec4
        normal?: Vec4
      } = {}
      if (
        (surface.texture !== undefined ||
          surface.teamMask !== undefined ||
          pbr?.metallicRoughness !== undefined ||
          pbr?.occlusion !== undefined ||
          pbr?.emissiveTexture !== undefined ||
          pbr?.normal !== undefined) &&
        (uvs !== undefined || effect?.screenUv !== undefined)
      ) {
        // perspective-correct: interpolate attribute/w and 1/w, then divide
        const invW =
          firstWeight * first.invW + secondWeight * second.invW + thirdWeight * third.invW
        if (invW > 1e-9) {
          let u =
            uvs === undefined
              ? 0
              : (firstWeight * uvs[0][0] * first.invW +
                  secondWeight * uvs[1][0] * second.invW +
                  thirdWeight * uvs[2][0] * third.invW) /
                invW
          let v =
            uvs === undefined
              ? 0
              : (firstWeight * uvs[0][1] * first.invW +
                  secondWeight * uvs[1][1] * second.invW +
                  thirdWeight * uvs[2][1] * third.invW) /
                invW
          if (effect?.screenUv !== undefined) {
            // Raster rows are top-down, unlike the pinned GLSL gl_FragCoord origin.
            const screen = sampleScreenEffectUv(
              effect.screenUv,
              sampleX,
              context.height - sampleY,
              context.width,
              context.height,
            )
            if (screen !== undefined) [u, v] = screen
          }
          if (surface.texture !== undefined) {
            const texel =
              effect === undefined
                ? sampleTexture(surface.texture, u, v)
                : sampleMaterialTexture(surface.texture, u, v, effect.wrapU, effect.wrapV)
            red *= texel[0]
            green *= texel[1]
            blue *= texel[2]
            alpha = Math.fround(alpha * Math.fround(texel[3]))
          }
          if (surface.teamMask !== undefined) maskTexel = sampleTexture(surface.teamMask, u, v)
          if (pbr !== undefined)
            pbrTexels = {
              ...(pbr.metallicRoughness === undefined
                ? {}
                : { metallicRoughness: sampleTexture(pbr.metallicRoughness, u, v) }),
              ...(pbr.occlusion === undefined
                ? {}
                : { occlusion: sampleTexture(pbr.occlusion, u, v) }),
              ...(pbr.emissiveTexture === undefined
                ? {}
                : { emissive: sampleTexture(pbr.emissiveTexture, u, v) }),
              ...(pbr.normal === undefined ? {} : { normal: sampleTexture(pbr.normal, u, v) }),
            }
        }
      }
      // the team colour tints the albedo, before light: a mask texel weighs it, `whole` is 1
      if (
        surface.teamColor !== undefined &&
        (surface.teamMask === undefined || maskTexel !== undefined)
      )
        [red, green, blue] = applyDrawTeamColor(surface.teamColor, [red, green, blue], maskTexel)
      if (pbr !== undefined && light !== undefined) {
        const a = firstWeight * first.invW,
          b = secondWeight * second.invW,
          c = thirdWeight * third.invW
        const sum = a + b + c
        if (sum <= 1e-9) continue
        const at = (values: Triangle<Vec3>): Vec3 => [
          (a * values[0][0] + b * values[1][0] + c * values[2][0]) / sum,
          (a * values[0][1] + b * values[1][1] + c * values[2][1]) / sum,
          (a * values[0][2] + b * values[1][2] + c * values[2][2]) / sum,
        ]
        const smooth = (normals === undefined ? flatNormal : normalize(at(normals))) ?? [0, 0, 1]
        const tangent =
          tangents === undefined
            ? triangleTangent
            : at([
                [tangents[0][0], tangents[0][1], tangents[0][2]],
                [tangents[1][0], tangents[1][1], tangents[1][2]],
                [tangents[2][0], tangents[2][1], tangents[2][2]],
              ])
        const normal =
          pbrTexels.normal === undefined || tangent === undefined
            ? smooth
            : perturbedNormal(
                smooth,
                tangent,
                tangents?.[0][3] ?? 1,
                pbrTexels.normal,
                pbr.normalScale,
              )
        const eye = context.eye
        const world = at([first.world, second.world, third.world])
        const view =
          eye === undefined
            ? normal
            : (normalize([eye[0] - world[0], eye[1] - world[1], eye[2] - world[2]]) ?? normal)
        ;[red, green, blue] = shadeDrawPbr(pbr, [red, green, blue], pbrTexels, normal, view, light)
      }
      let shade = flatShade
      if (shaded && normals !== undefined && light !== undefined) {
        const smooth = normalize([
          firstWeight * normals[0][0] + secondWeight * normals[1][0] + thirdWeight * normals[2][0],
          firstWeight * normals[0][1] + secondWeight * normals[1][1] + thirdWeight * normals[2][1],
          firstWeight * normals[0][2] + secondWeight * normals[1][2] + thirdWeight * normals[2][2],
        ])
        shade = smooth === undefined ? 1 : lambert(smooth, light)
      }
      if (shaded && context.previewLighting !== undefined) {
        const a = firstWeight * first.invW,
          b = secondWeight * second.invW,
          c = thirdWeight * third.invW
        const sum = a + b + c
        if (sum <= 1e-9) continue
        const interpolate = (values: Triangle<Vec3>): Vec3 => [
          (a * values[0][0] + b * values[1][0] + c * values[2][0]) / sum,
          (a * values[0][1] + b * values[1][1] + c * values[2][1]) / sum,
          (a * values[0][2] + b * values[1][2] + c * values[2][2]) / sum,
        ]
        const rgb = samplePreviewLighting(
          context.previewLighting,
          normals === undefined ? (flatNormal ?? [0, 0, 1]) : interpolate(normals),
          interpolate([first.world, second.world, third.world]),
        )
        red *= rgb[0]
        green *= rgb[1]
        blue *= rgb[2]
      } else if (shaded && light !== undefined) {
        red *= shade * light.color[0]
        green *= shade * light.color[1]
        blue *= shade * light.color[2]
      }
      // A terrain splat carries published ambient occlusion in vertex alpha, not transparency.
      if (splat !== undefined && colors !== undefined) {
        const ao =
          splatWeights![0] * colors[0][3] +
          splatWeights![1] * colors[1][3] +
          splatWeights![2] * colors[2][3]
        red *= ao
        green *= ao
        blue *= ao
      }
      red *= tint[0]
      green *= tint[1]
      blue *= tint[2]
      const offset = pixel * 4
      if (effect !== undefined) {
        alpha *= tint[3]
        if (effect.alphaCutoff > 0 && alpha < effect.alphaCutoff) continue
        if (effect.depthTest && effect.depthWrite) context.depth[pixel] = sampleDepth
        blendSimpleEffectPixel(context.frame, offset, [red, green, blue, alpha], effect)
        fragments++
        continue
      }
      if (surface.alpha.mode === 'mask' && alpha < surface.alpha.cutoff) continue
      if (surface.alpha.mode !== 'blend') alpha = 1
      // the primitive's fade scales its coverage after the material's own rule (primitiveFade)
      alpha *= tint[3]
      if (surface.alpha.depthWrite) context.depth[pixel] = sampleDepth
      const remaining = 1 - alpha
      context.frame[offset] = byte(
        Math.min(1, Math.max(0, red)) * alpha + ((context.frame[offset] ?? 0) / 255) * remaining,
      )
      context.frame[offset + 1] = byte(
        Math.min(1, Math.max(0, green)) * alpha +
          ((context.frame[offset + 1] ?? 0) / 255) * remaining,
      )
      context.frame[offset + 2] = byte(
        Math.min(1, Math.max(0, blue)) * alpha +
          ((context.frame[offset + 2] ?? 0) / 255) * remaining,
      )
      context.frame[offset + 3] = byte(alpha + ((context.frame[offset + 3] ?? 0) / 255) * remaining)
      fragments += 1
    }
  }
  return fragments
}

/** Homogeneous clipping interpolates the same varyings later interpolated by the rasterizer. */
function clipTriangle<T extends { readonly clip: Vec4 }>(vertices: Triangle<T>,
  interpolate: (a: T, b: T, t: number) => T): T[] {
  let polygon: T[] = [...vertices]
  for (const [axis, sign] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ] as const) {
    const output: T[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length]
      if (a === undefined || b === undefined) continue
      const da = a.clip[3] + a.clip[axis] * sign,
        db = b.clip[3] + b.clip[axis] * sign
      if (da >= 0) output.push(a)
      if (da < 0 !== db < 0) {
        const t = da / (da - db)
        output.push(interpolate(a, b, t))
      }
    }
    polygon = output
  }
  return polygon
}

function renderMaterialDraw(
  context: RasterContext,
  draw: MaterialDraw,
  request: SceneRenderRequest,
): void {
  if (
    draw.program !== undefined &&
    requiresEnvironmentEye(draw.program) &&
    snapshotEyePosition(request.camera.eyePosition) === undefined
  )
    throw new TypeError('explicit reflection environment requires eyePosition')
  const primitive = draw.primitive,
    geometry = materialGeometry(
      primitive,
      request.camera,
      request.scene.light ?? {
        direction: context.previewLighting?.lights.find(item => item.type === 'directional')
          ?.direction ?? [0, 0, 1],
      },
      draw.program?.worldToMaterial,
      draw.program?.environment !== undefined,
      draw.program?.normalBlendPolicy !== undefined || draw.program?.normalMapSpace === 'object',
      context.light === undefined && context.previewLighting?.lights.some(light => light.type !== 'directional') === true &&
        draw.program?.defines.sceneLighting === true && draw.program.defines.pbr !== true && !draw.program.defines.unshaded,
    )
  const elements = triangleElements(
    primitive.topology,
    primitive.indices?.length ?? primitive.positions.length / 3,
  )
  if (elements === undefined) {
    context.diagnostics.push({
      severity: 'warning',
      code: 'common.scene/unsupported-topology',
      message: `Material renderer skipped ${primitive.topology}`,
      primitiveId: primitive.id,
    })
    return
  }
  const mirrored = materialMirrors(materialModelMatrix(primitive))
  // Many sprites of one tint each drawn as one primitive (effect particles, baked PopcornFX):
  // the WebGL program takes the tint flat from the triangle's last vertex, and so does this.
  const vertexTints = primitiveVertexTints(primitive)
  for (const indices of elements) {
    context.signal?.throwIfAborted()
    const tintAt = (primitive.indices?.[indices[2]] ?? indices[2]) * 4
    const vertexTint =
      vertexTints === undefined
        ? undefined
        : ([
            vertexTints[tintAt] ?? 1,
            vertexTints[tintAt + 1] ?? 1,
            vertexTints[tintAt + 2] ?? 1,
            vertexTints[tintAt + 3] ?? 1,
          ] as const)
    const source: Triangle<MaterialVertex> = [
      geometry.vertex(primitive.indices?.[indices[0]] ?? indices[0]),
      geometry.vertex(primitive.indices?.[indices[1]] ?? indices[1]),
      geometry.vertex(primitive.indices?.[indices[2]] ?? indices[2]),
    ]
    const polygon = clipTriangle(source, (a, b, t) =>
      interpolateMaterialVertex([a, b, b], [1 - t, t, 0]))
    context.triangles++
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0],
        b = polygon[i],
        c = polygon[i + 1]
      if (
        a === undefined ||
        b === undefined ||
        c === undefined ||
        [a, b, c].some(v => v.clip[3] < 1e-9)
      )
        continue
      const screen = (v: MaterialVertex): Vertex =>
        screenClipVertex(v.clip, v.worldPosition, context.width, context.height)

      context.fragments += rasterizeTriangle(
        context,
        [screen(a), screen(b), screen(c)],
        DEFAULT_SURFACE,
        undefined,
        undefined,
        { draw, vertices: [a, b, c], ...(vertexTint === undefined ? {} : { vertexTint }) },
        undefined,
        undefined,
        undefined,
        mirrored,
      )
    }
  }
}

/** A texture the CPU draws: stored GPU blocks as their decoded first level, as a GPU without them. */
function drawnTexture(texture: SceneRendererTexture): SceneRendererTexture {
  if (texture.compressed === undefined) return texture
  const { compressed: _blocks, ...texels } = texture
  return Object.freeze({ ...texels, rgba: sceneTexturePixels(texture) })
}

function textureTable(textures: readonly SceneRendererTexture[] | undefined) {
  const table = new Map<string, SceneRendererTexture>()
  for (const texture of textures ?? []) {
    if (!nonEmptyString(texture.id) || table.has(texture.id)) {
      throw new TypeError('renderer textures must have unique non-empty ids')
    }
    dimension(texture.width, `texture ${texture.id} width`)
    dimension(texture.height, `texture ${texture.id} height`)
    const drawn = drawnTexture(texture)
    sceneTextureBytes(drawn)
    table.set(texture.id, drawn)
  }
  return table
}

/** The texture a render material's diffuse layer names, resolved through its own bindings. */
function diffuseLayerTexture(
  material: SceneRendererMaterial,
  textures: ReadonlyMap<string, SceneRendererTexture>,
  diagnostics: SceneRendererDiagnostic[],
): SceneRendererTexture | undefined {
  const bindings = material.textureBindings
  if (bindings === undefined || bindings.length === 0) return undefined
  const params = material.shader?.parameters as
    | {
        readonly renderModel?: {
          readonly layers?: readonly { readonly label?: string; readonly path?: string }[]
        }
      }
    | undefined
  const layers = params?.renderModel?.layers ?? []
  const diffuse = layers.find(layer => layer.label === 'diffuse') ?? layers[0]
  const resourceId = diffuse?.path
  if (typeof resourceId !== 'string' || resourceId === '') return undefined
  const binding = bindings.find(entry => entry.resourceId === resourceId)
  if (binding === undefined) return undefined
  const texture = textures.get(binding.textureId)
  if (texture === undefined || texture.dimension === 'cube') {
    diagnostics.push(
      Object.freeze({
        severity: 'warning',
        code: 'modkit.headless/diffuse-layer-unavailable',
        message: `material ${material.id} names diffuse ${resourceId}, which the scene did not carry as a 2D texture`,
      }),
    )
    return undefined
  }
  return texture
}

/**
 * Materials as this renderer needs them: a colour, an optional resolved texture, a shading model.
 *
 * A material naming a texture the scene did not carry keeps its base colour and produces a
 * diagnostic — the reference is a fact about the model, and dropping the primitive would turn a
 * missing file into a missing mesh.
 */
function materialSurfaces(
  materials: readonly SceneRendererMaterial[] | undefined,
  textures: Map<string, SceneRendererTexture>,
  diagnostics: SceneRendererDiagnostic[],
  context: SceneRendererMaterialContext | undefined,
) {
  const surfaces = new Map<string, Surface>()
  for (const material of (materials ?? []).map(bindSimpleEffectTexture)) {
    if (!nonEmptyString(material.id) || surfaces.has(material.id)) {
      throw new TypeError('renderer materials must have unique non-empty ids')
    }
    const shading = material.shading ?? 'unlit'
    if (shading !== 'unlit' && shading !== 'lambert' && shading !== 'pbr') {
      throw new TypeError(`material ${material.id} declares an unknown shading model`)
    }
    let texture
    // A game material states its textures in its own layer list, not as a glTF base-colour
    // texture, so without this the whole StarCraft II / Warcraft III material family drew flat.
    // Its diffuse layer is the base colour; the rest of that model is not emulated here, which
    // the `pbr-lighting-unrendered` diagnostic already reported upstream.
    if (material.baseColorTexture === undefined && material.shader !== undefined)
      texture = diffuseLayerTexture(material, textures, diagnostics)
    if (material.baseColorTexture !== undefined) {
      texture = textures.get(material.baseColorTexture)
      if (texture?.dimension === 'cube') {
        diagnostics.push({
          severity: 'warning',
          code: 'common.scene/base-color-texture-dimension',
          message: `Material ${material.id}: base-color UV sampling requires a 2D texture.`,
        })
        texture = undefined
      }
      if (texture === undefined) {
        diagnostics.push(
          Object.freeze({
            severity: 'warning',
            code: 'modkit.headless/texture-missing',
            message: `material ${material.id} names texture ${material.baseColorTexture}, which the scene did not carry`,
          }),
        )
      }
    }
    if (texture !== undefined && material.simpleEffect !== undefined)
      texture = { ...texture, filter: 'linear' as const }
    const pbr = drawPbr(material, textures, diagnostics)
    let teamColor = drawTeamColor(material, context)
    const teamMask = teamMaskTexture(teamColor, textures)
    if (teamColor?.maskTexture !== undefined && teamMask === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'common.scene/team-color-mask-missing',
        message: `material ${material.id} names team colour mask ${teamColor.maskTexture}, which the scene did not carry as a 2D texture`,
      })
      teamColor = undefined
    }
    surfaces.set(
      material.id,
      Object.freeze({
        baseColor: color(material.baseColor, `material ${material.id} baseColor`),
        alpha: materialAlpha(material),
        ...(material.simpleEffect === undefined
          ? {}
          : { simpleEffect: readSimpleEffect(material.simpleEffect) as SimpleEffectState }),
        shading,
        ...(texture === undefined ? {} : { texture }),
        ...(pbr === undefined ? {} : { pbr }),
        ...(teamColor === undefined ? {} : { teamColor }),
        ...(teamMask === undefined || teamColor === undefined ? {} : { teamMask }),
      }),
    )
  }
  return surfaces
}

const DEFAULT_SURFACE: Surface = Object.freeze({
  baseColor: DEFAULT_COLOR,
  shading: 'unlit',
  alpha: materialAlpha(),
})

/** Normalised light, or `undefined` for a scene that declared none — which means unlit. */
function sceneLight(value: SceneRendererDirectionalLight | undefined): Light | undefined {
  if (value === undefined) return undefined
  const record = recordOf(value)
  if (record === undefined) throw new TypeError('scene light must be an object')
  const direction = normalize(
    Array.isArray(record.direction) ? record.direction : [Number.NaN, Number.NaN, Number.NaN],
  )
  if (direction === undefined) {
    throw new TypeError('scene light direction must be a finite non-zero xyz vector')
  }
  const ambient = record.ambient ?? 0.25
  if (typeof ambient !== 'number' || !Number.isFinite(ambient) || ambient < 0 || ambient > 1) {
    throw new TypeError('scene light ambient must be a number in the range 0..1')
  }
  return Object.freeze({
    direction,
    ambient,
    color: color(record.color ?? [1, 1, 1, 1], 'scene light color'),
  })
}

function triangleElements(topology: string, elementCount: number): Triangle<number>[] | undefined {
  if (topology === 'triangles') {
    return Array.from({ length: Math.floor(elementCount / 3) }, (_, index) => {
      const first = index * 3
      return [first, first + 1, first + 2]
    })
  }
  if (topology === 'triangle-strip') {
    return Array.from({ length: Math.max(0, elementCount - 2) }, (_, index) =>
      index % 2 === 0 ? [index, index + 1, index + 2] : [index + 1, index, index + 2],
    )
  }
  if (topology === 'triangle-fan') {
    return Array.from({ length: Math.max(0, elementCount - 2) }, (_, index) => [
      0,
      index + 1,
      index + 2,
    ])
  }
  return undefined
}

function renderPrimitive(context: RasterContext, primitive: SceneRendererPrimitive) {
  if (!nonEmptyString(primitive.id)) throw new TypeError('renderer primitive id must be non-empty')
  if (!(primitive.positions instanceof Float32Array) || primitive.positions.length % 3 !== 0) {
    throw new TypeError(`primitive ${primitive.id} positions must be an xyz Float32Array`)
  }
  if (primitive.indices !== undefined && !(primitive.indices instanceof Uint32Array)) {
    throw new TypeError(`primitive ${primitive.id} indices must be a Uint32Array`)
  }
  const model =
    primitive.transform === undefined
      ? undefined
      : matrix(primitive.transform, `primitive ${primitive.id} transform`)
  const mirrored = model !== undefined && materialMirrors(Float32Array.from(model))
  const vertexCount = primitive.positions.length / 3
  const order = primitive.indices
  const elementCount = order?.length ?? vertexCount
  const elements = triangleElements(primitive.topology, elementCount)
  if (elements === undefined) {
    context.diagnostics.push(
      Object.freeze({
        severity: 'warning',
        code: 'modkit.headless/unsupported-topology',
        message: `headless renderer skipped ${primitive.topology}`,
        primitiveId: primitive.id,
      }),
    )
    return
  }
  const surface =
    primitive.materialId === undefined
      ? DEFAULT_SURFACE
      : (context.materials.get(primitive.materialId) ?? DEFAULT_SURFACE)
  const splat = context.splats?.get(primitive.id)
  const colorBuffer = readSimpleEffectColors(primitive)
  // every texture of the base route reads these UVs: the base colour, a team mask, pbr maps
  const sampled =
    surface.texture !== undefined ||
    surface.teamMask !== undefined ||
    surface.pbr?.metallicRoughness !== undefined ||
    surface.pbr?.occlusion !== undefined ||
    surface.pbr?.emissiveTexture !== undefined ||
    surface.pbr?.normal !== undefined
  // a normal map reads the primitive's TANGENT (xyz in the model frame, handedness w) when it has one
  const tangentBuffer =
    surface.pbr?.normal !== undefined &&
    primitive.tangents instanceof Float32Array &&
    primitive.tangents.length >= vertexCount * 4
      ? primitive.tangents
      : undefined
  const uvBuffer =
    !sampled || !(primitive.textureCoordinates instanceof Float32Array)
      ? undefined
      : primitive.textureCoordinates
  const normalBuffer =
    context.light === undefined ||
    (surface.shading !== 'lambert' && surface.shading !== 'pbr') ||
    !(primitive.normals instanceof Float32Array) ||
    primitive.normals.length < primitive.positions.length
      ? undefined
      : primitive.normals
  for (const element of elements) {
    context.signal?.throwIfAborted()
    const indices = element.map(index => order?.[index] ?? index)
    if (indices.some(index => index >= vertexCount)) {
      throw new TypeError(`primitive ${primitive.id} contains an out-of-range index`)
    }
    const vertices = indices.map((index, corner) =>
      clipVertex(primitive.positions, index, model, context.viewProjection,
        [corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0]),
    )
    if (vertices.some(vertex => vertex === undefined)) continue
    const polygon = clipTriangle(vertices as unknown as Triangle<ClipVertex>, (a, b, t) => ({
      clip: weightedVector([a.clip, b.clip, b.clip], [1 - t, t, 0]),
      world: weightedVector([a.world, b.world, b.world], [1 - t, t, 0]),
      weights: weightedVector([a.weights, b.weights, b.weights], [1 - t, t, 0]),
    }))
    const uvs =
      uvBuffer === undefined
        ? undefined
        : indices.map(index => [uvBuffer[index * 2] ?? 0, uvBuffer[index * 2 + 1] ?? 0] as const)
    const normals =
      normalBuffer === undefined
        ? undefined
        : indices.map(index =>
            transformDirection(
              model,
              normalBuffer[index * 3] ?? 0,
              normalBuffer[index * 3 + 1] ?? 0,
              normalBuffer[index * 3 + 2] ?? 0,
            ),
          )
    const colors = colorBuffer === undefined ? undefined : indices.map(index => [
      colorBuffer[index * 4] ?? 1, colorBuffer[index * 4 + 1] ?? 1,
      colorBuffer[index * 4 + 2] ?? 1, colorBuffer[index * 4 + 3] ?? 1,
    ] as Vec4)
    const tangents = tangentBuffer === undefined ? undefined : indices.map(index => [
      ...transformDirection(model, tangentBuffer[index * 4] ?? 0,
        tangentBuffer[index * 4 + 1] ?? 0, tangentBuffer[index * 4 + 2] ?? 0),
      tangentBuffer[index * 4 + 3] ?? 1,
    ] as Vec4)
    context.triangles += 1
    for (let i = 1; i + 1 < polygon.length; i++) {
      const corners = [polygon[0]!, polygon[i]!, polygon[i + 1]!] as const
      if (corners.some(v => v.clip[3] < 1e-9)) continue
      const weights = corners.map(v => v.weights) as unknown as Triangle<Vec3>
      const varying = <T extends readonly number[]>(values: readonly T[] | undefined) =>
        values === undefined ? undefined : weights.map(w =>
          weightedVector(values as unknown as Triangle<T>, w)) as unknown as Triangle<T>
      context.fragments += rasterizeTriangle(context,
        corners.map(v => screenClipVertex(v.clip, v.world, context.width, context.height)) as unknown as Triangle<Vertex>,
        surface, varying(uvs), varying(normals), undefined, primitive.depthBias,
        varying(colors), primitiveTint(primitive), mirrored, varying(tangents),
        splat === undefined ? undefined : {
          ...splat, indices: indices as unknown as Triangle<number>, sourceWeights: weights,
        }, context.water?.get(primitive.id))
    }
  }
}

/** Deterministic DOM-free implementation of the portable scene-renderer contract. */
export async function renderHeadless(
  request: SceneRenderRequest,
  splats?: ReadonlyMap<string, Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>>,
  water?: ReadonlyMap<string, number>,
  terrain?: ReadonlySet<string>,
  materialLighting?: ReadonlyMap<string, Pick<SceneRendererScene, 'lights' | 'ambientLight'>>,
  terrainPainterLayers?: ReadonlySet<string>,
  visibilityBounds?: WorldVisibilityBounds,
  /** Already sampled by the world at this instance's clip clock; bound texture objects stay theirs. */
  preparedPrograms?: ReadonlyMap<string, SceneMaterialPrograms>,
  /** Optional world postpass: float accumulation in byte units, converted to straight RGBA8 once. */
  finalizeLinear?: (rgba: Float32Array, depth: Float32Array) => Uint8Array,
): Promise<SceneRenderFrame> {
  request.signal?.throwIfAborted()
  checkedWorldVisibilityBounds(visibilityBounds)
  if (request.outputKind !== 'rgba8') {
    throw new TypeError(`headless renderer cannot produce ${request.outputKind}`)
  }
  const scene = recordOf(request.scene)
  const camera = recordOf(request.camera)
  const viewport = recordOf(request.viewport)
  if (scene === undefined || !Array.isArray(scene.primitives)) {
    throw new TypeError('headless renderer requires a scene primitive array')
  }
  if (camera === undefined || viewport === undefined) {
    throw new TypeError('headless renderer requires camera and viewport objects')
  }
  const width = dimension(viewport.width, 'viewport width')
  const height = dimension(viewport.height, 'viewport height')
  if (width * height > MAX_PIXELS) {
    throw new TypeError(`headless renderer refuses more than ${MAX_PIXELS} output pixels`)
  }
  const frame = finalizeLinear === undefined ? new Uint8Array(width * height * 4) : new Float32Array(width * height * 4)
  const depth = new Float32Array(width * height)
  depth.fill(Number.POSITIVE_INFINITY)
  clearFrame(frame, color(request.clearColor ?? DEFAULT_CLEAR_COLOR, 'clearColor'))
  const diagnostics: SceneRendererDiagnostic[] = []
  const textures = textureTable(scene.textures)
  const materialContext =
    scene.lights === undefined
      ? scene.materialContext
      : {
          ...scene.materialContext,
          sceneLighting: scene.materialContext?.sceneLighting ?? true,
        }
  const programs = new Map(prepareSceneMaterialPrograms(
    (scene.materials ?? []).filter(material => !preparedPrograms?.has(material.id)),
    textures,
    materialContext,
    diagnostics,
    request.signal,
  ))
  for (const [id, prepared] of preparedPrograms ?? []) {
    programs.set(id, prepared)
    for (const pass of prepared.passes) for (const message of pass.diagnostics)
      diagnostics.push({ code: 'common.scene/material-feature-unrendered', severity: 'warning', message: `Material ${id}: ${message}` })
  }
  const context: RasterContext = {
    visibilityBounds,
    width,
    height,
    frame,
    depth,
    viewProjection: matrix(camera.viewProjection, 'camera viewProjection'),
    materials: materialSurfaces(scene.materials, textures, diagnostics, materialContext),
    light: sceneLight(scene.light),
    previewLighting: readPreviewLighting(scene.lights, scene.ambientLight),
    eye: snapshotEyePosition(camera.eyePosition),
    diagnostics,
    triangles: 0,
    fragments: 0,
    signal: request.signal,
    ...(splats === undefined ? {} : { splats }),
    ...(water === undefined || water.size === 0 ? {} : { water }),
    ...(visibilityBounds === undefined && (water === undefined || water.size === 0)
      ? {}
      : {
          inverseViewProjection: Float32Array.from(
            invertMaterialFrame(Array.from(camera.viewProjection)),
          ),
        }),
  }
  const draws = sceneMaterialDraws(
    scene.primitives,
    scene.materials ?? [],
    programs,
    context.viewProjection,
    diagnostics,
    request.clearColor?.[3] ?? 0,
  )
  const overlays =
    terrain === undefined
      ? []
      : draws.filter(draw => !terrain.has(draw.primitive.id) && materialIsTerrainOverlay(draw))
  const overlaySet = new Set(overlays)
  const ground = terrain === undefined ? [] : draws.filter(draw =>
    terrain.has(draw.primitive.id) && !terrainPainterLayers?.has(draw.primitive.id),
  )
  const painter = draws.filter(draw => terrainPainterLayers?.has(draw.primitive.id))
  const ordered =
    overlays.length === 0 && painter.length === 0
      ? draws
      : [
          ...ground,
          ...painter,
          ...overlays,
          ...draws.filter(draw =>
            !terrain?.has(draw.primitive.id) && !terrainPainterLayers?.has(draw.primitive.id) && !overlaySet.has(draw),
          ),
        ]
  // Independent road depth ignores terrain but preserves front/back and overlapping road surfaces.
  let terrainDepth: Float32Array | undefined
  let painterDepth: Float32Array | undefined
  const defaultLighting = context.previewLighting
  const materialRigs = new Map(
    [...(materialLighting ?? [])].map(
      ([id, rig]) => [id, readPreviewLighting(rig.lights, rig.ambientLight)] as const,
    ),
  )
  for (const draw of ordered) {
    context.previewLighting = materialRigs.get(draw.primitive.materialId ?? '') ?? defaultLighting
    const overlay = overlaySet.has(draw)
    if (overlay && terrainDepth === undefined) {
      terrainDepth = context.depth
      context.depth = new Float32Array(width * height).fill(Infinity)
    } else if (!overlay && terrainDepth !== undefined) {
      for (let pixel = 0; pixel < context.depth.length; pixel += 1)
        if (context.depth[pixel] === Infinity) context.depth[pixel] = terrainDepth[pixel]!
      terrainDepth = undefined
    }
    // Opaque geometry supplies the bottom, before blended draws can change its depth.
    if (
      context.water !== undefined &&
      context.opaqueDepth === undefined &&
      !overlay &&
      !terrain?.has(draw.primitive.id) &&
      (draw.program === undefined
        ? context.materials.get(draw.primitive.materialId ?? '')?.alpha.mode === 'blend'
        : !materialIsSolid(draw.program))
    )
      context.opaqueDepth = context.depth.slice()
    const savedDepth = context.depth
    if (terrainPainterLayers?.has(draw.primitive.id)) {
      // Seed only after ground draws: cell layers test foreground terrain without changing it.
      painterDepth ??= savedDepth.slice()
      context.depth = painterDepth
    }
    if (draw.program === undefined) renderPrimitive(context, draw.primitive)
    else renderMaterialDraw(context, draw, request)
    if (terrainPainterLayers?.has(draw.primitive.id)) context.depth = savedDepth
  }
  const output = finalizeLinear === undefined ? frame as Uint8Array : finalizeLinear(frame as Float32Array, depth)
  if (finalizeLinear === undefined) straightenAlpha(output)
  return Object.freeze({
    outputKind: 'rgba8',
    width,
    height,
    rgba: output,
    diagnostics: Object.freeze(context.diagnostics),
    statistics: Object.freeze({
      primitives: scene.primitives.length,
      triangles: context.triangles,
      fragments: context.fragments,
    }),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([SCENE_RENDERER_CONTRACT] as const)

export function createProvider(selection: { readonly contract: string; readonly major: number }): {
  readonly value: SceneRenderer
  release(): Promise<void>
} {
  if (selection.contract !== SCENE_RENDERER_CONTRACT || selection.major !== 1) {
    throw new TypeError(`unsupported renderer selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: SCENE_RENDERER_CONTRACT,
      rendererId: RENDERER_ID,
      outputKinds: Object.freeze(['rgba8'] as const),
      render: renderHeadless,
    }),
    release: async () => undefined,
  })
}
import { primitiveTint, primitiveVertexTints } from './tint.js'
