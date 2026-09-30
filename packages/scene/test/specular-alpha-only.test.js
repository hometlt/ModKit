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
// SC2's unbuildable rocks: an alpha-only specular (spec_mode 1) whose texture keeps a dark RGB in an
// opaque DXT1, under a team-colored diffuse.
const rocks = diffuseTeamColorMode => ({
  renderModel: {
    version: 1,
    standard: {
      layers: {
        diffuse: layer('diffuse', { teamColorMode: diffuseTeamColorMode, constantColor: { value: [0.2, 0.2, 0.2, 1] } }),
        specular: layer('specular', { constantColor: { value: [0.03, 0.03, 0.03, 1] } }),
      },
      blendMode: 0,
      priority: 0,
      specularity: 5,
      specMult: 1,
      emisMult: 1,
      specMode: 1,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: false,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
    },
  },
})

it('reads an alpha-only specular as its alpha only under a team-colored diffuse, as PSMaterial.fx does', () => {
  const programs = (model, teamColorIntensity) =>
    createStandardMaterialPrograms(model, { budget }).sample({ time: 0 }, { teamColorIntensity })
  const [teamColored] = programs(rocks(1), 1)
  const [neutral] = programs(rocks(1), 0)
  const [plain] = programs(rocks(0), 1)
  assert.match(teamColored.fragmentSource, /vec3 spec = vec3\(specColor\.a\) \* specFactor;/)
  // A neutral object carries no team color, and a material without a team-colored diffuse never
  // reads the alpha: both take the specular RGB, so the dark plates stay dark.
  for (const program of [neutral, plain]) {
    assert.doesNotMatch(program.fragmentSource, /vec3\(specColor\.a\)/)
    assert.match(program.fragmentSource, /vec3 spec = specColor\.rgb \* specFactor;/)
  }
})
