import type { SceneRenderRequest } from '@modkit/sdk/renderer'
import type { JsonObject } from '@modkit/sdk'
import type { StandardMaterialModel } from '@modkit/codec-kit/legacy/models/material'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { renderBrowser } from '../../../scene/src/render/browser.js'
import { renderHeadless } from '../../../scene/src/render/headless.js'
import { materialBudget, materialProgramCases } from './scene-material-program.js'
import { invertMaterialFrame } from '../../../scene/src/materials/frame.js'

export function frameRequest(
  index: number,
  filter: 'nearest' | 'linear' = 'linear',
): SceneRenderRequest {
  const item = materialProgramCases()[index]
  if (item === undefined) throw new Error('unknown case')
  const parameters = snapshotJson(
    { renderModel: { version: 1, standard: item.material } },
    materialBudget,
  ) as JsonObject
  const paths = [
    ...new Set(
      Object.values(item.material.layers).flatMap(layer =>
        layer?.texturePath ? [layer.texturePath] : [],
      ),
    ),
  ]
  const rgba = new Uint8Array(8 * 8 * 4)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      rgba.set([32 + x * 24, 16 + y * 28, 224 - x * 16, 128 + y * 16], (y * 8 + x) * 4)
  const uv = Float32Array.of(-0.2, 0.13, 1.31, 0.27, 0.93, 1.44, 0.08, 0.98)
  // Exact pixel-aligned edges isolate sampling math from implementation-dependent subpixel
  // rasterization precision (nearest sampling is discontinuous at texel boundaries).
  const positions = Float32Array.of(
    -0.75,
    -0.75,
    0.1,
    0.75,
    -0.75,
    0.1,
    0.75,
    0.75,
    0.1,
    -0.75,
    0.75,
    0.1,
  )
  return {
    outputKind: 'rgba8',
    viewport: { width: 32, height: 32 },
    clearColor: [0.1, 0.2, 0.3, 1],
    camera: { viewProjection: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) },
    scene: {
      primitives: [
        {
          id: 'quad',
          materialId: 'material',
          topology: 'triangles',
          positions,
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
          textureCoordinates: uv,
          textureCoordinateSets: [0, 1, 2, 3].map(set => ({
            set,
            coordinates: Float32Array.from(
              uv,
              (value, i) => value * (1 + set * 0.15) + (i % 2 ? 0.07 * set : -0.11 * set),
            ),
          })),
        },
      ],
      materials: [
        {
          id: 'material',
          baseColor: [1, 0, 1, 1],
          shader: { id: 'modkit.render-material.v1', parameters },
          textureBindings: paths.map(resourceId => ({ resourceId, textureId: resourceId })),
        },
      ],
      textures: paths.map(id => ({ id, width: 8, height: 8, rgba, filter })),
      materialContext: item.time ?? { time: 0 },
    },
  }
}

export async function materialFrameProbe(index: number, filter: 'nearest' | 'linear' = 'linear') {
  return compareFrame(frameRequest(index, filter))
}

async function compareFrame(request: SceneRenderRequest) {
  const cpu = await renderHeadless(request),
    gpu = await renderBrowser(request)
  return {
    cpu: Array.from(cpu.rgba),
    gpu: Array.from(gpu.rgba),
    diagnostics: gpu.diagnostics,
    triangles: gpu.statistics.triangles,
  }
}

export function specialFrameCases(): readonly { name: string; request: SceneRenderRequest }[] {
  const raw = frameRequest(1),
    base: SceneRenderRequest = {
      ...raw,
      scene: { ...raw.scene, materialContext: { time: 0, ambient: [0, 0, 0, 0] } },
    },
    item = materialProgramCases()[1],
    surface = base.scene.materials?.[0],
    primitive = base.scene.primitives[0]
  if (item === undefined || surface === undefined || primitive === undefined)
    throw new Error('missing special frame fixture')
  const cases: { name: string; request: SceneRenderRequest }[] = []
  const material = (standard: StandardMaterialModel) => ({
    ...surface,
    shader: {
      id: 'modkit.render-material.v1',
      parameters: snapshotJson(
        { renderModel: { version: 1, standard } },
        materialBudget,
      ) as JsonObject,
    },
  })
  const diffuse = item.material.layers.diffuse
  if (diffuse === undefined) throw new Error('missing diffuse')
  cases.push({
    name: 'rgba8-clamp-before-premultiplication',
    request: {
      ...base,
      scene: {
        ...base.scene,
        materials: [
          material({
            ...item.material,
            layers: {
              diffuse: {
                ...diffuse,
                clampResult: false,
                constantColor: { value: [2, -1, 0.6, 0.5] },
              },
            },
          }),
        ],
      },
    },
  })
  for (const blendMode of [0, 1, 2, 3, 4, 5])
    cases.push({
      name: `blend-state-${blendMode}`,
      request: {
        ...base,
        scene: { ...base.scene, materials: [material({ ...item.material, blendMode })] },
      },
    })
  for (const topology of ['triangle-strip', 'triangle-fan'] as const)
    cases.push({
      name: `derive-${topology}`,
      request: {
        ...base,
        scene: {
          ...base.scene,
          primitives: [
            {
              ...primitive,
              topology,
              indices:
                topology === 'triangle-strip'
                  ? Uint32Array.of(0, 1, 3, 2)
                  : Uint32Array.of(0, 1, 2, 3),
            },
          ],
        },
      },
    })
  cases.push({
    name: 'cull-backface',
    request: {
      ...base,
      scene: {
        ...base.scene,
        primitives: [{ ...primitive, indices: Uint32Array.of(0, 2, 1, 0, 3, 2) }],
      },
    },
  })
  cases.push({
    name: 'clip-near-and-left',
    request: {
      ...base,
      scene: {
        ...base.scene,
        primitives: [
          {
            ...primitive,
            positions: Float32Array.of(
              -1.5,
              -0.75,
              -2,
              0.75,
              -0.75,
              0,
              0.75,
              0.75,
              0,
              -1.5,
              0.75,
              -2,
            ),
          },
        ],
      },
    },
  })
  const translucent = material({ ...item.material, blendMode: 1, depthPrepass: true })
  cases.push({
    name: 'depth-prepass',
    request: { ...base, scene: { ...base.scene, materials: [translucent] } },
  })
  cases.push({
    name: 'mixed-base-color-after-game',
    request: {
      ...base,
      scene: {
        ...base.scene,
        materials: [surface, { id: 'plain', baseColor: [0.9, 0.1, 0.3, 0.4], alphaMode: 'blend' }],
        primitives: [
          primitive,
          {
            ...primitive,
            id: 'plain-quad',
            materialId: 'plain',
            positions: Float32Array.from(primitive.positions, (v, i) =>
              i % 3 === 2 ? -0.2 : v * 0.5,
            ),
          },
        ],
      },
    },
  })
  const composite = {
    priority: 0,
    passes: [
      { material: { ...item.material, blendMode: 0 }, alphaFactor: { value: 0.1 } },
      { material: { ...item.material, blendMode: 1 }, alphaFactor: { value: 0.4 } },
    ],
  }
  cases.push({
    name: 'composite-same-depth',
    request: {
      ...base,
      scene: {
        ...base.scene,
        materials: [
          {
            ...surface,
            shader: {
              id: 'modkit.render-material.v1',
              parameters: snapshotJson(
                { renderModel: { version: 1, composite } },
                materialBudget,
              ) as JsonObject,
            },
          },
        ],
      },
    },
  })
  const textured = frameRequest(
    materialProgramCases().findIndex(item => item.name === 'layer-diffuse'),
  )
  const quad = textured.scene.primitives[0]
  if (quad === undefined) throw new Error('missing textured primitive')
  cases.push({
    name: 'perspective-interpolation',
    request: {
      ...textured,
      camera: {
        viewProjection: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.25, -1, 0, 0, -2.25, 0),
      },
      scene: {
        ...textured.scene,
        primitives: [
          {
            ...quad,
            positions: Float32Array.of(-1.5, -1.5, -2, 3, -3, -4, 3, 3, -4, -1.5, 1.5, -2),
          },
        ],
      },
    },
  })
  return cases
}

export async function specialFrameProbe(index: number) {
  const item = specialFrameCases()[index]
  if (item === undefined) throw new Error('unknown special case')
  return compareFrame(item.request)
}

export async function rebasedMaterialFrameProbe(source: number) {
  const original = frameRequest(
    materialProgramCases().findIndex(item => item.name === `uv-source-${source}`),
    'nearest',
  )
  const frame = [4, 0, 0, 0, 0, 0, -0.5, 0, 0, 2, 0, 0, 2, -4, 1, 1]
  const inverse = invertMaterialFrame(frame)
  const rebased: SceneRenderRequest = {
    ...original,
    camera: { viewProjection: Float32Array.from(inverse), viewMatrix: Float32Array.from(inverse) },
    scene: {
      ...original.scene,
      primitives: original.scene.primitives.map(primitive => ({
        ...primitive,
        transform: Float32Array.from(frame),
      })),
      materials:
        original.scene.materials?.map(material => {
          const shader = material.shader,
            model = shader?.parameters['renderModel']
          if (
            shader === undefined ||
            model === null ||
            typeof model !== 'object' ||
            Array.isArray(model)
          )
            throw new Error('missing render model')
          return {
            ...material,
            shader: {
              ...shader,
              parameters: {
                ...shader.parameters,
                renderModel: { ...model, worldToMaterial: [...inverse] },
              },
            },
          }
        }) ?? [],
    },
  }
  const baseline = await renderHeadless(original),
    changed = await compareFrame(rebased)
  return { ...changed, baseline: Array.from(baseline.rgba) }
}
