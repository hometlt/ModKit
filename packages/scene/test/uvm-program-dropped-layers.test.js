import assert from 'node:assert/strict'
import { it } from 'node:test'
import { uvmProgramWithoutLayers } from '../src/uvm/materials.js'

// A program whose normal map did not resolve still draws its colour: BAR's Legion normal maps are
// 89 MB, past the host's per-entry read, and took their units to the base-colour fallback.
const layer = (slot, texturePath) => ({ slot, texturePath, uvSource: 0, channels: 0, op: 2 })
const shader = layers => ({
  id: 'modkit.render-material.v1',
  parameters: {
    nativeShader: 'spring.s3o',
    renderModel: {
      version: 1,
      standard: { layers, tangentGeneration: { texCoord: 0 }, blendMode: 0 },
    },
  },
})
const program = shader({
  diffuse: layer('diffuse', 'color.dds'),
  metalness: layer('metalness', 'other.dds'),
  normal: layer('normal', 'normal.dds'),
})

it('drops an unresolved normal map and its tangents, keeping every other layer', () => {
  const without = uvmProgramWithoutLayers(program, new Set(['normal.dds']))
  assert.deepEqual(without.dropped, ['normal'])
  const standard = without.shader.parameters.renderModel.standard
  assert.deepEqual(Object.keys(standard.layers), ['diffuse', 'metalness'])
  assert.equal(standard.tangentGeneration, undefined)
  assert.equal(standard.blendMode, 0)
  assert.equal(without.shader.parameters.nativeShader, 'spring.s3o')
})

it('keeps the fallback when an unresolved texture feeds the colour or nothing is missing', () => {
  assert.equal(uvmProgramWithoutLayers(program, new Set(['color.dds', 'normal.dds'])), undefined)
  assert.equal(uvmProgramWithoutLayers(program, new Set()), undefined)
  assert.equal(
    uvmProgramWithoutLayers({ id: 'spring.s3o', parameters: {} }, new Set(['normal.dds'])),
    undefined,
  )
})
