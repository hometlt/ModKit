import { describe, expect, it } from 'vitest'
import { compileSearch, matches, matchRanges, createFilter } from '../src/search/matcher.js'

/**
 * Parity with MK2 `text-filter.ts` / `strings-search.ts` / `archive-search.ts`.
 * The three semantics that must not drift: empty matches everything, an invalid expression
 * matches nothing, and whole-word plain matching keeps scanning past a rejected hit.
 */
describe('search matcher — MK2 parity', () => {
  it('treats an empty query as matching everything', () => {
    const compiled = compileSearch('')
    expect(compiled.kind).toBe('empty')
    expect(matches('anything', compiled)).toBe(true)
    expect(matchRanges('anything', compiled)).toEqual([])
  })

  it('treats an invalid expression as matching nothing', () => {
    const compiled = compileSearch('(unclosed', { mode: 'regex' })
    expect(compiled.kind).toBe('invalid')
    expect(matches('(unclosed', compiled)).toBe(false)
  })

  it('is case insensitive by default and case sensitive on request', () => {
    expect(matches('Marine', compileSearch('marine'))).toBe(true)
    expect(matches('Marine', compileSearch('marine', { caseSensitive: true }))).toBe(false)
    expect(matches('Marine', compileSearch('Marine', { caseSensitive: true }))).toBe(true)
  })

  it('keeps scanning past a rejected whole-word hit', () => {
    // "arm" appears inside "armor" first; the standalone word later must still be found.
    const compiled = compileSearch('arm', { wholeWord: true })
    expect(matches('armor plating, arm mounted', compiled)).toBe(true)
    expect(matches('armor plating only', compiled)).toBe(false)
  })

  it('anchors whole-word regex with the MK2 lookarounds', () => {
    const compiled = compileSearch('arm', { mode: 'regex', wholeWord: true })
    expect(matches('arm', compiled)).toBe(true)
    expect(matches('armor', compiled)).toBe(false)
  })

  it('reports every match range, or only the first', () => {
    const compiled = compileSearch('a')
    expect(matchRanges('banana', compiled)).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 6 },
    ])
    expect(matchRanges('banana', compiled, true)).toEqual([{ start: 1, end: 2 }])
  })

  it('does not hang on a zero-length regex match', () => {
    const compiled = compileSearch('x*', { mode: 'regex' })
    expect(matchRanges('abc', compiled).length).toBeLessThanOrEqual(1)
  })

  it('matches glob patterns the way the MK2 archive filter did', () => {
    expect(matches('Marine.m3', compileSearch('*.m3', { mode: 'glob' }))).toBe(true)
    expect(matches('Marine.dds', compileSearch('*.m3', { mode: 'glob' }))).toBe(false)
    // A bare query with no star stays a substring match, exactly as MK2 did.
    expect(matches('Assets/Marine.m3', compileSearch('marine', { mode: 'glob' }))).toBe(true)
  })

  it('escapes regex metacharacters inside a glob', () => {
    expect(matches('a.b', compileSearch('a.b', { mode: 'glob' }))).toBe(true)
    expect(matches('axb', compileSearch('a.b', { mode: 'glob' }))).toBe(false)
  })

  it('exposes a reusable predicate', () => {
    const keep = createFilter('m3', {})
    expect(['Marine.m3', 'Marine.dds'].filter(keep)).toEqual(['Marine.m3'])
  })
})
