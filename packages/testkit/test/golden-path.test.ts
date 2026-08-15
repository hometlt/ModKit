import { describe, expect, it } from 'vitest'
import { assertGoldenPathMetrics, GOLDEN_PATH_CONCEPTS } from '@modkitx-x3/testkit'

describe('A-4 golden-path metric gate', () => {
  it('accepts the scaffold baseline and rejects any measured regression', () => {
    const baseline = {
      stepsToFirstGreen: 5,
      filesTouched: 5,
      conceptsRequired: GOLDEN_PATH_CONCEPTS,
      timeToBadgeMs: 1,
    }
    expect(() => assertGoldenPathMetrics(baseline)).not.toThrow()
    expect(() => assertGoldenPathMetrics({ ...baseline, stepsToFirstGreen: 6 })).toThrow(
      /golden path regressed/,
    )
    expect(() =>
      assertGoldenPathMetrics({
        ...baseline,
        conceptsRequired: [...GOLDEN_PATH_CONCEPTS, 'Trait'],
      }),
    ).toThrow(/golden path regressed/)
  })
})
