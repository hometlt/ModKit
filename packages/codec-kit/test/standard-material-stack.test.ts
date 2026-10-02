import { describe, expect, it } from 'vitest'
import type { StandardMaterialLayer, StandardMaterialModel } from '../src/legacy/models/material.js'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
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
const red = sample([1, 0, 0, 1]),
  green = sample([0, 1, 0, 1]),
  blue = sample([0, 0, 1, 1])
// an unshaded pixel shows the base colour as it is
const shade = (layers: Partial<Record<StandardMaterialLayer['slot'], CpuLayerSample>>) =>
  composeStandardPixelCpu({
    layers,
    ambient: [0, 0, 0, 0],
    specularity: 0,
    specMult: 0,
    emisMult: 0,
    specMode: 0,
    unshaded: true,
    doubleLambert: false,
    clampOutput: false,
    alphaTestThreshold: 0,
  }).rgba.slice(0, 3)

describe('the diffuse stack (Diablo III multi-layer ground)', () => {
  it('mixes each layer over the colour by the next channel of the weights, in order', () => {
    const stacked = shade({
      diffuse: red,
      diffuse2: green,
      diffuse3: blue,
      diffuseWeights: sample([0.25, 0, 0, 0]),
    })
    stacked.forEach((value, index) => expect(value).toBeCloseTo([0.75, 0.25, 0][index]!, 12))
    // a later layer at full weight covers the ones below it
    const covered = shade({
      diffuse: red,
      diffuse2: green,
      diffuse3: blue,
      diffuseWeights: sample([0.5, 1, 0, 0]),
    })
    covered.forEach((value, index) => expect(value).toBeCloseTo([0, 0, 1][index]!, 12))
  })

  it('mixes in the shader by the same channels', () => {
    const layer = (slot: StandardMaterialLayer['slot']): StandardMaterialLayer => ({
      slot,
      texturePath: slot,
      uvSource: 0,
      channels: 1,
      op: 2,
      teamColorMode: 0,
      invert: false,
      clampResult: false,
      wrapX: true,
      wrapY: true,
    })
    const material = {
      layers: {
        diffuse: layer('diffuse'),
        diffuse2: layer('diffuse2'),
        diffuse5: layer('diffuse5'),
        diffuseWeights: layer('diffuseWeights'),
      },
      blendMode: 0,
      priority: 0,
      specularity: 0,
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
    } satisfies StandardMaterialModel
    const source = buildStandardFragmentSource(buildMaterialDefines(material))
    expect(source).toContain('color = mix(color, computeLayer_diffuse2().rgb, diffuseWeights.r);')
    expect(source).toContain('color = mix(color, computeLayer_diffuse5().rgb, diffuseWeights.a);')
    expect(source).not.toContain('computeLayer_diffuse3()')
  })
})
