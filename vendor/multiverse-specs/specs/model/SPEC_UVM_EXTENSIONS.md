# UVM extension registry

**Version:** 1.0 Draft
**Companion to:** [SPEC_UVM.md](SPEC_UVM.md)

This document is the normative definition of every extension in the `UV_*` namespace.
Each entry states where the extension attaches, its properties, its defaults, and what a
consumer that ignores it loses.

## Conventions

- **Required** means the property must be present when the extension is present.
- All angles are radians, all distances metres, all times seconds, unless stated.
- Colours are linear-space float arrays; `[r,g,b]` or `[r,g,b,a]` in `[0,1]`.
- `node`, `material`, `texture`, `accessor`, `bufferView`, `skin`, `mesh` properties are
  **integer indices** into the corresponding top-level glTF array, matching glTF's own
  convention. They are never names.
- Every extension object MAY carry `extras`. Consumers **MUST** preserve `extras` on
  round-trip.

## Extension index

| Extension                                                                   | Attaches to              | Degradation if ignored                                                |
| --------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| [`UV_asset`](#uv_asset)                                                     | root                     | Asset loads; identity and capability summary unavailable              |
| [`UV_units`](#uv_units)                                                     | root                     | Asset renders at metre scale; grid placement wrong                    |
| [`UV_game_socket`](#uv_game_socket)                                         | node                     | Socket becomes an ordinary empty node                                 |
| [`UV_game_skeleton`](#uv_game_skeleton)                                     | skin                     | Rig animates correctly; retargeting and mechanical joints unavailable |
| [`UV_retarget`](#uv_retarget)                                               | skin                     | Animation cannot be shared with other rigs                            |
| [`UV_game_material_team_color`](#uv_game_material_team_color)               | material                 | Unit renders in its neutral colour                                    |
| [`UV_game_material`](#uv_game_material)                                     | material                 | PBR approximation is used                                             |
| [`UV_game_animation_clips`](#uv_game_animation_clips)                       | root and animation       | glTF clips play; catalog-only selection and binding slots unavailable |
| [`UV_game_animation_events`](#uv_game_animation_events)                     | animation                | No gameplay events fire                                               |
| [`UV_animation_layers`](#uv_animation_layers)                               | root                     | All clips treated as full-body overrides                              |
| [`KHR_animation_pointer`](#khr_animation_pointer)                           | animation channel target | Static authored values used (see Khronos registry)                    |
| [`UV_game_effects`](#uv_game_effects)                                       | root                     | No particles, ribbons or projectors                                   |
| [`UV_game_collision`](#uv_game_collision)                                   | node                     | No collision; consumer may fall back to mesh bounds                   |
| `MSFT_lod` (external Microsoft extension)                                   | node/material            | Highest detail only; lower LODs ignored                               |
| [`MODKITX_lod_selection`](#incubating-lod-selection-batching-and-impostors) | root                     | Standard LOD chain remains; custom selection policy unavailable       |
| `MODKITX_batching_hints`                                                    | root                     | Rendering remains correct; advisory batching hints unavailable        |
| `MODKITX_impostor_relation`                                                 | root                     | Original LOD nodes remain; impostor proxy unavailable                 |
| [`UV_game_variants`](#uv_game_variants)                                     | root                     | Default variant only                                                  |
| [`UV_game_gameplay`](#uv_game_gameplay)                                     | root                     | Art loads without statistics                                          |
| [`UV_game_spring`](#uv_game_spring)                                         | any                      | Spring-specific data unavailable                                      |
| [`UV_game_sc2`](#uv_game_sc2)                                               | any                      | SC2-specific data unavailable                                         |
| [`UV_game_cnc`](#uv_game_cnc)                                               | any                      | C&C-specific data unavailable                                         |
| [`UV_provenance`](#uv_provenance)                                           | root                     | Conversion history unavailable                                        |

---

## `UV_asset`

Attaches to: document root.

| Property         | Type     | Required | Default | Description                                                                                                                                                    |
| ---------------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string   | yes      | —       | Stable identifier, `namespace/name` form                                                                                                                       |
| `class`          | string   | yes      | —       | `unit`, `building`, `character`, `vehicle`, `creature`, `weapon`, `projectile`, `prop`, `feature`, `effect`, `terrain-object`, `ui`. Unknown → treat as `prop` |
| `categories`     | string[] | no       | `[]`    | Free-form classification tags                                                                                                                                  |
| `displayName`    | string   | no       | —       | Human-readable name                                                                                                                                            |
| `description`    | string   | no       | —       | Free text                                                                                                                                                      |
| `coreRenderable` | boolean  | no       | `true`  | `false` only when the asset has no meaningful geometry without extensions                                                                                      |
| `capabilities`   | object   | no       | —       | Summary, see below                                                                                                                                             |
| `author`         | string   | no       | —       | Attribution                                                                                                                                                    |
| `licence`        | string   | no       | —       | SPDX identifier or URL                                                                                                                                         |

`capabilities`: `skinned` (boolean), `animated` (boolean), `effects` (boolean),
`collision` (boolean), `lods` (integer), `variants` (string[]), `sockets` (integer),
`triangles` (integer), `bones` (integer).

Writers **MUST** keep `capabilities` consistent with the document. Readers **MUST NOT** rely
on it for correctness — it exists so an asset browser can filter a library after reading only
the JSON chunk.

---

## `UV_units`

Attaches to: document root.

| Property              | Type      | Required | Default | Description                                           |
| --------------------- | --------- | -------- | ------- | ----------------------------------------------------- |
| `sourceUnit`          | string    | no       | `meter` | Name of the source game's distance unit               |
| `metersPerSourceUnit` | number    | yes      | —       | Physical scale factor already applied to geometry     |
| `sourceUnitsPerCell`  | number    | no       | —       | Source units spanning one gameplay grid cell          |
| `footprintCells`      | number[2] | no       | —       | Grid footprint, integer or fractional                 |
| `sourceFrameRate`     | number    | no       | —       | Authoring frame rate, when the source was frame-based |

Geometry in a UVM file is **already in metres**. These fields describe the relationship the
importer used, so an exporter can invert it exactly rather than re-deriving it.

---

## `UV_game_socket`

Attaches to: node.

| Property     | Type     | Required | Default | Description                                                         |
| ------------ | -------- | -------- | ------- | ------------------------------------------------------------------- |
| `role`       | string   | yes      | —       | See role table in [SPEC_UVM.md §10.2](SPEC_UVM.md#102-socket-roles) |
| `index`      | integer  | no       | `0`     | Ordinal among sockets sharing a role                                |
| `tags`       | string[] | no       | `[]`    | Free-form qualifiers (`primary`, `left`, `cannon`)                  |
| `forward`    | string   | no       | `-z`    | Local axis pointing out of the socket                               |
| `up`         | string   | no       | `+y`    | Local axis defining roll reference                                  |
| `accepts`    | string[] | no       | —       | For `hardpoint`: asset classes or tags it accepts                   |
| `capacity`   | integer  | no       | `1`     | For `passenger`/`hardpoint`: slot count                             |
| `radius`     | number   | no       | —       | Advisory attachment volume                                          |
| `effectHint` | string   | no       | —       | For `effect`: suggested effect id                                   |
| `sourceName` | string   | no       | —       | Original attachment name in the source format                       |

`sourceName` matters for round-trip: Spring scripts and Warcraft 3 triggers reference
attachments by their original string name, and a renamed node would break them.

---

## `UV_game_skeleton`

Attaches to: skin.

| Property      | Type      | Required | Default | Description                                                                             |
| ------------- | --------- | -------- | ------- | --------------------------------------------------------------------------------------- |
| `roles`       | object    | no       | `{}`    | Map of joint index (as string key) → role name                                          |
| `axes`        | object    | no       | `{}`    | Map of joint index → axis descriptor                                                    |
| `sourceOrder` | integer[] | no       | —       | Original bone indices, for exact re-export ordering                                     |
| `billboards`  | object    | no       | `{}`    | Map of joint index → `none`/`spherical`/`cylindrical-x`/`cylindrical-y`/`cylindrical-z` |

Axis descriptor: `{ "rotate": "x"|"y"|"z", "limits": [min, max], "translate": "x"|"y"|"z",
"translateLimits": [min, max] }`.

Registered roles: `root`, `pelvis`, `spine`, `chest`, `neck`, `head`,
`shoulder_{l,r}`, `upperarm_{l,r}`, `forearm_{l,r}`, `hand_{l,r}`,
`thigh_{l,r}`, `calf_{l,r}`, `foot_{l,r}`, `toe_{l,r}`,
`turret_yaw`, `turret_pitch`, `barrel_pitch`, `recoil`, `wheel_{n}`, `track_{l,r}`,
`rotor`, `propeller`, `thruster_{n}`, `door_{n}`, `flap_{n}`, `aim`, `look`, `hardpoint_{n}`.

`sourceOrder` exists because several formats — M3 among them — reference bones by index from
other chunks. Preserving the original index order lets an exporter emit those references
without a remap table.

`billboards` carries per-bone billboard flags, which M3 (`BONE` flags) and MDX both use and
which glTF has no representation for. Ignoring them produces visibly wrong foliage and
sprite-like sub-objects.

---

## `UV_retarget`

Attaches to: skin.

| Property         | Type   | Required | Default   | Description                                                                 |
| ---------------- | ------ | -------- | --------- | --------------------------------------------------------------------------- |
| `profile`        | string | yes      | —         | `humanoid-1`, `quadruped-1`, `vehicle-1`, or a custom name                  |
| `bones`          | object | yes      | —         | Map of profile bone name → joint index                                      |
| `restPose`       | string | no       | `unknown` | `t-pose`, `a-pose`, `bind`, `unknown`                                       |
| `scaleReference` | object | no       | —         | `{ boneA, boneB, meters }` — measured distance for proportion normalisation |

---

## `UV_game_material_team_color`

Attaches to: material.

| Property        | Type       | Required    | Default         | Description                                                                |
| --------------- | ---------- | ----------- | --------------- | -------------------------------------------------------------------------- |
| `maskSource`    | string     | yes         | —               | `texture`, `vertexColor`, `paletteRange`, `whole`                          |
| `maskTexture`   | object     | conditional | —               | `{ index, texCoord, channel }` — required when `maskSource` is `texture`   |
| `range`         | integer[2] | conditional | —               | Palette index range, required when `maskSource` is `paletteRange`          |
| `vertexChannel` | string     | conditional | `a`             | `r`/`g`/`b`/`a`, when `maskSource` is `vertexColor`                        |
| `targets`       | string[]   | no          | `["baseColor"]` | Which PBR slots the colour applies to: `baseColor`, `emissive`, `specular` |
| `blend`         | string     | no          | `multiply`      | `multiply`, `add`, `replace`, `overlay`, `lerp`                            |
| `strength`      | number     | no          | `1.0`           | Blend weight                                                               |
| `defaultColor`  | number[4]  | no          | `[1,1,1,1]`     | Colour to use when no team is assigned                                     |
| `glow`          | object     | no          | —               | Secondary emissive team mask: `{ maskTexture, blend, strength }`           |

`channel` is `r`, `g`, `b`, `a`, or `rgb` for a full-colour mask.

The `glow` sub-object covers Warcraft 3's replaceable ID 2 (team glow), which is a separate
mask from team colour and behaves as emissive rather than albedo.

---

## `UV_game_material`

Attaches to: material.

| Property          | Type     | Required | Default  | Description                                                                                                    |
| ----------------- | -------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `shader`          | string   | yes      | —        | Namespaced shader identity, e.g. `sc2.standard`, `mdx.layer`, `w3d.vertex-material`                            |
| `blendMode`       | string   | no       | `opaque` | `opaque`, `alpha-blend`, `alpha-test`, `additive`, `modulate`, `modulate2x`, `alpha-key`, `screen`, `subtract` |
| `alphaCutoff`     | number   | no       | `0.5`    | For `alpha-test`                                                                                               |
| `cull`            | string   | no       | `back`   | `back`, `front`, `none`                                                                                        |
| `depthTest`       | boolean  | no       | `true`   |                                                                                                                |
| `depthWrite`      | boolean  | no       | `true`   |                                                                                                                |
| `sortPriority`    | integer  | no       | `0`      | Higher draws later                                                                                             |
| `unshaded`        | boolean  | no       | `false`  | Skip lighting; prefer `KHR_materials_unlit` when the whole material is unlit                                   |
| `twoSidedNormals` | boolean  | no       | `false`  | Flip normals on backfaces                                                                                      |
| `layers`          | object[] | no       | `[]`     | Layer stack, see below                                                                                         |
| `passes`          | object[] | no       | —        | Multi-pass composite; each entry has its own `blendMode`, `layers`                                             |
| `params`          | object   | no       | `{}`     | Shader-specific scalar/vector parameters                                                                       |

Layer object:

| Property   | Type      | Default               | Description                                                                                      |
| ---------- | --------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| `slot`     | string    | —                     | `diffuse`, `normal`, `specular`, `emissive`, `alpha`, `ao`, `height`, `env`, `decal`, `layer{n}` |
| `texture`  | integer   | —                     | glTF texture index                                                                               |
| `uv`       | integer   | `0`                   | `TEXCOORD_n` channel                                                                             |
| `op`       | string    | `modulate`            | `modulate`, `add`, `blend`, `replace`, `subtract`, `modulate2x`, `lerp`                          |
| `tiling`   | number[2] | `[1,1]`               | UV scale                                                                                         |
| `offset`   | number[2] | `[0,0]`               | UV offset                                                                                        |
| `scroll`   | number[2] | `[0,0]`               | UV units per second                                                                              |
| `rotation` | number    | `0`                   | UV rotation                                                                                      |
| `invert`   | boolean   | `false`               | Invert sampled value                                                                             |
| `channel`  | string    | —                     | Restrict to one channel                                                                          |
| `exponent` | number    | —                     | Specular exponent, `specular` slot                                                               |
| `strength` | number    | `1.0`                 | Slot-specific intensity                                                                          |
| `wrap`     | string[2] | `["repeat","repeat"]` | `repeat`, `clamp`, `mirror` per axis                                                             |

When `passes` is present, `layers` **MUST** describe pass 0 as well, so single-pass consumers
have something to render.

---

## `UV_game_animation_clips`

Attaches to: document root (catalog), animation (per-animation selection metadata).

ROOT payload:

| Property          | Type     | Required | Description                                                                                                                                           |
| ----------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clips`           | object[] | yes      | Complete catalog: unique `id`, `name`, `durationSeconds`, unique `sourceSequenceIndex`; optional `animation`, `sourceId`, `looping`, `kind`, `frames` |
| `materialTargets` | object[] | no       | Inactive `{id,properties:[{path,value,sequenceTracks}]}` slots; published common material animation paths only; no resource graph                     |
| `attachments`     | object[] | no       | Composition receipts: `id`, `mapping`, `clips`, `playbackLimitations`; source data is copied into common UVM structures                                        |

Every selectable glTF animation is linked exactly once. An absent animation link retains a
material-only or truly empty sequence without invalid empty glTF animations. Explicit absolute or
global effect timelines can remain outside the selectable catalog. Catalog sequence indices are
the material timeline keys, independent of glTF and catalog ordering. See SPEC_UVM §12.2 for the
binding path whitelist and atomic attachment rules. `uvm.animation.schema.json#catalog` describes
the root shape; the existing `#clips` anchor continues to describe animation-attached metadata.

Animation-attached payload:

| Property          | Type       | Required | Default | Description                                                                           |
| ----------------- | ---------- | -------- | ------- | ------------------------------------------------------------------------------------- |
| `clip`            | string     | yes      | —       | Canonical clip name, lower-case (`stand`, `walk`, `attack`, `death`, `birth`, `work`) |
| `variant`         | string     | no       | —       | Variant suffix (`01`, `ready`, `channel`)                                             |
| `loop`            | string     | no       | `once`  | `once`, `loop`, `ping-pong`, `hold`                                                   |
| `priority`        | integer    | no       | `0`     | Higher wins when several clips are eligible                                           |
| `concurrent`      | boolean    | no       | `false` | May play simultaneously with other clips                                              |
| `blendInSeconds`  | number     | no       | `0`     |                                                                                       |
| `blendOutSeconds` | number     | no       | `0`     |                                                                                       |
| `speedScale`      | number     | no       | `1.0`   | Playback rate multiplier                                                              |
| `sourceFrameRate` | number     | no       | —       | Original frame rate                                                                   |
| `sourceRange`     | integer[2] | no       | —       | Original `[startFrame, endFrame]`                                                     |
| `sourceName`      | string     | no       | —       | Original sequence name, verbatim                                                      |
| `boneMask`        | integer[]  | no       | —       | Joints this clip may affect                                                           |

`priority` and `concurrent` mirror `RenderAnimation.priority` and
`RenderAnimation.concurrent` in the Modkit IR; StarCraft II selects sequences by priority and
plays several at once, so a converter that flattens them to a name list breaks the asset.

`sourceName` is preserved verbatim because game data references sequences by their exact
original string (`"Attack 01"`, including the space and zero-padding).

TRS channels that originate from independent source clocks use the bounded
`channel.extras.uv` metadata defined by `uvm.animation.schema.json`: `globalSeqId` identifies a
global source timeline, while the atomic `concurrent: true` + positive `wrapSeconds` pair identifies
an M3 concurrent STC. The modes are mutually exclusive. `animation.extras.uv.sourceDurationSeconds`
preserves the parent clip duration independently of those sampler key ranges.

---

## `UV_game_animation_events`

Attaches to: animation.

| Property | Type     | Required | Default | Description              |
| -------- | -------- | -------- | ------- | ------------------------ |
| `events` | object[] | yes      | —       | Ordered by `t` ascending |

Event object:

| Property   | Type    | Required | Default | Description                       |
| ---------- | ------- | -------- | ------- | --------------------------------- |
| `t`        | number  | yes      | —       | Time in seconds from clip start   |
| `name`     | string  | yes      | —       | Registered or custom event name   |
| `socket`   | integer | no       | —       | Node index of the relevant socket |
| `payload`  | object  | no       | `{}`    | Event-specific data               |
| `duration` | number  | no       | `0`     | For windowed events               |

Registered names: `fire_weapon`, `spawn_effect`, `sound`, `footstep`, `hit`,
`damage_window_start`, `damage_window_end`, `spawn_object`, `detach_object`, `swap_variant`,
`enable_collision`, `disable_collision`, `camera_shake`, `script`.

`script` carries only an identifier in `payload.id`. It **MUST NOT** carry executable code;
consumers **MUST NOT** evaluate payloads.

---

## `UV_animation_layers`

Attaches to: document root.

| Property      | Type     | Required | Default | Description                                                             |
| ------------- | -------- | -------- | ------- | ----------------------------------------------------------------------- |
| `layers`      | object[] | yes      | —       | Ordered; index 0 is the base layer                                      |
| `assignments` | object   | no       | `{}`    | Map of animation index → layer index; unassigned animations use layer 0 |

Layer object: `name` (string, required), `mode` (`override`/`additive`, default `override`),
`weight` (number, default `1.0`), `boneMask` (integer[], optional — omitted means all joints),
`additiveReference` (integer, optional — animation index supplying the additive base pose).

---

## `KHR_animation_pointer`

Attaches to: `animation.channel.target`, following the ratified Khronos extension unchanged.

The containing channel keeps its ordinary `sampler` index. Its target **MUST** set
`path: "pointer"`, **MUST NOT** set `node`, and carries:

| Property  | Type   | Required | Description                                    |
| --------- | ------ | -------- | ---------------------------------------------- |
| `pointer` | string | yes      | JSON Pointer (RFC 6901) into the glTF document |

Constraints:

- `pointer` **MUST** resolve to an existing property in the document at load time.
- `pointer` **MUST NOT** point into `/buffers`, `/bufferViews`
  or `/accessors`.
- Writers **MUST** leave the pointed-to static value populated with the sequence-neutral
  default so consumers ignoring this extension still render sensibly.
- `STEP` and `LINEAR` preserve source line types 0 and 1. Hermite (2) and Bezier (3) both use
  glTF `CUBICSPLINE`; `channel.extras.uv.sourceLineType` **MUST** identify which source form is
  encoded. Hermite coefficients and Bezier control points are converted to/from glTF
  derivatives using the adjacent key interval.
- Sequence-local tracks carry `animation.extras.uv.sourceSequenceIndex`. Independent timelines
  carry `animation.extras.uv.effectTrackScope` equal to `absolute` or `global`; a global timeline
  **MUST** also carry a safe non-negative `globalSeqId`, while an absolute timeline **MUST NOT**.
- An M3 concurrent STC effect track **MUST** remain sequence-local and set
  `channel.extras.uv.concurrent` to `true` together with a finite positive
  `channel.extras.uv.wrapSeconds`. Writers and readers **MUST** treat the pair atomically. A
  UVM-aware consumer wraps sequence time by that duration for the channel; generic glTF consumers
  may sample the stored timeline without the wrap policy.
- Readers **MUST** reject an interpolation/source-line-type mismatch or malformed timeline scope.

---

## `UV_game_effects`

Attaches to: document root.

| Property     | Type     | Required | Default  | Description                  |
| ------------ | -------- | -------- | -------- | ---------------------------- |
| `profile`    | string   | no       | `common` | `common`, `m3`, `mdx`, `w3d` |
| `particles`  | object[] | no       | `[]`     |                              |
| `ribbons`    | object[] | no       | `[]`     |                              |
| `forces`     | object[] | no       | `[]`     |                              |
| `warps`      | object[] | no       | `[]`     |                              |
| `projectors` | object[] | no       | `[]`     |                              |

### Particle emitter

Common-subset properties (every effects-capable consumer **MUST** support these):

| Property          | Type        | Default     | Description                                                             |
| ----------------- | ----------- | ----------- | ----------------------------------------------------------------------- |
| `name`            | string      | —           |                                                                         |
| `node`            | integer     | required    | Node supplying the emitter transform                                    |
| `material`        | integer     | required    | glTF material index                                                     |
| `emitShape`       | string      | `point`     | `point`, `sphere`, `box`, `disc`, `cylinder`, `plane`, `spline`, `mesh` |
| `emitShapeRadius` | number      | `0`         |                                                                         |
| `emitShapeSize`   | number[3]   | `[0,0,0]`   |                                                                         |
| `emissionRate`    | number      | `0`         | Particles per second                                                    |
| `emitCount`       | integer     | `0`         | Burst count; `squirt` semantics                                         |
| `lifeSpan`        | number      | `1`         | Seconds                                                                 |
| `speed`           | number      | `0`         | m/s                                                                     |
| `gravity`         | number      | `0`         | m/s² along world down                                                   |
| `maxParticles`    | integer     | `256`       | Advisory cap; consumers **MUST** apply their own bound                  |
| `orientationMode` | string      | `billboard` | See below                                                               |
| `lifecycleSize`   | object      | —           | `{ start, middle, end, timeMiddle }`, each a `number[3]`                |
| `segmentColors`   | number[3][] | —           | Start, middle, end colours                                              |
| `segmentAlphas`   | number[3]   | —           | Start, middle, end alpha                                                |

Extended properties (preserved always, implemented as the consumer is able):
`speedRandom`, `randomizeSpeed`, `lifeSpanRandom`, `randomizeLifeSpan`, `mass`, `massRandom`,
`randomizeMass`, `drag`, `friction`, `bounce`, `collideTerrain`, `collideObjects`,
`maxCollisionEvents`, `collisionEmitter`, `collisionEmitMin`, `collisionEmitMax`,
`collisionEmitChance`, `collisionEmitEnergy`, `collisionProjector`, `collisionProjectorChance`,
`bounceRibbon`, `bounceRibbonChance`, `trailEmitter`, `trailEmitChance`, `trailEmitRate`,
`emitAngleX`, `emitAngleY`, `emitSpreadX`, `emitSpreadY`, `emitShapePoints`,
`emitShapeMeshes`, `emitShapeCutout`, `emitShapeCutoutRadius`, `emitShapeCutoutSize`,
`localForceChannels`, `worldForceChannels`, `feedbackLocalForceChannels`,
`feedbackWorldForceChannels`, `worldForceMassMultiplier`, `noiseAmplitude`, `noiseFrequency`,
`noiseCohesion`, `noiseEdge`, `windMultiplier`, `parentVelocity`, `modelSpace`,
`boneAnchored`, `xyQuad`, `rows`, `columns`, `filterMode`, `head`, `tail`, `tailLength`,
`lineEmitter`, `lifecycleSizeRandom`, `randomizeSize`, `lifecycleRotation`,
`lifecycleRotationRandom`, `randomizeRotation`, `rotationRelative`, `rotationAlwaysSet`,
`segmentColorsRandom`, `segmentAlphasRandom`, `randomizeColor`, `randomizeAlpha`,
`particleScaling`, `screenSpaceUv`, `lifeSpanUvAnim`, `decayUvAnim`, `tailUvAnim`,
`tailDecayUvAnim`, `modelAssets`, `swapModelParticleYZ`, and the `*Variation` channels
(`pitchVariation`, `yawVariation`, `speedVariation`, `sizeVariation`, `alphaVariation`,
`colorVariation`, `rotationVariation`, `spreadXVariation`, `spreadYVariation`), each an
object `{ shape, amplitude, frequency, phase }` with `shape` in
`none`/`sine`/`triangle`/`square`/`saw`/`noise`.

`orientationMode`: `billboard`, `tail`, `face-travel-direction`, `face-world-direction`,
`single-axis`, `terrain-oriented`, `terrain-direction-oriented`, `emitter-oriented`,
`physics-oriented`, `pinned`, `trail`. Unknown values **MUST** fall back to `billboard`.

`modelSpace` and `boneAnchored` are independent. `modelSpace` selects the simulation frame;
`boneAnchored` keeps the emission origin attached to its node even in model-space
simulation. MDX leaves `boneAnchored` unset (model-space pivot behaviour); M3 sets it.
Collapsing the two into one flag produces visibly wrong motion for one of the two families.

### Ribbon emitter

`name`, `node`, `material`, `ribbonType` (`billboard`/`planar`/`cylinder`/`star`), `sides`,
`starRatio`, `divisions`, `heightAbove`, `heightBelow`, `widths` (`number[3]`),
`widthTimeMiddle`, `emissionRate`, `lifeSpan`, `speed`, `pitch`, `yaw`, `spreadX`, `spreadY`,
`gravity` (`number[3]`), `drag`, `mass`, `maxLength`, `lengthAndTime`, `emissionOffset`,
`emissionVector`, `segmentColors`, `segmentAlphas`, `colorTimeMiddle`, `textureSlot`,
`rows`, `columns`, `splineEndpoints`, plus the collision, force-channel, noise and
`*Variation` channels listed for particles.

### Force

`name`, `node`, `type` (`radial`/`wind`/`explosion`), `shape`
(`sphere`/`cylinder`/`box`/`hemisphere`), `channels` (integer bitmask), `strength`, `width`,
`height`, `length`, `falloff`, `heightGradient`, `unbounded`.

### Warp

`name`, `node`, `warpType` (integer), `radius`, `height`, `strength`, `angular`, `axial`,
`radial`.

### Projector

`name`, `node`, `material`, `projectionType` (`orthographic`/`perspective`), `offset`,
`pitch`, `yaw`, `roll`, `fieldOfView`, `aspectRatio`, `near`, `far`, box offsets
(`boxOffsetZBottom`, `boxOffsetZTop`, `boxOffsetXLeft`, `boxOffsetXRight`, `boxOffsetYFront`,
`boxOffsetYBack`), `falloff`, `alphaInit`, `alphaMid`, `alphaEnd`, lifetime envelope
(`lifetimeAttack`, `lifetimeAttackTo`, `lifetimeHold`, `lifetimeHoldTo`, `lifetimeDecay`,
`lifetimeDecayTo`), `attenuationDistance`, `active`, `layer`, `flags`.

---

## `UV_game_collision`

Attaches to: node.

| Property | Type     | Required | Default   | Description                                                    |
| -------- | -------- | -------- | --------- | -------------------------------------------------------------- |
| `shapes` | object[] | yes      | —         | One or more primitives                                         |
| `role`   | string   | no       | `physics` | `physics`, `hit`, `selection`, `footprint`, `effect`, `vision` |
| `layer`  | string   | no       | —         | Collision layer name                                           |
| `mask`   | string[] | no       | —         | Layers this collider interacts with                            |

Shape object:

| Property        | Type       | Required    | Description                                                            |
| --------------- | ---------- | ----------- | ---------------------------------------------------------------------- |
| `kind`          | string     | yes         | `box`, `sphere`, `capsule`, `cylinder`, `convex-hull`, `mesh`, `plane` |
| `matrix`        | number[16] | no          | Column-major local transform; identity if omitted                      |
| `size`          | number[3]  | conditional | Full extents for `box`                                                 |
| `radius`        | number     | conditional | For `sphere`, `capsule`, `cylinder`                                    |
| `height`        | number     | conditional | For `capsule`, `cylinder`                                              |
| `axis`          | string     | no          | `x`/`y`/`z` for `capsule`, `cylinder`; default `y`                     |
| `positions`     | integer    | conditional | Accessor index for `convex-hull` and `mesh`                            |
| `indices`       | integer    | conditional | Accessor index for `mesh`                                              |
| `normal`        | number[3]  | conditional | For `plane`                                                            |
| `collisionMask` | integer    | no          | Effect collision channel bitmask                                       |

Vertex data lives in accessors, never inline in JSON — a convex hull with 400 vertices is
4.8 KB of binary and roughly 12 KB of JSON.

---

## Incubating LOD selection, batching and impostors

`UV_game_lod` is superseded before publication. It mixed topology selection, advisory batching and
impostor relations in one object. The official `MSFT_lod` remains the sole node/material topology
extension and is never redefined.

Three provisional extensions incubate under an owned prefix; these names are not stable registry
claims:

- `MODKITX_lod_selection`: selection thresholds and hysteresis only;
- `MODKITX_batching_hints`: advisory renderer tuning only;
- `MODKITX_impostor_relation`: explicit node-to-impostor relation only.

All attach to the document root.

| Property     | Type     | Required | Default           | Description                                                   |
| ------------ | -------- | -------- | ----------------- | ------------------------------------------------------------- |
| `levels`     | object[] | yes      | —                 | Nodes participating in selection; topology remains `MSFT_lod` |
| `policy`     | string   | no       | `screen-coverage` | `screen-coverage`, `distance`, `manual`                       |
| `hysteresis` | number   | no       | `0.1`             | Fractional dead-band to prevent LOD flicker                   |

Selection level object: `node` (integer, required), `screenCoverage` (number, fraction of viewport
height) and/or `maxDistance` (number, metres). Batching entry contains `node`, advisory `mode` and
optional `triangleCountHint`. Impostor relation contains `node`, `texture` and `axes`.

Writers **SHOULD** emit official `MSFT_lod` so existing tools honour the node/material topology.
Portable selection semantics and advisory renderer tuning remain separate. Promotion from
`MODKITX_*` to any shared namespace requires governance, schemas, fixtures and an independent
consumer; until then consumers must preserve unknown data and may ignore all three safely.

---

## `UV_game_variants`

In addition to named variants, optional `visibility` records are
`{mesh:<glTF mesh index>,primitive:<mesh primitive index>,value:<finite number>}`. Each target is
unique and affects every instance of that primitive. `value > 0` draws it; other finite values hide
it. The numeric range is intentionally not clamped, preserving native scalar visibility tracks.
`KHR_animation_pointer` may target `/extensions/UV_game_variants/visibility/N/value`. A visibility
array alone is valid and does not require an invented named variant. See SPEC_UVM §15.2.

Attaches to: document root.

| Property      | Type     | Required | Default | Description                                |
| ------------- | -------- | -------- | ------- | ------------------------------------------ |
| `variants`    | object[] | yes      | —       | Exactly one **SHOULD** set `default: true` |
| `transitions` | object[] | no       | `[]`    | Advisory state machine                     |

Variant object: `name` (string, required), `default` (boolean), `showNodes` (integer[]),
`hideNodes` (integer[]), `materialVariant` (integer — index into
`KHR_materials_variants.variants`), `asset` (string URI — an external UVM file replacing
this one), `assetSha256` (64 lowercase hex; required for an external asset in immutable/runtime
packages), `alignSocket` (string — socket role used to align the external asset),
`effects` (integer[] — indices into `UV_game_effects.particles` enabled by this variant).

Transition object: `from`, `to`, `trigger` (string expression, advisory — consumers **MUST
NOT** evaluate it as code; it is documentation of intent).

Use `KHR_materials_variants` for pure material swaps. `UV_game_variants` covers geometry
visibility and whole-asset substitution, which `KHR_materials_variants` cannot express.

---

## `UV_game_gameplay`

Attaches to: document root.

Either `{ "$ref": "<uri>" }` referencing an external JSON document with the same shape, or
inline:

| Property         | Type      | Description                                                           |
| ---------------- | --------- | --------------------------------------------------------------------- |
| `schema`         | string    | URI naming the vocabulary, so a validator can check the payload       |
| `faction`        | string    |                                                                       |
| `unitClass`      | string    |                                                                       |
| `cost`           | object    | Open map of resource name → amount, plus `buildTimeSeconds`, `supply` |
| `health`         | number    |                                                                       |
| `shields`        | number    |                                                                       |
| `armor`          | number    |                                                                       |
| `armorType`      | string    |                                                                       |
| `sight`          | number    | Metres                                                                |
| `speed`          | number    | m/s                                                                   |
| `turnRate`       | number    | rad/s                                                                 |
| `footprintCells` | number[2] |                                                                       |
| `movementClass`  | string    | Matches a UVW navigation class id                                     |
| `weapons`        | object[]  | See below                                                             |
| `abilities`      | string[]  |                                                                       |
| `builds`         | string[]  | Asset ids this can construct                                          |
| `requires`       | string[]  | Prerequisite asset ids                                                |
| `tags`           | string[]  |                                                                       |

Weapon object: `id`, `socket` (node index), `projectile` (asset id or URI), `damage`,
`damageType`, `range`, `minRange`, `cooldownSeconds`, `salvo`, `targets`
(`ground`/`air`/`water`/`submerged`), `arc` (radians), `turretJoint` (joint index).

Unknown properties **MUST** be preserved verbatim.

---

## `UV_game_spring`

Attaches to: any object. Preserves Spring/Recoil concepts that have no cross-engine meaning.
This is **not** the Spring model format; it is a compatibility record.

| Property          | Type      | Description                                                                 |
| ----------------- | --------- | --------------------------------------------------------------------------- |
| `unitDef`         | string    | `UnitDef` name this asset belongs to                                        |
| `featureDef`      | string    | `FeatureDef` name, for world features                                       |
| `wreck`           | string    | `FeatureDef` or asset URI spawned on death                                  |
| `heap`            | string    | Second-stage wreck                                                          |
| `movementClass`   | string    | `MoveDef` name                                                              |
| `movementType`    | string    | `ground_vehicle`, `hover`, `ship`, `sub`, `air`, `spider`, `kbot`           |
| `pieces`          | object    | Map of joint index → Spring piece name                                      |
| `scriptType`      | string    | `cob`, `lua`                                                                |
| `scriptHooks`     | string[]  | Named script entry points (`Create`, `AimWeapon1`, `FireWeapon1`, `Killed`) |
| `weaponPieces`    | object    | Map of weapon number → `{ aimFrom, muzzle, flare }` joint indices           |
| `collisionVolume` | object    | `{ type, scale, offset, axis }` in Spring's own convention                  |
| `radius`          | number    | Spring collision radius, in elmos                                           |
| `height`          | number    | Spring model height, in elmos                                               |
| `midPos`          | number[3] | Spring mid-position offset, in elmos                                        |
| `teamTexture`     | integer   | glTF texture index used as Spring `tex2`                                    |
| `flags`           | object    | Remaining `S3O`/`OBJ` header flags                                          |

Spring keeps a strict piece-name contract with its scripts, so `pieces` and `weaponPieces`
must survive a round-trip or every script targeting the model breaks. Values are in Spring's
native elmo units, **not** metres, precisely so the export path is exact; `UV_units`
records the conversion factor used for the geometry.

---

## `UV_game_sc2`

| Property           | Type      | Description                                        |
| ------------------ | --------- | -------------------------------------------------- |
| `modelLink`        | string    | `CModel` catalog entry name                        |
| `actorLink`        | string    | `CActor` catalog entry name                        |
| `unitLink`         | string    | `CUnit` catalog entry name                         |
| `attachmentPoints` | object    | Map of node index → M3 `Ref_*` name                |
| `sequences`        | object[]  | `{ name, animation, priority, concurrent, flags }` |
| `physicsShapes`    | integer[] | Node indices carrying M3 `PHRB` shapes             |
| `boundingSphere`   | object    | `{ center, radius }` from `MODL`                   |
| `flags`            | integer   | `MODL` flag word                                   |
| `version`          | integer   | `MODL` chunk version                               |

---

## `UV_game_cnc`

| Property         | Type     | Description                                     |
| ---------------- | -------- | ----------------------------------------------- |
| `w3dHierarchy`   | string   | Hierarchy (`.w3d` HLOD) name                    |
| `houseColorSlot` | integer  | Material slot receiving house colour            |
| `damageStates`   | object[] | `{ name, threshold, variant }`                  |
| `turrets`        | object[] | `{ yawJoint, pitchJoint, muzzleSockets }`       |
| `aggregates`     | object[] | `{ socket, asset }` — W3D aggregate attachments |
| `iniSection`     | string   | Rules `.ini` section this asset belongs to      |

---

## `UV_provenance`

Attaches to: document root. See
[SPEC_UVM.md §17.2](SPEC_UVM.md#172-uv_provenance) for the worked example.

| Property      | Type     | Required | Description                                                               |
| ------------- | -------- | -------- | ------------------------------------------------------------------------- |
| `source`      | object   | yes      | `{ format, formatVersion, file, sha256, sourceAxes, sourceUnits }`        |
| `importer`    | object   | yes      | `{ id, version }`                                                         |
| `generatedAt` | string   | no       | RFC 3339 timestamp                                                        |
| `chain`       | object[] | no       | Prior conversions, oldest first — a UVM file converted twice records both |
| `lost`        | object[] | no       | `{ code, severity, feature, count, detail }`           |
| `warnings`    | object[] | no       | Non-loss diagnostics                                                      |

`sourceAxes`: `{ up, forward, handedness }` where `up`/`forward` are `+x`…`-z` and
`handedness` is `left`/`right`.

`severity`: `info`, `warning`, `error`. Build pipelines **SHOULD** fail on `error`.

`chain` matters for multi-hop conversion. An S3O imported to UVM and then exported to M3 and
re-imported has two entries, and the second importer can see that the first conversion
already lost the Spring piece names.

