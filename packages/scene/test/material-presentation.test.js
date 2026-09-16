import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const params = (renderModel = {}, diffuse = {}) => ({
  renderModel: {
    version: 1,
    standard: {
      layers: {
        diffuse: {
          slot: 'diffuse',
          texturePath: null,
          constantColor: { value: [0, 1, 0, 0.25] },
          uvSource: 0,
          channels: 0,
          op: 2,
          teamColorMode: 1,
          invert: false,
          clampResult: true,
          wrapX: true,
          wrapY: true,
          ...diffuse,
        },
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
    ...renderModel,
  },
})

it('draws no color pass and acquires no texture for distortion and terrain-projection materials', () => {
  for (const presentation of ['screen-distortion', 'terrain-projection']) {
    const programs = createStandardMaterialPrograms(
      params({ presentation }, { texturePath: 'BigWaves.dds', constantColor: undefined }),
      { budget },
    )
    assert.deepEqual(programs.resources, [])
    assert.deepEqual(programs.sample({ time: 0 }), [])
  }
  assert.throws(
    () => createStandardMaterialPrograms(params({ presentation: 'glow' }), { budget }),
    /presentation/,
  )
})

it('keeps the texel color of diffuse team-color layers at team color intensity 0', () => {
  const shade = teamColorIntensity =>
    createStandardMaterialPrograms(params(), { budget })
      .sample({ time: 0 }, { teamColor: [1, 1, 1], teamColorIntensity })[0]
      .shade({})
      .rgba.slice(0, 3)
  // lerp(team, texel, alpha): mostly the white team color at intensity 1, the green texel at 0.
  // Both include the default 0.02 ambient term.
  assert.ok(Math.abs(shade(1)[0] - 0.77) < 1e-6)
  assert.ok(Math.abs(shade(0)[0] - 0.02) < 1e-6)
  assert.throws(() => shade(0.5), /0 or 1/)
})
