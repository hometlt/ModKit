# ADR-WORLD-003 — Warcraft III map-native frame

Status: frame contract defined, 02.10.2026; native adapter qualification required.
Registry: `warcraft3-map-native`. No installed-corpus digests are claimed here.

Warcraft III's W3E source frame is right-handed, x east, y north, z up. A grid
corner `(c,r)` has native XY `centerOffset + [c,r] * 128`; row zero is south.
Its canonical position is `(x,z,-y)`, inverse `(x,-z,y)`, determinant +1.
Serialized UVW rows advance along +Z and read source rows in reverse:

```
cellSize = 128
origin = [centerOffset.x, 0, -(centerOffset.y + (rows-1)*128)]
```

Unit: `source-unit`, `sourceUnit: warcraft3-world-unit`, `unitsPerCell: 128`;
no physical metre factor. Bounds come from transformed corners. Objects,
rotations, water and cliff meshes use the same source-to-world frame once.

The accepted third-party oracle is MIT `references/mdx-m3-viewer`:
`src/viewer/handlers/w3x/map.ts` sets corner height to
`groundHeight + layerHeight - 2`; ground shader positions multiply by 128.
This defines the baseline terrain differential. The optional Warsmash ramp
half-level adjustment is a separate presentation/game rule and a separate test;
it is not silently added to the baseline oracle (owner decision 01.10).

GAME-WARCRAFT3 publishes its native W3E/corpus digests and exact XYZ streams in
its receipt using `third-party-reference-differential`. Runtime's algebraic
tests do not stand in for that installed-file proof. No new parser or renderer
is required; Core keeps the existing transform/qualification owner.
