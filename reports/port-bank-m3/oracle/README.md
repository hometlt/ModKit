# SC2 bank M2 oracle inputs

`discovery.json` records the immutable MK2 pin, all 12 pinned legacy suites, exact
`fast-xml-parser@4.5.6`, the one pinned 696-byte real fixture, and discovery results. The
manifest includes all 38 eligible `.SC2Bank` paths found under the explicit Documents Banks
directory. It records paths, byte sizes, and SHA-256 values only; no user bank bytes are copied
into this artifact tree.

Generate the operation-specific manifests with:

```powershell
node artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/build-sc2-bank-corpus.mjs
```

Each generated manifest is `mixed`: the 38 real files, the pinned real fixture, and targeted
synthetic XML for typed values, custom nodes, UTF-8 text, unknown patch target, and missing
signature identity. The positive pinned fixture is the proof case for each legacy operation.
Refusal cases are retained to compare refusal behavior; a successful receipt may not be based
solely on them. `corpus/negative/*-malformed.json` is separate: the native codec intentionally
rejects malformed XML that the permissive MK2 parser accepts, so that asymmetric result stays
visible and cannot be used as evidence.

The legacy patcher returns `{ ok: false, reason }`, while the native edit-plan contract refuses a
failed patch. Both parity adapters normalize that transport difference to `PATCH_REFUSED` with the
original reason; successful patches retain the original `{ ok, xml, changed }` shape.

`sc2-bank-legacy-adapter.mjs` uses `createPinnedSource` and `loadMk2` only. Its cache identity
includes the requested operation, exact corpus JSON, the adapter as a loader file, the pin,
fixture, and dependency closure. It rejects a changed real corpus byte stream before invoking
legacy code.

After the native adapter is available, invoke the generated M1 scaffold with its explicit paths:

```powershell
node artifacts/legacy-parity-sc2/compare-legacy-sc2-bank.mjs --legacy artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/sc2-bank-legacy-adapter.mjs --migrated <native-adapter.mjs> --corpus artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/corpus/view.inspect.json --operation view.inspect --receipt artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/receipts/view.inspect.json
```

Repeat for `asset.validate`, `edit.content`, `source.save-as`, `export.raw`, and `save.sign`.
`blizzard/sc2-bank.verify` is a public-library parity probe, outside the six legacy manifest
operation requirements. Do not run `evidence:apply` until the native adapter, published
contribution, handler IDs, and receipt proofs have all been verified.
