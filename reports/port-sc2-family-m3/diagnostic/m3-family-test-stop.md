# M3 family-library test STOP checkpoint

Date: 2026-09-05

Dedicated command:

`pnpm --filter @modkit/blizzard-starcraft2 test:mk2-libraries -- --reporter=json --outputFile=C:\FILES\SC2Files\coding\artifacts\legacy-parity-sc2\m3\implementation\vitest-m3-run.json`

The dedicated workspace selected 76 files and collected 651 tests. Result: 615 passed, 29
pre-existing conditional skips, 7 failed, 0 todo. No workspace timeout or hook-timeout override
was active. The older broad `starcraft2/test/vitest.mk2.config.mjs` was not used.

## Exact failures

| File | Test | Error |
| --- | --- | --- |
| `packages/localization-processing/test/semantic-facade.test.ts` | `localization semantic compatibility facade > registers, routes, and summarizes a codec without knowing which game it serves` | `localization codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |
| `packages/replays-processing/test/browser-safety.test.ts` | `browser-safe root boundary > keeps node APIs and runtime @modkitx/replay imports out of root-reachable source` | `ENOENT` scanning relocated sibling `starcraft2/test/mk2/packages/replays-processing/src` |
| `packages/replays-processing/test/semantic-facade.test.ts` | `@modkitx/replays-processing semantic facade > registers and summarizes a codec through the root exports, whatever game it serves` | `replay codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |
| `packages/maps-processing/test/semantic-facade.test.ts` | `@modkitx/maps-processing semantic facade > still registers the existing SC2 codec through legacy root exports` | `map codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |
| `packages/data-processing/test/semantic-facade.test.ts` | `@modkitx/data-processing semantic facade > registers and summarizes whatever data codec a host hands it` | `data codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |
| `packages/documents-processing/test/semantic-facade.test.ts` | `@modkitx/documents-processing semantic facade > registers and summarizes whatever document codec a host hands it` | `document codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |
| `packages/layouts-processing/test/semantic-facade.test.ts` | `@modkitx/layouts-processing semantic facade > registers, lists, and summarises whatever codec it is handed` | `layout codec: register and resolve the adapted contribution through the MK3 host` (`codec-kit/legacy-registry-unavailable`) |

All six registry failures call `new <Domain>CodecRegistry().register(codec)`, then expect `list()`
and `summaries()`. The copied processing facade exports the corresponding class from
`@modkit/codec-kit/legacy/semantic/<domain>`. Each semantic class extends
`ArtifactCodecRegistry` imported from `../assets/index.js`; that index exports the accepted M1
`packages/codec-kit/src/legacy/assets/registry-compat.ts`. Its methods intentionally throw
`codec-kit/legacy-registry-unavailable` and its source states it is compile compatibility, never
a second routing plane. Changing it would alter an accepted M1 adapter and add the common shim
forbidden by the M3 stop rule.

The replay boundary test computes `resolve(__dirname, '../src')`. Its relocated test directory is
`starcraft2/test/mk2/packages/replays-processing/test`, while the exact copied source owner is
`starcraft2/src/lib/mk2/packages/replays-processing/src`. Vite aliases cannot change filesystem
resolution performed by `node:fs`. No copied test was changed and no shadow source tree was added.

## V5 support rows

`packages/core/src/events.ts` is copied byte-exact to
`modkit-core/packages/codec-kit/src/legacy/support/events.ts` as the neutral event contract used by
the authored SC2 support adapter. The current MK3 graph has no `Emitter`/`FsReader` equivalent;
its mature `packages/vfs/src/vfs.ts::VirtualFileSystem` has a different provider/mount API.

The nine VFS files are isolated under
`modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/**`. They are exposed only by the
test-only `test/mk2/support/vfs-node.ts` barrel for four executable mods-processing tests. They
are absent from production exports and production tsconfigs. The executable archive cache suite
does not import them. The deferred archive `vfs-mount.spec.ts` imports mature
`@modkitx/vfs/providers/*` subpaths, not this test-only support unit.

| Source | Destination | Reason |
| --- | --- | --- |
| `packages/core/src/events.ts` | `modkit-core/packages/codec-kit/src/legacy/support/events.ts` | neutral event contract for the SC2 support adapter |
| `packages/vfs/src/core/directory.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/directory.ts` | test-only `FsReader`/VFS closure |
| `packages/vfs/src/core/mount.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/mount.ts` | test-only `FsReader`/VFS closure |
| `packages/vfs/src/core/path.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/path.ts` | test-only `FsReader`/VFS closure; declared import rewrite |
| `packages/vfs/src/core/provider.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/provider.ts` | test-only `FsReader`/VFS closure; declared import rewrite |
| `packages/vfs/src/core/random-access.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/random-access.ts` | test-only `FsReader`/VFS closure; declared import rewrite |
| `packages/vfs/src/core/resolver.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/resolver.ts` | test-only `FsReader`/VFS closure; declared import rewrite |
| `packages/vfs/src/core/source.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/core/source.ts` | test-only `FsReader`/VFS closure |
| `packages/vfs/src/providers/file/index.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/providers/file/index.ts` | test-only `FsReader`/VFS closure |
| `packages/vfs/src/providers/file/node.ts` | `modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs/src/providers/file/node.ts` | test-only `FsReader`/VFS closure; declared import rewrite |
