import { describe, expect, it } from 'vitest'
import {
  classifyLanguageFile,
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
    expect(classifyLanguageFile(routes, 'Maps/A.SC2Map/Preload.xml').languageId).toBe('sc2-map-preload')
    expect(classifyLanguageFile(routes, 'Mods/B.SC2Mod/Base.SC2Data/GameData/UnitData.xml').languageId).toBe(
      'sc2-data',
    )
    expect(languageRouteServesFile({ languageId: 'x', fileName: 'Objects' }, 'C:/m/Objects')).toBe(true)
    expect(languageRouteServesFile({ languageId: 'x', fileName: 'Objects' }, 'C:/m/Objects.xml')).toBe(false)
  })

  it('decides nothing for an extension two languages claim, and names them', () => {
    expect(classifyLanguageFile(routes, 'GameStrings.txt')).toEqual({
      candidates: ['plain-notes', 'sc2-strings'],
    })
    expect(classifyLanguageFile(routes, 'MapScript.galaxy')).toEqual({ candidates: [] })
  })
})
