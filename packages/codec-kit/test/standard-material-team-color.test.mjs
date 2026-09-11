import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  composeStandardPixelCpu,
} from '../dist/legacy-model-support.js'

const layer = (slot, texel) => ({
  slot,
  texturePath: `${slot}.png`,
  uvSource: 0,
  channels: slot === 'teamColorMask' ? 3 : 1,
  op: slot === 'diffuse' ? 6 : 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
  texel,
})

test('teamColorMask uses red-channel post-light grain merge in CPU and GLSL', () => {
  const diffuse = layer('diffuse', [0.25, 0.5, 0.75, 1])
  const teamColorMask = layer('teamColorMask', [0.5, 1, 1, 1])
  const result = composeStandardPixelCpu({
    layers: { diffuse, teamColorMask },
    ambient: [0, 0, 0, 1],
    teamColor: [1, 0.5, 0],
    vertexNormal: [0, 0, 1],
    lightDir: [0, 0, 1],
    specularity: 0,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
  })
  assert.deepEqual(result.rgba, [0.5, 0.5, 0.5, 1])
  const source = buildStandardFragmentSource(buildMaterialDefines({
    layers: { diffuse, teamColorMask },
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
  }))
  assert.match(source, /\(u_teamColor - vec3\(0\.5\)\) \* teamColorMask/u)
})
