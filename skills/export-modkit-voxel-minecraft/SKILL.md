---
name: export-modkit-voxel-minecraft
description: Export UVW/UVP terrain with placement-cell scale, cliff levels and slab ramps, or fill an existing surface-voxel model, to a native Minecraft Java world through MCP and render the saved world.
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
    "blocksPerUnit": 3, "cliffBlocks": 5 }
}, "retainOutput": true }
```

Discover the selected map's derived cliff type IDs first; the prefix above is Amphion's artificial
cliff family, not a universal SC2 label. The Minecraft extension must actually advertise this
encoder. It selects unique placed types and writes one native Java 1.21.1 structure NBT per variant,
plus one gallery representative per shape and a detached Anvil preview world.

This is a stylized masonry conversion: the upper two model units become one requested rise;
buried skirts and horizontal ramp floors are omitted. Diorite forms the white upper band, polished
granite the cap, and stone bricks/andesite the lower wall. Blind exterior recesses keep solid stone
backing and projecting separator posts; there are no windows or hollow rooms. Outline thickening
and geometry normalization are recorded in library.json. It is not a colour-matched full-map export.

Save and verify the retained ZIP before releasing it. Extract README.md, library.json and
preview-world.zip through the container operation. Reopen and render the saved native preview.
For a sparse gallery, select only chunks actually present in the saved region: a rectangular
viewer selection also offers empty chunks. Check converted/total against those present chunks,
then inspect a close view of the masonry as well as the overview.

The outer ZIP contains a datapack folder: unpack that folder into the chosen world's datapacks
and reload, when installing is requested. The README lists `/place template modkit:cliffs/<id>`
and the gallery ID. Creating the ZIP does not authorize installing it into an existing save.
