import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const layer = (slot, value = {}) => ({
  slot,
  texturePath: null,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 0,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...value,
})
// Washout's SpacePlatformGenerator ("braxis doodads"): a grey diffuse and an emissive that blends
// (LERP) a near-black DXT1 through its channels.
const generator = channels => ({
  renderModel: {
    version: 1,
    standard: {
      layers: {
        diffuse: layer('diffuse', { constantColor: { value: [0.5, 0.5, 0.5, 1] } }),
        ...(channels === undefined
          ? {}
          : {
              emissive1: layer('emissive1', {
                op: 3,
                channels,
                constantColor: { value: [0.02, 0.02, 0.02, 1] },
              }),
            }),
      },
      blendMode: 0,
      priority: 0,
      specularity: 0,
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
    },
  },
})

it('adds an emissive that blends through its RGB instead of replacing the lit color', () => {
  const program = channels =>
    createStandardMaterialPrograms(generator(channels), { budget }).sample({ time: 0 })[0]
  const rgb = program(0)
  // RGB forces the alpha to one: blended, the model would take the near-black emissive whole.
  assert.doesNotMatch(rgb.fragmentSource, /mix\(\w+(\.rgb)?, emis1Color\.rgb, emis1Color\.a\)/)
  assert.match(rgb.fragmentSource, /emissive \+= emis1Color\.rgb \* emis1Color\.a;/)
  const lit = program(undefined).shade({}).rgba
  const glowing = rgb.shade({}).rgba
  for (const channel of [0, 1, 2])
    assert.ok(Math.abs(glowing[channel] - lit[channel] - 0.02) < 1e-6)
  // A channel with its own alpha keeps the blend.
  assert.match(program(1).fragmentSource, /mix\(\w+(\.rgb)?, emis1Color\.rgb, emis1Color\.a\)/)
})
