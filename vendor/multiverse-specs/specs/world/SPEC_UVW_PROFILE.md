# SPEC — UVW profile 1.0: the space-graph envelope

Status: **profile** (succeeds the candidate as the current UVW document form; the
candidate stays valid until Modkit's UVW writer migrates in GA wave 4, then retires).
Normative artifacts: [`schema/uvw.profile.v1.schema.json`](schema/uvw.profile.v1.schema.json),
fixtures under [`fixtures/`](fixtures/) (`uvw-profile-*`), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian, owner-driven
stress test incl. RA1–RA3, planets, universes, Minecraft-scale portals, dynamic
topology): `../../design/DESIGN_UVW_TOPOLOGIES.md`.

## 1. The envelope

A world is a **graph of spaces**: each space carries exactly one primitive topology and
its own local coordinates; typed connections join spaces. Every current SC2/Warzone map
is the degenerate graph — one heightfield space, zero connections — and a candidate
document is exactly a profile document with its body wrapped as that single space
(mechanical migration, no data change).

## 2. What this version admits

- Topologies: `heightfield`. `tile-grid`, `node-graph` and `volume` are reserved names:
  taken so the day a publisher lands the name is already right, refused until their
  amendment.
- Heightfield-space layers: scalar `heightfield`; exact `terrain-materials` blends;
  synchronized `cliffs`; rectangular `water` zones; placed `objects`; confined
  `resources` (`uvm` or media); `regions`; exact native-flag `navigation`; gateway segments;
  and initial `lighting`. Every added family is independently versioned with `schemaVersion: 1`.
- Connections: **reserved at zero entries.** The amendment defines `portal` (point
  anchors, pass rules, affine mapping including scale — the Minecraft 1:8 case lives
  here) and `seam` (boundary gluing including self-seams for wrap/torus worlds) and
  lifts the cap when the first consumer lands. Minting connection schemas nobody
  publishes would repeat the mistake the world-interchange registry note forbids.

## 3. Semantics fixed now (so consumers build once)

1. A position is `(space, local coordinates)`; there are no global coordinates.
2. Space ids are unique; uniqueness across documents is a composition check.
3. Viewers pick the entry space by lowest id unless a package states otherwise.
4. The initial topology lives in this artifact; RUNTIME topology changes (door state,
   created portals, destructible terrain deltas) are world STATE — saved, hashed,
   replayed — never mutations of the artifact.

## 4. Migration and admission

- Wave 4 (GA): Modkit UVW writer emits profile documents; viewers consume the graph
  envelope (single-space worlds require no viewer changes beyond the wrapper).
- `world-interchange-v1` scope stays reserved; block 18 owns its admission. This
  profile does not mint the scope.
- Programme B: the tile-grid amendment (adjacency square4/square8/hex, occupancySlots)
  lands with the RA/SC1 adapters; connections amendment with the first
  multi-space consumer.

## 5. Heightfield-space layer rules

1. Every space contains at least one scalar heightfield. `columns` and `rows` count
   samples, not quads; grids are row-major in the space-local canonical `(x,z)` frame.
   A height equal to `noDataValue` is missing ground, not an extremely low vertex.
2. `terrain-materials` stores either a normalized non-empty sparse weight list per sample,
   one or two compact `rgba8-unorm` weight rasters, or both. A raster declares one to four
   material ids in RGBA channel order; consumers divide all declared channel values by their
   sum, with the first channel as the deterministic all-zero fallback. Raster dimensions are
   independent of the height sample grid (for example SC2 uses 2048×2048 weights for a
   257×257 heightfield). Raster resource ids and texture/media references resolve
   through a `resources` layer. UV transforms use
   `uv' = (0.5,0.5) + R(rotation) * ((uv - (0.5,0.5)) * scale) + offset`:
   offset is post-transform translation, scale components are non-zero and rotation is
   in radians. This order represents Warzone per-tile X/Y flips and quarter-turns
   without native flag leakage and also covers SC2 layer tiling/rotation.
3. `cliffs` keeps exact synchronized levels and an equally sized authored mask. It
   does not claim a generated cliff/ramp mesh; that requires a later geometry family.
4. `water` v1 admits finite-elevation axis-aligned zones and an optional local initial-render
   material catalog. A material may declare straight RGBA, one or two scrolling surface resources,
   UV scale, depth color falloff, specular controls, caustics and shadow reception; the base resource
   is sampled twice when `secondaryColorResourceId` is absent, and all resource ids
   resolve through the same confined `resources` layer. `shorelineMode` selects terrain intersection
   clipping or an authoritative authored zone. `classification` distinguishes water from
   lava without importing native physics. A publisher that has not resolved native water elevation
   must report the facet partial and may not serialize that zone as exact UVW. A layer without the
   material catalog retains the original v1 compatibility rule: `materialId` may name a terrain
   material or media resource directly.
5. Object transforms are canonical local position, unit quaternion and non-zero scale.
   `resourceIds` are stable joins to confined `uvm`/media paths. Optional `modelComponents`
   gives persistent component instances stable ids and may attach a child to an exact socket of
   another component with the paired `parentId`/`parentSocketId` fields. Component ids are unique,
   their graph is acyclic, and every component resource is present in `resourceIds`; array order is
   not semantic. An optional unit `rotation` quaternion is a local transform applied after the
   parent socket (or directly for a root). This represents compound models without making a native body/turret convention
   part of UVW. Animation time, doors, deaths and other changing state are runtime world state,
   never initial object fields.
6. Regions admit circles, rectangles and polygons. Navigation retains non-negative
   publisher-defined flags; portable flag meaning requires a separately named mapping.
   Gateways are directed-independent line segments in the local `(x,z)` plane. Lighting is
   only the initial ambient/directional environment.
7. IDs are unique in their family and references must resolve inside the same space.
   Canonical serialization sorts spaces, layers, resources, terrain and water materials, blend entries,
   zones, instances, model components, regions and lights by UTF-8 id; authored grid and polygon order is
   never reordered.

## 6. Native conversion guarantees

A UVW-to-native operation requests exactly one named guarantee before the target writer allocates
output bytes. A writer must refuse an unknown or unsupported guarantee; it must never silently lower
the request to an easier profile.

| Profile               | Guarantee                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry`            | Representable terrain geometry, coordinates and explicitly mapped spatial facets. Quantization or resampling requires an explicit policy. |
| `visual-world`        | Geometry plus resolvable UVM/media/material/water placements within target capabilities.                                                  |
| `native-authored-map` | Valid target-native documents, dependencies, resource/type mappings and metadata, with target-load evidence.                              |
| `playable-scenario`   | Native authored map plus separately represented gameplay/runtime semantics. UVW alone cannot satisfy this profile.                        |

Every attempt returns a versioned machine-readable receipt naming the requested and achieved profile,
target game/artifact, refusals, verification evidence and losses. Each loss names the asset or field,
the reason and replacement, plus a numeric error measurement or an explicit statement that the error
is not applicable or was not measured. A successful archive reopen proves container integrity only;
it is not target editor/game load evidence.
