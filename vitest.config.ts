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
      // Internal extension-owned tests plus the two Product-GA game repositories. Blizzard and
      // Warzone are deliberately outside this repository; their paths may be overridden for CI.
      'extensions/*/*/test/**/*.test.ts',
      process.env.MODKIT_BLIZZARD_ROOT === undefined
        ? '../modkit-blizzard/*/test/**/*.test.ts'
        : `${process.env.MODKIT_BLIZZARD_ROOT.replaceAll('\\', '/')}/*/test/**/*.test.ts`,
      process.env.MODKIT_WARZONE_ROOT === undefined
        ? '../modkit-warzone/test/**/*.test.ts'
        : `${process.env.MODKIT_WARZONE_ROOT.replaceAll('\\', '/')}/test/**/*.test.ts`,
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/test/fixtures/**'],
  },
})
