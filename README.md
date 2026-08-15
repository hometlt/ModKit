MK3 clean-core lab, not a release; owner decision: REVISE / CONTINUE (BRIEF-12 §5, BRIEF-13A).

# modkitX3 — MK3 clean-core bootstrap lab

Temporary laboratory that builds the minimal Modkit bootstrap closure (`core`, `sdk`, `vfs`,
`host`, dev-only `testkit`) from scratch against the MK3 contracts. S0–S4 of
`modkitx/docs/tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md` are retained
as proof. The owner chose **REVISE / CONTINUE** into A-0…A-8 of `BRIEF-13A`; the lab stays under
`@modkitx-x3/*`, MK2 is unchanged, and promotion requires successful A-8 plus a separate owner
decision. Long-lived double authority with `modkitx` is forbidden.

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

- **S0–S4 implementation complete**: `pnpm check` rebuilds the production bundles and passes
  strict typecheck, lint, formatting, 106 tests, schema drift, the legacy boundary and the
  external packed-tarball proof.
- **A‑1 accepted.** Opus reproduced schemas, typecheck and all 184 tests at `0ead78b9`; its one P1
  (`source-span.v1` missing a FromSchema drift gate) is closed by the follow-up commit. S0–S4 and
  A‑0 remain adopted; A‑2 host inventory/projection behavior and later slices remain separate work.
- Local `pnpm bench` is informational and never blocks work. `pnpm bench:gate` keeps only three
  budgets (core import, bootstrap-closure import, CLI validate) and is reserved for a fixed CI
  runner or dedicated machine. There are no local calibration probes, normalization or mutable
  baselines.
- No promotion before successful A-8 and a separate owner decision. S4b (`.uve` packer) remains
  a separate candidate and does not start automatically.
