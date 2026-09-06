import type { ValueSpan } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { normalizeSpans } from '../src/spans/index.js'

const span = (from: number, to: number, kind = 'keyword'): ValueSpan =>
  ({ from, to, kind }) as ValueSpan

/**
 * The renderer draws whatever `normalizeSpans` returns, so the rules that decide what is drawable
 * are what needs pinning. Each case below is a way a codec can hand over runs that cannot be laid
 * out on one line; silently drawing them wrong would mis-colour a value, which is worse than not
 * colouring it at all.
 */
describe('value syntax runs', () => {
  it('keeps runs in order regardless of the order they arrive in', () => {
    const kept = normalizeSpans([span(6, 9), span(0, 3)], 12)
    expect(kept.map(item => [item.from, item.to])).toEqual([
      [0, 3],
      [6, 9],
    ])
  })

  it('clamps a run that reaches past the value instead of dropping it', () => {
    expect(normalizeSpans([span(2, 99)], 5)).toEqual([expect.objectContaining({ from: 2, to: 5 })])
  })

  it('drops runs that cannot describe anything', () => {
    // Empty, reversed, negative, or entirely past the end: none of these name a piece of text.
    expect(normalizeSpans([span(3, 3), span(4, 2), span(-1, 2), span(9, 12)], 6)).toEqual([])
  })

  it('resolves an overlap by keeping the first run and dropping what it covers', () => {
    // A codec may report a string that contains a reference; a cell is one line and cannot nest.
    const kept = normalizeSpans([span(0, 8, 'string'), span(3, 6, 'variable')], 10)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ from: 0, to: 8, kind: 'string' })
  })

  it('prefers the longer run when two start together, so the wider grammar wins', () => {
    const kept = normalizeSpans([span(0, 2, 'operator'), span(0, 5, 'string')], 5)
    expect(kept).toEqual([expect.objectContaining({ to: 5, kind: 'string' })])
  })

  it('returns nothing for a codec that publishes no grammar', () => {
    expect(normalizeSpans([], 10)).toEqual([])
  })
})
