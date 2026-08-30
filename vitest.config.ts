import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Bundle conformance builds in memory and never rewrites dist, so ordinary suites remain safe
    // to schedule in parallel.
    fileParallelism: true,
    minWorkers: 1,
    maxWorkers: 4,
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
