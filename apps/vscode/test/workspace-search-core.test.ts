import { describe, expect, it } from 'vitest'

import {
  contentIndexApplies,
  createQuickOpenRanking,
  decodeText,
  findTextMatches,
  globMatcher,
  indexableText,
  looksBinary,
  readAhead,
  textSearchRegExp,
} from '../src/workspace-search-core.js'

describe('content index use', () => {
  it('answers a literal printable-ASCII query over the default files only', () => {
    expect(contentIndexApplies({ pattern: 'CUnit Marine' }, [])).toBe(true)
    expect(contentIndexApplies({ pattern: 'Marine', isCaseSensitive: true }, [])).toBe(true)
    expect(contentIndexApplies({ pattern: 'Mar.ne', isRegExp: true }, [])).toBe(false)
    expect(contentIndexApplies({ pattern: 'Marine' }, ['**/*.dds'])).toBe(false)
    // other bytes fold into one class, so their trigrams depend on the file's encoding
    expect(contentIndexApplies({ pattern: 'Морпех' }, [])).toBe(false)
    expect(contentIndexApplies({ pattern: 'line\nbreak' }, [])).toBe(false)
  })

  it('hands the index UTF-16 text as UTF-8 and everything else as it is', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x4d, 0x00, 0x61, 0x00])
    expect(new TextDecoder().decode(indexableText(utf16))).toBe('Ma')
    const utf8 = new TextEncoder().encode('Marine')
    expect(indexableText(utf8)).toBe(utf8)
  })

  it('reads ahead and still yields in order', async () => {
    const started: number[] = []
    const items = async function* () {
      yield* [1, 2, 3, 4, 5]
    }
    const results: number[] = []
    for await (const value of readAhead(
      items(),
      async item => {
        started.push(item)
        await new Promise(done => setTimeout(done, 6 - item))
        return item * 10
      },
      3,
    )) {
      // three reads were already running when the first result arrived
      if (results.length === 0) expect(started.length).toBeGreaterThanOrEqual(3)
      results.push(value)
    }
    expect(results).toEqual([10, 20, 30, 40, 50])
  })
})

const preview = { matchLines: 100, charsPerLine: 10_000 }

describe('globMatcher', () => {
  it('reads the globs VS Code sends: expanded includes, folder excludes, braces and classes', () => {
    const include = globMatcher(['{**/*.xml,**/*.xml/**}'])
    expect(include('Mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml')).toBe(true)
    expect(include('unitdata.XML')).toBe(true)
    expect(include('Mods/core.sc2mod/base.sc2data/gamestrings.txt')).toBe(false)

    const exclude = globMatcher(['**/node_modules', '**/.git'])
    expect(exclude('a/node_modules/b/c.js')).toBe(true)
    expect(exclude('node_modules/x')).toBe(true)
    expect(exclude('a/not_node_modules/c.js')).toBe(false)

    expect(globMatcher(['*.txt'])('top.txt')).toBe(true)
    expect(globMatcher(['*.txt'])('deep/down.txt')).toBe(false)
    expect(globMatcher(['mods/**'])('Mods/liberty.sc2mod/x.xml')).toBe(true)
    expect(globMatcher(['[mM]ods/?ore.sc2mod/**'])('mods/core.sc2mod/a')).toBe(true)
    expect(globMatcher(['campaigns/{liberty,swarm}.sc2campaign/**/*.galaxy'])(
      'Campaigns/swarm.sc2campaign/base.sc2data/triggerlibs/x.galaxy',
    )).toBe(true)
    expect(globMatcher([])('anything')).toBe(false)
  })
})

describe('createQuickOpenRanking', () => {
  it('keeps names that hold the query whole ahead of scattered matches, and says when that is full', () => {
    const ranking = createQuickOpenRanking('unit data', 2)
    ranking.add('mods/a/abilitydata.xml') // no «unitdata» in order: left out
    ranking.add('mods/a/unitsounddata.xml')
    ranking.add('mods/unitdata/readme.txt')
    ranking.add('mods/b/UnitData.xml')
    expect(ranking.full).toBe(false)
    ranking.add('mods/c/unitdata.xml')
    expect(ranking.full).toBe(true)
    expect(ranking.results()).toEqual(['mods/b/UnitData.xml', 'mods/c/unitdata.xml'])
  })
})

describe('findTextMatches', () => {
  it('reports lines and characters, several matches of one line as one hit', () => {
    const text = 'first line\r\n<CUnit id="Marine">Marine</CUnit>\nlast'
    const { hits, matches, limitHit } = findTextMatches(text, textSearchRegExp({ pattern: 'marine' }), {
      multiline: false,
      maximum: 10,
      preview,
    })
    expect(matches).toBe(2)
    expect(limitHit).toBe(false)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.ranges).toEqual([
      { startLine: 1, startCharacter: 11, endLine: 1, endCharacter: 17 },
      { startLine: 1, startCharacter: 19, endLine: 1, endCharacter: 25 },
    ])
    expect(hits[0]!.previewText).toBe('<CUnit id="Marine">Marine</CUnit>')
    expect(hits[0]!.previewRanges[1]).toEqual({ startLine: 0, startCharacter: 19, endLine: 0, endCharacter: 25 })
  })

  it('honours case, whole words, literal punctuation and the match limit', () => {
    const text = 'a.b(c) aXb(c)\nMarine marines MARINE'
    const count = (pattern: string, options: object = {}) =>
      findTextMatches(text, textSearchRegExp({ pattern, ...options }), { multiline: false, maximum: 100, preview }).matches
    expect(count('a.b(c)')).toBe(1)
    expect(count('a.b(c)', { isRegExp: true })).toBe(0)
    expect(count('a.b\\(c\\)', { isRegExp: true })).toBe(2)
    expect(count('marine')).toBe(3)
    expect(count('marine', { isWordMatch: true })).toBe(2)
    expect(count('Marine', { isCaseSensitive: true })).toBe(1)
    const limited = findTextMatches(text, textSearchRegExp({ pattern: 'marine' }), { multiline: false, maximum: 2, preview })
    expect(limited.matches).toBe(2)
    expect(limited.limitHit).toBe(true)
  })

  it('keeps matches on one line unless the query is multiline', () => {
    const text = 'begin\nend'
    const regexp = () => textSearchRegExp({ pattern: 'begin\\nend', isRegExp: true, isMultiline: true })
    expect(findTextMatches(text, regexp(), { multiline: false, maximum: 10, preview }).matches).toBe(0)
    const spanning = findTextMatches(text, regexp(), { multiline: true, maximum: 10, preview })
    expect(spanning.hits[0]!.ranges[0]).toEqual({ startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 3 })
    expect(spanning.hits[0]!.previewText).toBe('begin\nend')
  })

  it('cuts a long line to a window around the match', () => {
    const text = `${'x'.repeat(5000)}needle${'y'.repeat(5000)}`
    const [hit] = findTextMatches(text, textSearchRegExp({ pattern: 'needle' }), {
      multiline: false,
      maximum: 10,
      preview: { matchLines: 1, charsPerLine: 100 },
    }).hits
    expect(hit!.ranges[0]).toEqual({ startLine: 0, startCharacter: 5000, endLine: 0, endCharacter: 5006 })
    expect(hit!.previewText).toHaveLength(100)
    const range = hit!.previewRanges[0]!
    expect(hit!.previewText.slice(range.startCharacter, range.endCharacter)).toBe('needle')
  })
})

describe('bytes', () => {
  it('tells binary from text, and decodes a byte-order mark first', () => {
    expect(looksBinary(new Uint8Array([0x4d, 0x33, 0x00, 0x01]))).toBe(true)
    expect(looksBinary(new TextEncoder().encode('<?xml version="1.0"?>'))).toBe(false)
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    expect(looksBinary(utf16)).toBe(false)
    expect(decodeText(utf16, 'utf8')).toBe('Hi')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), 'utf8')).toBe('A')
  })
})
