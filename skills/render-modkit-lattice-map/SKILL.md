---
name: render-modkit-lattice-map
description: Render a terrain-height lattice overview of a supported game map or UVW world through Modkit, with cliffs, ramps, movement masks, resources and footprints. Use for tactical map diagrams; distinguish the shared lattice overview from 3D previews and simple top-down images.
---

# Render a Modkit lattice map

Use the existing game publisher → Host world source → UVW → common lattice path.
Keep game parsing, terrain flags and object classification at the native publisher.
Do not draw a screenshot approximation or add a separate archive reader.

## Select and inspect the source

Discover the installed MCP tools and the subject descriptor first. Open the map through
Modkit's public subject lifecycle; native dependencies must resolve through the selected
installation/content sources. Campaign Arizona means a specific authored state such as
CAM_1A, not a union of campaign stages. Record that state in the receipt.

The MCP `modkit.world_scene` tool currently supports:

- `view: "info"`: coordinate spaces, available facets, completeness and revisions.
- `view: "page"`, `facet: "layers" | "terrain" | "cliffs" | "navigation" | "traversal" | "gateways" | "objects" | "regions"`: inspect published layer metadata and movement
  classes using the schema advertised by the running tool; follow every cursor needed.
- `view: "export"`: materialize a retained UVW artifact and inspect excluded facets,
  omitted objects and lost fields. Download through the returned resource URI.
- `view: "image"`: a simple top-down world image. This is **not** the lattice renderer.
- `view: "render"`: the CPU 3D scene. This is **not** the lattice renderer.

The canonical tool schema is `apps/mcp/src/server.ts`; lifecycle implementation is
`apps/mcp/src/runtime.ts`. Availability depends on the installed build: tool names or
planned operations in this skill do not create callable methods. Read the live schema,
and never report a top-down or 3D preview as a lattice result.

## Produce the common overview

For development or a local export, reuse the public Host coordinator
`coordinateMapPreviewAssetSession` and its `common.view/world-scene-source@1` lease.
Call `materializeWorldToUvw`, serialize, then reopen with `parseUvwProfile` and
`createUvwWorldSceneSource`. Inspect the reopened source, and write its renderer input
with `scripts/lib/world-payload.mjs` (`writeWorldPayload`). Keep sibling layer identities
when one layer has `latticeOverview`, `latticeRamps` or traversal metadata, so space selection and object picking remain valid.

Run the existing renderer from the Core repository or an isolated equivalent build:

```powershell
node scripts/render-world-payload.mjs --payload C:/MKTEMP/map-payload --out C:/MKTEMP/map-render --lattice --lattice-style overview --size 1408x1408
```

The payload directory contains `world.json` and `world.bin`. Outputs include the PNG and
`render-receipt.json`. Use only `C:/MKTEMP` for temporary output in this workspace.
For an installed MCP without a lattice-specific view, use the exported UVW and this
existing renderer; do not invent a `world.render-lattice` operation.

## Interpret the drawing correctly

`SDK maps/lattice-overview.ts` owns the neutral overview contract and validation.
The native publisher supplies resolved elevation scalars, palette, cliff/ramp lines,
marker polygons and optional masks. Host projects geometry once into canonical x/z;
UVW preserves it. `packages/ui/src/world/lattice.ts` and `lattice-overview.ts` draw it.

Without a published overview, the existing lattice derives visual midlines only inside
explicit `cliffFace` cells. It must not substitute area perimeters for separating lines.
Inspect one-bank/ambiguous/budget diagnostics instead of concealing missing geometry.
Missing pathing is unknown, not clear. Movement classes are independent; terrain-only
classes exclude object blockers and campaign scroll limits. Static-object classes include initial fixed occupancy, but exclude mobile units, script changes and campaign scroll restrictions. Do not label them complete
runtime pathfinding. A derived ramp is not an authored native flag.

Overview images have no legend or text labels. Show height by fill, cliffs by separating
lines, ramps by geometry, and objects/resources by symbols and footprints.

## Verify before delivering

Check browser errors, bounds, orientation, preserved resource/destructible counts,
movement-class identity, ramp provenance and cliff diagnostics. Verify semantic annotations
survive native → canonical projection → UVW reopen. Compare the source and reopened data,
not merely two screenshots. When comparing games, render both with the same application
hash and settings. Keep source hashes, conversion losses and limitations in a separate
receipt, never painted over the map. Show the PNG by an absolute local path.

For a selected movement class, read its layer catalog entry and `layerId`, then page
`facet: "traversal"` with that id. `walkable` and directed `exits` are published facts;
`navigation` carries opaque publisher flags and must not be substituted for traversal.
Ramp patches live in the ground layer metadata as `latticeRamps` with `method` and
`quality`. Warzone does not publish ramp annotations: show its slopes through terrain height colours. Its native cliff blocking is whole-tile; a visual diagonal midline does not authorize half-tile traversal. Exact bank-distance ties use height affinity only as a secondary visual tie-break; known zero-normal-gradient boundaries are neutral, not missing data.
