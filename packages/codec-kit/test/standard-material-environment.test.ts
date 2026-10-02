import { describe, expect, it } from 'vitest'
import type { StandardMaterialLayer, StandardMaterialModel } from '../src/legacy/models/material.js'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
  type CpuLayerSample,
} from '../src/model-math/standard-material-glsl.js'

const sample = (texel: readonly [number, number, number, number]): CpuLayerSample => ({
  texel,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
})
const layer = (slot: StandardMaterialLayer['slot']): StandardMaterialLayer => ({
  slot,
  texturePath: slot,
  uvSource: slot === 'envi' ? 2 : 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
})
const material = (extra: Partial<StandardMaterialModel>): StandardMaterialModel => ({
  layers: { diffuse: layer('diffuse'), envi: layer('envi') },
  blendMode: 0,
  priority: 0,
  specularity: 0,
  specMult: 0,
  emisMult: 0,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: false,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...extra,
})

describe('the environment tinted by the base colour', () => {
  // an unshaded pixel: the base colour plus the environment, k = 2
  const shade = (tint: boolean) =>
    composeStandardPixelCpu({
      layers: { diffuse: sample([0.5, 0.25, 0.1, 1]), envi: sample([0.4, 0.4, 0.4, 1]) },
      ambient: [0, 0, 0, 0],
      environmentMultipliers: [2, 0, 0],
      ...(tint ? { environmentTintByBase: true } : {}),
      specularity: 0,
      specMult: 0,
      emisMult: 0,
      specMode: 0,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      alphaTestThreshold: 0,
    }).rgba

  it('adds base × env × mask × k with op 2 (Supreme Commander metal)', () => {
    const tinted = shade(true)
    ;[0.5 + 0.5 * 0.4 * 2, 0.25 + 0.25 * 0.4 * 2, 0.1 + 0.1 * 0.4 * 2].forEach((value, index) =>
      expect(tinted[index]).toBeCloseTo(value, 6),
    )
    // without it the reflection is the same on every surface: the chrome the game does not draw
    const plain = shade(false)
    ;[0.5 + 0.8, 0.25 + 0.8, 0.1 + 0.8].forEach((value, index) =>
      expect(plain[index]).toBeCloseTo(value, 6),
    )
  })

  it('tints in the shader by the base the lighting takes', () => {
    const tinted = buildMaterialDefines(material({ environmentTintByBase: true }))
    expect(buildStandardFragmentSource(tinted)).toContain('environmentValue *= color;')
    const pbr = buildMaterialDefines(
      material({ environmentTintByBase: true, lightingModel: 'pbr-metallic-roughness' }),
    )
    expect(buildStandardFragmentSource(pbr)).toContain('environmentValue *= pbrBase;')
    const plain = buildMaterialDefines(material({}))
    expect(buildStandardFragmentSource(plain)).not.toContain('environmentValue *=')
    expect(canonicalDefineKey(tinted)).not.toBe(canonicalDefineKey(plain))
  })
})
