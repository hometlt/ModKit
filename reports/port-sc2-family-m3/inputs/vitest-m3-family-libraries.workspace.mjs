import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineProject, defineWorkspace } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(here, '..', '..', '..').replaceAll('\\', '/')
const blizzardRoot = `${workspaceRoot}/modkit-extensions-blizzard`
const coreRoot = `${workspaceRoot}/modkit-core`

// The unchanged layout global setup launches tsx in a child process. Give that process the same
// source aliases as the Vitest projects so schema generation never falls through to absent MK2
// workspace packages.
process.env.TSX_TSCONFIG_PATH = `${blizzardRoot}/starcraft2/tsconfig.m3-family-libraries.json`

const aliases = [
  { find: '@modkit/codec-kit/legacy/assets', replacement: `${coreRoot}/packages/codec-kit/src/legacy/assets/index.ts` },
  { find: '@modkit/codec-kit/legacy/core', replacement: `${coreRoot}/packages/codec-kit/src/legacy/core/index.ts` },
  { find: /^@modkit\/codec-kit\/legacy\/semantic\/(.+)$/, replacement: `${coreRoot}/packages/codec-kit/src/legacy/semantic/$1.ts` },
  { find: '@modkit/codec-kit/legacy/sc2-support', replacement: `${coreRoot}/packages/codec-kit/src/legacy-sc2-support.ts` },
  { find: '@modkit/codec-kit/legacy/vfs', replacement: `${coreRoot}/packages/codec-kit/src/legacy/vfs/index.ts` },
  { find: '@modkit/codec-kit/legacy/xml/positional', replacement: `${coreRoot}/packages/codec-kit/src/legacy/xml/positional/index.ts` },
  { find: '@modkit/codec-kit/legacy/xml', replacement: `${coreRoot}/packages/codec-kit/src/legacy/xml/index.ts` },
  { find: '@modkitx/core/errors', replacement: `${coreRoot}/packages/codec-kit/src/legacy/core/errors.ts` },
  { find: /^@modkitx\/semantic\/(.+)$/, replacement: `${coreRoot}/packages/codec-kit/src/legacy/semantic/$1.ts` },
  { find: '@modkitx/vfs/node', replacement: `${blizzardRoot}/starcraft2/test/mk2/support/vfs-node.ts` },
  { find: '@modkitx/xml/positional', replacement: `${coreRoot}/packages/codec-kit/src/legacy/xml/positional/index.ts` },
  { find: '@modkitx/xml', replacement: `${coreRoot}/packages/codec-kit/src/legacy/xml/index.ts` },
  { find: '@modkitx/data-processing/sc2-catalog', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/data-processing/src/sc2-catalog/index.ts` },
  { find: '@modkitx/data-processing/sc2-editor', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/data-processing/src/sc2-editor-core/index.ts` },
  { find: '@modkitx/data-processing/sc2-schema', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/data-processing/src/sc2-schema/index.ts` },
  { find: '@modkitx/data-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/data-processing/src/index.ts` },
  { find: '@modkitx/documents-processing/sc2-metadata', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/documents-processing/src/sc2-metadata-core/index.ts` },
  { find: '@modkitx/documents-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/documents-processing/src/index.ts` },
  { find: '@modkitx/layouts-processing/sc2-layout/bundled-schema', replacement: `${blizzardRoot}/starcraft2/test/mk2/packages/layouts-processing/bundled-schema.js` },
  { find: '@modkitx/layouts-processing/sc2-layout/parse', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/layouts-processing/src/sc2-layout-core/simple-parse/index.ts` },
  { find: '@modkitx/layouts-processing/sc2-layout', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/layouts-processing/src/sc2-layout-core/index.ts` },
  { find: '@modkitx/layouts-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/layouts-processing/src/index.ts` },
  { find: '@modkitx/localization-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/localization-processing/src/index.ts` },
  { find: '@modkitx/maps-processing/sc2-map-core', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/maps-processing/src/sc2-map-core/index.ts` },
  { find: '@modkitx/maps-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/maps-processing/src/index.ts` },
  { find: '@modkitx/mods-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/mods-processing/src/index.ts` },
  { find: '@modkitx/replays-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/replays-processing/src/index.ts` },
  { find: '@modkitx/scripts-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/scripts-processing/src/index.ts` },
  { find: '@modkitx/archives-processing', replacement: `${blizzardRoot}/starcraft2/src/lib/mk2/packages/archives-processing/src/index.ts` },
]

const project = (name, include, test = {}) =>
  defineProject({
    resolve: { alias: aliases },
    test: { name, root: workspaceRoot, include, ...test },
  })

export default defineWorkspace([
  project('data-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/data-processing/test/**/*.test.ts']),
  project('layouts-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/layouts-processing/test/**/*.test.ts'], {
    globals: true,
    globalSetup: ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/layouts-processing/test/sc2-layout-core/bootstrap.ts'],
    setupFiles: ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/layouts-processing/test/sc2-layout-core/setup.ts'],
  }),
  project('maps-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/maps-processing/test/**/*.test.ts']),
  project('mods-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/mods-processing/test/**/*.test.ts']),
  project('documents-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/documents-processing/test/**/*.test.ts']),
  project('scripts-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/scripts-processing/test/**/*.test.ts']),
  project('localization-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/localization-processing/test/**/*.test.ts']),
  project('replays-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/replays-processing/test/**/*.test.ts']),
  project('xml', ['modkit-core/packages/codec-kit/test/mk2/xml/**/*.test.ts']),
  project('models-core', ['modkit-core/packages/codec-kit/test/mk2/models-core/**/*.spec.ts']),
  project('rendering-3d', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/rendering-3d/src/scene-core/**/*.spec.ts'], { environment: 'node' }),
  project('archives-processing', ['modkit-extensions-blizzard/starcraft2/test/mk2/packages/archives-processing/test/cache.spec.ts']),
])
