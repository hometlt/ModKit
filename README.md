MK3 clean-core lab, not a release; owner decision: REVISE / CONTINUE (BRIEF-12 §5, BRIEF-13A).

# modkitX3 — MK3 clean-core bootstrap lab

Temporary laboratory that builds the minimal Modkit bootstrap closure (`core`, `sdk`, `vfs`,
`host`, dev-only `testkit`) from scratch against the MK3 contracts. S0–S4 of
`modkitx/docs/tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md` are retained
as proof. The owner chose **REVISE / CONTINUE** into A-0…A-8 of `BRIEF-13A`; those slices are now
implemented and gated. The lab stays under `@modkitx-x3/*`, MK2 is unchanged, and promotion still
requires a separate owner decision. Long-lived double authority with `modkitx` is forbidden.

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
| MK3 extension ABI and A-0…A-8 sequence                              | `modkitx/docs/tasks-active/platform-architecture/BRIEF_13A_mk3_extension_reference_spec.md` §16                       |

## Hard rules (BRIEF-12)

- S0–S4 remain a bootstrap-only proof. Optional packages and extensions in A-0…A-8 and
  BRIEF-13B/13C/13D follow their owning briefs; they do not enlarge S0–S4 retroactively.
- No imports from `modkitx` in any form; copying only through review + a `PORTED.md` line.
- Lab package names are `@modkitx-x3/*`; the lab never occupies `@modkitx/*` npm names and
  never publishes or promotes before successful A-8 and a separate owner decision
  (BRIEF-12 §7/§7.1).
- MK2 packages, extensions and viewers are unchanged by this route.
- Forbidden legacy vocabulary is enforced by `scripts/check-legacy.mjs` (BRIEF-12 §3.5).
- Documentation decisions live in `modkitx/docs`; this repo carries only `README.md`,
  `PORTED.md`, `IMPLEMENTATION_NOTES.md`.

## Status

- **S0–S4 and A‑0…A‑8 implementation complete.** `pnpm check` rebuilds production bundles and
  verifies strict typecheck, lint, formatting, schema drift, the legacy boundary, the external
  plain-text vertical slice and both packed-consumer routes.
- **A‑1 independently accepted.** Opus reproduced schemas, typecheck and all 184 tests at
  `0ead78b9`; its one P1 (`source-span.v1` missing a FromSchema drift gate) is closed by `286b674`.
- **A‑2…A‑8 are implementation-complete and reported for owner review.** This status does not
  promote `@modkitx-x3/*`, alter MK2, or claim the separate 13B/13C/13D implementations.
- **Assets Capabilities media stress is implemented.** Five neutral raster/vector/audio/video/model
  sources connect twelve isolated reference codecs to separately loaded UI viewers. Heavy decoder
  and renderer dependencies remain optional provider extensions; see `REPORT_REFERENCE_CODECS.md`.
- **Application extension-set composition is gated.** `pnpm apps:check` loads structured-text,
  document, media, model/archive, editor and full-codec sets into the headless, PWA, VS Code and
  Electron composition roots. It checks exact inventory isolation, contribution eligibility and
  realm/target selection (codecs execute in Node or workers, never in a renderer/webview). The X3
  Electron now has a native-menu/preload/renderer shell with tabs, splits, bounded Text/Hex
  fallback and portable settings. Independently packaged installer/process-launch E2E remains a
  distribution task rather than an A‑0…A‑8 blocker.
- **Completion report:**
  [`REPORT_A0_A8_CODECS_UI_APPS_COMPLETION_2026-08-17.md`](./REPORT_A0_A8_CODECS_UI_APPS_COMPLETION_2026-08-17.md)
  records the delivered slices, codec dependency boundaries, application matrix, exact gates and
  honest next-layer boundaries.
- Local `pnpm bench` is informational and never blocks work. `pnpm bench:gate` keeps only three
  budgets (core import, bootstrap-closure import, CLI validate) and is reserved for a fixed CI
  runner or dedicated machine. There are no local calibration probes, normalization or mutable
  baselines.
- A‑8 success only opens the owner decision; it does not promote automatically. S4b (`.uve`
  packer) remains a separate candidate and does not start automatically.
