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

test('sub-unity gloss exponents widen highlights without changing the energy polynomial clamp', () => {
  // Native MaterialSpecularity followed by LightingModels.BlinnShading: 20 * gloss^2,
  // then pow(N.H, exponent). The energy correction alone clamps its input to 1..512.
  const halfVec = [Math.sqrt(0.75), 0, -0.5]
  for (const gloss of [0, 0.01, 0.1, 0.2, 0.5]) {
    const power = 20 * gloss * gloss
    const layers = { gloss: layer('gloss', [1, 1, 1, gloss]) }
    const expected = Math.pow(0.5, power)
    assert.ok(Math.abs(pixel({ halfVec }, layers) - expected) < 1e-10)
    assert.ok(Math.abs(pixel({ halfVec, specularEnergyConservation: true }, layers) - expected * dim(power)) < 1e-10)
  }
  // A dark gloss map can produce exponent zero even at a perpendicular half-vector.
  assert.equal(pixel({ halfVec: [1, 0, 0] }, { gloss: layer('gloss', [1, 1, 1, 0]) }), 1)
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

test('direct lights accumulate diffuse and independent highlights in their shading frame', () => {
  const lighting = {
    ambientColor: [0, 0, 0], lightColor: [0, 0, 0], normal: [1, 0, 0],
    lights: [
      { direction: [1, 0, 0], halfVector: [-1, 0, 0], diffuseColor: [1, 0, 0], specularColor: [0.25, 0, 0] },
      { direction: [1, 0, 0], halfVector: [0, 0, -1], diffuseColor: [0, 0.5, 0], specularColor: [0, 1, 0] },
      { direction: [-1, 0, 0], halfVector: [-1, 0, 0], diffuseColor: [1, 1, 1], specularColor: [1, 1, 1] },
    ],
  }
  const result = composeStandardPixelCpu({
    layers: { diffuse: layer('diffuse', [0.5, 0.5, 0.5, 0.4]), specular: layer('specular', [1, 1, 1, 1]) },
    sceneLighting: lighting, vertexNormal: [0, 0, 1], ambient: [0, 0, 0, 0],
    specularity: 20, specMult: 1, emisMult: 0, specMode: 0,
    unshaded: false, doubleLambert: false, clampOutput: false,
  })
  assert.deepEqual(result.rgba, [0.75, 0.25, 0, 0.4])
})

test('empty direct samples retain ambient, emissive and alpha once', () => {
  const input = {
    layers: { diffuse: layer('diffuse', [0.2, 0.4, 0.6, 0.3]), emissive1: layer('emissive1', [0.3, 0.2, 0.1, 1]) },
    sceneLighting: { ambientColor: [0.5, 0.5, 0.5], lightColor: [0, 0, 0], lights: [] },
    ambient: [0, 0, 0, 0], specularity: 20, specMult: 1, emisMult: 1, specMode: 0,
    unshaded: false, doubleLambert: false, clampOutput: false,
  }
  const zero = {direction:[0,0,1],halfVector:[0,0,-1],diffuseColor:[0,0,0],specularColor:[0,0,0]}
  const empty = composeStandardPixelCpu(input).rgba
  const multiple = composeStandardPixelCpu({...input,sceneLighting:{...input.sceneLighting,lights:[zero,zero]}}).rgba
  assert.deepEqual(multiple, empty)
  for (let i=0;i<4;i++) assert.ok(Math.abs(empty[i]-[0.4,0.4,0.4,0.3][i])<1e-12)
})

test('environment influence keeps primary diffuse and RGB specular under local lights', () => {
  const input = {
    layers: { diffuse: layer('diffuse', [0,0,0,1]), specular: layer('specular', [0.2,0.4,0.6,1]), envi: layer('envi', [1,1,1,1]) },
    sceneLighting: { ambientColor: [0,0,0], lightColor: [0,0,0], lights: [] },
    environmentMultipliers:[0,0,1], ambient:[0,0,0,0], vertexNormal:[0,0,1], lightDir:[0,0,1], halfVec:[0,0,-1],
    specularity:20,specMult:1,emisMult:0,specMode:0,unshaded:false,doubleLambert:false,clampOutput:false,
  }
  const base = composeStandardPixelCpu(input).rgba
  const zero = {direction:[1,0,0],halfVector:[-1,0,0],diffuseColor:[0,0,0],specularColor:[0,0,0]}
  assert.deepEqual(base,[0.2,0.4,0.6,1])
  assert.deepEqual(composeStandardPixelCpu({...input,sceneLighting:{...input.sceneLighting,normal:[1,0,0],lights:[zero,zero]}}).rgba,base)
})
