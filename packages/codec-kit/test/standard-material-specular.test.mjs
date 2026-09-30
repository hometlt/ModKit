import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  composeStandardPixelCpu,
} from '../dist/legacy-model-support.js'

// psmaterial.fx: a gloss layer scales the exponent by its alpha squared; FakeEnergyConservingSpec
// dims the specular by a polynomial of that exponent, clamped to 1..512.
const layer = (slot, texel, channels = 1) => ({
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
const dim = power => {
  const p = Math.min(Math.max(power, 1), 512)
  return -0.000004444 * p * p + 0.004333 * p + 0.0020834
}
const pixel = (extra, layers = {}) =>
  composeStandardPixelCpu({
    layers: { diffuse: layer('diffuse', [0, 0, 0, 1]), specular: layer('specular', [1, 1, 1, 1]), ...layers },
    ambient: [0, 0, 0, 1],
    vertexNormal: [0, 0, 1],
    lightDir: [0, 0, 1],
    specularity: 20,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    ...extra,
  }).rgba[0]

test('an M3 specular dims by its exponent, as FakeEnergyConservingSpec does', () => {
  assert.equal(pixel({}), 1)
  assert.ok(Math.abs(pixel({ specularEnergyConservation: true }) - dim(20)) < 1e-6)
})

test('a gloss layer scales the exponent by its alpha squared', () => {
  const gloss = { gloss: layer('gloss', [0.1, 0.1, 0.1, 0.5]) }
  // Exponent 20 × 0.5² = 5: the dim is that of 5, not of 20 or of 10.
  assert.ok(Math.abs(pixel({ specularEnergyConservation: true }, gloss) - dim(5)) < 1e-6)
})

test('the GLSL program carries the same dim only when the material states it', () => {
  const material = {
    layers: { diffuse: layer('diffuse', [0, 0, 0, 1]), specular: layer('specular', [1, 1, 1, 1]) },
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
  }
  const plain = buildStandardFragmentSource(buildMaterialDefines(material))
  const dimmed = buildStandardFragmentSource(
    buildMaterialDefines({ ...material, specularEnergyConservation: true }),
  )
  assert.doesNotMatch(plain, /0\.004333/u)
  assert.match(dimmed, /0\.004333 \* specClamped/u)
})
