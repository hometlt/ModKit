# ADR-WORLD-007 — Diablo III and Earth evidence boundaries

Status: Diablo III frame defined, Earth numeric contract incomplete, 02.10.2026.
No new installed-file qualification or physical metre scale is claimed.

Diablo III registry ID `diablo3-scene-native`: `(x,y,z) → (x,z,-y)`, inverse
`(x,-z,y)`, right-handed z-up to right-handed y-up. `diablo3-world-unit` retains
unknown physical scale. Mesh scenes do not acquire an invented heightfield.
Navigation cell-centre origins transform exactly once. The current adapter's
2.5 cell-spacing fallback is not an independent measurement and is intentionally
absent from the registry. The model viewer's estimated 0.228 m/unit is not a
declared game scale. GAME-DIABLO needs a scene/native oracle or a qualified
game-data reference; approximate nav-height/mesh intersections establish only
their stated tolerance and coverage, not an exact full-terrain receipt.

Earth reserved IDs `earth2150-map-native` and `earth2160-map-native` are in
`unmeasuredWorldSources`: one 2150 cell unit versus 256 2160 coordinate units
per cell. `parked/game-earth/re/maps-findings.md` still marks north-first rows
and vertical scales partly inferred. No guessed handedness, height or full
mapping is published. The 2160 game BMP is useful evidence for horizontal axes
and row order; it proves no vertical encoding. GAME-Earth must pin the BMP/LND
corpus, demonstrate paired horizontal orientation, and separately establish
height decoding. A horizontal-only preview proof needs an explicit narrow
scope; the current full XYZ adapter proof cannot stand for that scope.

Evidence supplied by a game can unblock its own qualification. Neither a
similar engine nor the presence of an ID in this registry substitutes for it.
