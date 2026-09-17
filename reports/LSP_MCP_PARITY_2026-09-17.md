# LSP/MCP parity with MK2 language modules — 2026-09-17 (Stage K)

MK2 sources (read-only): `references/modkitmk2/apps/modkit-vscode/src/{galaxy-language,sc2-gamedata-language,strings-language,sc2-language-protocol}.ts`.
MK3 route: provider (`modkit-extensions-blizzard/starcraft2/modules/*/providers/language`) → Host `LanguageWorkspace`
→ generic stdio `@modkit/modkit-lsp` (built bin) and MCP `modkit.language*`. No SC2 branch in either adapter.

Status: **pass** = exercised by the named test through the installed bin/public MCP; **partial** = works with a stated limit;
**gap** = not implemented.

Tests: `L` = `apps/lsp/test/sc2-installed.test.mjs`, `P` = `apps/lsp/test/pull-diagnostics.test.mjs`,
`M` = `apps/mcp/test/sc2-language-operations.test.ts`, `E` = `apps/mcp/test/sc2-edit-lifecycle.test.ts`.

## Galaxy (`galaxy-language.ts`)

| MK2 feature | MK3 status | Evidence |
|---|---|---|
| completion | pass (incl. dependency symbol) | L |
| hover | pass (signature from unopened `Lib.galaxy`) | L |
| document symbols | pass | L |
| signature help | pass | M (`signature-help`) |
| definition (cross-file) | pass — target file never opened, comes from host filesystem snapshot | L |
| references (cross-file) | pass | L |
| rename (cross-file) | pass once the snapshot is complete; refused (null) while dependencies are read-only | L |
| formatting | pass (provider returns bounded edits) | L |
| diagnostics push/pull | pass | L, P |
| workspace symbols | pass (LSP now queries one document per open language) | L |

## GameData (`sc2-gamedata-language.ts` → SC2 `language-core`)

| MK2 feature | MK3 status | Evidence |
|---|---|---|
| field completion | pass | L |
| hover with resolved value | pass | L |
| definition (`parent`, links) | pass | L |
| references | pass | L |
| rename entity id | pass (fixed duplicate `documentChanges` in the Data provider) | L |
| formatting | partial — final-newline only, by design | L (capability), provider |
| diagnostics | pass | L |

## Strings (`strings-language.ts`)

| MK2 feature | MK3 status | Evidence |
|---|---|---|
| diagnostics (duplicates/markup) | pass | L (pull) |
| completion | pass | L capability, probe |
| hover | pass | L |
| definition | pass | L |
| color provider | pass (`document-colors`, `color-presentations`) | capability in L; M/Style suite |
| rename key | pass (MK3 addition) | L |
| formatting | not offered — explicit `x3.lsp/feature-unsupported` error | L |

## `sc2-language-protocol.ts` (MK2 custom requests)

| MK2 request group | MK3 status |
|---|---|
| fetchNode / layoutElement / elementViewData (explorer tree) | moved: MCP `modkit.inspect`, `invoke_readonly` (`tree-page`, `view.inspect`) — not an LSP method |
| workspaceOverview / modResources / stringsResource | moved: MCP `list_subjects`/`search_subjects`, `content.resolve-dependencies` |
| gameData namespaces/entities, galaxy symbols | partial: MCP `subject_facts` + `workspace/symbol`; no dedicated LSP request |
| layoutWorkspaceStatus / Diagnostics | partial: LSP `workspace/diagnostic`; no layout-specific status request |

## Generic adapter behaviour (Stage K)

| Row | Status | Evidence |
|---|---|---|
| initialize/capabilities, `modkit/languageCapabilities` per document | pass | L, P |
| open/change/save/close, stale version, diagnostics cleared on close | pass | L, P |
| cancellation → `RequestCancelled` (-32800) | pass (was -32603) | L |
| unsupported method → `RequestFailed` + `x3.lsp/feature-unsupported` | pass (was empty success) | L, P |
| unresolved provider → `x3.lsp/provider-unresolved` | pass (was internal "not open") | manual probe |
| workspace roots + host-owned dependency snapshot | pass (loose filesystem) | L |
| Mod-owned packed dependency closure in standalone LSP | gap (MCP only, §3.12) | — |

## MCP edit lifecycle and basic editing

| Row | Status | Evidence |
|---|---|---|
| propose → prepare → commit → history → reopen → undo → redo → discard: Data field, Strings value, Layout reference attribute, Bank value | pass | E |
| stale revision, missing startup edit policy, forged/replayed plan handle, client payload field | pass | E |
| plan TTL expiry releases staged payloads | pass | `apps/mcp/test/server.test.ts` |
| tampered/forged staged payload | pass | `packages/host/test/file-payload-store.test.ts` |
| `subject.edit` shared command (CLI `modkit run subject.edit --commit`, VS Code/Electron runtime) over the same codec operation | pass | `packages/host/test/edit-command.test.ts`, `apps/cli/test/subject-edit.test.ts` |
| Map document commit | gap — `sc2-map-real.test.ts` proves proposal only | — |
| add/remove entry | partial — Strings `edit.content add`, Data `edit.field value:null`; no Bank/Layout add/remove | — |
| clone entity | gap for commit — `modkit.subject_isolation_plan` previews only | — |
| language rename applied through the host transaction | gap — LSP/MCP return WorkspaceEdit; the client applies it | — |
