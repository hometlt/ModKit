import assert from 'node:assert/strict'
import { it } from 'node:test'
import { blendMaterialPixel } from '../src/render/simple-effect.js'
import { sampleLightGeometry, readPreviewLighting } from '../src/render/preview-lighting.js'
import { colorizeWorldColor, createWorldColorLut, sampleWorldColorLut } from '../src/world/colorization.js'

it('retains additive radiance above one until the final HDR conversion', () => {
  const floating = new Float32Array([0, 0, 0, 255])
  const bytes = new Uint8Array([0, 0, 0, 255])
  for (const buffer of [floating, bytes]) {
    blendMaterialPixel(buffer, 0, [2, 0.5, 0.25, 1], { blend: 'additive' })
    blendMaterialPixel(buffer, 0, [1, 0.5, 0.25, 1], { blend: 'additive' })
  }
  assert.deepEqual([...floating], [765, 255, 127.5, 255])
  assert.deepEqual([...bytes], [255, 255, 128, 255])
})

it('keeps independent specular and receiver categories through light admission', () => {
  const light = readPreviewLighting([{ type: 'point', direction: [0, 0, -1], position: [0, 0, 2],
    color: [2, 1, 0], specularColor: [0, 0, 0], affectsOpaque: true, affectsTransparent: false,
    attenuationStart: 0, attenuationEnd: 4, decayExponent: 2 }]).lights[0]
  assert.deepEqual(light.specularColor, [0, 0, 0])
  assert.equal(light.affectsTransparent, false)
  assert.equal(sampleLightGeometry(light, [0, 0, 0]).attenuation, 0.25)
})

it('applies ordered palette operations in their selected lightness region', () => {
  const controls = { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1,
    brightness: 1, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 }
  const blue = { command: 'blue', region: 'shadows', steps: 4 }
  const dark = colorizeWorldColor([0.1, 0.1, 0.1], { ...controls, variations: [blue] })
  assert.ok(dark[2] > dark[0])
  assert.deepEqual(colorizeWorldColor([0.9, 0.9, 0.9], { ...controls, variations: [blue] }), [0.9, 0.9, 0.9])
  const red = { command: 'red', region: 'shadows', steps: 4 }
  assert.notDeepEqual(colorizeWorldColor([0.1, 0.1, 0.1], { ...controls, variations: [blue, red] }),
    colorizeWorldColor([0.1, 0.1, 0.1], { ...controls, variations: [red, blue] }))
})

it('samples the same quantized color LUT as the GPU, including cell centers and clamped edges', () => {
  const controls = { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1,
    brightness: 1, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 }
  const lut = createWorldColorLut(controls)
  assert.deepEqual(sampleWorldColorLut(lut, [0, 0, 0]), [0, 0, 0])
  assert.deepEqual(sampleWorldColorLut(lut, [1, 1, 1]), [239 / 255, 239 / 255, 239 / 255])
  assert.deepEqual(sampleWorldColorLut(lut, [4 / 16, 8 / 16, 12 / 16]), [64 / 255, 127 / 255, 191 / 255])
  const halfway = sampleWorldColorLut(lut, [4.5 / 16, 8 / 16, 12 / 16])
  assert.equal(halfway[0], (64 + 80) / (2 * 255))
})
