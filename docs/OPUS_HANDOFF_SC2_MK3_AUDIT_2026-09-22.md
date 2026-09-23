# Opus handoff: SC2 MK3 audit and bounded parity fixes

Date: 2026-09-22  
Core baseline: `fe330f425c84f5a04bca86381e615d223dcc591a`  
Blizzard baseline: `7dbb3afd2aae4d220e1cb441278976565cc2c736`

## Read this first

Both repositories were already heavily dirty and continued receiving concurrent work. Preserve every unrelated change. Do not reset, stash, clean, or infer ownership from the full diff. The paths explicitly listed under each section are the changes made by this audit/subagents. `PROMPT.txt` was requested by workspace instructions but was not present in the workspace, either repository root, or the checked parent directories.

The final VSIX exists and installs, but is **not release-certified** because installed acceptance still fails Galaxy rename. Do not tell the user that all MK2 parity is complete. The repository now has materially better and tested slices, plus explicit reports for the remaining gaps.

Primary report: [AUDIT_SC2_MK2_MK3_2026-09-22.md](AUDIT_SC2_MK2_MK3_2026-09-22.md). Supporting reports:

- [AUDIT_SC2_SUBJECT_VIEWS_2026-09-22.md](AUDIT_SC2_SUBJECT_VIEWS_2026-09-22.md)
- [AUDIT_SC2_LOCALIZATION_2026-09-22.md](AUDIT_SC2_LOCALIZATION_2026-09-22.md)
- [AUDIT_SC2_LSP_MCP_2026-09-22.md](AUDIT_SC2_LSP_MCP_2026-09-22.md)

## What was implemented

### 1. Dependency resource tree

Owner paths:

- `modkit-core/apps/vscode/src/resource-chain.ts`
- `modkit-core/apps/vscode/test/resource-chain.test.ts`

The old implementation treated a visual ID overlay as if it were an engine-calculated model. It also assumed every layer had the same root ID, queried layers that did not contribute a branch, summed arbitrary numeric facts as counts, yielded duplicate/stale search results, swallowed operational errors and cancellation, silently stopped after 50,000 nodes, and could reopen after disposal.

Now the overlay:

- uses each layer's own root;
- queries only real contributors;
- merges identical visible IDs with the last layer winning;
- counts unique immediate children instead of summing typed values;
- searches the visible merged tree;
- exposes unavailable layers/incomplete state;
- rejects repeated cursors and does not truncate at 50,000;
- propagates cancellation/errors, retries transient open failure, aborts lifetime on dispose and releases once.

Important: this remains a **navigation overlay**, not SC2 inheritance/default/removal/reference calculation. The domain owner must supply the calculated workspace.

### 2. Mod Resources declarations/defaults/categories

Owner paths in Blizzard:

- `starcraft2/modules/mod/codecs/mod/src/mod-card.ts`
- `starcraft2/modules/mod/test/mod-resource-tree.test.ts`
- `starcraft2/modules/mod/test/sc2-mod-card.test.ts`

Declaration navigation now uses the shared position-aware XML scanner and canonical Data class→namespace schema. It supports custom/include XML, mixed namespaces, single-quoted IDs, entities and UTF-16 ranges; ignores comments/CDATA/nested entity tags; and uses last declaration in loaded `Map` order. Defaults have stable class-based IDs rather than array indices. Preload is removed from semantic categories but remains visible under Files.

Still missing: S-defaults/constants as separate semantic nodes, richer asset grouping, Layout/Style/Galaxy/EditorCategories symbol children.

### 3. Unit cards, production, parent chain and resolved XML

Owner paths in Blizzard:

- `starcraft2/modules/data/codecs/sc2data/src/entity-cards.ts`
- `starcraft2/modules/data/codecs/sc2data/src/entity-facts.ts`
- `starcraft2/modules/data/codecs/sc2data/src/resolved-view.ts`
- `starcraft2/modules/data/test/sc2-data-subject-views.test.ts`

Fixes:

- command page/slot/button/ability/hotkey/cost data is no longer discarded;
- Produced by retains actual producing Units/routes separately from ability/effect mechanism;
- named parent-chain identities/relations are published, root-first, with missing/cyclic disclosure;
- vital fields retain type/edit metadata when a write route exists;
- zero numeric values remain zero;
- resolved XML reuses `entityToXml`, so nested/indexed structures no longer become `[object Object]`;
- resolved output discloses its loaded-catalog scope and partial chains.

Still missing: generic card UI does not render the MK2 command grid or full inline controls; native XML CodeLens/peek actions are absent; ordinary file/mod cards are not attached to authoritative resolved-workspace dependencies. Do not add a second resolver inside VS Code.

### 4. Localization table, translation and Style safety

Core owner paths:

- `packages/ui/src/table/index.ts`
- `packages/ui/src/table/variants.ts`
- `packages/ui/test/table-variants.test.ts`
- `apps/vscode/src/stages.ts`
- `apps/vscode/test/localization-stage.test.ts`

Blizzard owner paths:

- `starcraft2/modules/strings/codecs/strings/codec.json`
- `starcraft2/modules/strings/codecs/strings/src/codec.ts`
- `starcraft2/modules/strings/shared/core/render-html.ts`
- `starcraft2/modules/strings/test/{translate,locales,adapted}.test.ts`
- `starcraft2/modules/strings/test/core/resolve.test.ts`

Fixes:

- removed forbidden codec `network`/`credentials`; translation remains a host/provider service;
- translation services are isolated per codec activation;
- placeholder marker sequence is validated exactly;
- literal/styles-only rendering and bound-locale fallback work;
- style class values are HTML-attribute escaped;
- stale async highlight, duplicate editor mounts/commits, Escape cleanup, overlapping translation batches, unchanged results and stale writes are handled;
- real VS Code localization stage now requests authorized editor ports and reopens after successful commit while remaining usable read-only.

Still missing relative to MK2: rich styled preview in every locale cell, raw/render toggle, syntax highlighting and completion inside the active cell editor, automatic resolved GameData/Style context for `<d ref>`, and complete locale fallback/provenance UI. The installed-host Strings test still selects `modkit/txt` instead of `blizzard/sc2-strings`.

### 5. LSP and MCP adapters

Core owner paths:

- `apps/lsp/src/server.ts`
- `apps/lsp/test/lifecycle.test.mjs`
- `apps/mcp/src/{host-port,main,protocol,runtime,server}.ts`
- `apps/mcp/test/{server,adapter-audit,stdio-audit}.test.*`

Fixes:

- LSP queued notifications snapshot text/version; close/reopen/shutdown and workspace enumeration wait for the serialized lifecycle;
- MCP language feature schema/dispatch covers semantic tokens and on-type formatting;
- invalid envelopes set `isError`; unresolved/stale diagnostics are actionable;
- provider incompleteness is preserved;
- async facts/calculations keep leases until settled;
- failed re-prepare clears stale ready preparation;
- repeated shared references are no longer false cycles;
- stdio frame bound now accommodates the advertised 16 MiB document under worst-case JSON escaping.

Final public stdio passed 2/2, including Galaxy overlays/navigation and Data proposal→prepare→commit→reopen→undo→redo. This is a synthetic happy path. Broader packed/provider tests still have failures described in the MCP report.

## Final evidence

Passed:

- Resource chain: 12/12.
- Data/Mod focused after rebuild: 34/34 across seven suites.
- Data subject views focused: included in the 34; prior focused total 23/23.
- Localization stage + view policy: 9/9.
- Shared table/write/spans: 23/23.
- Strings/Style source: 141 passed, one installed integration explicitly excluded.
- MCP focused final: 56/56.
- MCP actual stdio final: 2/2.
- LSP lifecycle: 3/3.
- Final targeted regression run: 72/72 across MCP adapter/session/server, Resources tree, localization stage and shared table UI.
- Final combined lifecycle/actual-stdio run: 5/5.
- ESLint on all audit-touched LSP/MCP/VS Code/table source and focused tests: passed.
- Core `tsc -b apps/vscode apps/mcp apps/lsp`: passed.
- Blizzard scoped Data/Strings/Style/Mod typechecks: passed.
- Provider-split gate: passed.
- Blizzard boundary test group: 9/9; boundary ratchet valid with 84 legacy records remaining.

Known failing/partial evidence:

- Installed VSIX language acceptance: `passed:false`; after many successful language checks, Galaxy rename following undo did not produce a two-document WorkspaceEdit. Reproduction is the receipt below and `apps/vscode/test-e2e/run-installed-language-acceptance.mjs`.
- Strings installed-host locale test: 6 passed / 1 failed because generic `modkit/txt` wins selection.
- Combined host test run initially had one 5-second timeout; isolated `subject-open-container-composition` passed 19/19 with its slow test around 4.63 seconds.
- Data host edit-context has destination casing/resource-plan accounting failures and a planner-budget fixture discrepancy; see subject report.
- Broader LSP SC2: five passed/two failed. Broader MCP SC2: 16 passed/twelve failed; isolated Bank recovered 2/2, Style remained incomplete.
- `node scripts/check-app-imports.mjs`: 88 violations in 769 files.
- `node scripts/check-external-composition.mjs`: fails with many matches and needs classification; its broad regexp also sees comments/generated material.
- Whole-repo `git diff --check`: pre-existing trailing whitespace in `todo:45`.

## Artifact and receipt

Source-matching handoff VSIX (built after the final lint cleanup):

`C:/FILES/SC2Files/coding/modkit-core/apps/vscode/artifacts/vsix/modkit-audit-2026-09-22-opus.vsix`

SHA-256:

`606629f8f06fc3f5833835e0eed467ce31e3d7a0b76d8a79601dca6b44bfb3ef`

Installed candidate used by the acceptance receipt:

`C:/FILES/SC2Files/coding/modkit-core/artifacts/vsix/modkit-audit-2026-09-22-final.vsix`  
SHA-256 `ca93728fbd55fd60fbfc3122b048b2c3c74983b25e93cc125cb8177b438137b9`

Installed acceptance receipt:

`C:/FILES/SC2Files/coding/modkit-core/reports/vscode-smoke/installed-language-receipt.json`

The receipt proves that the installed candidate with hash `ca9372…137b9` was installed into an isolated test profile. The handoff artifact differs only by the final strict-lint cleanup and defensive impossible-state guards; it was rebuilt successfully but was not re-run through installed acceptance. The receipt is not a passing release receipt because Galaxy rename failed.

## Recommended next sequence

1. Reproduce installed Galaxy rename immediately after dirty edit→undo. Trace workspace revision and `prepareRename`/`rename` completeness through `apps/vscode/src/language-session.ts`, host language workspace and Galaxy provider. Preserve refusal on genuinely incomplete context; do not turn `undefined` into an empty WorkspaceEdit.
2. Diagnose why a LocalizedData `GameStrings.txt` opened through the installed host falls back to `modkit/txt`. Inspect candidate diagnostics/selection score and the required translation-service activation. Keep translation network/credentials provider-owned.
3. Attach ordinary selected mod/file cards and Resources to the same authoritative resolved workspace used by map preview/MCP. One context must own load order, dirty overlays, locale, provenance and writable override targets.
4. Project command facts to the shared card grid; then wire scalar controls to owner edit targets. Add native Data CodeLens/peek only after the authority is shared.
5. Add semantic resource children owner-side: Data constants/S-defaults, Layout frames/templates/constants, Style styles/constants, Galaxy symbols, grouped EditorCategories and reference-indexed asset groups. Preload stays only in Files.
6. Finish localization parity: per-locale styled preview, raw/render toggle, cell language bridge, resolved `<d ref>`/Style context and installed save/reopen acceptance.
7. Resolve the app-import boundary without expanding the baseline: move genuinely neutral render/math primitives to neutral packages and keep game semantics in Blizzard.
8. Rebuild a new VSIX and require passing installed acceptance plus artifact hash before manual user testing. Do not use a normal `code` window as evidence; use the isolated profile/title or the installed harness.

## Rules for continuation

- Do not read real game/CASC files directly for SC2 semantic inspection; use public Modkit services. Synthetic fixture/source tests are fine.
- Do not equate a tree overlay with a calculated catalog.
- Do not suppress incomplete, stale-artifact, digest or revision checks to make tests green.
- Do not grant codecs ambient network/credentials for translation.
- Do not edit inherited/CASC content directly; preview a writable local override and commit through typed edit plans.
- Keep results separated into source tests, compiled/portable tests, actual stdio, installed VSIX and manual visual acceptance.
