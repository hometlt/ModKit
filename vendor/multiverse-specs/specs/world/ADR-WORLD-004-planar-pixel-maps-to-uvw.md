# ADR-WORLD-004 — one frame form for flat pixel maps

Status: frame contract defined, 02.10.2026; each adapter requires qualification.
Registry form: `planar-pixel-grid-v1`; source IDs `ea/dune-2000` and
`starcraft1-map-native`. This is not a shared game decoder or a new map schema.

Native x grows east, native y south, native z up; a top-left pixel map is a
left-handed frame. UVW `(X,Y,Z)=(x,z,y)`, with the same inverse, determinant −1.
Rows stay in file order. A flat corner grid starts at `[0,0,0]`, with zero height
only when the native format has no height. For a W×H cell map the corner grid
is (W+1)×(H+1), so its last corner is `(W*32,0,H*32)`; the count does not change
native cell-centre or building-corner object anchors.

Both sources use 32 pixels per cell; SC1 also uses 8-pixel minitiles. Basis is
`source-unit`, `sourceUnit: pixel`, `unitsPerCell: 32`. No pixel-to-metre guess.
One form owns the mapping, row and origin rules; per-game records own cell sizes
and independently qualified receipts. TD/RA1 may use this form after their own
native conventions are established, not merely because they are 2D.

Dune's oracle: MIT D2kEditor `_renderer.pas`, cell `(c,r)` placed at pixel
`(32*c,32*r)`, atlas index `i` placed at `(i mod 20,i div 20)`; the game role
pins its reference revision, corpus and exact tuples. The oracle is named in
the request; Runtime has not rerun it and does not publish fabricated digests.
SC1 has no admitted independent oracle in this slice. Its role needs a native
game/minimap or accepted third-party differential; Dune's receipt cannot
qualify CHK decoding, sprite anchors, terrain heights or ramps for SC1.
