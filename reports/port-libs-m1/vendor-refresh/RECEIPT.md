# Blizzard vendor refresh — M1, 2026-09-04

Completed after codec-kit author explicitly froze runtime, manifest and dist. Changed exactly six `modkit-extensions-blizzard/vendor/*.tgz` artifacts and Blizzard `pnpm-lock.yaml`; no Blizzard source/config edits and no core root config/lock edits by this lane. Root core lock SHA256 matched before/after all packs. Install slot was coordinated with root, used sequentially, and released after both installs and isolated checks passed.

## Verification

| Action | Exit | Result |
| --- | --- | --- |
| Direct `tsc -b packages/core packages/sdk packages/vfs packages/host packages/codec-kit packages/testkit` | 0 | build-six.log |
| `pnpm pack --pack-destination <staging>` from each of the six concrete package directories | 0 each | Six pack-*.log files; workspace dependency ranges rewritten by pnpm |
| Inspect every tarball export | 0 | 141 concrete export targets present; no node_modules bundled; pack-inspection.json |
| Blizzard `pnpm install --no-frozen-lockfile` | 0 | blizzard-install.log; pnpm 10.12.1, 7 seconds |
| Separate temporary consumer `pnpm install --no-frozen-lockfile` | 0 | standalone-install.log; pnpm 10.12.1, 4.6 seconds |
| Consumer TypeScript 5.9.3, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noPropertyAccessFromIndexSignature, **skipLibCheck=false** | 0 | standalone-typecheck.log; 57 public entrypoint imports |
| Isolated runtime imports of all six package roots | 0 | All real resolved paths stay inside the temporary install; standalone-runtime.log |
| Published crypto/compression vectors | 0 | CRC32 and SHA1 known vectors; deflate/inflate roundtrip |
| Blizzard vendor-mode smoke/inventory/TypeScript-lane suites | 0 | blizzard-vendor-smoke.log; 9/9 tests, no skips |
| Blizzard starcraft2 tsconfig noEmit check | 0 | blizzard-typecheck.log |

Fresh consumer: `C:/Users/Admin/AppData/Local/Temp/modkit-vendor-m1-Po2TPH`. It contains only its own package manifest, six copied TGZs, local overrides, TypeScript/@types/node and installed dependency closure. It has no paths alias or neighboring-core dependency. `@modkit/testkit/browser` is outside this six-package Node closure because it declares an optional @modkit/ui peer; other public non-JSON entrypoints were included. Compiler/browser libraries are present for public host/browser declarations.

Public codec-kit declaration dependencies (@logtape/logtape and the two language packages) were moved into dependencies by the P9 author before packing; fresh installation therefore verifies they are available to consumers. P9's public crypto barrel excludes the inherited broken MD5 helper retained in the canonical source; no runtime changes were made here.

## Packed files and SHA256

| TGZ | Bytes | SHA256 |
| --- | ---: | --- |
| modkit-core-0.1.0.tgz | 22399 | 92fbc403613f4ba019446d59efbf9ca39b27f591a0d1da3bf5437e3a1910c364 |
| modkit-sdk-0.1.0.tgz | 861309 | 3c28502d464b452e9cb3d0f5a315bdc686b28d505ee5c769b9e734bb36f98611 |
| modkit-vfs-0.1.0.tgz | 34015 | deb44db4a8704893ff94528e8ce6ed1b72bd5919e88cda217850881ebf66148d |
| modkit-host-0.1.0.tgz | 595489 | 2598d5834b719af32777f93cd54affe30ff6a9be5197bcb57108c7ad743bfa94 |
| modkit-codec-kit-1.0.0.tgz | 211034 | 6cd60d526ba84e0fd8758b9cafbee4568ecb0c3022445868d8d9bf434bd159af |
| modkit-testkit-0.1.0.tgz | 106617 | 78a49b7b022818c49490cec4a27085bbb620bbb4b500dbffedbf952e8c3398c1 |

Before/after hashes are also in vendor-changes.json. Pack manifests and export counts are in pack-inspection.json. No commits created. The orchestrator retains the final broad M1 gates and commit responsibility.
