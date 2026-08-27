# StarCraft II codec family

Product-owned codecs for authored SC2 data, strings, layouts, maps, mods, replays, banks, triggers,
Galaxy and runtime documents. They expose bounded tree/table/text/namespace views through MK3
contracts; installation discovery and workspace composition remain in the sibling
`blizzard/starcraft2-game` service extension.

Authored Galaxy, localization, layout, GameData and Trigger XML use one bounded complete-snapshot
writer through `common.edit/writer@1`. Unsigned banks use the same path; signed banks remain
read-only because changing them without a signer would invalidate their signature. A separate
export-only provider can copy every enumerated byte of a complete loose namespace into a
revision-pinned workspace directory. Its contract accepts a read-only CASC source mode, but the
current installed proof names only the remote-key refusal; successful commit/reopen proof is for a
complete loose workspace. No app/command owns the snapshot planner yet, so this is provider
foundation, not a product export workflow. A remote-only CASC encoding key stops planning before
any target write rather than producing a partial map. It is deliberately not an MPQ repacker: native
preserving `.SC2Map`, `.SC2Mod` and `.SC2Campaign` round-trip remains unavailable until encrypted,
patch, high-offset and unknown MPQ layout features can be retained.

The separately resolved `common.runtime/provider@1` contribution exposes exactly
`blizzard.starcraft2.galaxy-pure-bounded-v1`. It executes zero-argument Galaxy functions whose
bodies contain only direct zero-argument calls and exact `int32`/`bool`/`string`/`null` literal
returns. Runtime inputs are logical `ResourceSessionPort` requirements supplied by a trusted
in-process host; the context is rejected before `createSession` for worker, process and remote
profiles. The v2 session provides deterministic bounded step/events/snapshot/restore/state-hash.
Trigger XML remains native authored input with unavailable semantic lowering. Catalog mechanics,
general Galaxy expressions/control flow, replay/save/network semantics, and native signing,
launch and playback remain named Block 19/GA blockers.

This slice adds a capability-refusal variant to the public v1 `RuntimeExecutionResult` union so
unsupported entrypoints, natives, subset constructs, cancellation and disposal are not mislabeled
as numeric budget failures. It does not change any frozen runtime-session v2 member or refusal wire
shape. It is additive at runtime and covered by the SDK public-type compile fixture, but TypeScript
consumers that intentionally exhaust every former union member must add the new reasons; this is a
source-level migration obligation, not claimed as a no-impact type change.

Historical conversion decisions remain in inert `MIGRATION-NOTES.json`.
