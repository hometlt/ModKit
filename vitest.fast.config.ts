import { defineConfig } from 'vitest/config'

const blizzardRoot =
  process.env.MODKIT_BLIZZARD_ROOT === undefined
    ? '../modkit-blizzard'
    : process.env.MODKIT_BLIZZARD_ROOT.replaceAll('\\', '/')

const warzoneRoot =
  process.env.MODKIT_WARZONE_ROOT === undefined
    ? '../modkit-warzone'
    : process.env.MODKIT_WARZONE_ROOT.replaceAll('\\', '/')

export default defineConfig({
  test: {
    // This lane excludes tests that mutate shared dist output, launch product shells,
    // install packed npm artifacts, or read installed-game/legacy corpora. This curated
    // high-signal contract set is isolated and safe to schedule in parallel.
    fileParallelism: true,
    minWorkers: 1,
    maxWorkers: 4,
    include: [
      'packages/vfs/test/vfs.test.ts',
      'packages/sdk/test/contribution-specs.test.ts',
      'packages/sdk/test/subject-descriptor.test.ts',
      'packages/sdk/test/data-source-surfaces.test.ts',
      'packages/host/test/gate.test.ts',
      'packages/host/test/resolver.test.ts',
      'packages/host/test/modkit-facade.test.ts',
      'packages/host/test/subject-open.test.ts',
      'packages/host/test/data.test.ts',
      'packages/host/test/maps.test.ts',
      'packages/host/test/mods.test.ts',
      'packages/host/test/language.test.ts',
      'packages/host/test/knowledge.test.ts',
      'packages/host/test/runtime.test.ts',
      'packages/host/test/games.test.ts',
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
      `${blizzardRoot}/models/test/m3-writer.test.ts`,
      `${blizzardRoot}/starcraft2/test/subject-facts.test.ts`,
      `${blizzardRoot}/starcraft2/test/full-data-schema.test.ts`,
      `${blizzardRoot}/starcraft2/test/sc2-bank-product-ga.test.ts`,
      `${blizzardRoot}/starcraft2/test/sc2-data-language.test.ts`,
      `${blizzardRoot}/starcraft2/test/sc2-layout-language.test.ts`,
      `${warzoneRoot}/test/codec.test.ts`,
      `${warzoneRoot}/test/wz-codec.test.ts`,
      `${warzoneRoot}/test/map-provider.test.ts`,
      `${warzoneRoot}/test/language-provider.test.ts`,
      `${warzoneRoot}/test/wz-legacy-semantics.test.ts`,
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*corpus*.test.ts',
      '**/*-real.test.ts',
      '**/models/test/m3-animation.test.ts',
      '**/models/test/m3-material.test.ts',
      '**/models/test/m3-skeleton.test.ts',
      '**/testkit/test/mk2-acceptance.test.ts',
      '**/testkit/test/sc2-runtime-bounded.test.ts',
      '**/testkit/test/sc2-runtime-playable.test.ts',
    ],
  },
})
