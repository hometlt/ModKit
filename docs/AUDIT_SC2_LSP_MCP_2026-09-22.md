# Bounded SC2 LSP/MCP adapter audit — 2026-09-22

## Outcome and boundaries

Concrete adapter fixes are implemented. This is **not a full SC2 parity sign-off**: targeted adapter regressions and the final public stdio happy path pass, but some broader synthetic SC2 tests still fail.

Only `apps/lsp/**`, `apps/mcp/**`, and this report were intentionally edited. Heavy pre-existing changes were preserved; no reset, stash, commit, VS Code launch/close, or plugin repackaging was performed. No core/SDK interfaces were changed. `packages/host/src/model-projection-cache.ts` is **not mine**. No writes were made to Blizzard or the MK2 reference.

Applicable instructions and the codebase-memory, ponytail, and inspect-sc2-resolved-data skills were read. Graph discovery was attempted first; current adapter coverage was insufficient, so scoped source reads/rg were used. The minimal-change skill kept fixes adapter-local; the SC2 skill constrained the new smoke to public protocol calls over synthetic fixtures, without private game/CASC reads. Workspace/repository-root and scoped searches found no applicable `PROMPT.txt`; the separate MK2 reference instructions were read, and that tree remained read-only. Its referenced `docs/DOCUMENTATION_INDEX.md` was absent.

## Exact paths changed by this audit

Existing files modified, preserving their prior changes:

- `apps/lsp/src/server.ts`
- `apps/mcp/src/host-port.ts`
- `apps/mcp/src/main.ts`
- `apps/mcp/src/protocol.ts`
- `apps/mcp/src/runtime.ts`
- `apps/mcp/src/server.ts`
- `apps/mcp/test/server.test.ts`

New files:

- `apps/lsp/test/lifecycle.test.mjs`
- `apps/mcp/test/adapter-audit.test.ts`
- `apps/mcp/test/stdio-audit.test.mjs`
- `docs/AUDIT_SC2_LSP_MCP_2026-09-22.md`

Adapter-local builds also generated ignored outputs. Existing changes in LSP config, filesystem-source, main, and installed/config/filesystem tests, and MCP language-session-host tests were not authored by this audit. Repository-wide diff totals are not an attribution of this work.

## Implemented findings and verification

| Finding / fix | Evidence in current source | Verification |
| --- | --- | --- |
| LSP queued notifications retained mutable `TextDocument` objects, allowing later versions to replace earlier queued input; independent close could overtake reopen. Serialize shared workspace mutations and snapshot notification text/version. | `apps/lsp/src/server.ts:225`, `:450`, `:457`, `:974` | Three new lifecycle tests failed before the fix and passed afterward. Includes close/reopen, pending-open workspace diagnostics, and shutdown draining. |
| LSP workspace enumeration and shutdown could run before queued opens completed. Await the lifecycle queue before enumeration and release. | `apps/lsp/src/server.ts:609`, `:895`, `:987` | Same 3/3 regression suite. |
| MCP advertised language features not accepted/dispatched uniformly. Add semantic tokens and on-type formatting to the adapter schema/type/dispatch; share the one-shot/session dispatch without SDK expansion. Preserve one-shot document bounds. | `apps/mcp/src/server.ts:84`, `:93`; `apps/mcp/src/host-port.ts:119`, `:128`, `:617`, `:654` | Public in-memory protocol/schema tests passed. Semantic tokens also exercised through actual SC2 stdio. SC2 on-type behavior was not independently runtime-tested. |
| Returned invalid envelopes lacked MCP `isError`; unresolved providers and stale overlays produced generic failures. Mark invalid envelopes as errors, preserve error diagnostics on unresolved opens, and give language failures actionable codes. | `apps/mcp/src/server.ts:539`; `apps/mcp/src/host-port.ts:589`, `:825`, `:935`; `apps/mcp/src/runtime.ts:685` | Invalid-envelope, unsupported-feature, stale-version and unresolved subject-open regressions passed. The last added unresolved language-activation regression was in an interrupted batch; its outcome is unconfirmed. |
| Capability operation list omitted implemented workflows; `readOnly` did not reflect the actual edit/effect policy. | `apps/mcp/src/runtime.ts:481`, `:500` | Capability regression passed. Registered tool names are enumerated below. |
| Session feature envelopes could claim complete despite provider truncation or semantically incomplete context. Preserve partial state. | `apps/mcp/src/runtime.ts:2442`, `:2460` | Regression passed; bounded semantic tokens returned partial in the SC2 stdio path. Existing Style retry now exposes partial/incomplete context rather than a misleading complete result. |
| Async facts/calculations leases were released by `finally` before the returned asynchronous work settled. Await the result inside the lease scope. | `apps/mcp/src/runtime.ts:1260`, `:1491` | Two gated async regressions passed. |
| A failed repeat edit preparation could leave an earlier ready preparation usable. Clear it before revalidation. | `apps/mcp/src/runtime.ts:1991` | Failed-second-prepare regression passed. This does not establish safety for all concurrent edit interleavings. |
| Projection treated repeated shared references as cycles, causing valid provenance to be omitted/capped. Track ancestors only, retaining true-cycle bounds. | `apps/mcp/src/protocol.ts:113` | Shared-provenance regression and existing cycle/bounds tests passed. |
| Actual stdio input limit was 1 MiB, below accepted overlay limits. Increase the finite message bound to accommodate worst-case JSON escaping of 16 MiB text plus metadata; existing host text budgets remain enforced. | `apps/mcp/src/main.ts:15`, `:36` | Actual-server 1.1 MiB overlay test timed out before the fix and passed afterward. |

## Commands and observed results

All commands below ran from `C:/FILES/SC2Files/coding/modkit-core`. Counts describe individual completed runs, not a claim that the final tree received one combined green run.

1. Adapter-only compilation, completed successfully before the final interrupted batch:

   ```powershell
   pnpm exec tsc -p apps/lsp/tsconfig.json
   pnpm exec tsc -p apps/mcp/tsconfig.json
   ```

   These use `-p`, not dependency-rebuilding `-b`. The last batch combined both commands with the newly expanded adapter test file; interruption left that batch's final result unconfirmed. Central integrated builds should cover the final small activation-error change.

2. Focused MCP run — **55/55 passed** (40 server, 4 adapter-audit, 6 language-session-host, 5 output-artifacts; approximately 24.5 seconds):

   ```powershell
   pnpm exec vitest run apps/mcp/test/server.test.ts apps/mcp/test/adapter-audit.test.ts apps/mcp/test/language-session-host.test.ts apps/mcp/test/output-artifacts.test.ts --maxWorkers=1 --minWorkers=1 --cache=false
   ```

   Main integration reran the final set after this handoff: **56/56 passed**, including the fifth actionable unresolved-language-activation regression.

3. LSP lifecycle — **3/3 passed**:

   ```powershell
   node --test apps/lsp/test/lifecycle.test.mjs
   ```

4. Existing LSP synthetic/config coverage — **5 passed, 2 failed**:

   ```powershell
   node --test --test-concurrency=1 apps/lsp/test/config.test.mjs apps/lsp/test/filesystem-source.test.mjs apps/lsp/test/pull-diagnostics.test.mjs apps/lsp/test/sc2-installed.test.mjs
   ```

   Config, filesystem, and pull-diagnostic tests passed. `sc2-installed.test.mjs:141` expects exactly three completion labels, but the provider now also returns SC2 structure names; this is an assertion/provider-output discrepancy, not proof of an adapter defect. `sc2-installed.test.mjs:358` failed definition with LSP `-32803`, diagnostic `x3.lsp/provider-unresolved` for synthetic packed dependencies. Its root cause was not established. Neither test was modified by this audit.

5. Already-completed broader MCP SC2 run — **16 passed, 12 failed**, approximately 368.5 seconds:

   ```powershell
   pnpm exec vitest run apps/mcp/test/sc2-language-operations.test.ts apps/mcp/test/sc2-edit-lifecycle.test.ts apps/mcp/test/sc2-resolved-edit-lifecycle.test.ts apps/mcp/test/sc2-bank-language.test.ts apps/mcp/test/sc2-style-language.test.ts apps/mcp/test/sc2-wizard-language.test.ts apps/mcp/test/sc2-strings-operations.test.ts apps/mcp/test/output-artifacts.test.ts --maxWorkers=1 --minWorkers=1 --cache=false
   ```

   Passed: all five resolved-edit tests, both Wizard tests, both Strings operation tests, all five output-artifact tests, and two language-operation tests covering Galaxy/Triggers and Trigger tree/proposal behavior. Failures: seven ordinary edit-lifecycle tests (Data/Layout/Bank included `x3.host/artifact-digest-mismatch`; two Strings selections fell back to `modkit/txt`), two language-operation tests (Layout presentation invalid; Data/Layout actions provider unresolved), two Bank activation tests and one Style activation test. Do not assign one common root cause to these failures.

6. Completed isolated retry — **Bank 2/2 passed; Style 0/1**:

   ```powershell
   pnpm exec vitest run apps/mcp/test/sc2-bank-language.test.ts apps/mcp/test/sc2-style-language.test.ts --maxWorkers=1 --minWorkers=1 --cache=false
   ```

   Style activation succeeded on this run; `sc2-style-language.test.ts:170` instead received a null rename result with `workspaceIncomplete: true` and `workspaceContext.semanticComplete: false`, rather than the expected complete single-document edit. Incomplete-workspace refusal was not loosened. This retry does not erase the earlier failures.

7. Public stdio test target: `apps/mcp/test/stdio-audit.test.mjs` (reproduction command: `node --test apps/mcp/test/stdio-audit.test.mjs`). See the precise partial results below. No further long runs were launched at wrap-up.

User-reported central results, **not independently rerun here**: app typechecks passing, chain tests 11 passed, host scopes 83 passed/1 timeout then isolated 19 passed; check-app-imports had 88 violations and external-composition had many violations. The host projection typing fix belongs to another thread. Packaging is centrally owned and was not run here.

## Public stdio MCP smoke

The new test uses the public SDK client and `StdioClientTransport` to spawn the actual built `apps/mcp/dist/main.js`. Synthetic fixture files live under the MCP test directory; cleanup is scoped to the test's own generated directory. No installed SC2 game, CASC, or private provider API was used by this new smoke.

Main integration reran the actual built server after correcting two test expectations: exact subject search uses `data.exact` rather than duplicating that result in `items`, and a canonical exact ID is not itself proof that the source publishes a selectable subject card. Final result: **2/2 passed**.

- Actual-server 1.1 MiB overlay admission and session close passed.
- Initialization/tool discovery, Galaxy session, cross-document `Helper` definition, bounded semantic tokens with partial completeness, overlay update to version 2, stale-version refusal and close passed.
- Data `open_subject`/inspect, `edit.field` proposal, prepare, commit, reopen with changed revision, undo, redo, final undo and discard passed.
- Inventory remained explicitly `partial` and definition explicitly `partial`; the smoke does not erase broader provider and packed-dependency failures below.

## High-value public workflows for maps/mods

These are exact names registered in `apps/mcp/src/server.ts`, not inferred aliases. Tool availability does not establish that every SC2 provider operation succeeds. Inspect discovery/schema and completeness before using returned data or applying edits.

| Workflow | Public tools | Source evidence / runtime status |
| --- | --- | --- |
| Discover installed capability and provider services | `modkit.capabilities`, `modkit.inventory`, `modkit.service_operations`, `modkit.invoke_service_operation` | Server `:627`, `:638`, `:649`, `:662`. Discovery exercised; arbitrary effectful service operations were not executed. |
| Select a map/mod artifact and inspect entities | `modkit.open_subject`, `modkit.open_selection`, `modkit.inspect`, `modkit.list_subjects`, `modkit.search_subjects`, `modkit.select_subject` | Server `:798`, `:822`, `:835`, `:846`, `:859`, `:874`. Synthetic Data stdio open blocked as above. |
| Explain effective values and references | `modkit.subject_facts`, `modkit.relation_graph`, `modkit.subject_calculations`, `modkit.knowledge_search`, `modkit.knowledge_resolve` | Server `:898`, `:910`, `:923`, `:1186`, `:1199`. Facts/calculation lease lifecycle runtime-tested with a gated host. |
| Unsaved Galaxy/XML overlays and cross-document navigation | `modkit.language_session_open`, `modkit.language_session_update`, `modkit.language_session_feature`, `modkit.language_session_close`; one-shot `modkit.language` | Server `:687`, `:700`, `:722`, `:741`, `:760`. Galaxy definition, semantic tokens, update/stale/close exercised through real stdio. Use exact features such as `definition`, `semantic-tokens`, `rename`, `on-type-formatting`. |
| Dependency-aware Data editing / clone and rewire | `modkit.open_resolved_workspace`, `modkit.propose_resolved_edit`, `modkit.subject_edit_target`, `modkit.subject_isolation`, `modkit.subject_isolation_plan` | Server `:955`, `:970`, `:992`, `:1060`, `:1073`. Existing resolved-edit suite 5/5 passed; not a full stdio workflow proof. |
| Review, prepare, commit, and recover edits | `modkit.propose_edit`, `modkit.prepare_edit`, `modkit.commit_edit`, `modkit.edit_history`, `modkit.undo_edit`, `modkit.redo_edit`, `modkit.discard_edit` | Server `:1042`, `:1092`, `:1105`, `:1123`, `:1134`, `:1151`, `:1168`. Honor edit opt-in, revision/preconditions and prepared policy; revalidation regression passed. Full public stdio edit sequence incomplete. |
| Read-only outputs and cleanup | `modkit.invoke_readonly`, `modkit.release_output`, `modkit.close_selected_subject`, `modkit.close_subject` | Server `:937`, `:1031`, `:887`, `:811`. Output-artifact suite 5/5 passed. Close retained handles and release retained output after use. |

## Remaining bounded gaps

The following are **source-inspection findings / risks**, except where explicitly linked to runtime evidence above. They were not expanded into new interface work or further long tests.

1. **LSP completeness signaling:** definition/reference translations return plain LSP arrays and do not carry provider `isIncomplete` (`apps/lsp/src/server.ts:739`, `:748`); workspace-symbol aggregation also has bounded output (`:895`). Completion explicitly preserves its native completeness bit (`:664`). Agree a client-visible status/diagnostic convention before treating empty navigation results as authoritative absence. No new LSP/SDK extension was introduced.
2. **Cross-document diagnostic freshness:** updates compute/store diagnostics for the changed document (`apps/lsp/src/server.ts:436`), while pull handlers return saved snapshots (`:588`). Shared-workspace queueing fixes ordering but does not itself refresh diagnostics of dependent documents. A targeted cross-file invalidation test remains needed.
3. **Changing dependency/root/locale topology:** content language sources are resolved during startup (`apps/lsp/src/main.ts:91`); watched-file handling refreshes documents (`apps/lsp/src/server.ts:969`) without re-resolving the closure. No dynamic workspace-folder/configuration refresh path was identified. Coordinate ownership before changing source/SDK lifecycles.
4. **Advertised versus per-document capability:** LSP initializes broad optional capabilities; actual dispatch uses `requireFeature` (`apps/lsp/src/server.ts:334`, initialization near `:533`). Clients must use per-document capability/error behavior rather than assume every document supports every advertised method. MK2 provided owner-routed completion resolve and configuration forwarding (`references/modkitmk2/packages/lsp/src/host/router.ts:269`, `:280`, `:347`, `:376`); equivalent core/SDK expansion was deliberately out of scope.
5. **Concurrent handle admission:** root and selected-entity checks count only ordinary/entity handles (`apps/mcp/src/runtime.ts:691`, `:1151`), while resolved-workspace checks include resolved handles (`:2162`). Checks precede asynchronous opens and do not reserve an admission slot. Combined/concurrent limits can therefore be exceeded in source reasoning; no stress test was run.
6. **Noncooperative language-session shutdown:** close removes the public session handle before awaiting shutdown (`apps/mcp/src/runtime.ts:2478`, `:2487`); host-port shutdown waits on `operationTail` (`apps/mcp/src/host-port.ts:980`) without its own deadline. A hung provider operation can delay close. No noncooperative-provider runtime test was run.
7. **Projection versus executable edits:** generic output depth/string/collection budgets remain intentional. Consumers must not apply truncated/capped language rename/edit projections as a complete transaction. This audit corrected false cycle detection, not the absence of a dedicated retained language-edit artifact route.
8. **Unclosed SC2 runtime failures:** synthetic artifact-digest refusal, installed dependency provider resolution, ordinary edit-lifecycle failures, and incomplete-context Style rename are still integration blockers/limitations as detailed above. Several lie beyond what the observed adapter evidence can diagnose. Do not suppress semantic incompleteness or stale-artifact checks to turn them green.

Final integrated builds, gate reconciliation, packaging, and ownership of the remaining host/provider failures are left to the main integration thread as requested.
