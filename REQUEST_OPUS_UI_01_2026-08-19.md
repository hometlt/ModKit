# REQUEST OPUS-UI-01 — the Nexus themes (`nexus-forge`, `nexus-dominion`) as installable themes

Root: Fable. Date: 2026-08-19. Basis: `REPORT_NEXUS_UI_ADAPTATION_2026-08-19.md` (§3 mapping,
§4 decisions, §5 plan) — accepted by the owner; R-1 is landed, this is O-1.

## What is already in place (do not redo)

- Token contract v1 has `color.accent-muted-fg` (text on the accent wash) — 193 tokens,
  `tokens:check` green.
- `pnpm themes:check` (`scripts/check-themes.mjs`, in `pnpm check`): every
  `assets/themes/<id>/theme.css` must declare all 73 public tier-2 colour/shadow roles, use only
  its own `[data-mk-theme='<id>']` selector, declare `color-scheme`, keep `url(` inside
  `@font-face` pointing at existing `assets/fonts/...` files, and carry its own
  `@media (prefers-reduced-motion: reduce)` block if it animates. `sc2` passes it — use it as the
  reference for structure and for what a complete theme looks like.
- Fonts: `assets/fonts/saira/*.woff2` (latin, latin-ext) and `assets/fonts/jetbrains-mono/*.woff2`
  (latin, latin-ext, cyrillic, cyrillic-ext), OFL texts beside them, ready `@font-face` snippet in
  `assets/fonts/README.md`. Saira has **no Cyrillic** — keep a system family after it in the stack.
- Both hosts already copy every `assets/themes/<id>/theme.css` as `theme-<id>.css` next to
  `fonts/` and link all of them (`apps/electron/scripts/build-app.mjs`, `apps/web/scripts/build.mjs`).
  Adding a directory under `assets/themes/` is enough for the file to ship; you do not touch the
  build scripts.

## Deliverables

1. `assets/themes/nexus-forge/theme.css` and `assets/themes/nexus-dominion/theme.css`
   (`color-scheme: dark`), each:
   - all tier-2 appearance roles from REPORT §3 (the extracted forge/dominion values), tier-1
     ramps if you derive them (optional), `font.sans`/`font.mono` stacks + the `@font-face` rules
     from `assets/fonts/README.md`; `--mk-tree-row-height: 24px` and any other tier-3 override
     you need;
   - part decoration only via public `data-mk-part` (no component internals): titlebar + menus
     (mini-caps tracked labels, 2 px active edge), activity bar, sidebar/filetree (indent guides
     over `--mk-tree-indent-level`, 2 px selection bar), tabstrip/filetab (12 px slant clip, 2 px
     top border, kind dot), `operations.button` (9 px bevel clip, sweep on hover),
     `titlebar.button` (7 px bevel), `settings.*`/`search.input` fills, statusbar/`explorer.status`,
     `metadata.heading` mini-caps;
   - decor layer on `[data-mk-part='workbench']::before/::after` (drifting 64 px grid, scan line,
     3 px scanlines; Dominion adds the hex mesh + two blurred blobs) — gradients only, no images,
     `background-position`/`transform` animation only; every keyframe under the reduced-motion
     block;
   - nothing from `NexusForgeUI/` is copied: no `.dc.html` markup, no `support.js`, no inline
     `style=`, no external URLs.
2. Electron picker entries in `apps/electron/src/renderer.ts` `themes: [...]`
   (`{ id: 'nexus-forge', label: 'Nexus Forge' }`, `{ id: 'nexus-dominion', label: 'Nexus Dominion' }`)
   and a selftest extension: stamp each theme, assert `--mk-color-accent` changes to the theme's
   accent and the workbench decor animation name is present.
3. Live proof in both hosts (as S6/S7 did): the real Electron workbench and the PWA
   (`pnpm --filter @modkitx-x3/web-app app:serve`, `?open=./favicon-32.png`) under each theme —
   screenshots in your report; note anything the parts vocabulary could not reach.
4. `IMPLEMENTATION_NOTES.md` entry (what/proof/not-done) and a short report file.

## Rules and boundaries

- Scope you may edit: `assets/themes/nexus-*/**`, `apps/electron/src/renderer.ts` (picker list +
  selftest lines only), `IMPLEMENTATION_NOTES.md`, your report. Anything else (registry, gates,
  build scripts, `packages/ui` components/parts) — write it up as a request, do not change it.
  If a part is missing for something the design needs, say which and why; do not style through
  component internals.
- `pnpm check` must be green (incl. `themes:check`, `tokens:check`, `format:check`).
- Layout stays ours (compact titlebar, no docked inspector, no 52 px header) — REPORT §4.1.
- Commit only when the gates are green; Root reviews the diff.

## DoD

Both themes render the real workbench in Electron and the PWA; `themes:check` reports
3 complete themes; screenshots + notes; no byte of `NexusForgeUI/` in the tree.
