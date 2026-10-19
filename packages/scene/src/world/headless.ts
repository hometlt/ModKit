/**
 * A map world rendered without a GPU (MW7): the world plan as one headless scene. The models stand
 * as the plan places them, with the materials and programs the world draws them with; the ground,
 * decals and water are primitives of their batches, with their team colours and blending. Terrain
 * overlay coverage is translated from the world shader's red channel into vertex alpha, retaining
 * terrain painter order before water; compressed
 * coverage textures are decoded before their texture alpha is made opaque. Blended ground samples
 * the world plan's splat layers and weight rasters per fragment. It is
 * the viewer's geometry, base textures and light, not its picture: no shadows, splat normal/specular
 * maps, screen effects or mip/anisotropic filtering; bilinear sampling follows each texture's filter.
 * HDR scenes accumulate floating radiance and apply the shared tone/color controls and height fog once.
 * Untextured water uses the common depth tint/shore fade against the opaque scene, including models.
 * Terrain-only depth bias preserves coplanar surface models without changing their coordinates.
 * GPU skin palettes are baked with the shared material-skin owner before CPU primitive copies.
 * Camera-facing particles and ribbons reuse the world's effect draws and prepared material programs.
 * Wave normals, caustics and shadows remain GPU-only.
 */
import type { WorldVisibilityBounds } from './world-visibility.js'
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
import { toneMapWorldColor } from './tone-mapping.js'
import { createWorldColorLut, sampleWorldColorLut } from './colorization.js'
import { Matrix4, Vector3 } from 'three'
import type { SceneMaterialPrograms } from '../render/materials.js'
import { materialPosedPrimitive } from '../render/material-skin.js'
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
  type WorldWebGlCameraFrame,
  type WorldWebGlModelMaterialScene,
  type WorldWebGlTexturedBatch,
  worldWebGlPosedScene,
  worldWebGlScenePrograms,
  worldModelEffectDraws,
  createWorldWebGlPlan,
  prepareWorldRenderTextureFrame,
  type WorldWebGlInput,
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
/**
 * Prepared programs the CPU rasterizer runs. A shaderless material carries the world's WebGL-only
 * glTF program; the CPU draws it by its base route instead (createSceneMaterialProgramSampler).
 */
function cpuPrograms(
  materials: readonly SceneRendererMaterial[],
  programs: ReadonlyMap<string, SceneMaterialPrograms>,
): [string, SceneMaterialPrograms][] {
  const shaded = new Set(materials.filter(material => material.shader !== undefined).map(material => material.id))
  return [...programs].filter(([id]) => shaded.has(id))
}

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

/** The world plan as one CPU scene; camera-facing effects use the same frame as WebGL. */
export function worldHeadlessScene(plan: WorldWebGlPlan, camera?: WorldWebGlCameraFrame): Readonly<{
  scene: SceneRendererScene
  diagnostics: readonly SceneRendererDiagnostic[]
  splats: ReadonlyMap<string, Readonly<{ batch: WorldWebGlSplatBatch; overlay: boolean }>>
  water: ReadonlyMap<string, number>
  terrain: ReadonlySet<string>
  materialLighting?: ReadonlyMap<string, Pick<SceneRendererScene, 'lights' | 'ambientLight'>>
  programs: ReadonlyMap<string, SceneMaterialPrograms>
}> {
  const primitives: SceneRendererPrimitive[] = []
  const materials: SceneRendererMaterial[] = []
  const diagnostics: SceneRendererDiagnostic[] = []
  const water = new Map<string, number>()
  const terrain = new Set<string>()
  const materialLighting = new Map<string, Pick<SceneRendererScene, 'lights' | 'ambientLight'>>()
  const programs = new Map<string, SceneMaterialPrograms>()
  const modelRig = worldMaterialLight(plan)
  const modelLighting = {
    ambientLight: modelRig.ambientColor,
    lights: [
      {
        type: 'directional' as const,
        direction: modelRig.direction,
        color: [modelRig.color[0], modelRig.color[1], modelRig.color[2]] as const,
        specularColor: modelRig.specularColor,
        useAmbientOcclusion: modelRig.useAmbientOcclusion,
      },
      ...modelRig.fills.map(fill => ({
        type: 'directional' as const,
        direction: fill.direction,
        color: fill.color,
        specularColor: [0, 0, 0] as const,
        useAmbientOcclusion: fill.useAmbientOcclusion,
      })),
      ...(plan.localLights ?? []),
    ],
  }
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
    terrainSurface = false,
  ) => {
    if (batch.positions.length < 9) return
    if (terrainSurface) terrain.add(id)
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
      shading: 'lambert',
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
  if (terrainVertices > 0)
    ground(
      'world/ground',
      {
        positions: plan.opaqueTriangles.positions.subarray(0, terrainVertices * 3),
        normals: plan.opaqueTriangles.normals.subarray(0, terrainVertices * 3),
        colors: plan.opaqueTriangles.colors.subarray(0, terrainVertices * 4),
      },
      {},
      undefined,
      undefined,
      TERRAIN_DEPTH_BIAS,
      true,
    )
  ground(
    terrainVertices === 0 ? 'world/ground' : 'world/opaque-models',
    {
      positions: plan.opaqueTriangles.positions.subarray(terrainVertices * 3),
      normals: plan.opaqueTriangles.normals.subarray(terrainVertices * 3),
      colors: plan.opaqueTriangles.colors.subarray(terrainVertices * 4),
    },
    {},
  )
  plan.texturedTriangles.forEach((batch, index) =>
    ground(
      `world/textured-${String(index)}`,
      batch,
      textured(batch),
      batch.textureCoordinates,
      batch.texture,
      index < (plan.terrainTexturedBatches ?? 0) ? TERRAIN_DEPTH_BIAS : undefined,
      index < (plan.terrainTexturedBatches ?? 0),
    ),
  )
  plan.splatTriangles.forEach((batch, index) => {
    const id = `world/splat-${String(index)}`
    splats.set(id, { batch, overlay: false })
    ground(id, batch, {}, undefined, undefined, TERRAIN_DEPTH_BIAS, true)
  })
  plan.splatOverlayTriangles.forEach((batch, index) => {
    const id = `world/splat-overlay-${String(index)}`
    splats.set(id, { batch, overlay: true })
    ground(
      id,
      batch,
      {
        alphaMode: 'blend',
        depthWrite: false,
        priority:
          transparentPriority +
          index -
          plan.splatOverlayTriangles.length -
          plan.terrainDecalTriangles.length -
          1,
      },
      undefined,
      undefined,
      undefined,
      true,
    )
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
      undefined,
      true,
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
    // Programs bind acquired texture objects by logical resources, independent of scene-table ids.
    for (const [id, prepared] of cpuPrograms(kept.materials, worldWebGlScenePrograms(plan, kept)))
      programs.set(`model-${String(index)}/${id}`, prepared)
    const own = prefixed(
      `model-${String(index)}/`,
      // WebGL consumes the palette in its vertex shader; the CPU rasterizer needs the same
      // deformation baked before prefixed() copies away the private skin association.
      scene.primitives.map(materialPosedPrimitive),
      scene.materials,
      scene.textures,
    )
    primitives.push(...own.primitives)
    materials.push(...own.materials)
    textures.push(...own.textures)
  })
  if (camera !== undefined) {
    // One primitive may have several material passes: append its scene once, not once per draw.
    const effects = new Map<WorldWebGlModelMaterialScene, Set<SceneRendererPrimitive>>()
    for (const { scene, draw } of worldModelEffectDraws(plan, camera)) {
      let selected = effects.get(scene)
      if (selected === undefined) effects.set(scene, (selected = new Set()))
      selected.add(draw.primitive)
    }
    let index = 0
    for (const [scene, selected] of effects) {
      const prefix = `effect-${String(index++)}/`
      for (const [id, prepared] of cpuPrograms(scene.materials, scene.programs)) programs.set(`${prefix}${id}`, prepared)
      const own = prefixed(prefix, [...selected].map(materialPosedPrimitive), scene.materials, scene.textures)
      primitives.push(...own.primitives)
      materials.push(...own.materials)
      textures.push(...own.textures)
    }
  } else if (plan.modelEffects.length > 0) {
    diagnostics.push({ severity: 'warning', code: 'x3.scene/world-headless-effects-camera-required',
      message: 'Camera-facing world effects require a resolved camera frame.' })
  }
  if (plan.objectLight !== undefined)
    for (const material of materials)
      if (!terrain.has(material.id) && !water.has(material.id))
        materialLighting.set(material.id, modelLighting)
  const light = worldMaterialLight(plan, 'terrain')
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
          specularColor: light.specularColor,
          useAmbientOcclusion: light.useAmbientOcclusion,
        },
        ...light.fills.map(fill => ({
          type: 'directional' as const,
          direction: fill.direction,
          color: fill.color as readonly [number, number, number],
          specularColor: [0, 0, 0] as const,
          useAmbientOcclusion: fill.useAmbientOcclusion,
        })),
        ...(plan.localLights ?? []),
      ]),
      ambientLight: light.ambientColor,
      ...(plan.renderTextureTargets === undefined ? {} : { materialContext: { time: 0, renderTextureTargets: plan.renderTextureTargets } }),
    }),
    diagnostics: Object.freeze(diagnostics),
    splats,
    water,
    terrain,
    programs,
    ...(materialLighting.size === 0 ? {} : { materialLighting }),
  })
}

export interface WorldHeadlessOptions {
  readonly visibilityBounds?: WorldVisibilityBounds
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
  const frame = createWorldWebGlCameraFrame(plan, options.width, options.height, options.camera)
  const { scene, diagnostics, splats, water, terrain, materialLighting, programs } = worldHeadlessScene(plan, frame)
  const colorization = plan.light.toneMapping?.colorization
  const colorLut = colorization === undefined ? undefined : createWorldColorLut(colorization)
  const rendered = await renderHeadless(
    {
      scene,
      camera: frame,
      viewport: { width: options.width, height: options.height },
      outputKind: 'rgba8',
      clearColor: options.visibilityBounds === undefined ? options.clearColor ?? [0, 0, 0, 1] : [0, 0, 0, 1],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    splats,
    water,
    terrain,
    materialLighting,
    new Set(scene.primitives
      .filter(p => p.id.startsWith('world/decal-') || p.id.startsWith('world/splat-overlay-'))
      .map(p => p.id)),
    options.visibilityBounds,
    programs,
    plan.light.toneMapping === undefined && plan.light.fog === undefined ? undefined : (rgba, depth) => {
      const output = new Uint8Array(rgba.length), settings = plan.light.toneMapping, fog = plan.light.fog
      const inverse = new Matrix4().fromArray(frame.viewProjection).invert(), point = new Vector3()
      const eye = frame.eyePosition
      for (let pixel = 0; pixel < depth.length; pixel++) {
        if ((pixel & 4095) === 0) options.signal?.throwIfAborted()
        const offset = pixel * 4, alpha = Math.max(0, Math.min(1, rgba[offset + 3]! / 255))
        let color = [0, 1, 2].map(channel => alpha === 0 ? 0 : rgba[offset + channel]! / (255 * alpha))
        if (fog !== undefined && fog.density > 0 && Number.isFinite(depth[pixel]) && eye !== undefined) {
          point.set(((pixel % options.width) + 0.5) / options.width * 2 - 1,
            1 - (Math.floor(pixel / options.width) + 0.5) / options.height * 2, depth[pixel]!).applyMatrix4(inverse)
          const dy = point.y - eye[1], slope = dy * fog.falloff
          const integral = fog.density * Math.hypot(point.x - eye[0], dy, point.z - eye[2]) *
            Math.exp(Math.max(-88, Math.min(88, (fog.startingHeight - eye[1]) * fog.falloff))) *
            (Math.abs(slope) < 1e-8 ? 1 : -Math.expm1(-slope) / slope)
          const amount = Math.max(0, Math.min(1, integral))
          color = color.map((value, channel) => value + (fog.color[channel]! - value) * amount)
        }
        if (settings !== undefined) {
          color = toneMapWorldColor(color, settings)
          if (colorLut !== undefined) color = sampleWorldColorLut(colorLut, color)
          if (settings.correctGamma) color = color.map(value => Math.pow(Math.max(0, value), 1 / 2.2))
        }
        for (let channel = 0; channel < 3; channel++) output[offset + channel] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[channel]!)) * 255)
        output[offset + 3] = Math.round(alpha * 255)
      }
      return output
    },
  )
  return Object.freeze({
    ...rendered,
    diagnostics: Object.freeze([...diagnostics, ...rendered.diagnostics]),
  })
}

/** Offscreen views and the final view use the same world pass, poses and material owner. */
export async function renderWorldHeadlessFrame(
  input: WorldWebGlInput,
  options: WorldHeadlessOptions,
): Promise<SceneRenderFrame> {
  const requests = input.renderTextures ?? []
  if (requests.length === 0) return renderWorldHeadless(createWorldWebGlPlan(input), options)
  const frame = prepareWorldRenderTextureFrame(input, options.signal)
  const targets = new Map<string, SceneRendererTexture>()
  const diagnostics: SceneRendererDiagnostic[] = []
  for (const view of frame.views) {
    options.signal?.throwIfAborted()
    // Secondary views never see an in-progress target or previous-frame feedback.
    const rendered = await renderWorldHeadless(createWorldWebGlPlan({ ...frame.secondaryInput, camera: view.camera }), {
      ...options, width: view.width, height: view.height, camera: view.camera, clearColor: view.clearColor,
    })
    diagnostics.push(...rendered.diagnostics)
    targets.set(view.id, { id: view.id, width: view.width, height: view.height, rgba: rendered.rgba, filter: 'linear' })
  }
  const rendered = await renderWorldHeadless(createWorldWebGlPlan({ ...frame.input, renderTextureTargets: targets }), options)
  return { ...rendered, diagnostics: [...diagnostics, ...rendered.diagnostics] }
}
