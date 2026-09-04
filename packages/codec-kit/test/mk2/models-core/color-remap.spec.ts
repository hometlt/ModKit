import { describe, expect, it } from 'vitest'
import { applyRenderMaterialColorRemap } from '../../../src/model-math/color-remap.js'

describe('renderer-neutral material color remaps', () => {
  it('preserves source brightness for team-color palette ramps', () => {
    const remap = { target: 'team-color', operation: 'hsv-shade' } as const

    expect(applyRenderMaterialColorRemap([0.5, 0, 0, 0.75], remap, [0, 0, 1])).toEqual([
      0, 0, 0.5, 0.75,
    ])
    expect(applyRenderMaterialColorRemap([1, 0, 0, 1], remap, [0, 0.5, 0])[1]).toBeCloseTo(0.5)
  })

  it('supports replace and multiply without changing authored alpha', () => {
    expect(
      applyRenderMaterialColorRemap(
        [0.5, 0.25, 1, 0.4],
        { target: 'team-color', operation: 'replace' },
        [0, 1, 0, 0.1],
      ),
    ).toEqual([0, 1, 0, 0.4])
    expect(
      applyRenderMaterialColorRemap(
        [0.5, 0.25, 1, 0.4],
        { target: 'team-color', operation: 'multiply' },
        [0.5, 1, 0.25],
      ),
    ).toEqual([0.25, 0.25, 0.25, 0.4])
  })

  it('leaves non-remapped colors unchanged and clamps invalid channels', () => {
    expect(applyRenderMaterialColorRemap([2, -1, 0.5, Number.NaN], undefined, [0, 1, 0])).toEqual([
      1, 0, 0.5, 0,
    ])
  })
})
