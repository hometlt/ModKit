# Adapting the NexusForgeUI design into the lab UI — assessment (Root/Fable, 2026-08-19)

Scope: `NexusForgeUI/*.dc.html` (18 screens, foreign export, untracked, read-only here) → the
lab's UI system (`packages/ui` tokens/parts, `assets/themes/*`, the four hosts). This is an
assessment with a concrete plan, not an implementation. It builds on Opus's §2.5/Stream D of
`REPORT_AND_PLAN_MK2_AND_UI_2026-08-19.md` and replaces its "coverage hypothesis" with an
inventory taken from the files themselves.

## 1. What the design export is (facts, not names)

Inventory script over all 18 files (read-only; counts are occurrences in markup):

| fact               | value                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format             | template components (`<x-dc>`, `<sc-if>/<sc-for>`, `{{ }}`, `style-hover=`), rendered by `support.js` (68 KB) + `image-slot.js`; every visual value is an inline `style=""`                                                                                                                                                                                                                                                                  |
| shell              | `Nexus IDE.dc.html`: grid `52px / 1fr / 28px`; header = logo + menus + theme picker + `▶ RUN` + command buttons + clock + window buttons; main = icon rail (28 px buttons) · project tree (250 px, 24 px rows, indent guides, 2 px selection bar) · editor columns/groups with slanted tabs · inspector (318 px); footer = git/diagnostics/meta/clock                                                                                        |
| screens            | 16 viewer/editor screens are `dc-import`ed by the shell; `Nexus IDE v1.dc.html` is a superseded hard-coded draft (80 hex literals) — ignore it                                                                                                                                                                                                                                                                                               |
| theming discipline | 17 of 18 screens draw every colour from one `pal(theme)` object; hard-coded colours in markup are 0–3 per screen (shadows `#000`, white veils). The design is already token-shaped                                                                                                                                                                                                                                                           |
| theme vocabulary   | 39 keys total. Core, used across screens: `line`155 `dim`139 `line2`123 `faint`85 `pnl2`73 `acc`68 `accTxt`66 `fill`61 `pnl`47 `accS`38 `info`21 `bg`16 `warn`15 `txt`15 `alt`15 `accBg`14 `err`13. Shell-only: `stage menuBg headerBg bgGrad gridLine scanline bevel bevelSm tabClip logoClip dotClip animPulse animSweep head`. Document previews only: `paper paperTxt paperHead paperDim paperLine paperQuote deskBg`. One-off: `accBg2` |
| themes             | `forge` (lime `#b6f04a` on carbon), `dominion` (amber `#f0a02a` on navy), `vscode-dark`, `vscode-light`; the two VS Code variants switch **off** every bevel/clip/animation — they are our `modkit-dark`/`modkit-light`, nothing to port                                                                                                                                                                                                     |
| typography         | Saira (UI) + JetBrains Mono (data), loaded from Google Fonts. Sizes: 10 px×153, 11 px×124, 12 px×54, 9 px×22, 13 px×12, 14 px×9, display sizes only inside doc/slide previews. Weight 700×155, 600×14, 500×2. Tracking: `.3em`×56 (mini-caps section labels), `.12–.2em` on controls and tabs                                                                                                                                                |
| shapes             | clip-path polygons: control bevel (9 px cut), small bevel (7 px), tab slant (12 px), hex emblem, diamond marker; `border-radius` only `50%` for dots — the language is square, no rounded corners                                                                                                                                                                                                                                            |
| motion             | 20 keyframes: sweep, pulse, blink, scan, spin, marching ants, glow, grid drift, hex drift, blobs; background decor = drifting 64 px grid + scan line + 3 px scanlines (+ hex mesh and blurred blobs for Dominion), all gradients, no images                                                                                                                                                                                                  |

## 2. What the lab already has (the channel is built)

- **Tokens** (ADR-UI-002): `packages/ui/src/tokens/registry.ts` — tier 1 palette ramps, tier 2
  semantic roles (`color.bg/surface/raised/sunken/overlay`, `fg*`, `border*`, `accent*`,
  `status.*`, `font.*`, `space.*`, `radius.*`, `size.*`, `motion.*`, `z.*`, `chart.*`, canvas /
  graph / diff roles), tier 3 component tokens deriving from tier 2 (`tree.row-height`,
  `shell.rail-width`, `toolbar.height`, …). Emitted to `tokens.generated.css` +
  `token-contract.v1.json`, guarded by `tokens:check`. Values are validated by type and reject
  `url(` — fonts cannot travel as tokens.
- **Themes**: `[data-mk-theme]` on the root; bare `:root` carries the complete light palette,
  `:root:not([data-mk-theme])` follows the OS, `modkit-dark/light/high-contrast` and
  `vscode-adapter` are generated. **Installable themes are plain stylesheets**:
  `assets/themes/sc2/theme.css` (626 lines) redefines tier-1/2 tokens under
  `[data-mk-theme='sc2']` and decorates public parts (`titlebar`, `explorer.*`, `filetree.row`,
  `operations.button`, `settings.*`) with uppercase tracked labels, sweeps, a scan line — exactly
  the shape of the Nexus themes. Electron copies it (`build-app.mjs`), lists it in the settings
  picker (`renderer.ts` `themes: [...]`), and `applyTheme` stamps the attribute.
- **Parts**: `packages/ui/src/parts.ts` — 224 audited parts. Every shell element of the design
  has a hook: `workbench.titlebar/activitybar/sidebar/main/panel/statusbar`, `titlebar.menu*`,
  `explorer.tabstrip/filetab/filetab-close/group/split/stage/viewpicker`, `filetree.row/twisty/
label/badge/toolbar` (+ runtime token `tree.indent-level` for indent guides), `metadata.*` and
  `card.*` (inspector), `operations.button` (RUN / command buttons), `shell.status-item`,
  `search.input`, `settings.select` (theme picker), `viewer.toolbar/status`, `transport.*`.
- **Hard constraints** (`packages/ui/src/viewer/index.ts` `VIEWER_CSP`): `style-src-attr 'none'`
  (no inline `style=""` — the whole export is inline styles), `font-src 'self'` (no Google Fonts),
  `script-src 'self'` (no `support.js` in a page). Reduced motion: `base.css` neutralises
  animations under `.modkit-viewer` (the workbench root has that class); decor placed on `body`
  or `:root` (as `sc2` does for its scan on `body::before`) is **outside** that guard.

Conclusion: **the design's visual language maps onto the existing theme mechanism 1:1; nothing
of its markup or runtime is needed.** The work is two theme stylesheets, two font families and a
handful of decisions.

## 3. Mapping — design `c.*` → lab tokens/parts

Values below are the design's `forge` / `dominion` palettes; the middle column is where each
lands. "part" means the theme paints it on a `data-mk-part` (as `sc2` does), not a token.

| design key                                           | lands on                                                                                                                                                                          | forge → dominion                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `bg`                                                 | `color.bg`                                                                                                                                                                        | `#07090b` → `#06090d`                                 |
| `pnl` (panel ground)                                 | `color.surface`                                                                                                                                                                   | `#0b1012` → `#0c141b` (design uses α e6 over decor)   |
| `pnl2` (headers/footers)                             | `color.raised`                                                                                                                                                                    | `#0e1417` → `#101b24`                                 |
| `fill` (inputs, control fill)                        | `color.sunken`                                                                                                                                                                    | `#111719` → `#0f1a22`                                 |
| `menuBg`                                             | `color.overlay`                                                                                                                                                                   | `#0d1316` → `#0e1a23`                                 |
| `stage` (editor ground)                              | part: `explorer.stage` / editor background (or `color.bg`)                                                                                                                        | `#080c0e` → `#070d12`                                 |
| `txt`                                                | `color.fg`                                                                                                                                                                        | `#b7c7cb` → `#c2d3de`                                 |
| `head` (titles)                                      | part: `titlebar.title`, `metadata.heading` (no `fg-strong` role; do not add one for one use)                                                                                      | `#e7f2ea` → `#e6f0f7`                                 |
| `dim` / `faint`                                      | `color.fg-muted` / `color.fg-subtle`                                                                                                                                              | `#a7babe`/`#87999e` → `#abc1cf`/`#8aa4b3`             |
| `line` / `line2`                                     | `color.border` / `color.separator`                                                                                                                                                | `#1e272b`/`#141c1f` → `#22384a`/`#17232d`             |
| `acc`                                                | `color.accent`, `color.focus`, `color.drop-target`; `color.accent-fg` = dark ground for solid fills                                                                               | `#b6f04a` → `#f0a02a`                                 |
| `accS` (accent 33 %)                                 | `color.border-strong`; elsewhere `color-mix(in srgb, var(--mk-color-accent) 33%, transparent)`                                                                                    | `#b6f04a55` → `#f0a02a55`                             |
| `accBg` / `accTxt`                                   | `color.accent-muted` / **gap** — text on the accent wash (see §4.2)                                                                                                               | `#141c10`/`#dcf7a4` → `#241a0c`/`#ffd79a`             |
| `warn` `err` `info`                                  | `status.warn` / `status.error` / `status.info` (+ their `-fg/-bg/-border` derivations)                                                                                            | `#ffb545 #ff5a4f #6ee7ff` → `#ffcf5a #e0483c #57b6ff` |
| `alt` (violet dot / token)                           | `chart.categorical-5` where decorative; Monaco theme for code tokens — no new role                                                                                                | `#b48cff` → `#9fd0ff`                                 |
| selection bar, tab top border                        | `color.selection`, `color.selection-inactive`, part borders                                                                                                                       | accent / border                                       |
| `headerBg` `bgGrad` `gridLine` `scanline`            | part decor: `workbench.titlebar` background; `[data-mk-part='workbench']::before/::after` for grid + scan + scanlines (inside `.modkit-viewer`, so reduced-motion applies)        | gradients as in `pal()`                               |
| `bevel` `bevelSm` `tabClip` `logoClip` `dotClip`     | part decor: `operations.button`, `titlebar.button`, `explorer.filetab`, brand mark, status dot — plain `clip-path` in the theme; **no** `shape` token type needed                 | polygons as in `pal()`                                |
| `animPulse` `animSweep` (+ per-screen sweeps/blinks) | theme keyframes on parts, like `mk-sc2-sweep`; guarded                                                                                                                            | —                                                     |
| `paper*` `deskBg`                                    | defer: tier-3 `document.paper-bg/fg/heading/rule/quote`, `document.desk-bg` when the document viewer exists (Stream B doc codecs / D6)                                            | —                                                     |
| `accBg2`                                             | derived (`color-mix`)                                                                                                                                                             | —                                                     |
| fonts                                                | `font.sans` = Saira stack, `font.mono` = JetBrains Mono stack, `@font-face` **in the theme file**, files under `assets/fonts/`                                                    | —                                                     |
| sizes/weights/tracking                               | theme may set `font.size-*`/`font.weight-*`; uppercase + tracking painted on label parts (`metadata.heading`, `explorer.header`, `settings.group`, buttons) as `sc2` already does | 10/11/12 px, 700                                      |
| tree row 24 px                                       | `--mk-tree-row-height` override (tier 3, allowed)                                                                                                                                 | 24px                                                  |
| header 52 px / footer 28 px                          | workbench grid reads `--mk-toolbar-height` / `--mk-size-control`; changing those moves every toolbar → not a theme decision (see §4.4)                                            | —                                                     |

## 4. What does not map by itself — decisions

1. **Layout is not theming.** The 52 px header with `▶ RUN`, clock and window buttons, the
   right-docked persistent inspector, and the "CORE LOAD" widget are workbench structure. The
   Nexus _look_ lands on our current shell (compact titlebar, activity bar, sidebar, tab groups,
   status bar); the inspector is our `metadata` viewer in a split group today. Recommendation:
   keep the structure; if a tall header / docked inspector is wanted, that is a workbench feature
   with its own tokens (`shell.titlebar-height`, `shell.statusbar-height`, a `workbench.inspector`
   part) — an Opus UI slice, separate from the themes.
2. **One real token gap:** `accTxt` — text on the accent _wash_ (`accBg`). The design's primary
   button is "wash + light text + translucent edge", not "solid fill + inverse text"; we have
   `color.accent-muted` but no role for its text. Recommendation: add tier-2
   `color.accent-muted-fg` (registry, generator, values in the three shipped palettes, `sc2` gets
   one too) — additive to contract v1. Everything else is theme-level decoration.
3. **Fonts.** Saira and JetBrains Mono are SIL OFL 1.1 (verify the licence text at vendoring
   time and ship it beside the files). Vendor woff2 latin+cyrillic subsets (Saira 400/500/600/
   700 + JetBrains Mono 400/500/700 ≈ 250–350 KB) under `assets/fonts/`, `@font-face` inside the
   theme stylesheets, `font-display: swap`. Each host already copies theme CSS beside the app
   (`font-src 'self'` holds; PWA offline cache included; VS Code via `asWebviewUri`).
   Alternative if size matters: themes take palette/shape/motion only and keep the system stacks.
   **Owner decision: vendor the fonts (my recommendation: yes for Electron and the PWA).**
4. **Theme completeness.** A custom theme only overrides what it sets; the rest resolves to the
   _light_ base on `:root`. Structure (spacing, sizes, z-index, motion timing, font stacks) may be
   inherited on purpose; appearance roles may not. _Correction after building the gate (R-1):_ my
   first reading — "`sc2` sets 72 tokens and inherits light canvas/graph/diff/chart roles" — was
   wrong; `sc2` did set those and missed only `color.axis-x/y/z` (now added). The gate,
   `themes:check` (`scripts/check-themes.mjs`, in `pnpm check`), requires every public tier-2
   token of type `color`/`shadow` (73 today), the theme's own `[data-mk-theme='<dir>']` selector,
   `color-scheme`, `url(` only inside `@font-face` pointing at existing `assets/fonts` files, and
   an own `@media (prefers-reduced-motion: reduce)` block for any theme that animates — `sc2`'s
   body-level decor sits outside `base.css`'s `.modkit-viewer` guard, so it now carries one.
5. **Ids.** `data-mk-theme='nexus-forge'` / `'nexus-dominion'` (namespaced; both `appearance: dark`),
   listed in the Electron picker next to `sc2`; the PWA links them and gets the picker when the
   settings UI lands there; VS Code stays on `vscode-adapter`/`modkit-dark` (host theme rules).
6. **What we deliberately do not take**: `support.js`, `image-slot.js`, any `.dc.html` markup;
   inline styles; Google Fonts; the `v1` draft; the vscode-* variants.

## 5. Plan and split

| step | owner | what                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | DoD                                                                                                                                                                             |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Root  | _done 2026-08-19_: `color.accent-muted-fg` in the registry + generator + 3 palettes (+ `sc2`); `themes:check` gate over `assets/themes/*/theme.css` (all public tier-2 colour/shadow roles declared, own selector, `color-scheme`, no `url(` outside `@font-face`, reduced-motion block when animating) with tests, in `pnpm check`; `sc2` complete under it; Saira + JetBrains Mono woff2 subsets and OFL texts under `assets/fonts/` (144 KB; Saira has no Cyrillic — see `assets/fonts/README.md`); Electron and PWA builds copy every theme + `fonts/` and link the themes                                                                                                                                                                                              | `pnpm check` green with the new gate; `sc2` complete                                                                                                                            |
| O-1  | Opus  | **UI-01 "Nexus themes"**: `assets/themes/nexus-forge/theme.css` and `assets/themes/nexus-dominion/theme.css` — full tier-1/2 coverage from §3, part decoration (titlebar + menus, activity bar, sidebar/filetree with indent guides + selection bar, tabstrip/filetab slant + top border + kind dot, `operations.button` bevel + sweep, settings/select, statusbar, `metadata` mini-caps headings, search input), decor layer on `workbench::before/::after` (grid drift, scan line, scanlines; hex mesh + blobs for Dominion), keyframes under a reduced-motion guard, `@font-face` Saira/JetBrains Mono; register both in the Electron picker and the PWA build; extend the Electron selftest (switch theme → `--mk-color-accent` changes, decor animation names present) | both themes render the real workbench in Electron and the PWA (screenshots in the report), `pnpm check` incl. `themes:check` green, no `.dc.html`/`support.js` byte in the tree |
| O-2  | Opus  | later, on demand: `document.*` paper tokens with the document viewer; `shell.titlebar-height`/`statusbar-height` + `workbench.inspector` if the tall-header/docked-inspector layout is approved; a VS Code webview option                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | per item                                                                                                                                                                        |

Effort: R-1 ≈ half a day; O-1 ≈ 1–2 days for both themes including the live proofs (`sc2` is
626 lines; each Nexus theme will be of that order plus fonts). Not blocked by MK2 streams A–C.

## 6. Method note

The inventory numbers come from a read-only script over the 18 files (theme keys, sizes,
tracking, weights, clip-paths, keyframes, hard-coded colours, imports); the shell was also
rendered through its own runtime from a local read-only server to confirm the composition
(rail, tree, 15 tabs, editor, inspector). No file under `NexusForgeUI/` was modified.
