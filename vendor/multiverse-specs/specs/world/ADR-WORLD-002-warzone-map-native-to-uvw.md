# ADR-WORLD-002 — Warzone 2100 map-native terrain to UVW

**Status:** accepted for the UVW candidate, 2026-08-28
**Admission effect:** closes the independent second-game-family coordinate, unit, origin and exact
terrain differential; does not mint `world-interchange-v1`, whose descriptor and vectors are still
frozen only at Modkit block 18 admission

## Context

Warzone 2100 stores terrain in `game.map`. The official implementation at
`Warzone2100/warzone2100@cbb1eb1515da60893595eef2868f4dcef8c37f1c` is the authority for the tile
record, height encoding, `TILE_UNITS` and renderer/world coordinate mapping. This source is
independent of the sealed StarCraft II converter used by ADR-WORLD-001, so agreement is evidence
that the UVW base heightfield is not shaped around one Blizzard format.

Warzone does not state a physical metre scale for these world units. The exact grid relationship
is retained without inventing one.

## Decision

For a row-major `game.map` tile at `(column, row)`, the map-native position is:

```text
x = column * 128
y = row * 128
z = directHeight
```

For map versions `10..39`, `directHeight` is the stored unsigned byte multiplied by the official
`ELEVATION_SCALE` of `2`. Version `40` stores the height directly as a little-endian unsigned
16-bit value. The texture word beside it is preserved as source data and does not alter elevation.

The Warzone map-native frame is right-handed, with `+X` right, `+Y` forward and `+Z` up. The
official renderer mapping and the canonical UVW mapping are the same:

```text
(x, y, z) -> (X, Y, Z) = (x, z, -y)
```

UVW rows advance along canonical `+Z`, so output row `j` reads source row `rows - 1 - j` and:

```text
origin = [0, 0, -((rows - 1) * 128)]
cellSize = 128
```

The basis is:

```json
{
  "handedness": "right",
  "upAxis": "y",
  "forwardAxis": "+z",
  "unit": "source-unit",
  "sourceUnit": "warzone-world-unit",
  "unitsPerCell": 128
}
```

No `metersPerUnit` is emitted. PIE `POINTS` and `NORMALS` already use the renderer `x,y,z` frame
and therefore stay unchanged when model geometry is placed beside terrain. PIE `CONNECTORS` use
their separately documented `(x,z,y)` storage order; a model adapter must not apply that connector
rule to vertices or normals.

## Evidence

The pinned installed corpus is Warzone 2100 4.7.0, archive `data/mp.wz`, entry
`multiplay/maps/2c-highground/game.map`:

```text
mp.wz    sha256:d698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688
game.map sha256:c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111
```

The archive is opened and the entry extracted through the product ZIP path before the Warzone map
provider sees it. The map is version `10`, `48 × 96`, and contains `4,608` exact terrain tuples.
Its direct elevations span `0..510`; native bounds are `X 0..6016`, `Y 0..12160`, `Z 0..510`.
The parsed map and gateway prefix consumes `13,964` bytes and retains `1,168` trailing bytes as an
explicit remainder.

Interleaved little-endian Float64 tuple streams have these exact digests:

```text
map-native Float64 XYZ    sha256:bc29f38775548ebf04d37fddf1d2750c4532721afdc9ccae32aebcc2f943c6a2
canonical UVW Float64 XYZ sha256:01a7ccb598ea62a8e6dd5f2d88cdfbdd5d19ee1e1fe77ba995c7374bd4d0a2f0
```

Acceptance drains all `4,608` cells through the host's exact paged world candidate, serializes a
`68,776`-byte canonical UVW document, reopens it, repeats the materialization with a different page
size and requires byte-for-byte identity.

## Consequences

- The UVW base-heightfield shape has now passed independent SC2 and Warzone real-file mappings.
- Physical metres remain unknown rather than inferred from the integer tile size.
- A direct-height source no longer has to impersonate SC2 quantization metadata.
- Terrain and PIE model geometry share the Warzone renderer frame without an accidental axis swap.
- Admission still waits for the block 18 descriptor/vector freeze and its release gates.
