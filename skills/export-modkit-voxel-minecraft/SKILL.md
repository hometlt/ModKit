---
name: export-modkit-voxel-minecraft
description: Export UVW/UVP terrain with placement-cell scale, cliff levels and slab ramps, fill an existing surface-voxel model, or generate detached masonry cliff structure libraries through MCP and render the saved native world.
---

# Export filled voxels to Minecraft Java

## Authoritative game terrain

When the user specifies placement-cell scale, cliff-level height or ramp step height, start with
the source UVW/UVP. A coarse voxel GLB has already lost that semantic grid. Open the source through
MCP and invoke `map.export-native`, retaining the output, for example:

```json
{ "handle": "…", "operationId": "map.export-native", "input": {
  "schemaVersion": 1, "formatId": "minecraft-java-terrain-world",
  "options": { "name": "amphion-sw-5x8", "region": "southwest", "blocksPerUnit": 5, "cliffBlocks": 8 }
}, "retainOutput": true }
```

This profile keeps terrain and derived cliff objects, removes water and gameplay objects, reuses
the existing overlay's level inference, ramp planes, half-block smoothing and colour-matched slabs,
and writes actual Anvil chunks through the common native writer. Edges retain slabs and cliffs;
they do not fade into generated land. `region` is `southwest` (min X, max Z) or `all`; scales are
explicit source-world units, not the low-resolution voxel grid. Verify the source's placement-cell
unit. In SC2, five blocks per placement unit gives a 3×3 barracks footprint of 15×15 blocks.
`cliffBlocks` is the rise per inferred cliff level; it does not flatten decorative cliff geometry.
Download, verify, extract and reopen the native world using steps 3–5 below.

## Existing surface voxels

Use `voxelize-modkit-model` first when the selected map has not been voxelized. Preserve its crop,
water/object selection and resolution. This writer requires the canonical unit-cube surface with
`scene-surface-voxels` provenance; arbitrary meshes refuse instead of being re-voxelized implicitly.

1. Discover the running MCP tools and open the saved voxel GLB using `modkit.open_subject`.
   Inspect `model.export-native` with the server's operation discovery. The Minecraft extension
   must advertise native encoder `minecraft-java-voxel-world`; rebuild/restart the actual MCP
   extension runtime if it is unavailable. A skill alone does not install an encoder.
2. Export using the existing common operation:

   ```json
   { "handle": "…", "operationId": "model.export-native", "input": {
     "schemaVersion": 1, "formatId": "minecraft-java-voxel-world",
     "options": { "name": "amphion-southwest", "baseY": 64 }
   }, "retainOutput": true }
   ```

   Invoke through `modkit.invoke_readonly`. `name` is a 1..64 character lowercase ASCII slug
   (`a-z`, digits, `_`, `-`); `baseY` is an integer 0..191. One original grid cell becomes one
   Minecraft block. The source scale/translation remain in the conversion receipt, not block size.
   The existing vanilla texture-mean CIE76 palette assigns exposed cells; stone fills each column
   up to its highest occupied cell, and bedrock forms its bottom. Caves and overhang voids close.
3. Download `data.outputArtifact` through MCP `resources/read`, following `_meta.nextUri` and
   concatenating binary blobs. Verify length and SHA-256 and save the ZIP before releasing the
   retained output or closing the subject. It contains a named world folder with `level.dat`,
   `region/r.*.*.mca` and `modkit-conversion.json`. Target is Java 1.21.1/DataVersion 3955, no mods
   or datapack runtime. Preserve palette, fill and lighting losses from the receipt.
4. Open the saved ZIP through MCP. Extract its entries through `container.extract` with
   `input: { "entryId": "<entry path>" }` and retained binary output, saving the native folder.
   Open that folder using `modkit.open_subject`, select **Overworld — blocks around the spawn**
   using `modkit.open_selection`, then inspect `modkit.world_scene` info.
5. Render the saved world through `modkit.world_scene` with `view: "render"`, `camera: "orbit"`,
   width/height and the desired camera. Resolve game textures through declared ContentSources.
   The blocks view currently offers a 17×17 chunk window even when neighboring chunks are absent.
   For a small exported world, page its objects with the declared object layer ID and `limit: 20` (large object records may exceed the bounded projection at 50);
   follow cursors, select the actual saved chunks, then supply their `resourceIds` (or `modelComponents[].resourceId`) to the renderer
   (up to 1024). For a 440×440 quarter select the **wide, 33 x 33 chunks** view; the default
   17×17 view cannot cover it. A high-quality still can request `width: 4096`, `height: 3072`,
   `supersample: 2`, `retainOutput: true`: Scene renders at twice each dimension and averages four
   samples per output pixel. Large PNGs exceed the 4MiB inline-image limit; download the complete
   `data.outputArtifact` through the same chunk/SHA lifecycle, save before releasing, then inspect
   the saved PNG. This requires the server's output-artifacts authority. The common CPU renderer
   still has no GPU shadows. Check converted count against the
   receipt, save and visually inspect the PNG.
   A black image, zero primitives, or a source-voxel preview is not a native-world render check.

Report the ZIP, native world folder, rendered image, blocks/chunks, target version and meaningful
losses. Modkit reopen/render is separate from acceptance in a running Minecraft client; do not
claim the latter unless it was actually performed. Do not install into the user's saves or launch
their game unless requested.

## Detached cliff structure library

For a library of vertical wall modules outside the map, open the packaged UVP and call
`map.export-native` with retained output:

```json
{ "handle": "…", "operationId": "map.export-native", "input": {
  "schemaVersion": 1, "formatId": "minecraft-java-cliff-library",
  "options": { "name": "amphion-cliffs-3x5",
    "typePrefix": "CompoundFacilityCliff1:CliffMade20:",
    "blocksPerUnit": 3, "cliffBlocks": 5, "basementBlocks": 5 }
}, "retainOutput": true }
```

Discover the selected map's derived cliff type IDs first; the prefix above is Amphion's artificial
cliff family, not a universal SC2 label. The Minecraft extension must actually advertise this
encoder. It selects unique placed types and writes one native Java 1.21.1 structure NBT per variant,
plus one gallery representative per shape and a detached Anvil preview world.

For natural rock, or several families in one world, replace `typePrefix` with an explicit `families`
array, for example:

```json
{ "families": [
  { "typePrefix": "CompoundFacilityCliff1:CliffMade20:", "style": "masonry" },
  { "typePrefix": "ShakurasCliff0:CliffNatural0:", "style": "natural" }
] }
```

Use a single family for each separate library; use both with `layout: "map", region: "all"` for a
full cliff-only Amphion world. Prefixes are source data and must not overlap. Do not pass both
`typePrefix` and `families`. Natural shells retain irregular source heights, use deepslate,
cobbled deepslate and basalt, and have no masonry niches, cornice or ornamental lip. Their lower
rock base is synthetic; source textures and overhangs are approximated. They share the explicit
cell scale, rise and two-block wall policy, but are not straightened like masonry ramp sides.
Record these losses and visually check natural and artificial gallery previews separately.
Mixed maps retain each style through the join pass; masonry wins an overlapping solid column,
and explicit ramp profiles replace conflicting shell columns through their upper rise.

The native conversion receipt lists `regionFiles`. Extract every listed region through the
container operation: a full 528×528 frame can cross region boundaries; populated cliff columns
may occupy fewer regions when its outer margins are empty. Do not assume only `r.0.0.mca`.
Verify region/chunk counts, both families and the full source bounds before rendering.

This is a stylized side-wall conversion with an explicit zero datum. The upper two model units
become cliffBlocks above zero; basementBlocks (default 5, range 1..16) adds a synthetic stone base
below zero. With 5 + 5 the plateau is at local Y=10; a bottom granite slab at Y=10 raises the rim by 0.5. NBT height is 11 cells and zeroLevelY is local Y=5. Place it five blocks
below the intended ground datum; library.json records placementOffsetY=-5.
At zero a relief granite stair cornice begins the upper profile, followed by diorite and a half-block granite
rim above the plateau. Below zero, small blind stone niches in alternating rows retain solid backing and projecting
andesite posts. There are no windows or enclosed chambers. Two-block wall strips follow pinned source centrelines and leave
plateau interiors empty; horizontal ramp floors are omitted. Preserve these styling/geometry losses.

Save and verify the retained ZIP before releasing it. Extract README.md, library.json and
preview-world.zip through the container operation. Reopen and render the saved native preview.
For a sparse gallery, select only chunks actually present in the saved region: a rectangular
viewer selection also offers empty chunks. Check converted/total against those present chunks,
then inspect a close view of the masonry as well as the overview.

The outer ZIP contains a datapack folder: unpack that folder into the chosen world's datapacks
and reload, when installing is requested. The README lists `/place template modkit:cliffs/<id>`
and the gallery ID. Creating the ZIP does not authorize installing it into an existing save.

## Place cliff modules on a map quarter

Use the same native target with `layout: "map"` and `region: "southwest"` (or `"all"`).
For example, options can include name=amphion-sw-handmade-3x5, the discovered artificial
typePrefix, blocksPerUnit=3, cliffBlocks=5 and basementBlocks=5.
This returns a native world ZIP directly, rather than a library/datapack. Only the selected cliff
family is placed; terrain, water, other objects and horizontal ramp floors are omitted.

The crop is the source heightfield's min-X/max-Z quarter. Geometry crossing the boundary is clipped,
not discarded by its anchor. Module local bounds, source positions and upright quarter-turn rotations
are applied to block centres; stair facing rotates too. Native world zero is Y=64, and the source
vertical step/reference are reused from the terrain overlay's walkable-level inference.
Non-unit/tilted/arbitrary-angle placements or a missing inferred cliff step refuse rather than guess.
The conversion receipt retains the source frame, per-instance placements and material overlap count.
Join original flat-wall silhouettes per datum, then normalize their width once after placement;
thinning already expanded module caps again can erase ramp tips. Ramp variants with at least three
upper-section heights use straight two-block profiles oriented by the source slope, with the full
rise quantized to half-block steps. Place these final profiles without another thinning pass.
Their rim tops run from 0.5 above the low plateau to 0.5 above the high plateau; whole-height tops
use solid granite, half-height tops use bottom slabs, keeping the wall connected. Verify physical
top heights in saved native blocks, not just the integer Y coordinates of slabs. Small enclosed contour-noise holes up to
16 raster cells are discarded before thinning; larger plateau interiors remain open. Check bends
and straight runs for broad pockets, and render ramp sidewalls close enough to verify their low
tips and joins with both plateau levels in the saved native world.
Solid blocks win over module air; differing overlapping solids keep the first state and are counted.
Inspect such joints in the actual saved-world render; a placed-module preview is not seam acceptance.
Download, verify, extract and reopen/render this direct world ZIP using the native-world workflow above.

