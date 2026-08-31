import { throwIfAborted } from '@modkit/core'
import { createTextSyntaxProvider, encodeText, failure, span } from '@modkit/codec-kit/text'

function* delimitedRows(text, delimiter, signal, includeRanges = true) {
  let cells = []
  let value = ''
  let quoted = false
  let cellStart = 0
  let rowIndex = 0
  for (let index = 0; index <= text.length; index += 1) {
    if ((index & 4095) === 0) throwIfAborted(signal)
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') quoted = false
      else if (character === undefined) throw new SyntaxError('unterminated quote')
      else value += character
      continue
    }
    if (character === '"' && value === '') quoted = true
    else if (
      character === delimiter ||
      character === '\n' ||
      character === '\r' ||
      character === undefined
    ) {
      cells.push({
        value,
        ...(includeRanges ? { range: span(text, cellStart, index - cellStart) } : {}),
      })
      value = ''
      cellStart = index + 1
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1
        cellStart += 1
      }
      if (character === '\n' || character === '\r' || character === undefined) {
        if (
          character === undefined &&
          cells.length === 1 &&
          cells[0]?.value === '' &&
          /(?:\r\n|\r|\n)$/u.test(text)
        ) {
          cells = []
          break
        }
        yield { index: rowIndex, cells }
        rowIndex += 1
        cells = []
      }
    } else value += character
  }
}

export function parseDelimitedRows(text, delimiter, budget, signal) {
  const rows = []
  for (const row of delimitedRows(text, delimiter, signal)) {
    rows.push(row)
    if (rows.length >= budget.maxNodes) return { rows, complete: false }
  }
  return { rows, complete: true }
}

function parseDelimited(decoded, delimiter, budget, signal) {
  try {
    const parsed = parseDelimitedRows(decoded.text, delimiter, budget, signal)
    const document = { rows: parsed.rows, complete: parsed.complete, source: decoded.source }
    return parsed.complete
      ? { state: 'ok', document, diagnostics: [] }
      : { state: 'truncated', document, truncated: { limit: 'maxNodes' }, diagnostics: [] }
  } catch (error) {
    return failure(
      'modkit/text-data-delimited-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function lazyTableDataSource(decoded, delimiter) {
  const rowAt = (index, signal) => {
    for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
      if (row.index === index) return row
      if (row.index > index) break
    }
    return undefined
  }
  return {
    async shape() {
      const first = rowAt(0)
      return { rows: 'unknown', columns: first?.cells.length ?? 0 }
    },
    async rows(request, signal) {
      const start = request.kind === 'range' ? request.from : Number(request.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('invalid row cursor')
      const wanted = Math.max(0, request.count)
      const items = []
      let hasMore = false
      for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
        if (row.index < start) continue
        if (items.length === wanted) {
          hasMore = true
          break
        }
        items.push({ index: row.index, cells: row.cells.map(cell => cell.value) })
      }
      return {
        items,
        ...(hasMore ? { nextCursor: String(start + items.length) } : {}),
      }
    },
    async cell(coord) {
      const cell = rowAt(coord.row)?.cells[coord.column]
      return { value: cell?.value ?? '', ...(cell?.range ? { range: cell.range } : {}) }
    },
    async *search(query, signal) {
      for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
        for (let column = 0; column < row.cells.length; column += 1) {
          if (row.cells[column].value.includes(query.pattern)) yield { row: row.index, column }
        }
      }
    },
  }
}

function serializeDelimited(document, delimiter, target) {
  const text = document.rows
    .map(row =>
      row.cells
        .map(cell =>
          /["\r\n,\t]/u.test(cell.value) ? `"${cell.value.replace(/"/gu, '""')}"` : cell.value,
        )
        .join(delimiter),
    )
    .join('\n')
  return encodeText(text, document.source, target)
}

export function createDelimitedSyntaxProvider(definition) {
  return createTextSyntaxProvider({
    contract: definition.contract,
    parse: (decoded, request) =>
      parseDelimited(decoded, definition.delimiter, request.budget, request.signal),
    serialize: request =>
      serializeDelimited(request.document, definition.delimiter, request.target),
    dataSource: decoded => lazyTableDataSource(decoded, definition.delimiter),
  })
}
