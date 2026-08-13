import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      // tooling self-tests (legacy-gate regression suite)
      'scripts/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/test/fixtures/**'],
  },
})
