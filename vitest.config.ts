import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Bundle conformance intentionally rewrites/prunes dist; running it beside package tests
    // makes module resolution depend on scheduler timing. The full gate is deterministic.
    fileParallelism: false,
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      // tooling self-tests (legacy-gate regression suite)
      'scripts/test/**/*.test.ts',
      // extension-owned tests. None exist today; the glob is here so the first one to be written
      // actually runs — a test that is silently never collected is worse than no test, because the
      // gate goes green either way.
      'extensions/*/*/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/test/fixtures/**'],
  },
})
