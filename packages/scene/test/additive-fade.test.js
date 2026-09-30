import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const layer = (slot, value = {}) => ({
  slot,
  texturePath: null,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...value,
})
// A floodlight streak's material: additive, unshaded, lit by its vertex colour and alpha.
const streak = blendMode => ({
  renderModel: {
    version: 1,
    standard: {
      layers: {
        diffuse: layer('diffuse', { constantColor: { value: [1, 1, 1, 0.5] } }),
        alpha1: layer('alpha1', { constantColor: { value: [1, 1, 1, 0.25] } }),
      },
      blendMode,
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
      usesVertexColor: true,
      usesVertexAlpha: true,
    },
  },
})

it('fades an additive colour by its vertex alpha alone, as BlendAdd does', () => {
  const pixel = { vertexColor: [1, 1, 1, 0.08] }
  const [additive] = createStandardMaterialPrograms(streak(2), { budget }).sample({ time: 0 })
  const [blended] = createStandardMaterialPrograms(streak(1), { budget }).sample({ time: 0 })
  const faded = additive.shade(pixel).rgba
  const plain = blended.shade(pixel).rgba
  // Vertex alpha 0.08: PSMaterial.fx starts the alpha at one, so the diffuse alpha (0.5) does not
  // fade it, and BlendAdd takes the fade before the alpha1 mask (0.25).
  for (const channel of [0, 1, 2])
    assert.ok(Math.abs(faded[channel] - plain[channel] * 0.08) < 1e-6)
  assert.equal(faded[3], plain[3])
  assert.match(additive.fragmentSource, /final\.rgb \*= fade \* v_vertexColor\.a;/)
  assert.doesNotMatch(blended.fragmentSource, /fade/)
  assert.notEqual(additive.key, blended.key)
})
