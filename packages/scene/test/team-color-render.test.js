import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { uvmMaterialTeamColor } from '../src/uvm/materials.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
// a quad over the whole frame, u running left to right
const quad = {
  id: 'quad',
  materialId: 'unit',
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
}
const pixel = (frame, x) => [...frame.rgba.subarray((4 * 8 + x) * 4, (4 * 8 + x) * 4 + 4)]
const draw = (material, textures, teamColor) =>
  renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [{ id: 'unit', ...material }],
      primitives: [quad],
      textures,
      ...(teamColor === undefined ? {} : { materialContext: { teamColor } }),
    },
  })
// white albedo; the mask's alpha covers the left half
const albedo = {
  id: 'albedo',
  width: 2,
  height: 1,
  rgba: Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255),
}
const mask = { id: 'mask', width: 2, height: 1, rgba: Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 0) }

for (const filter of ['nearest', 'linear'])
  it(`draws UV_game_material_team_color with ${filter} mask filtering (П9)`, async () => {
    const frame = await draw(
      {
        baseColor: [1, 1, 1, 1],
        baseColorTexture: 'albedo',
        teamColor: { mask: { texture: 'mask', channel: 'a' }, blend: 'lerp' },
      },
      [albedo, { ...mask, filter }],
      [1, 0, 0],
    )
    // At these pixel centres linear sampling weighs the two mask texels 7/8 and 1/8.
    assert.deepEqual(pixel(frame, 1), filter === 'nearest' ? [255, 0, 0, 255] : [255, 32, 32, 255])
    assert.deepEqual(
      pixel(frame, 6),
      filter === 'nearest' ? [255, 255, 255, 255] : [255, 223, 223, 255],
    )
    // without a team colour, the extension's default; `whole` tints all of it, alpha its own
    const tinted = await draw(
      {
        baseColor: [0.5, 0.5, 0.5, 1],
        teamColor: { mask: 'whole', blend: 'multiply', defaultColor: [0, 1, 0] },
      },
      [],
    )
    assert.deepEqual(pixel(tinted, 1), [0, 128, 0, 255])
  })

it('reads the team colour a UVM material states, and says what the base route cannot draw', () => {
  const material = extension => ({ extensions: { UV_game_material_team_color: extension } })
  assert.deepEqual(
    uvmMaterialTeamColor(
      material({ maskSource: 'texture', maskTexture: { index: 2, channel: 'a' }, blend: 'lerp' }),
      0,
    ),
    {
      teamColor: { mask: { texture: 'uvm-texture-2', channel: 'a' }, blend: 'lerp' },
      maskTexture: 2,
    },
  )
  assert.deepEqual(
    uvmMaterialTeamColor(material({ maskSource: 'whole', defaultColor: [0, 0, 1, 1] }), 0),
    { teamColor: { mask: 'whole', blend: 'multiply', defaultColor: [0, 0, 1] } },
  )
  assert.match(
    uvmMaterialTeamColor(material({ maskSource: 'paletteRange', range: [8, 15] }), 0).unrendered,
    /paletteRange mask is not drawn yet/u,
  )
  assert.deepEqual(uvmMaterialTeamColor({}, 0), {})
})
