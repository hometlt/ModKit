# ADR-UI-001 — CSP contract for dynamic style values

Status: **Accepted** (2026-08-15, owner decision №2)
Applies to: `modkitX3/packages/ui`, every UI extension, every host adapter
Supersedes: the unqualified "no inline style" rule in MK-UI-KIT revision 1

## Context

MK3 viewers run under a strict policy. `packages/ui/src/viewer/index.ts:16` declares
`default-src 'none'; script-src 'self'; style-src 'self'` with no `unsafe-inline`.

Revision 1 of the UI-kit plan asserted a blanket "no inline style" rule and, separately, proposed
passing dynamic values "through CSS custom properties set on a container". Those two statements are
only compatible if the mechanism is named, and it was not. The audit correctly rejected the
ambiguity, and additionally claimed that `element.style` is inline styling and therefore blocked.

Interactive components need genuinely continuous values: splitter widths, zoom, scroll offsets,
progress, graph coordinates. If every such value were blocked, the shell could not be built at all.

## Decision

Three rules, not one.

**C1 — the style attribute is forbidden.**
No `style="…"` in authored markup, no `setAttribute('style', …)`, no `innerHTML` carrying one.
Lint-enforced.

**C2 — runtime stylesheet injection is forbidden.**
No dynamically created `<style>` element, no runtime injection of CSS text. Components never
inject styles; the host links one built stylesheet.

**C3 — continuous values travel as validated custom properties.**
Dynamic values are set only via `element.style.setProperty('--mk-*', validatedValue)` on an element
the component owns, and are consumed by predeclared rules in the shipped stylesheet. Property names
and value types are validated against the token registry (ADR-UI-002). Finite states use
`data-mk-state` / ARIA plus predeclared rules, never a computed value.

C1 and C2 are directive-level bans, so they must be stated on the policy, not merely observed:
`style-src-attr` does **not** inherit from `style-src`, and omitting it leaves the `style` attribute
allowed. Both are declared on `VIEWER_CSP` in `packages/ui/src/viewer/index.ts`, which is the single
source the harness and every host derive their header from.

Two explicit exclusions, both narrower than what Chromium technically permits:

- **Direct CSS properties are not a public mechanism.** `element.style.paddingLeft`,
  `.marginTop` and similar pass in Chromium but are not part of the contract. Only `--mk-*`
  custom properties are permitted under C3.
- **`CSSStyleSheet`/`insertRule` are not in the production contract.** CSP Level 3 associates CSS
  parsing and `insertRule` with `unsafe-eval`, so the Chromium observation cannot be assumed
  portable. They may be reconsidered with per-engine evidence; they are not available now.

### Host exclusion: the trusted in-process code editor

`VIEWER_CSP_TRUSTED_EDITOR` relaxes both C1 and C2 — `style-src 'unsafe-inline'` and
`style-src-attr 'unsafe-inline'` — for a host that embeds the first-party Monaco backend. Measured,
not assumed: the editor themes itself through an injected stylesheet (C2) and positions every
visible line through a `style` attribute carrying its computed `top` and `height` (C1). Under the
strict policy the attributes are refused, the lines never reach their positions, and the text
visibly jumps as the view scrolls. It does **not** need `script-src 'unsafe-eval'`.

The exclusion is scoped to the application host that ships the editor. Untrusted third-party viewers
keep `VIEWER_CSP` and run in a restricted frame (BRIEF-13C §6), so the relaxation never reaches
them. Because a relaxed page can no longer demonstrate C1/C2 at runtime, first-party conformance is
proven statically instead: the gallery build fails on any `setAttribute('style')` or
`createElement('style')` in `packages/ui/src`, which does not depend on the page policy.

## Consequences

- The shell, splitters, zoom, progress and graph layout are implementable without weakening CSP.
- Every dynamic value must have a registered token, which makes the styling surface enumerable and
  themeable by construction rather than by convention.
- A component that needs a value with no registered token must add the token first. This is
  intentional friction.
- The permitted surface is deliberately narrower than the measured browser behaviour. Where the
  contract and the engine disagree, the contract wins.

**Host compatibility.** Chromium evidence covers the Electron renderer and the VS Code webview,
so those hosts are unblocked now. The **browser host must not be declared compatible** until Gecko
and WebKit are measured. That matrix does not block the start of UK-1 but is **mandatory before
UK-1 exits**.

## Alternatives considered

| Alternative                                          | Rejected because                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Allow `unsafe-inline` for styles                     | Discards the policy that makes untrusted viewers safe                                          |
| Host-generated external stylesheet per dynamic value | Unnecessary once C3 is measured to work; a network/asset round trip per drag frame             |
| Nonce-bearing style block owned by the host          | Changes the CSP contract for every host to solve a problem C3 already solves                   |
| CSS Typed OM                                         | Same CSSOM path as C3 with narrower engine support and no added capability                     |
| Constructed stylesheets + `adoptedStyleSheets`       | Measured working on Chromium, but CSP3 ties CSS parsing to `unsafe-eval`; portability unproven |

## Evidence

Probe: `scripts/uk-a/csp-probe.html`, served over http (not `file://`, where `'self'` does not
resolve normally), under `default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'none'`.

```bash
npx --yes http-server scripts/uk-a -p 8731
```

Chromium, recorded 2026-08-15:

| #   | Mechanism                                    | Applied | Violation        |
| --- | -------------------------------------------- | ------- | ---------------- |
| 1   | `el.style.setProperty('--tok', …)`           | yes     | none             |
| 2   | `el.style.setProperty('padding-left', …)`    | yes     | none             |
| 3   | `el.style.marginTop = …`                     | yes     | none             |
| 4   | `new CSSStyleSheet()` + `adoptedStyleSheets` | yes     | none             |
| 5   | `sheet.insertRule(…)`                        | yes     | none             |
| 6   | `el.setAttribute('style', …)`                | **no**  | `style-src-attr` |
| 7   | `style="…"` in parsed markup                 | **no**  | `style-src-attr` |
| 8   | dynamic `<style>` element                    | **no**  | `style-src-elem` |

Mechanisms 2, 3, 4 and 5 are measured working but deliberately excluded from the contract, per
the exclusions above.

- Policy source: `modkitX3/packages/ui/src/viewer/index.ts:16`
- CSP Level 3: https://www.w3.org/TR/CSP3/

## Verification

A real-browser CSP conformance test asserts the exact allow/block split above, per host
(VS Code webview, Electron renderer, browser) and per engine (Chromium, Gecko, WebKit).
Gecko and WebKit are unverified as of this record and gate UK-1 exit.
