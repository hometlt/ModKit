import { describe, expect, it } from 'vitest'
import { normalizeCompanionLogicalId } from '../src/input-resolution.js'

describe('confined companion path normalization', () => {
  it('preserves ordinary paths and normalizes empty or dot segments under either separator', () => {
    for (const [input, expected] of [
      ['Assets/Units/Marine.m3', 'Assets/Units/Marine.m3'],
      ['Assets\\Units\\Marine.m3', 'Assets/Units/Marine.m3'],
      ['./Assets//Units/./Marine.m3/', 'Assets/Units/Marine.m3'],
      ['Assets/./', 'Assets'],
      ['Assets/.../.hidden', 'Assets/.../.hidden'],
      ['Assets/ユニット/😀.m3', 'Assets/ユニット/😀.m3'],
      ['Assets/../Marine.m3', undefined],
      ['Assets\\..\\Marine.m3', undefined],
      ['', undefined],
      ['.', undefined],
      ['/', undefined],
      ['//server/Marine.m3', undefined],
      ['C:Marine.m3', undefined],
      ['Assets/Marine\0.m3', undefined],
    ] as const) {
      if (expected === undefined) expect(() => normalizeCompanionLogicalId(input)).toThrow()
      else expect(normalizeCompanionLogicalId(input)).toBe(expected)
    }
  })
})
