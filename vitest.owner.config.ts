import { defineConfig } from 'vitest/config'
import { REAL_TEST_INCLUDE, ROOT_TEST_EXCLUDE, ROOT_TEST_INCLUDE } from './vitest.tiers.config.js'

export default defineConfig({
  test: {
    // Two workers retain useful throughput while keeping the 5 s per-test contract stable on the
    // Windows owner machine. Real browser suites run separately and cannot contend here.
    fileParallelism: true,
    minWorkers: 1,
    maxWorkers: 2,
    include: [...ROOT_TEST_INCLUDE],
    exclude: [...ROOT_TEST_EXCLUDE, ...REAL_TEST_INCLUDE],
  },
})
