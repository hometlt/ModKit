/**
 * INI as sections of key = value lines, with a source range for every section and entry. One
 * parser for the core INI provider and for game formats that are INI underneath (Dawn of War
 * `.module`, Westwood rules/art). `;` and `#` start comments; `ini-basic` refuses a key repeated
 * within a section. `ini-westwood` reads the files Westwood's engines read (Tiberian Sun, Red
 * Alert 2): a `;` comment after a section header or a value is cut off, `//` starts a comment
 * line, and a line without `=` (`***Crazy Ivan stuff***`) is skipped with a warning, as the
 * engine skips it.
 */
import type { ParseResult } from '@modkit/sdk/text-data'
import { diagnostic } from '@modkit/core'
import { failure, spanner, type DecodedText } from './text.js'

type SourceRange = ReturnType<ReturnType<typeof spanner>>

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
  const text = decoded.text
  const westwood = dialect === 'ini-westwood'
  const span = spanner(text)
  const sections: IniSection[] = []
  let current: IniSection = { name: '', entries: [], range: span(0, 0) }
  sections.push(current)
  const seen = new Set<string>()
  const diagnostics: ReturnType<typeof diagnostic>[] = []
  // each line with its true offset, whatever its line break (CRLF files are the common case)
  const lines = /([^\r\n]*)(\r\n|\r|\n|$)/gu
  for (let match = lines.exec(text); match !== null; match = lines.exec(text)) {
    const offset = match.index
    const line = match[1]!
    if (match[0] === '') break
    const trimmed = line.trim()
    if (
      trimmed === '' ||
      trimmed.startsWith(';') ||
      trimmed.startsWith('#') ||
      (westwood && trimmed.startsWith('//'))
    )
      continue
    const content = westwood ? trimmed.replace(/\s*;.*$/u, '') : trimmed
    const section = /^\[([^\]]+)\]$/u.exec(content)
    if (section) {
      current = { name: section[1]!, entries: [], range: span(offset, line.length) }
      sections.push(current)
      continue
    }
    const equals = line.indexOf('=')
    if (equals <= 0) {
      if (westwood) {
        diagnostics.push(
          diagnostic(
            'warning',
            'modkit/text-data-ini-skipped-line',
            'line without key = value; the engine skips it',
            undefined,
            undefined,
            span(offset, line.length),
          ),
        )
        continue
      }
      return failure(
        'modkit/text-data-ini-parse',
        'INI entry requires a non-empty key',
        text,
        offset,
        line.length,
      )
    }
    const key = line.slice(0, equals).trim()
    const identity = `${current.name}\n${key}`
    if (dialect === 'ini-basic' && seen.has(identity))
      return failure(
        'modkit/text-data-ini-duplicate',
        `duplicate key ${key}`,
        text,
        offset,
        line.length,
      )
    seen.add(identity)
    const value = line.slice(equals + 1)
    current.entries.push({
      key,
      value: (westwood ? value.replace(/;.*$/u, '') : value).trim(),
      range: span(offset, line.length),
    })
  }
  return { state: 'ok', document: { sections, source: decoded.source }, diagnostics }
}
