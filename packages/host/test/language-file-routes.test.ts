import { describe, expect, it } from 'vitest'
import {
  classifyLanguageFile,
  createLanguageFileClassifier,
  languageFileExtension,
  languageRouteServesFile,
} from '../src/language/workspace.js'

const routes = [
  { languageId: 'sc2-data', extension: 'xml' },
  { languageId: 'sc2-map-objects', fileName: 'Objects' },
  { languageId: 'sc2-map-preload', fileName: 'Preload.xml' },
  { languageId: 'sc2-strings', extension: 'txt' },
  { languageId: 'plain-notes', extension: 'txt' },
]

describe('language routes by file name', () => {
  it('captures selectors once while retaining name precedence and ambiguous dialects', () => {
    let reads = 0
    const observed = {
      languageId: 'xml',
      get extension() {
        reads += 1
        return 'xml'
      },
    }
    const classify = createLanguageFileClassifier([
      observed,
      { languageId: 'layout', extension: 'xml', fileName: 'Layout.xml', dialect: 'sc2' },
      { languageId: 'lua', extension: 'lua', dialect: 'lua51' },
      { languageId: 'lua', extension: 'lua', dialect: 'luau' },
      ...routes.filter(route => route.extension === 'txt'),
    ])
    const capturedReads = reads
    expect(classify('C:\\mods\\LAYOUT.XML')).toEqual({
      languageId: 'layout',
      dialect: 'sc2',
      candidates: ['layout'],
    })
    expect(classify('data/a.XML')).toEqual({ languageId: 'xml', candidates: ['xml'] })
    expect(classify('a.lua')).toEqual({ languageId: 'lua', candidates: ['lua'] })
    expect(classify('GameStrings.txt')).toEqual({ candidates: ['plain-notes', 'sc2-strings'] })
    expect(classify('textures/m.dds')).toEqual({ candidates: [] })
    expect(reads).toBe(capturedReads)
    expect(Object.isFrozen(classify('a.XML').candidates)).toBe(true)
  })
  it('reads an extension, and none for a file known only by name', () => {
    expect(languageFileExtension('Maps/A.SC2Map/Base.SC2Data/GameData/UnitData.XML')).toBe('xml')
    expect(languageFileExtension('Maps\\A.SC2Map\\Objects')).toBeUndefined()
    expect(languageFileExtension('.hidden')).toBeUndefined()
  })

  it('routes a named file by its name, whatever the case, before any extension route', () => {
    expect(classifyLanguageFile(routes, 'Maps/A.SC2Map/objects')).toEqual({
      languageId: 'sc2-map-objects',
      candidates: ['sc2-map-objects'],
    })
    // Preload.xml is an .xml file, but its name says what it is.
    expect(classifyLanguageFile(routes, 'Maps/A.SC2Map/Preload.xml').languageId).toBe(
      'sc2-map-preload',
    )
    expect(
      classifyLanguageFile(routes, 'Mods/B.SC2Mod/Base.SC2Data/GameData/UnitData.xml').languageId,
    ).toBe('sc2-data')
    expect(languageRouteServesFile({ languageId: 'x', fileName: 'Objects' }, 'C:/m/Objects')).toBe(
      true,
    )
    expect(
      languageRouteServesFile({ languageId: 'x', fileName: 'Objects' }, 'C:/m/Objects.xml'),
    ).toBe(false)
  })

  it('decides nothing for an extension two languages claim, and names them', () => {
    expect(classifyLanguageFile(routes, 'GameStrings.txt')).toEqual({
      candidates: ['plain-notes', 'sc2-strings'],
    })
    expect(classifyLanguageFile(routes, 'MapScript.galaxy')).toEqual({ candidates: [] })
  })
})
