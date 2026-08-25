import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const completedPortableModels = [
  find('org.modkitx/dae'),
  find('org.modkitx/model-gltf'),
  find('org.modkitx/model-uvm'),
]
const completedPortableVideos = [find('org.modkitx/avi'), find('org.modkitx/wmv')]
const completedPortableAudio = [
  find('org.modkitx/aac'),
  find('org.modkitx/flac'),
  find('org.modkitx/m4a'),
]
const completedPortableWwise = [
  find('org.modkitx/wem'),
  find('org.modkitx/bnk'),
  find('org.modkitx/wwise-pck'),
]
const completedPortableFlash = [find('org.modkitx/fla')]
const completedPortableFmod = [find('org.modkitx/fsb')]
const completedPortableBlizzardCommon = [find('org.modkitx/blp')]
const completedPortableDiablo = [find('org.modkitx/diablo3-app'), find('org.modkitx/diablo3-tex')]
const completedPortableStarcraft2 = [
  find('org.modkitx/galaxy'),
  find('org.modkitx/sc2-strings'),
  find('org.modkitx/sc2-layout'),
  find('org.modkitx/sc2-data'),
  find('org.modkitx/sc2-bank'),
  find('org.modkitx/sc2-document-metadata'),
  find('org.modkitx/sc2-triggers'),
  find('org.modkitx/sc2-runtime'),
  find('org.modkitx/sc2-map'),
  find('org.modkitx/sc2-mod'),
  find('org.modkitx/sc2-replay'),
]
const completedPortableWarcraft3 = [find('org.modkitx/war3-mdx')]
const completedPortableGasPowered = [find('org.modkitx/supcom-scm')]
const completedPortableCavedog = [find('org.modkitx/gaf'), find('org.modkitx/ta-hpi')]
const completedPortableEaEmperor = [
  find('org.modkitx/emperor-rfh-rfd'),
  find('org.modkitx/emperor-xbf'),
]
const completedPortableEaModels = [find('org.modkitx/sage-w3x'), find('org.modkitx/westwood-w3d')]
const completedPortableEaSage = [
  find('org.modkitx/big'),
  find('org.modkitx/cnc3-data'),
  find('org.modkitx/cnc3-localization'),
  find('org.modkitx/cnc3-map'),
  find('org.modkitx/sage-skudef'),
]
const completedPortableEaTiberianSun = [find('org.modkitx/red-alert2-vxl')]
const completedPortableEaWestwood = [
  find('org.modkitx/cps'),
  find('org.modkitx/r16'),
  find('org.modkitx/r8'),
  find('org.modkitx/shp'),
  find('org.modkitx/tmp'),
  find('org.modkitx/vpl'),
  find('org.modkitx/wsa'),
]
const completedPortableMicrosoftHaloWars = [find('org.modkitx/halo-era')]
const completedPortableHeroes = [
  find('org.modkitx/def'),
  find('org.modkitx/heroes3-lod'),
  find('org.modkitx/heroes4-resource'),
]
const completedPortableSpring = [find('org.modkitx/spring-rapid'), find('org.modkitx/spring-vfs')]
const completedPortableWarzone = [
  find('org.modkitx/warzone-img'),
  find('org.modkitx/warzone-lev'),
  find('org.modkitx/warzone-pie'),
  find('org.modkitx/warzone-wrf'),
  find('org.modkitx/warzone-wz'),
  find('org.modkitx/warzone2100-map'),
]
const completedPortablePetroglyph = [
  find('org.modkitx/grey-goo-alo'),
  find('org.modkitx/petroglyph-meg'),
]
const completedPortableRadVideo = [find('org.modkitx/bink'), find('org.modkitx/smacker')]
const completedPortableRealityPump = [
  find('org.modkitx/earth-par'),
  find('org.modkitx/earth-tex'),
  find('org.modkitx/earth2160-model'),
  find('org.modkitx/wd'),
]
const completedPortableRelic = [
  find('org.modkitx/relic'),
  find('org.modkitx/relic-sga'),
  find('org.modkitx/rgt'),
  find('org.modkitx/rrtex'),
  find('org.modkitx/rsh'),
  find('org.modkitx/rtx'),
  find('org.modkitx/wtp'),
  find('org.modkitx/relic-sgm'),
  find('org.modkitx/relic-whm'),
]
const completedPortableFinalFamilies = [
  find('org.modkitx/empire-earth-ssa'),
  find('org.modkitx/sst'),
  find('org.modkitx/texcache'),
  find('org.modkitx/heroes6-orc'),
]
const completedPortableVector = [find('org.modkitx/emf'), find('org.modkitx/wmf')]
const completedPortableDocuments = [
  find('org.modkitx/csv'),
  find('org.modkitx/markdown'),
  // slice 12-2 relocated the RTF port to common/documents; staging holds the retired stub
  find('org.modkitx/document-rtf'),
  find('org.modkitx/docx'),
  find('org.modkitx/pptx'),
  find('org.modkitx/xlsx'),
  find('org.modkitx/odt'),
  find('org.modkitx/odp'),
  find('org.modkitx/ods'),
  find('org.modkitx/odg'),
  find('org.modkitx/pdf'),
  find('org.modkitx/ai'),
  find('org.modkitx/drawio'),
  find('org.modkitx/visio'),
  find('org.modkitx/cdr'),
  find('org.modkitx/figma'),
  find('org.modkitx/psd'),
  find('org.modkitx/blend'),
]
const completedPortableAgeSeries = [
  find('org.modkitx/age-bar'),
  find('org.modkitx/age-drs'),
  find('org.modkitx/bti'),
  find('org.modkitx/cub'),
  find('org.modkitx/ddt'),
  find('org.modkitx/mtrl'),
  find('org.modkitx/prt'),
  find('org.modkitx/sld'),
  find('org.modkitx/slp'),
  find('org.modkitx/smp'),
  find('org.modkitx/smx'),
]
const completedPortableUnreal = [
  find('org.modkitx/uasset'),
  find('org.modkitx/unreal-uasset'),
  find('org.modkitx/unreal-uasset-texture'),
  find('org.modkitx/unreal-uasset-video'),
  find('org.modkitx/unreal-actorx'),
  find('org.modkitx/unreal-pak'),
  find('org.modkitx/unreal-iostore'),
]
const completedPortableUnity = [
  find('org.modkitx/unity'),
  find('org.modkitx/unity-assets'),
  find('org.modkitx/unity-mesh'),
  find('org.modkitx/unity-ress'),
  find('org.modkitx/unityfs'),
]

describe('MK2 → MK3 conversion acceptance (OPUS-MK2-01 task B, OPUS-MK2-02 tasks E/F/G)', () => {
  it('opens every corpus sample through the product path and prints the state table', async () => {
    const tally = tallyMk2Conversion(mk2ExtensionsRoot(repoRoot))
    const outcomes = await runMk2Acceptance(corpus, { repoRoot, mk2Root })
    console.log(`\n${formatMk2AcceptanceTable(tally, outcomes)}\n`)

    // Block 11 slice 11A moved plain text into product-owned `extensions/common/plain-text` and
    // slice 11B moved ODT, ODS and ODP into `extensions/common/documents`, so the converter-owned
    // tally drops by four.
    // Block 8 moved 17 EA contributions into product-owned `extensions/ea/*`; this tally is
    // intentionally scoped to the remaining converter-owned `extensions/mk2/*` tree.
    expect(tally.converted).toBeGreaterThanOrEqual(84)
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
  }, 120_000)

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
  }, 60_000)

  it('releases the primary and companion file sources on success and early refusal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modkitx3-mk2-owned-sources-'))
    const fixtureRoot = syntheticCorpusRoot()
    const cue = join(root, 'minimal.cue')
    const bin = join(root, 'minimal.bin')
    try {
      await copyFile(join(fixtureRoot, 'minimal.cue'), cue)
      await copyFile(join(fixtureRoot, 'minimal.bin'), bin)

      const [opened] = await runMk2Acceptance([cueBinBundle], {
        repoRoot,
        mk2Root,
        syntheticRoot: root,
      })
      expect(opened?.state).toBe('opened')

      const [refused] = await runMk2Acceptance(
        [{ ...cueBinBundle, contributionId: 'org.modkitx/not-the-selected-contribution' }],
        { repoRoot, mk2Root, syntheticRoot: root },
      )
      expect(refused).toMatchObject({
        state: 'failed',
        detail:
          'selected org.modkitx/ps1-cue-bin, expected org.modkitx/not-the-selected-contribution',
      })

      // Windows refuses to unlink files while these Node FileHandles are still live.
      await rm(cue)
      await rm(bin)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('activates the portable variant in a Node worker, not just trusted in-process', async () => {
    // The worker backend verifies every artifact file against the loader's digests before it
    // evaluates anything, so this only passes while the converted extension is self-contained
    // (imports resolve inside its own artifact, not by a path escaping it). REPORT §7.6 asks each
    // port to confirm the `portable` variant instead of inheriting it, and this is that check.
    const cases = [
      firstSynthetic,
      cueBinBundle,
      portableModel,
      ...completedPortableAudio,
      ...completedPortableWwise,
      ...completedPortableFlash,
      ...completedPortableFmod,
      ...completedPortableBlizzardCommon,
      ...completedPortableDiablo,
      ...completedPortableStarcraft2,
      ...completedPortableWarcraft3,
      ...completedPortableGasPowered,
      ...completedPortableCavedog,
      ...completedPortableEaEmperor,
      ...completedPortableEaModels,
      ...completedPortableEaSage,
      ...completedPortableEaTiberianSun,
      ...completedPortableEaWestwood,
      ...completedPortableMicrosoftHaloWars,
      ...completedPortableHeroes,
      ...completedPortableSpring,
      ...completedPortableWarzone,
      ...completedPortablePetroglyph,
      ...completedPortableRadVideo,
      ...completedPortableRealityPump,
      ...completedPortableRelic,
      ...completedPortableFinalFamilies,
      ...completedPortableVector,
      ...completedPortableModels,
      ...completedPortableVideos,
      ...completedPortableDocuments,
      ...completedPortableAgeSeries,
      ...completedPortableUnreal,
      ...completedPortableUnity,
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
  }, 240_000)

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

    const fla = readFileSync(join(root, 'minimal.fla'))
    expect(fla.readUInt32LE(0)).toBe(0x04034b50)
    const flaNames = []
    let flaCentral = fla.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    while (flaCentral >= 0 && fla.readUInt32LE(flaCentral) === 0x02014b50) {
      const nameLength = fla.readUInt16LE(flaCentral + 28)
      const extraLength = fla.readUInt16LE(flaCentral + 30)
      const commentLength = fla.readUInt16LE(flaCentral + 32)
      flaNames.push(fla.subarray(flaCentral + 46, flaCentral + 46 + nameLength).toString('utf8'))
      flaCentral += 46 + nameLength + extraLength + commentLength
    }
    expect(flaNames).toEqual(['DOMDocument.xml', 'LIBRARY/Symbol.xml'])
    const secondLocal = fla.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 4)
    expect(fla.readUInt16LE(secondLocal + 8)).toBe(8)
    const secondData =
      secondLocal + 30 + fla.readUInt16LE(secondLocal + 26) + fla.readUInt16LE(secondLocal + 28)
    const secondCompressed = fla.readUInt32LE(secondLocal + 18)
    expect(
      zlib.inflateRawSync(fla.subarray(secondData, secondData + secondCompressed)).toString('utf8'),
    ).toBe('<DOMSymbolItem name="Symbol 1"/>')

    const fsb = readFileSync(join(root, 'minimal.fsb'))
    expect(fsb.subarray(0, 4).toString('ascii')).toBe('FSB5')
    expect([fsb.readUInt32LE(4), fsb.readUInt32LE(8), fsb.readUInt32LE(12)]).toEqual([1, 1, 8])
    expect([fsb.readUInt32LE(16), fsb.readUInt32LE(20), fsb.readUInt32LE(24)]).toEqual([9, 32, 1])
    const fsbMode = fsb.readBigUInt64LE(60)
    expect(Number((fsbMode >> 34n) & 0x3fffffffn)).toBe(32)
    expect(Number((fsbMode >> 1n) & 0xfn)).toBe(1)
    expect(fsb.readUInt32LE(68)).toBe(4)
    expect(fsb.subarray(72, 76).toString('ascii')).toBe('tone')

    const blp = readFileSync(join(root, 'minimal.blp'))
    expect(blp.subarray(0, 4).toString('ascii')).toBe('BLP2')
    expect([blp[8], blp[9], blp[10], blp[11]]).toEqual([3, 8, 0, 1])
    expect([blp.readUInt32LE(12), blp.readUInt32LE(16)]).toEqual([2, 1])
    expect([blp.readUInt32LE(20), blp.readUInt32LE(84)]).toEqual([148, 8])
    expect([...blp.subarray(148)]).toEqual([0, 0, 255, 255, 0, 255, 0, 128])

    const diabloTex = readFileSync(join(root, 'minimal.diablo3.tex'))
    expect([diabloTex.readUInt32LE(0), diabloTex.readUInt32LE(4)]).toEqual([0xdeadbeef, 47])
    expect([
      diabloTex.readUInt32LE(0x20),
      diabloTex.readUInt32LE(0x24),
      diabloTex.readUInt32LE(0x28),
      diabloTex.readUInt32LE(0x2c),
    ]).toEqual([0, 2, 1, 1])
    const diabloTexPixels = diabloTex.readUInt32LE(0x38)
    expect(diabloTex.readUInt32LE(0x3c)).toBe(8)
    expect([...diabloTex.subarray(diabloTexPixels)]).toEqual([0, 0, 255, 255, 0, 255, 0, 128])

    const diabloApp = readFileSync(join(root, 'minimal.diablo3.app'))
    expect([diabloApp.readUInt32LE(0), diabloApp.readUInt32LE(4)]).toEqual([0xdeadbeef, 260])
    expect(diabloApp.readUInt32LE(0x0a8)).toBe(1)
    const diabloSubmesh = diabloApp.readUInt32LE(0x0ac) + 16
    const diabloVertices = diabloApp.readUInt32LE(diabloSubmesh + 8) + 16
    const diabloIndices = diabloApp.readUInt32LE(diabloSubmesh + 0x2c) + 16
    expect([
      diabloApp.readUInt32LE(diabloSubmesh + 4),
      diabloApp.readUInt32LE(diabloSubmesh + 0x28),
    ]).toEqual([3, 3])
    expect(diabloApp.subarray(diabloSubmesh + 0x5c, diabloSubmesh + 0x6c).toString('ascii')).toBe(
      'Triangle_Default',
    )
    expect([
      diabloApp.readFloatLE(diabloVertices),
      diabloApp.readFloatLE(diabloVertices + 44),
      diabloApp.readFloatLE(diabloVertices + 44 * 2 + 4),
    ]).toEqual([0, 1, 1])
    expect([
      diabloApp.readUInt16LE(diabloIndices),
      diabloApp.readUInt16LE(diabloIndices + 2),
      diabloApp.readUInt16LE(diabloIndices + 4),
    ]).toEqual([0, 1, 2])

    const galaxy = readFileSync(join(root, 'minimal.galaxy'), 'utf8')
    expect(galaxy).toContain('include "TriggerLibs/NativeLib"')
    expect(galaxy.match(/\b(?:void|int)\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{/gu)).toHaveLength(2)
    expect([...galaxy].filter(character => character === '{')).toHaveLength(
      [...galaxy].filter(character => character === '}').length,
    )

    const sc2Strings = readFileSync(join(root, 'minimal.sc2strings.txt'), 'utf8')
    const sc2StringLines = sc2Strings.trim().split(/\r?\n/u)
    expect(sc2StringLines).toHaveLength(3)
    expect(sc2StringLines.every(line => line.indexOf('=') > 0)).toBe(true)
    expect(sc2Strings).toContain('<d ref="Unit,Marine,Name"/>')

    const sc2Layout = readFileSync(join(root, 'minimal.SC2Layout'), 'utf8')
    expect(sc2Layout).toMatch(/^<\?xml[^>]*>\s*<Desc>/u)
    expect(sc2Layout).toContain('<Frame type="Frame" name="FixturePanel">')
    expect(sc2Layout).toContain('<Include path="UI/Layout/Shared.SC2Layout"/>')

    const sc2Data = readFileSync(join(root, 'minimal.gamedata.xml'), 'utf8')
    expect(sc2Data).toMatch(/^<\?xml[^>]*>\s*<Catalog>/u)
    expect(sc2Data.match(/<C[A-Za-z0-9_]+\s+[^>]*id="[^"]+"/gu)).toHaveLength(2)
    expect(sc2Data).toContain('<CUnit id="Marine" parent="BaseUnit">')

    // Independently decrypt the Storm hash/block tables and read each SC2 fixture's stored
    // (listfile). This does not import the codecs or generator and catches fake MPQ-shaped bytes.
    const mpqCrypt = (() => {
      let seed = 0x00100001
      const table = new Uint32Array(0x500)
      for (let slot = 0; slot < 0x100; slot += 1) {
        let index = slot
        for (let round = 0; round < 5; round += 1) {
          seed = (seed * 125 + 3) % 0x2aaaab
          const high = (seed & 0xffff) << 16
          seed = (seed * 125 + 3) % 0x2aaaab
          table[index] = (high | (seed & 0xffff)) >>> 0
          index += 0x100
        }
      }
      return table
    })()
    const stormHash = (input: string, type: number) => {
      let seed1 = 0x7fed7fed
      let seed2 = 0xeeeeeeee
      for (const original of Buffer.from(input, 'ascii')) {
        const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
        seed1 = ((mpqCrypt[(type << 8) + value] ?? 0) ^ (seed1 + seed2)) >>> 0
        seed2 = (value + seed1 + seed2 + (seed2 << 5) + 3) >>> 0
      }
      return seed1 >>> 0
    }
    const decryptStormTable = (encrypted: Buffer, key: number) => {
      const result = Buffer.from(encrypted)
      let seed1 = key >>> 0
      let seed2 = 0xeeeeeeee
      for (let offset = 0; offset < encrypted.byteLength; offset += 4) {
        seed2 = (seed2 + (mpqCrypt[0x400 + (seed1 & 0xff)] ?? 0)) >>> 0
        const plain = (encrypted.readUInt32LE(offset) ^ (seed1 + seed2)) >>> 0
        seed1 = (((~seed1 << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0
        seed2 = (plain + seed2 + (seed2 << 5) + 3) >>> 0
        result.writeUInt32LE(plain, offset)
      }
      return result
    }
    const sc2Listfile = (name: string) => {
      const data = readFileSync(join(root, name))
      const userData = data.subarray(0, 4).toString('latin1') === 'MPQ\u001b'
      const archive = userData ? data.readUInt32LE(8) : 0
      expect(data.subarray(archive, archive + 4).toString('latin1')).toBe('MPQ\u001a')
      expect(data.readUInt32LE(archive + 8)).toBe(data.byteLength - archive)
      const hashOffset = data.readUInt32LE(archive + 16)
      const blockOffset = data.readUInt32LE(archive + 20)
      const hashEntries = data.readUInt32LE(archive + 24)
      const blockEntries = data.readUInt32LE(archive + 28)
      expect(hashEntries).toBeGreaterThanOrEqual(blockEntries * 2)
      const hashes = decryptStormTable(
        data.subarray(archive + hashOffset, archive + hashOffset + hashEntries * 16),
        stormHash('(hash table)', 3),
      )
      const blocks = decryptStormTable(
        data.subarray(archive + blockOffset, archive + blockOffset + blockEntries * 16),
        stormHash('(block table)', 3),
      )
      const hashA = stormHash('(listfile)', 1)
      const hashB = stormHash('(listfile)', 2)
      const first = stormHash('(listfile)', 0) % hashEntries
      let blockIndex = -1
      for (let probe = 0; probe < hashEntries; probe += 1) {
        const offset = ((first + probe) % hashEntries) * 16
        if (hashes.readUInt32LE(offset + 12) === 0xffffffff) break
        if (hashes.readUInt32LE(offset) === hashA && hashes.readUInt32LE(offset + 4) === hashB) {
          blockIndex = hashes.readUInt32LE(offset + 12)
          break
        }
      }
      expect(blockIndex).toBeGreaterThanOrEqual(0)
      const block = blockIndex * 16
      const payload = archive + blocks.readUInt32LE(block)
      const stored = blocks.readUInt32LE(block + 4)
      expect(blocks.readUInt32LE(block + 8)).toBe(stored)
      expect(blocks.readUInt32LE(block + 12)).toBe(0x81000000)
      return data
        .subarray(payload, payload + stored)
        .toString('utf8')
        .trim()
        .split('\n')
    }
    expect(sc2Listfile('minimal.SC2Map')).toEqual([
      'MapInfo',
      'Objects',
      'Terrain',
      'MapScript.galaxy',
    ])
    expect(sc2Listfile('minimal.SC2Mod')).toEqual([
      'ComponentList.SC2Components',
      'DocumentInfo',
      'GameData/UnitData.xml',
      'UI/Layout/Fixture.SC2Layout',
      'enUS.SC2Data/LocalizedData/GameStrings.txt',
    ])
    const replayBytes = readFileSync(join(root, 'minimal.SC2Replay'))
    expect(replayBytes.subarray(0, 4).toString('latin1')).toBe('MPQ\u001b')
    expect(replayBytes.subarray(16, 35).toString('ascii')).toBe('StarCraft II replay')
    expect(sc2Listfile('minimal.SC2Replay')).toEqual([
      'replay.details',
      'replay.initData',
      'replay.attributes.events',
      'replay.game.events',
      'replay.tracker.events',
    ])

    const mdx = readFileSync(join(root, 'minimal.mdx'))
    expect(mdx.subarray(0, 4).toString('ascii')).toBe('MDLX')
    expect(mdx.subarray(4, 8).toString('ascii')).toBe('VERS')
    expect([mdx.readUInt32LE(8), mdx.readUInt32LE(12)]).toEqual([4, 800])
    expect(mdx.subarray(16, 20).toString('ascii')).toBe('MODL')
    expect(mdx.readUInt32LE(20)).toBe(372)
    expect(mdx.subarray(24, 36).toString('ascii')).toBe('FixtureModel')
    expect(mdx.byteLength).toBe(396)

    const scm = readFileSync(join(root, 'minimal.scm'))
    expect(scm.subarray(0, 4).toString('ascii')).toBe('MODL')
    expect(scm.readUInt32LE(4)).toBe(5)
    const scmSkeleton = scm.readUInt32LE(8)
    const scmVertices = scm.readUInt32LE(16)
    const scmVertexCount = scm.readUInt32LE(24)
    const scmIndices = scm.readUInt32LE(28)
    const scmIndexCount = scm.readUInt32LE(32)
    const scmInfo = scm.readUInt32LE(36)
    expect([
      scm.subarray(scmSkeleton - 4, scmSkeleton).toString('ascii'),
      scm.subarray(scmVertices - 4, scmVertices).toString('ascii'),
      scm.subarray(scmIndices - 4, scmIndices).toString('ascii'),
      scm.subarray(scmInfo - 4, scmInfo).toString('ascii'),
    ]).toEqual(['SKEL', 'VTXL', 'TRIS', 'INFO'])
    expect([scmVertexCount, scmIndexCount]).toEqual([3, 3])
    expect([
      scm.readFloatLE(scmVertices),
      scm.readFloatLE(scmVertices + 68),
      scm.readFloatLE(scmVertices + 68 * 2 + 4),
    ]).toEqual([0, 1, 1])
    expect([
      scm.readUInt16LE(scmIndices),
      scm.readUInt16LE(scmIndices + 2),
      scm.readUInt16LE(scmIndices + 4),
    ]).toEqual([0, 1, 2])
    expect(scm.subarray(scmInfo).toString('ascii')).toContain('Machine:Fixture\0')

    const gaf = readFileSync(join(root, 'minimal.gaf'))
    expect([gaf.readUInt32LE(0), gaf.readUInt32LE(4), gaf.readUInt32LE(12)]).toEqual([
      0x00010100, 1, 16,
    ])
    expect(gaf.subarray(16, 48).toString('ascii').replace(/\0.*$/u, '')).toBe('FixtureEntry')

    const hpi = readFileSync(join(root, 'minimal.ta-hpi'))
    expect(hpi.subarray(0, 4).toString('ascii')).toBe('HAPI')
    expect([hpi.readUInt32LE(4), hpi.readUInt32LE(8), hpi.readUInt32LE(16)]).toEqual([
      0x00010000, 111, 20,
    ])
    expect([hpi.readUInt32LE(20), hpi.readUInt32LE(24)]).toEqual([3, 28])
    const hpiEntries = Array.from({ length: 3 }, (_, index) => {
      const entry = 28 + index * 9
      const nameOffset = hpi.readUInt32LE(entry)
      const recordOffset = hpi.readUInt32LE(entry + 4)
      const nameEnd = hpi.indexOf(0, nameOffset)
      return {
        name: hpi.subarray(nameOffset, nameEnd).toString('ascii'),
        recordOffset,
        method: hpi[recordOffset + 8],
      }
    })
    expect(hpiEntries).toEqual([
      { name: 'stored.txt', recordOffset: 84, method: 0 },
      { name: 'lz77.txt', recordOffset: 93, method: 1 },
      { name: 'zlib.txt', recordOffset: 102, method: 2 },
    ])
    const lzRecord = hpiEntries[1]?.recordOffset ?? 0
    const lzPayload = hpi.readUInt32LE(lzRecord)
    const lzChunk = lzPayload + 4
    const lzCompressed = hpi.readUInt32LE(lzChunk + 7)
    expect(hpi.subarray(lzChunk, lzChunk + 4).toString('ascii')).toBe('SQSH')
    expect(hpi[lzChunk + 5]).toBe(1)
    const lzBytes = hpi.subarray(lzChunk + 19, lzChunk + 19 + lzCompressed)
    expect(lzBytes[0]).toBe(0)
    expect(lzBytes.subarray(1).toString('ascii')).toBe('LZ77!')
    const zlibRecord = hpiEntries[2]?.recordOffset ?? 0
    const zlibPayload = hpi.readUInt32LE(zlibRecord)
    const zlibChunk = zlibPayload + 4
    const zlibCompressed = hpi.readUInt32LE(zlibChunk + 7)
    expect(hpi.subarray(zlibChunk, zlibChunk + 4).toString('ascii')).toBe('SQSH')
    expect(hpi[zlibChunk + 5]).toBe(2)
    expect(
      zlib
        .inflateSync(hpi.subarray(zlibChunk + 19, zlibChunk + 19 + zlibCompressed))
        .toString('ascii'),
    ).toBe('zlib payload')

    const emperorRfh = readFileSync(join(root, 'minimal.emperor.rfh'))
    expect(emperorRfh.subarray(0, 4).toString('latin1')).toBe('RFH\0')
    expect([
      emperorRfh.readUInt32LE(4),
      emperorRfh.readUInt32LE(8),
      emperorRfh.readUInt32LE(12),
    ]).toEqual([1, 0x80000000, 2])
    const emperorEntries = Array.from({ length: 2 }, (_, index) => {
      const record = 16 + index * 24
      const nameOffset = emperorRfh.readUInt32LE(record)
      const nameLength = emperorRfh.readUInt16LE(record + 4)
      return {
        name: emperorRfh
          .subarray(nameOffset, nameOffset + nameLength)
          .toString('ascii')
          .replace(/\0+$/u, ''),
        offset: emperorRfh.readUInt32LE(record + 8),
        stored: emperorRfh.readUInt32LE(record + 12),
        decoded: emperorRfh.readUInt32LE(record + 16),
        method: emperorRfh.readUInt32LE(record + 20),
      }
    })
    expect(emperorEntries.map(entry => [entry.name, entry.method, entry.decoded])).toEqual([
      ['stored.txt', 0, 6],
      ['deflate.txt', 1, 15],
    ])
    const emperorDeflate = emperorEntries[1]
    if (emperorDeflate === undefined) throw new TypeError('Emperor RFH deflate entry is missing')
    expect(
      zlib
        .inflateSync(
          emperorRfh.subarray(emperorDeflate.offset, emperorDeflate.offset + emperorDeflate.stored),
        )
        .toString('ascii'),
    ).toBe('deflate payload')

    const emperorXbf = readFileSync(join(root, 'minimal.emperor.xbf'))
    expect([
      emperorXbf.readInt32LE(0),
      emperorXbf.readInt32LE(4),
      emperorXbf.readUInt32LE(8),
    ]).toEqual([1, 0, 12])
    expect(emperorXbf.subarray(12, 24).toString('ascii')).toBe('fixture.tga\0')
    expect(emperorXbf.readInt32LE(24)).toBe(-1)

    const sageW3x = readFileSync(join(root, 'minimal.sage.w3x'), 'utf8')
    expect(sageW3x).toMatch(/^<\?xml[^>]*>\s*<AssetDeclaration>/u)
    expect(sageW3x.match(/<W3DMesh\b/gu)).toHaveLength(1)
    expect(sageW3x.match(/<W3DHierarchy\b/gu)).toHaveLength(1)
    expect(sageW3x.match(/<W3DAnimation\b/gu)).toHaveLength(1)
    expect(sageW3x).toContain('<Texture Name="DiffuseTexture"><Value>fixture.dds</Value></Texture>')
    expect(sageW3x).toContain('<Include type="all" source="shared.w3x"/>')

    const westwoodW3d = readFileSync(join(root, 'minimal.westwood.w3d'))
    expect(westwoodW3d.readUInt32LE(0)).toBe(0x0)
    expect((westwoodW3d.readUInt32LE(4) & 0x80000000) >>> 0).toBe(0x80000000)
    expect(westwoodW3d.readUInt32LE(4) & 0x7fffffff).toBe(westwoodW3d.byteLength - 8)
    expect([westwoodW3d.readUInt32LE(8), westwoodW3d.readUInt32LE(12)]).toEqual([0x1f, 116])
    expect([
      westwoodW3d.readUInt32LE(56),
      westwoodW3d.readUInt32LE(60),
      westwoodW3d.readUInt32LE(64),
    ]).toEqual([1, 3, 1])

    const redAlert2Vxl = readFileSync(join(root, 'minimal.ra2.vxl'))
    expect(redAlert2Vxl.subarray(0, 15).toString('ascii')).toBe('Voxel Animation')
    expect([
      redAlert2Vxl.readInt32LE(16),
      redAlert2Vxl.readInt32LE(20),
      redAlert2Vxl.readInt32LE(24),
      redAlert2Vxl.readInt32LE(28),
    ]).toEqual([1, 1, 1, 13])
    expect(redAlert2Vxl.subarray(802, 813).toString('ascii')).toBe('FixtureBody')
    const vxlTailer = 802 + 28 + 13
    expect([
      redAlert2Vxl[vxlTailer + 88],
      redAlert2Vxl[vxlTailer + 89],
      redAlert2Vxl[vxlTailer + 90],
      redAlert2Vxl[vxlTailer + 91],
    ]).toEqual([1, 1, 1, 2])

    const sageSkuDef = readFileSync(join(root, 'minimal.sage.skudef'), 'utf8')
    const sageDirectives = sageSkuDef
      .split(/\r?\n/u)
      .map(line => line.replace(/(^|\s)(;|\/\/).*$/u, '').trim())
      .filter(Boolean)
      .map(line => line.split(/\s+/u, 1)[0]?.toLowerCase())
    expect(sageDirectives).toEqual([
      'set-exe',
      'add-config',
      'add-big',
      'add-search-path',
      'mod-name',
    ])
    expect(sageSkuDef).toContain('add-big Core\\1.0\\core.big')

    const cnc3Data = readFileSync(join(root, 'minimal.cnc3-data.xml'), 'utf8')
    expect(cnc3Data).toMatch(/<AssetDeclaration\s+xmlns="uri:ea\.com:eala:asset">/u)
    expect(
      [...cnc3Data.matchAll(/<Include\s+[^>]*source="([^"]+)"[^>]*\/>/gu)].map(match => match[1]),
    ).toEqual(['DATA:global.xml', 'ART:EVDefault.xml'])
    expect(
      [...cnc3Data.matchAll(/<(GameMap|GameScriptList)\s+id="([^"]+)"\s*\/>/gu)].map(match => [
        match[1],
        match[2],
      ]),
    ).toEqual([
      ['GameMap', 'FixtureMap'],
      ['GameScriptList', 'FixtureScripts'],
    ])

    const cnc3Csf = readFileSync(join(root, 'minimal.cnc3-localization.csf'))
    expect(cnc3Csf.subarray(0, 4).toString('latin1')).toBe(' FSC')
    expect([cnc3Csf.readUInt32LE(4), cnc3Csf.readUInt32LE(8), cnc3Csf.readUInt32LE(12)]).toEqual([
      3, 1, 1,
    ])
    let csfCursor = 24
    expect(cnc3Csf.subarray(csfCursor, csfCursor + 4).toString('latin1')).toBe(' LBL')
    csfCursor += 4
    expect(cnc3Csf.readUInt32LE(csfCursor)).toBe(1)
    csfCursor += 4
    const csfLabelLength = cnc3Csf.readUInt32LE(csfCursor)
    csfCursor += 4
    expect(cnc3Csf.subarray(csfCursor, csfCursor + csfLabelLength).toString('latin1')).toBe(
      'GUI:Fixture',
    )
    csfCursor += csfLabelLength
    expect(cnc3Csf.subarray(csfCursor, csfCursor + 4).toString('latin1')).toBe('WRTS')
    csfCursor += 4
    const csfUnits = cnc3Csf.readUInt32LE(csfCursor)
    csfCursor += 4
    let csfValue = ''
    for (let index = 0; index < csfUnits; index += 1)
      csfValue += String.fromCharCode(~cnc3Csf.readUInt16LE(csfCursor + index * 2) & 0xffff)
    expect(csfValue).toBe('Fixture value')

    const cnc3Map = readFileSync(join(root, 'minimal.cnc3.map'))
    expect(cnc3Map.subarray(0, 4).toString('latin1')).toBe('EAR\0')
    const declaredMapBytes = cnc3Map.readUInt32LE(4)
    expect(cnc3Map.subarray(8, 10)).toEqual(Buffer.from([0x10, 0xfb]))
    const refPackHeaderBytes = 5
    const literalControl = cnc3Map[8 + refPackHeaderBytes]
    if (literalControl === undefined) throw new TypeError('CNC3 map RefPack command is missing')
    const literalBytes = ((literalControl & 0x1f) + 1) * 4
    const expandedMap = cnc3Map.subarray(
      8 + refPackHeaderBytes + 1,
      8 + refPackHeaderBytes + 1 + literalBytes,
    )
    expect(expandedMap.byteLength).toBe(declaredMapBytes)
    expect(expandedMap.subarray(0, 4).toString('latin1')).toBe('CkMp')
    expect(expandedMap.readUInt32LE(4)).toBe(1)
    const mapNameLength = expandedMap[8] ?? 0
    expect(expandedMap.subarray(9, 9 + mapNameLength).toString('latin1')).toBe('HeightMapData')
    const chunkHeader = 9 + mapNameLength + 4
    expect([
      expandedMap.readUInt32LE(chunkHeader),
      expandedMap.readUInt16LE(chunkHeader + 4),
      expandedMap.readUInt32LE(chunkHeader + 6),
    ]).toEqual([7, 2, 12])
    expect([
      expandedMap.readUInt32LE(chunkHeader + 10),
      expandedMap.readUInt32LE(chunkHeader + 14),
      expandedMap.readUInt32LE(chunkHeader + 18),
    ]).toEqual([256, 128, 16])

    const duneR8 = readFileSync(join(root, 'minimal.westwood.r8'))
    expect([duneR8[0], duneR8.readInt32LE(1), duneR8.readInt32LE(5), duneR8[25]]).toEqual([
      2, 2, 2, 8,
    ])
    expect([...duneR8.subarray(29)]).toEqual([1, 2, 3, 4])

    const duneR16 = readFileSync(join(root, 'minimal.westwood.r16'))
    expect([duneR16[0], duneR16.readInt32LE(1), duneR16.readInt32LE(5), duneR16[25]]).toEqual([
      2, 2, 2, 16,
    ])
    expect([...duneR16.subarray(29)]).toEqual([0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x00, 0xff, 0x7f])

    const westwoodShp = readFileSync(join(root, 'minimal.westwood.shp'))
    expect([
      westwoodShp.readUInt16LE(2),
      westwoodShp.readUInt16LE(4),
      westwoodShp.readUInt16LE(6),
      westwoodShp[16],
      westwoodShp.readUInt32LE(28),
    ]).toEqual([2, 2, 1, 0, 32])
    expect([...westwoodShp.subarray(32)]).toEqual([1, 2, 3, 4])

    const westwoodTmp = readFileSync(join(root, 'minimal.westwood.tmp'))
    expect([
      westwoodTmp.readUInt32LE(0),
      westwoodTmp.readUInt32LE(4),
      westwoodTmp.readInt32LE(8),
      westwoodTmp.readInt32LE(12),
      westwoodTmp.readUInt32LE(16),
    ]).toEqual([1, 1, 4, 2, 20])
    expect(westwoodTmp.readUInt32LE(32)).toBe(56)
    expect([...westwoodTmp.subarray(72, 76)]).toEqual([1, 2, 3, 4])

    const westwoodVpl = readFileSync(join(root, 'minimal.westwood.vpl'))
    expect([
      westwoodVpl.readUInt32LE(0),
      westwoodVpl.readUInt32LE(4),
      westwoodVpl.readUInt32LE(8),
      westwoodVpl.readUInt32LE(12),
    ]).toEqual([16, 31, 1, 0])
    expect([...westwoodVpl.subarray(784)]).toEqual(Array.from({ length: 256 }, (_, index) => index))

    for (const name of ['minimal.westwood.cps', 'minimal.westwood.wsa']) {
      const opaque = readFileSync(join(root, name))
      expect(opaque.byteLength).toBe(16)
      expect(opaque.readUInt16LE(0)).toBe(name.endsWith('.cps') ? 0x5043 : 0x5357)
    }

    const haloEra = readFileSync(join(root, 'minimal.halo.era'))
    expect([
      haloEra.readUInt32BE(0),
      haloEra.readUInt32BE(4),
      haloEra.readUInt32BE(12),
      haloEra.readUInt16BE(16),
      haloEra.readUInt32BE(20),
      haloEra.readUInt32BE(0x20),
    ]).toEqual([0xdaba7737, 0x1e00, haloEra.byteLength, 2, 0x17fdba9c, 0x05abdbd8])
    const haloTable = 0x1e00
    const namesOffset = haloEra.readUInt32BE(haloTable + 8)
    const namesSize = haloEra.readUInt32BE(haloTable + 12)
    const resource = haloTable + 0x38
    const resourceOffset = haloEra.readUInt32BE(resource + 8)
    const resourceSize = haloEra.readUInt32BE(resource + 12)
    expect(haloEra.subarray(namesOffset, namesOffset + namesSize).toString('ascii')).toBe(
      'data/fixture.txt\0',
    )
    expect(haloEra.subarray(resourceOffset, resourceOffset + resourceSize).toString('ascii')).toBe(
      'halo era payload\n',
    )

    const heroes3Def = readFileSync(join(root, 'minimal.heroes3.def'))
    expect([
      heroes3Def.readUInt32LE(0),
      heroes3Def.readUInt32LE(4),
      heroes3Def.readUInt32LE(8),
      heroes3Def.readUInt32LE(12),
    ]).toEqual([1, 2, 2, 1])

    const heroes3Lod = readFileSync(join(root, 'minimal.heroes3.lod'))
    expect(heroes3Lod.subarray(0, 4).toString('latin1')).toBe('LOD\0')
    expect([heroes3Lod.readUInt32LE(4), heroes3Lod.readUInt32LE(8)]).toEqual([1, 1])
    const heroes3Offset = heroes3Lod.readUInt32LE(92 + 16)
    const heroes3Size = heroes3Lod.readUInt32LE(92 + 20)
    expect(heroes3Lod.subarray(92, 108).toString('ascii').replace(/\0+$/u, '')).toBe('fixture.txt')
    expect(heroes3Lod.subarray(heroes3Offset, heroes3Offset + heroes3Size).toString('ascii')).toBe(
      'heroes three payload\n',
    )

    const heroes4 = readFileSync(join(root, 'minimal.heroes4.h4r'))
    expect(heroes4.subarray(0, 4).toString('latin1')).toBe('H4R\0')
    expect([heroes4.readUInt32LE(4), heroes4.readUInt32LE(8)]).toEqual([1, 1])
    const heroes4Name = heroes4.readUInt32LE(12)
    const heroes4NameLength = heroes4.readUInt16LE(16)
    const heroes4Offset = heroes4.readUInt32LE(20)
    const heroes4Size = heroes4.readUInt32LE(24)
    expect(heroes4.subarray(heroes4Name, heroes4Name + heroes4NameLength).toString('ascii')).toBe(
      'maps/fixture.h4m\0',
    )
    expect(heroes4.subarray(heroes4Offset, heroes4Offset + heroes4Size).toString('ascii')).toBe(
      'heroes four payload\n',
    )

    const springRapid = zlib.gunzipSync(readFileSync(join(root, 'minimal.spring.sdp')))
    const springNameLength = springRapid[0] ?? 0
    expect(springRapid.subarray(1, 1 + springNameLength).toString('ascii')).toBe(
      'units/fixture.txt',
    )
    expect([...springRapid.subarray(1 + springNameLength, 17 + springNameLength)]).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    )
    expect(springRapid.readUInt32BE(21 + springNameLength)).toBe('spring rapid payload\n'.length)

    const springVfs = readFileSync(join(root, 'modinfo.lua'), 'utf8')
    expect(springVfs).toMatch(/^return\s*\{/u)
    expect(springVfs).toContain('name = "Fixture Game"')
    expect(springVfs).toContain('depend = { "Spring content v1", "Engine 105" }')

    expect(readFileSync(join(root, 'minimal.warzone.img'), 'utf8')).toMatch(/^0,0,button\.png/mu)
    expect(readFileSync(join(root, 'minimal.warzone.lev'), 'utf8')).toContain(
      'dataset FIXTURE_DATA',
    )
    expect(readFileSync(join(root, 'minimal.warzone.pie'), 'ascii')).toMatch(/^PIE 3\n/u)
    expect(readFileSync(join(root, 'minimal.warzone.wrf'), 'utf8')).toContain(
      'file IMD "fixture.pie"',
    )
    expect(readFileSync(join(root, 'minimal.warzone.wz')).subarray(0, 4).toString('latin1')).toBe(
      'PK\x03\x04',
    )
    const warzoneMap = readFileSync(join(root, 'minimal.warzone.map'))
    expect(warzoneMap.subarray(0, 4).toString('ascii')).toBe('map ')
    expect([
      warzoneMap.readUInt32LE(4),
      warzoneMap.readUInt32LE(8),
      warzoneMap.readUInt32LE(12),
    ]).toEqual([40, 2, 2])

    expect(readFileSync(join(root, 'minimal.grey-goo.alo')).readUInt32LE(0)).toBe(0x400)
    const petroglyphMeg = readFileSync(join(root, 'minimal.petroglyph.meg'))
    expect([petroglyphMeg.readUInt32LE(0), petroglyphMeg.readUInt32LE(4)]).toEqual([
      0xffffffff, 0x3f7d70a4,
    ])
    const bink = readFileSync(join(root, 'minimal.bik'))
    expect([
      bink.subarray(0, 4).toString('ascii'),
      bink.readUInt32LE(20),
      bink.readUInt32LE(24),
    ]).toEqual(['BIKi', 640, 360])
    const smacker = readFileSync(join(root, 'minimal.smk'))
    expect([
      smacker.subarray(0, 4).toString('ascii'),
      smacker.readUInt32LE(12),
      smacker.readUInt32LE(16),
      smacker.readUInt32LE(20),
    ]).toEqual(['SMK4', 320, 200, 30])
    expect(readFileSync(join(root, 'minimal.earth.par')).subarray(0, 4).toString('latin1')).toBe(
      'PAR\0',
    )
    expect(readFileSync(join(root, 'minimal.earth.tex')).subarray(0, 4).toString('ascii')).toBe(
      'DDS ',
    )
    expect([...readFileSync(join(root, 'minimal.earth2160.kfr')).subarray(0, 5)]).toEqual([
      0x9f, 0x99, 0x66, 0xf6, 0x02,
    ])
    const wd = readFileSync(join(root, 'minimal.reality-pump.wd'))
    expect(wd.readUInt32LE(wd.byteLength - 4)).toBeLessThanOrEqual(wd.byteLength)
    for (const sample of [
      'minimal.relic.chunky.whm',
      'minimal.relic.rgt',
      'minimal.relic.rsh',
      'minimal.relic.rtx',
      'minimal.relic.wtp',
      'minimal.relic.model.whm',
    ]) {
      expect(readFileSync(join(root, sample)).subarray(0, 12).toString('ascii')).toBe(
        'Relic Chunky',
      )
    }
    expect(readFileSync(join(root, 'minimal.relic.sgm')).subarray(0, 8).toString('ascii')).toBe(
      'FOLDRSGM',
    )
    expect(readFileSync(join(root, 'minimal.relic.sga')).subarray(0, 8).toString('ascii')).toBe(
      '_ARCHIVE',
    )
    expect(readFileSync(join(root, 'minimal.relic.rrtex'), 'ascii')).toContain('RRTEX')
    expect(
      readFileSync(join(root, 'minimal.empire-earth.ssa')).subarray(0, 4).toString('latin1'),
    ).toBe('SSA\0')
    for (const sample of ['minimal.empire-earth.sst', 'minimal.empire-earth.texcache']) {
      expect(readFileSync(join(root, sample)).subarray(0, 4).toString('ascii')).toBe('DDS ')
    }
    expect(readFileSync(join(root, 'minimal.heroes6.orc')).subarray(0, 4).toString('latin1')).toBe(
      'PK\x03\x04',
    )

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

    const dae = readFileSync(join(root, 'minimal.dae'), 'utf8')
    expect(dae).toMatch(/<COLLADA[^>]+version="1\.4\.1"/u)
    expect(dae).toMatch(/<float_array[^>]+count="9">0 0 0 1 0 0 0 1 0<\/float_array>/u)
    expect(dae).toMatch(/<triangles count="1">[\s\S]*<p>0 1 2<\/p><\/triangles>/u)

    const gltf = JSON.parse(readFileSync(join(root, 'minimal.gltf'), 'utf8')) as {
      asset: { version: string }
      buffers: { byteLength: number; uri: string }[]
    }
    expect(gltf.asset.version).toBe('2.0')
    const dataUri = gltf.buffers[0]?.uri ?? ''
    expect(dataUri).toMatch(/^data:application\/octet-stream;base64,/u)
    const gltfBinary = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64')
    expect(gltfBinary.byteLength).toBe(gltf.buffers[0]?.byteLength)
    expect([
      gltfBinary.readFloatLE(0),
      gltfBinary.readFloatLE(12),
      gltfBinary.readFloatLE(28),
    ]).toEqual([0, 1, 1])
    expect([
      gltfBinary.readUInt16LE(36),
      gltfBinary.readUInt16LE(38),
      gltfBinary.readUInt16LE(40),
    ]).toEqual([0, 1, 2])

    const uvm = readFileSync(join(root, 'minimal.uvm.glb'))
    expect(uvm.subarray(0, 4).toString('ascii')).toBe('glTF')
    expect(uvm.readUInt32LE(4)).toBe(2)
    expect(uvm.readUInt32LE(8)).toBe(uvm.byteLength)
    const uvmJsonLength = uvm.readUInt32LE(12)
    expect(uvm.readUInt32LE(16)).toBe(0x4e4f534a)
    const uvmDocument = JSON.parse(uvm.subarray(20, 20 + uvmJsonLength).toString('utf8')) as {
      asset: { extras: { uv: { format: string; version: string; profile: string } } }
      extensionsUsed: string[]
    }
    expect(uvmDocument.asset.extras.uv).toEqual({ format: 'UVM', version: '1.0', profile: 'core' })
    expect(uvmDocument.extensionsUsed).toEqual(
      expect.arrayContaining(['UV_asset', 'UV_provenance']),
    )
    const uvmBinHeader = 20 + uvmJsonLength
    expect(uvm.readUInt32LE(uvmBinHeader + 4)).toBe(0x004e4942)
    expect([
      uvm.readUInt16LE(uvmBinHeader + 8 + 36),
      uvm.readUInt16LE(uvmBinHeader + 8 + 38),
      uvm.readUInt16LE(uvmBinHeader + 8 + 40),
    ]).toEqual([0, 1, 2])

    const avi = readFileSync(join(root, 'minimal.avi'))
    expect(avi.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(avi.readUInt32LE(4) + 8).toBe(avi.byteLength)
    expect(avi.subarray(8, 12).toString('ascii')).toBe('AVI ')
    const avih = avi.indexOf('avih')
    const streamHeader = avi.indexOf('strh')
    expect(avih).toBeGreaterThan(0)
    expect(streamHeader).toBeGreaterThan(avih)
    expect(avi.readUInt32LE(avih + 8 + 32)).toBe(1)
    expect(avi.readUInt32LE(avih + 8 + 36)).toBe(1)
    expect(avi.subarray(streamHeader + 8, streamHeader + 12).toString('ascii')).toBe('vids')
    expect(avi.subarray(streamHeader + 12, streamHeader + 16).toString('ascii')).toBe('DIB ')
    expect(avi.indexOf('movi')).toBeGreaterThan(streamHeader)
    expect(avi.indexOf('00db')).toBeGreaterThan(avi.indexOf('movi'))

    const wmv = readFileSync(join(root, 'minimal.wmv'))
    const asfHeaderGuid = '3026b2758e66cf11a6d900aa0062ce6c'
    const asfDataGuid = '3626b2758e66cf11a6d900aa0062ce6c'
    expect(wmv.subarray(0, 16).toString('hex')).toBe(asfHeaderGuid)
    const asfHeaderSize = Number(wmv.readBigUInt64LE(16))
    expect(wmv.readUInt32LE(24)).toBe(3)
    expect([...wmv.subarray(28, 30)]).toEqual([1, 2])
    let asfOffset = 30
    const headerObjectGuids = []
    for (let index = 0; index < 3; index += 1) {
      headerObjectGuids.push(wmv.subarray(asfOffset, asfOffset + 16).toString('hex'))
      asfOffset += Number(wmv.readBigUInt64LE(asfOffset + 16))
    }
    expect(asfOffset).toBe(asfHeaderSize)
    expect(headerObjectGuids).toEqual([
      'a1dcab8c47a9cf118ee400c00c205365',
      '9107dcb7b7a9cf118ee600c00c205365',
      'b503bf5f2ea9cf118ee300c00c205365',
    ])
    expect(wmv.subarray(asfHeaderSize, asfHeaderSize + 16).toString('hex')).toBe(asfDataGuid)
    expect(Number(wmv.readBigUInt64LE(asfHeaderSize + 16))).toBe(50)

    const aac = readFileSync(join(root, 'minimal.aac'))
    let adtsOffset = 0
    let adtsFrames = 0
    while (adtsOffset < aac.byteLength) {
      expect(aac[adtsOffset]).toBe(0xff)
      expect((aac[adtsOffset + 1] ?? 0) & 0xf6).toBe(0xf0)
      const frameLength =
        (((aac[adtsOffset + 3] ?? 0) & 3) << 11) |
        ((aac[adtsOffset + 4] ?? 0) << 3) |
        ((aac[adtsOffset + 5] ?? 0) >>> 5)
      expect(frameLength).toBe(8)
      expect(aac[adtsOffset + 7]).toBe(0xe0)
      adtsOffset += frameLength
      adtsFrames += 1
    }
    expect([adtsOffset, adtsFrames]).toEqual([aac.byteLength, 2])

    const flac = readFileSync(join(root, 'minimal.flac'))
    expect(flac.subarray(0, 4).toString('ascii')).toBe('fLaC')
    expect(flac[4]).toBe(0x80)
    expect(flac.readUIntBE(5, 3)).toBe(34)
    const streamPacked = flac.readBigUInt64BE(18)
    expect(Number(streamPacked >> 44n)).toBe(8000)
    expect(Number((streamPacked >> 36n) & 0x1fn) + 1).toBe(8)
    expect(Number(streamPacked & 0xfffffffffn)).toBe(16)
    expect(flac.subarray(26, 42).toString('hex')).toBe(
      createHash('md5').update(Buffer.alloc(16)).digest('hex'),
    )
    const crc8 = (data: Buffer) => {
      let value = 0
      for (const byte of data) {
        value ^= byte
        for (let bit = 0; bit < 8; bit += 1)
          value = (value & 0x80) !== 0 ? ((value << 1) ^ 0x07) & 0xff : (value << 1) & 0xff
      }
      return value
    }
    const crc16 = (data: Buffer) => {
      let value = 0
      for (const byte of data) {
        value ^= byte << 8
        for (let bit = 0; bit < 8; bit += 1)
          value = (value & 0x8000) !== 0 ? ((value << 1) ^ 0x8005) & 0xffff : (value << 1) & 0xffff
      }
      return value
    }
    expect(flac.subarray(42, 44).toString('hex')).toBe('fff8')
    expect(flac[48]).toBe(crc8(flac.subarray(42, 48)))
    expect(flac.readUInt16BE(flac.byteLength - 2)).toBe(crc16(flac.subarray(42, -2)))

    const m4a = readFileSync(join(root, 'minimal.m4a'))
    expect(m4a.subarray(4, 8).toString('ascii')).toBe('ftyp')
    expect(m4a.subarray(8, 12).toString('ascii')).toBe('M4A ')
    for (const type of [
      'moov',
      'trak',
      'mdia',
      'mdhd',
      'hdlr',
      'minf',
      'stbl',
      'stsd',
      'mp4a',
      'mdat',
    ])
      expect(m4a.indexOf(type)).toBeGreaterThan(0)
    const stsd = m4a.indexOf('stsd') - 4
    const mp4a = m4a.indexOf('mp4a') - 4
    expect(m4a.readUInt32BE(stsd + 12)).toBe(1)
    expect(m4a.readUInt16BE(mp4a + 24)).toBe(1)
    expect(m4a.readUInt16BE(mp4a + 26)).toBe(16)
    expect(m4a.readUInt32BE(mp4a + 32)).toBe(8000 * 65536)
    const stco = m4a.indexOf('stco') - 4
    const mdat = m4a.indexOf('mdat') - 4
    expect(m4a.readUInt32BE(stco + 16)).toBe(mdat + 8)
    expect(m4a[mdat + 8]).toBe(0xe0)

    const emf = readFileSync(join(root, 'minimal.emf'))
    expect(emf.readUInt32LE(0)).toBe(1)
    expect(emf.readUInt32LE(40)).toBe(0x464d4520)
    expect([emf.readUInt32LE(48), emf.readUInt32LE(52)]).toEqual([emf.byteLength, 3])
    let emfOffset = 0
    const emfRecords = []
    while (emfOffset < emf.byteLength) {
      const type = emf.readUInt32LE(emfOffset)
      const size = emf.readUInt32LE(emfOffset + 4)
      emfRecords.push([type, size])
      emfOffset += size
    }
    expect(emfRecords).toEqual([
      [1, 88],
      [43, 24],
      [14, 20],
    ])
    expect([
      emf.readInt32LE(96),
      emf.readInt32LE(100),
      emf.readInt32LE(104),
      emf.readInt32LE(108),
    ]).toEqual([10, 5, 90, 45])

    const wmf = readFileSync(join(root, 'minimal.wmf'))
    expect(wmf.readUInt32LE(0)).toBe(0x9ac6cdd7)
    let wmfChecksum = 0
    for (let offset = 0; offset < 20; offset += 2) wmfChecksum ^= wmf.readUInt16LE(offset)
    expect(wmf.readUInt16LE(20)).toBe(wmfChecksum)
    expect([wmf.readUInt16LE(24), wmf.readUInt16LE(26), wmf.readUInt32LE(28)]).toEqual([
      9, 0x300, 19,
    ])
    expect([wmf.readUInt32LE(40), wmf.readUInt16LE(44)]).toEqual([7, 0x041b])
    expect([wmf.readUInt32LE(54), wmf.readUInt16LE(58)]).toEqual([3, 0])

    const unrealPackages = [
      ['minimal.soundwave.uasset', 'SoundWave', 'VO_Line'],
      ['minimal.staticmesh.uasset', 'StaticMesh', 'SM_Triangle'],
      ['minimal.texture2d.uasset', 'Texture2D', 'T_Checker'],
      ['minimal.media.uasset', 'BinkMediaPlayer', 'IntroMovie'],
    ] as const
    for (const [file, expectedClass, expectedExport] of unrealPackages) {
      const data = readFileSync(join(root, file))
      expect(data.readUInt32LE(0)).toBe(0x9e2a83c1)
      expect(data.readInt32LE(4)).toBe(-7)
      expect(data.readInt32LE(12)).toBe(522)
      const totalHeaderSize = data.readInt32LE(24)
      const folderBytes = data.readInt32LE(28)
      const summaryTables = 32 + folderBytes
      const nameCount = data.readInt32LE(summaryTables + 4)
      const nameOffset = data.readInt32LE(summaryTables + 8)
      const exportCount = data.readInt32LE(summaryTables + 20)
      const exportOffset = data.readInt32LE(summaryTables + 24)
      const importCount = data.readInt32LE(summaryTables + 28)
      const importOffset = data.readInt32LE(summaryTables + 32)
      const dependsOffset = data.readInt32LE(summaryTables + 36)
      expect([nameCount, importCount, exportCount]).toEqual([4, 1, 1])
      expect(nameOffset).toBeLessThan(importOffset)
      expect(importOffset).toBeLessThan(exportOffset)
      expect(exportOffset).toBeLessThan(dependsOffset)
      expect(dependsOffset).toBeLessThan(totalHeaderSize)
      const names = []
      let nameCursor = nameOffset
      for (let index = 0; index < nameCount; index += 1) {
        const length = data.readInt32LE(nameCursor)
        names.push(data.subarray(nameCursor + 4, nameCursor + 3 + length).toString('utf8'))
        nameCursor += 4 + length + 4
      }
      const classIndex = data.readInt32LE(importOffset + 20)
      const exportNameIndex = data.readInt32LE(exportOffset + 16)
      expect(names[classIndex]).toBe(expectedClass)
      expect(names[exportNameIndex]).toBe(expectedExport)
      expect(data.readInt32LE(exportOffset)).toBe(-1)
      const serialSize = Number(data.readBigInt64LE(exportOffset + 28))
      const serialOffset = Number(data.readBigInt64LE(exportOffset + 36))
      expect(serialOffset).toBe(totalHeaderSize)
      expect(serialOffset + serialSize).toBe(data.byteLength)
      expect(data.readInt32LE(dependsOffset)).toBe(0)
    }

    const soundWave = readFileSync(join(root, 'minimal.soundwave.uasset'))
    const soundRiff = soundWave.indexOf('RIFF')
    expect(soundWave.subarray(soundRiff + 8, soundRiff + 12).toString('ascii')).toBe('WAVE')
    expect(soundWave.readUInt16LE(soundWave.indexOf('fmt ') + 8)).toBe(1)
    expect(soundWave.indexOf('data')).toBeGreaterThan(soundWave.indexOf('fmt '))

    const staticMesh = readFileSync(join(root, 'minimal.staticmesh.uasset'))
    const staticHeaderSize = staticMesh.readInt32LE(24)
    expect(staticMesh.readUInt32LE(staticHeaderSize + 10)).toBe(1)
    expect([
      staticMesh.readFloatLE(staticHeaderSize + 62),
      staticMesh.readFloatLE(staticHeaderSize + 74),
      staticMesh.readFloatLE(staticHeaderSize + 90),
    ]).toEqual([0, 1, 1])
    expect([...staticMesh.subarray(staticHeaderSize + 186, staticHeaderSize + 192)]).toEqual([
      0, 0, 1, 0, 2, 0,
    ])

    const texture = readFileSync(join(root, 'minimal.texture2d.uasset'))
    const pixelFormat = texture.indexOf('PF_B8G8R8A8')
    expect(texture.readInt32LE(pixelFormat - 4)).toBe(12)
    const mipHeader = pixelFormat + 12
    expect([texture.readUInt32LE(mipHeader), texture.readUInt32LE(mipHeader + 4)]).toEqual([0, 1])
    expect(texture.readUInt32LE(mipHeader + 16)).toBe(16)
    expect([...texture.subarray(mipHeader + 32, mipHeader + 36)]).toEqual([0, 0, 255, 255])
    expect([texture.readUInt32LE(mipHeader + 48), texture.readUInt32LE(mipHeader + 52)]).toEqual([
      2, 2,
    ])

    const media = readFileSync(join(root, 'minimal.media.uasset'))
    const mediaRiff = media.indexOf('RIFF')
    expect(media.subarray(mediaRiff + 8, mediaRiff + 12).toString('ascii')).toBe('AVI ')
    expect(media.indexOf('avih')).toBeGreaterThan(mediaRiff)
    expect(media.indexOf('strh')).toBeGreaterThan(media.indexOf('avih'))

    const csv = readFileSync(join(root, 'minimal.csv'), 'ascii')
    expect(csv).toMatch(/^name,quote,note\r\n/u)
    expect(csv).toContain('"Hello, ""world"""')
    expect(csv).toContain('"line one\r\nline two"')
    expect(csv.endsWith('\r\n')).toBe(true)

    const markdown = readFileSync(join(root, 'minimal.md'), 'utf8')
    expect(markdown.match(/^#{1,6}\s+/gmu)).toHaveLength(2)
    expect(markdown.match(/^```/gmu)).toHaveLength(2)
    expect(markdown).toContain('[spec](https://example.invalid/spec)')

    const rtf = readFileSync(join(root, 'minimal.rtf'), 'ascii')
    expect(rtf).toMatch(/^\{\\rtf1\\ansi/u)
    expect(rtf.endsWith('}')).toBe(true)
    expect([...rtf].filter(character => character === '{')).toHaveLength(
      [...rtf].filter(character => character === '}').length,
    )
    expect(rtf.match(/\\par\b/gu)).toHaveLength(2)

    const txt = readFileSync(join(root, 'minimal.txt'))
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(txt)).not.toThrow()
    expect(txt.toString('ascii').match(/\r\n/gu)).toHaveLength(4)

    const officeFixtures = {
      docx: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
      pptx: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml'],
      xlsx: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
      odt: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
      odp: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
      ods: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
    } as const
    const odfMediaTypes = {
      odt: 'application/vnd.oasis.opendocument.text',
      odp: 'application/vnd.oasis.opendocument.presentation',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
    } as const
    for (const [format, expectedNames] of Object.entries(officeFixtures)) {
      const data = readFileSync(join(root, `minimal.${format}`))
      const eocd = data.byteLength - 22
      expect(data.readUInt32LE(eocd)).toBe(0x06054b50)
      const entries = data.readUInt16LE(eocd + 10)
      expect(entries).toBe(expectedNames.length)
      let central = data.readUInt32LE(eocd + 16)
      const names = []
      for (let index = 0; index < entries; index += 1) {
        expect(data.readUInt32LE(central)).toBe(0x02014b50)
        const nameLength = data.readUInt16LE(central + 28)
        const extraLength = data.readUInt16LE(central + 30)
        const commentLength = data.readUInt16LE(central + 32)
        names.push(data.subarray(central + 46, central + 46 + nameLength).toString('utf8'))
        central += 46 + nameLength + extraLength + commentLength
      }
      expect(names).toEqual([...expectedNames])
      expect(central).toBe(eocd)
      if (format === 'odt' || format === 'odp' || format === 'ods') {
        expect(data.readUInt32LE(0)).toBe(0x04034b50)
        expect(data.readUInt16LE(8)).toBe(0)
        const nameLength = data.readUInt16LE(26)
        const extraLength = data.readUInt16LE(28)
        expect(data.subarray(30, 30 + nameLength).toString('utf8')).toBe('mimetype')
        const payload = 30 + nameLength + extraLength
        const size = data.readUInt32LE(22)
        expect(data.subarray(payload, payload + size).toString('utf8')).toBe(odfMediaTypes[format])
      }
    }

    for (const format of ['pdf', 'ai'] as const) {
      const data = readFileSync(join(root, `minimal.${format}`))
      const source = data.toString('latin1')
      expect(source).toMatch(/^%PDF-1\.7\n/u)
      const ending = /startxref\n(\d+)\n%%EOF\n$/u.exec(source)
      expect(ending).not.toBeNull()
      const xrefOffset = Number(ending?.[1])
      expect(source.slice(xrefOffset, xrefOffset + 9)).toBe('xref\n0 6\n')
      const rows = source
        .slice(xrefOffset + 9, source.indexOf('trailer\n', xrefOffset))
        .trimEnd()
        .split('\n')
      expect(rows).toHaveLength(6)
      for (let object = 1; object < rows.length; object += 1) {
        const offset = Number(rows[object]?.slice(0, 10))
        expect(source.slice(offset)).toMatch(new RegExp(`^${object} 0 obj\\n`, 'u'))
      }
      expect(source.slice(xrefOffset)).toContain('<< /Size 6 /Root 1 0 R /Info 5 0 R >>')
      expect(source.includes('Adobe Illustrator')).toBe(format === 'ai')
    }

    const drawio = readFileSync(join(root, 'minimal.drawio'), 'utf8')
    expect(drawio).toMatch(/^<\?xml[^>]*><mxfile\b/u)
    expect(drawio.match(/<diagram\b/gu)).toHaveLength(1)
    const cellIds = [...drawio.matchAll(/<mxCell\b[^>]*\bid="([^"]+)"/gu)].map(match => match[1])
    expect(cellIds).toEqual(['0', '1', 'node-a', 'node-b', 'edge-a-b'])
    expect(drawio).toContain('source="node-a" target="node-b"')
    expect(drawio.match(/<mxGeometry\b/gu)).toHaveLength(3)

    const vsd = readFileSync(join(root, 'minimal.vsd'))
    expect(vsd.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1')
    expect(vsd.readUInt16LE(26)).toBe(3)
    expect(vsd.readUInt16LE(28)).toBe(0xfffe)
    expect(vsd.readUInt16LE(30)).toBe(9)
    expect(vsd.readUInt32LE(44)).toBe(1)
    expect(vsd.readUInt32LE(76)).toBe(1)
    expect(vsd.readUInt32LE(1024)).toBe(0xfffffffe)
    expect(vsd.readUInt32LE(1028)).toBe(0xfffffffd)
    const cfbName = (offset: number) => {
      const bytes = vsd.readUInt16LE(offset + 64)
      return vsd.subarray(offset, offset + bytes - 2).toString('utf16le')
    }
    expect(cfbName(512)).toBe('Root Entry')
    expect(cfbName(640)).toBe('VisioDocument')

    const vsdx = readFileSync(join(root, 'minimal.vsdx'))
    const vsdxEocd = vsdx.byteLength - 22
    expect(vsdx.readUInt32LE(vsdxEocd)).toBe(0x06054b50)
    expect(vsdx.readUInt16LE(vsdxEocd + 10)).toBe(5)

    const cdr = readFileSync(join(root, 'minimal.cdr'))
    expect(cdr.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(cdr.readUInt32LE(4) + 8).toBe(cdr.byteLength)
    expect(cdr.subarray(8, 12).toString('ascii')).toBe('CDR6')
    expect(cdr.subarray(12, 16).toString('ascii')).toBe('LIST')
    expect(cdr.subarray(20, 24).toString('ascii')).toBe('page')
    expect(cdr.subarray(24, 28).toString('ascii')).toBe('LIST')
    expect(cdr.subarray(32, 36).toString('ascii')).toBe('obj ')
    expect(cdr.subarray(36, 40).toString('ascii')).toBe('loda')

    const fig = readFileSync(join(root, 'minimal.fig'))
    const figEocd = fig.byteLength - 22
    let figCentral = fig.readUInt32LE(figEocd + 16)
    const figParts = new Map<string, Buffer>()
    for (let index = 0; index < fig.readUInt16LE(figEocd + 10); index += 1) {
      const method = fig.readUInt16LE(figCentral + 10)
      const compressedBytes = fig.readUInt32LE(figCentral + 20)
      const nameBytes = fig.readUInt16LE(figCentral + 28)
      const extraBytes = fig.readUInt16LE(figCentral + 30)
      const commentBytes = fig.readUInt16LE(figCentral + 32)
      const local = fig.readUInt32LE(figCentral + 42)
      const name = fig.subarray(figCentral + 46, figCentral + 46 + nameBytes).toString('utf8')
      const localNameBytes = fig.readUInt16LE(local + 26)
      const localExtraBytes = fig.readUInt16LE(local + 28)
      const payload = local + 30 + localNameBytes + localExtraBytes
      const compressed = fig.subarray(payload, payload + compressedBytes)
      figParts.set(name, method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed))
      figCentral += 46 + nameBytes + extraBytes + commentBytes
    }
    expect([...figParts.keys()]).toEqual(['canvas.fig', 'meta.json'])
    const canvas = figParts.get('canvas.fig')
    expect(canvas?.subarray(0, 8).toString('ascii')).toBe('fig-kiwi')
    expect(canvas?.readUInt32LE(8)).toBe(101)
    const schemaBytes = canvas?.readUInt32LE(12) ?? 0
    const schema = zlib.inflateRawSync(canvas?.subarray(16, 16 + schemaBytes) ?? Buffer.alloc(0))
    expect(schema.subarray(0, 13).toString('latin1')).toBe('\u0001NodeChanges\u0000')
    const dataStart = 16 + schemaBytes + 4
    expect(canvas?.subarray(dataStart, dataStart + 4).toString('hex')).toBe('28b52ffd')
    expect(JSON.parse(figParts.get('meta.json')?.toString('utf8') ?? '')).toMatchObject({
      name: 'Modkit X3 Figma fixture',
    })

    const psd = readFileSync(join(root, 'minimal.psd'))
    expect(psd.subarray(0, 4).toString('ascii')).toBe('8BPS')
    expect(psd.readUInt16BE(4)).toBe(1)
    expect([...psd.subarray(6, 12)]).toEqual([0, 0, 0, 0, 0, 0])
    expect(psd.readUInt16BE(12)).toBe(3)
    expect([psd.readUInt32BE(18), psd.readUInt32BE(14)]).toEqual([1, 1])
    expect([psd.readUInt16BE(22), psd.readUInt16BE(24)]).toEqual([8, 3])
    let psdOffset = 26
    expect(psd.readUInt32BE(psdOffset)).toBe(0)
    psdOffset += 4
    const resourceBytes = psd.readUInt32BE(psdOffset)
    psdOffset += 4
    expect(psd.subarray(psdOffset, psdOffset + 4).toString('ascii')).toBe('8BIM')
    expect(psd.readUInt16BE(psdOffset + 4)).toBe(1005)
    expect(resourceBytes).toBe(28)
    psdOffset += resourceBytes
    const layerMaskBytes = psd.readUInt32BE(psdOffset)
    psdOffset += 4
    expect(layerMaskBytes).toBe(88)
    expect(psd.readUInt32BE(psdOffset)).toBe(80)
    expect(psd.readInt16BE(psdOffset + 4)).toBe(1)
    psdOffset += layerMaskBytes
    expect(psd.readUInt16BE(psdOffset)).toBe(0)
    expect([...psd.subarray(psdOffset + 2)]).toEqual([255, 128, 64])

    const blend = readFileSync(join(root, 'minimal.blend'))
    expect(blend.subarray(0, 12).toString('ascii')).toBe('BLENDER-v400')
    let blendOffset = 12
    const blendBlocks: { code: string; size: number; payload: number }[] = []
    while (blendOffset < blend.byteLength) {
      const code = blend.subarray(blendOffset, blendOffset + 4).toString('ascii')
      const size = blend.readUInt32LE(blendOffset + 4)
      if (code === 'ENDB') {
        expect(size).toBe(0)
        blendOffset += 8
        blendBlocks.push({ code, size, payload: blendOffset })
        break
      }
      const payload = blendOffset + 24
      blendBlocks.push({ code, size, payload })
      blendOffset = payload + size
    }
    expect(blendOffset).toBe(blend.byteLength)
    expect(blendBlocks.map(block => block.code)).toEqual(['MV  ', 'MF  ', 'DNA1', 'ENDB'])
    const vertexBlock = blendBlocks[0]
    const faceBlock = blendBlocks[1]
    const dnaBlock = blendBlocks[2]
    expect(vertexBlock?.size).toBe(36)
    expect([
      blend.readFloatLE(vertexBlock?.payload ?? 0),
      blend.readFloatLE((vertexBlock?.payload ?? 0) + 12),
      blend.readFloatLE((vertexBlock?.payload ?? 0) + 28),
    ]).toEqual([0, 1, 1])
    expect([
      blend.readUInt32LE(faceBlock?.payload ?? 0),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 4),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 8),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 12),
    ]).toEqual([0, 1, 2, 0])
    const dnaPayload = dnaBlock?.payload ?? 0
    expect(blend.subarray(dnaPayload, dnaPayload + 8).toString('ascii')).toBe('SDNANAME')
    expect(blend.readUInt32LE(dnaPayload + 8)).toBe(5)
    expect(blend.indexOf('TYPE', dnaPayload)).toBeGreaterThan(dnaPayload)
    expect(blend.indexOf('TLEN', dnaPayload)).toBeGreaterThan(dnaPayload)
    expect(blend.indexOf('STRC', dnaPayload)).toBeGreaterThan(dnaPayload)

    const actorX = readFileSync(join(root, 'minimal.actorx.psk'))
    const actorXChunks: [string, number, number][] = []
    let actorXOffset = 0
    while (actorXOffset < actorX.byteLength) {
      const rawName = actorX.subarray(actorXOffset, actorXOffset + 20)
      const zero = rawName.indexOf(0)
      const name = rawName.subarray(0, zero < 0 ? rawName.length : zero).toString('ascii')
      const recordSize = actorX.readInt32LE(actorXOffset + 24)
      const count = actorX.readInt32LE(actorXOffset + 28)
      actorXChunks.push([name, recordSize, count])
      actorXOffset += 32 + recordSize * count
    }
    expect(actorXOffset).toBe(actorX.byteLength)
    expect(actorXChunks).toEqual([
      ['ACTRHEAD', 0, 0],
      ['PNTS0000', 12, 3],
      ['VTXW0000', 16, 3],
      ['FACE0000', 12, 1],
      ['MATT0000', 88, 1],
      ['REFSKELT', 120, 1],
      ['RAWWEIGHTS', 12, 3],
    ])

    const pak = readFileSync(join(root, 'minimal.unreal.pak'))
    const pakFooter = pak.byteLength - 221
    const pakMagic = pakFooter + 17
    expect(pak.readUInt32LE(pakMagic)).toBe(0x5a6f12e1)
    expect(pak.readUInt32LE(pakMagic + 4)).toBe(8)
    const pakIndexOffset = Number(pak.readBigInt64LE(pakMagic + 8))
    const pakIndexSize = Number(pak.readBigInt64LE(pakMagic + 16))
    expect(pakIndexOffset + pakIndexSize).toBe(pakFooter)
    expect(
      createHash('sha1')
        .update(pak.subarray(pakIndexOffset, pakIndexOffset + pakIndexSize))
        .digest(),
    ).toEqual(pak.subarray(pakMagic + 24, pakMagic + 44))

    const utoc = readFileSync(join(root, 'minimal.unreal.utoc'))
    const ucas = readFileSync(join(root, 'minimal.unreal.ucas'))
    expect(utoc.subarray(0, 16).toString('ascii')).toBe('-==--==--==--==-')
    expect([utoc[0x10], utoc.readUInt32LE(0x14), utoc.readUInt32LE(0x18)]).toEqual([6, 0x90, 2])
    const ioBlocks = 0x90 + 2 * 12 + 2 * 10
    const firstPhysical = utoc.readUInt32LE(ioBlocks)
    const firstStored = utoc.readUIntLE(ioBlocks + 5, 3)
    const secondPhysical = utoc.readUInt32LE(ioBlocks + 12)
    const secondStored = utoc.readUIntLE(ioBlocks + 17, 3)
    expect(ucas.subarray(firstPhysical, firstPhysical + firstStored).toString()).toBe(
      'iostore unit asset',
    )
    expect(ucas.subarray(secondPhysical, secondPhysical + secondStored).toString()).toBe(
      '[IoStore]\nMounted=true\n',
    )

    const bar = readFileSync(join(root, 'minimal.age-bar'))
    expect(bar.subarray(0, 4).toString('ascii')).toBe('ESPN')
    expect(bar.readUInt32LE(4)).toBe(5)
    expect(bar.readUInt32LE(280)).toBe(3)
    const barTable = Number(bar.readBigUInt64LE(288))
    expect(barTable).toBeGreaterThan(304)
    const rootCharacters = bar.readUInt32LE(barTable)
    expect(bar.subarray(barTable + 4, barTable + 4 + rootCharacters * 2).toString('utf16le')).toBe(
      'art',
    )
    let barCursor = barTable + 8 + rootCharacters * 2
    const barEntries: { name: string; compressed: number; payload: Buffer }[] = []
    for (let index = 0; index < 3; index += 1) {
      const payloadOffset = Number(bar.readBigUInt64LE(barCursor))
      const decodedSize = bar.readUInt32LE(barCursor + 8)
      const storedSize = bar.readUInt32LE(barCursor + 12)
      expect(bar.readUInt32LE(barCursor + 16)).toBe(decodedSize)
      barCursor += 36
      const nameCharacters = bar.readUInt32LE(barCursor)
      barCursor += 4
      const name = bar.subarray(barCursor, barCursor + nameCharacters * 2).toString('utf16le')
      barCursor += nameCharacters * 2
      const compressed = bar.readUInt32LE(barCursor)
      barCursor += 4
      barEntries.push({
        name,
        compressed,
        payload: bar.subarray(payloadOffset, payloadOffset + storedSize),
      })
    }
    expect(barEntries.map(entry => [entry.name, entry.compressed])).toEqual([
      ['data/proto.xmb', 0],
      ['strings/help.txt', 1],
      ['textures/icon.ddt', 1],
    ])
    expect(barEntries[0]?.payload.toString('utf8')).toBe('<xmb/>')
    expect(barEntries[1]?.payload.subarray(0, 4).toString('ascii')).toBe('l33t')
    expect(
      zlib.inflateRawSync(barEntries[1]?.payload.subarray(10) ?? Buffer.alloc(0)).toString(),
    ).toBe('hello l33t\n')
    const alz4 = barEntries[2]?.payload
    expect(alz4?.subarray(0, 4).toString('ascii')).toBe('alz4')
    const alz4Size = alz4?.readUInt32LE(4) ?? 0
    expect((alz4?.[16] ?? 0) >>> 4).toBe(alz4Size)
    expect(alz4?.subarray(17, 17 + alz4Size).toString()).toBe('hello alz4\n')

    const drs = readFileSync(join(root, 'minimal.age-drs'))
    expect(drs.subarray(40, 44).toString('ascii')).toBe('1.00')
    expect(drs.subarray(44, 49).toString('ascii')).toBe('tribe')
    expect(drs.readUInt32LE(56)).toBe(2)
    const drsTypes = []
    const drsResources = []
    for (let tableIndex = 0; tableIndex < 2; tableIndex += 1) {
      const table = 64 + tableIndex * 12
      const rawType = drs.subarray(table, table + 4).toString('ascii')
      const type = [...rawType].reverse().join('').trim()
      drsTypes.push(type)
      const resources = drs.readUInt32LE(table + 4)
      expect(drs.readUInt32LE(table + 8)).toBe(1)
      const id = drs.readUInt32LE(resources)
      const payload = drs.readUInt32LE(resources + 4)
      const size = drs.readUInt32LE(resources + 8)
      drsResources.push([type, id, drs.subarray(payload, payload + size).toString('utf8')])
    }
    expect(drsTypes).toEqual(['slp', 'wav'])
    expect(drsResources).toEqual([
      ['slp', 42, 'sprite'],
      ['wav', 7, 'sound'],
    ])

    const bti = readFileSync(join(root, 'minimal.bti'))
    expect(bti.toString('utf8')).toBe(
      'alpha=4 nomip noalphatest noLowDetail displacement fmt=BC2\n',
    )

    const cub = readFileSync(join(root, 'minimal.cub'))
    expect(
      cub
        .toString('utf8')
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('//')),
    ).toEqual([
      'sky_up.ddt',
      'sky_down.ddt',
      'sky_front.ddt',
      'sky_back.ddt',
      'sky_left.ddt',
      'sky_right.ddt',
    ])

    const mtrl = readFileSync(join(root, 'minimal.mtrl'))
    expect(mtrl.subarray(0, 4).toString('ascii')).toBe('MTRL')
    expect([mtrl.readUInt32LE(4), mtrl.readUInt32LE(8), mtrl.readUInt32LE(12)]).toEqual([17, 7, 19])
    expect([mtrl.readInt32LE(84), mtrl.readInt32LE(96)]).toEqual([7, 10])
    expect(mtrl.subarray(212).toString('utf8').split('\0')).toEqual([
      'terrain\\grass.ddt',
      'sky.cub',
      'terrain\\grass_n.ddt',
      '',
    ])

    const prt = readFileSync(join(root, 'minimal.prt'))
    expect([prt.readInt32LE(0), prt.readInt32LE(16), prt.readInt32LE(20)]).toEqual([12, 64, 0])
    expect([
      prt.readInt32LE(212),
      prt.readInt32LE(216),
      prt.readInt32LE(220),
      prt.readInt32LE(224),
    ]).toEqual([1, 4, 64, 64])
    expect([
      prt.readInt32LE(260),
      prt.readInt32LE(284),
      prt.readInt32LE(332),
      prt.readInt32LE(336),
      prt.readInt32LE(440),
    ]).toEqual([1, 1, 1, 1, 1])
    const brgCharacters = prt.readInt32LE(456)
    expect(brgCharacters).toBe(9)
    expect(prt.subarray(460, 460 + brgCharacters * 2).toString('utf16le')).toBe('spark.brg')

    const ddt = readFileSync(join(root, 'minimal.ddt'))
    expect(ddt.subarray(0, 4).toString('ascii')).toBe('RTS3')
    expect([...ddt.subarray(4, 8)]).toEqual([0, 0, 4, 1])
    expect([ddt.readUInt32LE(8), ddt.readUInt32LE(12)]).toEqual([4, 4])
    const ddtPayload = ddt.readUInt32LE(16)
    expect(ddt.readUInt32LE(20)).toBe(8)
    const red565 = ddt.readUInt16LE(ddtPayload)
    expect([
      Math.round((((red565 >>> 11) & 0x1f) * 255) / 31),
      Math.round((((red565 >>> 5) & 0x3f) * 255) / 63),
      Math.round(((red565 & 0x1f) * 255) / 31),
    ]).toEqual([255, 0, 0])
    expect(ddt.readUInt32LE(ddtPayload + 4)).toBe(0)

    const slp = readFileSync(join(root, 'minimal.slp'))
    expect(slp.subarray(0, 4).toString('ascii')).toBe('2.0N')
    expect(slp.readUInt32LE(4)).toBe(1)
    expect([slp.readUInt32LE(32), slp.readUInt32LE(36)]).toEqual([68, 64])
    expect([slp.readInt32LE(48), slp.readInt32LE(52)]).toEqual([1, 1])
    expect([slp.readUInt16LE(64), slp.readUInt16LE(66)]).toEqual([0, 0])
    expect(slp.readUInt32LE(68)).toBe(72)
    expect([...slp.subarray(72)]).toEqual([0x04, 0x07, 0x0f])

    const smp = readFileSync(join(root, 'minimal.smp'))
    expect(smp.subarray(0, 4).toString('ascii')).toBe('SMP$')
    expect([smp.readUInt32LE(8), smp.readUInt32LE(12), smp.readUInt32LE(16)]).toEqual([1, 1, 1])
    expect(smp.readUInt32LE(24)).toBe(smp.byteLength)
    const smpFrame = smp.readUInt32LE(64)
    expect(smpFrame).toBe(68)
    expect(smp.readUInt32LE(smpFrame + 28)).toBe(1)
    const smpLayer = smpFrame + 32
    expect([smp.readUInt32LE(smpLayer), smp.readUInt32LE(smpLayer + 4)]).toEqual([1, 1])
    expect(smp.readUInt32LE(smpLayer + 16)).toBe(0x02)
    expect([smp.readUInt32LE(smpLayer + 20), smp.readUInt32LE(smpLayer + 24)]).toEqual([64, 68])
    expect(smp.readUInt32LE(smpFrame + 68)).toBe(72)

    const smx = readFileSync(join(root, 'minimal.smx'))
    expect(smx.subarray(0, 4).toString('ascii')).toBe('SMPX')
    expect([smx.readUInt16LE(4), smx.readUInt16LE(6)]).toEqual([2, 1])
    expect(smx.readUInt32LE(8)).toBe(smx.byteLength - 32)
    expect([...smx.subarray(32, 34)]).toEqual([0x01, 0])
    const smxLayer = 38
    expect([smx.readUInt16LE(smxLayer), smx.readUInt16LE(smxLayer + 2)]).toEqual([1, 1])
    expect(smx.readUInt32LE(smxLayer + 8)).toBe(35)
    expect([smx.readUInt32LE(smxLayer + 20), smx.readUInt32LE(smxLayer + 24)]).toEqual([2, 5])
    expect([...smx.subarray(smxLayer + 28)]).toEqual([0x01, 0x03, 0x07, 0, 0, 0, 0])

    const sld = readFileSync(join(root, 'minimal.sld'))
    expect(sld.subarray(0, 4).toString('ascii')).toBe('SLDX')
    expect([sld.readUInt16LE(4), sld.readUInt16LE(6)]).toEqual([4, 1])
    expect([sld.readUInt16LE(16), sld.readUInt16LE(18)]).toEqual([4, 4])
    expect(sld[24]).toBe(0x01)
    expect(sld.readUInt32LE(28)).toBe(26)
    expect([sld.readUInt16LE(36), sld.readUInt16LE(38)]).toEqual([4, 4])
    expect(sld.readUInt16LE(42)).toBe(1)
    expect([...sld.subarray(44, 46)]).toEqual([0, 1])
    expect(sld.readUInt16LE(46)).toBe(0xf800)

    const unityAssets = readFileSync(join(root, 'minimal.unity.assets'))
    expect([unityAssets.readUInt32BE(8), unityAssets.readUInt32BE(12), unityAssets[16]]).toEqual([
      17, 112, 0,
    ])
    expect(unityAssets.subarray(20, 30).toString('ascii')).toBe('2021.3.0f1')
    expect(unityAssets.readUInt32LE(36)).toBe(1)
    expect(unityAssets.readInt32LE(40)).toBe(49)
    expect(unityAssets.readUInt32LE(63)).toBe(1)
    expect(unityAssets.readBigInt64LE(68)).toBe(1n)
    expect(unityAssets.readUInt32LE(80)).toBe(25)
    expect(unityAssets.readUInt32LE(112)).toBe(11)
    expect(unityAssets.subarray(116, 127).toString('utf8')).toBe('FixtureText')

    const unityFs = readFileSync(join(root, 'minimal.unityfs'))
    expect(unityFs.subarray(0, 8).toString('ascii')).toBe('UnityFS\0')
    expect(unityFs.readUInt32BE(8)).toBe(6)
    expect(Number(unityFs.readBigUInt64BE(29))).toBe(unityFs.byteLength)
    const unityInfo = 49
    expect(unityFs.readUInt32BE(unityInfo + 16)).toBe(1)
    expect(unityFs.readUInt32BE(unityInfo + 20)).toBe(unityAssets.byteLength)
    expect(unityFs.readUInt32BE(unityInfo + 30)).toBe(1)
    expect(Number(unityFs.readBigUInt64BE(unityInfo + 42))).toBe(unityAssets.byteLength)
    expect(unityFs.subarray(unityInfo + 54, unityInfo + 72).toString('ascii')).toBe(
      'cab-fixture.assets',
    )

    const unityTexture = readFileSync(join(root, 'minimal.unitytex'))
    expect(unityTexture.subarray(0, 12).toString('ascii')).toBe('MKXUNITYTEX\0')
    const unityTextureJsonBytes = unityTexture.readUInt32LE(12)
    const unityTextureHeader = JSON.parse(
      unityTexture.subarray(16, 16 + unityTextureJsonBytes).toString('utf8'),
    )
    expect(unityTextureHeader).toMatchObject({
      version: 1,
      name: 'T_Fixture',
      width: 2,
      height: 1,
      format: 4,
      mipCount: 1,
    })
    expect([...unityTexture.subarray(16 + unityTextureJsonBytes)]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128,
    ])

    const unityMesh = readFileSync(join(root, 'minimal.unitymesh'))
    expect(unityMesh.subarray(0, 13).toString('ascii')).toBe('MKXUNITYMESH\0')
    const unityMeshJsonBytes = unityMesh.readUInt32LE(13)
    const unityMeshPayload = 17 + unityMeshJsonBytes
    const unityMeshHeader = JSON.parse(unityMesh.subarray(17, unityMeshPayload).toString('utf8'))
    expect(unityMeshHeader).toMatchObject({
      version: 2,
      name: 'Mesh_Fixture',
      vertexCount: 3,
      indexComponentType: 'uint16',
      submeshes: [{ firstIndex: 0, indexCount: 3, topology: 0 }],
      segments: {
        positions: { offset: 0, byteLength: 36, componentType: 'float32' },
        indices: { offset: 36, byteLength: 6, componentType: 'uint16' },
      },
    })
    expect([
      unityMesh.readFloatLE(unityMeshPayload + 12),
      unityMesh.readFloatLE(unityMeshPayload + 28),
      unityMesh.readUInt16LE(unityMeshPayload + 40),
    ]).toEqual([1, 1, 2])

    const wem = readFileSync(join(root, 'minimal.wem'))
    expect(wem.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wem.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect([wem.readUInt16LE(20), wem.readUInt16LE(22), wem.readUInt32LE(24)]).toEqual([1, 1, 8000])

    const bnk = readFileSync(join(root, 'minimal.bnk'))
    expect([
      bnk.subarray(0, 4).toString('ascii'),
      bnk.readUInt32LE(8),
      bnk.readUInt32LE(12),
    ]).toEqual(['BKHD', 135, 42])
    expect(bnk.subarray(16, 20).toString('ascii')).toBe('DIDX')
    expect([bnk.readUInt32LE(24), bnk.readUInt32LE(28), bnk.readUInt32LE(32)]).toEqual([
      1001,
      0,
      wem.byteLength,
    ])
    expect(bnk.subarray(36, 40).toString('ascii')).toBe('DATA')
    expect(bnk.subarray(44, 48).toString('ascii')).toBe('RIFF')

    const pck = readFileSync(join(root, 'minimal.wwise.pck'))
    expect(pck.subarray(0, 4).toString('ascii')).toBe('AKPK')
    expect([
      pck.readUInt32LE(4),
      pck.readUInt32LE(12),
      pck.readUInt32LE(16),
      pck.readUInt32LE(20),
    ]).toEqual([40, 0, 0, 24])
    expect([
      pck.readUInt32LE(24),
      pck.readUInt32LE(28),
      pck.readUInt32LE(36),
      pck.readUInt32LE(40),
    ]).toEqual([1, 5678, wem.byteLength, 48])
    expect(pck.subarray(48, 52).toString('ascii')).toBe('RIFF')
  })
})
