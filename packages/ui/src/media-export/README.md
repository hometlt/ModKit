# World export composition

`MediaExportRequest` in `@modkit/sdk` selects the contents of GLB and rendered media.
The shared `renderWorldMedia` owner applies these options before model acquisition
and to sampled frames. The ground, cliff pieces and ramps stay together.

| Option | Values | Default |
| --- | --- | --- |
| `content` | `terrain`: ground, cliffs and ramps; `all`: also placed objects | `all` |
| `includeWater` | `true` or `false`, independent of `content` | `true` |

For `subject.convert --target glb`, put the options in the JSON file passed by
`--input`. The requested width/height set the baked terrain texture resolution.

Terrain with cliffs and ramps:

```json
{ "width": 2048, "height": 2048, "content": "terrain", "includeWater": false }
```

Terrain with cliffs, ramps and water:

```json
{ "width": 2048, "height": 2048, "content": "terrain", "includeWater": true }
```

The full scene:

```json
{ "width": 2048, "height": 2048, "content": "all", "includeWater": true }
```

All objects without water is also supported. Existing requests retain their
previous default composition. The legacy `derivedFrom` object filter intersects
with `content`; it does not override it. Excluded objects and their model
resources are omitted from the inspection and its model-status receipt. The
receipt also records the effective `content` and `includeWater` values. These
options select visual export contents; they do not modify the source world.
