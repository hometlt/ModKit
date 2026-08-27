# ADR-WORLD-001 — StarCraft II map-native terrain to UVW

**Status:** accepted for the UVW candidate, 2026-08-27  
**Admission effect:** closes the SC2 coordinate, source-unit and origin proof gaps; does not mint
`world-interchange-v1`, which still requires an independent second game family

## Context

StarCraft II stores a row-major HMAP and supplies its numeric transform in `t3Terrain.xml`.
Modkit's sealed predecessor already converted those values into world-space terrain vertices. The
full-program acceptance rule treats that output as the differential oracle rather than allowing a
new converter to guess axes, height arithmetic or origin.

Blizzard does not publish a physical metre scale for these map values. The grid spacing is still a
measured fact, and the coordinate contract must retain it without turning it into an invented
physical claim.

## Decision

For an HMAP sample `(column, row, heightBase, heightAdjustment)`, the exact SC2 map-native position
is:

```text
x = offset.x + column * scale.x
y = offset.y + row * scale.y
z = (heightBase * quantizeScale - quantizeBias) * scale.z
    + offset.z
    + (heightAdjustment * quantizeScale - quantizeBias)
```

`standardHeight` is metadata and is not part of this equation.

The measured SC2 map-native frame is right-handed, with `+X` east/right, `+Y` north/forward and
`+Z` up. It reaches canonical UVW by the handedness-preserving mapping:

```text
(x, y, z) -> (X, Y, Z) = (x, z, -y)
```

UVW heightfield rows advance along canonical `+Z`, so output row `j` reads source row
`rows - 1 - j`. For a rectangular grid its origin and spacing are:

```text
origin = [offset.x, 0, -(offset.y + (rows - 1) * scale.y)]
cellSize = scale.x, only when scale.x exactly equals scale.y
```

The heightfield samples are the absolute canonical `Y` values produced by the equation above;
`origin.y` is a zero datum and is not added a second time. Bounds are recomputed from the converted
positions, not by relabelling native min/max fields.

The basis is:

```json
{
  "handedness": "right",
  "upAxis": "y",
  "forwardAxis": "+z",
  "unit": "source-unit",
  "sourceUnit": "sc2-game-unit",
  "unitsPerCell": 1
}
```

`unitsPerCell` is the exact per-map scalar cell spacing; `1` is the measured TArcade value. No
`metersPerUnit` is emitted. The shorthand *grid-implied* describes the evidence state and maps to
an `inferred` heightfield plane; it is not a third `ProjectionBasis.unit` value.

If `scale.x !== scale.y`, the scalar-cell-size UVW candidate refuses materialization. A future UVW
revision may add two-axis spacing, but this candidate does not distort the source to fit.

## Evidence

The pinned retail oracle is `TArcade.SC2Map` from the StarCraft II 5.0.16.97563 installation.
The exact inputs are pinned independently so a document digest is never misreported as a digest of
the whole map:

```text
t3HeightMap sha256:e4223f50d2350a350ac046395368470540f63b02cfa281ec4732d5c47738e83e
t3Terrain   sha256:994658707b6a56dd2b6261e9114b61ee10095a0801d57cbdc0dcec82181bcc6f
```

Its grid is `257 × 257` (`66,049` tuples), horizontal scale is `1 × 1`, native horizontal bounds
are `0..256 × 0..256`, and the candidate converter must compare every native tuple to the sealed
world-space equation with exact numeric equality before applying the axis mapping. The canonical
bounds are `X 0..256`, `Z -256..0`; canonical-Y bounds are recomputed from all converted samples.

The sealed oracle commit is `modkitx@1a14ba4eddd0ae88de273348ebd44cfb98a0581d`. Interleaved
little-endian tuple streams have these exact digests:

```text
map-native Float64 XYZ      sha256:c3419baf0f7834682342035b3d1d485a21a0f30adc7712e6a7424dc3c075e8e7
legacy renderer Float32 XYZ sha256:4befdf3b649b32c3e9f96c927df9a18b73f35a2c49db57148056ba5d6422794a
canonical UVW Float64 XYZ   sha256:dc1cb1b5d7a09b797721b79f158039141828cb567f2b8fd733d0a2dff108ba5b
```

The canonical stream normalizes IEEE-754 negative zero to positive zero because canonical JSON
serializes both as `0`. Float64 is the semantic lane. Float32 is retained as a separate renderer
parity lane and is never used to lower UVW precision.

Acceptance also requires canonical serialization, reopen through an independent reader, stable
artifact digest and a machine-readable materialization receipt. A receipt from only SC2 remains a
candidate receipt until the Warzone family passes its own measured differential.

## Consequences

- SC2 terrain, M3 models and placed objects can share one canonical orientation without a hidden
  reflection.
- Consumers never infer metres from SC2 game units.
- Source-row reversal is observable and testable rather than an undocumented renderer choice.
- Non-uniform SC2 grids fail with a named reason until the UVW profile can represent them.
- Warzone coordinate and mixed terrain/model tests remain the independent admission gate.
