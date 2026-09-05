# PORT SC2 sc2-data — M5 port-ready handoff (2026-09-05)

## 1. Row and disposition

The frozen `row-sc2-data.json` contains 18 MK2 feature groups and 26 individual obligations. All
26 have an explicit destination or scoped disposition in `brief.md`. M5 executes the core codec
surface (detect/open/inspect/search/inheritance/references/validate/rename/export) and retains
`status: partial`. Entity cards, the full relation graph, field editing, project indexing, language
closure and provisioning remain scheduled for M7.

## 2. Copy and compilation

- Frozen MK2 revision: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`.
- Legacy codec size recorded by the row: 11,370 source lines.
- Exact oracle closure: 137 source files and 15 dependency packages; bundle SHA-256
  `8dabf6f23b09317253e1d0727eb1c897301b730c1857a3275db7938353322512`.
- Canonical copied roots: `starcraft2/src/lib/mk2/codecs/sc2-data`, shared
  `data-processing`, `xml`, `assets`, `core`, `entity-cards`, `language-contracts`,
  `layouts-processing`, `mods-processing`, and `scripts-processing` units recorded in
  `starcraft2/MK2-FAMILY-PROVENANCE.json`.
- `d10842fb` connected 36 copied/adapted source/config files plus the 294-line native adapter.
  Narrow changes are import relocation, one structural workspace contract, and MK3 source/context
  compatibility. No behavior divergence entry was required.
- Scoped TypeScript check and package typecheck both report 0 errors. Family copy check reports
  `{"scope":"m1-libs","files":50,"imports":97}`.

## 3. Native adapter

`starcraft2/src/sc2-data/codec.ts` exposes 9 operation declarations: inspect, search,
resolve-inheritance, references, validate, disabled compare, rename-entity, export-catalog, and
disabled entity-cards. Both runtime variants load `./dist/sc2-data/codec.js`; the contribution and
subject-kind manifests validate. The adapter preserves the existing game data, resolved data,
language and knowledge services. The old 122-line inspection-only JS codec was removed only after
the exact differential, host, surface, and regression gates passed.

The M5 edit is a schema-driven entity rename. It normalizes affected XML formatting and comments,
matching the MK2 behavior and published limitation. The no-op writer path is byte-identical.

## 4. Exact differential oracle

- Corpus: 45 real `GameData/*.xml` files, 11,762,375 bytes, plus 6 synthetic semantic cases.
- Real-file actions: detect, inspect, search, validate, and raw JSON export.
- Synthetic actions: inheritance, declared token inheritance, references, rename, full JSON export,
  and XML export.
- Result: 231 identical, 0 differing, 0 both-refused; verdict `pass`.
- Proofs: 17 (10 feature and 7 operation requirements).
- Oracle: verified, `observeWorkingTree:false`, 137 source records with 0 non-null working-tree
  observations, cache key `7e93032dc60d70995230f013055f027b8cc39ea43320ccb9887943a9dd37a028`.
- Receipt SHA-256: `f6a8cc69dd8b0ef3ec255ca407078940250f278f684c91e0b065b9e4e9571e32`.
- Legacy adapter SHA-256: `0080e9996a13258ca5df0be74af887363dac6b86096e2b66827ee9d7b0386b1a`.
- Migrated adapter SHA-256: `373d126b21bda38dbb43ae0852f10dfe899f17c44ccb9771ce0c312102316629`.

## 5. MK2 and regression tests

- Scoped sc2-data workspace: 34 passed and 1 conditionally skipped files; 281 passed and 27
  conditionally skipped tests. The executed count is 276 legacy tests plus 5 native tests.
- The 27 skips are the unchanged real-corpus conditional suite: 26 relation integration cases and
  1 mod-relations case. No skip or timeout was added or widened.
- `codec.test.ts` replaces the removed MK2 in-process `DataCodecRegistry` assertion with the actual
  codec seam; real MK3 host activation/routing has a separate native host suite.
- `content-resolver.test.ts` likewise invokes the unchanged codec seam directly because the legacy
  registry does not exist in MK3.
- Full quick tier: 60 files passed; 272 passed, 3 pre-existing conditional skips.
- `pnpm test:quick`: exit 0, including deterministic portable bundle 2/2.

## 6. Unified surface

`pnpm surfaces:check --codec sc2-data --scope m5` reports `pass`: 2 files and 7 tests. It proves
manifest validity, text/table/tree/byte-range projections, executable operations, minimal host
activation, ordinary host routing/search, and resolved writer no-op commit/reopen. This is M5
`port-ready`; full S1-S15 stays pending for M7.

## 7. Registry result

The evidence gate accepted and applied 17 requirements:

`evidence applied: 17 requirements; regenerate codec-map before migration:check`

The scoped claims gate reports 17 selected requirements, 0 selected pending and 0 problems. The
codec map was regenerated and `migration:check` exited 0. Literal integrity result:

`migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 0`

Family and project-global closure remain pending by plan. The 38 frozen debts are unrelated to this
codec and were not edited.

## 8. Commits and tree

- `d10842fb` — compile MK2 sources and native adapter.
- `4b454645` — execute legacy and native adapter suites.
- `2a689c09` — activate native M5 manifests, host and surface proofs.
- `ab046928` — retire the superseded JS codec.
- `2ef78352` — refresh family dependency provenance after `e8dda199`.

Branch: `sol/port-sc2`. Owned sc2-data paths are clean. The shared worktree contains concurrent
CASC/MPQ changes owned by another writer.

## 9. Scheduled remainder

M7 owns entity facts/cards, selector and full relation graph, field-patch editing, flatten/filter/
extract projections, derived wiki export, project index, overlay scan, language-service closure and
provisioning applicability. M8 owns full S1-S15/family closure, installed VS Code acceptance and the
seven-application matrix. There is no owner-approved loss in the M5 scope.
