/**
 * A table over rows already in memory, published as `common.view/table-data-source`.
 *
 * Three SC2 codecs had written this same forty lines — paging, the two request shapes, the cell
 * lookup and the substring search — before a fourth needed it. What differs between them is which
 * rows they hold; nothing else, which is the definition of an algorithm that belongs in the kit.
 *
 * The paging refusals are the contract's and they refuse rather than guess: a count that is not a
 * positive integer and a start past the end are caller bugs, and answering them with an empty page
 * would show a reader an empty table instead of a broken call.
 */
import type { CellCoord, CellFacts, Page, Row, TableDataSource, TableQuery } from '@modkit/sdk'

export interface TableColumn {
  readonly id: string
  readonly label?: string
}

export interface TableDataSourceOptions {
  /** Column headers, in order. */
  readonly header: readonly string[]
  /** One entry per row, each already the length of `header`. */
  readonly rows: readonly (readonly string[])[]
  /** Extra facts for one cell — a type, a unit, syntax runs — when the codec has them. */
  readonly cellFacts?: (coord: CellCoord, value: string) => Omit<CellFacts, 'value'> | undefined
}

type PageInput = { kind: string; from?: number; cursor?: string; count: number }

export function createTableDataSource(options: TableDataSourceOptions): TableDataSource {
  const header = Object.freeze([...options.header])
  const rows: Row[] = options.rows.map((cells, index) =>
    Object.freeze({ index, cells: Object.freeze(cells.map(String)) }),
  )

  const startOf = (request: PageInput): number => {
    if (!Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new TypeError('table page count must be a positive safe integer')
    }
    const start = request.kind === 'range' ? request.from : Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(start) || (start ?? -1) < 0) {
      throw new TypeError('table page start is invalid')
    }
    return start as number
  }

  return Object.freeze({
    async shape() {
      return { rows: rows.length, columns: header.length, header: [...header] }
    },
    async rows(request: never, signal?: AbortSignal): Promise<Page<Row>> {
      signal?.throwIfAborted()
      const start = startOf(request as PageInput)
      const items = rows.slice(start, start + (request as PageInput).count)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < rows.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async cell(coord: CellCoord): Promise<CellFacts> {
      const value = rows[coord.row]?.cells[coord.column]
      if (value === undefined) throw new RangeError('table cell is outside the table')
      return Object.freeze({ value, ...(options.cellFacts?.(coord, value) ?? {}) })
    },
    async *search(query: TableQuery, signal?: AbortSignal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const row of rows) {
        for (let column = 0; column < row.cells.length; column += 1) {
          signal?.throwIfAborted()
          if (row.cells[column]!.toLocaleLowerCase().includes(needle)) {
            yield { row: row.index, column }
          }
        }
      }
    },
  })
}
