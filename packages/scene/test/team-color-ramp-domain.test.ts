import { expect, it } from 'vitest'
import { srgbToLinear } from '@modkit/codec-kit/raster'
import { applyDrawTeamColor, drawTeamColor, teamMaskRule, teamMaskRuleForSrgb } from '../src/render/team-color.js'

it('keeps authored and selected ramps linear, converting one draw to stored-texel colour', () => {
  const rgb = [24 / 255, 33 / 255, 239 / 255] as const
  const linear = rgb.map(srgbToLinear) as [number, number, number]
  const shades = [linear]
  const team = { mask: { texture: 'indices', channel: 'r' as const }, blend: 'replace' as const,
    ramp: { shades: [[0, 0, 0] as const], first: 240, scale: 255 } }
  const rule = teamMaskRule(team, { teamRamp: shades })!
  expect(rule.shades).toBe(shades)
  const prepared = teamMaskRuleForSrgb(rule)
  prepared.shades![0]!.forEach((value, channel) => expect(value).toBeCloseTo(rgb[channel]!, 14))
  expect(rule.shades![0]).toEqual(linear)
  const drawn = drawTeamColor({ id: 'sprite', baseColor: [1, 1, 1, 1], teamColor: team },
    { teamRamp: shades })!
  expect(applyDrawTeamColor(drawn, [1, 1, 1], [240 / 255, 0, 0, 1])
    .map(value => Math.round(value * 255))).toEqual([24, 33, 239])
})

it('leaves data masks and colour keys in their declared domain', () => {
  const data = { mode: 'data' as const, channel: 0 as const }
  const key = { mode: 'key' as const, channel: 0 as const }
  expect(teamMaskRuleForSrgb(data)).toBe(data)
  expect(teamMaskRuleForSrgb(key)).toBe(key)
})
