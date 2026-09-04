import { describe, it, expect } from 'vitest'
import {
  parseSc2StringsOrdered, serializeStringModel, effectiveValue,
  setStringValue, renameStringKey, addStringEntry,
} from '../../../src/legacy/xml/formats.js'

describe('parseSc2StringsOrdered — round-trip fidelity', () => {
  it('round-trips byte-exact with LF and a trailing newline', () => {
    const text = 'Unit/Name/Marine=Marine\nUnit/Name/Zergling=Zergling\n'
    expect(serializeStringModel(parseSc2StringsOrdered(text))).toBe(text)
  })

  it('round-trips byte-exact with CRLF and no trailing newline', () => {
    const text = 'A=1\r\nB=2\r\nC=3'
    expect(serializeStringModel(parseSc2StringsOrdered(text))).toBe(text)
  })

  it('preserves a BOM, blank lines, and value whitespace', () => {
    const text = '﻿A=1\n\nB=  spaced value \nC=\n'
    const model = parseSc2StringsOrdered(text)
    expect(model.bom).toBe(true)
    expect(serializeStringModel(model)).toBe(text)
  })

  it('preserves duplicate keys and resolves last-wins', () => {
    const text = '@UI/MinimapTerrain=first\nX=1\n@UI/MinimapTerrain=second\n'
    const model = parseSc2StringsOrdered(text)
    expect(model.index.get('@UI/MinimapTerrain')).toHaveLength(2)
    expect(effectiveValue(model, '@UI/MinimapTerrain')).toBe('second')
    expect(serializeStringModel(model)).toBe(text)
  })

  it('keeps values that themselves contain "="', () => {
    const text = 'Expr=a=b=c\n'
    const model = parseSc2StringsOrdered(text)
    expect(effectiveValue(model, 'Expr')).toBe('a=b=c')
    expect(serializeStringModel(model)).toBe(text)
  })

  it('decodes UTF-8 bytes and detects a BOM from raw bytes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('A=Привет\n')])
    const model = parseSc2StringsOrdered(bytes)
    expect(model.bom).toBe(true)
    expect(effectiveValue(model, 'A')).toBe('Привет')
  })

  it('treats a line starting with "//" as a full-line comment, not an entry', () => {
    const text = '// A note\nA=1\n'
    const model = parseSc2StringsOrdered(text)
    expect(model.lines[0]).toMatchObject({ isEntry: false, key: '', value: '' })
    expect(model.lines[1]).toMatchObject({ isEntry: true, key: 'A', value: '1' })
    expect(serializeStringModel(model)).toBe(text) // round-trips byte-exact regardless
  })

  it('treats a "//" line as a comment even when the comment text contains "="', () => {
    const text = '// example: Key=Value\nA=1\n'
    const model = parseSc2StringsOrdered(text)
    expect(model.lines[0]!.isEntry).toBe(false)
    expect(model.index.has('// example: Key')).toBe(false)
  })

  it('a leading-whitespace "//" line is still a comment, not an entry', () => {
    const model = parseSc2StringsOrdered('  // indented note\nA=1\n')
    expect(model.lines[0]!.isEntry).toBe(false)
  })
})

describe('string-model edits — single-line-diff guarantee', () => {
  it('setStringValue patches only the last occurrence', () => {
    const text = 'A=1\nB=2\nA=3\n'
    const model = parseSc2StringsOrdered(text)
    expect(setStringValue(model, 'A', '9')).toBe(true)
    expect(serializeStringModel(model)).toBe('A=1\nB=2\nA=9\n')
  })

  it('setStringValue is a no-op when value is unchanged', () => {
    const model = parseSc2StringsOrdered('A=1\n')
    expect(setStringValue(model, 'A', '1')).toBe(false)
  })

  it('renameStringKey rewrites every occurrence', () => {
    const model = parseSc2StringsOrdered('Old=1\nOld=2\n')
    expect(renameStringKey(model, 'Old', 'New')).toBe(2)
    expect(serializeStringModel(model)).toBe('New=1\nNew=2\n')
    expect(effectiveValue(model, 'New')).toBe('2')
  })

  it('addStringEntry appends and gives the previous last line a terminator', () => {
    const model = parseSc2StringsOrdered('A=1')
    addStringEntry(model, 'B', '2')
    expect(serializeStringModel(model)).toBe('A=1\nB=2\n')
  })

  it('addStringEntry can insert after a given key', () => {
    const model = parseSc2StringsOrdered('A=1\nC=3\n')
    addStringEntry(model, 'B', '2', 'A')
    expect(serializeStringModel(model)).toBe('A=1\nB=2\nC=3\n')
  })
})
