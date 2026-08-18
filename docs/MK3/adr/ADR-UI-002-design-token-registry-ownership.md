# ADR-UI-002 — Design token registry ownership

Status: **Accepted** (2026-08-15, owner decision №4)
Applies to: `modkitX3/packages/ui`, `modkitX3/packages/sdk`

## Context

The token registry is the authority for every colour, length, duration and easing the UI kit uses.
Two homes were proposed: `sdk`, alongside the other contribution schemas, so that theme manifests
could be validated without a DOM dependency; or `ui`, alongside the CSS it generates.

The question is not cosmetic. Whoever owns the registry owns its version, its drift gate, and the
direction of the dependency between contract types and rendering code.

## Decision

**The authoritative token registry belongs to `@modkitx-x3/ui`. It does not go in the SDK.**

| Owner                                | Holds                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/ui/src/tokens/registry.ts` | The single authority for token identity, type, default value and public/private status |
| generated from it                    | `tokens.css`, TypeScript declarations, and a checkable JSON token contract             |
| `packages/sdk`                       | Only neutral `ContractRef`, the contribution envelope, and serializable types          |

The SDK contains **no** `--mk-*` list, no CSS values and no palettes.

When UK-3 arrives, `ui` registers a data-only theme contract through the open contribution
registry (`packages/sdk/src/manifest/contribution-contract-registry.ts`), rather than the SDK
acquiring knowledge of tokens.

## Consequences

- The dependency direction stays `ui → sdk`. No inverse edge is created.
- Token changes never force an SDK release.
- `tokens:emit` / `tokens:check` follow the two drift-gate patterns already in the tree, and
  `tokens:check` joins the root `check` script.
- Theme manifest validation at UK-3 consumes the **generated** JSON token contract, so validation
  does not require importing rendering code — the original argument for SDK ownership is satisfied
  without moving the authority.
- A future non-DOM consumer of tokens must consume the generated artifact, not the registry module.

## Alternatives considered

| Alternative                           | Rejected because                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry in `sdk`                     | Puts CSS values and palettes into a presentation-neutral package, contradicting the architecture canon below; forces an SDK release for every token change |
| Split: types in `sdk`, values in `ui` | Two authorities for one concept; the drift gate would have to span packages                                                                                |
| New `packages/ui-tokens`              | Fails the doc 27 §0.4 second-consumer gate — there is no proven second consumer                                                                            |

## Evidence

- **Architecture canon.** `docs/architecture/MODKIT_ARCHITECTURE.md:2301`:
  "Define presentation-neutral viewer contribution/view-model contracts in `sdk` and the standard
  component, design-token, messaging, state, and plugin contracts in `ui` subpaths."
  Design tokens are named explicitly as a `ui` responsibility.
- **Existing dependency direction.** `modkitX3/packages/ui/package.json:65` declares dependencies
  on `@modkitx-x3/core` and `@modkitx-x3/sdk`. `ui → sdk` already holds; the inverse must not be
  created.
- **Open contribution registry.** `modkitX3/packages/sdk/src/manifest/contribution-contract-registry.ts`
  exposes `createContributionContractRegistry(entries)` with
  `DataOnlyContributionContractRegistration { mode: 'data-only' }`, so a theme contract needs a
  registration rather than new machinery.
- **Precedent for the drift gate.** `scripts/emit-schemas.mjs --check` at the workspace root and
  `packages/ui/scripts/generate-manifests.mjs --check` in this same package.
