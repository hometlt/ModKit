# UVW — Universal Verse World

**Status:** **candidate**, 2026-08-26 — schema, fixtures and executable vectors exist for the
heightfield base facet; there is no live world source in any host yet, so nothing here is an
admitted format or a compatibility guarantee
**Extension:** `.uvw.json` · **Physical base:** canonical JSON
**Schema:** [`schema/uvw.candidate.v1.schema.json`](schema/uvw.candidate.v1.schema.json) ·
**Vectors:** [`../conformance/uvw/vectors.json`](../conformance/uvw/vectors.json)

**Role.** A portable projection of a world's *spatial* facts: extent, coordinate frame, layers, and
a 2.5-D heightfield surface. It is the world-plane counterpart of UVM.

**What candidate means here, precisely.** Two things are missing and both matter. There is no
live world source: no codec in any host publishes a world facet yet, because map families arrive
in blocks 15–16. And a profile with no publisher has never been tested against a real disagreement
— every fixture in this directory was authored to match the schema, which proves the schema is
self-consistent and proves nothing about whether it can carry StarCraft II or Command & Conquer
terrain. **A materialization from a synthetic projection is evidence about the format, not about
any game.** That distinction is the whole reason this profile is not admitted.

Until admission (Modkit block 18) the name `world-interchange-v1` is not used as a release or
compatibility claim, and a pinned candidate descriptor is permitted only for admission-only
reports.

**Not a promise.** UVW is not a scenario format and not a definition format. Triggers, objectives
and scripted behaviour belong to UVS; unit, weapon and ability definitions belong to UVD. A world
says where things are and what the ground does, and stops there. The temptation to let "world"
absorb everything a map file contains is exactly what the plane split exists to resist.

## 1. Coordinates

A UVW document is expressed in the canonical frame of
[`../foundation/SPEC_UV_COORDINATES.md`](../foundation/SPEC_UV_COORDINATES.md): right-handed,
+Y up, +Z forward, metres. The three unit states of that document apply unchanged, and a world
converted from a grid-based source is the common case of the second one: `unitsPerCell` records the
grid relationship, `metersPerUnit` follows from the game's documented cell size, and the value is
marked `inferred` rather than passed off as stated.

`bounds` is axis-aligned in the canonical frame and recomputed from converted corners, never by
converting `min` and `max` individually.

## 2. Layers

A layer is identified by a **string id that is stable across paging**, never by index. Two pages of
one world must agree on what a layer is, and an index is only stable while nothing is inserted.

Each layer declares its `kind`. This profile defines one — `heightfield` — and reserves
`grid`, `mesh`, `raster`, `vector`, `objects`, `regions` and `navigation` for the facets that
arrive with their publishers. A reader that meets an unknown `kind` preserves and reports it; it
does not drop it and does not guess.

## 3. The heightfield base facet

A heightfield is a regular grid of elevations over the world's extent:

| Field | Meaning |
| --- | --- |
| `columns`, `rows` | Sample counts; the grid has `columns × rows` samples, not cells |
| `cellSize` | Distance between adjacent samples, in the document's unit |
| `origin` | Canonical-frame position of sample `(0, 0)` |
| `samples` | Row-major elevations, `rows` arrays of `columns` numbers |
| `noDataValue` | Optional; a sample equal to it means "no ground here", not "ground at that height" |

Row-major and sample-count-not-cell-count are both stated because both are the usual off-by-one:
a format that means cells has `columns + 1` sample columns, and a converter that assumes the wrong
one produces terrain one cell narrow with no error anywhere.

`noDataValue` exists because holes are real — a map with a chasm has an absence of ground, and
encoding it as a very low elevation makes a wall instead of a hole.

## 4. Canonical ordering

A UVW document is canonicalised by
[`../foundation/SPEC_UV_CANONICALIZATION.md`](../foundation/SPEC_UV_CANONICALIZATION.md), with two
profile rules:

- `layers` is ordered by `id` in UTF-8 byte order, not by authoring order. Two converters reading
  the same world must produce the same document, and authoring order is not a property of the world.
- `samples` keeps row-major order and is never reordered — it is data, not a set.

Repeat materialization of the same projection is byte-stable; that is what the vectors check.

## 5. What is deliberately absent

No objects, regions, navigation meshes, texture layers, water, lighting or spawn points. Each of
those needs a publisher to be designed against, and designing them now would mean inventing a
shape and then discovering it is wrong when the first real map arrives. The facets are named in
§2 as reservations so that the day a publisher lands, the name is already taken by the right thing.
