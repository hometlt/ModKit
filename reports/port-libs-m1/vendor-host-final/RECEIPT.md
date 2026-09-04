# Blizzard host vendor refresh — M1, 2026-09-04

Scope: rebuilt only modkit-core/packages/host, packed only @modkit/host, replaced only Blizzard vendor/modkit-host-0.1.0.tgz, and refreshed the Blizzard and isolated-consumer installs. No core lock, source, or commit was changed by this follow-up.

## Commands and results

| Command | Exit | Evidence |
| --- | ---: | --- |
| node ./node_modules/typescript/bin/tsc -b packages/host | 0 | host-build.log |
| pnpm pack --pack-destination staging in packages/host | 0 | host-pack.log |
| pnpm install --no-frozen-lockfile in Blizzard | 0 | blizzard-install.log |
| pnpm install --no-frozen-lockfile in existing isolated consumer | 0 | consumer-install.log |
| pnpm exec tsc -p tsconfig.json in consumer: 57 public imports; strict; skipLibCheck=false | 0 | consumer-typecheck-57-imports.log |
| node runtime.mjs in consumer: six isolated roots plus CRC32/SHA1/deflate-inflate vectors | 0 | consumer-runtime.log |
| pnpm run test:smoke in Blizzard | 0 | blizzard-vendor-smoke.log; 5/5 |
| pnpm check:pack in Blizzard | 0 | blizzard-check-pack.log; 289 files |

## Host artifact hashes

| Item | Bytes | SHA-256 |
| --- | ---: | --- |
| Previous Blizzard host TGZ | n/a | 2598d5834b719af32777f93cd54affe30ff6a9be5197bcb57108c7ad743bfa94 |
| Final staged and Blizzard host TGZ | 595491 | b8c9956cf3a6dfe41d5e14c3b461fcb84d1fcbbd496f6dfd3268f6901324b2f6 |
| Core pnpm-lock.yaml before | n/a | 5b57c180cd48afc580dc58b684e634180553a07d16d6c502182bfe3ba36d2eeb |
| Core pnpm-lock.yaml after | n/a | 5b57c180cd48afc580dc58b684e634180553a07d16d6c502182bfe3ba36d2eeb |

Final TGZ: 392 packaged dist files. All 392 source-to-packed paths matched in byte length and SHA-256; mismatches: 0. Per-file hashes: host-dist-tgz-file-hashes.json.

Only changed temporary-consumer vendor TGZ: modkit-host-0.1.0.tgz. Blizzard lockfile numstat after install: 85	6	pnpm-lock.yaml.
