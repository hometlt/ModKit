# Universal Verse Coordinates and Units

**Status:** normative-candidate shared contract, 2026-08-26
**Owns:** the spatial frame shared by the model and world planes — handedness, axes, units, bounds,
and the rules for converting a source frame into it
**Does not own:** what lives in that frame. Geometry belongs to UVM, terrain and objects to UVW,
gameplay meaning to UVD/UVS. This document is the agreement that lets those three talk about the
same point in space.

Before this document the frame was real but unwritten. `ProjectionBasis` carried `handedness`,
`upAxis`, `forwardAxis`, `unit`, `metersPerUnit`, `sourceUnit` and `unitsPerCell`, and every
adapter filled them in correctly — but *which* values are canonical, and what a converter must do
when a source disagrees, lived in prose scattered through `SPEC_UVM_CONVERSION.md`, once per
engine. A rule stated once per engine is a rule nobody can check.

## 1. The canonical frame

A UV subject on the model or world plane is expressed in the **canonical frame**:

| Property | Canonical value | Why this one |
| --- | --- | --- |
| Handedness | `right` | glTF is the model substrate and is right-handed; agreeing with the substrate removes a conversion from the common path |
| Up axis | `y` | glTF again. Sources that are Z-up (SC2, Source, most RTS terrain) convert once, at the boundary |
| Forward axis | `+z` | glTF's convention for a scene's nominal facing |
| Unit | `meter` | A physical unit is the only one two unrelated games can share |

`ProjectionBasis` is the ABI form of this table. A basis whose four fields hold exactly the values
above is **canonical**; any other combination is a *source frame* and carries the conversion that
reaches the canonical one.

The canonical frame is not a claim that a game authored in it. It is the frame the projection is
*expressed* in, so that a viewer, a hash and a second game's importer agree without negotiating.

## 2. Units, and the honest gap between them

Three unit situations exist and they must not be confused:

1. **The source states a physical scale.** `unit: "meter"`, `metersPerUnit` set from the source's
   own declaration. Conversion is exact and lossless.
2. **The source implies one through a grid.** RTS formats usually do: a map square, a cell, an
   elmo. `unitsPerCell` records the grid relationship and `metersPerUnit` follows from the game's
   documented cell size. The value is *derived*, and `ProjectionPlaneState` marks it `inferred` —
   a value computed because the source did not state it is not the same fact as a value converted
   from one that did.
3. **The source states nothing.** `unit: "source-unit"` with `sourceUnit` naming the source's own
   unit verbatim. **No metre factor is invented.** A consumer that needs physical scale must ask
   the project, not the artifact.

A grid relationship can be exact while its physical scale is unknown. In that case it is recorded
as `unit: "source-unit"`, `sourceUnit` names the native world unit, and `unitsPerCell` records the
measured grid relationship; `metersPerUnit` remains absent and the affected plane is `inferred`.
`grid-implied` names this evidence situation in prose — it is not a third value of
`ProjectionBasis.unit`.

The third case is the common one for models pulled out of games, and pretending otherwise is the
single most tempting lie in this whole area: a plausible-looking `metersPerUnit` that nobody
measured propagates into every downstream consumer as though it had been.

## 3. Converting a source frame

A conversion is stated as the axis permutation and sign changes that carry source axes onto
canonical ones, plus a scalar. Two rules keep conversions checkable:

- **Handedness changes by sign, never by swap.** Negating exactly one axis flips handedness and
  leaves the other two meanings intact. Swapping two axes also flips handedness but silently
  renames "up" or "forward", which is how a model ends up lying on its side with a correct-looking
  basis. Where a swap is genuinely required (a Z-up source), it is stated as a swap *and* the
  resulting handedness is restated.
- **Scale is one scalar, applied after orientation.** Non-uniform scale is not a frame conversion;
  it belongs to the node transform that carries it.

Round-tripping uses the stated inverse, which need not equal the forward map. Invertible
orientation alone proves no terrain encoding, gameplay facing or rendering equivalence.

## 4. Bounds

Bounds are axis-aligned in the canonical frame, stated as `min`/`max`. A bound converted from a
source frame is recomputed from the converted corner set, never by converting `min` and `max`
individually: a rotation or axis swap maps the minimum corner to something that is no longer the
minimum, and converting the pair directly produces a box that is inside-out on one axis.

An empty subject has no bounds. It does not have a zero-volume box at the origin — the two are
different facts, and a consumer that fits a camera to the second one flies to the origin.

## 5. Layer identity and paging (world plane)

The world plane adds two rules the model plane does not need:

- **Layer identity is a string id, stable across paging.** A layer is not its index: two pages of
  the same world must agree on what layer 3 is, and an index is only stable while nothing is
  inserted.
- **A page is a rectangle in the canonical frame, not a tile index.** Tile indices belong to the
  source; a consumer that pages by them inherits the source's origin corner and grid size, which
  differ per game. Paging by canonical rectangle is what lets one viewer page two games.

Unknown facets follow the foundation rule: they are preserved and reported, never invented and
never silently dropped.

## 6. Measured world source frames

World-frame qualification is accepted only with a numeric mapping, a numeric origin rule and an
executable oracle. A frame definition may precede it under §8. The first qualified entry is
StarCraft II map-native terrain, recorded by
[`../world/ADR-WORLD-001-sc2-map-native-to-uvw.md`](../world/ADR-WORLD-001-sc2-map-native-to-uvw.md).
Its right-handed Z-up frame maps to the canonical frame as `(x, y, z) -> (x, z, -y)`. Because a
heightfield advances rows along canonical `+Z`, an SC2 HMAP is serialized with its source rows in
reverse order. Its grid relationship is exact, but no public physical metre scale is asserted.

The independent second entry is Warzone 2100 `game.map`, recorded by
[`../world/ADR-WORLD-002-warzone-map-native-to-uvw.md`](../world/ADR-WORLD-002-warzone-map-native-to-uvw.md).
It uses the same right-handed Z-up axis mapping but a different direct-height tile encoding and a
fixed `128` world-unit grid relationship. Its physical metre scale is likewise not invented.
That historical renderer-coordinate comparison did not account for the game's mirrored
projection. The game-facing correction has a separate ID and qualification boundary in
[`../world/ADR-WORLD-008-game-facing-world-frame-qualification.md`](../world/ADR-WORLD-008-game-facing-world-frame-qualification.md).

## 7. Machine form

The measured Z-up rotation `(x,y,z) → (x,z,−y)` is not self-inverse. Its inverse
is `(x,y,z) → (x,−z,y)`; applying the forward transform twice gives `(x,−y,−z)`.
The M3, SC2 map and Warzone map entries state this inverse explicitly. This
correction does not change their forward conversion or any measured native axis.

`uv-coordinates.v1.json` beside this file carries the canonical basis and one entry per known
source frame. A converter reads it rather than this prose; a reviewer checks the prose against it.
Where the two disagree, this document is normative and the JSON is stale — with one exception:
the per-source entries are the authority for their own numbers and stated evidence scope.
Definition-only entries below do not acquire a measured status from their presence here.

## 8. Frame definitions and adapter qualification are separate

A registry ID names a coordinate contract; it is not a receipt or a permission to publish a
verified world. New source records marked `qualification: "required"` define the agreed axes,
units, origin and row rules so a game role can construct its qualification. They **MUST NOT** be
reported as measured converters. Records without this marker retain only their historical
evidence scope. A `supersededBy` link retains the old contract and hashes for existing artifacts;
it does not rewrite them as evidence for the replacement.

Before native-world admission, the adapter still supplies its own `MapWorldCanonicalTransform`
proof: exact source digests, named corpus/oracle and positive tuple count, with IEEE-754 binary64
XYZ tuple streams hashed in their declared order. Tuples are world positions, not column/row
indices. The exact oracle comparison and structural transform checks are distinct. A screenshot,
water coverage percentage or approximate mesh intersection can establish one claim (for example
orientation); it cannot certify exact elevations or physical metres. Third-party code is an
oracle/specification, never copied into an unrelated implementation.

`worldForm` resolves an entry in the same document's `worldForms`; source-specific fields
override only declared grid parameters. `planar-pixel-grid-v1` is the sole common form for flat
integer-pixel maps: x east, y south, z up, mapping `(x,y,z) → (x,z,y)`, forward rows. It is a
left-to-right frame conversion (determinant −1); winding/normals and model orientation must
be handled by their existing owners. Dune and SC1 retain their separate qualification receipts.
Their 32-pixel cells do not establish a metre scale. Cell-centre objects keep their centre;
building corner anchors are not moved to centres by the coordinate transform.

Sources under `unmeasuredWorldSources` have incomplete numeric contracts. They reserve identity
for evidence gathering and **MUST NOT** be admitted by filling absent axes, heights or scale from
another game. Earth 2150/2160 are currently in this state: a game top-view can qualify the horizontal
orientation, but not the unknown height decoding. Models and map frames are qualified separately;
the new Warcraft III map record does not remove MDX from `unmeasured`.
