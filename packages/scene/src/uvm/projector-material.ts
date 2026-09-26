import type { SceneRendererMaterial } from '@modkit/sdk/renderer'
import { standardBlendModeName } from '@modkit/codec-kit/model-math/standard-material-glsl'
import { createRenderMaterialSampler } from '../materials/render-model.js'
import { object, array } from './values.js'
import type { SimpleEffectState } from '../render/simple-effect.js'

/**
 * Material for camera-facing particles and ribbons. A render-material keeps its full program, as
 * SC2's particle.fx shades sprites through PSMainShading: smoke opacity comes from the alpha1/alpha2
 * masks, which the single-texture simple pass drops (hard square sprite edges). Sprites have no back
 * side, so every pass is two-sided, and they take no scene light: an M3 emitter lights its sprites
 * only under its LitParts flag, which UV_game_effects does not carry yet. Colorless presentations
 * return undefined.
 */
export function effectSurfaceMaterial(
  base: SceneRendererMaterial,
  id: string,
  maxNodes: number,
  maxBytes: number,
  texturePath?: string,
  signal?: AbortSignal,
): SceneRendererMaterial | undefined {
  const simple = () => {
    const material = simpleEffectMaterial(base, id, 1, maxNodes, maxBytes, signal)
    return (
      material && {
        ...material,
        simpleEffect: {
          ...material.simpleEffect,
          doubleSided: true,
          ...(texturePath === undefined ? {} : { textureResource: texturePath }),
        },
      }
    )
  }
  if (base.shader?.id !== 'modkit.render-material.v1') return simple()
  const sampler = createRenderMaterialSampler(
    base.shader.parameters,
    { maxNodes, maxDepth: 128, maxBytes },
    signal,
  )
  if (sampler.presentation !== 'surface') return undefined
  // An emitter texture the material program never samples keeps the single-texture pass.
  if (texturePath !== undefined && !sampler.resources.includes(texturePath)) return simple()
  const model = object(base.shader.parameters['renderModel'], 'render model')
  const twoSided = (material: unknown) => {
    const standard = object(material, 'standard')
    const layers = standard['layers']
    return {
      ...standard,
      twoSided: true,
      // ponytail: every sprite unlit until effects carry the emitter's lit flag (M3 LitParts)
      unshaded: true,
      ...(layers === undefined
        ? {}
        : {
            layers: Object.fromEntries(
              Object.entries(object(layers, 'standard layers')).map(([slot, raw]) => {
                const layer = object(raw, `standard layer ${slot}`)
                // SC2's particle UV source is the atlas rectangle already emitted on UV0 by the
                // UVM particle/ribbon geometry adapter.
                return [slot, layer['uvSource'] === 6 ? { ...layer, uvSource: 0 } : layer]
              }),
            ),
          }),
    }
  }
  const renderModel = {
    ...model,
    ...(model['standard'] === undefined ? {} : { standard: twoSided(model['standard']) }),
    ...(model['composite'] === undefined
      ? {}
      : {
          composite: {
            ...object(model['composite'], 'composite'),
            passes: array(object(model['composite'], 'composite'), 'passes').map(pass => ({
              ...object(pass, 'pass'),
              material: twoSided(object(pass, 'pass')['material']),
            })),
          },
        }),
  }
  const { simpleEffect, ...rest } = base as SceneRendererMaterial & {
    simpleEffect?: unknown
  }
  void simpleEffect
  return {
    ...rest,
    id,
    doubleSided: true,
    shader: { ...base.shader, parameters: { ...base.shader.parameters, renderModel } },
  } as SceneRendererMaterial
}

/** Existing render-material vocabulary -> the simple live-effect fallback. */
function simpleEffectMaterial(
  base: SceneRendererMaterial,
  id: string,
  alpha: number,
  maxNodes: number,
  maxBytes: number,
  signal?: AbortSignal,
): (SceneRendererMaterial & { readonly simpleEffect: SimpleEffectState }) | undefined {
  if (base.shader === undefined)
    return {
      ...base,
      id,
      shading: 'unlit',
      baseColor: [1, 1, 1, alpha],
      simpleEffect: {
        blend:
          base.alphaMode === 'mask'
            ? 'alpha-test'
            : base.alphaMode === 'blend'
              ? 'blend'
              : 'opaque',
        depthTest: true,
        depthWrite: base.alphaMode !== 'blend',
        doubleSided: base.doubleSided === true,
        alphaCutoff: base.alphaMode === 'mask' ? (base.alphaCutoff ?? 0.5) : 0,
        wrapU: 'repeat',
        wrapV: 'repeat',
      },
    }
  if (base.shader.id !== 'modkit.render-material.v1')
    throw new TypeError(
      'projector requires an explicit simple material projection for this shader vocabulary',
    )
  // Own/validate before reading ordered layers; no animation is evaluated here. The pinned
  // live-effect renderer uses primary standard state and static legacy texture paths.
  const sampler = createRenderMaterialSampler(
    base.shader.parameters,
    { maxNodes, maxDepth: 128, maxBytes },
    signal,
  )
  // A distortion or terrain-projection effect has no color of its own; drawing its first layer
  // (a normal map) as a textured sprite paints stripes. The caller skips the geometry.
  if (sampler.presentation !== 'surface') return undefined
  const model = object(base.shader.parameters['renderModel'], 'render model')
  const standards =
    model['standard'] === undefined
      ? array(object(model['composite'], 'composite'), 'passes').map(
          pass => object(pass, 'pass')['material'],
        )
      : [model['standard']]
  const standard = object(standards[0], 'primary standard')
  const layers = array(model, 'layers').map(layer => object(layer, 'ordered render layer'))
  const layer =
    layers.find(candidate =>
      ['diffuse', 'albedo', 'basecolor'].includes(String(candidate['label']).toLowerCase()),
    ) ?? layers[0]
  if (layer !== undefined && typeof layer['path'] !== 'string')
    throw new TypeError('projector texture resource absent')
  const mode = standard['blendMode'],
    cutoff = standard['alphaTestThreshold']
  if (typeof mode !== 'number' || typeof cutoff !== 'number')
    throw new TypeError('projector primary state absent')
  const blend = standardBlendModeName(mode, cutoff),
    metadata = object(layer?.['metadata'] ?? {}, 'layer metadata')
  const simpleEffect: SimpleEffectState = {
    blend,
    depthTest: true,
    depthWrite: blend === 'opaque' || blend === 'alpha-test',
    doubleSided: standard['twoSided'] === true,
    alphaCutoff: blend === 'alpha-test' ? cutoff : 0,
    wrapU: metadata['wrapS'] === 'repeat' ? 'repeat' : 'clamp',
    wrapV: metadata['wrapT'] === 'repeat' ? 'repeat' : 'clamp',
    ...(layer === undefined ? {} : { textureResource: String(layer['path']) }),
  }
  // Retain the authored shader so its resources continue through the normal scoped acquisition.
  return { ...base, id, baseColor: [1, 1, 1, alpha], shading: 'unlit', simpleEffect }
}

/**
 * Animated alpha projectors need the complete SC2 material program: their alpha masks remove the
 * rectangular projection footprint. Ordinary splats retain the established single-texture path;
 * compiling every legacy projector as a full material turns unsupported transparent layers black.
 */
export function projectorMaterial(
  base: SceneRendererMaterial,
  id: string,
  alpha: number,
  maxNodes: number,
  maxBytes: number,
  signal?: AbortSignal,
): SceneRendererMaterial | undefined {
  if (base.shader?.id === 'modkit.render-material.v1') {
    const model = object(base.shader.parameters['renderModel'], 'render model')
    const standard = model['standard']
    if (standard !== undefined) {
      const layers = object(object(standard, 'standard')['layers'] ?? {}, 'standard layers')
      const animatedAlpha = ['alpha1', 'alpha2'].some(slot => {
        const raw = layers[slot]
        if (raw === undefined) return false
        const layer = object(raw, `standard layer ${slot}`)
        return ['colorAdd', 'colorMultiply', 'uvOffset', 'uvAngle', 'uvTiling'].some(key =>
          Array.isArray(object(layer[key] ?? {}, `${slot} ${key}`)['sequenceTracks']),
        )
      })
      if (animatedAlpha)
        return effectSurfaceMaterial(base, id, maxNodes, maxBytes, undefined, signal)
    }
  }
  return simpleEffectMaterial(base, id, alpha, maxNodes, maxBytes, signal)
}
