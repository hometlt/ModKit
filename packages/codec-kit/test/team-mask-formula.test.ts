import { describe, expect, it } from 'vitest'
import { TEAM_MASK_GLSL, teamMaskSample } from '../src/model-math/color-remap.js'

const red = [1, 0, 0] as const

describe('how a team colour mask weighs it (Runtime 02.10)', () => {
  it('weighs by the data channel, or each channel by its own', () => {
    expect(teamMaskSample({ mode: 'data', channel: 3 }, [0, 0, 0, 0.5], [], red)).toEqual({
      weight: [0.5, 0.5, 0.5],
      color: red,
    })
    expect(
      teamMaskSample({ mode: 'data', channel: 'rgb' }, [0.1, 0.2, 0.3, 1], [], red).weight,
    ).toEqual([0.1, 0.2, 0.3])
  })

  it('keys the stored texel: blue where R and G are zero takes the colour times its B', () => {
    const key = { mode: 'key', channel: 'rgb', thresholds: [0, 0, 255], intensity: 2 } as const
    expect(teamMaskSample(key, [0, 0, 0.8, 1], [0, 0, 204, 255], red)).toEqual({
      weight: [1, 1, 1],
      color: [0.8, 0, 0],
    })
    // a texel off the key keeps its colour
    expect(teamMaskSample(key, [0.04, 0, 0.8, 1], [10, 0, 204, 255], red).weight).toEqual([0, 0, 0])
  })

  it('takes a palette index shade within the range, the draw’s index read as stored', () => {
    const ramp = {
      mode: 'ramp',
      channel: 0,
      shades: [
        [0, 0, 1],
        [0, 1, 0],
      ],
      first: 2,
      scale: 255,
    } as const
    expect(teamMaskSample(ramp, [0, 0, 0, 1], [3, 0, 0, 255], red)).toEqual({
      weight: [1, 1, 1],
      color: [0, 1, 0],
    })
    // below and above the range: nothing
    expect(teamMaskSample(ramp, [0, 0, 0, 1], [1, 0, 0, 255], red).weight).toEqual([0, 0, 0])
    expect(teamMaskSample(ramp, [0, 0, 0, 1], [4, 0, 0, 255], red).weight).toEqual([0, 0, 0])
  })

  it('tints the colour by the mask’s own colour, coverage still the channel', () => {
    expect(
      teamMaskSample({ mode: 'data', channel: 3, tintRgb: true }, [0.5, 1, 1, 1], [], red),
    ).toEqual({ weight: [1, 1, 1], color: [0.5, 0, 0] })
    expect(TEAM_MASK_GLSL).toContain('vec3 modkitTeamMask(')
  })
})
