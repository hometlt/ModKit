import { describe, expect, it } from 'vitest'
import {
  classifyLanguageFile,
  languageFileAssociationFor,
  languageFileAssociations,
  xmlRootElementName,
} from '../src/language/workspace.js'

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

describe('association by root element', () => {
  it('names the document element after the declaration, comments and a document type', () => {
    expect(xmlRootElementName('<Catalog>')).toBe('Catalog')
    expect(
      xmlRootElementName(
        String.fromCharCode(0xfeff, 60) +
          '?xml version="1.0" encoding="utf-8"?>' +
          String.fromCharCode(13, 10) +
          '<!-- SC2 data --> <!DOCTYPE Catalog [<!ENTITY a "b">]> <?pi x?>  <Catalog id="x">',
      ),
    ).toBe('Catalog')
    expect(xmlRootElementName('<sc2:Catalog/>')).toBe('Catalog')
    expect(xmlRootElementName('<CatalogX>')).toBe('CatalogX')
    // no element yet, or not XML
    expect(xmlRootElementName('<?xml version="1.0"?><!-- open')).toBeUndefined()
    expect(xmlRootElementName('{ "Catalog": 1 }')).toBeUndefined()
    expect(xmlRootElementName('')).toBeUndefined()
  })

  it('applies a root-element association only to files that open that element', () => {
    const associations = [
      { extension: 'xml', languageId: 'sc2-data', rootElement: 'Catalog' },
      { extension: 'xml', languageId: 'xml-plain' },
    ]
    expect(
      languageFileAssociationFor(
        associations,
        'Custom/MyData.xml',
        '<?xml version="1.0"?> <Catalog>',
      ),
    ).toEqual(associations[0])
    expect(languageFileAssociationFor(associations, 'Custom/Layout.XML', '<Desc>')).toEqual(
      associations[1],
    )
    // without the file's start, only the extension decides
    expect(languageFileAssociationFor(associations, 'Custom/MyData.xml')).toEqual(associations[1])
    expect(
      languageFileAssociationFor([associations[0]!], 'Custom/Layout.xml', '<Desc>'),
    ).toBeUndefined()
    expect(
      languageFileAssociationFor(associations, 'Custom/MyData.txt', '<Catalog>'),
    ).toBeUndefined()
  })

  it('keeps the declared root element when collecting associations', () => {
    const inventory = {
      extensions: [
        {
          manifest: {
            languageFiles: [{ extension: 'XML', languageId: 'sc2-data', rootElement: 'Catalog' }],
          },
        },
      ],
    } as never
    expect(languageFileAssociations(inventory)).toEqual([
      { extension: 'xml', languageId: 'sc2-data', rootElement: 'Catalog' },
    ])
  })
})
