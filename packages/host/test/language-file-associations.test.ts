import { describe, expect, it } from 'vitest'
import { classifyLanguageFile, languageFileAssociations } from '../src/language/workspace.js'

describe('game file associations', () => {
  it('collects each declared association once, extension lowercase without a dot', () => {
    const inventory = {
      extensions: [
        {
          manifest: {
            languageFiles: [{ extension: '.SCAR', languageId: 'lua', dialect: 'lua51' }],
          },
        },
        {
          manifest: { languageFiles: [{ extension: 'scar', languageId: 'lua', dialect: 'lua51' }] },
        },
        { manifest: {} },
      ],
    } as never
    expect(languageFileAssociations(inventory)).toEqual([
      { extension: 'scar', languageId: 'lua', dialect: 'lua51' },
    ])
  })

  it('carries the dialect of the winning route, and none when the language is undecided', () => {
    const routes = [
      { languageId: 'lua', extension: 'lua' },
      { languageId: 'lua', extension: 'scar', dialect: 'lua51' },
      { languageId: 'other', extension: 'txt' },
      { languageId: 'plain', extension: 'txt', dialect: 'x' },
    ]
    expect(classifyLanguageFile(routes, 'Data/scar/ai.SCAR')).toEqual({
      languageId: 'lua',
      dialect: 'lua51',
      candidates: ['lua'],
    })
    expect(classifyLanguageFile(routes, 'a.lua')).toEqual({
      languageId: 'lua',
      candidates: ['lua'],
    })
    expect(classifyLanguageFile(routes, 'a.txt')).toEqual({ candidates: ['other', 'plain'] })
  })
})
