# PORT SC2 Galaxy — M5 port-ready handoff (2026-09-05)

## Result

Galaxy now has a strict TypeScript MK3 codec backed by the exact pinned MK2 scanner, parser,
binder, full type checker, printer, language service, workspace index, store, AST factory and
Engine AST lowering. The contribution remains `partial`: runtime execution belongs to
`sc2-runtime`, while Trigger-to-Galaxy and final language publication remain scheduled work.

The port preserves the richer existing `galaxy-language` provider, including its generated 3,341
function native catalog, hover, signature, definition, references, rename, document/workspace
symbols, formatting, diagnostics and SC2 mixed-workspace links. The existing
`semantic-converter-core.js` remains in place because its C6 retirement conditions were not
claimed.

## Commits

- `70b93473` — activate the exact-pin Galaxy semantic core and strict native codec.
- `9ff553bd` — preserve legacy `export.convert` AST printing and expose Engine AST as the separate
  `blizzard/galaxy.to-engine` producer.
- `1ab645a0` — prove native data sources, executable operations, installed-host activation and the
  resolved writer no-op commit/reopen path.
- `516450da` — install and pass the authoritative `galaxy:m5` scoped surface profile.

## Native surface

The partial contribution publishes the eight legacy operations plus `export.raw` and
`blizzard/galaxy.to-engine`. `export.convert` returns printed Galaxy bytes. The Engine AST operation
returns producer data and fidelity only; the Galaxy codec does not import or invoke runtime.

The C5 suite executes `view.inspect`, observes text, tree and byte-range data-source contracts, and
releases every lease. The host suite activates the compiled installed contribution, routes a real
Galaxy source, validates it, resolves the shared authored-text writer, commits a byte-identical
no-op and reopens the source.

## Exact oracle and corpus

- MK2 pin: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`.
- Access mode: Git ODB only, `observeWorkingTree: false`.
- Prepared exact modules: 8 (`source`, `language-service`, `to-engine`, `language-core`, `reader`,
  `store`, `workspace-index`, `ast-factory`).
- Corpus: 11 real files and 3 synthetic files. Real strata are the Tiberium mission MapScript,
  the sorted first eight tib-data Galaxy libraries, NativeLib.galaxy and NativeLib_h.galaxy.
- Differential result: 89 identical cases, 0 different, 0 failed, 0 skipped.
- Requirement proofs: 24, including all eight published legacy operations.
- Receipt SHA-256: `4ae4d4fec1562e96f9744211b9a4c0be757de0ee29f311e9ddf151e3ef96de68`.
- Receipt generator SHA-256: `2435d04f191744296e4776c802986762a06ac33aa27134b60a596d2513be63e5`.

The generated browser ESM bundle is 4,790,567 bytes, imports successfully, exposes ABI 1 and
`createCodec`, and contains no Node builtin or `sc2-runtime` import. Its SHA-256 is
`adb20ae437836ba543c67839d301e9c4983708b711e02ff5e9793d244a0b9779`.

## Verification

- Galaxy TypeScript compilation: exit 0.
- Native adapter: 4/4.
- Installed host and writer: 2/2.
- Exact pinned reader/language/store/workspace/Engine AST/factory suites: 37/37.
- Preserved richer provider and native-catalog regressions: 10/10.
- Authoritative scoped surface gate: 2 files, 6/6 tests, 0 pending/skipped/todo.
- `evidence:apply --check`: exit 0, 24 requirements validated.

No test uses an explicit timeout, skip, conditional skip or weakened gate.

## Remaining work

M7/M8 retain Trigger-to-Galaxy, trigger/catalog metadata injection, the batch filesystem checker,
the Trigger fallback audit, full context-scored legacy detection, shared identity consolidation,
legacy descriptor catalog/dependency extras and final language entrypoint publication. Those eight
requirements are listed in the receipt and are not claimed by this M5 handoff.
