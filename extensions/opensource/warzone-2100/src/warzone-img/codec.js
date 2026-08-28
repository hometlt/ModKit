// SPDX-License-Identifier: GPL-2.0-or-later
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const decodeText = (bytes, budget, label) => {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError(`${label} exceeds maxScalarBytes`)
  if (bytes.includes(0)) throw new TypeError(`${label} contains a NUL byte`)
  return new TextDecoder().decode(bytes)
}

function tableSource(header, records) {
  const rows = records.map((record, index) => ({ index, cells: record.map(String) }))
  return Object.freeze({
    async shape() {
      return Object.freeze({ rows: rows.length, columns: header.length, header })
    },
    async rows(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const from = request.kind === 'range' ? request.from : Number(request.cursor)
      if (
        !Number.isSafeInteger(from) ||
        from < 0 ||
        !Number.isSafeInteger(request.count) ||
        request.count <= 0
      )
        throw new TypeError('invalid table page')
      const items = rows.slice(from, from + request.count)
      return Object.freeze({
        items: Object.freeze(items),
        ...(from + items.length < rows.length ? { nextCursor: String(from + items.length) } : {}),
      })
    },
    async cell(coord) {
      const value = rows[coord.row]?.cells[coord.column]
      if (value === undefined) throw new RangeError('table cell is outside the data')
      return Object.freeze({ value })
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const row of rows)
        for (let column = 0; column < row.cells.length; column += 1) {
          if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
          if (row.cells[column].toLocaleLowerCase().includes(needle))
            yield Object.freeze({ row: row.index, column })
        }
    },
  })
}

export function textCodec({ id, formatId, label, confidence, matches, parse, table, unsupported }) {
  const definition = Object.freeze({
    id,
    version: '1.0.0',
    format: Object.freeze({ id: formatId, label }),
    async detect(prefix, uri) {
      return matches(new TextDecoder().decode(prefix), uri)
        ? { confidence, kind: 'structure', note: `${label} grammar` }
        : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
    },
    async inspect(bytes, context) {
      const parsed = parse(decodeText(bytes, context.budget, label), context)
      const rows = table.rows(parsed)
      if (rows.length > context.budget.maxNodes)
        throw new RangeError(`${label} records exceed maxNodes`)
      return {
        summary: { format: formatId, records: rows.length, ...table.summary(parsed) },
        metadata: [{ id: formatId, label, entries: table.metadata(parsed) }],
        traits: [
          { id: 'content.text', parameters: { encoding: 'utf-8' } },
          { id: 'structure.hierarchy', parameters: { records: rows.length } },
        ],
        dataSources: {
          'common.view/table-data-source': tableSource(table.header, rows),
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'document',
            label,
            preview: `${rows.length} records`,
            children: table.children(parsed),
          }),
        },
        maxDecodedBytes: bytes.byteLength,
        unsupportedFeatures: unsupported,
      }
    },
  })
  return Object.freeze({
    abiVersion: 1,
    createCodec: context => createInspectionCodec(definition, context),
  })
}

const scan = line => /^\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,([^,\r\n"]{1,255})/u.exec(line)
const parse = (source, context) => {
  const uri = context.source.ref.uri.replaceAll('\\', '/')
  const dot = uri.lastIndexOf('.')
  const directory = `${dot < 0 ? uri : uri.slice(0, dot)}/`
  return source
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      const match = scan(line)
      if (match === null) throw new TypeError(`invalid Warzone IMG record on line ${index + 1}`)
      const name = match[3].trim()
      return {
        line: index + 1,
        x: Number(match[1]),
        y: Number(match[2]),
        name,
        path: `${directory}${name}`,
      }
    })
}
const codec = textCodec({
  id: 'org.modkitx/warzone-img',
  formatId: 'warzone-img',
  label: 'Warzone 2100 image list',
  confidence: 0.94,
  matches: source => source.split(/\r?\n/u).some(line => scan(line) !== null),
  parse,
  table: {
    header: ['line', 'xOffset', 'yOffset', 'name', 'spritePath'],
    rows: value => value.map(item => [item.line, item.x, item.y, item.name, item.path]),
    summary: value => ({ sprites: value.length }),
    metadata: value => [{ key: 'sprites', value: value.length }],
    children: value =>
      value.map(item => ({ kind: 'sprite', label: item.name, preview: `${item.x}, ${item.y}` })),
  },
  unsupported: ['sprite-reading', 'atlas-reconstruction', 'image-list-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
