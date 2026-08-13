MK3 clean-core lab, not a release; owner decision pending (BRIEF-12 §5).

# modkitX3 — MK3 clean-core bootstrap lab

Temporary laboratory that builds the minimal Modkit bootstrap closure (`core`, `sdk`, `vfs`,
`host`, dev-only `testkit`) from scratch against the MK3 contracts, through slices S0–S4 of
`modkitx/docs/tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md`.
After S4 the owner decides: adopt the packages via packed artifacts, send them back for
revision, or archive the lab. Long-lived double authority with `modkitx` is forbidden.

## Owner documents (authority lives in `modkitx/docs`, never here)

| Plane                                                               | Owner                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Canon: packages, dependency direction, manifests/tree, target-first | `modkitx/docs/architecture/MODKIT_ARCHITECTURE.md` (§6.1 catalog + closure classes, §5.8/§5.13 manifests, §14 policy) |
| Normative v1 wire contract (descriptor/traits/operations)           | `modkitx/docs/architecture/ASSET_CAPABILITIES.md`                                                                     |
| Contract identity, resolution, provider-policy lock                 | `modkitx/docs/MK3/23-contract-identity-schema-resolution-and-lock.md`                                                 |
| Security declarations, permissions, execution, lifecycle            | `modkitx/docs/MK3/24-extension-security-execution-and-lifecycle.md`                                                   |
| Subject identity, unknown root, editing                             | `modkitx/docs/MK3/25-subject-identity-editing-transactions-and-cache.md`                                              |
| Target tree, extension manifest, contribution envelope              | `modkitx/docs/MK3/27-final-target-tree-extension-manifest-and-format-catalog.md` (§0 wins conflicts)                  |
| Final vocabulary (traits/operations/offers/permissions/facilities)  | `modkitx/docs/MK3/02-capabilities-and-contracts.md` §1                                                                |
| Workspace rules, divergence register, promotion map                 | `modkitx/docs/MK3/README.md`                                                                                          |
| Route S0–S7 / adopted queue                                         | `REPORT_6` §11 / `REPORT_9` §19 (tasks-active/platform-architecture)                                                  |

## Hard rules (BRIEF-12)

- Bootstrap closure only; no `ui`/`runtime`/`lsp`/`xml`, not even as stubs.
- No imports from `modkitx` in any form; copying only through review + a `PORTED.md` line.
- Lab package names are `@modkitx-x3/*`; the lab never occupies `@modkitx/*` npm names and
  never publishes (BRIEF-12 §7/§7.1).
- Forbidden legacy vocabulary is enforced by `scripts/check-legacy.mjs` (BRIEF-12 §3.5).
- Documentation decisions live in `modkitx/docs`; this repo carries only `README.md`,
  `PORTED.md`, `IMPLEMENTATION_NOTES.md`.

## Status

- **S0–S4 complete (2026-08-13)**: all five slices green behind the full gate (70 tests,
  drift gates, legacy gate, emitted schemas, prettier). External packed-tarball extension
  proof passes (S4/PR-23 shape); bench baselines recorded (closure 30 ms < 50 target;
  inventory/resolve far under budget; core-import/validate-net over on the reference
  machine — see IMPLEMENTATION_NOTES).
- **Stopped for the owner decision: adopt / revise / archive** (BRIEF-12 §5). S4b (.uve
  packer) not started — it does not start automatically.
