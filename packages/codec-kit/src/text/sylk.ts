/**
 * SYLK (`.slk`): the spreadsheet interchange text Warcraft III keeps its unit, item and ability
 * tables in, and Excel still writes. One record a line, `;`-separated fields, `;;` a literal `;`.
 * A `C` record puts its value `K` in the cell at `X`/`Y`; a record without `X` or `Y` keeps the
 * previous one's (a row is written `C;X1;Y5;K…` then `C;X2;K…`), and an `F` record moves the same
 * cursor. `ID` comes first and nothing after `E` is read. `B` states the sheet's size but is not
 * trusted: Warcraft III's `UbetSplatData.slk` understates it.
 */
import type { CellFacts, TableDataSource } from '@modkit/sdk'
import type { ParseResult, SylkCell, SylkDocument, SylkRow } from '@modkit/sdk/text-data'
import { diagnostic } from '@modkit/core'
import { createTableDataSource } from '../table-source.js'
import { failure, spanner, type DecodedText } from './text.js'

/** Excel's sheet limits: a coordinate past them is refused rather than allocated. */
const MAX_COLUMNS = 16_384
const MAX_ROWS = 1_048_576

/** A record's fields; `;;` inside a field is a literal `;`. */
function fieldsOf(line: string): string[] {
  const fields: string[] = []
  let field = ''
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (character !== ';') field += character
    else if (line[index + 1] === ';') {
      field += ';'
      index += 1
    } else {
      fields.push(field)
      field = ''
    }
  }
  fields.push(field)
  return fields
}

export interface SylkLimits {
  /** Most cells read; past it the document is `truncated`. */
  readonly maxNodes: number
}

export function parseSylk(decoded: DecodedText, limits?: SylkLimits): ParseResult<SylkDocument> {
  const text = decoded.text
  const span = spanner(text)
  const rows = new Map<number, Map<number, SylkCell>>()
  const diagnostics: ReturnType<typeof diagnostic>[] = []
  let started = false
  let column = 1
  let row = 1
  let columns = 0
  let cells = 0
  const lines = /([^\r\n]*)(\r\n|\r|\n|$)/gu
  for (let match = lines.exec(text); match !== null; match = lines.exec(text)) {
    if (match[0] === '') break
    const offset = match.index
    const line = match[1]!
    if (line.trim() === '') continue
    const [kind = '', ...fields] = fieldsOf(line)
    if (!started) {
      if (kind !== 'ID')
        return failure('modkit/text-data-slk-parse', 'SYLK starts with an ID record', text, offset, line.length)
      started = true
      continue
    }
    if (kind === 'E') break
    if (kind !== 'C' && kind !== 'F') continue
    let value: string | undefined
    for (const field of fields) {
      const code = field[0]
      if (code === 'X' || code === 'Y') {
        const coordinate = /^\d+$/u.test(field.slice(1)) ? Number(field.slice(1)) : 0
        if (coordinate < 1 || coordinate > (code === 'X' ? MAX_COLUMNS : MAX_ROWS))
          return failure('modkit/text-data-slk-parse', `SYLK coordinate ${field} is out of range`, text, offset, line.length)
        if (code === 'X') column = coordinate
        else row = coordinate
      } else if (code === 'K' && kind === 'C') value = field.slice(1)
    }
    if (value === undefined) continue
    const quoted = value.startsWith('"')
    const cell: SylkCell = {
      column,
      value: quoted ? value.slice(1, value.length > 1 && value.endsWith('"') ? -1 : undefined) : value,
      quoted,
      range: span(offset, line.length),
    }
    const cellsOfRow = rows.get(row) ?? new Map<number, SylkCell>()
    rows.set(row, cellsOfRow)
    if (cellsOfRow.has(column))
      diagnostics.push(
        diagnostic('warning', 'modkit/text-data-slk-duplicate-cell', `cell X${String(column)};Y${String(row)} is written twice; the later value is kept`, undefined, undefined, cell.range),
      )
    else cells += 1
    cellsOfRow.set(column, cell)
    columns = Math.max(columns, column)
    if (limits !== undefined && cells >= limits.maxNodes) {
      return { state: 'truncated', document: documentOf(rows, columns, decoded), truncated: { limit: 'maxNodes' }, diagnostics }
    }
  }
  if (!started) return failure('modkit/text-data-slk-parse', 'SYLK starts with an ID record', text)
  return { state: 'ok', document: documentOf(rows, columns, decoded), diagnostics }
}

function documentOf(rows: ReadonlyMap<number, ReadonlyMap<number, SylkCell>>, columns: number, decoded: DecodedText): SylkDocument {
  const ordered: SylkRow[] = [...rows]
    .sort(([left], [right]) => left - right)
    .map(([index, cells]) => ({ index, cells: [...cells.values()].sort((left, right) => left.column - right.column) }))
  return { columns, rows: ordered, source: decoded.source }
}

/** The sheet as SYLK text, `\n` between records (the caller's encoder picks the newline). */
export function formatSylk(document: Pick<SylkDocument, 'columns' | 'rows'>): string {
  const escape = (value: string) => value.replaceAll(';', ';;')
  const height = document.rows.reduce((most, row) => Math.max(most, row.index), 0)
  const records = ['ID;PWXL;N;E', `B;X${String(document.columns)};Y${String(height)};D0`]
  for (const row of document.rows)
    row.cells.forEach((cell, index) =>
      records.push(
        `C;X${String(cell.column)}${index === 0 ? `;Y${String(row.index)}` : ''};K${cell.quoted ? `"${escape(cell.value)}"` : escape(cell.value)}`,
      ),
    )
  records.push('E', '')
  return records.join('\n')
}

/**
 * The sheet as a table: row 1 is the header, as every game table keeps its column names there; a
 * column or row without cells reads empty. A cell's facts give the range of its `C` record.
 */
export function sylkTableDataSource(document: SylkDocument): TableDataSource {
  const height = document.rows.reduce((most, row) => Math.max(most, row.index), 0)
  const byRow = new Map(document.rows.map(row => [row.index, row]))
  const dense = (index: number) => {
    const values = new Array<string>(document.columns).fill('')
    for (const cell of byRow.get(index)?.cells ?? []) values[cell.column - 1] = cell.value
    return values
  }
  const cellAt = (row: number, column: number) => byRow.get(row)?.cells.find(cell => cell.column === column)
  return createTableDataSource({
    header: dense(1),
    rows: Array.from({ length: Math.max(0, height - 1) }, (_, offset) => dense(offset + 2)),
    cellFacts: (coord): Omit<CellFacts, 'value'> | undefined => {
      const cell = cellAt(coord.row + 2, coord.column + 1)
      return cell === undefined ? undefined : { range: cell.range }
    },
  })
}
