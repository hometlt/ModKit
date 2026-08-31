# @modkitx-x3/code

Built-in code workspace for MK3 applications, with Monaco as its browser editor implementation.
The runtime contribution remains **trusted in-process only**.

## Composition boundary

The package is a built-in product module rather than an Extension Manager artifact. Applications
opt into `codeModule` with an explicit import, and hosts without the `editor.monaco` capability do
not activate its stage. This keeps Monaco out of headless and minimal builds while languages and
LSP implementations continue to arrive through format-neutral contributions.

## CSP

Measured, not assumed:

| Policy                                                | Editor constructs | Text renders | Theme applies                                       |
| ----------------------------------------------------- | ----------------- | ------------ | --------------------------------------------------- |
| `script-src 'self'; style-src 'self'`                 | yes               | yes          | **no** — the ~140 KB injected stylesheet is refused |
| `script-src 'self'; style-src 'self' 'unsafe-inline'` | yes               | yes          | yes (900 rules)                                     |

`script-src 'unsafe-eval'` is **not** required. Hosts embedding this backend serve
`VIEWER_CSP_TRUSTED_EDITOR` from `@modkitx-x3/ui/viewer`, which adds `style-src 'unsafe-inline'`
and changes nothing else. Untrusted third-party viewers keep `VIEWER_CSP` and stay in a restricted
frame (BRIEF-13C §6), so the relaxation does not reach them.

## Theme

`defineTheme` maps the Modkit token palette onto a Monaco theme, so the editor follows the host
theme rather than shipping its own colours.
