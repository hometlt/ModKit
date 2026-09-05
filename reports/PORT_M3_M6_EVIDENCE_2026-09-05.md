# M3 M6 port evidence — 2026-09-05

## Result

M6 preserves the richer MK3 M3 decoder and renderer while adding the bounded legacy compatibility and authoring slices. No second renderer was introduced and the existing JavaScript implementation remains canonical.

The executable evidence is green: 83 exact pinned MK2 tests, 14 scoped surface tests, and 34 real-tier tests passed with zero failures, skips, pending cases, or todos. Three Core-schema differential receipts add 12 identical cases: six `model.read`, five `model.export`, and one `model.write`.

C7 is deliberately partial. Eight of 22 ledger requirements now have executable Core-schema proof and are applied to the Core ledger; 14 requirements remain pending for M7/M8. This report does not claim full M3 ledger or family closure.

## Immutable inputs and commits

- Exact MK2 Git object pin: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`.
- MK2 source was loaded through Git ODB with `observeWorkingTree: false`.
- `47e324ac089ee02b08823bbda95c3b95d424fa3a` — executes the exact pinned MK2 codec suites.
- `587a1dbb350b02081aea6a8ac28d7720165af348` — publishes bounded semantic `model.write` while retaining richer MK3 behavior.
- `06ce84f3aa28f1ee7ba81e9cd614181dda89d618` — shared M6 scoped surface harness.
- `72757b314ab0a06fcef3a289253f7043fb0549c0` — correct M6 receipt labeling.
- `f7fd78a199a86dd95a69ea5215832193d9234031` — Core verifies `observeWorkingTree: false` prepared-oracle identities and reads the exact Git ODB.

The scope was cross-checked against `artifacts/legacy-parity-sc2/m3/brief.md`, `artifacts/legacy-parity-sc2/step1-rows/row-m3.json`, and the current Core feature ledger. They agree on 18 feature rows and four operation rows.

## C0–C8 status

| Gate | Status | Evidence |
| --- | --- | --- |
| C0 | pass | Mandatory instructions and sources read from exact MK2 Git objects; pin recorded in every executable receipt. |
| C1 | pass | Package-local source/test closure and 18 exact copied test files are bound by hashes and pinned source/test tree objects. |
| C2 | pass | Compatibility surface added around the richer current decoder/renderer without replacing either. |
| C3 | pass | Exact MK2 suite: 18 files, 83 tests passed, zero skip. |
| C4 | pass | Real ODB differential: read 6/6 and export 5/5; synthetic authoring differential: write 1/1. |
| C5 | pass | `model.write` is published by `models/contributions/codec-m3.json` as handler `model-write`. |
| C6 | pass | M6 scoped surfaces: three files, 14 tests passed, zero skip. |
| C7 | partial | Three receipts applied eight exact requirements to Core; the scoped ledger gate reports eight selected requirements, zero selected pending and zero problems. |
| C8 | pending | 14 requirements still need feature-specific executable proof in M7/M8; `model.render` is the unproved operation row. |

## Executable receipts

| Receipt | Result | SHA-256 |
| --- | --- | --- |
| `m6/oracle/receipts/model.read.json` | real, 6 identical, 0 different, 3 requirements | `75eb70647f925e5ebbc783a125d89fd9cee0218bc1829fe31f42df198e20e5b3` |
| `m6/oracle/receipts/model.export.json` | real, 5 identical, 0 different, 3 requirements | `db84d603a46c2bf45a80f5cd7dfcbd7f05b4f398f7a3b8aae4315a388d249eb0` |
| `m6/oracle/receipts/model.write.json` | synthetic, 1 identical, 0 different, 2 requirements | `e4dd2ef874fd120be9d43f36220377f92d6ebacd803201d65b89d33015a1da9f` |
| `m6/tests/legacy/receipt.json` | 18 files, 83 passed, 0 skip | `bbbf103f30cf7ffc095ac0c24800729a7380677b5a051388905a010585d6ca8e` |
| `m6/tests/real/receipt.json` | 4 files, 34 passed, 0 skip | `3ca4adda206939764236e460dd5ab4c0d2c5147ad0ef524991dec34240b04e69` |
| `surfaces/receipt.json` | 3 files, 14 passed, 0 skip, run `be86e04f-195e-4dcf-a6d5-9c4e64fb1d9b` | `118c34c608a9dc239f4892424ce8f57519f2408ebc77e2611d4cae7c4cd1afcf` |

The two real differential receipts embed verified prepared-oracle metadata, source closure, loader snapshots, pinned fixture bytes, runtime dependency snapshots, bundle hashes, and exact operation identity. The M3A case decodes the committed `.b64` carrier before invoking both codecs.

## Commands

From `C:/FILES/SC2Files/coding`:

```powershell
node artifacts/legacy-parity-sc2/m3/m6/run-test-evidence.mjs
node artifacts/legacy-parity-sc2/m3/m6/verify-core-sequential.mjs

node artifacts/legacy-parity-sc2/m3/m6/oracle/run-differential.mjs --legacy artifacts/legacy-parity-sc2/m3/m6/oracle/m3-legacy-adapter.mjs --migrated artifacts/legacy-parity-sc2/m3/m6/oracle/m3-native-adapter.mjs --corpus artifacts/legacy-parity-sc2/m3/m6/oracle/corpus/model.read.json --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.read.json --operation model.read

node artifacts/legacy-parity-sc2/m3/m6/oracle/run-differential.mjs --legacy artifacts/legacy-parity-sc2/m3/m6/oracle/m3-legacy-adapter.mjs --migrated artifacts/legacy-parity-sc2/m3/m6/oracle/m3-native-adapter.mjs --corpus artifacts/legacy-parity-sc2/m3/m6/oracle/corpus/model.export.json --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.export.json --operation model.export

node artifacts/legacy-parity-sc2/m3/m6/oracle/run-differential.mjs --legacy artifacts/legacy-parity-sc2/m3/m6/oracle/m3-legacy-adapter.mjs --migrated artifacts/legacy-parity-sc2/m3/m6/oracle/m3-native-adapter.mjs --corpus artifacts/legacy-parity-sc2/m3/m6/oracle/corpus/model.write.json --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.write.json --operation model.write
```

From `C:/FILES/SC2Files/coding/modkit-core`:

```powershell
pnpm evidence:apply -- --check --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.read.json
pnpm evidence:apply -- --check --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.export.json
pnpm evidence:apply -- --check --receipt artifacts/legacy-parity-sc2/m3/m6/oracle/receipts/model.write.json
```

The three read-only checks exited 0 and validated three, three, and two requirements respectively. The orchestrator then applied them in that order, regenerated the codec map and ran `migration:check` successfully. `workspaceRoot` is `C:/FILES/SC2Files/coding`, so the `artifacts/...` receipt paths are confined inputs even though the command runs from `modkit-core`.

`m6/core-sequential-check.json` records a second no-write check that applies all three receipts in memory in the intended order. Its resulting state is exactly eight `adapted` M3 rows and 14 `pending` rows.

## Exact C7 mapping

The machine-readable mapping is `artifacts/legacy-parity-sc2/m3/m6/requirement-mapping.json` (22 unique rows: eight `c7-apply-ready`, 14 `pending-executable-proof`). Current apply-ready rows are:

- features `1f235e68cd31c2fa`, `3664f80d62a5dfcd`, `b2a1b78ef3e1041d`, `b5d28d944cda398d`, `dfad1b27ebd848e8`;
- operations `model.read`, `model.export`, `model.write`.

The 14 pending rows have meaningful supporting tests where available, but test receipts and the scoped surface receipt are not substituted for Core-schema differential proof. They remain pending until their own executed cases can be applied.

## M7/M8 work

M7 owns the visible and host-driven slices: publish and execute `model.render`; prove material, animation, effect, vertex/bone/texture decoding in renderer-visible corpora; prove byte/structural editor mutation with reopen and undo; prove real M3/M3A sidecar discovery through `ResourceSessionPort`.

M8 owns family closure: browser/runtime split and embedded structures execution, standalone M3A shape, exhaustive metadata builder families, schema/config coverage, complete ModelCodec capabilities, broader real corpora, installed host validation, and the final feature-ledger/codec-closure checks.

## Core result

The three receipts are applied. `reports/port-m3-m6-evidence/claims.json` selects exactly those eight rows; the scoped gate reports zero selected pending and zero problems. The other 14 rows remain pending until their executable receipts exist.
