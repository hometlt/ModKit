import type { JsonObject } from '@modkit/sdk'
import type { SceneRenderRequest } from '@modkit/sdk/renderer'
import type { StandardMaterialLayer } from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import type { SceneStandardMaterial } from '../../../scene/src/materials/index.js'
import { frameRequest } from './scene-material-frame.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'

type V3 = readonly [number, number, number]
type V4 = readonly [number, number, number, number]
type Basis = 'identity' | 'rotated' | 'mirrored' | 'diagonal' | 'degenerate'
export type TangentFilter = 'nearest' | 'linear'
interface TangentCase {
  readonly name: string
  readonly texCoord?: 0 | 1 | 2 | 3 | 4
  readonly basis: Basis
  readonly nonuniform?: boolean
  readonly authored?: boolean
  readonly missingSelected?: boolean
  readonly missingNormals?: boolean
  readonly composite?: readonly [0 | 1, 0 | 1]
}

export const tangentCases: readonly TangentCase[] = [
  { name: 'absent-policy-keeps-uv0-generation', basis: 'identity' },
  { name: 'explicit-uv0-identity', texCoord: 0, basis: 'identity' },
  { name: 'rotated-uv1-y-tangent-negative-x-bitangent', texCoord: 1, basis: 'rotated' },
  { name: 'mirrored-uv1-negative-x-tangent-negative-handedness', texCoord: 1, basis: 'mirrored' },
  { name: 'uv2-diagonal-tangent', texCoord: 2, basis: 'diagonal' },
  { name: 'uv3-rotated-tangent', texCoord: 3, basis: 'rotated' },
  { name: 'uv4-mirrored-tangent', texCoord: 4, basis: 'mirrored' },
  {
    name: 'nonuniform-model-transforms-selected-diagonal-tangent',
    texCoord: 1,
    basis: 'diagonal',
    nonuniform: true,
  },
  {
    name: 'authored-tangent-overrides-selected-rotated-uv1',
    texCoord: 1,
    basis: 'rotated',
    authored: true,
  },
  {
    name: 'authored-tangent-permits-missing-selected-uv4',
    texCoord: 4,
    basis: 'mirrored',
    authored: true,
    missingSelected: true,
  },
  {
    name: 'authored-tangent-survives-normal-generation-and-missing-uv4',
    texCoord: 4,
    basis: 'mirrored',
    authored: true,
    missingSelected: true,
    missingNormals: true,
  },
  {
    name: 'degenerate-selected-uv1-uses-geometric-fallback-warning',
    texCoord: 1,
    basis: 'degenerate',
  },
  {
    name: 'composite-uv0-then-uv1-keeps-distinct-generated-frames',
    basis: 'rotated',
    composite: [0, 1],
  },
  {
    name: 'composite-uv1-then-uv0-keeps-distinct-generated-frames',
    basis: 'rotated',
    composite: [1, 0],
  },
  {
    name: 'missing-selected-uv1-rejects-generation',
    texCoord: 1,
    basis: 'rotated',
    missingSelected: true,
  },
]

const color: V3 = [0.55, 0.4, 0.25]
const light: V3 = [0.4, 0.6, 0.8]
const normalPixels = [
  [204, 153, 230, 255],
  [179, 179, 230, 255],
  [191, 140, 242, 255],
  [153, 166, 242, 255],
] as const
const uv0 = [0, 0, 1, 0, 1, 1, 0, 1] as const
const uv = (basis: Basis): Float32Array =>
  Float32Array.from(
    basis === 'rotated'
      ? [0, 1, 0, 0, 1, 0, 1, 1]
      : basis === 'mirrored'
        ? [1, 0, 0, 0, 0, 1, 1, 1]
        : basis === 'diagonal'
          ? [0, 0, 1, -1, 2, 0, 1, 1]
          : basis === 'degenerate'
            ? [0, 0, 0, 0, 0, 0, 0, 0]
            : uv0,
  )
function itemAt(index: number): TangentCase {
  const item = tangentCases[index]
  if (item === undefined) throw new Error('unknown tangent fixture')
  return item
}

function requestFor(item: TangentCase, filter: TangentFilter): SceneRenderRequest {
  const base = frameRequest(1),
    primitive = base.scene.primitives[0],
    surface = base.scene.materials?.[0],
    template = materialProgramCases()[1],
    reference = template?.material.layers.diffuse
  if (
    primitive === undefined ||
    surface === undefined ||
    template === undefined ||
    reference === undefined
  )
    throw new Error('missing material frame template')
  const layer = (
    slot: StandardMaterialLayer['slot'],
    value: V4,
    texture = false,
  ): StandardMaterialLayer => ({
    ...reference,
    slot,
    constantColor: { value },
    channels: 1,
    uvSource: 0,
    texturePath: texture ? 'normal.dds' : null,
    wrapX: false,
    wrapY: false,
  })
  const standard = (texCoord: number | undefined, blendMode = 0): SceneStandardMaterial => ({
    ...template.material,
    blendMode,
    unshaded: false,
    specMult: 0,
    normalMapFormat: 'rgb8',
    normalBlendPolicy: { mode: 'signed-two-detail', secondMask: false },
    normalBlendFactors: [
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
      { value: 0 },
    ],
    ...(texCoord === undefined ? {} : { tangentGeneration: { texCoord } }),
    layers: {
      diffuse: layer('diffuse', [...color, 1]),
      normal: layer('normal', [0.5, 0.5, 1, 1], true),
      normalBlend1: layer('normalBlend1', [0.5, 0.5, 1, 1]),
      normalBlend2: layer('normalBlend2', [0.5, 0.5, 1, 1]),
    },
  })
  const renderModel =
    item.composite === undefined
      ? { version: 1, standard: standard(item.texCoord) }
      : {
          version: 1,
          composite: {
            priority: 0,
            passes: [
              { material: standard(item.composite[0]), alphaFactor: { value: 1 } },
              { material: standard(item.composite[1], 1), alphaFactor: { value: 0.35 } },
            ],
          },
        }
  const selected = item.texCoord ?? 1
  return {
    ...base,
    ...(item.nonuniform
      ? {
          camera: {
            viewProjection: Float32Array.of(0.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
          },
        }
      : {}),
    scene: {
      ...base.scene,
      primitives: [
        {
          ...primitive,
          ...(!item.missingNormals
            ? { normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1) }
            : {}),
          ...(item.authored
            ? { tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1) }
            : {}),
          // A different valid UV0 must not replace the explicitly selected degenerate UV1.
          textureCoordinates: uv(item.basis === 'degenerate' ? 'rotated' : 'identity'),
          textureCoordinateSets: item.missingSelected
            ? []
            : [{ set: selected, coordinates: uv(item.basis) }],
          ...(item.nonuniform
            ? { transform: Float32Array.of(2, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) }
            : {}),
        },
      ],
      materials: [
        {
          ...surface,
          shader: {
            id: 'modkit.render-material.v1',
            parameters: snapshotJson({ renderModel }, materialBudget) as JsonObject,
          },
          textureBindings: [{ resourceId: 'normal.dds', textureId: 'normal.dds' }],
        },
      ],
      textures: [
        {
          id: 'normal.dds',
          width: 2,
          height: 2,
          rgba: Uint8Array.from(normalPixels.flat()),
          filter,
          channelLayout: 'rgb',
          compression: 'none',
        },
      ],
      light: { direction: light },
      materialContext: { time: 0, ambient: [0, 0, 0, 0] },
    },
  }
}

// Independent analytic quad geometry and texture equations; no production math or normal helpers.
const unit = (v: V3): V3 => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
function normalAt(item: TangentCase, filter: TangentFilter, x: number, y: number): V3 {
  const baseU = (x + 0.5 - 4) / 24,
    baseV = (28 - y - 0.5) / 24,
    u = item.basis === 'degenerate' ? baseV : baseU,
    v = item.basis === 'degenerate' ? 1 - baseU : baseV
  const sample = (channel: number) => {
    const value = (tx: number, ty: number) =>
      normalPixels[Math.max(0, Math.min(1, ty)) * 2 + Math.max(0, Math.min(1, tx))]?.[channel] ?? 0
    if (filter === 'nearest') return value(Math.floor(u * 2), Math.floor(v * 2))
    const tx = u * 2 - 0.5,
      ty = v * 2 - 0.5,
      left = Math.floor(tx),
      bottom = Math.floor(ty),
      fx = tx - left,
      fy = ty - bottom
    return (
      (value(left, bottom) * (1 - fx) + value(left + 1, bottom) * fx) * (1 - fy) +
      (value(left, bottom + 1) * (1 - fx) + value(left + 1, bottom + 1) * fx) * fy
    )
  }
  return [sample(0) / 127.5 - 1, sample(1) / 127.5 - 1, sample(2) / 127.5 - 1]
}
function lit(item: TangentCase, n: V3, texCoord: number): number {
  const basis =
    item.authored || texCoord === 0 || item.basis === 'degenerate' ? 'identity' : item.basis
  const tangent: V3 =
    basis === 'rotated'
      ? [0, 1, 0]
      : basis === 'mirrored'
        ? [-1, 0, 0]
        : basis === 'diagonal'
          ? unit(item.nonuniform ? [2, 0.5, 0] : [1, 1, 0])
          : [1, 0, 0]
  const sign = basis === 'mirrored' ? -1 : 1
  const bitangent: V3 = [-tangent[1] * sign, tangent[0] * sign, 0]
  const normal = unit([
    tangent[0] * n[0] + bitangent[0] * n[1],
    tangent[1] * n[0] + bitangent[1] * n[1],
    n[2],
  ])
  const l = unit(light)
  return Math.max(0, normal[0] * l[0] + normal[1] * l[1] + normal[2] * l[2])
}
export function tangentExpected(
  index: number,
  filter: TangentFilter,
  x: number,
  y: number,
): readonly number[] {
  const item = itemAt(index),
    n = normalAt(item, filter, x, y)
  const illumination =
    item.composite === undefined
      ? lit(item, n, item.texCoord ?? 0)
      : lit(item, n, item.composite[0]) * 0.65 + lit(item, n, item.composite[1]) * 0.35
  return color.map(value => value * illumination * 255).concat(255)
}
export async function tangentFrameProbe(index: number, filter: TangentFilter) {
  const request = requestFor(itemAt(index), filter),
    cpu = await renderHeadless(request),
    gpu = await renderBrowser(request)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    cpuDiagnostics: cpu.diagnostics,
    gpuDiagnostics: gpu.diagnostics,
    triangles: [cpu.statistics.triangles, gpu.statistics.triangles],
  }
}
export async function tangentFailureProbe(index: number, filter: TangentFilter) {
  const request = requestFor(itemAt(index), filter)
  const failure = async (render: typeof renderHeadless) => {
    try {
      await render(request)
      return null
    } catch (error) {
      return error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'unknown', message: String(error) }
    }
  }
  return { cpu: await failure(renderHeadless), gpu: await failure(renderBrowser) }
}
