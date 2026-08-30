/**
 * The negative matrix is only worth having if it cannot drift, so this suite checks the matrix
 * against the repository rather than against itself.
 *
 * Three things go wrong with a coverage table left to a human: a case quietly disappears, a cell
 * points at a test that was renamed or deleted, and `not-applicable` becomes the place awkward work
 * goes to die. Each is checked here — every format answers every case, every referenced test title
 * is found in the file it names, and every `not-applicable` carries a reason that reads as a fact
 * about the format rather than as a promise about the future.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const matrixPath = join(import.meta.dirname, 'fixtures', 'negative-matrix.json')

interface Cell {
  readonly status: 'covered-by-existing' | 'added' | 'not-applicable'
  readonly file?: string
  readonly test?: string
  readonly reason?: string
  readonly note?: string
}

interface Matrix {
  readonly cases: readonly { readonly id: string; readonly title: string }[]
  readonly formats: Readonly<
    Record<string, { readonly label: string; readonly cells: Readonly<Record<string, Cell>> }>
  >
  readonly crossCutting: readonly (Cell & { readonly id: string })[]
}

const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as Matrix
const caseIds = matrix.cases.map(item => item.id)
const formatIds = Object.keys(matrix.formats)

/** Titles a vitest file declares, including the `it.each` templates it expands. */
function titlesOf(file: string): readonly string[] {
  const text = readFileSync(join(repoRoot, file), 'utf8')
  const titles: string[] = []
  const pattern =
    /\bit(?:\.each\([\s\S]*?\)|\.skipIf\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])+)\1/gu
  for (const match of text.matchAll(pattern)) titles.push(match[2] as string)
  return titles
}

const titleCache = new Map<string, readonly string[]>()

function titles(file: string): readonly string[] {
  const cached = titleCache.get(file)
  if (cached !== undefined) return cached
  const value = titlesOf(file)
  titleCache.set(file, value)
  return value
}

describe('the negative matrix covers every format and every case', () => {
  it('declares a unique, non-empty set of cases', () => {
    expect(caseIds.length).toBeGreaterThanOrEqual(13)
    expect(new Set(caseIds).size).toBe(caseIds.length)
    expect(formatIds).toEqual(['red-alert2-vxl', 'westwood-w3d', 'sage-w3x', 'm3'])
  })

  it.each(formatIds)('%s answers every case exactly once', format => {
    const cells = matrix.formats[format]?.cells ?? {}
    // the point of the completeness gate: a case that is not in the table is not "not applicable",
    // it is unanswered, and an unanswered case is what step 4 exists to make impossible
    expect(Object.keys(cells).sort()).toEqual([...caseIds].sort())
  })

  it.each(formatIds)('%s gives every cell a usable status', format => {
    const cells = matrix.formats[format]?.cells ?? {}
    for (const [caseId, cell] of Object.entries(cells)) {
      const where = `${format}/${caseId}`
      expect(['covered-by-existing', 'added', 'not-applicable'], where).toContain(cell.status)
      if (cell.status === 'not-applicable') {
        expect(cell.file, `${where} must not name a test`).toBeUndefined()
        // a reason has to say something about the format; "queued", "later", "TODO" are promises
        expect((cell.reason ?? '').length, where).toBeGreaterThan(60)
        expect(cell.reason ?? '', where).not.toMatch(
          /\b(?:todo|later|queued|planned|next block)\b/iu,
        )
      } else {
        expect(cell.file, `${where} must name a file`).toBeTruthy()
        expect(cell.test, `${where} must name a test`).toBeTruthy()
      }
    }
  })
})

describe('every cell points at a test that exists', () => {
  const referenced = [
    ...formatIds.flatMap(format =>
      Object.entries(matrix.formats[format]?.cells ?? {}).map(([caseId, cell]) => ({
        where: `${format}/${caseId}`,
        cell,
      })),
    ),
    ...matrix.crossCutting.map(cell => ({ where: `cross-cutting/${cell.id}`, cell })),
  ].filter(item => item.cell.status !== 'not-applicable')

  it('names at least one added test, so the matrix is not purely retrospective', () => {
    expect(referenced.filter(item => item.cell.status === 'added').length).toBeGreaterThan(0)
  })

  it.each(referenced.map(item => [item.where, item.cell] as const))(
    '%s resolves to a real test',
    (where, cell) => {
      const file = cell.file as string
      const declared = titles(file)
      expect(declared.length, `${where}: ${file} declares no tests`).toBeGreaterThan(0)
      expect(declared, where).toContain(cell.test)
    },
  )
})
