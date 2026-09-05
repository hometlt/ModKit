# PORT SC2 sc2-document-metadata — M5 port-ready handoff (2026-09-05)

## Scope and status

The codec now uses the authoritative SC2 metadata implementation for `DocumentHeader`,
`DocumentInfo`, and `.version` sidecars. Its contribution remains `partial`: M5 proves the native
codec, operations, editing path, and minimal host surface, while the complete M7 viewer/editor and
M8 application matrix remain pending.

## Implementation

- Blizzard commits `723614d5`, `a36af63c`, and `65819b2d` replace the heuristic implementation
  with strict TypeScript, compile the five metadata-core units, publish the subject kind, and cover
  the native and native-host paths.
- Commit `ff7a7034` adds the executable M5 surface profile.
- The runtime contribution loads `starcraft2/dist/sc2-document-metadata/codec.js`; the old
  `codec.js` is only a forwarding shim.
- Operations are `view.inspect`, `asset.validate`, `export.raw`, `export.convert`, and
  `edit.content`. Dependency replacement returns a revision-pinned edit plan; the host performs the
  permissioned commit.
- The contribution intentionally reports `status: partial`. Core capability metadata was aligned
  with that status in `d685d33f`.

## Exact differential evidence

- Oracle commit: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`, loaded only through Git objects with
  `observeWorkingTree:false`.
- Closure: 10 exact source records, two captured dependency packages, no working-tree observation.
- Corpus: mixed, with real `DocumentHeader`, `DocumentInfo`, and `.version` files plus synthetic
  dependency edits and the empty-version case.
- Result: 14 identical cases, 0 different, 0 refused, 0 failed, and 0 skipped.
- Requirement proofs: 14 total: 9 feature rows and all 5 operation rows.
- Authoritative receipt:
  `artifacts/legacy-parity-sc2/sc2-document-metadata/evidence-receipt.json`, SHA-256
  `e2c83fc7a5cfc3c391c650168cf14df6bb23c7d0cf255108aca440831bdf74df`.

`evidence:apply --check` and the subsequent apply both accepted all 14 requirements.

## Executable surface

`pnpm surfaces:check -- --codec sc2-document-metadata --scope m5` passed 2 files and 6 tests with
zero failed, pending, skipped, or todo tests. The receipt proves tree and byte-range data sources,
the five handlers, manifest declarations, installed minimal-host activation, changed dependency
commit/reopen, and a byte-identical no-op commit/reopen.

The copied exact MK2 core suites report 32 passed and one pre-existing conditional skip. The new
native suites report 6/6 passed. TypeScript compilation succeeds.

## Registry and remaining work

The scoped claims file contains exactly the 14 applied requirement IDs. Complete MK2 transaction
API parity, downstream `@modkitx/export` delegation, full descriptor/viewer surfaces, and
`source.save` are not claimed. M7 owns the complete tree/property editor and application surfaces;
M8 owns family closure, installed VS Code, and the seven-application acceptance matrix.

After the owner aggregation cleanup, the registry tuple before applying this receipt was
`known/new/stale/unavailable = 0/0/0/0`. The receipt does not introduce an owner decision or known
loss.
