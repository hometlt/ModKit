# `multiverse/specs` — the UV specification authority

This directory is the **single normative source** for the Universal Verse (`UV*`) format family:
schemas, canonicalization, version negotiation, the semantic-scope registry and the executable
conformance suites. Modkit (authoring, import, inspection) and Multiverse (the engine) both consume
it; neither owns it, and neither may publish a competing copy.

Consumers pin a commit of this repository and vendor a generated snapshot. A snapshot is a
convenience, never a second authority — where a snapshot and this repository disagree, this
repository is right and the snapshot is stale.

## Run the conformance suite

```sh
node specs/tools/uv-conformance.mjs
node specs/tools/uv-conformance.mjs --suite model-interchange-v1
node specs/tools/uv-conformance.mjs --schemas <module url of a draft 2020-12 engine>
```

No install step, no lockfile, no package manifest: Node built-ins only. A specification a third
party cannot execute without resolving dependencies has a hidden dependency.

That is also why the JSON Schema assertions in
[`conformance/schema-assertions.json`](conformance/schema-assertions.json) run only when `--schemas`
supplies an engine. Without one the runner reports them as **not executed** rather than counting
them as passing.

The vectors themselves are committed data. `tools/uv-conformance-emit.mjs` re-emits them from the
reference implementations, and `--oracle <module url>` additionally requires a second implementation
of the canonical form to reproduce every accept vector. Re-emitting is for a deliberate descriptor
change, never for making a failing vector pass: it produces a reviewable diff of expected hashes,
and a hash diff nobody can explain is the signal, not the fix.

## What is in this seed, and what is not

This is the block-11 seed of the final `multiverse/specs` history — the same history block 22
extends with the engine packages, extensions and apps. There is no second repository and no second
specs history.

The seed carries the material slice 11C0 owns normatively:

| Area                                   | Where                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| UV Foundation (shared contract)        | [`foundation/SPEC_UV_FOUNDATION.md`](foundation/SPEC_UV_FOUNDATION.md)       |
| Canonicalization (both forms)          | [`foundation/SPEC_UV_CANONICALIZATION.md`](foundation/SPEC_UV_CANONICALIZATION.md) |
| Versioning and negotiation             | [`foundation/SPEC_UV_VERSIONING.md`](foundation/SPEC_UV_VERSIONING.md)       |
| UVM specification, extensions, conversion | [`model/`](model/)                                                        |
| UVT profile, schema and fixtures        | [`texture/`](texture/)                                                       |
| UVM JSON Schemas                       | [`model/schema/`](model/schema/)                                             |
| UVM canonical fixtures                 | [`model/fixtures/`](model/fixtures/)                                         |
| Semantic scope registry + `model-interchange-v1` | [`semantic-scopes/`](semantic-scopes/)                             |
| Executable conformance vectors         | [`conformance/`](conformance/)                                               |
| Reference implementations              | [`tools/`](tools/)                                                           |

The remaining format drafts (UVW, UVD, UVS and the media/package stubs) are **not** transferred yet.
Their ids, boundaries and maturity are registered below, and the block that transfers each one is
named. Registering an id is not the same as claiming an implementation — see
[`NOTES.md`](NOTES.md) for the transfer boundary and every source divergence this seed resolved.

## The UV format family

The registry reserves names and boundaries. It does not claim twelve implemented standards.

| ID      | Extension                        | Scope                                                                        | Physical base                          | In this seed |
| ------- | -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | ------------ |
| **UVM** | `.uvm.glb` / `.uvm.gltf`         | Models, skeletons, animation, materials, effects, collision, sockets          | glTF 2.0 profile                       | yes          |
| **UVW** | `.uvw`                           | Terrain, objects, entities, navigation, players, resources                    | JSON world manifest + standard payloads | block 22     |
| **UVD** | `.uvd` (directory/JSON)          | Definitions, components, overlays, inheritance, provenance                    | canonical JSON                         | block 22     |
| **UVS** | `.uvs`                           | Objectives, triggers, waves, AI refs, dialogue, campaigns                     | canonical JSON + bounded logic IR      | block 22     |
| **UVR** | `.uvr`                           | Mechanic/provider composition, slots, ordering, composition lock inputs        | canonical JSON (stub)                  | block 22     |
| **UVP** | `.uvp`                           | Data-only game/mod/campaign/asset/localization packages                        | ZIP/directory profile (stub)           | block 22     |
| **UVE** | `.uve`                           | Immutable extension release artifact (the only UV format with executable payloads) | deterministic ZIP + signature profile (stub) | block 22 |
| **UVT** | `.uvt.ktx2` (+`.uvt.json`)       | Runtime textures/atlases/arrays/cubemaps/animated images                       | KTX 2.0 profile                        | yes          |
| **UVA** | `.uva` / `.uva.mka`              | Audio assets, stems, loops, cues, spatial metadata                            | Matroska audio profile (stub)          | block 22     |
| **UVV** | `.uvv` / `.uvv.mkv`              | Video + audio/subtitle/metadata tracks, chapters, game events                  | Matroska profile (stub)                | block 22     |
| **UVF** | `.uvf.otf` / `.uvf.woff2` (+`.uvf.json`) | Fonts, variable axes, color/bitmap glyphs, atlas projections           | OpenType/WOFF2 profile (stub)          | block 22     |
| **UVG** | `.uvg.svg` (+`.uvg.json`)        | Icons, overlays, diagrams, safe declarative animation                          | secure SVG 2 profile (stub)            | block 22     |
| *UVI*   | *candidate*                      | HTML-compatible portable game-interface structure and bindings                | HTML profile                           | gated        |
| *UVY*   | *candidate*                      | CSS-compatible portable styles/themes; paired with UVI at admission            | CSS profile                            | gated        |

UVI and UVY are **reserved candidates**, not accepted formats. Their admission gate needs SC2Layout
plus a second independent UI family; until then the pair is a target, not a promise.

### Naming rules

One canonical extension per format. Base-standard-visible double extensions (`.uvm.glb`,
`.uvt.ktx2`, `.uva.mka`, `.uvv.mkv`, `.uvf.woff2`, `.uvg.svg`) keep ordinary tools opening the
standard part of the file; the plain short forms (`.uva`, `.uvv`, `.uvw`, `.uvs`, `.uvd`, `.uvr`,
`.uvp`, `.uve`) are the product-facing names. Base media types stay the registered standard types
(`model/gltf-binary`, `image/ktx2`, `audio/matroska`, `video/matroska`, `font/otf`, `font/woff2`,
`image/svg+xml`); UV JSON forms use provisional `application/vnd.uv.<format>+json` names until
registration. A file suffix never proves profile conformance.

Vendors extend with `VENDOR_*` names. The `UV_*` namespace belongs to the registry in
[`model/SPEC_UVM_EXTENSIONS.md`](model/SPEC_UVM_EXTENSIONS.md).

## Format maturity

Maturity and support are independent axes
([SPEC_UV_FOUNDATION §6](foundation/SPEC_UV_FOUNDATION.md#6-conformance-vocabulary)). `reader` and
`writer` below mean a UV-conforming implementation, not merely an existing native codec.

| Format                       | Reserved | Full draft | Schema  | Fixtures                                    | Executable validator            | Reader | Writer | Stable |
| ---------------------------- | -------- | ---------- | ------- | ------------------------------------------- | ------------------------------- | ------ | ------ | ------ |
| UVM                          | yes      | yes        | partial | 3 canonical core fixtures + 1 spec example  | yes, for the core profile        | core   | reference GLB packer only | no |
| UVW                          | yes      | yes        | yes     | one example                                 | no                              | no     | no     | no     |
| UVD                          | yes      | yes        | no      | no                                          | no                              | no     | no     | no     |
| UVS                          | yes      | yes        | yes     | one example                                 | no                              | no     | no     | no     |
| UVT                          | yes      | conversion-grade | yes | 3 sidecar fixtures                    | yes, profile rules + schema      | no     | no     | no     |
| UVE, UVP, UVR, UVA, UVV, UVF, UVG | yes | stub    | no      | no                                          | no                              | no     | no     | no     |
| UVI, UVY                     | candidate| no         | no      | no                                          | no                              | no     | no     | no     |

The UVW/UVD/UVS/stub rows are carried forward unchanged from the pre-seed evidence matrix dated
2026-08-17; their schemas, examples and drafts still live in the pre-seed material and move here
with block 22. The UVM row is the only one this seed changes, and it changes it for material that
is in this repository and executed by `uv-conformance`.

## Semantic scopes

| Scope                       | Status     | Meaning                                                                    |
| --------------------------- | ---------- | -------------------------------------------------------------------------- |
| `model-interchange-v1`      | registered | the model plane a live projection and a reopened UVM artifact must reproduce exactly |
| `world-interchange-v1`      | reserved   | id only; block 12 prepares the candidate, block 18 freezes it              |
| `definition-interchange-v1` | reserved   | id only; block 23                                                          |

See [`semantic-scopes/SPEC_SEMANTIC_SCOPE_DESCRIPTOR.md`](semantic-scopes/SPEC_SEMANTIC_SCOPE_DESCRIPTOR.md).

## What these formats deliberately do not do

- **No universal shader language.** Shader parameters are preserved; pixel output is not defined.
- **No universal particle simulator.** Emitter parameters are preserved and a common subset is
  defined; bit-identical playback across engines is not achievable and is not promised.
- **No cross-engine script translation.** Galaxy, Lua, JASS and INI have different execution models.
  The scene formats preserve native scripts verbatim, expose a bounded common subset and record the
  gap.
- **No lossless conversion in general.** Loss is a property of the format *pair*. The job is to make
  it explicit and keep unconverted data recoverable.
