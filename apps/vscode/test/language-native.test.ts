import { describe, expect, it } from 'vitest'
import {
  associatedLanguageOf,
  completionKindName,
  languageCommandTarget,
  rebaseLanguageSnapshot,
} from '../src/language-native.js'

describe('the language adapter', () => {
  it('keeps a complete cached closure when a closed file becomes an edited overlay', () => {
    const document = (uri: string) => ({ uri, languageId: 'galaxy', version: 1, text: 'int x;' })
    const origin = (uri: string, sourceRevision = 'disk:1') => ({
      uri,
      layerId: 'mod',
      logicalId: uri,
      precedence: 0,
      sourceRevision,
      readOnly: false,
    })
    const snapshot = {
      documents: [document('file:///open'), document('file:///closed')],
      isComplete: true,
      workspaceContext: {
        id: 'workspace',
        revision: 'revision',
        semanticComplete: true,
        documentOrigins: [origin('file:///open'), origin('file:///closed')],
      },
    }
    const request = {
      document: { ...document('file:///open'), version: 2, text: 'int changed;' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [origin('file:///open', 'editor:2')],
      workspaceLanguageIds: ['galaxy'],
      maxDocuments: 1,
      signal: new AbortController().signal,
    }
    const result = rebaseLanguageSnapshot(snapshot, request)
    expect(result.isComplete).toBe(true)
    expect(result.documents).toEqual([document('file:///closed')])
    expect(result.workspaceContext?.documentOrigins).toContainEqual(
      origin('file:///open', 'editor:2'),
    )
    expect(rebaseLanguageSnapshot(snapshot, { ...request, maxDocuments: 0 }).isComplete).toBe(false)
    expect(rebaseLanguageSnapshot({ ...snapshot, isComplete: false }, request).isComplete).toBe(
      false,
    )
    const later = rebaseLanguageSnapshot(snapshot, {
      ...request,
      workspaceDocumentOrigins: [origin('file:///open', 'editor:3')],
    })
    expect(later.workspaceContext?.revision).not.toBe(result.workspaceContext?.revision)
  })

  it('draws each provider completion kind as its native kind', () => {
    expect(completionKindName('color')).toBe('Color')
    expect(completionKindName('file')).toBe('File')
    expect(completionKindName('folder')).toBe('Folder')
    expect(completionKindName('enum-member')).toBe('EnumMember')
    expect(completionKindName('event')).toBe('Event')
    expect(completionKindName('struct')).toBe('Class')
    expect(completionKindName('parameter')).toBe('Variable')
    expect(completionKindName('type')).toBe('TypeParameter')
    // an unknown kind, or one only an object's prototype knows, is plain text
    expect(completionKindName('widget')).toBe('Text')
    expect(completionKindName('constructor')).toBe('Text')
  })

  it('opens an entity on the view the provider named, the card when it named none', () => {
    expect(languageCommandTarget({ kind: 'open-subject', subjectId: 'Unit/Marine' })).toEqual({
      kind: 'subject',
      subjectId: 'Unit/Marine',
      stage: 'card',
    })
    expect(
      languageCommandTarget({ kind: 'open-subject', subjectId: 'Unit/Marine', view: 'graph' }),
    ).toMatchObject({ stage: 'relations' })
    expect(
      languageCommandTarget({ kind: 'open-subject', subjectId: 'Unit/Marine', view: 'resolved' }),
    ).toMatchObject({ stage: 'tree' })
  })

  it('opens a place at its range', () => {
    const range = { start: { line: 3, character: 0 }, end: { line: 3, character: 7 } }
    expect(
      languageCommandTarget({ kind: 'open-location', location: { uri: 'file:///a.xml', range } }),
    ).toEqual({ kind: 'location', uri: 'file:///a.xml', range })
  })

  it('refuses anything outside the closed command set', () => {
    for (const value of [
      undefined,
      'open-subject',
      { kind: 'run-script', script: 'x' },
      { kind: 'open-subject', subjectId: '' },
      { kind: 'open-subject', subjectId: 'Unit/Marine', view: 'toString' },
      { kind: 'open-location', location: { uri: 'file:///a.xml' } },
      {
        kind: 'open-location',
        location: { uri: 'file:///a.xml', range: { start: { line: -1, character: 0 }, end: {} } },
      },
    ]) {
      expect(languageCommandTarget(value)).toBeUndefined()
    }
  })

  it('gives a generically labelled document the language its game associates by content', () => {
    const associations = [
      { extension: 'xml', rootElement: 'Catalog', languageId: 'sc2-data' },
      { extension: 'scar', languageId: 'lua', dialect: 'lua51' },
    ]
    const catalog = '\uFEFF<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n'
    const document = (fileName: string, languageId: string, head: string) => ({
      fileName,
      languageId,
      head,
    })
    // GameData outside GameData/: VS Code says XML, the root element says SC2 data
    expect(associatedLanguageOf(associations, document('Custom/MyData.xml', 'xml', catalog))).toBe(
      'sc2-data',
    )
    expect(
      associatedLanguageOf(associations, document('Other.xml', 'xml', '<Layout/>')),
    ).toBeUndefined()
    // a kind VS Code has no language for, by its extension
    expect(associatedLanguageOf(associations, document('ai.scar', 'plaintext', ''))).toBe('lua')
    // a document VS Code or the user labelled more precisely keeps its language
    expect(
      associatedLanguageOf(associations, document('GameData/UnitData.xml', 'sc2-data', catalog)),
    ).toBeUndefined()
    expect(
      associatedLanguageOf(associations, document('Custom/MyData.xml', 'json', catalog)),
    ).toBeUndefined()
  })
})
