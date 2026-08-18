import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatMk2AcceptanceTable,
  loadMk2Corpus,
  mk2ExtensionsRoot,
  resolveMk2Root,
  runMk2Acceptance,
  tallyMk2Conversion,
} from '../src/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const corpus = loadMk2Corpus(join(import.meta.dirname, 'fixtures', 'mk2-corpus.json'))
const mk2Root = resolveMk2Root(repoRoot)
const [firstCase] = corpus
if (firstCase === undefined) throw new TypeError('the MK2 acceptance corpus fixture is empty')

describe('MK2 → MK3 conversion acceptance (OPUS-MK2-01 task B)', () => {
  it('opens every corpus sample through the product path and prints the state table', async () => {
    const tally = tallyMk2Conversion(mk2ExtensionsRoot(repoRoot))
    const outcomes = await runMk2Acceptance(corpus, { repoRoot, mk2Root })
    console.log(`\n${formatMk2AcceptanceTable(tally, outcomes)}\n`)

    expect(tally.converted).toBeGreaterThanOrEqual(100)
    expect(tally.opening).toBe(corpus.length)
    expect(tally.converted).toBe(tally.opening + tally.pending)

    // A failure names the codec and the reason; a missing MK2 checkout is a skip, not a failure.
    const failures = outcomes.filter(outcome => outcome.state === 'failed')
    expect(failures.map(outcome => `${outcome.entry.contributionId}: ${outcome.detail}`)).toEqual(
      [],
    )

    if (mk2Root === undefined) {
      expect(outcomes.every(outcome => outcome.state === 'skipped')).toBe(true)
      return
    }
    for (const outcome of outcomes) {
      expect({ id: outcome.entry.contributionId, state: outcome.state }).toEqual({
        id: outcome.entry.contributionId,
        state: 'opened',
      })
      expect(outcome.formatId).toBe(outcome.entry.contributionId.split('/').at(-1))
      expect(outcome.dataSourceContracts).toContain('common.view/tree-data-source')
      expect(outcome.dataSourceContracts).toContain('common.view/byte-range-source')
      expect(outcome.traits?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('activates the portable variant in a Node worker, not just trusted in-process', async () => {
    if (mk2Root === undefined) return
    // The worker backend verifies every artifact file against the loader's digests before it
    // evaluates anything, so this only passes while the converted extension is self-contained
    // (imports resolve inside its own artifact, not by a path escaping it).
    const [outcome] = await runMk2Acceptance([firstCase], {
      repoRoot,
      mk2Root,
      workerBrokered: true,
    })
    expect({ state: outcome?.state, detail: outcome?.detail }).toEqual({
      state: 'opened',
      detail: undefined,
    })
    expect(outcome?.variantId).toBe('portable')
  })

  it('reports a missing corpus sample as a skip rather than a pass', async () => {
    const [outcome] = await runMk2Acceptance([{ ...firstCase, sample: 'does/not/exist.bin' }], {
      repoRoot,
      mk2Root,
    })
    expect(outcome?.state).toBe('skipped')
    expect(outcome?.detail).toContain('does/not/exist.bin')
  })

  it('fails loudly when a sample is claimed by the wrong converted codec', async () => {
    if (mk2Root === undefined) return
    const [outcome] = await runMk2Acceptance(
      [{ ...firstCase, contributionId: 'org.modkitx/not-the-winner' }],
      { repoRoot, mk2Root },
    )
    expect(outcome?.state).toBe('failed')
    expect(outcome?.detail).toContain('expected org.modkitx/not-the-winner')
  })
})
