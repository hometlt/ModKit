---
name: export-modkit-world-glb
description: Export a supported game map or UVW/UVP world to GLB through Modkit MCP, selecting terrain, cliffs, objects and water, then save and verify the retained binary output. Use for map-to-GLB conversion, not playable map conversion or general model editing.
---

# Export a Modkit world to GLB

Use the public Modkit world source and its shared GLB exporter. Native maps and UVW/UVP follow the same conversion owner; do not create a separate archive reader or exporter.

## Select and export

1. Discover the running server's tools. Open the user's selected source through `modkit.open_subject`, using the installation/content context required by that game's extension. Reuse an already selected handle when appropriate.
2. Call `modkit.glb_export_options` with `{ "handle": "…" }`. This validates world-source support and reports defaults, available presets, texture limits and output capacity. Export requires the server's retained outputs to be enabled (`--output-artifacts`). If the methods are absent, the running MCP server needs the updated build and a restart; do not claim the source was converted.
3. Call `modkit.export_glb`. Example terrain-only request:

   ```json
   { "handle": "…", "content": "terrain", "includeWater": false, "textureSize": 2048 }
   ```

   | Requested content | `content` | `includeWater` |
   | --- | --- | --- |
   | Terrain, cliffs and ramps | `terrain` | `false` |
   | Terrain, cliffs, ramps and water | `terrain` | `true` |
   | All scene objects and water | `all` | `true` |
   | All scene objects without water | `all` | `false` |

   Defaults are `all`, water enabled, and a 2048-square terrain bake. `textureSize` controls the ground bake, not the dimensions of every source texture. Use the live options response for limits. Terrain includes cliff-derived objects and ramps; ordinary placed objects are excluded. Selection happens before loading excluded object models.

## Save the binary result

The tool returns `data.receipt` and `data.outputArtifact`, not an inline GLB. Keep the subject open until the download finishes.

- Start at `outputArtifact.firstChunkUri` using MCP `resources/read`. Decode each content block's `blob` from base64 into bytes and follow response `_meta.nextUri` until absent. Stream or concatenate in order, without printing base64 into the conversation.
- Verify the complete byte count against `byteLength`, SHA-256 against `sha256`, and the GLB header/version/declared length before delivering the destination file.
- Call `modkit.release_output` with the artifact `id` after saving. Closing the subject also expires its retained outputs. Released or expired resource reads return a diagnostic envelope; they need not throw a transport exception.
- Keep the receipt's completeness and diagnostics. A valid GLB may still have missing models or partial source data. Do not describe a partial scene as a complete game-equivalent export.

Use a destination consistent with the user's request and workspace rules. Never overwrite the source. If this client cannot save binary resource chunks, use the maintained Modkit media-export CLI from the workspace instead; inspect its current help and pass the same selection through its request JSON (`width` and `height` correspond to MCP `textureSize`). Do not substitute a second converter.

## Verify and report

Report the saved file, size, chosen content/water settings and material receipt limitations. For visual checks, render or inspect the exported GLB itself; the source preview does not verify the exported asset. GLB is a scene snapshot, not a playable Minecraft map. Do not promise native displacement, water effects or identical lighting unless verified in the exported file.
