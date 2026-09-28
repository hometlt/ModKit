import { describe, expect, it } from 'vitest'
import { decodeInput, parseIni } from '../src/text/index.js'

const decoded = (text: string) =>
  decodeInput({ bytes: new TextEncoder().encode(text), encoding: 'utf-8' } as never)

describe('INI', () => {
  it('reads sections and entries with their ranges, comments skipped', () => {
    const result = parseIni(
      decoded('top=1\n; note\n[global]\nName = Dawn of War\n# x\nUIName=DXP2\n'),
    )
    expect(result.state).toBe('ok')
    if (result.state !== 'ok') return
    expect(
      result.document.sections.map(section => [
        section.name,
        section.entries.map(e => [e.key, e.value]),
      ]),
    ).toEqual([
      ['', [['top', '1']]],
      [
        'global',
        [
          ['Name', 'Dawn of War'],
          ['UIName', 'DXP2'],
        ],
      ],
    ])
    expect(result.document.sections[1]!.entries[0]!.range.line).toBe(3)
  })

  it('refuses a key without a name, and a repeated key in ini-basic only', () => {
    expect(parseIni(decoded('=1\n')).state).toBe('failed')
    expect(parseIni(decoded('[a]\nk=1\nk=2\n'), 'ini-basic').state).toBe('failed')
    expect(parseIni(decoded('[a]\nk=1\nk=2\n')).state).toBe('ok')
  })

  it('keeps true offsets in a CRLF file', () => {
    const result = parseIni(decoded('[a]\r\nk=1\r\nlong=2\r\n'))
    if (result.state !== 'ok') throw new Error('expected ok')
    const range = result.document.sections[1]!.entries[1]!.range
    expect([range.line, range.column, range.utf16Offset]).toEqual([2, 0, 10])
  })

  it('reads Westwood INI: trailing comments, // lines, lines without = skipped', () => {
    const text = '[ROCK] ; Rocketeer\r\n// note\r\n***Crazy Ivan stuff***\r\nImage=ROCK ; art\r\n'
    expect(parseIni(decoded(text)).state).toBe('failed')
    const result = parseIni(decoded(text), 'ini-westwood')
    if (result.state !== 'ok') throw new Error('expected ok')
    expect(result.document.sections[1]).toMatchObject({
      name: 'ROCK',
      entries: [{ key: 'Image', value: 'ROCK' }],
    })
    expect(result.diagnostics.map(item => item.code)).toEqual(['modkit/text-data-ini-skipped-line'])
  })

  it('reads Warcraft III profiles: // lines and lines without = skipped, ; kept as text', () => {
    const text = '[hfoo]\r\n// Footman\r\nPurchase Medusa Pebble\r\nTip=Train; then fight\r\nTip=Again\r\n'
    expect(parseIni(decoded(text)).state).toBe('failed')
    const result = parseIni(decoded(text), 'ini-war3')
    if (result.state !== 'ok') throw new Error('expected ok')
    // A key given twice stays twice; which one counts is the reader's rule.
    expect(result.document.sections[1]).toMatchObject({
      name: 'hfoo',
      entries: [
        { key: 'Tip', value: 'Train; then fight' },
        { key: 'Tip', value: 'Again' },
      ],
    })
    expect(result.diagnostics.map(item => item.code)).toEqual(['modkit/text-data-ini-skipped-line'])
  })

  it('is linear in the size of the file', () => {
    const big = `[s]\r\n${'Key=Value ; c\r\n'.repeat(100_000)}`
    const started = performance.now()
    const result = parseIni(decoded(big), 'ini-westwood')
    expect(result.state).toBe('ok')
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})
