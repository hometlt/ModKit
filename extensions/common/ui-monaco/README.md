# modkit-extension-x3-ui-monaco

Monaco code-editor backend for the MK3 code stage. **Trusted in-process only.**

## Why this is an extension, not part of `packages/ui`

Monaco is ~5 MB bundled. A VS Code webview must never load it — the host already has an editor —
so the backend ships separately and is selected by the `editor.monaco` host capability. A host that
does not declare that capability resolves a different code backend and never pulls this in.

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
