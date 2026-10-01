import { describe, expect, it } from 'vitest'
import {
  TEAM_COLOR_BLENDS,
  TEAM_COLOR_GLSL,
  teamColorChannel,
} from '../src/model-math/color-remap.js'

describe('the UV_game_material_team_color formula', () => {
  it('tints, adds, takes over or overlays where the mask weighs, by the strength', () => {
    // a mid-grey texel, a red channel of team colour 1, half the mask
    expect(teamColorChannel(0.5, 1, 0, 'multiply')).toBe(0)
    expect(teamColorChannel(0.5, 0.5, 0, 'multiply')).toBe(0.25)
    expect(teamColorChannel(0.5, 0, 0, 'multiply')).toBe(0.5)
    expect(teamColorChannel(0.5, 0.5, 1, 'add')).toBe(1)
    expect(teamColorChannel(0.5, 0.5, 1, 'add', 2)).toBe(1.5)
    expect(teamColorChannel(0.25, 1, 1, 'lerp')).toBe(1)
    expect(teamColorChannel(0.25, 0.5, 1, 'replace')).toBe(0.625)
    // overlay: dark base multiplies (2·b·t), light base screens
    expect(teamColorChannel(0.25, 1, 0.5, 'overlay')).toBe(0.25)
    expect(teamColorChannel(0.75, 1, 0.5, 'overlay')).toBe(0.75)
    expect(teamColorChannel(0.75, 1, 1, 'overlay')).toBe(1)
    // a weight past 1 mixes no further than the team colour
    expect(teamColorChannel(0.25, 1, 1, 'lerp', 3)).toBe(1)
  })

  it('names its blends for shaders in one order', () => {
    expect(TEAM_COLOR_BLENDS).toEqual(['multiply', 'add', 'replace', 'overlay', 'lerp'])
    expect(TEAM_COLOR_GLSL).toContain('vec3 modkitTeamColor(')
  })
})
