# Transfer notes: what came from where, and every divergence this seed resolved

This seed is a **transfer**, not a rewrite. Where two pre-seed sources disagreed, the rule was:
the authority is what the existing executable validator actually validates, because that validator
is the differential oracle the block-11 exit gate names. Every such decision is recorded here with
both sources, so the resolution can be re-argued instead of rediscovered.

## 1. Provenance of every transferred file

| In this repository                            | Transferred from                                          | Change                                    |
| --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| `specs/foundation/SPEC_UV_FOUNDATION.md`      | `docs/uv/multiverse/SPEC_UV_FOUNDATION.md`                 | line endings only                          |
| `specs/model/SPEC_UVM.md`                     | `docs/uv/multiverse/model/SPEC_UVM.md`                     | line endings; two links rewritten (§3)     |
| `specs/model/SPEC_UVM_EXTENSIONS.md`          | `docs/uv/multiverse/model/SPEC_UVM_EXTENSIONS.md`          | line endings only                          |
| `specs/model/SPEC_UVM_CONVERSION.md`          | `docs/uv/multiverse/model/SPEC_UVM_CONVERSION.md`          | line endings; three links rewritten (§3)   |
| `specs/model/schema/*.json` (12 files)        | `docs/uv/multiverse/model/schema/*.json`                   | line endings only; `$id`s untouched        |
| `specs/model/examples/siege_tank.uvm.gltf`    | `docs/uv/multiverse/model/examples/siege_tank.uvm.gltf`    | line endings only                          |
| the format registry and maturity matrix in `specs/README.md` | `docs/uv/multiverse/README.md` §1 and `docs/uv/multiverse/INDEX.md` "Format maturity (2026-08-17)" | merged into one table; the UVM row updated for material now in this repository |
| `specs/foundation/SPEC_UV_CANONICALIZATION.md` | `SPEC_UV_FOUNDATION.md` §3 + `modkitx/packages/world/src/canonical.ts` | new document; see §2 — it resolves a divergence, it does not invent a form |
| `specs/foundation/SPEC_UV_VERSIONING.md`      | `SPEC_UVM.md` §18 + `SPEC_UV_FOUNDATION.md` §2 and §6      | new document collecting existing rules; no rule changed |

Authored here, with no pre-seed original: `specs/semantic-scopes/**`, `specs/conformance/**`,
`specs/model/fixtures/**`, `specs/tools/**`. The semantic-scope registry is the deliverable slice
11C0 asks this seed to create; the fixtures and tools exist so the registry is executable rather
than declarative.

Deliberately **not** transferred yet, and why:

- UVW, UVD, UVS specifications, schemas and examples — block 22 moves the remaining format drafts
  and the engine proofs into this history. Slice 11C0 owns the UVM plane; pre-empting the world and
  definition planes here would also pre-empt the block-12 and block-18 decisions about their
  candidate scopes.
- Engine architecture, roadmaps, stage reports and proof artifacts — block 22, item 4.
- `UVM_CONVERSION_CORPUS_REPORT_2026-08-17.md` — a dated report, not a specification.

## 2. Divergence: two canonicalization rules, both real

**Sources.** `SPEC_UV_FOUNDATION.md` §3 requires RFC 8785 (JCS) for JSON that enters "a signature,
content digest, lock, deterministic cache key or network-compatibility root". The executable
validator computes its proof roots with a completely different form: a type-tagged encoding with
IEEE-754 bit patterns for numbers, defined in `modkitx/packages/world/src/canonical.ts` and used by
`modkitx/packages/assets/scripts/multiverse-validate.ts`.

**Decision.** Keep both, and say which applies where — they answer different questions and the plan
already separates the quantities that use them (§2.6: `artifactCanonicalDigest` versus
`projectionSemanticHash`). JCS canonicalizes *document bytes*; the typed form canonicalizes *value
graphs*, including projections that never were a document. Collapsing them would have changed every
existing proof root for no gain.

`SPEC_UV_CANONICALIZATION.md` states the split, `uv-canonical-form.v1.json` is its machine form, and
`conformance/canonical-form/vectors.json` pins the typed form as data — with a recorded differential
against the sealed implementation, so the two agree by evidence rather than assertion.

## 3. Divergence: the UVM draft is wider than the only executable UVM reader

**Sources.** `SPEC_UVM.md` §4.1 allows `profile` to be `core`, `full` or a game name, and §5 defines
two equal encodings (`.uvm.glb` and `.uvm.gltf` plus siblings). The only executable UVM reader —
`modkitX3/extensions/common/models/src/formats/uvm/codec.js` — accepts GLB only, requires
`profile: "core"`, requires `UV_asset` and `UV_provenance`, requires triangle primitives, and takes
a node transform from `node.matrix` while ignoring TRS.

**Decision.** The seed's *normative, vectored* conformance target for 1.0 is **UVM/core over GLB**.
The wider draft surface stays in `SPEC_UVM.md` as draft text with no vectors behind it, and the
maturity table says exactly that: schema `partial`, reader `core`. Naming the narrow profile as the
executable one is what lets the block-11 differential mean something; declaring the whole draft
"supported" would have been the dishonest option.

Consequences recorded in the `model-interchange-v1` descriptor rather than left implicit:

- the artifact id convention (`node-<i>`, `mesh-<i>`, `mesh-<i>-primitive-<j>`, `material-<i>`) is
  **normative**, because identity is hashed and two readers inventing their own ids would produce
  two different hashes for one model;
- `node.matrix` is used when present, otherwise identity. TRS composition is deliberately out of
  scope for 1.0: inventing a composition rule here would let two conforming readers disagree, and
  the rule belongs to the UV Projection ABI freeze;
- a primitive with no indices accessor contributes the implied sequence `0..vertexCount-1`.

## 4. Divergence: the worked example is not a canonical fixture

`siege_tank.uvm.gltf` declares `profile: "m3"` and references `buffers/geometry.bin`,
`buffers/animation.bin`, `buffers/source.bin` and seven texture images that do not exist — its own
`asset.copyright` says the URIs are placeholders.

**Decision.** Keep it, as what it is: an *extension-coverage* example showing eleven extensions in
one document. It cannot be opened by any UVM reader, so it is not a conformance fixture. Three new
canonical fixtures were authored for the executable path (`model/fixtures/`), each self-contained
with an embedded `data:` buffer, each packing to byte-stable GLB.

The pre-seed evidence matrix counted this example under "Fixtures". The seed's matrix separates the
two counts so the number stops implying an executable case.

## 5. Divergence: the schema inventory was one short

`INDEX.md` listed eleven UVM schemas; `model/schema/` contains twelve. `uvm.effects.schema.json`
existed on disk and was missing from the index table. All twelve are transferred and registered.

## 6. What the legacy validator actually validates

Worth stating plainly, because "the old validator passed" is otherwise read as more than it means.
`multiverse-validate.ts` compiles every `*.schema.json` under the material root and then validates:
the World-v0 proof artifact and receipt (including three recomputed roots), the spatial map and its
receipt, the presentation/resource/editor artifacts, the RTS protocol v3/v4/v5 fixtures with hostile
negatives, the stage 11–17 proofs, the UVW manifest and its sections — and, of UVM, exactly one
subtree: `siege_tank.uvm.gltf#/extensions/UV_asset`.

So the pre-seed executable coverage of UVM was one extension object. The seed's `uvm-core` suite
raises that to the profile markers, the packing rule, the GLB round-trip and eighteen schema
assertions, and the `model-interchange-v1` suite adds the semantic plane on top. The engine-proof
half of the legacy validator moves with block 22, together with the artifacts it validates.

## 7. Line endings

The pre-seed material had mixed CRLF and LF (`SPEC_UVM.md`: 1302 CRLF lines and 80 LF lines).
Everything here is LF, and `.gitattributes` disables git's end-of-line translation for the whole
repository. Consumers pin this material by digest; a checkout that rewrites line endings would break
every pinned digest on a different platform.

## 7.1. UVT: what the conversion-grade profile deliberately leaves open

The UVT stub named its own deferrals, and raising it to a conversion-grade profile closed some and
kept others. Kept, with the reason:

| Open item                       | Why it is not in the profile                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Palette-indexed source profile  | No reader, no writer, no fixture. A palette is a real conversion path and would need its own loss vocabulary. |
| Animated frame sequences        | They belong on the shared timeline contract of the UV Foundation, and nothing publishes one yet. |
| Per-product transcoding targets | A deployment decision. Pinning them in the interchange profile would make one runtime's GPU support part of the format. |
| 3D volume topology              | `pixelDepth` is fixed at 0 and the boundary is reserved rather than specified.  |
| The wider transfer-function set | The profile admits `linear` and `srgb`. The rest of the Khronos Data Format set is real, and admitting vocabulary before anything reads it is reservation wearing a specification's clothes. |

What the profile does close: the mandatory KTX2 mapping table, colour/transfer/alpha semantics with
the contradiction rules a schema cannot express, orientation as a required field, explicit
`levelCount`, cube squareness, sampler advice, and atlas regions that must lie inside their image.
Seven of those rules are executable vectors rather than prose.

**The first UVT materializer arrived in Modkit block 12 slice 12-1**, after the schema, the fixtures
and the validator, which is the order plan item 17 asks for. It covers one honest path — an
uncompressed 8-bit RGBA container written from a decoded raster region, one level, one face, no
array — and refuses a source whose colour space, alpha mode or orientation is `unknown` rather than
defaulting one. Everything it cannot carry is enumerated in its `MaterializationReceipt`.

Two things that materializer deliberately did **not** put in the profile. The source-pixel-format to
`vkFormat` table stays a converter's decision: the schema leaves `vkFormat` unrestricted, and pinning
a table here would make one runtime's decode path part of the format. And block-compressed
passthrough stays open, because no reader in Modkit publishes GPU blocks as blocks — the DDS codec
decodes to RGBA — so a passthrough would need a new live surface before it could need a profile.

`texture-interchange-v1` was registered as a **candidate** scope alongside it, so a UVT
`MaterializationReceipt` can name the scope it was taken under. Candidate rather than registered
because two of its four facets — sampler and atlas — have no live publisher at all: a decoded region
says nothing about how a runtime should bind it. Those two nulls are written down in the descriptor
rather than papered over, and they are what a second texture family would have to fill.

## 8. Open items inherited, not resolved here

| Item                      | State                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Schema `$id` publication  | `https://modkitx.org/uv*/…` and `https://multiverse.engine/spec/…` are unpublished draft identifiers. Not renamed here: renaming would invalidate the differential against the sealed validator, which resolves those exact ids. Hosting, permanence and redirects remain an owner decision before any release. |
| Legacy brand in identifiers | The `modkitx.org` schema host and the `MODKITX_*` incubating extension prefix carry the old brand while the UV names are deliberately vendor-neutral. Same reason for leaving them: they are load-bearing identifiers today. |
| Licensing                 | This repository carries no LICENSE, matching `modkitX3`. The UV README states these formats are designed so a third party can write a conforming implementation, which needs an explicit license before publication. Owner decision, not an agent decision. |
| UVI / UVY admission       | Reserved candidates. The gate needs SC2Layout plus a second independent UI family.            |
| Executable JSON Schema engine | The seed ships no dependencies, so `uv-conformance` runs the schema assertions only with an engine supplied via `--schemas`. `conformance/schema-assertions.json` records the assertions and the engine options, so a consumer that has an engine runs exactly the same check against its pinned snapshot. |

## 9. What slice 11C0 owed after the seed, and what closed it

The seed was the first half of the slice. The second half landed in `modkitX3` on 2026-08-25 and
closed all three items:

1. the executable UV Projection ABI in the MK3 SDK — projection request/plan, the optional facet
   sources beside the base model contract, the materialization request, and the three separate
   `ProjectionReceipt`, `MaterializationReceipt` and `NativeExportReceipt` types;
2. the post-open host-owned `ResourceSessionPort` with its own lease/revision lifecycle, which is
   what gave `uv.model/resource-closure@1` the live binding it was missing — recorded here as an
   amendment rather than a version bump, because a binding changes no hashed input (see the
   descriptor's own `amendments` list);
3. five optional versioned facet sources in the SDK, all at `publisher-candidate` maturity:
   resource refs, skeleton, animation, collision and materials. Sockets, LOD, variants and
   per-emitter effects are **reserved ids without contracts** — nothing publishes them, and §2.7
   does not admit a facet family with no publisher.

Still open, and named rather than implied: the model codecs that already compute these facts
publish them ad hoc in their inspect summaries and have not been migrated onto the contracts, which
is slice 11C1 / block 12 work; and the full conformance of the resource port is block 12 item 7.

Slice 11C1 then adds the UVM materializer/writer and raises the minimal UVT profile from stub to a
conversion-grade schema.
