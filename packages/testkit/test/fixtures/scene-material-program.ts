import type {
  StandardMaterialLayer,
  StandardMaterialModel,
  StandardLayerSlot,
} from '@modkit/codec-kit/legacy/models/material'
import {
  FRAGMENT_LAYER_SLOTS,
  type Vec4,
} from '@modkit/codec-kit/model-math/standard-material-glsl'
import {
  createStandardMaterialPrograms,
  type MaterialPixel,
  type MaterialSampleTime,
} from '../../../scene/src/materials/index.js'

export const materialBudget = { maxDepth: 64, maxNodes: 100000, maxBytes: 8 * 1024 * 1024 }
const layer = (
  slot: StandardLayerSlot,
  options: Partial<StandardMaterialLayer> = {},
): StandardMaterialLayer => ({
  slot,
  texturePath: null,
  constantColor: { value: [0.2, 0.4, 0.6, 0.5] },
  uvSource: 0,
  channels: 1,
  op: 6,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...options,
})
const material = (options: Partial<StandardMaterialModel> = {}): StandardMaterialModel => ({
  layers: { diffuse: layer('diffuse') },
  blendMode: 0,
  priority: 0,
  specularity: 10,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: true,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...options,
})
export interface MaterialProgramCase {
  readonly name: string
  readonly material: StandardMaterialModel
  readonly pixel?: MaterialPixel
  readonly expected?: Vec4
  readonly time?: MaterialSampleTime
}

export function materialProgramCases(): readonly MaterialProgramCase[] {
  const channels: readonly Vec4[] = [
    [0.2, 0.4, 0.6, 1],
    [0.2, 0.4, 0.6, 0.5],
    [0.5, 0.5, 0.5, 0.5],
    [0.2, 0.2, 0.2, 0.2],
    [0.4, 0.4, 0.4, 0.4],
    [0.6, 0.6, 0.6, 0.6],
  ]
  const cases: MaterialProgramCase[] = channels.map((expected, index) => ({
    name: `channel-${index}`,
    material: material({
      layers: { diffuse: layer('diffuse', { channels: index as 0 | 1 | 2 | 3 | 4 | 5 }) },
    }),
    expected,
  }))
  for (const op of [0, 1, 2, 3, 4, 5, 6] as const)
    cases.push({
      name: `color-operation-${op}`,
      material: material({
        layers: {
          diffuse: layer('diffuse'),
          decal: layer('decal', { op, constantColor: { value: [0.8, 0.2, 0.4, 0.25] } }),
        },
      }),
    })
  for (const slot of FRAGMENT_LAYER_SLOTS)
    cases.push({
      name: `layer-${slot}`,
      material: material({
        unshaded: false,
        layers: {
          diffuse: layer('diffuse'),
          [slot]: layer(slot, { texturePath: `${slot}.dds`, channels: 1, op: 2 }),
        },
      }),
      pixel: { texels: { [slot]: [128 / 255, 128 / 255, 1, 128 / 255] } },
    })
  for (const uvSource of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
    cases.push({
      name: `uv-source-${uvSource}`,
      material: material({
        layers: {
          diffuse: layer('diffuse', {
            uvSource,
            texturePath: 'uv.dds',
            uvOffset: { value: [0.1, 0.2] },
            uvTiling: { value: [2, 3] },
            uvAngle: { value: [0.1, 0.2, 0.3] },
            uvTriplanarOffset: { value: [1, 2, 3] },
            uvTriplanarScale: { value: [2, 3, 4] },
          }),
        },
      }),
      pixel: { texels: { diffuse: [51 / 255, 102 / 255, 153 / 255, 1] } },
      expected: [0.2, 0.4, 0.6, 1],
    })
  cases.push({
    name: 'team-color-raw-alpha',
    material: material({
      layers: {
        diffuse: layer('diffuse', {
          channels: 0,
          teamColorMode: 1,
          constantColor: { value: [0, 1, 0, 0.25] },
        }),
      },
    }),
    expected: [0.75, 0.25, 0, 1],
  })
  for (const channels of [1, 2] as const)
    cases.push({
      name: `environment-mask-${channels}`,
      material: material({
        layers: {
          diffuse: layer('diffuse', { constantColor: { value: [0, 0, 0, 1] } }),
          envi: layer('envi', { op: 2, constantColor: { value: [0.4, 0.6, 0.8, 0.75] } }),
          enviMask: layer('enviMask', { channels, constantColor: { value: [0.1, 0.2, 0.3, 0.5] } }),
        },
      }),
    })
  for (const mode of [1, 2] as const)
    for (const eyeToVertex of [
      [1, 0, 0],
      [0, 0, -1],
    ] as const)
      cases.push({
        name: `fresnel-${mode}-${eyeToVertex[0]}`,
        material: material({
          layers: {
            diffuse: layer('diffuse', {
              fresnel: {
                mode,
                exponent: 1,
                min: 0.1,
                maxOffset: 0.7,
                transformMode: 0,
                localTransform: false,
                doNotMirror: false,
                translation: [0, 0, 0],
                invertMask: [0, 0, 0],
                rotation: [0, 0],
              },
            }),
          },
        }),
        pixel: { eyeToVertex },
      })
  cases.push({
    name: 'all-constant-layers',
    material: material({
      unshaded: false,
      normalMapFormat: 'rgb8',
      layers: Object.fromEntries(
        FRAGMENT_LAYER_SLOTS.map(slot => [slot, layer(slot, { channels: 1, op: 2 })]),
      ),
      normalBlendFactors: [
        { value: 1 },
        { value: 0 },
        { value: 0 },
        { value: 0 },
        { value: 1 },
        { value: 0 },
        { value: 0 },
        { value: 0 },
      ],
    }),
  })
  cases.push({
    name: 'vertex-color-alpha',
    material: material({ usesVertexColor: true, usesVertexAlpha: true }),
    pixel: { vertexColor: [0.5, 0.25, 1, 0.5] },
    expected: [0.1, 0.1, 0.6, 0.25],
  })
  cases.push({
    name: 'alpha-test-equal',
    material: material({ alphaTestThreshold: 0.5 }),
    expected: [0.2, 0.4, 0.6, 0.5],
  })
  cases.push({
    name: 'alpha-test-discard',
    material: material({ alphaTestThreshold: 0.75 }),
    expected: [0, 0, 0, 0],
  })
  return cases
}

export function materialCaseProgram(item: MaterialProgramCase) {
  const program = createStandardMaterialPrograms(
    { renderModel: { version: 1, standard: item.material } },
    { budget: materialBudget },
  ).sample(item.time ?? { time: 0 }, { ambient: [0, 0, 0, 0] })[0]
  if (program === undefined) throw new Error('missing fixture material')
  return program
}
