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

Round-tripping is exact when the conversion is its own inverse — every entry in the machine form
below is, which is what makes `projectionSemanticHash` equality achievable across a conversion.

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

## 6. Machine form

`uv-coordinates.v1.json` beside this file carries the canonical basis and one entry per known
source frame. A converter reads it rather than this prose; a reviewer checks the prose against it.
Where the two disagree, this document is normative and the JSON is stale — with one exception:
the per-source entries are the authority for their own numbers, because they were measured against
real files and this text was not.
