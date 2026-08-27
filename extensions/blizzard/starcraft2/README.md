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

Historical conversion decisions remain in inert `MIGRATION-NOTES.json`.
