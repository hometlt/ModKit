import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Empty until X3-S0.2 lands the first core primitive with its tests.
    passWithNoTests: true,
  },
})
