/**
 * A map world rendered without a GPU (MW7): the world plan as one headless scene. The models stand
 * as the plan places them, with the materials and programs the world draws them with; the ground,
 * decals and water are primitives of their batches. A blended ground draws its strongest layer, not
 * the blend: the headless renderer has no splat program.
 */
import type {
  SceneRenderFrame,
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererScene,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { renderHeadless } from '../render/headless.js'
import {
  createWorldWebGlCameraFrame,
  worldMaterialLight,
  type WorldWebGlBatch,
  type WorldWebGlCamera,
  type WorldWebGlPlan,
} from './webgl.js'

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
  const textures = new Map<string, SceneRendererTexture>()
  const diagnostics: SceneRendererDiagnostic[] = []
  const ground = (
    id: string,
    batch: WorldWebGlBatch,
    material: Omit<SceneRendererMaterial, 'id' | 'baseColor'>,
    textureCoordinates?: Float32Array,
    texture?: SceneRendererTexture,
  ) => {
    if (batch.positions.length < 9) return
    if (texture !== undefined) textures.set(texture.id, texture)
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
      ...(texture === undefined ? {} : { baseColorTexture: texture.id }),
    })
  }
  ground('world/ground', plan.opaqueTriangles, {})
  plan.texturedTriangles.forEach((batch, index) =>
    ground(
      `world/textured-${String(index)}`,
      batch,
      {
        ...(batch.alphaCutoff === undefined || batch.alphaCutoff <= 0
          ? {}
          : { alphaMode: 'mask' as const, alphaCutoff: batch.alphaCutoff }),
        ...(batch.unlit === true ? { shading: 'unlit' as const } : {}),
      },
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
      { alphaMode: 'blend', depthWrite: false },
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
    for (const texture of own.textures) textures.set(texture.id, texture)
  })
  const light = worldMaterialLight(plan)
  return Object.freeze({
    scene: Object.freeze({
      primitives: Object.freeze(primitives),
      materials: Object.freeze(materials),
      textures: Object.freeze([...textures.values()]),
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
