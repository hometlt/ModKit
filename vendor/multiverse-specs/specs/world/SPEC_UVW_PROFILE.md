# SPEC — UVW profile 1.0: the space-graph envelope

Status: **profile** (succeeds the candidate as the current UVW document form; the
candidate stays valid until Modkit's UVW writer migrates in GA wave 4, then retires).
Normative artifacts: [`schema/uvw.profile.v1.schema.json`](schema/uvw.profile.v1.schema.json),
fixtures under [`fixtures/`](fixtures/) (`uvw-profile-*`), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian, owner-driven
stress test incl. RA1–RA3, planets, universes, Minecraft-scale portals, dynamic
topology): `../../design/DESIGN_UVW_TOPOLOGIES.md`.

Owner decision, 2026-09-28: the target physical document is glTF 2.0 with
`UV_world_*` extensions. The currently executable profile below is still JSON;
it must not be advertised as a glTF document. The staged migration and consumer
acceptance criteria are in
[`PLAN_UVW_GLTF_MIGRATION_2026-09-28.md`](../../design/PLAN_UVW_GLTF_MIGRATION_2026-09-28.md).
The first executable material migration is `../tools/uvw-materials.mjs`.
It returns a standard glTF material and retained source fields, not a new world
document; callers must supply explicit material/texture policy and preserve any
unmapped water semantics. The shared glTF material schema under `../model/schema`
must be registered alongside this profile when resolving its `baseColorFactor`
reference. This does not add nested glTF material fields to the legacy world.
An opt-in [glTF world subset](SPEC_UVW_GLTF.md) now reuses the geometry
definitions and verifier below. It admits heightfield/navigation/traversal,
terrain blends and water with one glTF material table, addressed resource layers,
package-local PNG/JPEG images and raw RGBA8 weight rasters. The migration requires
explicit resource, raster-sampling and water-surface policies and produces a
verified receipt; water effects and raster rendering remain preview scope.
The current product writer remains on this legacy profile until complete
resource proof, renderer parity and Core publication are implemented and verified.

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
  `resources` (`uvm` or media); `regions`; exact native-flag `navigation`; portable
  static `traversal` for one movement class; gateway segments;
  and initial `lighting`. Every added family is independently versioned with `schemaVersion: 1`.
- Connections: **reserved at zero entries.** The amendment defines `portal` (point
  anchors, pass rules, affine mapping including scale — the Minecraft 1:8 case lives
  here) and `seam` (boundary gluing including self-seams for wrap/torus worlds) and
  lifts the cap when the first consumer lands. Minting connection schemas nobody
  publishes would repeat the mistake the world-interchange registry note forbids.

## 3. Semantics fixed now (so consumers build once)

1. A position is `(space, local coordinates)`; there are no global coordinates.
2. Space ids are unique inside a UVW document. Explicit UVP `worldInstances`
   qualifies them as `<instanceId>/<spaceId>` at composition binding; separate
   documents and repeated uses of one document may retain identical local IDs.
   Without that profile, the legacy runtime admits one world with bare space IDs.
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

### Authored game-view camera preset

Optional `spaces[].camera` (and `UV_world_graph.spaces[].camera` in glTF) carries
one `camera` definition from `uvw.profile.v1.schema.json`. It adopts SDK
`MapWorldCamera`: required `projection: orthographic|perspective`; optional
finite `azimuthDegrees`, `elevationDegrees` in [0,90], perspective-only vertical
`fieldOfViewDegrees` strictly between 0 and 180, and positive `drawDistance`.
Azimuth is the eye's direction from its target, seen from above, from canonical
+X toward +Z. Authored degrees are retained, not wrapped or inferred.

This is a view preset, separate from a placed `objectKind: camera` and a glTF
camera node. It supplies no eye/target position, aspect, orthographic scale,
scroll limit or gameplay rule. The consumer retains its ordinary controls and
states any derived values. Omission writes no defaults. A preset survives
spatial↔glTF round-trip and participates in the world artifact digest.

Distances use the space's declared basis units: metres for a normalized metre
space; native source units remain native until a physical scale is established.
Neither field names nor the SDK's metre wording authorize an invented scale.
The legacy candidate envelope does not gain this profile-only field.

## 5. Heightfield-space layer rules

1. Every space contains at least one scalar heightfield. `columns` and `rows` count
   samples, not quads; grids are row-major in the space-local canonical `(x,z)` frame.
   A height equal to `noDataValue` is missing ground, not an extremely low vertex.
2. `terrain-materials` stores normalized non-empty sparse weights, ordered atlas tile
   layers per sample, one to sixteen compact `rgba8-unorm` weight rasters, or retained combinations
   of these source facets. A raster declares one to four
   material ids in RGBA channel order (at most 64 distinct raster channels per layer).
   The sum normalization spans all rasters in the layer, not each raster separately;
   consumers divide all declared channel values by their
   sum, with the first channel as the deterministic all-zero fallback. The glTF profile
   instead requires an explicit zero-sum policy: refusal or a named material. Raster dimensions are
   independent of the height sample grid (for example SC2 uses 2048×2048 weights for a
   257×257 heightfield). Raster resource ids and texture/media references resolve
   through a `resources` layer. UV transforms use
   `uv' = (0.5,0.5) + R(rotation) * ((uv - (0.5,0.5)) * scale) + offset`:
   offset is post-transform translation, scale components are non-zero and rotation is
   in radians. This order represents Warzone per-tile X/Y flips and quarter-turns
   without native flag leakage and also covers SC2 layer tiling/rotation.
   Each terrain material may retain its image-channel conventions. `normalEncoding` is
   `rgb` (omission), `rgb-inverted-y` (Y opposes texture v), or `xy-in-alpha-green`
   (X in alpha, Y in green, positive Z reconstructed). `specularEncoding` is `color`
   (omission) or `gloss`: the red sample g contributes g squared times a lobe whose
   exponent is the terrain specular exponent times (1 minus g squared), multiplied
   by the light-facing normal term. These fields are independent of image resource IDs;
   an omitted default stays omitted. They do not authorize treating native gloss as
   glTF roughness or native normal channels as ordinary glTF RGB normals. A target
   projector without qualified conversion must refuse those active texture semantics.
   Each terrain material may carry `baseColorFactor`: four linear, straight
   RGBA numbers in `[0,1]`, interpreted as `[1,1,1,1]` when absent. The factor
   multiplies the linear base-color texture sample; with no texture, it supplies
   the base color itself. This adopts
   [glTF baseColorFactor semantics](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
   RGB texture samples are decoded from their declared color space before
   multiplication; alpha stays linear. Alpha coverage does not replace splat
   weights or imply a transparency mode. A reader must preserve an omitted
   factor rather than write the interpreted default into canonical bytes.
   This optional field does not yet introduce the nested glTF material object;
   the migration must not admit both spellings with implicit precedence.
   A textured material may declare `atlas: {rows,tileTop?}` for square base-colour tiles.
   Columns equal `imageWidth * rows / imageHeight`, an exact positive integer;
   texture resolution must also prove an integral tile size and in-range columns.
   Tile `(column:0,row:0)` starts at the image's top left. A sample may carry
   `layers: [{materialId,tile:{column,row}}]`, with 1..256 entries in authored
   bottom-to-top order. The first tile draws opaque, each later tile blends with
   its own alpha. `atlas.tileTop` names the cell edge that receives the top image
   row: `local-y-1` by default, or `local-y-0`. These SDK names use local y for
   the second horizontal coordinate (the canonical space's z), never world height.
   Missing defaults are interpreted without writing them into authored bytes.
   These layers select
   the ground instead of `weights`. Any retained weights remain source data,
   must still be valid, and never draw another ground pass. References must name
   atlas materials, rows must fit `atlas.rows`, and texture owners check columns
   against resolved images. Repeated materials/tiles are meaningful; never sort
   or deduplicate the layer list. An optional layer `cornerAlpha` contains exactly
   four finite linear coverage factors in `[0,1]`, ordered at local corners
   `(0,0),(1,0),(1,1),(0,1)`. Upper layers multiply their tile's own alpha by
   coverage interpolated linearly over the cell's terrain triangles; omission
   means one at each corner. The first layer stays opaque; its authored coverage,
   if present, is retained inactive. The first upper layer in authored order with
   one corner different from three equal corners chooses the diagonal between
   that corner's neighbours. Otherwise the terrain uses the diagonal with the
   smaller absolute height difference; a tie joins `(0,0)` to `(1,1)`. This is a
   presentation triangulation policy, not a traversal or surface-height query.
   A sample `cornerUv` contains exactly four finite UV pairs in that same corner
   order; values may extend outside `[0,1]` for wrapping. This applies to both
   weighted and atlas ground. It replaces the sample's `uvTransform` for drawing;
   a retained sample transform remains inactive source data. The material's own
   transform applies afterward, through the existing material mapping to glTF
   `KHR_texture_transform`; no new pivot or native UV flags are introduced.
   Corner arrays and layer order are never sorted, clamped or quantized by
   composition or migration. Atlas layouts, corner UVs and coverage are
   presentation data, not traversal or gameplay classification. The glTF
   `UV_world_graph` references these same sample/atlas definitions.
3. `cliffs` keeps exact synchronized levels and an equally sized authored mask. It
   does not claim a generated cliff/ramp mesh; that requires a later geometry family.
   Levels are integer classifications, not elevations in the space's length unit. Its
   `origin.y` is a reference plane and need not lie within the terrain's vertical bounds;
   the grid's horizontal `x/z` footprint must remain inside the space bounds.
4. `water` v1 admits finite-elevation axis-aligned zones and an optional local initial-render
   material catalog. A material may declare straight RGBA, one or two scrolling surface resources,
   packed wave normals, ordered caustics frames and a distinct caustics falloff, UV scale, depth color
   falloff, specular controls and shadow reception; the base resource
   is sampled twice when `secondaryColorResourceId` is absent, and all resource ids
   resolve through the same confined `resources` layer. `shorelineMode` selects terrain intersection
   clipping or an authoritative authored zone. `classification` distinguishes water from
   lava without importing native physics. A publisher that has not resolved native water elevation
   must report the facet partial and may not serialize that zone as exact UVW. A layer without the
   material catalog retains the original v1 compatibility rule: `materialId` may name a terrain
   material or media resource directly.
5. Object transforms are canonical local position, authored unit XYZW `rotation` quaternion
   and non-zero scale. Optional `presentationRotation` is an **absolute** unit XYZW quaternion
   in the same canonical space-local frame. Drawing, visual picking and culling use
   `presentationRotation` when present, otherwise `rotation`; the quaternions are never
   multiplied together. The chosen visual transform also applies to model-component/socket
   placement and visual bounds. The override does not change authored/native facing,
   collision, traversal or gameplay orientation. Native source conventions and snapping
   are resolved by their publisher, never inferred by the UVW reader.
   Admission uses the same unit-quaternion tolerance as `rotation` (squared norm within
   `1e-6` of one). Neither read nor migration normalizes, quantizes or changes quaternion
   signs. An explicit identity, equal-valued or sign-equivalent override is retained; absence
   is never filled with an authored default. Canonical bytes retain the existing JCS
   negative-zero policy. An authored-rotation edit leaves an explicit override unchanged;
   a presentation edit does not overwrite `rotation`.
   A consumer unable to retain an explicit override must refuse an exact visual-world
   conversion or report its omission once per object as `world.objects.presentationRotation`,
   including equal-valued overrides. It may not silently overwrite authored rotation or
   hide the field in private extras. Old strict readers can reject the new field; a consumer
   must qualify support against its pinned schema and semantic reader before publishing it.
   `resourceIds` are stable joins to confined `uvm`/media paths. Optional `modelComponents`
   gives persistent component instances stable ids and may attach a child to an exact socket of
   another component with the paired `parentId`/`parentSocketId` fields. Component ids are unique,
   their graph is acyclic, and every component resource is present in `resourceIds`; array order is
   not semantic. An optional unit `rotation` quaternion is a local transform applied after the
   parent socket (or directly for a root). This represents compound models without making a native body/turret convention
   part of UVW. Animation time, doors, deaths and other changing state are runtime world state,
   never initial object fields.
   A `doodad` may carry `derivedFrom: "cliffs"` for a generated presentation
   piece (including ramps). It remains visible with its model/resource joins,
   but is not an independently authored/editable placement. A native map writer
   must regenerate pieces from the authored cliffs facet instead of also writing
   them as doodads. Missing source geometry is an explicit conversion loss/refusal;
   the marker alone neither reconstructs cliffs nor authorizes collision/pathing.
6. Regions admit circles, rectangles and polygons. Navigation retains non-negative
   publisher-defined flags; portable flag meaning requires a separately named mapping.
   Gateways are directed-independent line segments in the local `(x,z)` plane. Lighting is
   only the initial ambient/directional environment. Optional `model: "lit" | "unlit"`
   defaults to lit. Unlit draws texture/base color times `unlitColor`, a linear RGB multiplier
   in `0..1` defaulting to white, after texture color-space decoding. Ambient/directional light,
   shadows and highlights do not apply in unlit; other authored light settings remain valid,
   preserved inactive data. This layer policy covers the world's presentation, including objects
   and water, and does not modify gameplay, traversal, alpha coverage or texture bytes. Display
   transfer/color management still applies. Missing defaults are interpreted, never serialized
   into canonical bytes. The glTF `UV_world_graph` uses this same lighting layer definition.
   Optional directional `specularColor`,
   `specularIntensity`, and `useAmbientOcclusion`, layer `terrain` multipliers, and `toneMapping`
   preserve the common Core world presentation contract. Tone mapping names its operator
   (`reinhard`, `exponential`, `logarithmic`, `linear`, or `filmic`), positive exposure,
   white point and contrast, with optional gamma, colorization and ambient-occlusion settings.
   All authored numeric settings must be finite; ambient and diffuse RGB are in 0..1.
   These settings do not supply collision, traversal or other gameplay semantics.
7. IDs are unique in their family and references must resolve inside the same space.
   Canonical serialization sorts spaces, layers, resources, terrain and water materials, blend entries,
   zones, instances, model components, regions and lights by UTF-8 id; authored grid and polygon order is
   never reordered. Ordered atlas tile layers are likewise never sorted.
8. A navigation layer has exactly `rows × columns` non-negative integer native flags and its
   sample positions fit within the enclosing space bounds. Cross-field validation refuses a
   partial or displaced grid before any consumer maps publisher flags to a traversal policy.
   Presence of valid flags alone does not mean a cell is walkable.
9. `traversal` is the portable, static movement graph for one `classId` inside one heightfield
   space; another class uses another layer. `origin` is the lower `x/z` corner of cell `(0,0)`,
   so its extent is `columns × rows × cellSize` (unlike heightfield sample extent). `walkable`
   is a boolean cell grid. `exits` is a directed adjacency mask per cell:
   `1=+x`, `2=-x`, `4=+z`, `8=-z`. An exit must lead to a walkable in-bounds cell;
   a blocked cell has mask zero. The reverse edge is independent, allowing one-way passages.
   A walkable cell with no exits is valid. At most one layer per `classId` may occur in a space.
   Publishers derive this layer from their own map/pathing semantics and must not infer it from
   unknown native flags. Dynamic blockers, destructible terrain and created connections are
   Runtime state, while this layer is immutable authored topology. Width, clearance, speed,
   diagonal movement and non-heightfield spaces require explicit later profiles; consumers
   must refuse those unrepresented mechanics rather than silently treating them as passable.
   An optional `surfaceLayerId` names one heightfield in the same space whose sample rectangle
   covers every traversal cell centre. Height samples are absolute canonical `y`; the Runtime
    binds that existing layer once and samples it by deterministic bilinear interpolation.
    Coordinates and samples use signed Q32.32. Interpolate along x, then z; at each step,
    multiply the signed sample delta by the non-negative coordinate remainder, divide by the
    cell size with truncation toward zero, and add the lower sample. An exact outer edge uses
    the last sample in both corners of that axis. Overflow is an error, never a wrapped height.
    Any contributing `noDataValue` means no surface at that query point; a corner with zero
    interpolation weight does not contribute. A traversal layer without
   this reference supports topology queries but cannot authorize terrain-following movement.

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


## Initial object presentation (Core relay 02.10)

`objectInstance` admits optional `presentationTint`, `presentationAnimation` and
`presentationRotation` (the absolute visual override specified in rule 5).
They are shared metadata in the same object schema for both legacy profile and the
glTF envelope. Migration and reconstruction preserve them exactly; missing consumer
support is reported as conversion loss, not silent removal.

`presentationTint` is three unit RGB multiplication factors (default white). It is
an object tint, not player identity, team ramp or opacity. Multiplication factors
are used directly, without treating them as sRGB-encoded colour samples. UVM
`colorSource: "object-tint"` consumes them as its masked colour; such a material
must not receive the same whole-object tint twice.

`presentationAnimation` is the existing Core request shape: required nonempty
`name`, ordered nonempty-string `groups`, boolean `loop`, finite signed `speed`,
optional boolean `randomStart` (default false). Speed zero pauses; negative speed
reverses presentation time. Name/groups retain authored animation-property intent;
clip matching remains with the common Core clip owner, including its existing
property-set selection. Explicit unresolved requests must not fall back to an
unrelated clip. Random start is a stable per-object presentation phase for looping
clips; it consumes no simulation RNG and affects no gameplay event. No numeric
phase algorithm is frozen by this metadata contract.

Gameplay animation requests/actions remain UVD/UVB/UVS mechanics and cannot be
inferred from this visual initial-state request.

## Players and start positions (Core relay 02.10)

Each space admits optional `players` and `startPositions`. The glTF envelope uses
the same definitions under `extensions.UV_world_graph.spaces[]`; conversion and
reconstruction preserve these tables exactly.

`players[]` has required `slot` (signed 32-bit integer) and `address` (portable
canonical `strref`, nonempty, trimmed, no NUL, valid UTF-8, at most 1024 bytes).
Optional `name` is nonempty text. Slots and addresses must be unique within one
space. A slot is an authored native-game identifier, including zero or negative
values where that game's rules allow them. It is never a private Runtime handle.
An address identifies a simulation role; authenticated accounts and human, AI or
network control are separate bindings.

Optional `color` is linear RGB in 0..1; optional `ramp` contains 1..65536 exact
linear RGB shades. No alpha or implicit gradient is added. UVM contextual player
colour uses the owning player's row. A material ramp override must contain the
same number of shades as that material's authored ramp. Object `presentationTint`
keeps its separate meaning and must not be applied twice.

When `players` is present, every object instance's optional integer `player`
resolves to a declared slot in that space. An empty table is authoritative.
Legacy spaces without a table retain their previous integer metadata; launch
requires explicit player setup where identities are needed. Missing tables do
not authorize guessing a player address from a slot number.

`startPositions[]` has required unique nonempty `id` and finite local `position`
vec3, plus optional `player` referencing a declared slot. Unassigned starts are
allowed without a player table. Starts preserve authored positions, including
height: they do not clamp to terrain, create units, allocate players or select
game rules. Those actions belong to the native adapter and gameplay definitions.

Verified compositions collect player addresses from captured selected spaces.
The same explicit address across spaces or world instances denotes the same
simulation player; instancing a world does not clone its player identities.
Space bindings remain qualified by world instance. Runtime setup may reorder an
authored roster but cannot replace or extend its identity set. A native adapter
also checks its own slot-to-address mapping. Worlds intended to have independent
players must publish different addresses.

The current bounded executor accepts at most 256 identities and 128 UTF-8 bytes
per address. The format's wider budgets are intentional: consumers exceeding
their supported profile return a typed refusal and never truncate the table.
No UVB, save or kernel ABI change is implied by these optional metadata fields.

## Publisher-proven lattice annotations (addendum 14.10.2026)

Optional `objects.instances[].latticeCoverage` and `heightfield.cliffFaces`
retain the existing neutral SDK lattice facts in profile 1.0. They share the
spatial schema in both JSON and `UV_world_graph`; there is no game-specific
UVW dialect, new topology, renderer, navigation grant or mutable State.

`latticeCoverage.roles` is an optional unique array of `resource`,
`destructible`, `start`. Each optional channel `blocked`, `noBuild`, `vision`,
`nearResources`, `outline` is an array of publisher-proven polygons with at
least three finite `{x,y}` vertices. Coordinates are absolute in the enclosing
space: `x` is local UVW X and the SDK horizontal `y` is local UVW Z. They are
not object-relative and must not be rotated, mirrored or scaled again from
the instance transform. Preserve polygon and vertex order, including winding,
negative coordinates and coverage crossing map bounds; do not guess, clip,
merge or replace it with a mesh bounding box.

A missing annotation, role array or channel is unknown. `roles:[]` is a
classified empty role set; a channel `[]` is known empty. Other omitted
channels remain unknown. Even `{}` preserves the existence of an annotation
whose channels were not classified. There are no implicit defaults.

`resourceKind` and `resourceKindScope` are optional together. The kind retains
the exact source label and case; the scope is the **actual resolved source
snapshot.gameId**, not a guessed namespace, map id, path or enum. The writer
must receive that fact from its owning publisher/Host. A standalone artifact
retains both strings without needing the source game installed. Unknown
source scope is an explicit conversion loss/refusal, never a synthesized
namespace. The format validator checks the declared pair; it cannot prove the
provenance of a game id. Neither a scope nor kind authorizes resource access
or defines a universal economy type. Scope permits 1..1024 and kind 1..4096
Unicode code points, without surrounding whitespace or control characters.

`heightfield.cliffFaces` is a complete effective classification represented
by a unique canonical row-major array of `{x,y}` cliff cells (order y, then x).
Cell indices satisfy `0 <= x < columns-1`, `0 <= y < rows-1`; terminal sample
vertices are not cells. Listed cells are true and all other quads false.
Omission means unknown; `[]` means a proved all-false classification.
Incomplete source observations cannot be encoded as a complete set. The
exporter maps native **cell** coordinates through its already-proven terrain
transform exactly once: a reflected row uses `(rows-2)-y`, not the sample
formula `(rows-1)-y`. Native terrain types/levels, slope and generated cliff
meshes do not establish these facts. No-data holes do not invent a
classification or permission to erase published cells.

Each annotation, polygon, vertex and listed cliff cell consumes one item
from a combined limit of 1048576 per UVW document, shared across spaces.
Consumers may apply stricter acquisition and memory budgets. Unknown
annotation/point/cell fields, malformed polygons, duplicate roles or cells,
noncanonical cell order, unscoped kinds and out-of-grid cells refuse; nothing
is silently dropped.

The schema marker retains its existing syntactic version pattern; schema-valid
future version strings do not imply admission. Reference lattice admission
refuses non-1.0 profile versions.

This is an additive profile-1.0 amendment. Existing files acquire no default
fields and retain their canonical bytes/digests. Old strict readers refuse
the new fields until their coordinated update; exporters must not pretend
such a reader preserved the annotations. The legacy candidate reuses the
same layer definitions where applicable. The frozen behavior/session ABI and
WASM do not change. Normative artifact and spatial/glTF round-trip tests do
not establish Core codec/source, native publisher or PNG acceptance.
