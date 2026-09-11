import type { SceneRendererTexture } from '@modkit/sdk/renderer'
import type {
  NormalMapFormat,
  StandardMaterialModel,
} from '@modkit/codec-kit/legacy/models/material'
import { classifyNormalMapFormat } from '@modkit/codec-kit/legacy/models/texture-codec'
import { decodeNormalCpu, type Vec4 } from '@modkit/codec-kit/model-math/standard-material-glsl'

export const NORMAL_SLOTS = ['normal', 'normalBlend1', 'normalBlend2'] as const
export type NormalSlot = (typeof NORMAL_SLOTS)[number]
export type NormalFormats = Readonly<Record<NormalSlot, NormalMapFormat>>
const FORMATS = ['dxt5nm', 'bc5', 'rgb8', 'luminance-alpha'] as const

/** Storage facts select this material vocabulary's MK2 normal-map convention, never a filename.
 * An explicitly authored material.normalMapFormat takes precedence when preparing the pass. */
export function textureNormalFormat(texture: SceneRendererTexture): NormalMapFormat | undefined {
  if (
    texture.channelLayout !== undefined &&
    !['r', 'rg', 'rgb', 'rgba', 'luminance', 'luminance-alpha', 'alpha'].includes(
      texture.channelLayout,
    )
  )
    throw new TypeError('invalid texture channel layout')
  if (
    texture.compression !== undefined &&
    !['none', 'bc1', 'bc2', 'bc3', 'bc4', 'bc5', 'bc6h', 'bc7'].includes(texture.compression)
  )
    throw new TypeError('invalid texture compression')
  if (texture.channelLayout === 'luminance-alpha') return 'luminance-alpha'
  if (texture.channelLayout === 'rg' || texture.compression === 'bc5')
    return classifyNormalMapFormat('bc5')
  if (texture.compression === 'bc3') return classifyNormalMapFormat('dxt5')
  if (texture.channelLayout !== undefined || texture.compression !== undefined)
    return classifyNormalMapFormat('rgba8')
  return undefined
}

export function snapshotNormalFormats(
  formats: ReadonlyMap<string, NormalMapFormat> | undefined,
): ReadonlyMap<string, NormalMapFormat> {
  const result = new Map<string, NormalMapFormat>()
  for (const [id, format] of formats ?? []) {
    if (typeof id !== 'string' || !id || !FORMATS.includes(format))
      throw new TypeError('invalid bound normal format')
    result.set(id, format)
  }
  return result
}

export function materialNormalFormats(
  material: StandardMaterialModel,
  bindings: ReadonlyMap<string, NormalMapFormat>,
): NormalFormats | undefined {
  const formats = {
    normal: material.normalMapFormat ?? 'dxt5nm',
    normalBlend1: material.normalMapFormat ?? 'dxt5nm',
    normalBlend2: material.normalMapFormat ?? 'dxt5nm',
  }
  let changed = false
  for (const slot of NORMAL_SLOTS) {
    const path = material.layers[slot]?.texturePath
    const format = path === null || path === undefined ? undefined : bindings.get(path)
    if (format !== undefined && material.normalMapFormat === undefined) {
      formats[slot] = format
      changed ||= format !== 'dxt5nm'
    }
  }
  return changed ? Object.freeze(formats) : undefined
}

/** Decode after texture filtering. Packing the sampled vector into RGB lets the unchanged shared
 * composition kernel combine independently encoded base/detail normal layers. */
export function normalTexelRgb(texel: Vec4, format: NormalMapFormat): Vec4 {
  const n = decodeNormalCpu(texel, format)
  return [n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5, texel[3]]
}

/** Per-layer counterpart of decodeNormalCpu. No prefilter conversion or normalization is added. */
export function normalLayerShader(source: string, formats: NormalFormats): string {
  const helpers: string[] = []
  for (const slot of NORMAL_SLOTS) {
    const format = formats[slot],
      name = `sceneDecode_${slot}`
    const sample = `decodeNormal(sampleLayerTexel_${slot}())`,
      constant = `decodeNormal(u_${slot}Color)`
    if (!source.includes(sample) && !source.includes(constant)) continue
    source = source
      .replaceAll(sample, `${name}(sampleLayerTexel_${slot}())`)
      .replaceAll(constant, `${name}(u_${slot}Color)`)
    const xy =
      format === 'bc5' ? 'texel.xy' : format === 'luminance-alpha' ? 'texel.xw' : 'texel.wy'
    helpers.push(
      `vec3 ${name}(vec4 texel){${format === 'rgb8' ? 'return texel.xyz*2.0-1.0;' : `vec2 xy=2.0*${xy}-1.0;return vec3(xy,sqrt(max(0.0,1.0-dot(xy,xy))));`}}`,
    )
  }
  return source.replace('void main() {', `${helpers.join('\n')}\nvoid main() {`)
}
