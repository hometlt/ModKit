import { describe, expect, it } from 'vitest'
import { decodeInput, formatSylk, parseSylk, sylkTableDataSource } from '../src/text/index.js'

const decoded = (text: string) =>
  decodeInput({ bytes: new TextEncoder().encode(text), encoding: 'utf-8' } as never)

/** As Warcraft III ships a table: a row starts with `X1;Y…`, its other cells name only `X`. */
const UNIT_BALANCE = [
  'ID;PWXL;N;E',
  'P;P#,##0_);;\\(#,##0\\)',
  'B;X3;Y2;D0',
  'C;X1;Y1;K"unitBalanceID"',
  'C;X2;K"goldcost"',
  'C;X4;K"comment;;s"',
  'F;P0;FG0G;X2',
  'C;X1;Y3;K"hfoo"',
  'C;X2;K135',
  'C;X3;KTRUE',
  'E',
  'C;X1;Y9;K"after the end"',
  '',
].join('\r\n')

describe('SYLK', () => {
  it('reads cells where the previous record left the cursor, ;; as a literal ;', () => {
    const result = parseSylk(decoded(UNIT_BALANCE))
    if (result.state !== 'ok') throw new Error(JSON.stringify(result.diagnostics))
    const { document } = result
    // B says 3 × 2; the cells say 4 × 3. The cells win, and nothing after E is read.
    expect(document.columns).toBe(4)
    expect(
      document.rows.map(row => [
        row.index,
        row.cells.map(cell => [cell.column, cell.value, cell.quoted]),
      ]),
    ).toEqual([
      [
        1,
        [
          [1, 'unitBalanceID', true],
          [2, 'goldcost', true],
          [4, 'comment;s', true],
        ],
      ],
      [
        3,
        [
          [1, 'hfoo', true],
          [2, '135', false],
          [3, 'TRUE', false],
        ],
      ],
    ])
    expect(document.rows[1]!.cells[1]!.range.line).toBe(8)
  })

  it('refuses a sheet without ID or with a coordinate out of range, and warns of a cell written twice', () => {
    expect(parseSylk(decoded('C;X1;Y1;K1\nE\n')).state).toBe('failed')
    expect(parseSylk(decoded('ID;P\nC;X0;Y1;K1\nE\n')).state).toBe('failed')
    expect(parseSylk(decoded('ID;P\nC;X20000;Y1;K1\nE\n')).state).toBe('failed')
    const twice = parseSylk(decoded('ID;P\nC;X1;Y1;K1\nC;X1;Y1;K2\nE\n'))
    if (twice.state !== 'ok') throw new Error('expected ok')
    expect(twice.document.rows[0]!.cells.map(cell => cell.value)).toEqual(['2'])
    expect(twice.diagnostics.map(item => item.code)).toEqual([
      'modkit/text-data-slk-duplicate-cell',
    ])
  })

  it('stops at maxNodes cells with a truncated document', () => {
    const result = parseSylk(decoded('ID;P\nC;X1;Y1;K1\nC;X2;K2\nC;X3;K3\nE\n'), { maxNodes: 2 })
    expect(result.state).toBe('truncated')
    if (result.state !== 'truncated') return
    expect(result.document.rows[0]!.cells.map(cell => cell.value)).toEqual(['1', '2'])
    // exactly maxNodes cells is the whole sheet, not a cut one
    expect(parseSylk(decoded('ID;P\nC;X1;Y1;K1\nC;X2;K2\nE\n'), { maxNodes: 2 }).state).toBe('ok')
  })

  it('writes the cells back to SYLK that reads the same', () => {
    const first = parseSylk(decoded(UNIT_BALANCE))
    if (first.state !== 'ok') throw new Error('expected ok')
    const text = formatSylk(first.document)
    expect(text.split('\n').slice(0, 4)).toEqual([
      'ID;PWXL;N;E',
      'B;X4;Y3;D0',
      'C;X1;Y1;K"unitBalanceID"',
      'C;X2;K"goldcost"',
    ])
    const again = parseSylk(decoded(text))
    if (again.state !== 'ok') throw new Error('expected ok')
    const cells = (document: typeof first.document) =>
      document.rows.map(row => [
        row.index,
        row.cells.map(cell => [cell.column, cell.value, cell.quoted]),
      ])
    expect(cells(again.document)).toEqual(cells(first.document))
  })

  it('shows row 1 as the header and gives each cell the range of its record', async () => {
    const result = parseSylk(decoded(UNIT_BALANCE))
    if (result.state !== 'ok') throw new Error('expected ok')
    const table = sylkTableDataSource(result.document)
    expect((await table.shape()).header).toEqual(['unitBalanceID', 'goldcost', '', 'comment;s'])
    const page = await table.rows({ kind: 'range', from: 0, count: 10 })
    // Row 2 has no cells and reads empty; row 3 follows it.
    expect(page.items.map(row => row.cells)).toEqual([
      ['', '', '', ''],
      ['hfoo', '135', 'TRUE', ''],
    ])
    expect((await table.cell({ row: 1, column: 1 })).range?.line).toBe(8)
  })
})
