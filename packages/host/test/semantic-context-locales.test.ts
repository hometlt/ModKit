import { describe, expect, it } from 'vitest'
import type { LanguageDocument, LanguageWorkspaceDocumentOrigin } from '@modkit/sdk/language'
import {
  prepareResolvedDataSemanticContext,
  semanticInputLocales,
  validatedLanguageSemanticContextRequirements,
} from '../src/language/semantic-context.js'

const document = (uri: string, languageId: string, text: string): LanguageDocument =>
  ({ uri, languageId, version: 1, text }) as LanguageDocument
const origin = (
  uri: string,
  logicalId: string,
  precedence: number,
): LanguageWorkspaceDocumentOrigin => ({
  uri,
  layerId: `layer-${precedence}`,
  logicalId,
  precedence,
  sourceRevision: 'r1',
  readOnly: true,
})

describe('the locales of a resolved Data context', () => {
  const [requirement] = validatedLanguageSemanticContextRequirements([
    {
      kind: 'resolved-data-snapshot',
      gameId: 'blizzard/starcraft-2',
      languageIds: ['sc2-data'],
      localizationLanguageIds: ['sc2-strings'],
    },
  ])
  if (requirement?.kind !== 'resolved-data-snapshot') throw new Error('expected resolved data requirement')
  const documents = [
    document('mod:/Base.SC2Data/GameData/UnitData.xml', 'sc2-data', '<Catalog/>'),
    document(
      'mod:/ruRU.SC2Data/LocalizedData/GameStrings.txt',
      'sc2-strings',
      'Unit/Name/Marine=Пехотинец',
    ),
    document(
      'mod:/enUS.SC2Data/LocalizedData/GameStrings.txt',
      'sc2-strings',
      'Unit/Name/Marine=Marine',
    ),
    document(
      'mod:/deDE.SC2Data/LocalizedData/GameStrings.txt',
      'sc2-strings',
      'Unit/Name/Marine=Marinesoldat',
    ),
  ]
  const origins = new Map(
    documents.map((item, index) => [
      item.uri,
      origin(item.uri, item.uri.slice('mod:/'.length), index),
    ]),
  )

  it('take the string files of the locales the locale-set input names, preferred first', () => {
    const locales = semanticInputLocales([
      { kind: 'schema', id: 'x', revision: '1' },
      {
        kind: 'locale-set',
        id: 'selected-game-locales',
        revision: '1',
        payload: { locales: ['ruRU', 'enUS'] },
      },
    ])
    expect(locales).toEqual(['ruRU', 'enUS'])
    const prepared = prepareResolvedDataSemanticContext({
      requirement: requirement!,
      documents,
      origins,
      complete: true,
      locales,
    })
    expect(prepared.documents.map(item => item.path)).toEqual([
      'Base.SC2Data/GameData/UnitData.xml',
    ])
    expect(prepared.locales).toEqual(['ruRU', 'enUS'])
    expect(prepared.localizationDocuments.map(item => [item.locale, item.path])).toEqual([
      ['ruRU', 'ruRU.SC2Data/LocalizedData/GameStrings.txt'],
      ['enUS', 'enUS.SC2Data/LocalizedData/GameStrings.txt'],
    ])
    // another locale choice is another context
    const english = prepareResolvedDataSemanticContext({
      requirement: requirement!,
      documents,
      origins,
      complete: true,
      locales: ['enUS'],
    })
    expect(english.key).not.toBe(prepared.key)
    expect(english.localizationDocuments.map(item => item.locale)).toEqual(['enUS'])
  })

  it('pass no string file without locales, and refuse a malformed localization list', () => {
    const prepared = prepareResolvedDataSemanticContext({
      requirement: requirement!,
      documents,
      origins,
      complete: true,
    })
    expect(prepared.localizationDocuments).toEqual([])
    expect(semanticInputLocales([{ kind: 'locale-set', id: 'x', revision: '1' }])).toEqual([])
    expect(() =>
      validatedLanguageSemanticContextRequirements([
        {
          kind: 'resolved-data-snapshot',
          gameId: 'g',
          languageIds: ['a'],
          localizationLanguageIds: [],
        },
      ]),
    ).toThrow(/invalid/u)
  })
})
