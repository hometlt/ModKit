import { describe, expect, it } from 'vitest'
import { PBR_GLSL, shadePbr } from '../src/model-math/pbr.js'

const up = [0, 0, 1] as const
const white = { direction: up, color: [1, 1, 1] as const }
const black = [0, 0, 0] as const

describe('the glTF metallic-roughness BRDF', () => {
  it('lights a rough white dielectric facing the light almost as Lambert does', () => {
    const [r] = shadePbr({ baseColor: [1, 1, 1], metallic: 0, roughness: 1 }, up, up, white, black)
    // (1 − F)·1 + π·F·D·V with F = 0.04, D = 1/π, V = 1/4
    expect(r).toBeCloseTo(0.97, 6)
  })

  it('reflects a metal in its own colour, with no diffuse light', () => {
    const gold = { baseColor: [1, 0.5, 0] as const, metallic: 1, roughness: 0.2 }
    const [r, g, b] = shadePbr(gold, up, up, white, black)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    expect(b).toBe(0)
    // the ambient alone still shows the colour, not black
    const [ar, ag, ab] = shadePbr(
      gold,
      up,
      up,
      { direction: [0, 0, -1], color: [1, 1, 1] },
      [1, 1, 1],
    )
    expect(ar).toBeGreaterThan(ag)
    expect(ag).toBeGreaterThan(ab)
    expect(ar).toBeGreaterThan(0.5)
  })

  it('adds emission and occluded ambient where the light does not reach', () => {
    const shaded = shadePbr(
      { baseColor: [1, 1, 1], metallic: 0, roughness: 1, occlusion: 0, emissive: [0.1, 0, 0] },
      up,
      up,
      { direction: [0, 0, -1], color: [1, 1, 1] },
      [1, 1, 1],
    )
    expect(shaded).toEqual([0.1, 0, 0])
    expect(PBR_GLSL).toContain('vec3 modkitPbr(')
  })
})
