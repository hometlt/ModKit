import { expect, it } from 'vitest'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
} from '../src/model-math/standard-material-glsl.js'
import { shadePbr, tonemap } from '../src/model-math/pbr.js'
import { linearToSrgb, srgbToLinear } from '../src/raster/ops.js'

const layer = (slot: string, texel: readonly number[], channels = 1) => ({
  slot,
  texturePath: `${slot}.png`,
  uvSource: 0,
  channels,
  op: slot === 'diffuse' ? 6 : 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
  texel,
})
// tex2 of a BAR unit: metalness in green, roughness in blue (channels 4 and 5 select them)
const tex2 = [0.1, 0.9, 0.3, 1]
const input = (extra: object = {}) =>
  ({
    layers: {
      diffuse: layer('diffuse', [0.8, 0.6, 0.2, 1]),
      metalness: layer('metalness', tex2, 4),
      roughness: layer('roughness', tex2, 5),
    },
    ambient: [0.02, 0.02, 0.02, 0],
    vertexNormal: [0, 0, 1],
    lightDir: [0, 0.6, 0.8],
    viewDir: [0, 0, 1],
    specularity: 20,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    alphaTestThreshold: 0,
    pbr: { metallicFactor: 1, roughnessFactor: 0.5 },
    ...extra,
  }) as never

it('lights a pbr material by the one glTF BRDF, its metalness and roughness from their layers', () => {
  const expected = shadePbr(
    { baseColor: [0.8, 0.6, 0.2], metallic: 0.9, roughness: 0.15 },
    [0, 0, 1],
    [0, 0, 1],
    { direction: [0, 0.6, 0.8], color: [0.75, 0.75, 0.75] },
    [0.25, 0.25, 0.25],
  )
  const { rgba } = composeStandardPixelCpu(input())
  rgba.slice(0, 3).forEach((value, channel) => expect(value).toBeCloseTo(expected[channel]!, 6))
  // the viewer's ambient of the m3 model is not added on top
  expect(rgba[3]).toBe(1)
})

it('keeps a metal in shadow its own colour, not black', () => {
  const shadow = composeStandardPixelCpu(input({ lightDir: [0, 0, -1] })).rgba
  expect(shadow[0]).toBeGreaterThan(0.1)
  expect(shadow[0]).toBeGreaterThan(shadow[2])
})

it('sums light linearly and tonemaps it under linear-srgb', () => {
  const curve = [4.75, 0.75, 3.5, 0.85, 1] as const
  const linear = shadePbr(
    {
      baseColor: [srgbToLinear(0.8), srgbToLinear(0.6), srgbToLinear(0.2)],
      metallic: 0.9,
      roughness: 0.15,
    },
    [0, 0, 1],
    [0, 0, 1],
    { direction: [0, 0.6, 0.8], color: [0.75, 0.75, 0.75] },
    [0.25, 0.25, 0.25],
  )
  const { rgba } = composeStandardPixelCpu(input({ linearColor: { tonemap: curve } }))
  rgba
    .slice(0, 3)
    .forEach((value, channel) =>
      expect(value).toBeCloseTo(linearToSrgb(tonemap(linear[channel]!, curve)), 6),
    )
})

it('compiles the pbr model only where the material asks, and keys the program by it', () => {
  const material = {
    layers: { diffuse: layer('diffuse', [1, 1, 1, 1]), metalness: layer('metalness', tex2, 4) },
    blendMode: 0,
    priority: 0,
    specularity: 20,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: false,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
  } as never
  const m3 = buildMaterialDefines(material)
  const pbr = buildMaterialDefines({
    ...(material as object),
    lightingModel: 'pbr-metallic-roughness',
    colorPipeline: 'linear-srgb',
    tonemap: [4.75, 0.75, 3.5, 0.85, 1],
  } as never)
  expect(m3.pbr).toBeUndefined()
  expect(pbr).toMatchObject({ pbr: true, linearColor: true, tonemap: true })
  expect(canonicalDefineKey(pbr)).not.toBe(canonicalDefineKey(m3))
  const source = buildStandardFragmentSource(pbr)
  expect(source).toContain('modkitPbr(pbrBase')
  expect(source).toContain('computeLayer_metalness().r')
  expect(source).toContain('modkitTonemap(shaded, u_tonemapCurve, u_tonemapE)')
  expect(buildStandardFragmentSource(m3)).not.toContain('modkitPbr')
})
