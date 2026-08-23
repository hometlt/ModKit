import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runMk2Acceptance, type Mk2CorpusEntry } from '../src/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const sc2Root = sc2Override ? sc2Override : 'C:\\Apps\\StarCraft II'
const ddsSample = 'Maps/all-races-coop-maps/32-CoreOfCybros.SC2Map/btn-living-conduit.dds'
const dds: Mk2CorpusEntry = {
  extension: 'mk2/common-images',
  contributionId: 'org.modkitx/dds',
  corpus: 'real',
  sample: ddsSample,
  minimumConfidence: 0.9,
  dataSource: 'raster',
  note: 'Real StarCraft II button texture from an unpacked installed map',
}
const m3Sample =
  'Maps/RustBucketYZc.SC2Map/Assets/Doodads/SpacePlatform_LandingLights_NoLensFlare/avex_SpacePlatform_LandingLights_NoLensFlare.m3'
const m3: Mk2CorpusEntry = {
  extension: 'blizzard/models',
  contributionId: 'org.modkitx/m3',
  corpus: 'real',
  sample: m3Sample,
  minimumConfidence: 0.9,
  dataSource: 'model',
  note: 'Real StarCraft II M3 model from an unpacked installed map',
}
const mpqSample = 'Maps/cnc-test.SC2Map'
const mpq: Mk2CorpusEntry = {
  extension: 'mk2/blizzard-mpq',
  contributionId: 'org.modkitx/mpq',
  corpus: 'real',
  sample: mpqSample,
  minimumConfidence: 0.9,
  dataSource: 'namespace',
  operation: {
    handlerId: 'extract-entry',
    input: { entryId: '(listfile)' },
    outputKind: 'bytes',
    minimumBytes: 1,
  },
  note: 'Real installed SC2Map MPQ; acceptance enumerates entries and extracts its listfile',
}

describe('installed StarCraft II corpus', () => {
  it.skipIf(!existsSync(join(sc2Root, ...ddsSample.split('/'))))(
    'decodes a real installed DDS texture through the product path',
    async () => {
      const [outcome] = await runMk2Acceptance([dds], { repoRoot, mk2Root: sc2Root })
      expect(outcome).toMatchObject({
        state: 'opened',
        confidence: 0.99,
        formatId: 'dds',
      })
      expect(outcome?.dataSourceContracts).toContain('common.view/raster-image-source')
    },
  )

  it.skipIf(!existsSync(join(sc2Root, ...m3Sample.split('/'))))(
    'decodes a real installed M3 model and publishes its scene',
    async () => {
      const [outcome] = await runMk2Acceptance([m3], { repoRoot, mk2Root: sc2Root })
      expect(outcome).toMatchObject({
        state: 'opened',
        confidence: 0.99,
        formatId: 'm3',
      })
      expect(outcome?.dataSourceContracts).toContain('common.view/model-scene-source')
    },
  )

  it.skipIf(!existsSync(join(sc2Root, ...mpqSample.split('/'))))(
    'enumerates and extracts from a real installed SC2Map MPQ',
    async () => {
      const [outcome] = await runMk2Acceptance([mpq], { repoRoot, mk2Root: sc2Root })
      expect(outcome).toMatchObject({
        state: 'opened',
        confidence: 0.99,
        formatId: 'mpq',
      })
      expect(outcome?.dataSourceContracts).toContain('common.view/namespace-entry-source')
    },
  )
})
