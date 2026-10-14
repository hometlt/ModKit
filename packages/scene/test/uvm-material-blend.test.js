import assert from 'node:assert/strict'
import { it } from 'node:test'
import { uvmMaterialBlendEffect } from '../src/uvm/materials.js'
import { blendMaterialPixel } from '../src/render/material-draws.js'

const repeat = () => ({ wrapU: 'repeat', wrapV: 'clamp' })
const gameMaterial = (fields, extra = {}) => ({
  ...extra,
  extensions: { UV_game_material: { shader: 'DefaultW3D.fx', params: {}, ...fields } },
})

it('draws an additive UV_game_material as a simple effect that writes no depth', () => {
  assert.deepEqual(uvmMaterialBlendEffect(gameMaterial({ blendMode: 'additive' }), repeat), {
    blend: 'additive-one-one',
    depthTest: true,
    depthWrite: false,
    doubleSided: false,
    alphaCutoff: 0,
    wrapU: 'repeat',
    wrapV: 'clamp',
  })
  const culled = uvmMaterialBlendEffect(
    gameMaterial({ blendMode: 'modulate2x', cull: 'none' }),
    repeat,
  )
  assert.equal(culled.blend, 'modulate2x')
  assert.equal(culled.doubleSided, true)
  assert.equal(
    uvmMaterialBlendEffect(gameMaterial({ blendMode: 'modulate' }, { doubleSided: true }), repeat)
      .doubleSided,
    true,
  )
  // Kane's Wrath's add-alpha: SrcAlpha, One
  assert.equal(
    uvmMaterialBlendEffect(gameMaterial({ blendMode: 'add-alpha' }), repeat).blend,
    'add-alpha',
  )
})

it('leaves glTF alphaMode, and a material program with its own blend, to their routes', () => {
  let asked = 0
  const wrap = () => {
    asked += 1
    return repeat()
  }
  for (const material of [
    {},
    { alphaMode: 'BLEND' },
    gameMaterial({}),
    gameMaterial({ blendMode: 'alpha-blend' }),
    gameMaterial({ blendMode: 'opaque' }),
    gameMaterial({
      blendMode: 'additive',
      params: { renderModel: { version: 1, standard: { blendMode: 2 } } },
    }),
  ])
    assert.equal(uvmMaterialBlendEffect(material, wrap), undefined)
  // the texture sampler is read only for a material that draws as an effect
  assert.equal(asked, 0)
})

it('adds black as nothing: an additive black texel leaves the pixel as it was', () => {
  const frame = Uint8Array.of(40, 50, 60, 255)
  blendMaterialPixel(frame, 0, [0, 0, 0, 1], { blend: 'additive' })
  assert.deepEqual([...frame], [40, 50, 60, 255])
  blendMaterialPixel(frame, 0, [0.5, 0, 0, 1], { blend: 'additive' })
  assert.deepEqual([...frame.subarray(0, 3)], [168, 50, 60])
})
