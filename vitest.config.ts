import { defineConfig } from 'vitest/config'
import { ROOT_TEST_EXCLUDE, ROOT_TEST_INCLUDE } from './vitest.tiers.config.js'

export default defineConfig({
  test: {
    // The default remains the complete Vitest inventory. Named tiers provide the ordinary command
    // surface; two workers avoid the four-worker timeout contention recorded at the 1C baseline.
    fileParallelism: true,
    minWorkers: 1,
    maxWorkers: 2,
    include: [...ROOT_TEST_INCLUDE],
    exclude: [...ROOT_TEST_EXCLUDE],
  },
})
