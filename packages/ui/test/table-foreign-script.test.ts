import { describe, expect, it } from 'vitest'
import { foreignScript } from '../src/table/variants.js'

describe('foreign script in a locale value (7.36)', () => {
  it('flags letters a locale does not write in, as MK2 did', () => {
    // Cyrillic in an English value, Latin markup in a Russian one
    expect(foreignScript('en', 'Марин')).toBe(true)
    expect(foreignScript('ruRU', '<c val="FF0000">Морпех</c>')).toBe(false)
    expect(foreignScript('ru', 'Морпех 海')).toBe(true)
    // Korean writes Hangul and Han; Chinese Han only; Japanese kana and Han
    expect(foreignScript('koKR', '해병 海兵')).toBe(false)
    expect(foreignScript('koKR', 'マリン')).toBe(true)
    expect(foreignScript('zhCN', '陆战队员')).toBe(false)
    expect(foreignScript('zhTW', '해병')).toBe(true)
    expect(foreignScript('ja', 'マリン海兵')).toBe(false)
    expect(foreignScript('deDE', '')).toBe(false)
  })
})
