---
name: export-modkit-voxel-minecraft
description: Fill a Modkit surface-voxel model, assign Minecraft blocks by colour, export a native Java world ZIP through MCP and render the reopened world. Use after voxelize-modkit-model; not for arbitrary meshes or an overlay datapack.
---

# Export filled voxels to Minecraft Java

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
   (up to 256). Check converted count against the receipt, save and visually inspect the PNG.
   A black image, zero primitives, or a source-voxel preview is not a native-world render check.

Report the ZIP, native world folder, rendered image, blocks/chunks, target version and meaningful
losses. Modkit reopen/render is separate from acceptance in a running Minecraft client; do not
claim the latter unless it was actually performed. Do not install into the user's saves or launch
their game unless requested.
