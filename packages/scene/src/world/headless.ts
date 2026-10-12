/**
 * A map world rendered without a GPU (MW7): the world plan as one headless scene. The models stand
 * as the plan places them, with the materials and programs the world draws them with; the ground,
 * decals and water are primitives of their batches, with their team colours and blending. Terrain
 * overlay coverage is translated from the world shader's red channel into vertex alpha, retaining
 * terrain painter order before water; compressed
 * coverage textures are decoded before their texture alpha is made opaque. Blended ground samples
 * the world plan's splat layers and weight rasters per fragment. It is
 * the viewer's geometry, base textures and light, not its picture: no shadows, splat normal/specular
 * maps, tone mapping, screen effects or mip/anisotropic filtering; bilinear sampling follows each texture's filter.
 * Untextured water uses the common depth tint/shore fade against the opaque scene, including models.
 * Terrain-only depth bias preserves coplanar surface models without changing their coordinates.
 * Wave normals, caustics and shadows remain GPU-only.
 */
import type {
  SceneRenderFrame,
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererScene,
  SceneRendererTeamColor,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { TEAM_COLOR_BLENDS } from '@modkit/codec-kit/model-math/color-remap'
import { renderHeadless } from '../render/headless.js'
import { sceneTexturePixels } from '../render/compressed-textures.js'
import { TERRAIN_DEPTH_BIAS, type SceneDepthBias } from '../render/depth-bias.js'
import {
  createWorldWebGlCameraFrame,
  worldMaterialLight,
  type WorldBatchTeamColor,
  type WorldWebGlBatch,
  type WorldWebGlCamera,
  type WorldWebGlPlan,
  type WorldWebGlSplatBatch,
  type WorldWebGlTexturedBatch,
  worldWebGlPosedScene,
} from './webgl.js'

const CHANNELS = ['r', 'g', 'b', 'a'] as const

/**
 * A batch's team colour as the material team colour it was resolved from: the batch's own colour
 * as the default (the plan merges objects of one colour into one batch), its mask by `maskId`.
 */
function batchTeamColor(
  team: WorldBatchTeamColor,
  maskId: string | undefined,
): SceneRendererTeamColor {
  const { rule } = team
  const channel = rule.channel === 'rgb' ? 'rgb' : CHANNELS[rule.channel]
  return {
    mask: maskId === undefined ? 'whole' : { texture: maskId, channel },
    blend: TEAM_COLOR_BLENDS[team.blend] ?? 'multiply',
    strength: team.strength,
    defaultColor: team.color,
    ...(team.objectTint === true ? { source: 'object-tint' as const } : {}),
    ...(rule.tintRgb === true ? { tint: 'mask-rgb' as const } : {}),
    ...(rule.mode === 'key' && rule.thresholds !== undefined
      ? {
          key: {
            channels: (['r', 'g', 'b'] as const).filter(
              (_, index) => rule.thresholds![index]! < 255,
            ),
            threshold: Math.min(...rule.thresholds),
            intensity: CHANNELS[rule.intensity ?? 0],
          },
        }
      : {}),
    ...(rule.mode === 'ramp' && rule.shades !== undefined
      ? { ramp: { shades: rule.shades, first: rule.first ?? 0, scale: rule.scale ?? 255 } }
      : {}),
  }
}

/** A model scene's ids under its own prefix, every texture reference with them. */
function prefixed(
  prefix: string,
  primitives: readonly SceneRendererPrimitive[],
  materials: readonly SceneRendererMaterial[],
  textures: readonly SceneRendererTexture[],
) {
  const texture = (id: string | undefined) => (id === undefined ? undefined : `${prefix}${id}`)
  return {
    primitives: primitives.map(primitive => ({
      ...primitive,
      id: `${prefix}${primitive.id}`,
      ...(primitive.materialId === undefined
        ? {}
        : { materialId: `${prefix}${primitive.materialId}` }),
    })),
    materials: materials.map(material => {
      const pbr = material.pbr
      const mask = material.teamColor?.mask
      return {
        ...material,
        id: `${prefix}${material.id}`,
        ...(material.baseColorTexture === undefined
          ? {}
          : { baseColorTexture: texture(material.baseColorTexture)! }),
        ...(material.textureBindings === undefined
          ? {}
          : {
              textureBindings: material.textureBindings.map(binding => ({
                ...binding,
                textureId: texture(binding.textureId)!,
              })),
            }),
        ...(pbr === undefined
          ? {}
          : {
              pbr: {
                ...pbr,
                ...(pbr.metallicRoughnessTexture === undefined
                  ? {}
                  : { metallicRoughnessTexture: texture(pbr.metallicRoughnessTexture)! }),
                ...(pbr.occlusionTexture === undefined
                  ? {}
                  : { occlusionTexture: texture(pbr.occlusionTexture)! }),
                ...(pbr.emissiveTexture === undefined
                  ? {}
                  : { emissiveTexture: texture(pbr.emissiveTexture)! }),
                ...(pbr.normalTexture === undefined
                  ? {}
                  : { normalTexture: texture(pbr.normalTexture)! }),
              },
            }),
        ...(material.teamColor === undefined || mask === undefined || mask === 'whole'
          ? {}
          : {
              teamColor: {
                ...material.teamColor,
                mask: { ...mask, texture: texture(mask.texture)! },
              },
            }),
      }
    }),
    textures: textures.map(item => ({ ...item, id: `${prefix}${item.id}` })),
  }
}

/** Translate world-overlay coverage (red) and ambient occlusion (alpha) into renderer RGBA. */
function terrainOverlayColors(colors: Float32Array): Float32Array {
  const converted = new Float32Array(colors.length)
  for (let index = 0; index < colors.length; index += 4) {
    const ao = colors[index + 3]!
    converted[index] = ao
    converted[index + 1] = ao
    converted[index + 2] = ao
    converted[index + 3] = colors[index]!
  }
  return converted
}

/** The world plan as one scene of the headless renderer. */
export function worldHeadlessScene(plan: WorldWebGlPlan): Readonly<{
  scene: SceneRendererScene
  diagnostics: readonly SceneRendererDiagnostic[]
  splats: ReadonlyMap<string, Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>>
  water: ReadonlyMap<string, number>
}> {
  const primitives: SceneRendererPrimitive[] = []
  const materials: SceneRendererMaterial[] = []
  const diagnostics: SceneRendererDiagnostic[] = []
  const water = new Map<string, number>()
  // Terrain always precedes transparent models, including authored negative-priority effects.
  let transparentPriority = 0
  for (const batch of plan.transparentTexturedTriangles)
    transparentPriority = Math.min(transparentPriority, batch.priority ?? 0)
  for (const scene of plan.modelMaterialScenes) {
    for (const material of scene.materials)
      transparentPriority = Math.min(transparentPriority, material.priority ?? 0)
    for (const programs of scene.programs.values()) for (const pass of programs.passes)
      transparentPriority = Math.min(transparentPriority, pass.priority)
  }
  const splats = new Map<string, Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>>()
  // batch textures by object: two batches' textures may share an id and not their texels
  const textures: SceneRendererTexture[] = []
  const coverageTextures = new Map<SceneRendererTexture, SceneRendererTexture>()
  // Coverage-only overlays keep RGB but ignore source alpha; cache a copy without mutating texels.
  const overlayTexture = (batch: WorldWebGlTexturedBatch): SceneRendererTexture => {
    if (batch.overlayAlpha !== 'coverage') return batch.texture
    let texture = coverageTextures.get(batch.texture)
    if (texture === undefined) {
      const rgba = sceneTexturePixels(batch.texture).slice()
      for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255
      // A compressed descriptor takes precedence over rgba: omit it on this derived copy.
      const { compressed: _compressed, ...source } = batch.texture
      texture = { ...source, rgba }
      coverageTextures.set(batch.texture, texture)
    }
    return texture
  }
  const textureIds = new Map<SceneRendererTexture, string>()
  const textureId = (texture: SceneRendererTexture) => {
    let id = textureIds.get(texture)
    if (id === undefined) {
      id = `world/texture-${String(textureIds.size)}`
      textureIds.set(texture, id)
      textures.push({ ...texture, id })
    }
    return id
  }
  const ground = (
    id: string,
    batch: WorldWebGlBatch,
    material: Omit<SceneRendererMaterial, 'id' | 'baseColor'>,
    textureCoordinates?: Float32Array,
    texture?: SceneRendererTexture,
    depthBias?: SceneDepthBias,
  ) => {
    if (batch.positions.length < 9) return
    primitives.push({
      id,
      topology: 'triangles',
      positions: batch.positions,
      normals: batch.normals,
      colors: batch.colors,
      ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
      materialId: id,
      ...(depthBias === undefined ? {} : { depthBias }),
    })
    materials.push({
      id,
      baseColor: [1, 1, 1, 1],
      doubleSided: true,
      ...material,
      ...(texture === undefined ? {} : { baseColorTexture: textureId(texture) }),
    })
  }
  /** What a textured batch draws with besides its texture: cutout, light and team colour. */
  const textured = (
    batch: WorldWebGlTexturedBatch,
  ): Omit<SceneRendererMaterial, 'id' | 'baseColor'> => ({
    ...(batch.alphaCutoff === undefined || batch.alphaCutoff <= 0
      ? {}
      : { alphaMode: 'mask' as const, alphaCutoff: batch.alphaCutoff }),
    ...(batch.unlit === true ? { shading: 'unlit' as const } : {}),
    ...(batch.team === undefined
      ? {}
      : {
          teamColor: batchTeamColor(
            batch.team,
            batch.team.mask === undefined ? undefined : textureId(batch.team.mask),
          ),
        }),
  })
  const terrainVertices = plan.terrainOpaqueVertices ?? 0
  const terrainDepthBias = terrainVertices > 0 || (plan.terrainTexturedBatches ?? 0) > 0 || plan.splatTriangles.length > 0
    ? TERRAIN_DEPTH_BIAS : undefined
  if (terrainVertices > 0) ground('world/ground', {
    positions: plan.opaqueTriangles.positions.subarray(0, terrainVertices * 3),
    normals: plan.opaqueTriangles.normals.subarray(0, terrainVertices * 3),
    colors: plan.opaqueTriangles.colors.subarray(0, terrainVertices * 4),
  }, {}, undefined, undefined, TERRAIN_DEPTH_BIAS)
  ground(terrainVertices === 0 ? 'world/ground' : 'world/opaque-models', {
    positions: plan.opaqueTriangles.positions.subarray(terrainVertices * 3),
    normals: plan.opaqueTriangles.normals.subarray(terrainVertices * 3),
    colors: plan.opaqueTriangles.colors.subarray(terrainVertices * 4),
  }, {})
  plan.texturedTriangles.forEach((batch, index) =>
    ground(
      `world/textured-${String(index)}`,
      batch,
      textured(batch),
      batch.textureCoordinates,
      batch.texture,
      index < (plan.terrainTexturedBatches ?? 0) ? TERRAIN_DEPTH_BIAS : undefined,
    ),
  )
  plan.splatTriangles.forEach((batch, index) => {
    const id = `world/splat-${String(index)}`
    splats.set(id, { batch, overlay: false })
    ground(id, batch, {}, undefined, undefined, TERRAIN_DEPTH_BIAS)
  })
  plan.splatOverlayTriangles.forEach((batch, index) => {
    const id = `world/splat-overlay-${String(index)}`
    splats.set(id, { batch, overlay: true })
    ground(id, batch, {
      alphaMode: 'blend',
      depthWrite: false,
      priority: transparentPriority + index - plan.splatOverlayTriangles.length - plan.terrainDecalTriangles.length - 1,
    }, undefined, undefined, terrainDepthBias)
  })
  const unshadedDetails = [...plan.splatTriangles, ...plan.splatOverlayTriangles].filter(
    batch =>
      batch.normalTextures.some(texture => texture !== undefined) ||
      batch.specularTextures?.some(texture => texture !== undefined),
  ).length
  if (unshadedDetails > 0)
    diagnostics.push({
      severity: 'information',
      code: 'x3.scene/world-headless-splat-detail-omitted',
      message: `${String(unshadedDetails)} blended ground batches omit normal/specular texture detail`,
    })
  plan.terrainDecalTriangles.forEach((batch, index) =>
    ground(
      `world/decal-${String(index)}`,
      { ...batch, colors: terrainOverlayColors(batch.colors) },
      // Terrain layers use painter order on the GPU; depth sorting whole batches hides roads.
      {
        alphaMode: 'blend',
        depthWrite: false,
        priority: transparentPriority + index - plan.terrainDecalTriangles.length - 1,
      },
      batch.textureCoordinates,
      overlayTexture(batch),
      terrainDepthBias,
    ),
  )
  plan.transparentTexturedTriangles.forEach((batch, index) =>
    ground(
      `world/transparent-textured-${String(index)}`,
      batch,
      {
        ...textured(batch),
        alphaMode: 'blend',
        depthWrite: false,
        ...(batch.priority === undefined ? {} : { priority: batch.priority }),
        // an additive batch adds its light, as the world draws it; a black texel adds nothing
        ...(batch.blendMode === 'additive'
          ? {
              simpleEffect: {
                blend: 'additive' as const,
                depthTest: true,
                depthWrite: false,
                doubleSided: true,
                alphaCutoff: 0,
                wrapU: 'repeat' as const,
                wrapV: 'repeat' as const,
              },
            }
          : {}),
      },
      batch.textureCoordinates,
      batch.texture,
    ),
  )
  const waterVertices = plan.waterPlanes.length === 0 ? 0 : plan.transparentWaterTriangles * 3
  ground(
    'world/transparent',
    {
      ...plan.transparentTriangles,
      positions: plan.transparentTriangles.positions.subarray(waterVertices * 3),
      normals: plan.transparentTriangles.normals.subarray(waterVertices * 3),
      colors: plan.transparentTriangles.colors.subarray(waterVertices * 4),
    },
    { alphaMode: 'blend', depthWrite: false },
  )
  plan.waterPlanes.forEach((plane, index) => {
    const id = `world/water-${index}`
    water.set(id, plane.colorFalloff)
    ground(id, plane.batch, { alphaMode: 'blend', depthWrite: false, shading: 'unlit' })
  })
  plan.modelMaterialScenes.forEach((kept, index) => {
    // A scene kept from an earlier plan draws in this plan's poses.
    const scene = worldWebGlPosedScene(plan, kept)
    const own = prefixed(
      `model-${String(index)}/`,
      scene.primitives,
      scene.materials,
      scene.textures,
    )
    primitives.push(...own.primitives)
    materials.push(...own.materials)
    textures.push(...own.textures)
  })
  const light = worldMaterialLight(plan)
  return Object.freeze({
    scene: Object.freeze({
      primitives: Object.freeze(primitives),
      materials: Object.freeze(materials),
      textures: Object.freeze(textures),
      lights: Object.freeze([
        {
          type: 'directional' as const,
          direction: light.direction,
          color: [light.color[0], light.color[1], light.color[2]] as const,
        },
        ...light.fills.map(fill => ({
          type: 'directional' as const,
          direction: fill.direction,
          color: fill.color as readonly [number, number, number],
        })),
      ]),
      ambientLight: light.ambientColor,
    }),
    diagnostics: Object.freeze(diagnostics),
    splats,
    water,
  })
}

export interface WorldHeadlessOptions {
  readonly width: number
  readonly height: number
  /** The world viewer's orbit camera (azimuth, elevation, zoom, target); its default when absent. */
  readonly camera?: WorldWebGlCamera
  readonly clearColor?: readonly [number, number, number, number]
  readonly signal?: AbortSignal
}

/** One frame of the world plan from the headless renderer, framed as the world viewer frames it. */
export async function renderWorldHeadless(
  plan: WorldWebGlPlan,
  options: WorldHeadlessOptions,
): Promise<SceneRenderFrame> {
  const { scene, diagnostics, splats, water } = worldHeadlessScene(plan)
  const frame = createWorldWebGlCameraFrame(plan, options.width, options.height, options.camera)
  const rendered = await renderHeadless(
    {
      scene,
      camera: frame,
      viewport: { width: options.width, height: options.height },
      outputKind: 'rgba8',
      clearColor: options.clearColor ?? [0, 0, 0, 1],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    splats,
    water,
  )
  return Object.freeze({
    ...rendered,
    diagnostics: Object.freeze([...diagnostics, ...rendered.diagnostics]),
  })
}
