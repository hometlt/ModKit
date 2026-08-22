# Vendored fonts (R-1, 2026-08-19)

Self-hosted typefaces for installable themes. `VIEWER_CSP` allows `font-src 'self'` only, so a
theme never links a font service: it declares `@font-face` with `src: url('./fonts/<family>/…')`
(the only place `url(` is allowed in a theme — `themes:check` verifies the file exists here), and
each host copies this directory beside the app as `fonts/`.

Both families are licensed under the SIL Open Font License 1.1; the licence text ships in each
directory (`OFL.txt`) and must stay with the files. Files are the variable-weight (`wght` 400–700)
woff2 subsets served by Google Fonts (CSS API v2, 2026-08-19); a subset covers one `unicode-range`
and browsers download only what the page's text needs.

| file                                               | family             | subset       | source (Google Fonts static host)                                                                                          | SHA-256                                                            |
| -------------------------------------------------- | ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `saira/saira-latin.woff2`                          | Saira v23          | latin        | `https://fonts.gstatic.com/s/saira/v23/memjYa2wxmKQyPMrZX79wwYZQMhsyuSLiIvS.woff2`                                         | `7eb811eb14b2ee22e3fba942b25c6cd062ff050bde10d29af1a4e16f99712e17` |
| `saira/saira-latin-ext.woff2`                      | Saira v23          | latin-ext    | `https://fonts.gstatic.com/s/saira/v23/memjYa2wxmKQyPMrZX79wwYZQMhsyuSLhovSZSk.woff2`                                      | `cbdb7074cd38a4bf09bf34012dd3072bf34ccc6ad95a2ebf2ebf3eac9484edf1` |
| `jetbrains-mono/jetbrains-mono-latin.woff2`        | JetBrains Mono v24 | latin        | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2`   | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |
| `jetbrains-mono/jetbrains-mono-latin-ext.woff2`    | JetBrains Mono v24 | latin-ext    | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2` | `db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52` |
| `jetbrains-mono/jetbrains-mono-cyrillic.woff2`     | JetBrains Mono v24 | cyrillic     | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2` | `e17cfd15fb96909d64095015f958207063a0c07191da3512df7d560a781aebdf` |
| `jetbrains-mono/jetbrains-mono-cyrillic-ext.woff2` | JetBrains Mono v24 | cyrillic-ext | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2` | `62213be8a78b42f1e29d1452d91e2f8b3e745572a9dd98d3941e39fa00b37d76` |

Licences: `saira/OFL.txt` (Copyright 2020 The Saira Project Authors, Omnibus-Type),
`jetbrains-mono/OFL.txt` (Copyright 2020 The JetBrains Mono Project Authors). Total 144 KB.

**Coverage note.** Saira has no Cyrillic subset (Google Fonts serves latin, latin-ext,
vietnamese only). JetBrains Mono covers Cyrillic fully. The PWA's Russian locale exposes those two
vendored subsets under the UI-only family `Modkit Cyrillic UI` and places it immediately after
Saira, so Cyrillic interface text has an explicit self-hosted face rather than an accidental
system fallback. Latin labels stay in Saira; code and numeric surfaces keep the ordinary
`JetBrains Mono` family.

## `@font-face` for theme authors

Copy into the theme stylesheet (paths are relative to the theme file as the hosts serve it — the
theme CSS and `fonts/` sit side by side in every app's output directory).

```css
@font-face {
  font-family: 'Saira';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/saira/saira-latin.woff2') format('woff2');
  unicode-range:
    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
    U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Saira';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/saira/saira-latin-ext.woff2') format('woff2');
  unicode-range:
    U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329,
    U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F,
    U+A720-A7FF;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/jetbrains-mono/jetbrains-mono-latin.woff2') format('woff2');
  unicode-range:
    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329,
    U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/jetbrains-mono/jetbrains-mono-latin-ext.woff2') format('woff2');
  unicode-range:
    U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329,
    U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F,
    U+A720-A7FF;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/jetbrains-mono/jetbrains-mono-cyrillic.woff2') format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/jetbrains-mono/jetbrains-mono-cyrillic-ext.woff2') format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
```

Then, still inside the theme's `[data-mk-theme='…']` block:

```css
--mk-font-sans: 'Saira', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
--mk-font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
```
