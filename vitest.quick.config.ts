import { defineConfig } from 'vitest/config'
import { QUICK_TEST_INCLUDE, ROOT_TEST_EXCLUDE } from './vitest.tiers.config.js'

export default defineConfig({
  test: {
    // Quick is deliberately isolated: the default 5 s timeout stays meaningful instead of being
    // stretched to compensate for concurrent import/package work.
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
    include: [...QUICK_TEST_INCLUDE],
    exclude: [...ROOT_TEST_EXCLUDE],
  },
})
