import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['apps/modkit-mcp/corpus/**/*.test.ts'],
  },
})
