# SC2 localization parity audit — 2026-09-22

## Handoff

Bounded source fixes are complete. No plugin packaging, full integration rebuild, user VS Code changes, or live translation calls were performed. Main owns the final build/package. Evidence below precedes that build; no subsequent integration success is claimed.

**Codec boundary blocker fixed:** `network` and `credentials` were removed from both runtime variants in `starcraft2/modules/strings/codecs/strings/codec.json` and from the translation operation there and in `codecs/strings/src/codec.ts:101`. Translation still requests the existing host-resolved `common.language/translation` service (`codec.ts:1038`), with provider availability checked separately (`codec.ts:1253`). No ambient codec network/credential authority or direct network implementation was added. Hosts unable to resolve the provider must report translation unavailable; live provider operation remains unverified. The forbidden permissions were present when inspected, not introduced by this pass.

`node scripts/check-codec-provider-split.mjs` reports `codec/provider split: valid`, including the last read-only checkpoint. The four boundary tests also passed. There is no remaining source-manifest network/credentials blocker from this work; regenerated artifacts and final installed-host behavior still require main's build verification.

## Scope and evidence limits

- Core edits are limited to `packages/ui` and this report. No `packages/code`, app registration, host, SDK, Data, model-projection-cache, scene, or UI-world files were changed by this pass.
- Blizzard edits are limited to Strings source/manifest and localization tests. Style source was inspected and tested, not edited.
- Dirty baseline changes were preserved. In particular, Strings language/provider/workspace changes, other resolver changes, and Style changes belong to pre-existing/concurrent work. Do not attribute the entire dirty-tree diff to this audit.
- Root/parent and scoped instruction searches found no root `PROMPT.txt`. Discovered MK2 instructions and the Strings core `PROMPT.md` were read; the MK2 documentation-index path referenced by its instructions was absent. The knowledge graph was tried for structural discovery; insufficient/stale entries were supplemented with direct source inspection.
- MK2 was read only. No supplied screenshot fixture was available or found in the relevant reference search, so this establishes **source feature parity evidence**, not screenshot/pixel parity.
- Only source inspection and synthetic loose-mod fixtures were used. No real game files, archives, CASC, or private game/package APIs were inspected.
- The codebase-memory, minimal-change ponytail, and SC2 inspection skills informed discovery, reuse of existing contracts, and the source/fixture-only verification boundary. No parallel model, markup parser, resolver, or translation provider was introduced.

Paths below are relative to the named repository. Line numbers reflect the inspected working tree and may move with concurrent integration.

## Actual route and ownership

1. Core `packages/ui/contributions/viewer-localization-table-stage.json` selects localization subjects with available `game.localization` and `table.cells`, consuming `common.view/table-data-source` at priority 410. The actual VS Code registration is `apps/vscode/src/stages.ts:208`, mounting `createTableViewer` at line 211.
2. **Current app-route save gap:** that registration has neither `editable` nor `usesEditorPorts`. `packages/ui/src/explorer/preview.ts:315` supplies save ports only when one is true; authorization is forwarded at line 327. Thus the inspected localization route cannot save inline edits even though the shared table supports them when given ports. This needs the app owner; no out-of-scope registration was changed or authority bypassed.
3. Shared table editing calls `mountInlineField` (`packages/ui/src/table/index.ts:287`), owned by `packages/ui/src/field-write/index.ts:209`. Its existing `commitOperationWrite` at line 148 requests authorization at line 169 and prepares a coordinated write at line 171. Strings `edit-field` (`codec.ts:1147`) routes to `planFor` at line 718 and the existing binding/edit-plan machinery, preserving the canonical ordered Strings model and sibling-locale source targeting.
4. The table renders the codec's table data source (`codec.ts:393`). Its preview helper (`codec.ts:155`) resolves plain text with `EMPTY_RESOLVER`; it does not acquire GameData or render the rich HTML operation into each locale cell.
5. `catalogResolverOf` (`codec.ts:301`) adapts an explicitly supplied catalog/style snapshot through the existing shared `starcraft2/shared/language/catalog-resolver.ts:79`. It is not automatic resolved-workspace/Data integration. Styles continue through `starcraft2/modules/style/shared/font-styles.ts:107`, `:290`, and `:301` for snapshot creation, style resolution, and CSS.
6. Core forwards optional workspace documents (`packages/ui/src/explorer/preview.ts:357`), but the table does not consume them for in-cell language requests. Monaco and the existing language bridge live at `packages/code/src/editor.ts:162` and `packages/code/src/language-bridge.ts:47`; neither was edited. Strings language-provider completion exists at `providers/language/src/language.ts:431`, with catalog assembly at line 345. That source-document context is not proof of a shared dependency-ordered resolved Data lease in the table.

## Proven defects fixed

| Defect | Bounded fix and evidence |
| --- | --- |
| Codec requested provider-owned network/credential authority | Removed those grants from both codec runtimes and translation operation; source descriptor uses only `read-source` (`codec.ts:101`). Boundary gate and regression assertion pass. |
| Multiple codec activations shared mutable translation service context | Codec definition now closes over its activation's contribution (`codec.ts:657`, `:1280`). Two-codec fake-provider test proves isolation (`test/translate.test.ts:206`). |
| Translation placeholder validation accepted duplicates, unknown IDs, or reordering | Compare the exact returned marker sequence with the protected sequence (`codec.ts:1072`); refuse unsafe output and retain original text. Fake-provider tests cover missing/duplicate/unknown/reordered markers and lease release. |
| Literal rich markup could not render without GameData; styles-only payload was unusable | Render operation permits literal markup with the existing empty resolver, accepts existing styles-only snapshot resolution, strips translator notes, and selects a bound locale (`codec.ts:955`). Catalog-dependent refs still explicitly require a resolver. Regression at `test/adapted.test.ts:220`. |
| Bound locale fallback required callers to rebuild an entries map | `resolve-fallback` accepts an existing bound `variant`/`locale`, retaining the caller-supplied entries form and primary-first behavior (`codec.ts:1090`). Unknown locale rejects; selected-locale rendering and fallback regression at `test/locales.test.ts:279`. |
| A quoted style name could escape its HTML class attribute | Use `escapeAttr` rather than text-only escaping (`shared/core/render-html.ts:176`). Regression at `test/core/resolve.test.ts:233`. Only this escaping line is this pass's renderer change; other renderer diff was pre-existing. |
| Variant-table syntax spans were opt-in and stale async highlights could overwrite current display | Default highlighting for variant tables (`core packages/ui/src/table/index.ts:378`), with detached/edited/value-mismatch guards at line 392. This is lazy display highlighting, not syntax highlighting inside the editor. |
| Cell editor lifetime allowed duplicate mounts/commits and leftover cancelled handlers | Track/dispose active inline edits, recheck after async cell lookup, serialize finish, and focus the current control (`table/index.ts:156`, `:310`). Escape/reopen/Enter browser regression verifies only the current accepted edit writes. |
| Translation batches could overlap; unchanged results could be offered for write | Serialize translation, disable the button while running, reset it in `finally`, respect cancellation between items, and exclude `changed:false` from Apply (`table/variants.ts:451`, `:506`). Configured delayed fake-provider browser test verifies review before commit. |
| Row actions could write after the pinned session became stale | Serialize row writes and use the table's existing stale refusal (`table/variants.ts:290`, `table/index.ts:444`). Browser test confirms a second write is refused until session reopen. |

The translation result contract supplies `changed`, not a provider refusal-reason field. This pass does not claim to propagate a nonexistent field; it respects unchanged results and separately retains codec-generated unsafe-markup refusal text.

## MK2 source evidence and remaining parity gaps

Reference root: `references/modkitmk2`.

| Feature | MK2 evidence | Current implementation / remaining work |
| --- | --- | --- |
| Locale table and rendered preview | `apps/modkit-vscode/README.md:33`; `src/strings-editor.ts:1380` builds rows, line 1389 renders HTML; line 1903 switches raw/rendered cells | Shared locale table/search/status/group filtering exists. Current codec offers one base-locale plain Preview column, not MK2 rich per-locale cells, raw/render toggle, images, and locale-aware style rendering. No full UI parity implemented. |
| In-cell syntax/completion/validation | README line 36; `strings-editor.ts:2578` highlight overlay, `:2621` edit control, `:2796` completion/validation; completion handler around line 333 | Shared scalar inline editor plus lazy display spans only. No completion popup or in-edit syntax overlay/Monaco binding in localization cells. Actual app save-port registration is also missing as described above. |
| Shared GameData and d-ref resolver | `strings-editor.ts:168` lazily loads the mod via line 173 and locale-specific resolver at lines 174/177; completion at line 333 uses that context | Explicit supplied snapshot resolution is supported and tested, including nested refs. The table does not request a resolved Data snapshot/lease; real dependency/provenance and automatic d-ref preview/completion parity remain unverified/missing. Must coordinate with Data/app owners rather than add a parallel parser. |
| Translation workflow | `strings-editor.ts` translation handler around line 651, empty targets around line 698, review before saving around line 813 | Existing configured-service translation and reviewed set-many workflow retained and hardened. Fake service lifecycle verified. Live provider, provider authority across the real host boundary, and installed UI end-to-end translation are unverified. If unavailable under allowed authority, report unsupported rather than widen codec grants. |
| Styles and locale fallback | MK2 locale resolver at lines 174/177, rendered rows at line 1389, preview-note stripping at line 1405 | Shared Style-owned CSS and literal/styles-only render work under fixtures. Bound fallback operation now works without copied entries. No full dependency-ordered locale fallback/provenance UI, missing-locale creation workflow, or rich table integration claimed. Raw missing values remain missing rather than being silently filled and mistaken for translations. |

Main integration subsequently wired authorized editor ports and `onCommitted → reopen` into the actual VS Code localization stage and added a focused adapter test. The stage remains visible for read-only subjects. The focused localization-stage/view-policy run passed 9/9; installed SC2 Strings codec selection still fails separately as described below.

## Exact files changed by this pass

Core:

- `packages/ui/src/table/index.ts`
- `packages/ui/src/table/variants.ts`
- `packages/ui/test/table-variants.test.ts`
- `docs/AUDIT_SC2_LOCALIZATION_2026-09-22.md` (this report)

Blizzard:

- `starcraft2/modules/strings/codecs/strings/codec.json`
- `starcraft2/modules/strings/codecs/strings/src/codec.ts`
- `starcraft2/modules/strings/shared/core/render-html.ts` — only the style-class attribute escaping line; preserve the pre-existing renderer refactor.
- `starcraft2/modules/strings/test/translate.test.ts`
- `starcraft2/modules/strings/test/locales.test.ts`
- `starcraft2/modules/strings/test/adapted.test.ts`
- `starcraft2/modules/strings/test/core/resolve.test.ts`

Core's three changed TypeScript files were formatted with Prettier. `table/index.ts` had mixed line endings, so its ordinary diff includes normalization; use `git diff --ignore-space-at-eol` to inspect substantive edits. No other dirty file is part of this handoff.

## Tests and outputs

All commands below completed before the final user interruption/checkpoint. No interrupted or unobserved run is counted as passing, and no long runs were launched after the stop request.

### Core browser/shared write tests

Run in `modkit-core`:

```text
pnpm exec vitest run --config vitest.owner.config.ts packages/ui/test/table-variants.test.ts packages/ui/test/field-write.test.ts packages/ui/test/spans.test.ts

Test Files  3 passed (3)
Tests       23 passed (23)
Duration    12.22s
```

Includes eight browser variant-table tests, nine field-write tests, and six span tests. New browser regressions are at `packages/ui/test/table-variants.test.ts:320`, `:345`, and `:380`. The delayed fake-provider test verifies no source write before Apply and a single locale-targeted set-many commit. Earlier runs passed all assertions but timed out in the 10-second browser teardown; explicit page/connection cleanup and a 30-second teardown budget yielded the fully passing final run above. The original pre-change suite had 20 passing tests; all three new browser regressions initially failed before fixes.

### Blizzard Strings/Style source tests

Run in `modkit-extensions-blizzard`:

```text
pnpm exec vitest run --config test/vitest.config.mjs starcraft2/modules/strings/test/translate.test.ts starcraft2/modules/strings/test/locales.test.ts starcraft2/modules/strings/test/adapted.test.ts starcraft2/modules/strings/test/core/resolve.test.ts starcraft2/modules/strings/test/language.test.ts starcraft2/modules/style/test/font-styles.test.ts starcraft2/modules/style/test/style.test.ts --testNamePattern '^(?!.*through the installed host opener)'

Test Files  7 passed (7)
Tests       141 passed | 1 skipped (142)
Duration    10.70s
```

Counts: translate 10; locales 6 passed/1 excluded; adapted 13; core resolve 42; language 29; font-styles 11; style 30. The command explicitly excludes only the compiled-host integration case; the test is **not** permanently skipped in source. Before fixes, seven intended new source regressions failed (plus a separate host integration failure); focused postfix translation/adapted/resolve tests passed 65/65.

### Installed-host integration — pending main rebuild

The same seven-suite command **without** `--testNamePattern` finished with **141 passed, 1 failed**. `starcraft2/modules/strings/test/locales.test.ts:368` expected `blizzard/sc2-strings` but selected generic `modkit/txt`. The test now includes snapshot diagnostics on that assertion.

At inspection time, the existing compiled codec still declared old translation network/credential permissions (`starcraft2/dist/modules/strings/codecs/strings/src/codec.js:62`), while the source manifest/descriptor had been corrected. This is an observed source/artifact mismatch, not a proven complete explanation for codec selection. The installed-host fixture passed in an earlier baseline but failed in the final unfiltered run. **Do not report this integration test as green.** Main should rebuild and rerun that existing case before claiming final package integration success; this pass did not rebuild/package to hide the failure.

### Boundary checks

```text
node scripts/check-codec-provider-split.mjs
codec/provider split: valid

node --test test/codec-provider-split.test.mjs test/authored-text-format.test.mjs
tests 4
pass 4
fail 0
skipped 0
```

### Typechecks and whitespace

Completed with exit 0 and no diagnostics:

```text
# modkit-core
pnpm exec tsc -p packages/ui/tsconfig.json --noEmit --pretty false

# modkit-extensions-blizzard
pnpm exec tsc -p starcraft2/tsconfig.sc2-strings.json --noEmit --pretty false
pnpm exec tsc -p starcraft2/tsconfig.sc2-style.json --noEmit --pretty false
```

Scoped `git diff --check` passed for the three edited core source/test files and Blizzard Strings changes. No whole-plugin build or final package validation is included in these results.

## Main integration checklist

- Rebuild the codec artifacts, rerun the provider-split gate and installed-host localization case; inspect any remaining generic-text selection with the added diagnostics.
- App owner: wire authorized editor ports and post-commit refresh/reopen for the actual localization stage. This is separate from the bounded shared-table fixes.
- Keep translation transport/credentials provider-owned. Where the configured host service cannot be resolved, expose unavailable/unsupported; do not restore codec network permissions.
- Track rich per-locale previews, in-cell language completion/highlighting, shared resolved Data/style context, and broader locale fallback UI as remaining parity work. Screenshot and live-provider acceptance remain unverified.
