# ADR-WORLD-006 — SAGE map-native frame

Status: frame contract defined, 02.10.2026; per-game/version qualification required.
Registry: `sage-map-native`.

Native frame: right-handed, x east, y north, z up. Stored row zero is south.
The definition follows the publisher's Generals `MAP_XY_FACTOR` (10) and the
SAGE role's terrain findings (KW1); it does not claim all SAGE variants qualified.

```
x = (column-border)*10; y = (row-border)*10
UVW = (x,z,-y); inverse = (x,-z,y)
sourceRowOrder = reverse; cellSize = 10
origin = [-border*10, 0, -((rows-1-border)*10)]
```

This origin covers the full stored grid. Cropping the border is explicit and
recomputes origin from the cropped first corner. A layer API delivering north
first must not be reversed twice just because native bytes are south first.
Height decoding belongs to each version: do not generalize one u8/u16 scale
to every SAGE source. Unit is `sage-world-unit`, 10 per cell, no metre factor.

GAME-SAGE supplies a versioned real-map corpus and exact XYZ receipt. Released
Generals source can establish grid scale; water/terrain intersection statistics
only corroborate orientation, not exact height equivalence. A KW receipt is
not an RA3/C&C4/Generals certificate. Licensing of source references is preserved.
