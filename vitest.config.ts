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
      // The core suite owns only core packages, applications, tooling and bundled extensions.
      // External repositories run their own suites from their resolved workspace composition.
      'extensions/*/*/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/test/fixtures/**'],
  },
})
