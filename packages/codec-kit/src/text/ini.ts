/**
 * INI as sections of key = value lines, with a source range for every section and entry. One
 * parser for the core INI provider and for game formats that are INI underneath (Dawn of War
 * `.module`, Westwood rules/art). `;` and `#` start comments; `ini-basic` refuses a key repeated
 * within a section. `ini-westwood` reads the files Westwood's engines read (Tiberian Sun, Red
 * Alert 2): a `;` comment after a section header or a value is cut off, `//` starts a comment
 * line, and a line without `=` (`***Crazy Ivan stuff***`) is skipped with a warning, as the
 * engine skips it. `ini-war3` reads Warcraft III's profile files (`Units/*Func.txt`,
 * `*Strings.txt`) the same way except that `;` is text, not a comment: tooltips contain it.
 * `ini-emperor` reads Emperor: Battle for Dune's `Rules.txt` and `ArtIni.txt`: `//` starts a
 * comment anywhere (a whole line, or after a section header, a value or a name), `;` is text, and a
 * line without `=` is a list member, not skipped — `[BuildingTypes]` lists its names one per line —
 * so it becomes an entry whose key is the line and whose value is empty.
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
  const emperor = dialect === 'ini-emperor'
  // Dialects whose engines skip what is not a key = value line, and take `//` as a comment.
  const lenient = westwood || emperor || dialect === 'ini-war3'
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
      (lenient && trimmed.startsWith('//'))
    )
      continue
    const content = westwood
      ? trimmed.replace(/\s*;.*$/u, '')
      : emperor
        ? trimmed.replace(/\s*\/\/.*$/u, '')
        : trimmed
    const section = /^\[([^\]]+)\]$/u.exec(content)
    if (section) {
      current = { name: section[1]!, entries: [], range: span(offset, line.length) }
      sections.push(current)
      continue
    }
    // Emperor's `//` comment may hold an `=`; its entries are read from the line without it.
    const body = emperor ? content : line
    const equals = body.indexOf('=')
    if (emperor && equals < 0) {
      current.entries.push({ key: content, value: '', range: span(offset, line.length) })
      continue
    }
    if (equals <= 0) {
      if (lenient) {
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
    const key = body.slice(0, equals).trim()
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
    const value = body.slice(equals + 1)
    current.entries.push({
      key,
      value: (westwood ? value.replace(/;.*$/u, '') : value).trim(),
      range: span(offset, line.length),
    })
  }
  return { state: 'ok', document: { sections, source: decoded.source }, diagnostics }
}
