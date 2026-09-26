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
})
