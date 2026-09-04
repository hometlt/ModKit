# M1 copy provenance and algorithm debt gates — 2026-09-04

0.6 completed. No runtime target files were changed by this lane. Runtime P9 author is sol_high_plan_audit; this lane owns declarations, provenance and checks. No commits or core root configuration changes.

## Actual copy result

- Pinned Git commit: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`, read through `createPinnedSource`; dirty MK2 checkout is never copied or repaired.
- `m1-libs`: 50 canonical files, 97 imports, 3 explicit authored adapter files, 8 declared dependencies including Node crypto. Two computed WASM imports are explicitly bound to texture2ddecoder-wasm; required JS and WASM bytes are hashed.
- One source has one canonical destination. SHA1 lives only at codec-kit/src/crypto/sha1.ts; MPQ crypto at crypto/mpq.ts. Compression original is compression/legacy-original.ts; its public compression/index.ts is the separate authored P9 adapter.
- pako-stub.ts is not in the actual imported closure: the pinned file is an unused reexport of genuine pako, and compression imports pako directly. P9 owner confirmed this exclusion.
- Exact source and target hashes, Git blobs, each import rewrite with before/after hashes, closure edges, dependency/adapter identities and copy date are reconstructed and compared with `packages/codec-kit/MK2-PORT-PROVENANCE.json`.
- `sc2-bank`: bootstrap declaration of 38 pinned files; full family: 1090 planned paths, with tests/fixtures routed to test/mk2. These are pending declarations, not claimed copies. Bank and full-family checks fail on incomplete closure. Omitting `--scope` also fails.
- Divergence register is empty. Future divergences require reason, MK3 contract, nonempty hashed proof files and exact bounded edits with before/after hashes. Semantic edits additionally require an owner decision. Proof hash checks establish evidence identity, not proof execution; test runners still establish the behavior.

## Verification

| Command from modkit-core | Exit | Evidence |
| --- | --- | --- |
| `node --test scripts/migration/test/mk2-copy.test.mjs scripts/migration/test/algorithms.test.mjs` | 0 | 32/32 tests, no skip; copy-algorithm-tests.log |
| ESLint over the seven new script/test files | 0 | copy-algorithm-lint.log |
| `node scripts/migration/copy-mk2.mjs --family sc2 --scope m1-libs --provenance-only` | 0 | Existing runtime bytes validated; only provenance written |
| `node scripts/migration/check-mk2-copy.mjs --family sc2 --scope m1-libs` | 0 | copy-gate-m1.log; 50 files, 97 imports |
| `node scripts/migration/check-mk2-copy.mjs --family sc2 --scope sc2-bank` | 1 expected | copy-gate-bank-pending.log |
| `node scripts/migration/check-mk2-copy.mjs --family sc2 --scope family` | 1 expected | copy-gate-family-pending.log |
| `node scripts/migration/check-mk2-copy.mjs --family sc2` | 1 expected | copy-gate-scope-required.log |
| `node scripts/migration/check-algorithms.mjs` | 0 | algorithms-check.log; 6 repositories, 51 existing debt definitions, 5 canonical definitions |

Algorithm detection uses TypeScript AST definitions, including arrow functions, object/class methods and assigned functions. Calls/imports/comments are not implementations. Tests, build output, vendor directories, reports containing versioned evidence snapshots, and archived migration/history evidence are excluded. The 52 source snapshots inspected in reports contained zero matching definitions. Scan scope is exactly core + Blizzard/EA/Other/Spring/Warzone actual repositories, never the MK2 oracle. Existing debt is explicit; new or changed implementations fail. Canonical definitions are validated against the pinned copy gate and do not count as new peer copies. Baseline writes are initial-only; `--ratchet` removes retired allowances and cannot add debt. Once committed, comparison with the Git HEAD baseline prevents manual JSON additions from blessing new debt.

Before the initial baseline commit, the SHA1/MD5 identifier families were widened to sha1*/md5*. This added only the declared canonical sha1Hex definition; existing debt stayed 51. The prior 55-definition snapshot is preserved in algorithms-baseline-before-sha-suffix.json; algorithms-sha-suffix-update.json records the hashes and sole canonical addition. The fixture verifies a new sha1Hex peer fails.

## Done files

- scripts/migration/copy-mk2.mjs
- scripts/migration/check-mk2-copy.mjs
- scripts/migration/lib/mk2-copy.mjs
- scripts/migration/test/mk2-copy.test.mjs
- migration/mk2-copy/sc2.json
- migration/mk2-divergence/sc2.json
- packages/codec-kit/MK2-PORT-PROVENANCE.json
- scripts/migration/check-algorithms.mjs
- scripts/migration/lib/algorithms.mjs
- scripts/migration/test/algorithms.test.mjs
- migration/algorithms-baseline.json

Root integration commands: `node scripts/migration/check-mk2-copy.mjs --family sc2 --scope m1-libs` and `node scripts/migration/check-algorithms.mjs`. Full-family acceptance remains a separate pending gate until M3. Ordinary copy CLI writes missing declared targets and refuses overwriting differing existing bytes; dry-run validates the declared closure without claiming actual copies.

P9 public declaration dependencies are fixed and codec-kit is frozen. The three adapter hashes were refreshed after final formatting and fixtures. Blizzard vendor refresh is recorded in vendor-refresh/RECEIPT.md. Future changes to copied source paths/rewrites or the three declared adapters require an explicit provenance refresh and gate rerun.
