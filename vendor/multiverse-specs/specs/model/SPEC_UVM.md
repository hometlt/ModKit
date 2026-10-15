# UVM — Universal Verse Model

**Version:** 1.0 Draft
**Status:** Draft for review
**Base standard:** glTF 2.0 (Khronos)
**Extension namespace:** `UV_*`
**Licence intent:** specification under CC-BY 4.0, reference implementation under MIT

## Table of contents

| Section                                   | Title                           |
| ----------------------------------------- | ------------------------------- |
| [1](#1-scope-and-goals)                   | Scope and goals                 |
| [2](#2-non-goals)                         | Non-goals                       |
| [3](#3-conformance)                       | Conformance                     |
| [4](#4-relationship-to-gltf-20)           | Relationship to glTF 2.0        |
| [5](#5-container-and-packaging)           | Container and packaging         |
| [6](#6-coordinate-system-and-units)       | Coordinate system and units     |
| [7](#7-object-model)                      | Object model                    |
| [8](#8-geometry)                          | Geometry                        |
| [9](#9-skeleton-and-skinning)             | Skeleton and skinning           |
| [10](#10-sockets-and-attachment)          | Sockets and attachment          |
| [11](#11-materials)                       | Materials                       |
| [12](#12-animation)                       | Animation                       |
| [13](#13-effects)                         | Effects                         |
| [14](#14-collision-and-physics)           | Collision and physics           |
| [15](#15-lods-and-variants)               | LODs and variants               |
| [16](#16-gameplay-metadata)               | Gameplay metadata               |
| [17](#17-provenance-and-lossy-conversion) | Provenance and lossy conversion |
| [18](#18-versioning-and-compatibility)    | Versioning and compatibility    |
| [19](#19-runtime-integration)             | Runtime integration             |
| [20](#20-authoring-tools)                 | Authoring tools                 |
| [21](#21-security-considerations)         | Security considerations         |

---

## 1. Scope and goals

UVM is an interchange format for **game assets**: the visual, animated, physical and
metadata description of a single game object — a tank, a marine, a barracks, a tree, a
projectile, a weapon.

Design goals, in priority order:

1. **Round-trip fidelity.** An asset imported from a source format and exported back should
   be reconstructible. Where that is impossible, the loss must be recorded, not silent.
2. **Zero-cost interoperability.** Existing glTF software must be able to open a UVM file
   and get a correct model without any UVM-specific code.
3. **Fast to load.** The runtime path must be typed-array reads, not JSON parsing of vertex
   data. GPU-ready texture and mesh encodings must be first-class.
4. **Cheap to learn.** A developer who knows glTF should be productive in an hour. Every
   game concept is an extension with a short, self-contained definition.
5. **Extensible without forking.** Games add namespaced extensions; consumers that do not
   understand them still work.

Non-obvious goal: UVM is meant to be the **hub** of a many-to-many conversion graph. With
N source formats and M target formats, direct converters cost N×M; a hub costs N+M. The
value of the hub is entirely determined by how little it loses, which is why
[section 17](#17-provenance-and-lossy-conversion) is normative rather than advisory.

## 2. Non-goals

UVM explicitly does **not** attempt:

- **A universal shader language.** Games render differently. UVM preserves shader
  _parameters_ and provides a PBR approximation; it does not define pixel output.
- **A universal particle simulator.** No two engines produce identical particle motion.
  UVM preserves emitter parameters faithfully and defines a minimal common subset that
  consumers must approximate. Bit-identical playback across engines is not achievable and
  is not promised.
- **A universal gameplay model.** Unit statistics belong to a game's balance data, not to
  its art. UVM carries gameplay metadata as _optional, advisory_ payload
  ([section 16](#16-gameplay-metadata)).
- **Replacing engine-native formats.** UVM is an interchange and tooling format. Shipping
  titles will keep compiling to engine-native runtime formats; UVM is what feeds that
  compiler.

## 3. Conformance

Three conformance classes.

### 3.1 Core conformance (required of every UVM file)

A UVM file **MUST** be a valid glTF 2.0 asset. It **MUST** pass `gltf-validator` with no
errors. All UVM semantics **MUST** live in `extensions` objects.

A UVM file **MUST** be viewable in a stock glTF consumer with correct geometry, skinning,
base animation and an approximate material. Concretely:

- Every material **MUST** carry a usable `pbrMetallicRoughness` block even when a
  `UV_game_material` override is present.
- Every mesh **MUST** be readable without any `UV_*` extension.
- `extensionsRequired` **MUST NOT** list any `UV_*` extension, with one exception: a file
  whose geometry is meaningless without an extension (for example a pure-effects asset with
  no mesh) MAY require `UV_game_effects`, and **MUST** then declare
  `UV_asset.coreRenderable = false`.

This is the rule that makes the format worth adopting. Violating it turns UVM into a
proprietary format wearing a glTF costume.

### 3.2 Reader conformance

A **UVM reader** understands the core glTF asset plus a declared set of `UV_*`
extensions. Readers **MUST** ignore unknown optional extensions. If an unknown extension appears in
`extensionsRequired`, a reader **MUST** refuse a full projection or return an explicitly labelled
partial projection with diagnostics; it **MUST NOT** silently claim full conformance.
A reader **SHOULD** surface `UV_provenance.lost` to the user rather than discarding it.

### 3.3 Writer conformance

A **UVM writer** **MUST**:

- emit core-conformant output per 3.1;
- list every extension it emits in `extensionsUsed`;
- emit `UV_provenance` recording source format, importer identity and version, and every
  feature it could not represent;
- produce **deterministic** output — given identical input and options, byte-identical
  output. Accessor ordering, JSON key ordering and buffer packing must not depend on hash
  iteration order; JSON participating in UV integrity roots follows the
  [UV Foundation canonical profile](../foundation/SPEC_UV_FOUNDATION.md#3-canonical-json-and-integrity).
  This is what makes UVM diffable in version control and cacheable in
  build systems.

## 4. Relationship to glTF 2.0

UVM profiles glTF as follows.

### 4.1 Required base features

`asset.version` **MUST** be `"2.0"`. `asset.extras.uv` **MUST** be present:

```json
{
  "asset": {
    "version": "2.0",
    "generator": "modkitx-uvm/1.0.0 (m3 importer 1.4.2)",
    "extras": { "uv": { "format": "UVM", "version": "1.0", "profile": "full" } }
  }
}
```

`profile` is `"core"`, `"full"` or a game profile name (`"m3"`, `"spring"`, `"w3d"`).
See [section 13.3](#133-effect-profiles).

### 4.2 Khronos extensions UVM adopts rather than reinvents

UVM does not define anything a ratified Khronos or well-established vendor extension
already covers. Writers **SHOULD** prefer these:

| Need                                | Use                                                                    | Rationale                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mesh compression                    | `KHR_draco_mesh_compression`, `EXT_meshopt_compression`                | Ratified Khronos standards                                                              |
| GPU texture formats                 | `KHR_texture_basisu` (KTX2/Basis)                                      | Ratified Khronos standard                                                               |
| Unlit / fixed-function look         | `KHR_materials_unlit`                                                  | Ratified Khronos standard                                                               |
| Emissive strength                   | `KHR_materials_emissive_strength`                                      | Ratified Khronos standard (2024)                                                        |
| Specular, sheen, transmission, etc. | `KHR_materials_specular`, `_sheen`, `_transmission`, `_volume`, `_ior` | Ratified Khronos standards (2024–2025)                                                  |
| Texture UV transform                | `KHR_texture_transform`                                                | Ratified Khronos standard                                                               |
| Punctual lights                     | `KHR_lights_punctual`                                                  | Ratified Khronos standard                                                               |
| Instancing                          | `EXT_mesh_gpu_instancing`                                              | Ratified Khronos standard                                                               |
| Variant switching                   | `KHR_materials_variants`                                               | Ratified Khronos standard; UVM adds game semantics via `UV_game_variants`               |
| Discrete LOD                        | `MSFT_lod`                                                             | Microsoft vendor extension; stable and used in production                               |
| Property animation                  | `KHR_animation_pointer`                                                | Ratified Khronos standard; allows animating any JSON path (used for effects parameters) |
| Rigid bodies / collision shapes     | `KHR_physics_rigid_bodies`, `KHR_collision_shapes`                     | Draft (ratification expected 2026); UVM uses `UV_game_collision` until standardized     |

`UV_game_collision` uses a migration path: when `KHR_collision_shapes` ratifies, a mechanical 1:1 rewrite is possible. Writers SHOULD emit both during a grace period, then migrate to Khronos. See [the extension registry](SPEC_UVM_EXTENSIONS.md) for the
migration notes.

### 4.3 The UVM extension registry

| Extension                     | Attaches to              | Purpose                                                                         |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `UV_asset`                    | document root            | Game-object identity, class, capability flags                                   |
| `UV_units`                    | document root            | Game-unit ↔ metre scale, grid cell size                                         |
| `UV_game_socket`              | node                     | Attachment point semantics                                                      |
| `UV_game_skeleton`            | skin                     | Bone roles for cross-game retargeting                                           |
| `UV_retarget`                 | skin                     | Humanoid / vehicle rig profile mapping                                          |
| `UV_game_material_team_color` | material                 | Team, house and player colour                                                   |
| `UV_game_material`            | material                 | Legacy fixed-function and game-shader parameters                                |
| `UV_texture_alpha` | texture | Explicit stored-alpha policy applied before colour key |
| `UV_node_billboard` | node | Camera-facing node constraint, existing Core forms |
| `UV_scene_lights` | document root | Native scene light rig and per-clip property tracks |
| `UV_scene_camera` | glTF camera | Sparse per-sequence perspective lens tracks, version 1 |
| `UV_texture_color_key`        | texture                  | A stored colour the source game loads as transparent (colour key)               |
| `UV_game_animation_clips`     | root and animation       | Complete selectable clip catalog; clip name, priority, loop, blend, concurrency |
| `UV_game_animation_events`    | animation                | Timestamped gameplay events                                                     |
| `UV_animation_layers`         | document root            | Additive/override layers with bone masks                                        |
| `KHR_animation_pointer`       | animation channel target | Channels targeting extension properties                                         |
| `UV_game_effects`             | document root            | Particles, ribbons, forces, warps, projectors                                   |
| `UV_game_baked_particles`     | document root            | Sprites a scripted effect system drew, per clip and frame                       |
| `UV_game_collision`           | node                     | Collision primitives and meshes                                                 |
| `MSFT_lod`                    | node/material            | Standard glTF LOD topology (`ids`)                                              |
| `MODKITX_lod_selection`       | document root            | Incubating selection/hysteresis beside official topology                        |
| `MODKITX_batching_hints`      | document root            | Incubating advisory renderer batching hints                                     |
| `MODKITX_impostor_relation`   | document root            | Incubating node-to-impostor relation                                            |
| `UV_game_variants`            | document root            | Named non-material variants (damage states, wrecks)                             |
| `UV_game_gameplay`            | document root            | Advisory unit statistics                                                        |
| `UV_game_<id>`                | any                      | Game-specific escape hatch (`UV_game_sc2`, …)                                   |
| `UV_provenance`               | document root            | Source identity, conversion history and explicit loss diagnostics               |

Full property tables: [SPEC_UVM_EXTENSIONS.md](SPEC_UVM_EXTENSIONS.md).

## 5. Container and packaging

UVM defines two encodings of the **same** data model. Conversion between them is lossless
and byte-deterministic after canonicalization rules are implemented.

| Encoding  | Extension              | Layout                                          |
| --------- | ---------------------- | ----------------------------------------------- |
| Binary    | `.uvm.glb`             | GLB — JSON chunk + BIN chunk, single file       |
| Directory | `.uvm.gltf` + siblings | glTF JSON + external `.bin` + external textures |

### 5.1 Trade-offs

**Single binary (`.uvm.glb`, GLB).**
Advantages: one fetch or one `mmap`; no path resolution and therefore no
case-sensitivity or path-separator portability bugs; buffers are already aligned so vertex
data can be uploaded to the GPU without a copy; a single content hash identifies the whole
asset, which makes caching and integrity checking trivial.
Disadvantages: opaque to `git diff` and unmergeable; changing one texture rewrites the whole
file; textures cannot be shared between assets, so a 40-unit faction sharing one 8 MB atlas
pays for it 40 times.
Use for: shipping, runtime, network transfer, CDN.

**Directory package.**
Advantages: the JSON is reviewable and diffable in version control; textures are shared by
reference across assets; a change to one animation rebuilds one file; artists can hand-edit
a material; tools can stream individual buffers.
Disadvantages: N filesystem or HTTP requests per asset; relative-path portability across
operating systems must be enforced; the asset has no single identity hash unless one is
computed over the manifest.
Use for: authoring, source control, build inputs.

### 5.2 Recommendation

**Author as a directory, ship as GLB.** `uvm pack` and `uvm unpack` are required to be
lossless and deterministic in both directions, which means the choice is a build-time
decision rather than a format-level commitment. Do not make users choose at authoring time.

### 5.3 Directory layout

The brief proposed one directory per subsystem (`geometry/`, `materials/`, `skeleton/`, …).
UVM rejects that layout: glTF already indexes meshes, materials and skins inside one JSON
document, and splitting them across files would require a second cross-file reference scheme
that duplicates glTF's own index-based one. The layout below splits by **payload kind**,
which is what actually changes independently:

```
tank.uvm.glb.d/
├── tank.uvm.gltf           # the glTF document — all structure, all extensions
├── buffers/
│   ├── geometry.bin         # vertex and index data
│   ├── animation.bin        # keyframe data (changes independently of geometry)
│   └── effects.bin          # emission meshes, spline control points
├── textures/
│   ├── tank_diffuse.ktx2
│   ├── tank_normal.ktx2
│   └── tank_team.ktx2       # team-colour mask
├── variants/
│   └── tank_wreck.uvm.gltf # separate asset, referenced by UV_game_variants
└── provenance/
    ├── source.json          # UV_provenance, if externalised
```

`provenance/` is separable on purpose: a shipping build strips it, an authoring build keeps
it. Nothing in the render path may depend on it.

## 6. Coordinate system and units

### 6.1 Axes

UVM inherits glTF's coordinate system without modification, and this is not negotiable —
deviating would break every consumer listed in [section 4.2](#42-khronos-extensions-uvm-adopts-rather-than-reinvents).

- Right-handed.
- **+Y up**, nominal asset forward **+Z**, as in the shared
  [coordinate contract](../foundation/SPEC_UV_COORDINATES.md) and
  [glTF §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units).
  A camera looks along local **−Z**; this is not a gameplay entity's authored nose.
  Source-specific model forward axes and sockets remain explicit local metadata.
- Distances in **metres**, angles in **radians**, time in **seconds**.
- Rotations as **quaternions** `[x, y, z, w]`, XYZW order.
- Matrices **column-major**, matching `Float32Array` upload order for WebGL and Three.js.

Source games differ. The importer, not the format, performs the change of basis.
The table below is informative; measured per-source entries in
[`uv-coordinates.v1.json`](../foundation/uv-coordinates.v1.json) are authoritative
where a source's axes or unit evidence differs from this older summary:

| Source                | Basis     | Forward | Units                                | Transform to UVM                                              |
| --------------------- | --------- | ------- | ------------------------------------ | ------------------------------------------------------------- |
| StarCraft II M3       | RH, +Z up | +X      | game units                           | `(x, y, z) → (x, z, -y)`; scale by `metersPerGameUnit`        |
| Warcraft 3 MDX        | RH, +Z up | +X      | game units                           | same as M3                                                    |
| C&C W3D               | RH, +Z up | +X      | inches or units                      | `(x, y, z) → (x, z, -y)`                                      |
| Spring / Recoil S3O   | LH, +Y up | +Z      | elmos (1 elmo = 1/8 of a map square) | negate X to convert handedness; `1 elmo = 0.125 × squareSize` |
| Supreme Commander SCM | RH, +Y up | +Z      | metres                               | identity except forward-axis metadata                         |
| Unreal                | LH, +Z up | +X      | centimetres                          | `(x, y, z) → (x, z, y)` with X negation; `× 0.01`             |
| Unity                 | LH, +Y up | +Z      | metres                               | negate Z                                                      |
| Blender               | RH, +Z up | -Y      | metres                               | `(x, y, z) → (x, z, -y)`                                      |
| 3ds Max               | RH, +Z up | +Y      | generic                              | `(x, y, z) → (x, z, -y)`                                      |

Importers **MUST** record the source basis in `UV_provenance.sourceAxes` so an exporter
back to that format reproduces the original numerically, rather than re-deriving a guess.

### 6.2 Units, and why "metres" is not enough for RTS

Real-time strategy content is authored against a grid, not against physical scale. A
StarCraft II marine is not 1.8 metres tall in any meaningful sense; it is sized relative to
a terrain cell so that formations read correctly at gameplay zoom. Converting to metres and
discarding the grid relationship destroys the only scale that mattered.

`UV_units` therefore records both:

```json
{
  "extensions": {
    "UV_units": {
      "sourceUnit": "sc2-game-unit",
      "metersPerSourceUnit": 1.0,
      "sourceUnitsPerCell": 1.0,
      "footprintCells": [1, 1]
    }
  }
}
```

`metersPerSourceUnit` makes the asset physically placeable; `sourceUnitsPerCell` and
`footprintCells` make it _gameplay_-placeable. An RTS exporter uses the second pair; a
Blender or Unreal exporter uses the first.

## 7. Object model

A UVM asset is a glTF document with one default scene describing a single game object.

```
UVM asset  (glTF document)
│
├── UV_asset          class, id, capability flags
├── UV_units          scale relationship to the game grid
│
├── scenes[0]           the object
│   └── nodes           transform hierarchy
│       ├── mesh nodes          → meshes → primitives → material, accessors
│       ├── joint nodes         → referenced by skins
│       ├── socket nodes        → UV_game_socket
│       └── collision nodes     → UV_game_collision
│
├── skins               bind poses, inverse bind matrices, UV_game_skeleton roles
├── materials           PBR core + UV_material_* overrides
├── animations          glTF samplers/channels + UV_animation_* metadata
│
├── UV_game_effects        particle, ribbon, force, warp, projector emitters
├── UV_game_variants       damage states, wrecks, faction skins
├── MSFT_lod            standard node/material LOD topology
├── MODKITX_lod_selection     provisional selection/hysteresis
├── MODKITX_batching_hints    provisional advisory tuning
├── MODKITX_impostor_relation provisional proxy relation
├── UV_game_gameplay       advisory statistics
└── UV_provenance     source identity and loss record
```

### 7.1 `UV_asset`

```json
{
  "extensions": {
    "UV_asset": {
      "id": "terran/siege_tank",
      "class": "unit",
      "categories": ["vehicle", "ground", "mechanical"],
      "displayName": "Siege Tank",
      "coreRenderable": true,
      "capabilities": {
        "skinned": true,
        "animated": true,
        "effects": true,
        "collision": true,
        "lods": 3,
        "variants": ["default", "sieged", "wreck"]
      }
    }
  }
}
```

`class` is an open enumeration; the registered values are `unit`, `building`, `character`,
`vehicle`, `creature`, `weapon`, `projectile`, `prop`, `feature`, `effect`, `terrain-object`,
`ui`. Consumers **MUST** treat an unrecognised `class` as `prop`.

`capabilities` is redundant with the document body by design: it lets a browser or asset
database show what an asset contains after reading only the JSON chunk header, without
parsing buffers. Writers **MUST** keep it accurate; readers **MUST NOT** trust it for
correctness, only for display and filtering.

### 7.2 Coverage of the required object kinds

| Object kind            | Encoding                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Static model           | meshes, no skin, no animations                                                           |
| Animated (rigid) model | meshes + node TRS animation, no skin                                                     |
| Skeletal model         | meshes + skin + animations                                                               |
| Vehicle                | skin with `UV_game_skeleton` roles `turret_yaw`, `barrel_pitch`, `wheel_*`, `track_*`    |
| Building               | mesh + `UV_game_variants` construction and damage states + `UV_game_collision` footprint |
| Creature / character   | skin + `UV_retarget` humanoid profile                                                    |
| Weapon                 | mesh + sockets `grip`, `muzzle`; usually a separate asset attached at runtime            |
| RTS unit               | all of the above plus `UV_game_gameplay` and team-colour material                        |

## 8. Geometry

Geometry is plain glTF. Nothing is redefined.

| Concept            | glTF encoding                                            |
| ------------------ | -------------------------------------------------------- |
| Vertices           | `POSITION` accessor, `VEC3`/`FLOAT`                      |
| Indices            | `indices` accessor, `UNSIGNED_SHORT` or `UNSIGNED_INT`   |
| Normals            | `NORMAL`, `VEC3`/`FLOAT`                                 |
| Tangents           | `TANGENT`, `VEC4`/`FLOAT`; `w` is bitangent handedness   |
| UV channels        | `TEXCOORD_0` … `TEXCOORD_n`                              |
| Vertex colours     | `COLOR_0`, `VEC3` or `VEC4`                              |
| Skin weights       | `JOINTS_0`/`WEIGHTS_0`, plus `_1` for up to 8 influences |
| Multiple materials | one `primitive` per material within a mesh               |
| Morph targets      | `targets` array + `weights`                              |
| Topology           | `mode`: 4 triangles, 1 lines, 3 line strip, 0 points     |

### 8.1 Recommended encodings

Writers **SHOULD**:

- interleave `POSITION`/`NORMAL`/`TANGENT`/`TEXCOORD_0` into one `bufferView` with a
  4-byte-aligned stride — this halves vertex-fetch cache misses on the GPU and is required
  for efficient WebGPU vertex buffer layouts;
- quantise where lossless-enough: `NORMAL` and `TANGENT` as normalised `BYTE`/`SHORT`,
  `TEXCOORD` as normalised `UNSIGNED_SHORT` when UVs are in `[0,1]`;
- prefer `EXT_meshopt_compression` over Draco for assets that load interactively — meshopt
  decodes roughly an order of magnitude faster; prefer Draco when download size dominates;
- emit `UNSIGNED_SHORT` indices whenever the primitive has fewer than 65 536 vertices,
  splitting primitives if necessary — WebGL 1 and some mobile GPUs pay a real cost for
  32-bit indices.

### 8.2 Example

```json
{
  "meshes": [
    {
      "name": "hull",
      "primitives": [
        {
          "attributes": {
            "POSITION": 0,
            "NORMAL": 1,
            "TANGENT": 2,
            "TEXCOORD_0": 3,
            "JOINTS_0": 4,
            "WEIGHTS_0": 5
          },
          "indices": 6,
          "material": 0,
          "mode": 4
        }
      ]
    }
  ],
  "accessors": [
    {
      "bufferView": 0,
      "byteOffset": 0,
      "componentType": 5126,
      "count": 2048,
      "type": "VEC3",
      "min": [-1.4, 0.0, -2.6],
      "max": [1.4, 1.9, 2.6]
    },
    {
      "bufferView": 0,
      "byteOffset": 12,
      "componentType": 5122,
      "count": 2048,
      "type": "VEC3",
      "normalized": true
    },
    {
      "bufferView": 0,
      "byteOffset": 18,
      "componentType": 5122,
      "count": 2048,
      "type": "VEC4",
      "normalized": true
    },
    {
      "bufferView": 0,
      "byteOffset": 26,
      "componentType": 5123,
      "count": 2048,
      "type": "VEC2",
      "normalized": true
    },
    { "bufferView": 1, "componentType": 5121, "count": 2048, "type": "VEC4" },
    {
      "bufferView": 2,
      "componentType": 5121,
      "count": 2048,
      "type": "VEC4",
      "normalized": true
    },
    { "bufferView": 3, "componentType": 5123, "count": 5412, "type": "SCALAR" }
  ],
  "bufferViews": [
    {
      "buffer": 0,
      "byteOffset": 0,
      "byteLength": 69632,
      "byteStride": 34,
      "target": 34962
    },
    {
      "buffer": 0,
      "byteOffset": 69632,
      "byteLength": 8192,
      "byteStride": 4,
      "target": 34962
    },
    {
      "buffer": 0,
      "byteOffset": 77824,
      "byteLength": 8192,
      "byteStride": 4,
      "target": 34962
    },
    { "buffer": 0, "byteOffset": 86016, "byteLength": 10824, "target": 34963 }
  ]
}
```

`min`/`max` on `POSITION` are mandatory in glTF and give every consumer a free bounding box,
which is why UVM does not define a bounds extension.

## 9. Skeleton and skinning

### 9.1 Base encoding

Bones are glTF **nodes**; a skeleton is a `skin` listing those nodes as `joints` with an
`inverseBindMatrices` accessor. There is no separate bone array. This is deliberate: making
bones nodes means bone transforms, animation, socket parenting and hierarchy all reuse one
mechanism, and every glTF tool already understands it.

```json
{
  "nodes": [
    { "name": "Root", "children": [1] },
    { "name": "Turret", "children": [2], "rotation": [0, 0, 0, 1] },
    { "name": "Barrel", "translation": [0, 0.4, 1.2] }
  ],
  "skins": [
    {
      "name": "tank_rig",
      "skeleton": 0,
      "joints": [0, 1, 2],
      "inverseBindMatrices": 7,
      "extensions": {
        "UV_game_skeleton": {
          "roles": { "0": "root", "1": "turret_yaw", "2": "barrel_pitch" },
          "axes": {
            "1": { "rotate": "y" },
            "2": { "rotate": "x", "limits": [-0.17, 0.35] }
          }
        }
      }
    }
  ]
}
```

### 9.2 Bone roles — the part that makes conversion possible

Hierarchies from different games are structurally similar and nominally incompatible:

| Game            | Hierarchy                | Bone naming                                 |
| --------------- | ------------------------ | ------------------------------------------- |
| StarCraft II M3 | `Root → Marine → Weapon` | `Bone_*`, `Ref_*` for attachments           |
| C&C W3D         | `Tank → Turret → Barrel` | `TURRET`, `BARREL`, `MUZZLE*`, `FIREPOINT*` |
| Spring / Recoil | `Unit → Turret → Weapon` | piece names referenced by Lua/BOS scripts   |
| Warcraft 3 MDX  | flat-ish, `Bone_*`       | attachment objects named `Hand Left Ref`    |

Nothing in a raw bone hierarchy tells a converter that W3D's `TURRET` and M3's yaw bone are
the same concept. Name matching fails as soon as an artist renames a bone or works in
another language.

`UV_game_skeleton.roles` solves this by tagging joints with semantic roles from a registry:

`root`, `pelvis`, `spine`, `chest`, `neck`, `head`, `shoulder_{l,r}`, `upperarm_{l,r}`,
`forearm_{l,r}`, `hand_{l,r}`, `thigh_{l,r}`, `calf_{l,r}`, `foot_{l,r}`,
`turret_yaw`, `turret_pitch`, `barrel_pitch`, `recoil`, `wheel_{n}`, `track_{l,r}`,
`rotor`, `thruster_{n}`, `door_{n}`, `aim`, `look`, `hardpoint_{n}`.

`axes` records which local axis a mechanical joint rotates about, plus optional limits in
radians. A converter targeting Spring can then find the yaw joint deterministically and
write the corresponding `turret` piece, without name heuristics.

Roles are **advisory annotations, not structure**. A file with no roles is still valid; it
just converts worse.

### 9.3 Bind pose

`inverseBindMatrices` is the normative bind pose. Where a source format stores a bind pose
that is not the inverse of the rest transform — Westwood W3D is the notorious case, and the
repository already carries a dedicated
`packages/models-processing/src/core/westwood-bind-pose.ts` in the sealed legacy oracle
for it — the importer **MUST** bake the correction into `inverseBindMatrices` and record the
original in `UV_provenance` so the export path can undo it.

### 9.4 Retargeting

`UV_retarget` maps a rig onto a named profile so animation can move between skeletons:

```json
{
  "extensions": {
    "UV_retarget": {
      "profile": "humanoid-1",
      "bones": {
        "hips": 3,
        "spine": 4,
        "head": 9,
        "leftHand": 14,
        "rightHand": 19
      },
      "restPose": "t-pose",
      "scaleReference": { "boneA": 3, "boneB": 9, "meters": 0.72 }
    }
  }
}
```

`scaleReference` gives a measurable distance between two named bones so a retarget can
normalise proportions rather than guessing from bounding boxes.

## 10. Sockets and attachment

### 10.1 A socket is a node

The brief proposed sockets as records with a bone name and a position. UVM instead makes a
socket **a glTF node with a `UV_game_socket` extension**:

For cross-artifact references such as UVW compound components, that extension
may carry a unique, stable lowercase `id`. It is a semantic identity of the
socket, independent of the glTF node index and source display name. Unaddressed
sockets may omit it; Core's earlier `extras.modkit.id` remains a read-compatible
location until its writer emits the standard field.

```json
{
  "nodes": [
    { "name": "Barrel", "children": [4] },
    {
      "name": "muzzle_main",
      "translation": [0, 0, 2.4],
      "rotation": [0, 0, 0, 1],
      "extensions": {
        "UV_game_socket": {
          "role": "muzzle",
          "tags": ["primary", "cannon"],
          "forward": "-z",
          "index": 0
        }
      }
    }
  ]
}
```

Reasons a node beats a record:

- The full transform — translation, rotation _and_ scale — comes for free, correctly
  composed through the parent chain. A `{bone, position}` record cannot express orientation,
  which is exactly what a muzzle needs.
- Sockets animate. A node can be a channel target, so a recoiling muzzle or a moving
  passenger seat is expressible without new machinery.
- Every glTF tool displays and transforms them. Blender imports them as empties; Three.js
  gives you an `Object3D` you can `.attach()` to.
- No parallel resolution scheme. There is no "find the bone named X" step that can fail.

### 10.2 Socket roles

| Role             | Meaning                                 | Convention                             |
| ---------------- | --------------------------------------- | -------------------------------------- |
| `muzzle`         | Projectile origin                       | `forward` axis is the firing direction |
| `attach`         | Generic child-asset mount               | child's origin aligns to socket origin |
| `hardpoint`      | Swappable weapon/equipment mount        | carries `capacity` and `accepts` tags  |
| `effect`         | Particle/decal spawn point              | may carry `effectHint`                 |
| `passenger`      | Rider or garrison slot                  | `index` orders the slots               |
| `wreck-pivot`    | Where the wreck variant aligns          | used by `UV_game_variants`             |
| `ui-anchor`      | Health bar, selection ring, status icon | usually top-centre                     |
| `ground-contact` | IK foot or wheel contact                | paired with `UV_game_skeleton` role    |
| `hitpoint`       | Damage impact reference                 | `tags` may name a body region          |

`forward` names which local axis points "out" of the socket (`+x`, `-x`, `+y`, `-y`, `+z`,
`-z`), defaulting to `-z` as the socket profile's local convention, independently of
the asset's nominal forward direction. This matters because source
formats disagree: W3D muzzles point down +X, M3 `Ref_` bones vary per asset.

## 11. Materials

Reference tooling shares the bounded standard-material shape in
[`gltf.material.profile.schema.json`](schema/gltf.material.profile.schema.json)
with the UVW material migration. `../tools/gltf-materials.mjs` checks known
material texture/image/sampler joins and extension declarations; the UVM/core
reader calls that same helper. Neither check replaces full glTF validation or
proves support for optional shader extensions. UVW migration policy and retained
native fields are described in the
[migration plan](../../design/PLAN_UVW_GLTF_MIGRATION_2026-09-28.md#m1a-выполненный-api-и-границы).

### 11.1 Layered model

Every UVM material has up to three layers of description, evaluated by a consumer in
decreasing order of capability:

1. **glTF PBR core** — mandatory, always present, always usable.
2. **`UV_game_material_team_color`** — the one game concept universal enough to standardise.
3. **`UV_game_material`** — full source-shader parameters, for consumers that can
   reproduce them.

A consumer that understands only layer 1 renders a plausible model. A consumer that
understands layers 1–2 renders a correct RTS unit in team colours. A consumer that
understands all three reproduces the original look.

### 11.2 Team colour

Team, house and player colour is the single most common game-specific material feature and
every RTS solves it differently:

| Game               | Mechanism                                                                     |
| ------------------ | ----------------------------------------------------------------------------- |
| StarCraft II       | Team-colour texture layer multiplied into diffuse; a per-material colour slot |
| Warcraft 3         | Replaceable texture IDs 1 (team colour) and 2 (team glow)                     |
| C&C (SAGE, W3D)    | House colour applied to a masked channel                                      |
| Spring / Recoil    | Dedicated team texture (`tex2`) with the team colour in a channel             |
| Total Annihilation | Palette index ranges remapped per player                                      |

`UV_game_material_team_color` unifies these into "where is the mask, and how is the colour
combined":

```json
{
  "extensions": {
    "UV_game_material_team_color": {
      "maskSource": "texture",
      "maskTexture": { "index": 2, "texCoord": 0, "channel": "a" },
      "targets": ["baseColor"],
      "blend": "multiply",
      "defaultColor": [0.18, 0.42, 0.92, 1.0],
      "glow": { "maskTexture": { "index": 3, "channel": "r" }, "blend": "add" }
    }
  }
}
```

`maskSource` is `texture`, `vertexColor`, `paletteRange`, `channelKey` or `whole` (the entire material is
tinted). `paletteRange` covers indexed-colour formats:
`{"maskSource":"paletteRange","range":[176,191]}`.

`blend` is `multiply`, `add`, `replace`, `overlay` or `lerp`.

Channel-key replacement, exact N-shade indexed ramps, object tint, RGB-mask tint,
independently transformed secondary coverage and animated strength are normative in
[the extension registry](SPEC_UVM_EXTENSIONS.md#uv_game_material_team_color).
A range-only palette declaration cannot reconstruct indices/shades. Blue-key B
intensity is applied once with explicit replace; no colour-key inference is allowed.

Any consumer can implement this. The result is that a Warcraft 3 model imported to UVM and
exported to Spring keeps its team colour, which no pairwise converter does today.

### 11.3 `UV_game_material`

The escape hatch for everything PBR cannot express: fixed-function blend modes, layer
stacks, animated UV scroll, alpha test thresholds, two-sided and depth overrides, specular
exponents, fresnel terms, per-layer operations. This is the serialisation of the repository's
`StandardMaterialModel` and `CompositeMaterialModel`.

```json
{
  "extensions": {
    "UV_game_material": {
      "shader": "sc2.standard",
      "blendMode": "alpha-test",
      "alphaCutoff": 0.5,
      "cull": "back",
      "depthWrite": true,
      "layers": [
        { "slot": "diffuse", "texture": 0, "uv": 0, "op": "modulate" },
        { "slot": "normal", "texture": 1, "uv": 0 },
        { "slot": "specular", "texture": 4, "uv": 0, "exponent": 24.0 },
        {
          "slot": "emissive",
          "texture": 5,
          "uv": 1,
          "op": "add",
          "scroll": [0.0, 0.35]
        }
      ],
      "params": { "fresnelPower": 2.2, "fresnelColor": [0.2, 0.6, 1.0] }
    }
  }
}
```

`shader` namespaces the parameter vocabulary. A consumer that does not know `sc2.standard`
ignores its shader-specific parameters and uses the PBR core — which is why the PBR core is
mandatory. A UV-aware consumer still honors common material flags independently of the shader.

`castShadows` and `receiveShadows` are optional booleans on `UV_game_material`.
Both default to true by interpretation; writers do not inject omitted defaults
into canonical bytes. `castShadows: false` excludes this material from shadow
casting; `receiveShadows: false` gates reception, including shader-specific water
settings. A shader can further disable reception but cannot override the common
false flag. These are presentation policies, not collision, visibility or gameplay
state. Core materialization/read/render owns their consumption (relay §11).

`blendMode: "add-alpha"` computes straight SrcRGB * SrcAlpha + DstRGB and
preserves destination alpha. It applies to the material or individual pass; see the
[exact blend factors](SPEC_UVM_EXTENSIONS.md#add-alpha-blend-state).

### 11.4 Composite passes

Multi-pass materials (M3 `MATM` type 3, C&C multi-pass shaders) are expressed as an ordered
`passes` array in `UV_game_material`, each pass referencing a full layer stack and blend
state. Consumers that render single-pass **MUST** use pass 0 and record the omission.

### 11.5 Texture payloads

PNG and JPEG payloads use ordinary glTF images and texture `source` indices. KTX2 payloads
**MUST** use `mimeType: "image/ktx2"` and `KHR_texture_basisu`; a texture without a core fallback
**MUST** list `KHR_texture_basisu` in both `extensionsUsed` and `extensionsRequired`. Writers
**MUST NOT** decode and re-encode an already valid KTX2 companion merely to package it as UVM.
A source texture container for which no safe glTF projection or installed transcoder is available
is recorded as an explicit loss. Native texture containers are never retained as opaque UVM data
and are never replaced with a guessed image.

### 11.6 Colour keys

An optional `UV_texture_alpha: { "ignoreStoredAlpha": true }` on the texture
sets source alpha to one **before** the colour key. It never edits shared image bytes
and is not inferred from file format; see [the registry](SPEC_UVM_EXTENSIONS.md#uv_texture_alpha).

Games of the fixed-function era mark transparency in textures that have no alpha channel with a
reserved colour, most often magenta: Direct3D and DirectDraw loaders replaced every texel of that
colour with transparent black before the texture reached the GPU. The colour is a property of how
the game loads the image, not of the image file, so a writer states it on the glTF texture with
`UV_texture_color_key` and keeps the image bytes unchanged:

```json
{ "source": 3, "extensions": { "UV_texture_color_key": { "color": [255, 0, 255] } } }
```

`color` names the texel's stored 8-bit RGB, compared before any colour-space conversion, filtering
or mipmap generation; this is the one colour in the registry that is not a linear float. A consumer
that implements the extension replaces every texel whose three channels are each within `tolerance`
(default `0`, an exact match) of `color` with `(0, 0, 0, 0)` before sampling, whatever that texel's
stored alpha. Transparent black rather than the key colour with alpha zero keeps filtered edges and
additive blending free of the key colour. A consumer that ignores the extension draws the key colour
where the game drew nothing (the base-rendering fallback §3.1 allows), so writers **MUST NOT** list it
in `extensionsRequired`.

## 12. Animation

### 12.1 Base encoding

glTF animations: `samplers` hold input (time) and output (value) accessors with
`LINEAR`, `STEP` or `CUBICSPLINE` interpolation; `channels` bind a sampler to a node's
`translation`, `rotation`, `scale` or morph `weights`.

Neutral Hermite and Bezier TRS tracks both use glTF `CUBICSPLINE` data. The writer stores the
source discriminator as `channel.extras.uv.sourceLineType`, and the reader reconstructs the
original Hermite coefficient or Bezier control point from the adjacent key interval. This keeps
the ordinary glTF channel valid while making native re-export lossless for those curves.

Independent TRS clocks are channel metadata, not alternate sampler formats. A global source track
sets a safe non-negative `channel.extras.uv.globalSeqId`. An M3 concurrent STC sets
`channel.extras.uv.concurrent: true` together with a finite positive `wrapSeconds`. Global and
concurrent are mutually exclusive. `animation.extras.uv.sourceDurationSeconds` retains the parent
clip duration when an independent channel has a longer key range, so UVM readers do not stretch the
clip while generic glTF consumers can still sample the ordinary channel.

Time is in **seconds**. Source formats using frames or milliseconds convert on import, and
the original frame rate goes into `UV_game_animation_clips.sourceFrameRate` so an export can
restore integer frame numbers.

### 12.2 `UV_game_animation_clips`

glTF has an animation name and nothing else. Games need considerably more:

```json
{
  "animations": [
    {
      "name": "Attack",
      "channels": [
        { "sampler": 0, "target": { "node": 0, "path": "translation" } }
      ],
      "samplers": [{ "input": 0, "output": 1, "interpolation": "LINEAR" }],
      "extensions": {
        "UV_game_animation_clips": {
          "clip": "attack",
          "variant": "01",
          "loop": "once",
          "priority": 20,
          "concurrent": false,
          "blendInSeconds": 0.15,
          "blendOutSeconds": 0.25,
          "sourceFrameRate": 30,
          "sourceRange": [0, 47]
        }
      }
    }
  ]
}
```

`priority` and `concurrent` exist because StarCraft II sequences are selected by priority and
several can play simultaneously on different bone sets; this is already modelled by
`RenderAnimation.priority` and `RenderAnimation.concurrent` in the Modkit IR. Discarding
those fields turns a working SC2 animation set into an arbitrary list of clips.

The document ROOT MAY also carry `UV_game_animation_clips.clips`, a complete catalog of
selectable clips. This is distinct from the animation-attached metadata above. Each record has
`id` (unique nonempty string), `name`, `durationSeconds` (finite, nonnegative), and
`sourceSequenceIndex` (unique nonnegative integer). Optional fields are `animation` (glTF
animation index), `sourceId` (original facet identity), `looping`, `kind` (`animation` or
`rest-pose`), and `frames` (nonnegative integer).

An absent `animation` is meaningful: a material-only or truly empty sequence remains selectable.
Producers MUST NOT invent a bone, dummy channel, or empty glTF animation to represent it. A linked
animation MUST have nonempty channels and samplers. Every selectable glTF animation MUST be linked
exactly once; explicitly absolute/global effect timelines are not selectable clips and may be
unlinked. If both catalog and animation extras supply a sequence index, they MUST agree.
Without a root catalog, legacy `animation-N` selection continues unchanged. A producer can retain
those ids for linked clips while using `sequence-N` for channel-less clips; `sourceId` preserves the
original identity. Material playback uses the catalog sequence index, never the catalog ordinal or
the suffix of a clip id.

An animation bundle MAY contain inactive `materialTargets` beside `clips`. A target is
`{id, properties:[{path,value,sequenceTracks}]}`. `path` addresses an existing published animated
property of `UV_game_material.params.renderModel`, such as
`/renderModel/standard/layers/diffuse/constantColor`. `value` is its finite scalar/vector default
and determines its width. `sequenceTracks` retains the common material track representation and
references catalog sequence indices. The allowed paths are standard or composite-pass layer
animation properties (`constantColor`, `colorMultiply`, `colorAdd`, `alphaFactor`, `uvOffset`,
`uvAngle`, `uvTiling`, `uvTriplanarOffset`, `uvTriplanarScale`, `flipbook/frame`), plus
`parallaxHeight`, `normalBlendFactors/0..7`, composite-pass `alphaFactor`, and the emissive
gain paths specified below.
These slots are binding descriptions, not active glTF materials: they carry no texture/image
indices, resolve no resources, and do not create geometry. Native static metadata that common
glTF/UVM structures cannot represent remains in bounded publisher extras. A UVM document never
retains the native source blob. Current shared material playback supports step/linear
tracks with explicit sequence clocks; unsupported interpolation MUST be refused or reported.

The published emissive-gain paths are exactly `/renderModel/standard/emisMult` and
`/renderModel/composite/passes/N/material/emisMult`, where `N` is the existing zero-based,
canonical decimal pass index (`0` or a nonzero digit followed by digits). Their width is one.
This is the existing common material's **post-texture-decoding emission multiplier**;
layer `colorMultiply`, whole-object tint or alpha multiplication is not an equivalent carrier.
It introduces no native-specific parameter, shader or new sampler.

Static `emisMult` remains a number. An active animated source uses the existing
`{value, sequenceTracks}` scalar convention; the inactive material-target property above uses
a **numeric** `value`, not `[value]`. Every key retains an **array** `vector` of exactly one
number. Defaults and components MUST be finite and remain finite when rounded to IEEE 754
binary32 (for example `Number.isFinite(value) && Number.isFinite(Math.fround(value))`).
Negative, zero and HDR gains above one are permitted. Do not impose a nonnegative bound,
clamp, normalize or quantize authored values. The JSON Schema narrows the new defaults/key
widths only; the semantic reader must enforce the published paths and finite binary32 domain.

Sampling MUST produce a **number** in that same domain before CPU composition, cache publication
or numeric uniform upload. Gain animation is sampled even when no layer is animated and makes
the material time-dependent; a sampled gain must not be cached as its authored default.
The current common post-decode math and alpha handling are unchanged.
An animated initial zero does not make a referenced emissive texture unused; retain its
existing resource closure rather than pruning it from the captured material.

STEP/LINEAR use the explicit catalog sequence index. Ordinary keys use sequence-local time;
selected `concurrent: true` tracks use their positive `wrapSeconds` and elapsed material time
independently of clip-local looping. Sparse/missing or unselected sequences retain the captured
common numeric default; no sequence zero or first key is selected implicitly. The existing
active legacy `track` precedence is unchanged, and legacy-fallback attachment refusal remains.
These rules do not qualify native global tracks without selection, cubic interpolation,
outside-key/default behavior or native HDR/GPU equivalence. A native publisher must preserve
its separately authored static fallback in `value` after qualifying its semantics; it must
not infer that fallback from the first key, hardcode one, or treat a lossy native projection
as an oracle. Unsupported exact native export/playback requires refusal or explicit losses.

Bundle attachment requires explicit source/destination clip ids and sequence indices, node and
primitive mappings, and material mappings. An inactive slot is selected with
`sourceKind: "animation-target"`; ordinary active material indices use `sourceKind: "material"`
(the default). Selected tracks append to the matched properties of actual destination materials;
existing values and sequences remain unchanged. A conflicting target, missing property, unknown
path, or ambiguous timeline MUST refuse the whole operation. A legacy global material fallback
cannot silently become a per-sequence fallback. Required source accessors and animation data are
copied into the destination container. An inert `attachments` receipt records the explicit mapping,
appended clips and playback limitations without retaining the source container. Copied
bufferViews/accessors retain exact bytes with rebased indices; source metadata is never interpreted
as a scene command. Prepared
document replacement is validated and committed against its captured revision as one undo step.

Storage preservation does not by itself imply playback of every glTF channel: implementations
MUST distinguish their support for morph weights, CUBICSPLINE and arbitrary animation pointers.
Primitive visibility uses the explicit shared target below and needs no publisher-specific logic.

### 12.3 `UV_game_animation_events`

```json
{
  "extensions": {
    "UV_game_animation_events": {
      "events": [
        {
          "t": 0.5,
          "name": "fire_weapon",
          "socket": 4,
          "payload": { "weapon": "cannon" }
        },
        {
          "t": 0.667,
          "name": "spawn_effect",
          "payload": { "effect": "muzzle_flash", "effectIndex": 2 }
        },
        { "t": 0.9, "name": "sound", "payload": { "cue": "tank_fire" } },
        { "t": 1.2, "name": "footstep", "socket": 7 }
      ]
    }
  }
}
```

Registered event names: `fire_weapon`, `spawn_effect`, `sound`, `footstep`, `hit`,
`damage_window_start`, `damage_window_end`, `spawn_object`, `detach_object`, `swap_variant`,
`enable_collision`, `disable_collision`, `script`. Unregistered names are allowed and
**MUST** be preserved.

Events are declared at times in seconds, not frames, to stay consistent with samplers. The
original frame index is recoverable from `sourceFrameRate`.

### 12.4 `UV_animation_layers`

```json
{
  "extensions": {
    "UV_animation_layers": {
      "layers": [
        { "name": "base", "mode": "override", "weight": 1.0 },
        {
          "name": "aim",
          "mode": "additive",
          "weight": 1.0,
          "boneMask": [1, 2, 5, 6]
        },
        {
          "name": "flinch",
          "mode": "additive",
          "weight": 0.0,
          "boneMask": [3, 4]
        }
      ],
      "assignments": { "0": 0, "1": 0, "2": 1, "3": 2 }
    }
  }
}
```

`assignments` maps animation index → layer index. `boneMask` lists joint node indices the
layer may affect.

### 12.5 `KHR_animation_pointer` — the one data-model extension

glTF animation channels can target only node TRS and morph weights. Games animate much more:
particle emission rate over a sequence, material UV scroll, emissive intensity, projector
alpha. StarCraft II's `STC`/`STS` sequence-indexed tracks are exactly this, and
`RenderParticleEmitterSequenceAnimation` in the Modkit IR exists because of it.

`KHR_animation_pointer` extends channel targets to arbitrary JSON pointers into the
document:

```json
{
  "animations": [
    {
      "samplers": [{ "input": 20, "output": 21, "interpolation": "LINEAR" }],
      "channels": [
        {
          "sampler": 0,
          "target": {
            "path": "pointer",
            "extensions": {
              "KHR_animation_pointer": {
                "pointer": "/extensions/UV_game_effects/particles/0/emissionRate"
              }
            }
          }
        }
      ]
    }
  ]
}
```

This is the ratified Khronos wire shape: the ordinary animation channel target uses
`path: "pointer"`, and its `KHR_animation_pointer.pointer` contains the RFC 6901 path. Samplers
are ordinary glTF samplers in the same animation, so the keyframe data lives in buffers and
stays compact. This is the only place UVM extends glTF's data model rather than annotating it,
and it is unavoidable: without it, every sequence-driven effect parameter in every SC2 asset
is lost.

Effect pointer samplers preserve all four neutral interpolation modes. Source line types 0 and 1
map directly to glTF `STEP` and `LINEAR`. Source Hermite and Bezier tracks both use glTF
`CUBICSPLINE`; `channel.extras.uv.sourceLineType` records 2 (Hermite) or 3 (Bezier) so the source
form is recoverable. Hermite coefficients are divided by the adjacent key interval to obtain the
derivatives glTF stores. Bezier control points are converted to derivatives with
`3 * (control - value) / interval`; readers apply the exact inverse.

Sequence-local tracks live in the animation for their source sequence and carry
`animation.extras.uv.sourceSequenceIndex`. Tracks whose source timeline is independent of a clip
live in separate animations. Their `animation.extras.uv.effectTrackScope` is `absolute` or
`global`; global tracks also require a safe non-negative `globalSeqId`. These metadata fields are
lossless source coordinates, not a second animation evaluator. Invalid scope/interpolation pairs
fail validation rather than being silently treated as linear sequence tracks.

M3 concurrent STC effect tracks stay in their source-sequence animation, but retain the independent
clock on the pointer channel itself: `channel.extras.uv.concurrent` is `true` and
`channel.extras.uv.wrapSeconds` is its finite positive wrap duration. The pair is atomic: neither
field is valid without the other, and concurrent metadata is invalid on an `absolute` or `global`
timeline. A consumer that does not implement the policy still sees a valid ordinary glTF sampler;
a UVM-aware consumer wraps the sequence time by `wrapSeconds` before sampling that channel.

Consumers that do not implement it fall back to the static authored value at the property's
location, which is why writers **MUST** keep those static values populated with the
sequence-neutral default.

## 13. Effects

`UV_game_effects` is a document-root extension containing five arrays: `particles`, `ribbons`,
`forces`, `warps`, `projectors`. Each emitter references a node (for its transform) and a
material.

```json
{
  "extensions": {
    "UV_game_effects": {
      "profile": "m3",
      "particles": [
        {
          "name": "muzzle_smoke",
          "node": 6,
          "material": 3,
          "emitShape": "sphere",
          "emitShapeRadius": 0.12,
          "emissionRate": 40.0,
          "emitCount": 0,
          "lifeSpan": 1.4,
          "lifeSpanRandom": 0.3,
          "speed": 3.2,
          "speedRandom": 0.8,
          "gravity": -1.1,
          "mass": 0.4,
          "drag": 0.6,
          "orientationMode": "billboard",
          "lifecycleSize": {
            "start": [0.2, 0.2, 0.2],
            "middle": [0.9, 0.9, 0.9],
            "end": [1.6, 1.6, 1.6],
            "timeMiddle": 0.35
          },
          "segmentColors": [
            [1, 0.9, 0.7],
            [0.5, 0.5, 0.5],
            [0.2, 0.2, 0.2]
          ],
          "segmentAlphas": [0.9, 0.6, 0.0],
          "collideTerrain": true,
          "bounce": 0.2,
          "friction": 0.4,
          "maxParticles": 256
        }
      ],
      "ribbons": [],
      "forces": [],
      "warps": [],
      "projectors": []
    }
  }
}
```

### 13.1 Why this is a large extension

Particle systems are where interchange formats usually give up, and the resulting loss is
severe: for StarCraft II assets, the effects are a substantial fraction of what the asset
_is_. The Modkit `RenderModelEffects` contract already carries roughly 120 emitter
properties covering emission shapes (point, sphere, box, cylinder, disc, spline, mesh),
lifetime curves, per-particle randomisation, force channels, collision response with child
emitters, noise fields, and screen-space UV projection — because reproducing SC2 effects
required all of it.

UVM serialises that contract rather than a reduced version of it. Preserving a parameter a
consumer ignores costs a few bytes; discarding it costs the asset.

### 13.2 The common subset

Consumers are not expected to implement everything. `UV_game_effects` defines a **common
subset** that every effects-capable consumer **MUST** support:

`node`, `material`, `emitShape` (`point`/`sphere`/`box`/`disc` only), `emissionRate`,
`lifeSpan`, `speed`, `gravity`, `lifecycleSize`, `segmentColors`, `segmentAlphas`,
`maxParticles`, `orientationMode` (`billboard` only).

An emitter restricted to the common subset **SHOULD** set `"profile": "common"` so a
consumer can skip capability checks.

### 13.3 Effect profiles

| Profile  | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| `common` | Only common-subset properties present; portable everywhere          |
| `m3`     | Full StarCraft II emitter fidelity                                  |
| `mdx`    | Warcraft 3 emitter semantics, including model-space pivot behaviour |
| `w3d`    | C&C emitter semantics                                               |

The profile changes _interpretation_, not just presence. MDX emitters simulate in model
space by default while M3 emitters are bone-anchored; the same numeric parameters produce
different motion. `modelSpace` and `boneAnchored` are separate booleans for exactly this
reason.

### 13.4 Baked particles

Some effect systems are programs rather than parameter sets: a PopcornFX effect (Warcraft III
Reforged) runs compiled scripts over particle streams, with spawners, events and samplers, and no
fixed set of emitter properties describes it. A writer that can run such a system records what it
drew instead: `UV_game_baked_particles` is a document-root extension holding, for each clip, the
sprites of each frame the source system produced, sampled at a fixed rate. It is presentation
data, not a simulation: a consumer draws the frame for the clock and never steps anything.

```json
{
  "extensions": {
    "UV_game_baked_particles": {
      "spaceNode": 2,
      "frameRate": 15,
      "batches": [
        { "name": "fire", "material": 4, "orientation": "camera", "atlas": [4, 4] }
      ],
      "tracks": [
        { "sequence": 0, "batch": 0, "loop": true, "frames": 11, "sprites": 12 }
      ]
    }
  }
}
```

- `spaceNode` names the node whose world transform maps sprite positions and vectors; a writer
  that materialises a source frame (`UV_units`, up axis) names its innermost frame node, so
  sprites stay in source units and axes. Without it sprites are in scene space.
- A **batch** is one draw: a glTF `material` (texture, blend, alpha mode), an `orientation`
  and the texture's `atlas` grid `[columns, rows]` (default `[1, 1]`), cells counted row by row
  from the image's top left.
- A **track** holds one batch's sprites over one clip: `sequence` is the clip's
  `sourceSequenceIndex` in `UV_game_animation_clips` (a clip without motion has no glTF animation
  but keeps its sequence), the clock the clip's other sequence tracks use.
  `frames` is a `SCALAR` `UNSIGNED_INT` accessor of `F + 1` ascending sprite offsets: frame `f`
  covers the clock `[f / frameRate, (f + 1) / frameRate)` and holds the sprites
  `frames[f] .. frames[f + 1] - 1`. `sprites` is a `SCALAR` `FLOAT` accessor of 17 values per
  sprite: position (3), half width and half height (2), rotation in radians (1), colour RGBA
  multiplying the texture (4), atlas cell (1), axis (3), normal (3).
- Past the last frame a `loop` track starts again at frame 0; any other track draws nothing.
  A clip without a track of a batch draws nothing of it.

A sprite is a quad around its position with a side vector `S` and an up vector `U`:

| `orientation` | `U`                                                         | `S`                                     |
| ------------- | ----------------------------------------------------------- | --------------------------------------- |
| `camera`      | camera up × half height, turned by rotation about the view  | camera right × half width, turned alike |
| `axis`        | the axis itself (the half extent along the card)            | unit(axis × to-camera) × half width     |
| `plane`       | unit(axis) × half height, turned by rotation about normal   | unit(U × normal) × half width            |

Corners are `position ± S ± U`; texture coordinates span the atlas cell with `v` growing from
`U` toward `-U`.

A `ribbon` batch draws camera-facing strips instead of quads. A frame's sprites are the points of
its strips in order along each strip; consecutive sprites with the same strip number (`axis` x)
make one strip. A point carries its position, its half width (half width), its texture coordinate
along the strip `u` (the rotation value), colour and atlas cell; half height, `axis` y and z and
`normal` are unused. At each point the strip's edge is `position ± S`, with
`S = unit(T × to-camera) × half width` and `T` the direction from the previous point to the next
(from or to the point itself at the strip's ends). Between consecutive points the consumer draws
one quad from their edges, so neighbouring quads share their edge. `v` runs from 0 on the `+S`
edge to 1 on the `-S` edge; with a `[1, 1]` atlas `u` is the texture coordinate as given (the
texture repeats along the strip), with more cells `u` in 0..1 spans the cell of the quad's first
point. A strip of one point draws nothing. A consumer bounds the sprites it draws per frame regardless of the track; a
writer bounds what it bakes and records thinned frames or dropped sprites in `UV_provenance`.
Baked particles never require the extension: a consumer that ignores it draws the model without
them, so writers **MUST NOT** list it in `extensionsRequired`.

## 14. Collision and physics

```json
{
  "nodes": [
    {
      "name": "hull_collision",
      "extensions": {
        "UV_game_collision": {
          "shapes": [
            {
              "kind": "box",
              "size": [2.8, 1.6, 5.2],
              "matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.8, 0, 1]
            },
            { "kind": "capsule", "radius": 0.4, "height": 1.8, "axis": "y" }
          ],
          "layer": "unit",
          "mask": ["projectile", "terrain", "unit"],
          "role": "physics"
        }
      }
    }
  ]
}
```

Supported `kind`: `box`, `sphere`, `capsule`, `cylinder`, `convex-hull`, `mesh`, `plane`.
`convex-hull` and `mesh` reference an accessor of positions (and indices for `mesh`) rather
than inlining vertices in JSON.

`role` distinguishes what the shape is _for_, which engines conflate at their peril:

| Role        | Use                                |
| ----------- | ---------------------------------- |
| `physics`   | Rigid-body simulation              |
| `hit`       | Weapon and projectile hit testing  |
| `selection` | Mouse picking                      |
| `footprint` | Ground occupancy for RTS placement |
| `effect`    | Particle collision surfaces        |
| `vision`    | Line-of-sight blocking             |

`matrix` is column-major, matching `Float32Array` upload order, consistent with
`RenderCollisionShape.matrix` in the Modkit IR.

**Migration note.** When `KHR_collision_shapes` and `KHR_physics_rigid_bodies` ratify,
`UV_game_collision` shapes with `role: "physics"` map 1:1 onto them; the other roles have no
Khronos equivalent and stay in UVM. The property names above were chosen to match the
Khronos drafts to make that rewrite mechanical.

## 15. LODs and variants

### 15.1 LOD

Writers **SHOULD** emit official `MSFT_lod` on the highest-detail node/material for topology, because
existing tools understand its ordered `ids` array. Selection, advisory batching and impostor
relations are separate provisional `MODKITX_*` incubation extensions; they do not redefine
Microsoft's namespace and are not stable registry claims:

```json
{
  "nodes": [
    {
      "name": "lod0",
      "extensions": { "MSFT_lod": { "ids": [1, 2, 3] } }
    },
    { "name": "lod1" },
    { "name": "lod2" },
    { "name": "lod3" }
  ],
  "extensions": {
    "MODKITX_lod_selection": {
      "levels": [
        { "node": 0, "screenCoverage": 1.0, "maxDistance": 30 },
        { "node": 1, "screenCoverage": 0.25, "maxDistance": 90 },
        { "node": 2, "screenCoverage": 0.06, "maxDistance": 240 },
        { "node": 3, "screenCoverage": 0.01, "maxDistance": 999 }
      ],
      "policy": "screen-coverage"
    },
    "MODKITX_batching_hints": {
      "nodes": [{ "node": 2, "mode": "batched", "triangleCountHint": 480 }]
    },
    "MODKITX_impostor_relation": {
      "relations": [{ "node": 3, "texture": 9, "axes": 8 }]
    }
  }
}
```

`screenCoverage` is resolution-independent and therefore the right primary metric;
`maxDistance` is a fallback for engines with a fixed camera, which describes most RTS games.
Batching remains an advisory renderer hint and cannot change portable geometry/topology semantics.
Final shared names require governance, schemas, fixtures and an independent consumer.

### 15.2 Variants

`KHR_materials_variants` handles material swaps (faction skins, camouflage).
`UV_game_variants` handles everything else — geometry, node visibility, and whole-asset
substitution:

```json
{
  "extensions": {
    "UV_game_variants": {
      "variants": [
        { "name": "default", "default": true },
        {
          "name": "damaged",
          "showNodes": [12, 13],
          "hideNodes": [8],
          "materialVariant": 1
        },
        {
          "name": "wreck",
          "asset": "tank_wreck.uvm.glb",
          "assetSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "alignSocket": "wreck-pivot"
        }
      ],
      "transitions": [
        { "from": "default", "to": "damaged", "trigger": "health<0.4" },
        { "from": "damaged", "to": "wreck", "trigger": "death" }
      ]
    }
  }
}
```

Variants that reference an external `asset` cover Spring wreck models and C&C damage stages without
inflating the primary asset.
`assetSha256` is REQUIRED for immutable/runtime packages and OPTIONAL for mutable authored
workspaces; a mismatch is an integrity failure at runtime and a stale-reference diagnostic while
authoring.

For scalar primitive visibility, `UV_game_variants` MAY contain
`"visibility": [{"mesh": 0, "primitive": 1, "value": 1}]`, independently of named variants.
Each pair names an actual glTF mesh primitive and MUST be unique. The finite numeric value is
visible exactly when greater than zero, for every scene instance of that primitive. The stored
value is never normalized: imported native tracks may use other finite magnitudes. Its presentation
opacity multiplier is `clamp(value, 0, 1)`, multiplied by the material/vertex/instance alpha once;
values in `(0,1)` fade the primitive even when its base material is OPAQUE. Zero and negative
values do not draw; values at least one add no transparency. The renderer enables alpha blending
when the multiplier is fractional, retaining material alpha-mask coverage and normal depth policy.
A publisher whose native track is only a threshold switch MUST map it to 0/1 and report any lost
source magnitude; it must not reinterpret it as a fade. An omitted record leaves the primitive
visible with multiplier one. A channel
animates `/extensions/UV_game_variants/visibility/N/value` using `KHR_animation_pointer` (§12.5).
No synthetic scene nodes or dummy materials are needed. Selecting a clip samples its property;
with no clip selected the stored value applies. A primitive the source game never draws until a state
or a clip shows it — authoring helper geometry, or an overlay such as a status effect — is written with
stored value `0`, and a clip that shows it animates the value above zero; the geometry is kept, not
dropped. Stage playback time remains caller-controlled,
with explicitly concurrent channels using their own declared wrap duration.

#### Independent slots and socket attachments (candidate contract)

`variants[].slot` names a group with at most one selected variant and at most one `default: true`.
Omitting `slot` selects the single legacy group, distinct from every named group. Variant names
remain globally unique so existing transitions keep their meaning. Slots combine independently;
an unselected slot with no default adds no override. Selection derives from the authored base,
never from the last rendered selection. `showPrimitives` and `hidePrimitives` are arrays of exact
`{mesh,primitive}` glTF targets; node lists still apply to glTF nodes. Targets must be in range,
unique in each list and disjoint within one variant. A selected show override makes its target
eligible for drawing but does not erase the scalar fade. Selecting variants that contradict one
another's visibility, material mapping, or whole-model replacement MUST refuse explicitly; slot
order never decides a winner. Transitions resolve two existing names in the same slot and replace
only that slot. Trigger strings are presentation declarations, not executable gameplay scripts.

`modelState` references one exact name in root `UV_game_model_states`. That extension is
`{schemaVersion:1,states:[{state,model,modelSha256?}]}`, described by
[`schema/uvm.model-states.schema.json`](schema/uvm.model-states.schema.json). State names are
unique; `base` is reserved for the original asset. `model` is a document-relative model URI.
The existing Warzone EVENT projection uses this table; native event interpretation remains in
its adapter. Native `.pie` names are authoring references until translated into captured UVM.
`modelState` and `asset` are mutually exclusive whole-model replacements, not a merge order.

`attachments` is a list of `{socket,asset,assetSha256?}`. `socket` is an exact `UV_game_socket.id`
in the selected host model (replacement/state when present, otherwise the original asset),
not a node index, display name or sourceName. Each selected host socket accepts at most one
variant attachment. Child placement uses the host socket transform and the child's authored
root; no second coordinate convention or model parser is introduced. `alignSocket` on the
existing whole-asset replacement names its exact child socket. Placement/switching are viewer
operations; these declarations do not create Runtime entities or grant assembly capabilities.

Every possible state, replacement and attachment is part of the resource closure, including
unselected variants. URIs resolve relative to the containing document through the same confined
UVP resolver; immutable packages require `assetSha256`/`modelSha256` (raw GLB SHA-256, lowercase
hex without prefix), matching captured `.uvm.glb` content in the same package. No URI grants I/O
authority and no native or media entry can masquerade as a model. Attachment sockets are checked
on the captured host. Recursive attachment graphs refuse, including cycles through inactive
variants; the admitted profile caps nesting at 16, attachment rows per variant at 256, and named
variants/states at 4096. This contract and admission do not themselves implement slot selection
in a renderer; consumers must report unsupported presentation explicitly.

## 16. Gameplay metadata

### 16.1 Design position

Unit statistics do not belong in a model file. In every engine listed in this specification
they live in separate data — SC2 catalogs, Spring `UnitDef` Lua tables, C&C `.ini`,
Warcraft 3 object data. Embedding them in the art asset means a re-export of the mesh
clobbers balance changes, and two teams edit the same file for unrelated reasons.

UVM therefore treats gameplay metadata as **optional and advisory**, and recommends the
external form for anything a designer will edit:

```json
{ "extensions": { "UV_game_gameplay": { "$ref": "siege_tank.def.json" } } }
```

The inline form exists for self-contained interchange — sending one file to someone who has
no access to your catalog:

```json
{
  "extensions": {
    "UV_game_gameplay": {
      "schema": "https://modkitx.org/uvm/gameplay/rts-1",
      "faction": "terran",
      "unitClass": "vehicle",
      "cost": {
        "minerals": 150,
        "vespene": 125,
        "supply": 3,
        "buildTimeSeconds": 32
      },
      "health": 175,
      "armor": 1,
      "shields": 0,
      "sight": 11.0,
      "speed": 2.25,
      "turnRate": 6.28,
      "footprintCells": [2, 2],
      "weapons": [
        {
          "id": "cannon",
          "socket": 4,
          "projectile": "shell",
          "damage": 15,
          "range": 7.0,
          "cooldownSeconds": 1.04,
          "targets": ["ground"]
        }
      ],
      "tags": ["mechanical", "armored", "siege"]
    }
  }
}
```

`schema` names the vocabulary so a validator can check the payload. Unknown fields are
preserved verbatim.

### 16.2 Game-specific extensions

`UV_game_sc2`, `UV_game_spring`, `UV_game_cnc`, `UV_game_warcraft` and peers are
free-form namespaces for data with no cross-game meaning. They may attach at any level.
See [SPEC_UVM_EXTENSIONS.md](SPEC_UVM_EXTENSIONS.md) for the `UV_game_spring` definition,
which covers `UnitDef`/`FeatureDef` references, movement classes, collision volumes and
script hooks.

## 17. Provenance and lossy conversion

This section is normative. It is the difference between a hub format and a lossy funnel.

### 17.1 Three conversion outcomes

| Tier          | Mechanism                                         | Guarantee                                        |
| ------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Converted** | Native UVM/glTF structures                        | Semantically preserved, renderable anywhere      |
| **Residual**  | Bounded format namespace in root `extras`       | Reconstruction fields absent from common UVM    |
| **Lost**      | `UV_provenance.lost` entry                        | Not recoverable; recorded so nobody is surprised |

The middle tier is borrowed from this repository's own map pipeline, where `SC2MapData`
keeps a `rawFiles` map of every embedded file verbatim specifically so a write can be
byte-exact even for formats the parser does not model. The same discipline applied to models
means an M3 chunk UVM does not understand still survives an M3 → UVM → M3 round-trip.

### 17.2 `UV_provenance`

```json
{
  "extensions": {
    "UV_provenance": {
      "source": {
        "format": "m3",
        "formatVersion": 34,
        "file": "Assets/Units/Terran/SiegeTank/SiegeTank.m3",
        "sha256": "9f2c…",
        "sourceAxes": { "up": "+z", "forward": "+x", "handedness": "right" },
        "sourceUnits": "sc2-game-unit"
      },
      "importer": { "id": "modkitx.m3", "version": "1.4.2" },
      "generatedAt": "2026-08-06T00:00:00Z",
      "lost": [
        {
          "code": "M3_STC_UNMAPPED_TRACK",
          "severity": "warning",
          "feature": "sequence track targeting an unmodelled property",
          "count": 3,
          "detail": "STC entries 14,15,22"
        },
        {
          "code": "M3_PHYSICS_JOINT",
          "severity": "info",
          "feature": "ragdoll joint constraints",
          "count": 6
        }
      ]
    }
  }
}
```

`severity` is `info` (cosmetic or engine-specific), `warning` (visible difference) or
`error` (the asset will not behave correctly). A conversion pipeline **SHOULD** fail a build
on `error` unless explicitly overridden.

The brief proposed a separate `lost_features.json`. UVM puts it inside the asset instead,
because a sidecar file gets separated from the asset it describes on the first copy
operation. The directory packaging in [section 5.3](#53-directory-layout) still allows
externalising it via `$ref` when a shipping build wants it stripped.

### 17.3 Format-owned residuals

A converter **MUST** project every representable value into glTF or a registered common UVM
extension. It may place only reconstruction fields with no common representation in a bounded,
format-owned root `extras` namespace such as `BlizzardM3` or `WarzonePIE`.

The namespace envelope contains `schemaVersion`, `format`, `profile`, `residual` and `mapping`.
`residual` contains the minimal target-format fields; `mapping` relates them to common UVM objects.
It **MUST NOT** contain the original file, opaque source chunks, byte ranges whose purpose is source
recovery, or duplicate values already carried by common glTF/UVM structures. Exporters always
regenerate target bytes from the common scene plus the bounded residual.

### 17.4 Loss policy by conversion direction

Lossy conversion is a property of the _pair_, not of UVM. The conversion guide
([SPEC_UVM_CONVERSION.md](SPEC_UVM_CONVERSION.md)) tabulates what each importer and
exporter loses. Two rules apply universally:

1. **An importer must never silently drop data.** Anything not represented in common UVM or a justified bounded residual is recorded in `lost`.
2. **An exporter must never invent data.** If a target format requires a field UVM does not
   carry, the exporter emits its documented default and records that it did so.

## 18. Versioning and compatibility

- The specification is versioned `MAJOR.MINOR` in `asset.extras.uv.version`; `format` is `"UVM"`.
- **Minor versions are additive only.** New optional properties, new extensions, new
  registered enum values. A 1.0 reader reads a 1.3 file correctly, ignoring what it does not
  know.
- **Major versions may remove or redefine.** A reader **MUST** refuse a major version it does
  not implement, rather than guessing.
- Individual extensions carry their own `version` property when their semantics change
  independently of the core spec.
- Unregistered enum values **MUST** be preserved on round-trip and **MUST** fall back to the
  documented default for rendering.
- Vendors extend with `VENDOR_*` names, never `UV_*`. The `UV_*` namespace is reserved
  for the registry in [SPEC_UVM_EXTENSIONS.md](SPEC_UVM_EXTENSIONS.md).

## 19. Runtime integration

### 19.1 Engine architecture

```
   .uvm.glb file
        │
        ▼
┌────────────────────┐
│  UVM Loader       │  glTF parse → typed arrays; extension plugins
└─────────┬──────────┘
          │  produces
          ▼
┌────────────────────────────────────────────────────────────┐
│  Runtime Object                                             │
│  ┌──────────┬──────────┬───────────┬──────────┬──────────┐ │
│  │ GPU mesh │ skeleton │ materials │ clips    │ sockets  │ │
│  └──────────┴──────────┴───────────┴──────────┴──────────┘ │
└───┬──────────────┬──────────────┬───────────────┬──────────┘
    │              │              │               │
    ▼              ▼              ▼               ▼
┌────────┐   ┌───────────┐  ┌──────────┐   ┌────────────┐
│Renderer│   │ Animation │  │ Physics  │   │ Gameplay   │
│        │   │  system   │  │  system  │   │  systems   │
└────────┘   └───────────┘  └──────────┘   └────────────┘
```

The loader is the only component that knows the file format. Everything downstream consumes
runtime structures. This is the same boundary the Modkit `ModelCodec` registry already
enforces: adding a format never touches the viewer or renderer.

### 19.2 Loading strategy

A UVM loader **SHOULD**:

1. Parse the JSON chunk only, and answer `UV_asset.capabilities` queries from it — this
   makes asset browsers instant on large libraries.
2. Upload geometry bufferViews directly to GPU buffers without an intermediate copy;
   interleaved, aligned data ([section 8.1](#81-recommended-encodings)) makes this possible.
3. Decode textures on a worker; KTX2/Basis transcodes to the platform's native compressed
   format with no full-resolution RGBA intermediate.
4. Defer effects, collision and gameplay extensions until something asks for them.
5. Cache by `sha256` of the file, keyed independently from the URI, so the same asset
   referenced from ten maps loads once.

### 19.3 Genre coverage

| Genre      | Which parts matter                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| RTS        | `MSFT_lod` topology + provisional split selection/batching/impostor extensions, team colour, footprint collision, sockets for weapons |
| RPG        | `UV_retarget` humanoid, `UV_game_variants` equipment, hardpoint sockets, animation layers                                             |
| FPS        | Animation events for damage windows, muzzle sockets, `role: "hit"` collision regions                                                  |
| Simulation | `UV_game_skeleton.axes` mechanical joints with limits, `UV_game_gameplay` physical parameters                                         |

## 20. Authoring tools

### 20.1 Three.js and the browser

Three.js `GLTFLoader` reads UVM today with no changes and produces correct geometry,
skinning and animation. UVM semantics arrive through the loader's plugin API:

```js
class UvmSocketPlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = "UV_game_socket";
  }
  afterRoot(result) {
    const json = this.parser.json;
    result.userData.sockets = new Map();
    json.nodes?.forEach((node, i) => {
      const socket = node.extensions?.UV_game_socket;
      if (!socket) return;
      const object = result.parser?.getDependency
        ? undefined
        : result.scene.getObjectByName(node.name);
      if (object) {
        object.userData.uvSocket = socket;
        result.userData.sockets.set(socket.role + (socket.index ?? ""), object);
      }
    });
  }
}

loader.register((parser) => new UvmSocketPlugin(parser));
```

Because sockets are nodes, attaching a weapon is `socketObject.add(weapon.scene)` — no
transform maths, no bone lookup.

**WebGPU.** Vertex buffer layouts require 4-byte-aligned attribute offsets and strides;
[section 8.1](#81-recommended-encodings)'s interleaving rules satisfy that directly. Prefer
`EXT_meshopt_compression`, whose decoder is a small WASM module, over Draco for interactive
loads. Prefer KTX2 with the platform's native compressed format.

**WebGL.** Same file, `UNSIGNED_SHORT` index preference matters more, and KTX2 transcodes to
whatever the extension set offers (ASTC, ETC2, BC7, or uncompressed RGBA as a last resort).

### 20.2 Blender

This is where "be glTF" pays the largest dividend. Blender's glTF importer/exporter is
official, maintained, and already handles meshes, materials, skeletons, skinning, animation
and morph targets. A UVM addon does **not** implement an importer — it registers extension
hooks on the existing one:

- Import: `glTF2ImportUserExtension.gather_import_node_after_hook` maps `UV_game_socket` nodes
  to Blender empties with custom properties; `UV_game_material_team_color` becomes a node group;
  `UV_game_collision` becomes collision-collection objects; `UV_game_animation_events` becomes
  timeline markers or pose markers on the action.
- Export: `glTF2ExportUserExtension.gather_node_hook` writes the same data back.

Estimated size: a few hundred lines per extension, against several thousand for a
from-scratch importer that would then have to track Blender API changes forever.

### 20.3 Command line

`gltf-transform` works on UVM files unmodified for compression, texture conversion, pruning
and inspection. The UVM CLI adds only what is UVM-specific:

```bash
uvm convert tank.m3 --out tank.uvm.glb --report lost.json
uvm pack tank.uvm.glb.d --out tank.uvm.glb
uvm validate tank.uvm.glb --profile full
uvm inspect tank.uvm.glb --sockets --lost
uvm export tank.uvm.glb --target spring --out tank.s3o
```

## 21. Security considerations

UVM files are untrusted input. Implementations **MUST**:

- Bound every allocation by the declared buffer length, and reject accessors whose
  `byteOffset + count × stride` exceeds their bufferView.
- Reject `bufferView` and accessor graphs containing cycles.
- Treat `uri` references as relative paths confined to the package root; reject absolute
  paths, `..` traversal and non-`data:` schemes unless the host explicitly allows them.
- Bound `UV_game_effects.maxParticles` at the consumer, regardless of the declared value — a
  hostile asset otherwise requests an unbounded particle budget.
- Never evaluate `UV_provenance` or `UV_game_*` payloads as code. `UV_game_animation_events`
  with `name: "script"` carries a _name_, never a script body.
- Bound `KHR_animation_pointer` JSON pointer resolution to the document, and reject
  pointers into binary storage or outside the document root.

### Presentation scene constraints

`UV_node_billboard` (node) and `UV_scene_lights` (root) are registered with their
existing Core wire shapes in [SPEC_UVM_EXTENSIONS](SPEC_UVM_EXTENSIONS.md#uv_node_billboard)
and `uvm.scene.schema.json`. Native lights keep full cone angles and per-clip
effect-property tracks; physical punctual lights use KHR_lights_punctual. These
constraints are presentation-only and do not change Runtime transforms or RNG.
