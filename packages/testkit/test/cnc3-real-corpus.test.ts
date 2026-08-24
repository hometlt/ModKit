import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runMk2Acceptance, type Mk2CorpusEntry } from '../src/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const cncRoot = process.env.MODKITX_CNC3_ROOT
const bigSample = 'Core/1.0/Libraries.big'
const big: Mk2CorpusEntry = {
  extension: 'ea/big',
  contributionId: 'org.modkitx/big',
  corpus: 'real',
  sample: bigSample,
  minimumConfidence: 0.9,
  dataSource: 'namespace',
  operation: {
    handlerId: 'extract-entry',
    input: { entryId: '0' },
    outputKind: 'bytes',
    minimumBytes: 1,
  },
  note: 'Real C&C 3: Kane’s Wrath BIG archive; acceptance enumerates and extracts its first entry',
}

describe('installed C&C 3: Kane’s Wrath corpus', () => {
  it.skipIf(cncRoot === undefined || !existsSync(join(cncRoot ?? '', ...bigSample.split('/'))))(
    'enumerates and extracts from a real installed SAGE BIG archive',
    async () => {
      if (cncRoot === undefined) throw new TypeError('MODKITX_CNC3_ROOT is not set')
      const [outcome] = await runMk2Acceptance([big], { repoRoot, mk2Root: cncRoot })
      expect(outcome).toMatchObject({
        state: 'opened',
        confidence: 0.99,
        formatId: 'big',
      })
      expect(outcome?.dataSourceContracts).toContain('common.view/namespace-entry-source')
    },
    15_000,
  )
})
