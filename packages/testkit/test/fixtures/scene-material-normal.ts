import type { JsonObject } from '@modkit/sdk'
import type { SceneRenderRequest, SceneRendererTexture } from '@modkit/sdk/renderer'
import type {
  NormalMapFormat,
  StandardMaterialModel,
} from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'
import { frameRequest } from './scene-material-frame.js'

const slots = ['normal', 'normalBlend1', 'normalBlend2'] as const
const encodings: readonly NormalMapFormat[] = ['bc5', 'dxt5nm', 'luminance-alpha']
export const normalFrameCases = [
  'mixed-base-bc5',
  'mixed-base-dxt5nm',
  'mixed-base-luminance-alpha',
  'rgb8-storage',
  'authored-format-overrides-storage',
] as const

function storage(
  format: NormalMapFormat,
): Pick<SceneRendererTexture, 'channelLayout' | 'compression'> {
  switch (format) {
    case 'bc5':
      return { channelLayout: 'rg', compression: 'bc5' }
    case 'dxt5nm':
      return { channelLayout: 'rgba', compression: 'bc3' }
    case 'luminance-alpha':
      return { channelLayout: 'luminance-alpha', compression: 'none' }
    case 'rgb8':
      return { channelLayout: 'rgb', compression: 'none' }
  }
}

function pixels(format: NormalMapFormat, layer: number) {
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const a = 80 + x * 12 + layer * 4,
        b = 76 + y * 14 - layer * 3
      const texel =
        format === 'bc5'
          ? [a, b, 0, 255]
          : format === 'luminance-alpha'
            ? [a, a, a, b]
            : format === 'dxt5nm'
              ? [255, b, 17, a]
              : [a, b, 160 + y * 10, 255]
      rgba.set(texel, (y * 8 + x) * 4)
    }
  return rgba
}

/** Equivalent two-channel fields use different channel storage. Their z component must be
 * reconstructed after spatial filtering; preconverting the image to RGB is observably wrong. */
function normalRequest(
  index: number,
  filter: 'nearest' | 'linear',
  reference: boolean,
): SceneRenderRequest {
  const source = materialProgramCases().findIndex(item => item.name === 'layer-normal')
  const base = frameRequest(source, filter),
    fixture = materialProgramCases()[source]
  const surface = base.scene.materials?.[0],
    normal = fixture?.material.layers.normal,
    diffuse = fixture?.material.layers.diffuse
  if (
    surface === undefined ||
    fixture === undefined ||
    normal === undefined ||
    diffuse === undefined
  )
    throw new Error('missing normal frame fixture')
  const rgb = index >= 3
  const standard: StandardMaterialModel = {
    ...fixture.material,
    ...(reference || index === 4 ? { normalMapFormat: rgb ? 'rgb8' : 'dxt5nm' } : {}),
    layers: {
      diffuse,
      ...Object.fromEntries(
        slots.map(slot => [slot, { ...normal, slot, texturePath: `${slot}.dds` }]),
      ),
    },
    normalBlendFactors: [
      { value: 0.35 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0.6 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
    ],
  }
  const textures = slots.map((slot, layer) => {
    const format = rgb ? 'rgb8' : reference ? 'dxt5nm' : encodings[(index + layer) % 3]
    if (format === undefined) throw new Error('missing normal encoding')
    return {
      id: `${slot}.dds`,
      width: 8,
      height: 8,
      filter,
      rgba: pixels(format, layer),
      ...(reference ? {} : storage(index === 4 ? 'dxt5nm' : format)),
    }
  })
  return {
    ...base,
    scene: {
      ...base.scene,
      materials: [
        {
          ...surface,
          shader: {
            id: 'modkit.render-material.v1',
            parameters: snapshotJson(
              { renderModel: { version: 1, standard } },
              materialBudget,
            ) as JsonObject,
          },
          textureBindings: textures.map(texture => ({
            resourceId: texture.id,
            textureId: texture.id,
          })),
        },
      ],
      textures,
    },
  }
}

export async function normalFrameProbe(index: number, filter: 'nearest' | 'linear') {
  const request = normalRequest(index, filter, false)
  const cpu = await renderHeadless(request),
    gpu = await renderBrowser(request)
  const reference = await renderHeadless(normalRequest(index, filter, true))
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    baseline: Array.from(reference.rgba),
    diagnostics: gpu.diagnostics,
  }
}
