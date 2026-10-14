/** Independent scalar expectations and trust-boundary checks for the shared CDF97 synthesis. */
import { describe, expect, it } from 'vitest'
import { synthesizeCdf97 } from '../src/texture/cdf97.js'

/** Four equal bordered coefficient bands with a constant low-pass signal. */
function bands() {
  return {
    width: 8,
    height: 8,
    ll: new Float64Array(64).fill(0.5),
    lh: new Float64Array(64),
    hl: new Float64Array(64),
    hh: new Float64Array(64),
  }
}
const window = { x: 2, y: 2, width: 2, height: 2 },
  options = { maxElements: 1000 }

describe('shared CDF97 inverse synthesis', () => {
  it('preserves DC and emits an explicit doubled window', () => {
    const result = synthesizeCdf97(bands(), window, options)
    expect(result.length).toBe(16)
    for (const value of result) expect(value).toBeCloseTo(0.5, 7)
  })
  it('matches separable high-high impulse taps and explicit profile adjustment', () => {
    const input = bands()
    input.ll.fill(0)
    input.hh[2 * 8 + 2] = 1
    const result = synthesizeCdf97(input, window, options)
    expect(result[0]).toBeCloseTo((-0.266864118443) ** 2, 12)
    expect(result[1]).toBeCloseTo(-0.266864118443 * 0.602949018236, 12)
    expect(result[4]).toBeCloseTo(result[1]!, 12)
    expect(result[5]).toBeCloseTo(0.602949018236 ** 2, 12)
    input.hh.fill(0)
    input.lh[4 * 8 + 2] = 1
    expect(synthesizeCdf97(input, window, options)[4]).toBeCloseTo(0.026748757411 * 1.11508705, 12)
    expect(synthesizeCdf97(input, window, { ...options, lhVerticalOddLastOffset: 1 })[4]).toBe(0)
    expect(synthesizeCdf97(input, window, { ...options, lhVerticalOddLastOffset: 1 })[4]).not.toBe(
      synthesizeCdf97(input, window, options)[4],
    )
  })
  it('keeps directional bands distinct and refuses synthesis overflow', () => {
    const taps = {
      ll: 1.11508705 ** 2,
      lh: -0.266864118443 * 1.11508705,
      hl: -0.266864118443 * 1.11508705,
      hh: (-0.266864118443) ** 2,
    }
    for (const name of ['ll', 'lh', 'hl', 'hh'] as const) {
      const input = bands()
      input.ll.fill(0)
      input[name][2 * 8 + 2] = 1
      expect(synthesizeCdf97(input, window, options)[0]).toBeCloseTo(taps[name], 12)
    }
    const input = bands()
    input.ll.fill(Number.MAX_VALUE)
    expect(() => synthesizeCdf97(input, window, options)).toThrow(/overflow/)
  })
  it('refuses partial bands, unsupported borders, nonfinite data, budgets and cancellation', () => {
    expect(() => synthesizeCdf97(bands(), window, { maxElements: 1 })).toThrow(/budget/)
    expect(() => synthesizeCdf97(bands(), { ...window, x: 1 }, options)).toThrow(/border/)
    expect(() => synthesizeCdf97({ ...bands(), lh: new Float64Array(1) }, window, options)).toThrow(
      /size/,
    )
    const bad = bands()
    bad.ll[0] = NaN
    expect(() => synthesizeCdf97(bad, window, options)).toThrow(/finite/)
    expect(() =>
      synthesizeCdf97(bands(), window, { ...options, signal: AbortSignal.abort() }),
    ).toThrow()
  })
})
