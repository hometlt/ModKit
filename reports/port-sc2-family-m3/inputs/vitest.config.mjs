import { defineConfig } from 'vitest/config'

const tier = process.env.MODKIT_TEST_TIER ?? 'quick'
const stagingExcludes = ['starcraft2/test/mk2/**', 'models/test/mk2/**']
const tiers = {
  quick: {
    corpus: '0',
    exclude: [
      ...stagingExcludes,
      '**/*-corpus.test.ts',
      'galaxy-language/test/semantic-provider.test.ts',
      'models/test/m3a-corpus-audit.test.ts',
      'mpq/test/native-preserving-workflow.test.ts',
      'test/integration/**/*.test.ts',
    ],
    timeout: 120_000,
  },
  owner: {
    corpus: '0',
    exclude: [
      ...stagingExcludes,
      '**/*-corpus.test.ts',
      'models/test/m3a-corpus-audit.test.ts',
      'mpq/test/native-preserving-workflow.test.ts',
      'starcraft2/test/sc2-map-world-writer.test.ts',
      'test/integration/sc2-runtime-catalog-real.test.ts',
      'test/integration/sc2-triggers-c2-real.test.ts',
    ],
    timeout: 180_000,
  },
  real: {
    corpus: '1',
    exclude: stagingExcludes,
    include: [
      'models/test/m3-animation.test.ts',
      'models/test/m3-material.test.ts',
      'models/test/m3-skeleton.test.ts',
      'models/test/m3a-corpus-audit.test.ts',
      'mpq/test/native-preserving-workflow.test.ts',
      'starcraft2/test/**/*-corpus.test.ts',
      'starcraft2/test/sc2-map-world-writer.test.ts',
      'test/integration/sc2-runtime-catalog-real.test.ts',
      'test/integration/sc2-triggers-c2-real.test.ts',
    ],
    timeout: 180_000,
  },
}
const selected = tiers[tier]
if (selected === undefined) throw new Error(`unknown MODKIT_TEST_TIER: ${tier}`)

process.env.MODKIT_TEST_INSTALLED_CORPUS = selected.corpus

export default defineConfig({
  test: {
    include:
      selected.include ?? [
        'casc/test/**/*.test.ts',
        'galaxy-language/test/**/*.test.ts',
        'models/test/**/*.test.ts',
        'mpq/test/**/*.test.ts',
        'starcraft2/test/**/*.test.ts',
        'test/integration/**/*.test.ts',
      ],
    exclude: selected.exclude,
    fileParallelism: true,
    testTimeout: selected.timeout,
    hookTimeout: selected.timeout,
  },
})
