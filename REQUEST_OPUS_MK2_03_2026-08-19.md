# REQUEST OPUS-MK2-03 — port wave 2 (no new contracts), `src/<id>/` ownership, promotion rule

Root: Fable. Date: 2026-08-19. Basis: `REPORT_MK2_CONVERSION_2026-08-19.md` §11–§12 (Root
decisions). Sequencing: after `REQUEST_OPUS_UI_01_2026-08-19.md`; runs in parallel with Root's S8
(binary write/edit contract family) — do **not** wait for S8 and do not port anything that needs it.

## Deliverables

1. **Converter rule §7.7**: the whole `src/<id>/` directory of a hand-ported codec belongs to the
   human — the converter neither regenerates nor deletes files under it (drift detection skips the
   directory, not just `codec.js`). The three Ogg page readers may become one shared module per
   extension. `convert:mk2 --check` stays byte-stable; test the rule.
2. **Wave 2 ports**: the next ≥ 12 codecs from the `mechanical`/`rework` baskets that need no new
   contract, chosen by provability — real corpus first (`.glb .svg .swf .mix .webp .mp3` samples
   exist), synthetic second (`gen-synthetic-corpus.mjs` may grow; keep `--check`). Each port:
   `probe/open` honest to the bytes, data sources published, acceptance case green, `portState`
   - notes updated by the converter, a standard viewer mounts (the only "viewer" criterion — §12.1).
3. **Promotion rule (§12.4) as data**: `MK2-CONVERSION.json` gets `promotion: 'none' |
'candidate'` per codec (default `none`); nothing under `extensions/mk2/**` enters any app
   catalog. Document the rule in the generated README.
4. Report: counters (ported / blocked-by-S8 / remaining), findings, owner items; `pnpm check`
   green; commit when green (Root reviews).

## Rules

Scope: `scripts/convert-mk2.mjs`, `scripts/lib/**`, `scripts/test/convert-mk2*`,
`packages/testkit/scripts/**`, `packages/testkit/test/fixtures/mk2-synthetic/**`,
`extensions/mk2/**`, your report, `IMPLEMENTATION_NOTES.md` entry. Not yours: `packages/sdk`,
`packages/host`, `apps/**`, `extensions/common/**`, gates. No `\0` bytes in sources; no
`capability` as a key (legacy gate); no imports from `modkitx` (read-only sibling).
