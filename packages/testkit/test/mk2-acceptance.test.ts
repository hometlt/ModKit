import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatMk2AcceptanceTable,
  loadMk2Corpus,
  mk2ExtensionsRoot,
  resolveMk2Root,
  runMk2Acceptance,
  syntheticCorpusRoot,
  tallyMk2Conversion,
  type Mk2CorpusEntry,
} from '../src/index.js'

const packageRoot = join(import.meta.dirname, '..')
const repoRoot = join(packageRoot, '..', '..')
const corpus = loadMk2Corpus(join(import.meta.dirname, 'fixtures', 'mk2-corpus.json'))
const mk2Root = resolveMk2Root(repoRoot)
const generator = join(packageRoot, 'scripts', 'gen-synthetic-corpus.mjs')

const find = (contributionId: string): Mk2CorpusEntry => {
  const entry = corpus.find(item => item.contributionId === contributionId)
  if (entry === undefined) throw new TypeError(`the MK2 corpus has no case for ${contributionId}`)
  return entry
}
const firstReal = find('org.modkitx/webp')
const firstSynthetic = find('org.modkitx/wav')
const cueBinBundle = find('org.modkitx/ps1-cue-bin')
const portableModel = find('org.modkitx/ply')

describe('MK2 → MK3 conversion acceptance (OPUS-MK2-01 task B, OPUS-MK2-02 tasks E/F/G)', () => {
  it('opens every corpus sample through the product path and prints the state table', async () => {
    const tally = tallyMk2Conversion(mk2ExtensionsRoot(repoRoot))
    const outcomes = await runMk2Acceptance(corpus, { repoRoot, mk2Root })
    console.log(`\n${formatMk2AcceptanceTable(tally, outcomes)}\n`)

    expect(tally.converted).toBeGreaterThanOrEqual(100)
    expect(tally.converted).toBe(tally.ported + tally.pending)
    // OPUS-MK2-02 definition of done: six OPUS-MK2-01 pilots plus port campaign wave 1.
    expect(tally.ported).toBeGreaterThanOrEqual(12)

    // A failure names the codec and the reason; a missing MK2 checkout is a skip, not a failure.
    const failures = outcomes.filter(outcome => outcome.state === 'failed')
    expect(failures.map(outcome => `${outcome.entry.contributionId}: ${outcome.detail}`)).toEqual(
      [],
    )

    // Synthetic cases are committed fixtures: they never depend on a neighbouring checkout, so
    // "no MK2 beside the lab" may not quietly turn the whole suite into skips.
    for (const outcome of outcomes) {
      const expected = outcome.corpus === 'real' && mk2Root === undefined ? 'skipped' : 'opened'
      expect({ id: outcome.entry.contributionId, state: outcome.state }).toEqual({
        id: outcome.entry.contributionId,
        state: expected,
      })
      if (outcome.state !== 'opened') continue
      expect(outcome.dataSourceContracts).toContain('common.view/tree-data-source')
      expect(outcome.dataSourceContracts).toContain('common.view/byte-range-source')
      expect(outcome.traits?.length ?? 0).toBeGreaterThan(0)
    }
    expect(
      outcomes.filter(outcome => outcome.corpus === 'synthetic').length,
    ).toBeGreaterThanOrEqual(9)
  }, 30_000)

  it('routes the signature cases on bytes alone, with the file name saying nothing', async () => {
    // Task E: these codecs declared one v1 rule — a path glob matching every file — and MK3 does
    // not accept it. They are opened by their bare name, so `match.signatures` is the only way
    // the host can shortlist them, and the winning candidate has to say so.
    const byteRouted = corpus.filter(entry => entry.expectSignatureMatch === true)
    expect(byteRouted.length).toBeGreaterThanOrEqual(8)
    const outcomes = await runMk2Acceptance(byteRouted, { repoRoot, mk2Root })
    for (const outcome of outcomes) {
      if (outcome.state === 'skipped') continue
      expect({
        id: outcome.entry.contributionId,
        state: outcome.state,
        signature: outcome.signatureMatch,
        detail: outcome.detail,
      }).toEqual({
        id: outcome.entry.contributionId,
        state: 'opened',
        signature: true,
        detail: undefined,
      })
    }
  }, 20_000)

  it('activates the portable variant in a Node worker, not just trusted in-process', async () => {
    // The worker backend verifies every artifact file against the loader's digests before it
    // evaluates anything, so this only passes while the converted extension is self-contained
    // (imports resolve inside its own artifact, not by a path escaping it). REPORT §7.6 asks each
    // port to confirm the `portable` variant instead of inheriting it, and this is that check.
    const cases = [
      firstSynthetic,
      cueBinBundle,
      portableModel,
      ...(mk2Root === undefined ? [] : [firstReal]),
    ]
    const outcomes = await runMk2Acceptance(cases, { repoRoot, mk2Root, workerBrokered: true })
    for (const outcome of outcomes) {
      expect({
        id: outcome.entry.contributionId,
        state: outcome.state,
        variant: outcome.variantId,
        detail: outcome.detail,
      }).toEqual({
        id: outcome.entry.contributionId,
        state: 'opened',
        variant: 'portable',
        detail: undefined,
      })
    }
  }, 15_000)

  it('reports a missing corpus sample as a skip rather than a pass', async () => {
    const [outcome] = await runMk2Acceptance(
      [{ ...firstSynthetic, sample: 'does/not/exist.bin' }],
      { repoRoot, mk2Root },
    )
    expect(outcome?.state).toBe('skipped')
    expect(outcome?.detail).toContain('does/not/exist.bin')
  })

  it('fails loudly when a sample is claimed by the wrong converted codec', async () => {
    const [outcome] = await runMk2Acceptance(
      [{ ...firstSynthetic, contributionId: 'org.modkitx/not-the-winner' }],
      { repoRoot, mk2Root },
    )
    expect(outcome?.state).toBe('failed')
    expect(outcome?.detail).toContain('expected org.modkitx/not-the-winner')
  }, 15_000)

  it('the synthetic corpus is exactly what its generator produces (task F)', () => {
    const result = spawnSync(process.execPath, [generator, '--check', '--quiet'], {
      encoding: 'utf8',
    })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  })

  it('the synthetic fixtures are valid to a decoder that is not the codec under test', async () => {
    // A fixture that only satisfies its own reader proves nothing. These two carry standard
    // compressed streams, so Node's zlib is an independent judge of whether the generator really
    // read the specification: gzip must decompress, and the PNG IDAT must inflate to the
    // filter byte plus one RGB pixel.
    const zlib = await import('node:zlib')
    const root = syntheticCorpusRoot()
    expect(zlib.gunzipSync(readFileSync(join(root, 'minimal.gz'))).toString('utf8')).toBe('hello')

    const png = readFileSync(join(root, 'minimal.png'))
    const idatStart = png.indexOf('IDAT') + 4
    const idatBytes = png.readUInt32BE(idatStart - 8)
    const inflated = zlib.inflateSync(png.subarray(idatStart, idatStart + idatBytes))
    expect([...inflated]).toEqual([0x00, 0x80, 0x40, 0x20])

    // These checks intentionally do not import the codecs. They independently walk each model
    // fixture's standard wire representation so a generator/reader bug cannot agree with itself.
    const stl = readFileSync(join(root, 'minimal.stl'))
    const stlTriangles = stl.readUInt32LE(80)
    expect(stlTriangles).toBe(1)
    expect(stl.byteLength).toBe(84 + stlTriangles * 50)
    expect([stl.readFloatLE(96), stl.readFloatLE(100), stl.readFloatLE(104)]).toEqual([0, 0, 0])

    const ply = readFileSync(join(root, 'minimal.ply'))
    const plyBody = ply.indexOf('end_header\n') + 'end_header\n'.length
    expect(ply.subarray(0, plyBody).toString('ascii')).toContain('format binary_little_endian 1.0')
    expect([
      ply.readFloatLE(plyBody),
      ply.readFloatLE(plyBody + 4),
      ply.readFloatLE(plyBody + 8),
    ]).toEqual([0, 0, 0])
    expect(ply[plyBody + 96]).toBe(3)
    expect([
      ply.readInt32LE(plyBody + 97),
      ply.readInt32LE(plyBody + 101),
      ply.readInt32LE(plyBody + 105),
    ]).toEqual([0, 1, 2])

    const obj = readFileSync(join(root, 'minimal.obj'), 'utf8')
    expect(obj.match(/^v\s/gmu)).toHaveLength(3)
    expect(obj.match(/^vt\s/gmu)).toHaveLength(3)
    expect(obj.match(/^vn\s/gmu)).toHaveLength(1)
    expect(obj.match(/^f\s+1\/1\/1\s+2\/2\/1\s+3\/3\/1$/gmu)).toHaveLength(1)
  })
})
