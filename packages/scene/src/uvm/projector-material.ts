import type { SceneRendererMaterial } from '@modkit/sdk/renderer'
import { standardBlendModeName } from '@modkit/codec-kit/model-math/standard-material-glsl'
import { createRenderMaterialSampler } from '../materials/render-model.js'
import { object, array } from './values.js'
import type { SimpleEffectState } from '../render/simple-effect.js'

/** Existing render-material vocabulary -> the simple live-effect pass. This is deliberately
 * independent of format: M3 already publishes the exact ordered legacy layer list here. */
export function projectorMaterial(
  base: SceneRendererMaterial,
  id: string,
  alpha: number,
  maxNodes: number,
  maxBytes: number,
  signal?: AbortSignal,
): SceneRendererMaterial & { readonly simpleEffect: SimpleEffectState } {
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
  createRenderMaterialSampler(base.shader.parameters, { maxNodes, maxDepth: 128, maxBytes }, signal)
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
