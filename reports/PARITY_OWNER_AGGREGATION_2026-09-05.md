# Current Owner Parity Aggregation — 2026-09-05

## Result

The cross-repository parity report now binds every result to committed current-owner code and to an exact execution of the sealed MK2 oracle. The run compared all 76 corpus rows: 16 real and 60 synthetic, with 0 skipped and 0 failed.

| Verdict      | Rows |
| ------------ | ---: |
| Richer       |   48 |
| Equal        |   16 |
| Poorer       |   11 |
| Incomparable |    1 |

The receipt records 77 nonempty exact oracle executions for 76 rows. `cnc3-map` requires two exact MK2 modules. Each execution binds the oracle commit, entry point, source closure, loader and dependency digests, corpus digest, bundle digest, and `observeWorkingTree: false`.

## Immutable inputs

- MK2 oracle: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`
- `modkit-core`: `8b62f36f27a9178a8807ce7c782033caf52d6963`
- `modkit-extensions-blizzard`: `ff7a703439894eebea9b1c206fe1069bc5dae6cd`
- `modkit-extensions-ea`: `7a135611166c45b99514ce94f75256fff91a6218`
- `modkit-extensions-other`: `2c9e6ee816f02ca2acb2b8520ab276ee1065572a`
- `modkit-extensions-spring`: `132602e5684ff0fcf75df045810ecea36ad2dda4`
- `modkit-extensions-warzone`: `701157037422c50c5377c3865336753a7d5d6358`

All external owners were read through detached committed worktrees. Their logical publication identities came from `modkit.workspace.json`, so the evidence is independent of snapshot directory names. The active owner worktrees and the MK2 checkout were not executed or observed.

## Real corpus notes

The real-corpus set includes installed SC2 and CNC3 data, Warzone 2100 `base.wz`, the existing exact W3D/W3X/VXL/Emperor fixtures, and a local BAR Rapid manifest containing the exact upstream `objects3d/airbomb.s3o` asset. The BAR sample is 19,189 bytes with SHA-256 `c208233aabfd58fa83237ddf69e56c0ac29fd44c1290fee11c198be1d8fe37c2`.

## Registry closure

Before this report, `migration/registry-debt-baseline.json` contained 38 frozen parity contradictions for 19 contributions. With current contribution identities and the fresh owner evidence, the registry gate classified all 38 entries as stale and reported `known debt 0`, `new problems 0`, and `unavailable checks 0`. This change removes exactly those 38 stale entries; the baseline is now empty.

The `sc2-document-metadata` capability remains `partial`, matching its current contribution status. M5 supplies the port-ready source, tests, and surface gate; the remaining user-surface and family-closure work belongs to M7/M8.

## Evidence and verification

- `reports/parity/latest.json`: complete current report, schema version 4.
- `reports/parity/owner-aggregation.receipt.json`: owner aggregation receipt, schema `owner-parity-aggregation-2`.
- `pnpm parity`: fresh 76-row execution.
- `pnpm parity:owner:check`: verifies the report digest, immutable inputs, current repository bindings, and every exact oracle execution.
- `pnpm parity:legacy`: strict deterministic rerun against the saved report.
- `pnpm migration:check`: verifies the registry and migration state with an empty debt baseline.
- `pnpm test:migration-infra`: covers the aggregation, receipt, oracle boundary, owner identity, and migration registry infrastructure.
