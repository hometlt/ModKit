# `@modkit/uv`

The built-in universal-visual package owns Modkit's game-neutral materialization boundary. Game
and file-format extensions publish typed model and raster projections; this package turns the
supported projections into portable UVM and UVT artifacts and exposes the export-only writers that
commit those artifacts through the common writer seam.

## Supported today

- `src/model/` contains the deterministic UVM/core materializer, its service provider and writer.
- `src/texture/` contains the deterministic UVT/core materializer, its service provider and writer.
- `src/module.js` links both services and both writers as the built-in `modkit/uv` module.

The contribution and service identifiers intentionally remain unchanged so callers select the
same contracts as before the implementation moved out of `extensions/common/uv-materializer`.

The model projection accepts complete `materials` alongside scene geometry. Shader identifiers
and parameters round-trip through `UV_game_material`; native layer metadata round-trips through
the versioned `extras.modkit.material` envelope. The shared codec-kit material snapshot validates
and owns this data under one aggregate budget. Unused materials and authored composite-pass order
are retained. Undefined material references, duplicate identities and inconsistent counts fail
materialization. Export does not resolve logical texture paths or assert renderer equivalence.

The existing `model-interchange-v1` hash scope remains unchanged. Material parameters have separate
materialize/validate/reopen assertions; that scope hash alone does not prove their preservation.

Optional `skeleton` and `animations` arrays extend the same projection API. Skin export requires
explicit scene-node joins, local poses, inverse bind matrices and four unit-sum weights per vertex.
Sparse native bone indices become ordered glTF skin slots. Independent roots receive an identity
grouping node, with a receipt entry; no bone, bind matrix or motion is fabricated. Normals and tangent
directions are normalized for glTF with value-difference receipts. Empty material/mesh arrays are
omitted, including for animation-only artifacts.

STEP and LINEAR TRS channels use the pinned MK2 UVM writer kernels; quaternion LINEAR corresponds
to the facet's `spherical-linear` interpolation. Sequence duration, looping and independent track
wrap metadata survive. Unsupported channels and float32 rounding are reported. Native identifiers,
frame numbering, provenance, movement speed and other unbound metadata are not promised to round-trip.
Missing bind matrices, non-unit skin weights and conflicting mesh skin instances are explicit
refusals. The six zero-weight vertices in the pinned M3 portrait corpus remain an open export case.

The common models extension reads these standard skins and TRS channels back into the existing
model skeleton and animation facets. Cubic, morph and effect animation channels are counted as
unsupported by that reader; this is not a claim of complete UVM or rendered-image parity. The
`model-interchange-v1` scope has not been extended to hash the new facets.

`MK2-RIG-KERNELS.json` records source and declaration hashes for fifteen unchanged writer declarations.
`scripts/migration/extract-pinned-symbols.mjs --config packages/uv/model-rig-kernels.config.json --check`
(run from the core repository) verifies them against the immutable MK2 commit. The migration tests
also prove that modification is rejected. Format-specific binary writing stays here; reusable pose,
animation and bounded snapshot helpers remain in codec-kit.

## Complete UVM containers and native data

`@modkit/uv/model/container` provides bounded `readUvmContainer` and `writeUvmContainer` for the
entire JSON/BIN document, retaining unknown extras/extensions and opaque GLB chunks. The original
MK3 `packUvmGlb` now lives in this module; the materializer re-exports the same function.
`MK2-CONTAINER-KERNELS.json` records the unchanged MK2 reader declarations behind the adapter.

`@modkit/uv/model/accessor` owns bounded decoding of embedded accessors into independent scalar
buffers. It checks offset/stride arithmetic and the complete bufferView range before allocating;
32-bit index values retain their integer precision. Normalization is reported to the semantic
consumer. `uvmAccessorWidth` exposes the supported accessor shapes to validators. External buffers
and sparse accessors remain explicit unsupported cases. Geometry/rig projection now belongs to
`@modkit/scene/uvm/model`, used by the common UVM codec; this reader performs no native interpretation
or external resource lookup.

`@modkit/uv/model/validation` exports
`validateUvmDocument(document, { binaryByteLength?, signal? }?)`. It validates UVM/core identity,
declarations and supported material, team-color, socket, collision, effects and animation-pointer
metadata. Providing `binaryByteLength` validates the actual BIN chunk size;
omit it only for a JSON-only probe. Source blobs are rejected: native information belongs in
common facets or a bounded format residual.
Unknown extras/extensions remain inert, including scalar or array extras. Animation pointers
must resolve to supported finite scalar/vector targets, use valid JSON Pointer escapes and avoid
protected buffer/accessor storage paths.

Validation accepts an already bounded JSON document from the container or document session.
It does not decode accessor geometry or prove every glTF/extension rule. Shared scene model and
facet readers perform their additional semantic checks. The ordinary common UVM codec uses this
validator both when opening input and preparing an edit; no extension-local validator copy remains.

`@modkit/uv/model/format-residual` stores bounded format-owned reconstruction facts under an extras
key (for example `BlizzardM3` or `WarzonePIE`). It refuses generic binary payloads. Native encoders
regenerate their output from common UVM structures plus this residual.

`materializeUvmCore` also returns `bindings.nodes`, `bindings.meshes` and `bindings.materials`:
source identifiers mapped to the actual emitted indices. Native importers retain these mappings
beside format metadata, rather than reconstructing the materializer's ordering. These maps do not
change serialized UVM bytes or constitute a native edit mapper.

## UVW boundary

`src/world/` reserves the package boundary for UVW. It deliberately exports no materializer,
writer, contribution or guessed data model yet. UVW becomes supported only when its canonical
profile, implementation and conformance vectors move together.

The canonicalization rules and conformance vectors remain in `multiverse/specs`, pinned under
`vendor/multiverse-specs/`; this package implements the confirmed profiles rather than restating
them.

`@modkit/uv/model/accessor-write` exports `appendUvmAccessors(container, inputs, budget?, signal?)`.
Inputs carry Float32Array/Uint16Array/Uint32Array values and SCALAR/VEC2/VEC3/VEC4/MAT4 type,
with an optional glTF buffer target. The operation reuses the frozen accessor/BIN writer, appends
aligned storage without changing any previous offsets/indices/bytes, and returns owned data plus
the new accessor indices. The working budget includes source/output BIN and temporary scalar
chunks; JSON/container budgets and cancellation also apply. Semantic callers attach these indices
to their document (for example collision shapes); this operation performs no durable write.

MK3 animation channels may carry `extras.uv.keyTimes: {version: 1, seconds: number[]}`.
This optional, format-neutral metadata preserves exact discrete timing across the glTF float32
accessor boundary. It is an MK3 convention, not a new official glTF extension. Seconds must be
finite, nonnegative and strictly increasing; count and float32 projection must match the input
accessor. The common scene reader charges the extra double values to its scalar budget. Changed
accessors require updated or removed metadata; stale values refuse. Ordinary glTF readers still
use the standard float32 approximation. `@modkit/uv/model/key-times` owns validation/encoding.
