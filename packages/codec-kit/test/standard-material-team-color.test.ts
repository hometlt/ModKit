import { expect, it } from 'vitest'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
} from '../src/model-math/standard-material-glsl.js'
import { teamColorChannel } from '../src/model-math/color-remap.js'

// A material program drawing UV_game_material_team_color (С1): its teamColorMask layer colours the
// base before light by the one formula, as BAR's units mix toward the team colour by tex1's alpha.
const layer = (slot: string, texel: readonly number[], channels = 0) => ({
  slot,
  texturePath: `${slot}.png`,
  uvSource: 0,
  channels,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
  texel,
})
const base = [0.2, 0.4, 0.6, 0.75]
const team = [0.1, 0.3, 1] as const
const team3 = team
const input = (extra: object = {}, mask = 0.75) =>
  ({
    layers: {
      diffuse: layer('diffuse', base),
      // the mask is the colour texture's alpha (AAAA), BAR's tex1.a
      teamColorMask: layer('teamColorMask', [0, 0, 0, mask], 2),
    },
    teamColor: [...team],
    ambient: [0, 0, 0, 0],
    vertexNormal: [0, 0, 1],
    lightDir: [0, 0, 1],
    viewDir: [0, 0, 1],
    specularity: 1,
    specMult: 0,
    emisMult: 1,
    specMode: 0,
    unshaded: true,
    doubleLambert: false,
    clampOutput: false,
    alphaTestThreshold: 0,
    ...extra,
  }) as never

it('colours the base by the team colour formula before light, in place of the grain merge', () => {
  for (const [blend, strength] of [
    ['lerp', 1],
    ['add', 3],
    ['multiply', 1],
  ] as const) {
    const { rgba } = composeStandardPixelCpu(
      input({ teamColorBlend: blend, teamColorStrength: strength }),
    )
    rgba
      .slice(0, 3)
      .forEach((value, channel) =>
        expect(value).toBeCloseTo(
          teamColorChannel(base[channel]!, 0.75, team[channel]!, blend, strength),
          6,
        ),
      )
  }
  // without the blend the same mask is StarCraft II's grain merge after light
  const grain = composeStandardPixelCpu(input()).rgba
  expect(grain[0]).toBeCloseTo(base[0]! + (team[0] - 0.5) * 0.75, 6)
  // mask 0 leaves the base as it is
  const none = composeStandardPixelCpu(input({ teamColorBlend: 'lerp' }, 0)).rgba
  expect(none.slice(0, 3).map(value => Number(value.toFixed(6)))).toEqual([0.2, 0.4, 0.6])
})

it('mixes the team colour into the emissive layers by the same mask (teamColorEmissive)', () => {
  // BAR's glow is its team-coloured albedo: emissive1 is the colour texture, the mask its red
  const glowing = (extra: object) =>
    composeStandardPixelCpu(
      input({
        teamColorBlend: 'lerp',
        unshaded: false,
        layers: {
          diffuse: layer('diffuse', base),
          teamColorMask: layer('teamColorMask', [0, 0, 0, 0.75], 2),
          emissive1: layer('emissive1', base),
          emissiveMask: layer('emissiveMask', [1, 1, 1, 1]),
        },
        ...extra,
      }),
    ).rgba
  const plain = glowing({})
  const team = glowing({ teamColorEmissive: true })
  for (const channel of [0, 1, 2]) {
    const tinted = teamColorChannel(base[channel]!, 0.75, team3[channel]!, 'lerp', 1)
    expect(team[channel]! - plain[channel]!).toBeCloseTo(tinted - base[channel]!, 6)
  }
})

it('draws the same formula in GLSL, its blend and strength in the program key', () => {
  const material = {
    layers: {
      diffuse: { ...layer('diffuse', base), texel: undefined },
      emissive1: { ...layer('emissive1', base), texel: undefined },
      teamColorMask: { ...layer('teamColorMask', base, 2), texel: undefined },
    },
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
    teamColorBlend: 'add',
    teamColorStrength: 3,
    teamColorEmissive: true,
  } as never
  const defines = buildMaterialDefines(material)
  expect(canonicalDefineKey(defines)).toContain(';tcb=add,3,e')
  const source = buildStandardFragmentSource(defines)
  expect(source).toContain('vec3 modkitTeamColor(')
  expect(source).toContain('color = modkitTeamColor(color, vec3(computeLayer_teamColorMask().r)')
  expect(source).toContain('emis1Color.rgb = modkitTeamColor(emis1Color.rgb')
  // the grain merge is not drawn on top
  expect(source).not.toContain('final.rgb += (u_teamColor - vec3(0.5)) * teamColorMask;')
})
