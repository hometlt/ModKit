# UVM conversion guide

**Version:** 1.0 Draft
**Companion to:** [SPEC_UVM.md](SPEC_UVM.md)

This document defines the importer/exporter architecture and the per-format mapping tables.
It is normative for the loss codes an importer emits.

## 1. Pipeline architecture

```
  M3   MDX   W3D   S3O   SCM   PSK   FBX   OBJ   glTF   Blend
   │     │     │     │     │     │     │     │     │      │
   └─────┴─────┴──┬──┴─────┴─────┴─────┴─────┴─────┴──────┘
                  │   importers  (N)
                  ▼
        ┌───────────────────────┐
        │   RenderModel (IR)    │   in-memory, engine-neutral
        └───────────┬───────────┘
                    │  serialise / deserialise
                    ▼
        ┌───────────────────────┐
        │   UVM  (glTF 2.0)    │   on disk, versioned, diffable
        └───────────┬───────────┘
                    │   exporters  (M)
   ┌─────┬─────┬────┴────┬─────┬─────┬──────┬───────┐
   ▼     ▼     ▼         ▼     ▼     ▼      ▼       ▼
 Unreal Unity Godot  Three.js Blender S3O   M3    OBJ/glTF
```

Two levels, deliberately:

- **`RenderModel`** is the in-memory intermediate. It already exists in this repository
  (`packages/models-processing/src/index.ts:646` in the sealed legacy oracle)
  and ~20 codecs already produce it.
- **UVM** is its serialisation. Importers and exporters never talk to each other, only to
  `RenderModel`; UVM is what crosses process, machine and tool boundaries.

Keeping both matters. A converter running in one process should not pay JSON serialisation
costs, and a file format should not be shaped by the convenience of one language's type
system.

### 1.1 Importer contract

An importer is a `ModelCodec` — the interface already defined at
`packages/models-processing/src/core/codec.ts:89` in the sealed legacy oracle:

```ts
interface ModelCodec extends ModelParser {
  readonly id: string
  readonly extensions: readonly string[]
  readonly capabilities: ModelCodecCapabilities
  parse(bytes, hint?, options?): Promise<RenderModel> | RenderModel
  encode?(model: RenderModel, options?): Promise<ModelEncodeResult> | ModelEncodeResult
}
```

Adding a format is registering a codec. No viewer, renderer or exporter code changes.

### 1.2 Lossy versus lossless

A conversion is **lossless** when the target can express every construct the source used.
That is rare and pair-specific — it depends on the *asset*, not only the formats. A static
OBJ cube to UVM is lossless; an M3 siege tank to OBJ loses everything but one mesh.

The three tiers from [SPEC_UVM.md §17.1](SPEC_UVM.md#171-three-tiers-of-preservation)
apply to every importer:

1. **Converted** — becomes native UVM/glTF structure.
2. **Preserved** — original bytes in `UV_source_blob`, recoverable only by an exporter
   targeting the same format.
3. **Lost** — recorded in `UV_provenance.lost` with a stable code.

The brief's example — M3 particles not existing in C&C — is a *round-trip* loss, and it
happens at the **exporter**, not the importer. The importer converts M3 particles into
`UV_game_effects` faithfully; the W3D exporter is the component that cannot represent them, and
it is the component that must say so. This distinction matters operationally: the same UVM
file exported to Unreal keeps its effects, so recording the loss at import time would be a
lie.

### 1.3 Loss code format

`<SOURCE>_<FEATURE>` for importers, `<TARGET>_<FEATURE>_UNSUPPORTED` for exporters.
Codes are stable identifiers, never localised text. `detail` carries the human-readable
specifics.

---

## 2. StarCraft II M3 / M3A → UVM

M3 is the richest source format in scope and the one that most tests the design.

| M3 construct | UVM target | Notes |
| --- | --- | --- |
| `MODL` header | `UV_asset`, `UV_game_sc2.version`/`flags` | |
| `VERT` vertex buffer | interleaved accessors | Vertex flags select which attributes exist |
| `DIV_`/`REGN`/`BAT_` | `mesh.primitives` | One primitive per region/material batch |
| `BONE` hierarchy | nodes + `skins[].joints` | `sourceOrder` preserves index references |
| `BONE` billboard flags | `UV_game_skeleton.billboards` | No glTF equivalent |
| `IREF` inverse bind | `inverseBindMatrices` accessor | |
| `Ref_*` bones | nodes with `UV_game_socket` | `role` inferred from name, `sourceName` preserved |
| `MATM`/`MAT_` standard | `pbrMetallicRoughness` + `UV_game_material` (`shader: "sc2.standard"`) | |
| `MATM` type 3 composite | `UV_game_material.passes` | |
| `LAYR` layers | `UV_game_material.layers` | UV source, tiling, scroll, fresnel |
| Team-colour layer | `UV_game_material_team_color` | |
| `SEQS` sequences | `animations` + `UV_game_animation_clips` | `priority`, `concurrent`, `sourceName` |
| `STC_`/`STS_`/`STG_` tracks | samplers + channels | Node TRS tracks map natively |
| `STC_` tracks on effect properties | `KHR_animation_pointer` | The reason that extension exists |
| Global sequences | `UV_game_animation_clips.loop: "loop"` + separate animation | |
| `PAR_` particles | `UV_game_effects.particles`, `profile: "m3"` | ~100 properties, mapped 1:1 |
| `RIB_` ribbons | `UV_game_effects.ribbons` | |
| `FOR_` forces | `UV_game_effects.forces` | |
| `PHRB` physics shapes | `UV_game_collision`, `role: "physics"` | |
| `PHSH` physics joints | **preserved blob** | No glTF or UVM representation yet |
| `ATVL`/`ATT_` attachment volumes | `UV_game_collision`, `role: "hit"` | |
| `PROJ` projectors | `UV_game_effects.projectors` | |
| `WRP_` warps | `UV_game_effects.warps` | |
| `CAM_` cameras | glTF `cameras` + nodes | |
| `.m3a` external animations | merged into `animations`, `UV_provenance.chain` records the file | |
| Unrecognised chunks | **preserved blob** | Keeps M3 → UVM → M3 byte-recoverable |

Coordinate change: `(x, y, z)_m3 → (x, z, -y)_uvm`, +Z-up right-handed to +Y-up
right-handed.

Loss codes: `M3_PHYSICS_JOINT`, `M3_STC_UNMAPPED_TRACK`, `M3_SHADER_PARAM_UNKNOWN`,
`M3_VERTEX_FLAG_UNKNOWN`, `M3_CHUNK_UNPARSED`.

---

## 3. Warcraft 3 MDX / MDL → UVM

| MDX construct | UVM target | Notes |
| --- | --- | --- |
| `VERS`, `MODL` | `UV_asset` | |
| `GEOS` geosets | meshes + primitives | |
| `GEOA` geoset animation | `KHR_animation_pointer` targeting material alpha, or node visibility | |
| `BONE`, `HELP`, `PIVT` | nodes + skin | Helpers become non-joint nodes |
| `ATCH` attachments | `UV_game_socket` | `sourceName` preserved verbatim — triggers reference it |
| `MTLS`/`LAYS` | PBR + `UV_game_material` (`shader: "mdx.layer"`) | Filter modes map to `blendMode` |
| Replaceable ID 1 | `UV_game_material_team_color`, `maskSource: "whole"` | |
| Replaceable ID 2 | `UV_game_material_team_color.glow` | |
| `SEQS` | `animations` + `UV_game_animation_clips` | Names like `"Attack 01"` preserved |
| `GLBS` global sequences | separate looping animations | |
| `KGTR`/`KGRT`/`KGSC` | samplers, `LINEAR`/`STEP`/`CUBICSPLINE` (Hermite/Bezier → cubic spline) | |
| `PREM`/`PRE2` emitters | `UV_game_effects.particles`, `profile: "mdx"` | `modelSpace` true, `boneAnchored` unset |
| `RIBB` ribbons | `UV_game_effects.ribbons` | |
| `EVTS` event objects | `UV_game_animation_events` | |
| `CLID` collision shapes | `UV_game_collision`, `role: "hit"` | |
| `CAMS` | glTF cameras | |
| `LITE` lights | `KHR_lights_punctual` | |
| `BPOS` bind pose | `inverseBindMatrices` | |
| `TXAN` texture animation | `KHR_animation_pointer` on layer `offset`/`rotation` | |

MDX interpolation types Hermite and Bezier both convert to `CUBICSPLINE`; the tangent
convention differs and importers **MUST** convert tangents rather than copying them.

Loss codes: `MDX_INTERPOLATION_APPROXIMATED`, `MDX_GEOSET_ANIM_UNMAPPED`,
`MDX_UNKNOWN_FILTER_MODE`.

---

## 4. Command & Conquer W3D → UVM

| W3D construct | UVM target | Notes |
| --- | --- | --- |
| `MESH` | mesh + primitives | |
| `HIERARCHY` (`.w3d` HTREE) | node hierarchy | Often a separate file from the mesh |
| `HLOD` | `MSFT_lod` + provisional split `MODKITX_lod_selection`/batching/impostor extensions | Standard chain plus separately governed selection/tuning/proxy data |
| `HLOD` aggregates | `UV_game_socket` role `attach` + `UV_game_cnc.aggregates` | |
| `VERTEX_MATERIAL` | PBR + `UV_game_material` (`shader: "w3d.vertex-material"`) | |
| `SHADER` block | `UV_game_material.blendMode`, `depthWrite`, `cull` | |
| `TEXTURE` stages | `UV_game_material.layers` | |
| House-colour material slot | `UV_game_material_team_color` | |
| `ANIMATION`, `COMPRESSED_ANIMATION` | `animations` | Compressed forms decompress on import |
| Bone names `TURRET`, `BARREL` | `UV_game_skeleton.roles` `turret_yaw`, `barrel_pitch` | Name-based inference, recorded as inferred |
| `MUZZLE*`, `FIREPOINT*` bones | `UV_game_socket` role `muzzle` | |
| `AABTREE` | dropped | Regenerable spatial index |
| `DAZZLE`, `RING`, `SPHERE` | `UV_game_effects` or preserved blob | Format-specific primitives |
| Damage states (`_D1`, `_D2` meshes) | `UV_game_variants` | |
| Bind-pose quirk | corrected into `inverseBindMatrices` | See `packages/models-processing/src/core/westwood-bind-pose.ts` in the sealed legacy oracle |

Loss codes: `W3D_AABTREE_DROPPED`, `W3D_DAZZLE_UNMAPPED`, `W3D_ROLE_INFERRED_FROM_NAME`.

`W3D_ROLE_INFERRED_FROM_NAME` is severity `info`, not a loss — it records that a bone role
came from a naming heuristic so a downstream tool knows not to trust it blindly.

---

## 5. Spring / Recoil S3O → UVM

Spring is the reference *second* implementation for UVM, because the engine and its formats
are open-source and documented, which makes the conversion verifiable rather than
reverse-engineered.

| S3O construct | UVM target | Notes |
| --- | --- | --- |
| Header `radius`, `height`, `midPos` | `UV_game_spring` (in elmos) | Kept in native units for exact export |
| Texture 1 (`tex1`) | material base colour + specular in alpha | Spring packs teamcolour-mask in `tex1.a` |
| Texture 2 (`tex2`) | `UV_game_material_team_color` + `UV_game_spring.teamTexture` | |
| Piece tree | nodes | Every piece is a node; Spring has no skinning |
| Piece names | `UV_game_spring.pieces` + node names | Scripts reference these — must round-trip |
| Piece `offset` | node `translation` | Relative to parent, matching glTF |
| Primitive lists (triangles, strips, quads) | primitives, `mode: 4` | Strips and quads triangulate; original topology recorded |
| Vertex `normal`, `texCoord` | `NORMAL`, `TEXCOORD_0` | |
| `.cob` / Lua unit script | `UV_game_spring.scriptType` + `scriptHooks`, script itself as blob | Not translated |
| `UnitDef` (external Lua) | `UV_game_gameplay` + `UV_game_spring.unitDef` | |
| `FeatureDef` (external Lua) | `UV_game_gameplay` + `UV_game_spring.featureDef` | |
| `wreckName` chain | `UV_game_variants` with external `asset` + `UV_game_spring.wreck`/`heap` | |
| `MoveDef` reference | `UV_game_gameplay.movementClass` + `UV_game_spring.movementClass` | Matches UVW navigation class ids |
| Collision volume | `UV_game_collision`, `role: "physics"` | Spring's `cylinder`/`ellipsoid` map to `cylinder`/`sphere` with non-uniform scale in `matrix` |

Coordinate change: Spring is left-handed +Y up with +Z forward. Convert by negating X, which
flips handedness while keeping up and forward. Scale: 1 elmo = 1/8 map square; the metre
factor comes from the map's `squareSize`, so a standalone model conversion records
`sourceUnit: "elmo"` with `metersPerSourceUnit` from the project setting rather than guessing.

**Spring has no skeletal skinning.** Every piece is a rigid node animated by script. This is
why `UV_game_skeleton.roles` is valuable in the other direction: converting an M3 skinned mesh
to S3O requires *deciding* which bones become pieces, and the roles are the only
non-heuristic signal available.

Loss codes: `S3O_TOPOLOGY_TRIANGULATED`, `S3O_SCRIPT_NOT_TRANSLATED`,
`S3O_SKINNING_UNSUPPORTED` (export direction).

### 5.1 Converting a Spring unit into UVM, end to end

A Spring unit is not one file. It is:

```
units/armcom.lua          UnitDef        → UV_game_gameplay + UV_game_spring
objects3d/armcom.s3o      geometry       → meshes, nodes
unittextures/armcom1.dds  tex1           → material base colour
unittextures/armcom2.dds  tex2           → team colour mask
scripts/armcom.lua        unit script    → preserved blob + scriptHooks
features/armcom_dead.lua  FeatureDef     → UV_game_variants → external asset
objects3d/armcom_dead.s3o wreck geometry → separate UVM file
```

The importer takes the `UnitDef` as its entry point, resolves the rest, and emits one primary
`armcom.uvm.glb` plus `armcom_dead.uvm.glb`. `UV_game_variants` links them. This is why UVM's asset
model is "one game object", not "one mesh file" — the game object is the unit of meaning.

---

## 6. Other formats

### 6.1 Total Annihilation 3DO

| Construct | Target |
| --- | --- |
| Object tree with per-object offsets | nodes |
| Primitives with palette colour index | primitives; palette index → `UV_game_material_team_color` `paletteRange` when in the team range |
| Selection primitive | `UV_game_collision`, `role: "selection"` |
| Texture names | materials referencing external GAF textures |

3DO has no normals and no UVs on untextured primitives; the importer generates flat normals
and records `TA3DO_NORMALS_GENERATED`.

### 6.2 Supreme Commander SCM / SCA

| Construct | Target |
| --- | --- |
| `SCM` bones + weights | nodes + skin |
| `SCM` vertex format (position, normal, tangent, binormal, 2 UV) | accessors; binormal dropped, recoverable from normal + tangent `w` |
| `SCA` animation | `animations` |
| Bone names `Attachpoint*` | `UV_game_socket` |

### 6.3 Unreal (`.psk`/`.psa`, `.uasset`)

| Construct | Target |
| --- | --- |
| `PSK` mesh + skeleton | meshes + skin |
| `PSA` animation | animations |
| `uasset` StaticMesh / SkeletalMesh | meshes, LOD chain → `MSFT_lod` |
| Sockets | `UV_game_socket` |
| Physics asset bodies | `UV_game_collision`, `role: "physics"` |
| Material instances | PBR where parameters map; `UV_game_material` otherwise |

Scale: Unreal is centimetres, so geometry is multiplied by 0.01 and `metersPerSourceUnit` is
`0.01`. Handedness: Unreal is left-handed +Z up.

### 6.4 FBX

FBX is not a source game format but is the common denominator of DCC tools.

| Construct | Target |
| --- | --- |
| Mesh, normals, UV sets, vertex colours | accessors |
| Skin deformers, clusters | skins |
| Animation stacks / layers | animations + `UV_animation_layers` |
| Null nodes named `socket_*`, `SOCKET_*` | `UV_game_socket` |
| Custom properties | `extras`, preserved verbatim |
| FBX units and axis system | converted per file header; recorded in `UV_provenance.sourceAxes` |

FBX's per-polygon-vertex attribute mapping must be resolved to per-vertex during import,
splitting vertices where attributes differ. Record the original vertex count in provenance so
a re-export can weld back.

### 6.5 OBJ, PLY, STL, Collada, Blend, glTF

These already have first-class Modkit codecs. glTF → UVM is the trivial case: the document
is already valid UVM once `asset.extras.uv` and `UV_provenance` are added. That is worth
stating explicitly — **every existing glTF file in the world is a valid core-conformant UVM
asset after a two-key edit.** No other design in this space can say that.

---

## 7. Export direction

Exporters are where loss concentrates. Each exporter declares its capability matrix and emits
`<TARGET>_<FEATURE>_UNSUPPORTED` codes into a conversion report (not into the UVM file,
which is the source and unchanged).

| Feature | M3 | MDX | W3D | S3O | SCM | FBX | glTF | Unreal | Unity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Static mesh | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Skinning | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| >4 influences | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Morph targets | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Node animation | ✅ | ✅ | ✅ | ⚠️ script | ✅ | ✅ | ✅ | ✅ | ✅ |
| Animation events | ✅ | ✅ | ⚠️ | ⚠️ script | ❌ | ⚠️ | ❌ | ✅ | ✅ |
| Animation layers | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| Team colour | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ |
| PBR materials | ⚠️ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ | ✅ | ✅ |
| Particles | ✅ | ⚠️ subset | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ |
| Ribbons | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ |
| Collision shapes | ✅ | ✅ | ⚠️ | ✅ | ❌ | ⚠️ | ❌ | ✅ | ✅ |
| Sockets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ extras | ✅ | ✅ |
| LODs | ⚠️ | ❌ | ✅ | ❌ | ✅ | ⚠️ | ⚠️ `MSFT_lod` | ✅ | ✅ |
| Gameplay metadata | ❌ | ❌ | ❌ | ✅ Lua | ❌ | ⚠️ props | ⚠️ extras | ✅ | ✅ |

✅ native · ⚠️ approximated or partial · ❌ lost, must be reported

The M3 → W3D case from the brief reads off this table directly: particles are ❌ for W3D, so
the exporter emits `W3D_PARTICLES_UNSUPPORTED` with a count, and the operator decides whether
to accept the build.

### 7.1 Exporter rules

1. **Never invent.** If the target requires a field UVM lacks, emit the documented default
   and record `<TARGET>_<FIELD>_DEFAULTED`.
2. **Prefer preserved blobs.** When exporting to the same format the asset came from, an
   exporter **MUST** consult `UV_source_blob` and reuse original chunk bytes for anything it
   would otherwise regenerate.
3. **Report before writing.** A conversion report is produced even on success, so a build can
   gate on severity.
4. **Deterministic output.** Same input, same options, same bytes.

---

## 8. Round-trip test matrix

The conformance suite an implementation must pass:

| Test | Assertion |
| --- | --- |
| `identity` | UVM → UVM is byte-identical |
| `pack/unpack` | directory → GLB → directory is byte-identical |
| `core-open` | every fixture opens in a stock glTF loader with no errors |
| `validator` | every fixture passes `gltf-validator` with zero errors |
| `same-format round-trip` | `X → UVM → X` reproduces the source semantically; byte-identically where blobs cover the gap |
| `double-hop` | `X → UVM → Y → UVM` records both conversions in `provenance.chain` |
| `loss-report` | every dropped feature has a `lost` entry; a fixture with a known drop fails if the entry is missing |
| `no-silent-drop` | a fuzzer removes support for one feature at a time; the report must change |
| `degradation` | rendering with all `UV_*` extensions disabled produces a recognisable model |

`no-silent-drop` is the test that actually keeps the format honest, and it is worth building
first.
