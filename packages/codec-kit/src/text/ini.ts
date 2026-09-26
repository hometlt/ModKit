/**
 * INI as sections of key = value lines, with a source range for every section and entry. One
 * parser for the core INI provider and for game formats that are INI underneath (Dawn of War
 * `.module`). `;` and `#` start comments; `ini-basic` refuses a key repeated within a section.
 */
import type { ParseResult } from '@modkit/sdk/text-data'
import { failure, span, type DecodedText } from './text.js'

type SourceRange = ReturnType<typeof span>

export interface IniEntry {
  readonly key: string
  readonly value: string
  readonly range: SourceRange
}

export interface IniSection {
  /** Empty for the entries before the first `[section]`. */
  readonly name: string
  readonly entries: IniEntry[]
  readonly range: SourceRange
}

export interface IniDocument {
  readonly sections: IniSection[]
  readonly source: DecodedText['source']
}

export function parseIni(decoded: DecodedText, dialect?: string): ParseResult<IniDocument> {
  const sections: IniSection[] = []
  let current: IniSection = { name: '', entries: [], range: span(decoded.text, 0, 0) }
  sections.push(current)
  const seen = new Set<string>()
  let offset = 0
  for (const line of decoded.text.split(/\r\n|\r|\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      offset += line.length + 1
      continue
    }
    const section = /^\[([^\]]+)\]$/u.exec(trimmed)
    if (section) {
      current = { name: section[1]!, entries: [], range: span(decoded.text, offset, line.length) }
      sections.push(current)
    } else {
      const equals = line.indexOf('=')
      if (equals <= 0)
        return failure(
          'modkit/text-data-ini-parse',
          'INI entry requires a non-empty key',
          decoded.text,
          offset,
          line.length,
        )
      const key = line.slice(0, equals).trim()
      const identity = `${current.name}\n${key}`
      if (dialect === 'ini-basic' && seen.has(identity))
        return failure(
          'modkit/text-data-ini-duplicate',
          `duplicate key ${key}`,
          decoded.text,
          offset,
          line.length,
        )
      seen.add(identity)
      current.entries.push({
        key,
        value: line.slice(equals + 1).trim(),
        range: span(decoded.text, offset, line.length),
      })
    }
    offset += line.length + 1
  }
  return { state: 'ok', document: { sections, source: decoded.source }, diagnostics: [] }
}
