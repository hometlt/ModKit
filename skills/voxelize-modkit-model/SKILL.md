---
name: voxelize-modkit-model
description: Voxelize an existing static model or an exported map GLB through Modkit MCP, optionally crop its southwest quarter, save a coloured surface GLB and render the reopened result in Modkit. Use for voxel previews, not playable Minecraft world generation or solid volume filling.
---

# Voxelize a model and render the result

Use the shared model viewer, Scene voxelization and pinned obj2voxel kernel through MCP.
For a map, first obtain the requested scene composition as a GLB using `export-modkit-world-glb`.
Keep terrain, cliffs and ramps together; honour the user's water and object selection. Reuse an
already verified exported GLB when that is the selected source. Do not substitute a heightmap,
Minecraft block palette or a custom voxelizer.

1. Discover `modkit.model_scene` on the running server. This method requires an updated MCP build;
   a skill alone does not install or hot-reload methods. Open the selected GLB with
   `modkit.open_subject`, then call `modkit.model_scene` with `view: "info"`.
2. Choose the region and resolution. `southwest` means the lower left quarter of a north-up
   projection in the normalized Y-up model frame: minimum X and maximum Z. It is calculated from
   actual posed geometry bounds, not playable-map bounds. `all` keeps the full model. Record this
   convention when a user asks for a screen-relative quarter. Inspect an explicitly framed
   preview instead if the user's reference uses another camera orientation.
3. Call the method with, for example:

   ```json
   { "handle": "…", "view": "voxelize", "region": "southwest", "resolution": 128 }
   ```

   Geometry is clipped before voxelization. Resolution is 2..128 along the longest cropped
   extent, not blocks per metre. The receipt reports source bounds, crop rectangle, cell size,
   grid-to-source transform, clipped triangles, occupied cells, exposed faces and losses.
   At most 100000 clipped triangles are admitted. A refusal is not a partially successful file.
4. Download `data.outputArtifact` using its `firstChunkUri` and successive MCP `resources/read`
   `_meta.nextUri` links. Decode each binary `blob`, concatenate in order, verify `byteLength`,
   SHA-256 and GLB length, and save the file before releasing the output or closing its subject.
   Do not print base64 into the conversation. Use `modkit.release_output` after saving.
5. Open the saved voxel GLB as a new subject, then call:

   ```json
   { "handle": "…", "view": "render", "width": 1536, "height": 1152, "yaw": 0.5, "pitch": 0.85 }
   ```

   Save and inspect the returned PNG image block. It is the actual reopened voxel mesh rendered
   by Modkit Scene CPU renderer. A source preview does not verify the voxel result. Close the
   subject after rendering; report the GLB and image paths with occupied-cell count and cell size.

This profile produces an exposed surface shell with one texture-derived RGB sample per clipped
triangle. MASK coverage uses its centroid. Blended or layered shaders and missing textures refuse;
use a static base-colour GLB first. Skinning is sampled at the rest pose; animation and PBR are not
retained. No solid filling, Minecraft block assignment or native game write is implied. Preserve the
explicit losses and partial status instead of calling this an exact or playable conversion.
