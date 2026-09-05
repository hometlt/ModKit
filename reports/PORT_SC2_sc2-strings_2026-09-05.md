# PORT SC2 sc2-strings — M5 port-ready handoff (2026-09-05)

## Scope and status

The M5 adapter replaces the inspection-only implementation with a strict TypeScript codec built on
the single canonical lossless SC2 strings model in `@modkit/codec-kit/legacy/xml`. The contribution
remains `partial`; network translation, injected catalog/markup resolution, language services, and
the complete M7/M8 application surface are still scheduled work.

## Implementation

- Blizzard commit `804fa5dd` adds the native adapter and contribution declarations.
- Commit `777f3813` splits the complete host write scenario into four tests that all pass under the
  ordinary timeout. No skip or timeout was added.
- Commit `638e1eda` covers set, rename, and add edit variants.
- Commit `f59a35c9` adds the executable M5 surface gate.
- The codec preserves BOM, comments, blank lines, duplicate order, values containing `=`, and each
  original line terminator. Editing returns a revision-pinned complete-source plan.
- The native surface exposes text, table, tree, and byte-range sources. It implements inspect,
  validation, raw/converted export, set/rename/add editing, catalog-reference extraction,
  caller-supplied fallback, and locale comparison.

## Exact differential evidence

- Oracle commit: `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`, loaded only through Git objects with
  `observeWorkingTree:false`.
- Closure: 70 exact source files.
- Corpus: six deterministic real localization strata plus synthetic edit/reference cases.
- Result: 14 identical cases, 0 different, 0 failed, and 0 skipped.
- Requirement proofs: 9 total: lossless line model, conversion, editing, catalog references, and the
  five operation rows for inspect, validate, references, conversion, and edit.
- Receipt: `artifacts/legacy-parity-sc2/sc2-strings/receipt.json`, SHA-256
  `851702f9764c0c05107129990ea318099d4ff4f895cf97796eb86e0e301018dd`.

Both `evidence:apply --check` and the subsequent apply accepted all 9 requirements.

## Executable surface

`pnpm surfaces:check -- --codec sc2-strings --scope m5` passed 2 files and 6 tests with zero
failed, pending, skipped, or todo tests. It proves the four data sources, eight executable native
operations, manifest declarations, installed minimal-host activation, a changed write, a
byte-identical writer no-op, and reopen.

The TypeScript project passes. Native and host tests pass 6/6 using ordinary timeouts.

## Honest remainder

The differential does not claim the complete legacy structural-detection scoring, browse filter
semantics, GameHotkeys/markup diagnostic parity, locale comparison/fallback result-shape parity,
markup rendering, translation providers, language services, descriptor parity, or git tracking.
The current validator is stricter for selected malformed markup/hotkey inputs, while locale compare
uses a native result shape; those differences remain explicit instead of being hidden in a parity
claim.

M7 owns the permissioned translation provider, catalog/markup resolver, language and VS Code
surfaces, and full editor/card/relation integration. M8 owns family closure, installed VS Code, and
the seven-application acceptance matrix.
