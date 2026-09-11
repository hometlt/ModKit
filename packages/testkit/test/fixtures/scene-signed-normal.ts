import type { JsonObject } from '@modkit/sdk'
import type { SceneRenderRequest, SceneRendererTexture } from '@modkit/sdk/renderer'
import type {
  AnimatedScalar,
  StandardMaterialLayer,
  StandardMaterialModel,
} from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import type { SceneStandardMaterial } from '../../../scene/src/materials/index.js'
import { frameRequest } from './scene-material-frame.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'

type V3 = readonly [number, number, number]
type V4 = readonly [number, number, number, number]
export type SignedNormalFilter = 'nearest' | 'linear'
interface SignedCase {
  readonly name: string
  readonly factor?: number
  readonly time?: number
  readonly mask1?: V4
  readonly mask2?: V4
  readonly weights1?: V4
  readonly weights2?: V4
  readonly secondMask?: boolean
  readonly defaults?: boolean
  readonly varyingBasis?: boolean
  readonly mixed?: boolean
  readonly environment?: 0 | 2 | 7
  readonly eye?: V3
  readonly eyeControl?: boolean
  readonly rotatedView?: boolean
  readonly perspective?: boolean
  readonly normals?: readonly [V3, V3, V3]
}

export const signedNormalCases: readonly SignedCase[] = [
  { name: 'negative-factor-selects-first-detail', factor: -0.5, environment: 7 },
  { name: 'positive-factor-selects-second-detail', factor: 0.5, environment: 7 },
  { name: 'zero-factor-keeps-base-normal', factor: 0 },
  { name: 'negative-factor-saturates-at-minus-one', factor: -2 },
  { name: 'positive-factor-saturates-at-plus-one', factor: 2 },
  { name: 'quadratic-factor-quarter-uses-one-sixteenth-weight', factor: 0.25 },
  {
    name: 'second-mask-cancels-first-mask',
    mask1: [0.4, 0.8, 0.2, 1],
    weights1: [1, 0, 0, 0],
    mask2: [0.8, 0.2, 1, 0.5],
    weights2: [-0.5, 0, 0, 0],
    secondMask: true,
  },
  {
    name: 'disabled-second-mask-still-selects-second-detail',
    factor: 0.5,
    mask2: [1, 1, 1, 1],
    weights2: [-1, 0, 0, 0],
    secondMask: false,
  },
  {
    name: 'factor-uses-all-mask-rgba-components',
    mask1: [0.2, 0.4, 0.6, 0.8],
    weights1: [-0.5, 0.25, 0.5, -0.5],
    mask2: [0.8, 0.6, 0.4, 0.2],
    weights2: [0.25, 0.5, -0.5, 0.25],
    secondMask: true,
  },
  {
    name: 'world-normalize-precedes-positive-blend-in-interpolated-tbn',
    factor: 0.5,
    varyingBasis: true,
    environment: 7,
  },
  {
    name: 'world-normalize-precedes-negative-blend-in-interpolated-tbn',
    factor: -0.5,
    varyingBasis: true,
  },
  { name: 'mixed-rgb-bc5-bc3-after-spatial-filtering', factor: 0.7, mixed: true, environment: 7 },
  {
    name: 'explicit-eye-changes-environment-without-changing-lighting',
    factor: 0.5,
    environment: 2,
    eyeControl: true,
  },
  { name: 'orthographic-lighting-eye-comes-from-inverse-view', factor: 0.5, rotatedView: true },
  { name: 'perspective-half-vector-is-evaluated-per-fragment', factor: 0.5, perspective: true },
  { name: 'absent-masks-and-weights-use-existing-defaults', defaults: true, secondMask: true },
  { name: 'animated-factor-before-zero', time: 0.25, environment: 7 },
  { name: 'animated-factor-at-zero', time: 0.5, environment: 7 },
  { name: 'animated-factor-after-zero', time: 0.75, environment: 7 },
  {
    name: 'antipodal-normal-blend-falls-back-to-positive-z',
    factor: Math.SQRT1_2,
    normals: [
      [0, 0, -1],
      [1, 0, 0],
      [0, 0, 1],
    ],
    environment: 7,
  },
  {
    name: 'finite-huge-mask-products-cancel-to-authored-base',
    mask1: [1, 1, 1, 1],
    mask2: [1, 1, 1, 1],
    weights1: [2e38, 2e38, 2e38, 2e38],
    weights2: [-2e38, -2e38, -2e38, -2e38],
    secondMask: true,
    normals: [
      [0.6, 0, 0.8],
      [-0.8, 0.6, 0],
      [0, 0.8, 0.6],
    ],
    environment: 7,
  },
  {
    name: 'finite-huge-rgb-normal-uses-stable-world-unit',
    factor: 0,
    normals: [
      [1e20, 2e20, 3e20],
      [-0.8, 0.6, 0],
      [0, 0.8, 0.6],
    ],
    environment: 7,
  },
]

const slots = ['normal', 'normalBlend1', 'normalBlend2'] as const
const flatNormals: readonly V3[] = [
  [0, 0, 1],
  [-0.8, 0.6, 0],
  [0, 0.8, 0.6],
]
const mixedPixels = [
  [
    [128, 128, 255, 255],
    [150, 128, 250, 255],
    [128, 150, 250, 255],
    [150, 150, 245, 255],
  ],
  [
    [64, 128, 0, 255],
    [80, 128, 0, 255],
    [64, 144, 0, 255],
    [80, 144, 0, 255],
  ],
  [
    [255, 200, 0, 180],
    [255, 200, 0, 200],
    [255, 215, 0, 180],
    [255, 215, 0, 200],
  ],
] as const
const light: V3 = [0.2, 1, 0.5]
const diffuse: V3 = [0.18, 0.14, 0.12]
const specular: V3 = [0.12, 0.1, 0.08]
const environmentMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.8, 1] as const
const c = Math.SQRT1_2
const view = Float32Array.of(c, 0, -c, 0, 0, 1, 0, 0, c, 0, c, 0, 0, 0, 0, 1)
const model = Float32Array.of(c, 0, c, 0, 0, 1, 0, 0, -c, 0, c, 0, 0, 0, 0, 1)

function itemAt(index: number): SignedCase {
  const item = signedNormalCases[index]
  if (item === undefined) throw new Error('unknown signed-normal fixture')
  return item
}
function weightVectors(item: SignedCase): readonly [V4, V4] {
  return [
    item.weights1 ?? [item.time === undefined ? (item.factor ?? 1) : item.time * 2 - 1, 0, 0, 0],
    item.weights2 ?? [1, 0, 0, 0],
  ]
}
function factors(item: SignedCase): NonNullable<StandardMaterialModel['normalBlendFactors']> {
  const [a, b] = weightVectors(item)
  const first: AnimatedScalar =
    item.time === undefined
      ? { value: a[0] }
      : {
          value: -1,
          track: {
            lineType: 1,
            globalSeqId: null,
            keys: [
              { frame: 0, vector: [-1] },
              { frame: 1, vector: [1] },
            ],
          },
        }
  return [
    first,
    { value: a[1] },
    { value: a[2] },
    { value: a[3] },
    { value: b[0] },
    { value: b[1] },
    { value: b[2] },
    { value: b[3] },
  ]
}
function cube(filter: SignedNormalFilter): SceneRendererTexture {
  const rgba = new Uint8Array(6 * 8 * 8 * 4)
  for (let face = 0; face < 6; face++)
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([20 + face * 20, 16 + x * 16, 24 + y * 14, 255], ((face * 8 + y) * 8 + x) * 4)
  return { id: 'environment.dds', dimension: 'cube', width: 8, height: 8, rgba, filter }
}

function signedRequest(item: SignedCase, filter: SignedNormalFilter): SceneRenderRequest {
  const base = frameRequest(1),
    template = materialProgramCases()[1],
    surface = base.scene.materials?.[0],
    primitive = base.scene.primitives[0],
    referenceLayer = template?.material.layers.diffuse
  if (
    template === undefined ||
    surface === undefined ||
    primitive === undefined ||
    referenceLayer === undefined
  )
    throw new Error('missing standard scene fixture')
  const layer = (
    slot: StandardMaterialLayer['slot'],
    value: V4,
    options: Partial<StandardMaterialLayer> = {},
  ): StandardMaterialLayer => ({
    ...referenceLayer,
    slot,
    channels: 1,
    constantColor: { value },
    wrapX: false,
    wrapY: false,
    ...options,
  })
  const normals = Object.fromEntries(
    slots.map((slot, index) => {
      const n = (item.normals ?? flatNormals)[index]
      if (n === undefined) throw new Error('missing authored normal')
      return [
        slot,
        layer(
          slot,
          [n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5, 1],
          item.mixed ? { texturePath: `${slot}.dds` } : {},
        ),
      ]
    }),
  )
  const standard: SceneStandardMaterial = {
    ...template.material,
    unshaded: false,
    specularity: 4,
    specMult: 0.4,
    normalBlendPolicy: { mode: 'signed-two-detail', secondMask: item.secondMask ?? false },
    ...(item.mixed ? {} : { normalMapFormat: 'rgb8' }),
    ...(item.defaults ? {} : { normalBlendFactors: factors(item) }),
    environmentMultipliers: [0.5, 0, 0],
    layers: {
      diffuse: layer('diffuse', [...diffuse, 1]),
      specular: layer('specular', [...specular, 1]),
      ...normals,
      ...(item.mask1 === undefined
        ? {}
        : { normalBlend1Mask: layer('normalBlend1Mask', item.mask1) }),
      ...(item.mask2 === undefined
        ? {}
        : { normalBlend2Mask: layer('normalBlend2Mask', item.mask2) }),
      ...(item.environment
        ? {
            envi: layer('envi', [1, 1, 1, 1], {
              texturePath: 'environment.dds',
              uvSource: item.environment,
              channels: 0,
              op: 2,
            }),
          }
        : {}),
    },
  }
  const textures: SceneRendererTexture[] = item.environment ? [cube(filter)] : []
  if (item.mixed)
    slots.forEach((slot, index) => {
      const pixels = mixedPixels[index]
      if (pixels === undefined) throw new Error('missing mixed normal texture')
      textures.push({
        id: `${slot}.dds`,
        width: 2,
        height: 2,
        rgba: Uint8Array.from(pixels.flat()),
        filter,
        channelLayout: index === 0 ? 'rgb' : index === 1 ? 'rg' : 'rgba',
        compression: index === 0 ? 'none' : index === 1 ? 'bc5' : 'bc3',
      })
    })
  const sourceNormals = item.varyingBasis
    ? [-0.8, 0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, -0.8, 0, 0.6]
    : [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
  const sourceTangents = item.varyingBasis
    ? [0.6, 0, 0.8, 1, 0.6, 0, -0.8, 1, 0.6, 0, -0.8, 1, 0.6, 0, 0.8, 1]
    : [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
  const positions = item.perspective
    ? Float32Array.of(-2.25, -2.25, -3, 2.25, -2.25, -3, 2.25, 2.25, -3, -2.25, 2.25, -3)
    : primitive.positions
  const projection = item.perspective
    ? Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -100.1 / 99.9, -1, 0, 0, -20 / 99.9, 0)
    : item.rotatedView
      ? view
      : base.camera.viewProjection
  return {
    ...base,
    camera: {
      viewProjection: projection,
      ...(item.rotatedView ? { viewMatrix: view } : {}),
      ...(item.environment === 2 || item.eye !== undefined
        ? { eyePosition: item.eye ?? [0, 0, 10] }
        : {}),
    },
    scene: {
      ...base.scene,
      primitives: [
        {
          ...primitive,
          positions,
          normals: Float32Array.from(sourceNormals),
          tangents: Float32Array.from(sourceTangents),
          textureCoordinates: Float32Array.of(0.37, 0.63, 0.37, 0.63, 0.37, 0.63, 0.37, 0.63),
          textureCoordinateSets: [],
          ...(item.rotatedView ? { transform: model } : {}),
        },
      ],
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
      light: { direction: light },
      materialContext: {
        time: item.time ?? 0,
        ambient: [0, 0, 0, 0],
        ...(item.environment ? { environment: { worldToEnvironment: environmentMatrix } } : {}),
      },
    },
  }
}

// Independent scalar equations: no scene normal, geometry, sampler, matrix or lighting helpers.
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v)
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const rotate = (v: V3): V3 => [c * v[0] - c * v[2], v[1], c * v[0] + c * v[2]]
const mix = (a: V3, b: V3, t: number): V3 => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
]

function decodedNormals(item: SignedCase, filter: SignedNormalFilter): readonly V3[] {
  if (!item.mixed) return item.normals ?? flatNormals
  return mixedPixels.map((pixels, slot) => {
    const sample = (channel: number) =>
      filter === 'nearest'
        ? (pixels[2][channel] ?? 0) / 127.5 - 1
        : (((pixels[0][channel] ?? 0) * 0.76 + (pixels[1][channel] ?? 0) * 0.24) * 0.24 +
            ((pixels[2][channel] ?? 0) * 0.76 + (pixels[3][channel] ?? 0) * 0.24) * 0.76) /
            127.5 -
          1
    if (slot === 0) return [sample(0), sample(1), sample(2)] as const
    const x = sample(slot === 1 ? 0 : 3),
      y = sample(1)
    return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))] as const
  })
}
function worldNormal(item: SignedCase, filter: SignedNormalFilter, x: number): V3 {
  const positionX = (x + 0.5) / 16 - 1
  const basis = (n: V3): V3 => {
    const s = item.varyingBasis ? (0.8 * positionX) / 0.75 : 0,
      co = item.varyingBasis ? 0.6 : 1
    const transformed: V3 = [co * n[0] + s * n[2], n[1], -s * n[0] + co * n[2]]
    return unit(item.rotatedView ? rotate(transformed) : transformed)
  }
  const [base, first, second] = decodedNormals(item, filter).map(basis)
  if (base === undefined || first === undefined || second === undefined)
    throw new Error('missing independent normal')
  const [w1, w2] = item.defaults
    ? [[1, 0, 0, 0] as const, [1, 0, 0, 0] as const]
    : weightVectors(item)
  const mask1 = item.mask1 ?? [1, 0, 0, 0],
    mask2 = item.mask2 ?? [1, 0, 0, 0]
  const raw =
    w1.reduce((sum, value, i) => sum + value * (mask1[i] ?? 0), 0) +
    (item.secondMask ? w2.reduce((sum, value, i) => sum + value * (mask2[i] ?? 0), 0) : 0)
  const factor = Math.max(-1, Math.min(1, raw))
  const blended = mix(base, factor < 0 ? first : second, factor * factor)
  // Only the final blend has the explicit float32 cancellation tolerance.
  return Math.hypot(...blended) <= 1e-6 ? [0, 0, 1] : unit(blended)
}
function expectedEnvironment(item: SignedCase, n: V3, p: V3, filter: SignedNormalFilter): V3 {
  const transformed: V3 = [n[0], n[1], n[2] + 0.8]
  let direction = transformed
  if (item.environment === 2) {
    const eye = item.eye ?? [0, 0, 10],
      incident = unit([p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]])
    const v: V3 = [incident[0], incident[1], incident[2] + 0.8],
      factor = 2 * dot(v, transformed)
    direction = [
      v[0] - factor * transformed[0],
      v[1] - factor * transformed[1],
      v[2] - factor * transformed[2],
    ]
  }
  if (direction[2] <= Math.max(Math.abs(direction[0]), Math.abs(direction[1])))
    throw new Error(`${item.name}: independent cube oracle requires +Z interior`)
  const u = (direction[0] / direction[2] + 1) * 0.5,
    v = (-direction[1] / direction[2] + 1) * 0.5
  const tx = filter === 'nearest' ? Math.floor(u * 8) : u * 8 - 0.5,
    ty = filter === 'nearest' ? Math.floor(v * 8) : v * 8 - 0.5
  if (Math.min(tx, ty) < 0 || Math.max(tx, ty) > 7)
    throw new Error('signed normal fixture reached a cube seam')
  return [100 / 255, (16 + tx * 16) / 255, (24 + ty * 14) / 255]
}
export function signedNormalExpected(
  index: number,
  filter: SignedNormalFilter,
  x: number,
  y: number,
): readonly number[] {
  const item = itemAt(index),
    n = worldNormal(item, filter, x),
    lightDirection = unit(light)
  let p: V3 = item.perspective
    ? [3 * ((x + 0.5) / 16 - 1), 3 * (1 - (y + 0.5) / 16), -3]
    : [(x + 0.5) / 16 - 1, 1 - (y + 0.5) / 16, 0.1]
  if (item.rotatedView) p = rotate(p)
  const eye: V3 = item.perspective
    ? unit([-p[0], -p[1], -p[2]])
    : item.rotatedView
      ? rotate([0, 0, 1])
      : [0, 0, 1]
  const h = unit([
    eye[0] + lightDirection[0],
    eye[1] + lightDirection[1],
    eye[2] + lightDirection[2],
  ])
  const lambert = Math.max(0, dot(n, lightDirection)),
    spec = Math.max(0, dot(h, n)) ** 4 * 0.4
  const environment = item.environment ? expectedEnvironment(item, n, p, filter) : [0, 0, 0]
  return [0, 1, 2]
    .map(
      channel =>
        (lambert > 0
          ? ((diffuse[channel] ?? 0) + (specular[channel] ?? 0) * spec) * lambert +
            (environment[channel] ?? 0) * 0.5
          : 0) * 255,
    )
    .concat(255)
}

async function render(item: SignedCase, filter: SignedNormalFilter) {
  const request = signedRequest(item, filter),
    cpu = await renderHeadless(request),
    gpu = await renderBrowser(request)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    diagnostics: [...cpu.diagnostics, ...gpu.diagnostics],
    triangles: [cpu.statistics.triangles, gpu.statistics.triangles],
  }
}
export async function signedNormalFrameProbe(index: number, filter: SignedNormalFilter) {
  const item = itemAt(index),
    result = await render(item, filter)
  if (!item.eyeControl) return result
  const changed = await render({ ...item, eye: [4, -2, 5] }, filter)
  const lighting = await render({ ...item, environment: 0, eye: [0, 0, 10] }, filter)
  const lightingChangedEye = await render({ ...item, environment: 0, eye: [4, -2, 5] }, filter)
  return { ...result, changed, lighting, lightingChangedEye }
}
