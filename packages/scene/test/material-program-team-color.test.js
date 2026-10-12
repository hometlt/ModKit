import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { uvmProgramTeamColor } from '../src/uvm/materials.js'

// UV_game_material_team_color drawn by a material program (С1): BAR's units are programs, and their
// team colour is the colour texture's alpha mixed in by `lerp`.
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const layer = (slot, value, channels = 0) => ({
  slot,
  texturePath: null,
  constantColor: { value },
  uvSource: 0,
  channels,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
})
const program = (extra = {}, layers = {}) => ({
  layers: { diffuse: layer('diffuse', [0.8, 0.8, 0.8, 1]), ...layers },
  blendMode: 0,
  priority: 0,
  specularity: 1,
  specMult: 0,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: true,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...extra,
})
const shader = standard => ({
  id: 'modkit.render-material.v1',
  parameters: { nativeShader: 'spring.s3o', renderModel: { version: 1, standard } },
})

async function centre(standard, teamColor) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [{ id: 'm', baseColor: [1, 1, 1, 1], shader: shader(standard) }],
      primitives: [
        {
          id: 'quad',
          materialId: 'm',
          topology: 'triangles',
          positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
          normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        },
      ],
      ...(teamColor === undefined ? {} : { materialContext: { teamColor } }),
    },
  })
  return [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 3)]
}

it('mixes the team colour into a program by its mask before light (П9, С1)', async () => {
  // the mask is a constant alpha of one half (AAAA): lerp halfway from grey toward blue
  const mixed = program(
    { teamColorBlend: 'lerp' },
    { teamColorMask: layer('teamColorMask', [0, 0, 0, 0.5], 2) },
  )
  // an unshaded program adds the default ambient of 0.02 on top
  const expected = [0.8 + (0 - 0.8) * 0.5, 0.8 + (0.2 - 0.8) * 0.5, 0.8 + (1 - 0.8) * 0.5].map(
    value => value + 0.02,
  )
  const pixel = await centre(mixed, [0, 0.2, 1])
  pixel.forEach((value, channel) =>
    assert.ok(Math.abs(value - Math.round(expected[channel] * 255)) <= 1, `${channel}: ${value}`),
  )
  // a strength without a blend is no reading of the mask
  await assert.rejects(
    centre(program({ teamColorStrength: 2 }), [0, 0.2, 1]),
    /teamColorStrength needs teamColorBlend/,
  )
})

it('turns UV_game_material_team_color into the program mask of the image it names', () => {
  const document = {
    images: [{ uri: 'unittextures/Arm_color.dds' }, { uri: 'unittextures/Arm_other.dds' }],
    textures: [{ source: 1 }, { source: 0 }],
  }
  const team = { mask: { texture: 'uvm-texture-1', channel: 'a' }, blend: 'lerp' }
  const drawn = uvmProgramTeamColor(document, shader(program()), team, 1, 0)
  const standard = drawn.parameters.renderModel.standard
  assert.equal(drawn.parameters.nativeShader, 'spring.s3o')
  assert.equal(standard.teamColorBlend, 'lerp')
  assert.equal(standard.teamColorStrength, undefined)
  assert.deepEqual(
    [standard.layers.teamColorMask.texturePath, standard.layers.teamColorMask.channels],
    ['unittextures/Arm_color.dds', 2],
  )
  // strength and a whole mask
  const whole = uvmProgramTeamColor(
    document,
    shader(program()),
    { mask: 'whole', blend: 'add', strength: 3 },
    undefined,
    0,
  ).parameters.renderModel.standard
  assert.equal(whole.teamColorStrength, 3)
  assert.deepEqual(whole.layers.teamColorMask.constantColor, { value: [1, 1, 1, 1] })
  // nothing to do: a program that reads its own team colour, a per-channel mask, no program
  for (const own of [
    program({ teamColorMaskMix: true }),
    program({}, { teamColorMask: layer('teamColorMask', [1, 1, 1, 1]) }),
  ])
    assert.equal(uvmProgramTeamColor(document, shader(own), team, 1, 0), undefined)
  assert.equal(
    uvmProgramTeamColor(
      document,
      shader(program()),
      { mask: { texture: 'uvm-texture-1', channel: 'rgb' }, blend: 'lerp' },
      1,
      0,
    ),
    undefined,
  )
  assert.equal(
    uvmProgramTeamColor(document, { id: 'spring.s3o', parameters: {} }, team, 1, 0),
    undefined,
  )
})
