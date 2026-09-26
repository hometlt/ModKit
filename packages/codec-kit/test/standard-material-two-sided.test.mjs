import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
} from '../dist/legacy-model-support.js'

const material = twoSided => ({
  layers: {
    diffuse: {
      slot: 'diffuse',
      texturePath: 'leaf.png',
      uvSource: 0,
      channels: 0,
      op: 6,
      teamColorMode: 0,
      invert: false,
      clampResult: false,
      wrapX: true,
      wrapY: true,
    },
  },
  blendMode: 0,
  priority: 0,
  specularity: 0,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0.25,
  twoSided,
  unshaded: false,
  doubleLambert: true,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
})

test('a two-sided material lights a back face by its reversed normal and compiles its own program', () => {
  const twoSided = buildMaterialDefines(material(true), { sceneLighting: true })
  const oneSided = buildMaterialDefines(material(false), { sceneLighting: true })
  assert.match(buildStandardFragmentSource(twoSided), /if \(!gl_FrontFacing\) normal = -normal;/u)
  assert.doesNotMatch(buildStandardFragmentSource(oneSided), /gl_FrontFacing/u)
  assert.notEqual(canonicalDefineKey(twoSided), canonicalDefineKey(oneSided))
})
