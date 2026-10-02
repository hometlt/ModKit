/**
 * A map world rendered without a GPU (MW7): the world plan as one headless scene. The models stand
 * as the plan places them, with the materials and programs the world draws them with; the ground,
 * decals and water are primitives of their batches, with their team colours and blending. A blended
 * ground draws its strongest layer, not the blend: the headless renderer has no splat program. It is
 * the viewer's geometry, textures and light, not its picture: no shadows, tone mapping, screen
 * effects or texture filtering, so colours come out brighter than the viewer shows them.
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
import {
  createWorldWebGlCameraFrame,
  worldMaterialLight,
  type WorldBatchTeamColor,
  type WorldWebGlBatch,
  type WorldWebGlCamera,
  type WorldWebGlPlan,
  type WorldWebGlTexturedBatch,
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

/** The world plan as one scene of the headless renderer. */
export function worldHeadlessScene(plan: WorldWebGlPlan): Readonly<{
  scene: SceneRendererScene
  diagnostics: readonly SceneRendererDiagnostic[]
}> {
  const primitives: SceneRendererPrimitive[] = []
  const materials: SceneRendererMaterial[] = []
  const diagnostics: SceneRendererDiagnostic[] = []
  // batch textures by object: two batches' textures may share an id and not their texels
  const textures: SceneRendererTexture[] = []
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
  ground('world/ground', plan.opaqueTriangles, {})
  plan.texturedTriangles.forEach((batch, index) =>
    ground(
      `world/textured-${String(index)}`,
      batch,
      textured(batch),
      batch.textureCoordinates,
      batch.texture,
    ),
  )
  let approximated = 0
  plan.splatTriangles.forEach((batch, index) => {
    // the layer that holds most of the batch's weight stands for the blend
    const totals = batch.textures.map((_, layer) => {
      const weights = layer < 4 ? batch.textureWeights0 : batch.textureWeights1
      let total = 0
      for (let vertex = layer % 4; vertex < weights.length; vertex += 4) total += weights[vertex]!
      return total
    })
    const strongest = totals.indexOf(Math.max(...totals))
    if (strongest < 0) return
    if (batch.textures.length > 1) approximated += 1
    ground(
      `world/splat-${String(index)}`,
      batch,
      {},
      batch.textureCoordinates[strongest],
      batch.textures[strongest],
    )
  })
  if (approximated > 0)
    diagnostics.push({
      severity: 'information',
      code: 'x3.scene/world-headless-splat-strongest-layer',
      message: `${String(approximated)} blended ground batches drawn by their strongest layer`,
    })
  plan.terrainDecalTriangles.forEach((batch, index) =>
    ground(
      `world/decal-${String(index)}`,
      batch,
      { alphaMode: 'blend', depthWrite: false },
      batch.textureCoordinates,
      batch.texture,
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
  ground('world/transparent', plan.transparentTriangles, { alphaMode: 'blend', depthWrite: false })
  plan.modelMaterialScenes.forEach((scene, index) => {
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
  const { scene, diagnostics } = worldHeadlessScene(plan)
  const frame = createWorldWebGlCameraFrame(plan, options.width, options.height, options.camera)
  const rendered = await renderHeadless({
    scene,
    camera: frame,
    viewport: { width: options.width, height: options.height },
    outputKind: 'rgba8',
    clearColor: options.clearColor ?? [0, 0, 0, 1],
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return Object.freeze({
    ...rendered,
    diagnostics: Object.freeze([...diagnostics, ...rendered.diagnostics]),
  })
}
