---
name: render-modkit-map-elements
description: Render selected placed map elements such as SC2 artificial cliffs or ramp-wall pieces through Modkit MCP, retaining their map positions while hiding ground and water. Use for diagnostic map-element views, not Minecraft conversion or a tactical lattice overview.
---

# Render selected elements in their map positions

Use the public map world and its existing model resources. Do not rebuild placements from model
names, decode game archives, or extract/repack a world merely to hide its terrain.

1. Open the selected native map or its saved UVP with `modkit.open_subject`. Discover the running
   `modkit.world_scene` schema: its `render` view must expose `content: "objects"` and `resourceIds`.
   A skill alone does not update the server. Use the selected installation's ContentSources for
   native game resources; a UVP may retain only some material dependencies.
2. Read `world_scene` with `view: "info"`. Take the actual available objects facet's `layerId`;
   do not assume `main/objects` (UVW imports may publish `main/item-main-objects`). Page that layer
   with `view: "page", facet: "objects", limit: 20`, following the envelope's `nextCursor`.
3. Select instances from the published `typeId`, `name`, model references and cliff/ramp metadata.
   Collect and deduplicate `resourceIds` (or `modelComponents[].resourceId`). These are public
   model-resource IDs, not raw archive paths. A resource filter selects every placement of each
   model; it does not select a single instance sharing that resource.
4. Render through the same map operation, for example:

   ```json
   { "handle": "…", "view": "render", "content": "objects",
     "resourceIds": ["<published model-resource ID>"],
     "camera": "orbit", "width": 1536, "height": 1152,
     "azimuth": 0.65, "elevation": 0.85, "zoom": 1.1, "retainOutput": true }
   ```

   `content` defaults to `all`. `objects` hides ground, terrain overlays and water only after the
   shared scene owner has prepared placements and cliff deformation. Terrain metadata and the map's
   framing remain available; the source is unchanged. The `resourceIds` limit is 1024. Camera target
   is an offset from the framed map centre, not an absolute map position. Start at moderate resolution.
5. Download retained output through `resources/read`, following `_meta.nextUri`, verify length and
   SHA-256, and save before releasing the output or closing its subject. Inspect the image, record
   selected instance/resource counts, converted model counts, camera and fidelity diagnostics.
   Do not treat an empty/black image or resource declarations as successful rendering.

## SC2 cliffs and ramp details

In the verified Amphion UVP, artificial cliffs publish type IDs beginning
`CompoundFacilityCliff1:CliffMade20:`. All 753 placements use 214 model resources (113 shape names
with variants). Select that family for an isolated artificial-cliff view. Natural cliffs belong to
other published families and are not part of this selection.

The verified natural-cliff family is `ShakurasCliff0:CliffNatural0:`: 485 placements, 64 resources.
Select instances also marked `derivedFrom: "cliffs"`. MCP renders use the shared scene-export
texture budget: the interactive viewer's smaller budget can refuse a 1024×1024 source texture
before it can be reduced. Even a reported converted model count does not prove visible pixels.

Ramp rails/walls are model pieces; the walkable ramp surface is terrain. In this specific Amphion
family, inspected shape names such as `QBRQ`, `QQBR`, `QQRB`, `QRBB`, `QRBQ`, `QRCB`, `RBQQ`,
`RQQB`, `RRCS`, `SCRR` and `SRRC` identify ramp-related pieces. Confirm the actual catalog and
geometry before selecting: these names are evidence for Amphion, not a universal ramp classifier.
For another map use its published ramp/cliff metadata and preview uncertain models individually.
To show the walkable ramp surface too, keep `content: "all"` and choose a local camera/visible
rectangle; `visibilityBounds` masks an X/Z rectangle and does not classify terrain triangles as ramps.

Detached source models may include long skirts normally buried in terrain. Without ground these
are visible. Missing reflection textures, material fallbacks and absent GPU shadows must be reported;
do not claim an exact SC2 game screenshot. Use `render-modkit-model-preview` for individual models.
