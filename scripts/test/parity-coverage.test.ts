import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import { authoredExtensionRootsRelativeTo } from '../lib/authored-extension-roots.mjs'

const repoRoot = join(import.meta.dirname, '..', '..')
const commonRoot = join(repoRoot, 'extensions', 'common')

const COVERAGE_STATUSES = new Set([
  'compared-real',
  'compared-synthetic',
  'not-comparable-no-canonical-probe',
  'not-comparable-contract-difference',
  'blocked-missing-legal-corpus',
])
const COMPARED = new Set(['compared-real', 'compared-synthetic'])

interface CoverageRow {
  readonly contributionId: string
  readonly family: string
  readonly status: string
  readonly reason?: string
  readonly parityRows?: readonly string[]
}

interface CorpusSample {
  readonly id: string
  readonly kind: 'synthetic' | 'real'
  readonly format: string
  readonly contributionId: string
}

function readJson<T>(...parts: readonly string[]): T {
  return JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8')) as T
}

/** The live list of codec contributions shipped by the core product. */
function commonCodecContributions(): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  const roots = [
    ...authoredExtensionRootsRelativeTo(commonRoot),
    { directory: join(repoRoot, 'extensions', 'ps1'), relativePath: '../../ps1' },
  ]
  for (const { directory, relativePath } of roots) {
    const family = relativePath.split('/').at(-1) ?? relativePath
    let files: readonly string[]
    try {
      files = readdirSync(join(directory, 'contributions'))
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const manifest = readJson<{ contract?: { id?: string }; id?: string }>(
        ...directory.slice(repoRoot.length + 1).split(/[\\/]/u),
        'contributions',
        file,
      )
      if (manifest.contract?.id !== 'org.modkitx/codec-contribution') continue
      if (typeof manifest.id !== 'string')
        throw new TypeError(`${file} declares no contribution id`)
      found.set(manifest.id, family)
    }
  }
  return found
}

const coverage = readJson<{ coverage: readonly CoverageRow[] }>(
  'scripts',
  'parity',
  'common-coverage.json',
).coverage
const corpus = readJson<{ samples: readonly CorpusSample[] }>(
  'scripts',
  'parity',
  'corpus.json',
).samples
const contributions = commonCodecContributions()
const samplesById = new Map(corpus.map(sample => [sample.id, sample]))

describe('common/ parity coverage table', () => {
  it('covers every shipped common codec contribution exactly once', () => {
    const covered = coverage.map(row => row.contributionId)
    expect(new Set(covered).size).toBe(covered.length)
    expect(covered.toSorted()).toEqual([...contributions.keys()].toSorted())
  })

  it('records the family each contribution actually ships in', () => {
    expect(
      coverage
        .filter(row => row.family !== contributions.get(row.contributionId))
        .map(row => `${row.contributionId}: ${row.family}`),
    ).toEqual([])
  })

  it('assigns exactly one status from the closed Block 9 set', () => {
    expect(
      coverage
        .filter(row => !COVERAGE_STATUSES.has(row.status))
        .map(row => `${row.contributionId}: ${row.status}`),
    ).toEqual([])
  })

  it('backs every compared status with parity rows of the matching kind', () => {
    const defects: string[] = []
    for (const row of coverage.filter(item => COMPARED.has(item.status))) {
      if (row.reason !== undefined)
        defects.push(`${row.contributionId}: compared row carries a reason`)
      const named = row.parityRows ?? []
      if (named.length === 0) defects.push(`${row.contributionId}: names no parity row`)
      for (const id of named) {
        const sample = samplesById.get(id)
        if (sample === undefined) defects.push(`${row.contributionId}: unknown parity row ${id}`)
        else if (sample.contributionId !== row.contributionId)
          defects.push(`${row.contributionId}: parity row ${id} compares ${sample.contributionId}`)
      }
      const hasReal = named.some(id => samplesById.get(id)?.kind === 'real')
      if (hasReal !== (row.status === 'compared-real'))
        defects.push(`${row.contributionId}: ${row.status} does not match the sample kinds`)
    }
    expect(defects).toEqual([])

    /*
     * The evidence declaration, made where it is earned (block 12 slice 12-5).
     *
     * A `compared-*` status means the parity harness put this contribution's `view.inspect` output
     * beside the canonical oracle's, on the named rows, and the assertions above have just checked
     * that those rows exist and really compare this contribution. That is generated evidence of
     * `inspect` — a machine record of a comparison that happened — and not an opinion about it.
     *
     * The uncompared rows declare nothing on purpose. Their operation stays `null` in the registry,
     * which is the honest reading of "no canonical probe exists" or "the corpus is not legally
     * available": the gap is visible instead of being filled in with something plausible.
     */
    for (const row of coverage.filter(item => COMPARED.has(item.status))) {
      proves({
        contributionId: row.contributionId,
        operation: 'inspect',
        note: `parity ${row.status} on ${(row.parityRows ?? []).join(', ')}`,
      })
    }
  })

  it('never lets a reason stand in for a comparison', () => {
    const defects: string[] = []
    for (const row of coverage.filter(item => !COMPARED.has(item.status))) {
      if (row.parityRows !== undefined)
        defects.push(`${row.contributionId}: an uncompared status may not claim parity rows`)
      if ((row.reason ?? '').length <= 40)
        defects.push(`${row.contributionId}: the recorded reason is not specific enough`)
    }
    expect(defects).toEqual([])
  })

  it('leaves no parity row for a common contribution outside the table', () => {
    const claimed = new Set(coverage.flatMap(row => row.parityRows ?? []))
    const orphans = corpus
      .filter(sample => contributions.has(sample.contributionId) && !claimed.has(sample.id))
      .map(sample => sample.id)
    expect(orphans).toEqual([])
  })
})
