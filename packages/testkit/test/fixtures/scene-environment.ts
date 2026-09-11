import type { JsonObject } from '@modkit/sdk'
import type { SceneRenderRequest, SceneRendererTexture } from '@modkit/sdk/renderer'
import type {
  StandardMaterialLayer,
  StandardMaterialModel,
} from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { frameRequest } from './scene-material-frame.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'
import { cubeRequest } from './scene-cube.js'

type Vec3 = readonly [number, number, number]
export type EnvironmentFilter = 'nearest' | 'linear'
type NormalKind = 'none' | 'rgb' | 'bc5' | 'bc3' | 'handed' | 'spatial' | 'detail-zero'
interface EnvironmentCase {
  readonly name: string
  readonly source: 2 | 7
  readonly normal: NormalKind
  readonly face: number
  readonly linearFace?: number
  readonly modelRotation?: boolean
  readonly cameraRotation?: boolean
  readonly negativeTangent?: boolean
  readonly eye?: Vec3
  readonly environment?: readonly number[]
  readonly parallax?: number
  readonly normalOffset?: number
  readonly cubeUv?: boolean
  readonly mask?: boolean
  readonly uvProjection?: boolean
  readonly normalWorldUv?: boolean
  readonly flatGeometry?: boolean
  readonly invariant?: 'camera' | 'storage' | 'cube-uv' | 'uv-projection'
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const
const quarterTurn = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const
const rotatedScale = [0, 0, -0.75, 0, 0, 1.25, 0, 0, 1.5, 0, 0, 0, 0, 0, 0, 1] as const
const translateNormal = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.35, 0.19, 0, 1] as const
const translateReflection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.15, 0.1, 0.05, 1] as const
const uvProjection = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0.8, 0.1, 0, 1] as const
const cancelNormal = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1] as const
const detailFrame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, -0.1, 0.15, 1] as const

export const environmentCases: readonly EnvironmentCase[] = [
  { name: 'world-normal', source: 7, normal: 'none', face: 4 },
  { name: 'world-reflection', source: 2, normal: 'none', face: 0 },
  { name: 'rgb-normal-authored-tbn', source: 7, normal: 'rgb', face: 0 },
  {
    name: 'equivalent-bc5-bc3-normal-storage',
    source: 7,
    normal: 'bc5',
    face: 0,
    invariant: 'storage',
  },
  {
    name: 'negative-tangent-handedness',
    source: 7,
    normal: 'handed',
    negativeTangent: true,
    face: 3,
  },
  {
    name: 'model-rotation-turns-world-tbn',
    source: 7,
    normal: 'rgb',
    modelRotation: true,
    face: 2,
  },
  {
    name: 'camera-rotation-preserves-world-normal',
    source: 7,
    normal: 'rgb',
    cameraRotation: true,
    face: 0,
    invariant: 'camera',
  },
  {
    name: 'camera-rotation-preserves-explicit-world-eye',
    source: 2,
    normal: 'none',
    cameraRotation: true,
    face: 0,
    invariant: 'camera',
  },
  {
    name: 'observer-orbit-changes-reflection',
    source: 2,
    normal: 'none',
    eye: [2, 1, 10],
    face: 0,
  },
  {
    name: 'environment-rotation-and-anisotropic-scale',
    source: 7,
    normal: 'none',
    environment: rotatedScale,
    face: 0,
  },
  {
    name: 'environment-translation-applies-to-normal-with-w1',
    source: 7,
    normal: 'none',
    environment: translateNormal,
    face: 4,
  },
  {
    name: 'environment-affine-reflection-keeps-transformed-lengths',
    source: 2,
    normal: 'none',
    environment: translateReflection,
    face: 0,
  },
  {
    name: 'parallax-shifts-normal-map-and-envi-ignores-cube-uv',
    source: 7,
    normal: 'spatial',
    parallax: 0.4,
    cubeUv: true,
    face: 0,
    invariant: 'cube-uv',
  },
  {
    name: 'envi-mask-ignores-cube-uv-but-normal-offset-remains-active',
    source: 7,
    normal: 'spatial',
    normalOffset: -0.2,
    cubeUv: true,
    mask: true,
    face: 0,
    invariant: 'cube-uv',
  },
  {
    name: 'uv-projection-frame-does-not-move-world-environment',
    source: 7,
    normal: 'rgb',
    uvProjection: true,
    face: 0,
    invariant: 'uv-projection',
  },
  {
    name: 'zero-environment-direction-uses-positive-z-fallback',
    source: 7,
    normal: 'none',
    flatGeometry: true,
    environment: cancelNormal,
    face: 4,
  },
  {
    name: 'zero-intermediate-detail-normal-keeps-next-blend-defined',
    source: 7,
    normal: 'detail-zero',
    flatGeometry: true,
    environment: detailFrame,
    face: 4,
  },
]

function fixture(index: number): EnvironmentCase {
  const item = environmentCases[index]
  if (item === undefined) throw new Error('unknown environment fixture')
  return item
}

function normalPixels(kind: NormalKind): readonly (readonly number[])[] {
  if (kind === 'spatial')
    return [
      [230, 153, 204, 255],
      [128, 128, 255, 255],
    ]
  if (kind === 'bc5')
    return [
      [204, 153, 0, 255],
      [204, 153, 0, 255],
    ]
  if (kind === 'bc3')
    return [
      [255, 153, 0, 204],
      [255, 153, 0, 204],
    ]
  if (kind === 'handed')
    return [
      [128, 230, 204, 255],
      [128, 230, 204, 255],
    ]
  return [
    [204, 153, 230, 255],
    [204, 153, 230, 255],
  ]
}

function cubeTexture(filter: EnvironmentFilter): SceneRendererTexture {
  const rgba = new Uint8Array(6 * 8 * 8 * 4)
  for (let face = 0; face < 6; face++)
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        rgba.set([24 + face * 30, 20 + x * 24, 32 + y * 20, 255], ((face * 8 + y) * 8 + x) * 4)
  return { id: 'environment.dds', dimension: 'cube', width: 8, height: 8, rgba, filter }
}

function normalTexture(kind: NormalKind, filter: EnvironmentFilter): SceneRendererTexture {
  return {
    id: 'normal.dds',
    width: 2,
    height: 1,
    rgba: Uint8Array.from(normalPixels(kind).flat()),
    filter,
    channelLayout: kind === 'bc5' ? 'rg' : kind === 'bc3' ? 'rgba' : 'rgb',
    compression: kind === 'bc5' ? 'bc5' : kind === 'bc3' ? 'bc3' : 'none',
  }
}

function request(item: EnvironmentCase, filter: EnvironmentFilter): SceneRenderRequest {
  const base = frameRequest(1),
    template = materialProgramCases()[1],
    primitive = base.scene.primitives[0],
    surface = base.scene.materials?.[0],
    layer = template?.material.layers.diffuse
  if (
    template === undefined ||
    primitive === undefined ||
    surface === undefined ||
    layer === undefined
  )
    throw new Error('missing standard scene fixture')
  const makeLayer = (
    slot: StandardMaterialLayer['slot'],
    options: Partial<StandardMaterialLayer> = {},
  ): StandardMaterialLayer => ({
    ...layer,
    slot,
    channels: 0,
    constantColor: { value: [1, 1, 1, 1] },
    ...options,
  })
  const cubeLayer = makeLayer(item.mask ? 'enviMask' : 'envi', {
    texturePath: 'environment.dds',
    uvSource: item.source,
    op: 2,
    ...(item.cubeUv
      ? {
          uvOffset: { value: [0.43, -0.27] },
          uvTiling: { value: [2.3, 0.7] },
          uvAngle: { value: [0.3, -0.6, 1.1] },
          flipbook: { rows: 3, cols: 4, frame: { value: 7 } },
        }
      : {}),
  })
  const standard: StandardMaterialModel = {
    ...template.material,
    environmentMultipliers: [1, 0, 0],
    ...(item.normal === 'detail-zero'
      ? {
          normalMapFormat: 'rgb8' as const,
          normalBlendFactors: [
            { value: 0.5 },
            { value: 0 },
            { value: 0 },
            { value: 0 },
            { value: 0.5 },
            { value: 0 },
            { value: 0 },
            { value: 0 },
          ] as const,
        }
      : {}),
    ...(item.parallax !== undefined ? { parallaxHeight: { value: item.parallax } } : {}),
    layers: {
      diffuse: makeLayer('diffuse', { constantColor: { value: [0, 0, 0, 1] } }),
      ...(item.mask
        ? { envi: makeLayer('envi', { op: 2 }), enviMask: cubeLayer }
        : { envi: cubeLayer }),
      ...(item.normal === 'none'
        ? {}
        : item.normal === 'detail-zero'
          ? {
              normal: makeLayer('normal', { constantColor: { value: [1, 0.5, 0.5, 1] } }),
              normalBlend1: makeLayer('normalBlend1', {
                constantColor: { value: [0, 0.5, 0.5, 1] },
              }),
              normalBlend2: makeLayer('normalBlend2', {
                constantColor: { value: [0.5, 1, 0.5, 1] },
              }),
            }
          : {
              normal: makeLayer('normal', {
                texturePath: 'normal.dds',
                uvSource: item.normalWorldUv ? 5 : 0,
                wrapX: false,
                wrapY: false,
                ...(item.normalOffset === undefined
                  ? {}
                  : { uvOffset: { value: [item.normalOffset, 0] } }),
              }),
            }),
      ...(item.parallax === undefined ? {} : { height: makeLayer('height') }),
    },
  }
  const textures = [
    cubeTexture(filter),
    ...(item.normal === 'none' || item.normal === 'detail-zero'
      ? []
      : [normalTexture(item.normal, filter)]),
  ]
  const normal = item.flatGeometry ? [0, 0, 1] : [0.6, 0, 0.8]
  const normals = Float32Array.from([normal, normal, normal, normal].flat())
  const tangent = item.flatGeometry ? [1, 0, 0, 1] : [0.8, 0, -0.6, item.negativeTangent ? -1 : 1]
  return {
    ...base,
    camera: {
      ...base.camera,
      ...(item.source === 2 ? { eyePosition: item.eye ?? [0, 0, 10] } : {}),
      ...(item.cameraRotation ? { viewMatrix: Float32Array.from(quarterTurn) } : {}),
    },
    scene: {
      ...base.scene,
      primitives: [
        {
          ...primitive,
          normals,
          tangents: Float32Array.from([tangent, tangent, tangent, tangent].flat()),
          textureCoordinates: Float32Array.of(0.6, 0.5, 0.6, 0.5, 0.6, 0.5, 0.6, 0.5),
          textureCoordinateSets: [],
          ...(item.modelRotation ? { transform: Float32Array.from(quarterTurn) } : {}),
        },
      ],
      materials: [
        {
          ...surface,
          shader: {
            id: 'modkit.render-material.v1',
            parameters: snapshotJson(
              {
                renderModel: {
                  version: 1,
                  standard,
                  ...(item.uvProjection ? { worldToMaterial: uvProjection } : {}),
                },
              },
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
      materialContext: {
        time: 0,
        ambient: [0, 0, 0, 0],
        environment: { worldToEnvironment: item.environment ?? identity },
      },
    },
  }
}

// Independent scalar oracle. It does not call scene matrix, tangent, normal decoder, environment
// direction, texture projection, sampling, or material-composition implementation helpers.
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
function affinePoint(matrix: readonly number[], v: Vec3): Vec3 {
  const row = (r: number) =>
    (matrix[r] ?? 0) * v[0] +
    (matrix[r + 4] ?? 0) * v[1] +
    (matrix[r + 8] ?? 0) * v[2] +
    (matrix[r + 12] ?? 0)
  return [row(0), row(1), row(2)]
}
function sampledNormal(item: EnvironmentCase, filter: EnvironmentFilter): Vec3 {
  if (item.normal === 'none') return [0, 0, 1]
  // Shared scene blend: mix(+X,-X,.5)=0 -> +Z fallback; normalize(mix(+Z,+Y,.5)).
  // This asserts the existing scene contract, not the distinct native signed-detail algorithm.
  if (item.normal === 'detail-zero') return [0, Math.SQRT1_2, Math.SQRT1_2]
  // Eye=(0,0,1), authored T=(.8,0,-.6), B=(0,1,0), N=(.6,0,.8).
  // Height=1: deltaU=(-.6)*((1-.5)*height/.8)=-.375*height.
  const u = 0.6 + (item.normalOffset ?? 0) - 0.375 * (item.parallax ?? 0)
  const [left, right] = normalPixels(item.normal)
  if (left === undefined || right === undefined) throw new Error('missing normal texels')
  const weight = filter === 'nearest' ? (u >= 0.5 ? 1 : 0) : Math.max(0, Math.min(1, u * 2 - 0.5))
  const channel = (index: number) =>
    ((left[index] ?? 0) * (1 - weight) + (right[index] ?? 0) * weight) / 127.5 - 1
  if (item.normal === 'bc5' || item.normal === 'bc3') {
    const x = channel(item.normal === 'bc3' ? 3 : 0),
      y = channel(1)
    return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))]
  }
  return [channel(0), channel(1), channel(2)]
}

export function environmentExpected(
  index: number,
  filter: EnvironmentFilter,
  x: number,
  y: number,
): readonly number[] {
  const item = fixture(index),
    mapped = sampledNormal(item, filter)
  let normal = item.flatGeometry
    ? unit(mapped)
    : unit([
        0.8 * mapped[0] + 0.6 * mapped[2],
        (item.negativeTangent ? -1 : 1) * mapped[1],
        -0.6 * mapped[0] + 0.8 * mapped[2],
      ])
  if (item.modelRotation) normal = [-normal[1], normal[0], normal[2]]
  const matrix = item.environment ?? identity,
    n = affinePoint(matrix, normal)
  let direction = n
  if (item.source === 2) {
    const eye = item.eye ?? [0, 0, 10],
      v = affinePoint(
        matrix,
        unit([(x + 0.5) / 16 - 1 - eye[0], 1 - (y + 0.5) / 16 - eye[1], 0.1 - eye[2]]),
      )
    const projection = 2 * (v[0] * n[0] + v[1] * n[1] + v[2] * n[2])
    direction = [v[0] - projection * n[0], v[1] - projection * n[1], v[2] - projection * n[2]]
  }
  if (direction.every(value => value === 0)) direction = [0, 0, 1]
  const [dx, dy, dz] = direction,
    face = filter === 'linear' ? (item.linearFace ?? item.face) : item.face
  const major = face < 2 ? Math.abs(dx) : face < 4 ? Math.abs(dy) : Math.abs(dz)
  if (major < Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) - 1e-8)
    throw new Error(`${item.name}: independent expected face ${face} is not dominant`)
  const coordinates = [
    [-dz, -dy],
    [dz, -dy],
    [dx, dz],
    [dx, -dz],
    [dx, -dy],
    [-dx, -dy],
  ][face]
  if (coordinates === undefined) throw new Error('invalid independent face')
  const u = ((coordinates[0] ?? 0) / major + 1) * 0.5,
    v = ((coordinates[1] ?? 0) / major + 1) * 0.5
  const tx = filter === 'nearest' ? Math.min(7, Math.floor(u * 8)) : u * 8 - 0.5,
    ty = filter === 'nearest' ? Math.min(7, Math.floor(v * 8)) : v * 8 - 0.5
  if (Math.min(tx, ty) < 0 || Math.max(tx, ty) > 7)
    throw new Error(
      `${item.name}: fixture reached a cube seam; this oracle only covers face interiors`,
    )
  return [24 + face * 30, 20 + tx * 24, 32 + ty * 20, 255]
}

async function frame(item: EnvironmentCase, filter: EnvironmentFilter) {
  const input = request(item, filter),
    cpu = await renderHeadless(input),
    gpu = await renderBrowser(input)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    diagnostics: [...cpu.diagnostics, ...gpu.diagnostics],
    triangles: [cpu.statistics.triangles, gpu.statistics.triangles],
  }
}

export async function environmentFrameProbe(index: number, filter: EnvironmentFilter) {
  const item = fixture(index),
    result = await frame(item, filter)
  const invariant =
    item.invariant === 'camera'
      ? await frame({ ...item, cameraRotation: false }, filter)
      : item.invariant === 'storage'
        ? await frame({ ...item, normal: 'bc3' }, filter)
        : item.invariant === 'cube-uv'
          ? await frame({ ...item, cubeUv: false }, filter)
          : item.invariant === 'uv-projection'
            ? await frame({ ...item, uvProjection: false }, filter)
            : undefined
  const changed =
    item.parallax !== undefined
      ? await frame({ ...item, parallax: 0 }, filter)
      : item.normalOffset !== undefined
        ? await frame({ ...item, normalOffset: 0 }, filter)
        : item.eye !== undefined
          ? await frame({ ...item, eye: [0, 0, 10] }, filter)
          : undefined
  const projectedNormal = item.uvProjection
    ? {
        baseline: await frame(
          { ...item, normal: 'spatial', normalWorldUv: true, uvProjection: false },
          filter,
        ),
        projected: await frame({ ...item, normal: 'spatial', normalWorldUv: true }, filter),
      }
    : undefined
  return {
    ...result,
    ...(invariant === undefined ? {} : { invariant }),
    ...(changed === undefined ? {} : { changed }),
    ...(projectedNormal === undefined ? {} : { projectedNormal }),
  }
}

/** The measured reflection vectors go through the existing normal-cube
 * route with no environment frame or reflection calculation. This separates hardware sampler
 * coordinate precision from the new environment shader's arithmetic. */
export const environmentSamplerCases = [
  {
    pixel: [20, 6],
    direction: [1.16218184973775, 0.2910211293664872, 0.16720787821831984],
    expected: [24, 92, 72, 255],
  },
  {
    pixel: [12, 7],
    direction: [1.1700800694943638, 0.29252333658291885, 0.23277040471358923],
    expected: [24, 92, 72, 255],
  },
  {
    pixel: [5, 13],
    direction: [1.1804551110126256, 0.2619582629882018, 0.29511509157663274],
    expected: [24, 68, 92, 255],
  },
  {
    pixel: [6, 23],
    direction: [1.1883506383380429, 0.19920928216553943, 0.2974778737577891],
    expected: [24, 68, 92, 255],
  },
] as const

export async function environmentSamplerFrameProbe(index: number) {
  const item = environmentSamplerCases[index]
  if (item === undefined) throw new Error('missing independent nearest sampler fixture')
  const base = cubeRequest(item.direction, 7, 'nearest')
  const input = {
    ...base,
    scene: { ...base.scene, textures: [{ ...cubeTexture('nearest'), id: 'cube.dds' }] },
  }
  const cpu = await renderHeadless(input),
    gpu = await renderBrowser(input)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    diagnostics: [...cpu.diagnostics, ...gpu.diagnostics],
    triangles: [cpu.statistics.triangles, gpu.statistics.triangles],
  }
}

export async function environmentSamplerPrecisionProbe() {
  const reports = []
  for (const [index, item] of environmentSamplerCases.entries()) {
    const result = await environmentSamplerFrameProbe(index)
    reports.push({
      ...item,
      cpu: result.cpu.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4),
      gpu: result.gpu.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4),
      diagnostics: result.diagnostics,
    })
  }
  return reports
}
