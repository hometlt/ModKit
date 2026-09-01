import { defineConfig } from 'vitest/config'
import { REAL_TEST_INCLUDE, ROOT_TEST_EXCLUDE } from './vitest.tiers.config.js'

export default defineConfig({
  test: {
    // Each browser/corpus case owns its process and temporary output. Run every case, but never
    // overlap them or turn an unavailable local dependency into a silent skip.
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    include: [...REAL_TEST_INCLUDE],
    exclude: [...ROOT_TEST_EXCLUDE],
  },
})
