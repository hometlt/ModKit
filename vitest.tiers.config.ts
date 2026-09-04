export const ROOT_TEST_INCLUDE = [
  'packages/*/test/**/*.test.ts',
  'apps/*/test/**/*.test.ts',
  'scripts/test/**/*.test.ts',
  // Core owns both flattened bundled roots and the older vendor/category/root layout.
  'extensions/*/test/**/*.test.ts',
  'extensions/*/*/test/**/*.test.ts',
] as const

export const ROOT_TEST_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-app/**',
  // Historical externalization snapshots are evidence, not executable Core owner tests.
  'migration/**',
  'scripts/test/fixtures/**',
] as const

/**
 * Real browsers and local corpora are opt-in. These patterns are subtracted from owner and run by
 * the real tier, so a failure remains visible instead of becoming a skip.
 */
export const REAL_TEST_INCLUDE = [
  '**/*corpus*.test.ts',
  '**/*-real.test.ts',
  'packages/testkit/test/mk2-acceptance.test.ts',
  'packages/testkit/test/sc2-runtime-bounded.test.ts',
  'packages/testkit/test/sc2-runtime-playable.test.ts',
  'packages/ui/test/browser-e2e.test.ts',
  'apps/web/test/edit-panel.test.ts',
  'apps/web/test/embed.test.ts',
  'scripts/test/debug-launchers.test.ts',
] as const

export const QUICK_TEST_INCLUDE = [
  'packages/vfs/test/vfs.test.ts',
  'packages/sdk/test/contribution-specs.test.ts',
  'packages/sdk/test/fields.test.ts',
  'packages/sdk/test/subject-descriptor.test.ts',
  'packages/sdk/test/data-source-surfaces.test.ts',
  'packages/host/test/gate.test.ts',
  'packages/host/test/resolver.test.ts',
  'packages/host/test/modkit-facade.test.ts',
  'packages/host/test/subject-open.test.ts',
  'packages/host/test/knowledge.test.ts',
  'packages/host/test/runtime.test.ts',
  'packages/testkit/test/reference-codecs.test.ts',
  'packages/testkit/test/text-data.test.ts',
  'packages/testkit/test/plain-text.test.ts',
  'packages/testkit/test/uvm-convergence.test.ts',
  'apps/electron/test/extension-manager.test.ts',
  'apps/electron/test/extensions-settings.test.ts',
  'apps/vscode/test/extension-manager.test.ts',
  'apps/web/test/browser-extension-manager.test.ts',
  'apps/web/test/extensions-ui.test.ts',
  'apps/web/test/managed-extension-roots.test.ts',
  'apps/web/test/managed-extension-storage.test.ts',
  'apps/web/test/managed-extensions-controller.test.ts',
] as const

const normalized = (path: string): string => path.replaceAll('\\', '/')

export function isRealTestFile(path: string): boolean {
  const file = normalized(path)
  return (
    /(?:^|\/)[^/]*corpus[^/]*\.test\.ts$/u.test(file) ||
    /(?:^|\/)[^/]*-real\.test\.ts$/u.test(file) ||
    REAL_TEST_INCLUDE.slice(2).includes(file as (typeof REAL_TEST_INCLUDE)[number])
  )
}
