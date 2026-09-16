/**
 * An operation that answers with a document is shown as one.
 *
 * What is tested here is the decision, not VS Code: which answers carry text, what the tab is
 * called, and that an answer with no text is left alone rather than rendered as `[object Object]`.
 */
import { describe, expect, it } from 'vitest'
import { operationOutputName, operationOutputText } from '../src/operation-output.js'

describe('operation output documents', () => {
  it('recognises the answers that are documents and leaves the rest alone', () => {
    expect(operationOutputText({ kind: 'json', value: { text: '<Catalog/>', mediaType: 'application/xml' } })).toEqual({
      text: '<Catalog/>',
      languageId: 'xml',
    })
    // A command hands over the value itself; both shapes are the same answer.
    expect(operationOutputText({ text: '{"a":1}', mediaType: 'application/json' })).toEqual({
      text: '{"a":1}',
      languageId: 'json',
    })
    expect(operationOutputText('plain answer')).toEqual({ text: 'plain answer' })
    // A media type nobody claimed still opens; the editor decides how to colour it.
    expect(operationOutputText({ text: 'x', mediaType: 'application/x-unknown' })).toEqual({ text: 'x' })
    expect(operationOutputText({ entries: 2, duplicateKeys: 1 })).toBeUndefined()
    expect(operationOutputText({ text: '   ' })).toBeUndefined()
    expect(operationOutputText(undefined)).toBeUndefined()
    expect(operationOutputText(42)).toBeUndefined()
  })

  it('names the tab after the subject and the operation', () => {
    expect(
      operationOutputName('blizzard/sc2-data.resolved-view', 'C:/mods/GameData/UnitData.xml', 'xml'),
    ).toBe('UnitData.resolved-view.xml')
    expect(operationOutputName('export.convert', undefined)).toBe('subject.convert.txt')
  })
})
