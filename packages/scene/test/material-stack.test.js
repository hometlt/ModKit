import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const layer = (slot, value) => ({
  slot,
  texturePath: null,
  constantColor: { value },
  uvSource: 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
})
const parameters = layers => ({
  renderModel: {
    version: 1,
    standard: {
      layers,
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

it('draws a ground of stacked layers mixed by its weights (Diablo III)', () => {
  const [program] = createStandardMaterialPrograms(
    parameters({
      diffuse: layer('diffuse', [1, 0, 0, 1]),
      diffuse2: layer('diffuse2', [0, 1, 0, 1]),
      diffuseWeights: layer('diffuseWeights', [0.25, 0, 0, 0]),
    }),
    { budget },
  ).sample({ time: 0 })
  assert.match(program.fragmentSource, /computeLayer_diffuse2\(\)\.rgb, diffuseWeights\.r/)
  const [r, g, b] = program.shade({}).rgba
  // the viewer's ambient lights an unshaded colour too: compare the mix, not the level
  assert.ok(Math.abs(r - 0.75 - (g - 0.25)) < 1e-6 && Math.abs(b - (g - 0.25)) < 1e-6)
})

it('refuses stacked layers without weights to mix them by', () => {
  assert.throws(
    () =>
      createStandardMaterialPrograms(
        parameters({
          diffuse: layer('diffuse', [1, 0, 0, 1]),
          diffuse3: layer('diffuse3', [0, 1, 0, 1]),
        }),
        { budget },
      ),
    /without diffuseWeights/,
  )
})
