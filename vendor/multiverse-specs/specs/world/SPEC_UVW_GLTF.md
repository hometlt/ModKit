# UVW glTF space-graph profile 1.0

Status: executable spatial/material subset with the M2d resource-inventory slice and verified image closure, 2026-09-29. This is an explicit opt-in
document form. It does not switch the Core world writer or retire `.uvw.json`.

Normative artifacts:
[schema](schema/uvw.gltf.v1.schema.json),
[spatial fixture](fixtures/uvw-gltf-spatial.uvw.gltf),
[material fixture](fixtures/uvw-gltf-materials.uvw.gltf),
[textured fixture](fixtures/uvw-gltf-textured.uvw.gltf),
[envelope checks](../tools/uvw-gltf.mjs),
[shared spatial verifier and migration](../tools/uvw-profile.mjs).
The [migration plan](../../design/PLAN_UVW_GLTF_MIGRATION_2026-09-28.md) describes
the remaining material, visual projection, binary storage and product work.
The [2026-09-29 architecture decision](../../design/ADR_RUNTIME_WORLD_CONTRACTS_2026-09-29.md)
settles the next resource/water/storage contracts. The standalone
[exact-page codec](SPEC_UVW_EXACT_PAGES.md) does not expand this inline
document's admission; pages use the separate
[`space-graph-paged` profile](SPEC_UVW_GLTF_PAGES.md).

## Document and ownership

The JSON document is glTF 2.0. Its marker is
`asset.extras.uv = {format:"UVW", version:"1.0", profile:"space-graph"}`.
The root `UV_world_graph` extension contains
`{schemaVersion:1, spaces:[...], connections:[]}`. It MUST be listed in both
`extensionsUsed` and `extensionsRequired`.

This subset has no visual fallback. A stock glTF viewer cannot display the
world by ignoring the required extension. This follows the
[glTF extension rules](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#specifying-extensions);
valid glTF packaging does not mean that every viewer implements UVW semantics.

Spaces retain the existing UVW IDs, labels, basis, bounds and spatial layers.
Their geometry and material blend/zone schemas are referenced from
`uvw.profile.v1.schema.json`, not copied into a second geometry definition.
Only the material catalog changes to references into the standard glTF table.
Space IDs are stable addresses, not glTF node indices.
The existing verifier owns grid dimensions, canonical ordering, spatial bounds,
`noDataValue`, directed traversal and its heightfield references.

Admission is limited to heightfield spaces with `heightfield`, `cliffs`, `objects`,
`regions`, `gateways`, `lighting`, `navigation`, `traversal`, `terrain-materials`,
`water` and `resources` layers. Every space needs at least
one heightfield. Connections remain empty. Native navigation flags remain opaque;
they never become portable traversal implicitly. Unknown profiles/versions,
new layer families, unmigrated legacy resource records, buffers, accessors, nodes and
mixed legacy/glTF root fields are refused by this subset.
Cliff levels and authored mask retain their exact grids; this does not derive a ramp mesh.
Placed objects retain their authored transforms, stable resource IDs and component
parent/socket links. Resource IDs resolve uniquely in the same space; model
components require a UVM resource and an acyclic parent graph. Socket existence
inside the UVM model is not proved by this world verifier. A composition that
retains UVM manifest identity therefore does not claim model byte or socket parity.
For a migration receipt with component attachments, both source and target
compositions must supply independently hash-verified `.uvm.glb` bytes. The shared
GLB container reader checks bounded chunk framing; the UVM/core reader checks
profile markers. Each `parentSocketId` must resolve uniquely to a node's
`UV_game_socket.id` (or the matching legacy `extras.modkit.id`) in its parent
component's UVM. The receipt
records the model hash and node index in `socketLinks`; a digest-only UVM or a
missing/duplicate stable socket refuses this stronger receipt. This proves
socket existence and immutable model identity, not animated pose, attachment
transform parity or native rendering.
Regions, gateway segments and lighting preserve exact authored JSON values.
Their rendering and native equivalence are not inferred from those records;
the migration receipt lists these layers as `preview` losses until measured.
A publisher MUST NOT filter unsupported layers to make
a complete world appear supported. Explicitly exporting a spatial slice of a
richer source needs its own declared scope and omissions receipt.

The graph is authoritative and exact at the existing JSON-number precision.
It does not pass through FLOAT32 accessors or through a generated display mesh.
Source units are retained. No glTF metre-space positions are invented for a
world with unknown source scale. Any future display projection is derived;
changes to that projection must not silently change simulation terrain.

## One material table

The optional root `materials` array uses the same
[`gltf.material.profile.schema.json`](../model/schema/gltf.material.profile.schema.json)
as UVM. This subset admits PBR, alpha, emissive and specular factors and all seven
standard texture slots through one root `textures`/`images`/`samplers` table set.
`KHR_materials_specular`, if used, MUST be declared in `extensionsUsed`; it
cannot be listed in `extensionsRequired` in this bounded profile. Other material
extensions are refused. Texture infos may use `KHR_texture_transform`, declared in
`extensionsUsed`. Only coordinate set zero is currently admitted; this does not
define a second UV set or establish native-game texture orientation. Unknown
extensions cannot hide a resource dependency.

A terrain catalog entry is `{id, material, classification?, sourceIndex?, atlas?}`;
a water entry is `{id, material, classification?, shorelineMode?}`.
`material` is a nonnegative index into the root table, not a persistent ID.
Display names live in `materials[index].name`. Color/PBR values MUST NOT also
appear in these world references. Multiple entries or spaces can refer to one
material without copying it. The whole table is covered by the artifact digest,
including currently unreferenced entries. Editing a material creates a new
world/composition identity even though Runtime ignores its visual values.

Terrain keeps exact JSON `samples`, including per-sample UV transforms under
the existing centre-pivot rule. A blend sample has nonempty, unique, ordered local
`materialId` weights in `(0,1]` summing to one within `1e-6`. Alternatively, a sample
uses the ordered atlas `layers` from SPEC_UVW_PROFILE §5; its `atlas` layout stays
on the terrain reference while base-colour pixels use the standard glTF texture.
Authored tile order/repetition is retained exactly, never sorted by material id.
`layers[].cornerAlpha`, sample `cornerUv`, and `atlas.tileTop` use the same
definitions and corner order from SPEC_UVW_PROFILE §5. Their arrays and authored
defaults remain exact JSON source data, covered by the composition digest.
The glTF schema references that one spatial schema; a reader must preserve
inactive sample transforms when corner UVs replace them. These fields neither
authorize gameplay movement nor prove matching native rendering.
Retained weights do not add a second rendered pass. The grid must match
its declared rows/columns and fit the space in x/z (spatial tolerance `1e-9`).
No renormalization or sample resizing occurs on read. Raster weights require
an explicit migration policy. The simple legacy migrator
still refuses per-material textures/`uvTransform` and resource layers. The explicit
preparer maps them with caller policies and preserves retained source fields;
its result alone is not proof of matching native pixels.

Legacy terrain `normalEncoding` and `specularEncoding` describe source image channels,
not texture addresses. The current standard glTF material projector refuses active
inverted/swizzled normal images and native gloss: a named texture binding alone does
not prove channel conversion or BRDF equivalence. Explicit ordinary RGB metadata remains
in the addressed retained source fields. These refusals preserve the source; they do not
silently replace the native convention with glTF defaults.

The opt-in raster path stores `weightAuthoring:"raster"` and one to sixteen
`weightRasters` instead of inline `samples` (up to 64 distinct material channels,
normalized together across the entire layer). Readers pinned to the earlier two-raster
limit must refuse larger layers; exporters must not truncate them to eight materials.
A mixed legacy source requires an
addressed `rasterPolicies[].inlinePreview` policy with
`role:"assert-equivalent-preview"` and `maxAbsError` in `[0,1/255]`; otherwise
migration refuses it. Structural preparation only records the source `samples`
pointer and selects raster authority. The migration receipt compares every
pure-weight inline grid sample with bilinearly sampled, verified raw raster
bytes after sum normalization, within that declared per-material tolerance.
Inline sample UV transforms or other fields are refused. The original inline
values remain in the verified source composition. This proves equality only at
the legacy grid points, not between them, and retains `preview` scope until
renderer/native parity is measured. Missing raster bytes or mismatched samples
refuse the receipt. An addressed `rasterPolicies` entry fixes
`material-grid-extent` coordinates, bilinear filtering, clamp-to-edge,
sum normalization and either `zeroSum:{mode:"refuse"}` or an explicit fallback
material ID. The raw `weight-rgba8` output is a package-local `media` artifact,
not a glTF image/texture or sRGB color. Width × height × 4 exact bytes are
required in the verified composition. All declared channel IDs resolve once in
the terrain catalog; rasters within one layer have equal dimensions.

For a point at `(x,z)`, set `u=(x-origin.x)/((columns-1)*cellSize)` and
`v=(z-origin.z)/((rows-1)*cellSize)`. Texel centres are `(i+0.5)/width` and
`(j+0.5)/height`; bilinear interpolation uses texel coordinates
`u*width-0.5`, `v*height-0.5`, clamping the four neighbours to the edge.
Decode each declared channel as `byte/255`, interpolate raw weights, then
divide each by the sum across all channels and rasters. Missing channels do
not denote materials. A zero sum at any texel refuses a `zeroSum:refuse`
composition (bilinear weights elsewhere are non-negative); `mode:material`
assigns full weight to its named catalog material when the sampled sum is zero.
This profile has preview fidelity until the common renderer and native import
tests prove matching raster sampling. The legacy profile's implicit first-channel
zero fallback is not silently carried into this explicit profile.

Water preserves exact zone extents and elevation; `shorelineMode` and
`classification` retain their existing world meaning. This does not introduce
fluid simulation or traversal rules. Zone IDs and catalog IDs are unique and
ordered; inverted zones are refused. A zone's `materialId` resolves in its
layer's catalog. Without a catalog, the legacy terrain fallback is admitted
only when the ID names exactly one terrain catalog entry in that space.
The opt-in `uv.water.surface@1` profile uses the same `UV_game_material`
extension as UVM. Its closed parameters retain dual world-space UV scale/scroll,
separate color and caustics falloff, ordered caustic frames, packed RG/BA wave
normals, source specularity and shadow choice. The glTF PBR material remains a
static fallback. This profile is currently admitted as `preview`: no renderer
parity or native water shader equivalence is claimed. Standard glTF specular
factors do not silently replace the native specular effect.

The existing schema boundary checks field types/ranges; `uvwGltfGraph` adds
table indices, extension declarations, blend dimensions/weights and world
material joins. Shared `assertGltfMaterialReferences` remains the owner of
glTF texture-slot references. Passing these checks does not prove rendering
or native-game material equivalence.

Exact scalar pages and external buffers use the distinct
[`space-graph-paged` profile](SPEC_UVW_GLTF_PAGES.md); this inline profile
continues to reject them. Both profiles feed the same spatial validator after
verified byte closure.

## Migration and references

`createUvwGltfDocument(source, {materialPolicies?})` accepts a schema-valid
legacy profile 1.0 and performs the existing spatial checks, then constructs
the glTF envelope. A policy is required for every source material:

```js
{ spaceId: "main", layerId: "paint", materialId: "grass",
  policy: { metallicFactor: 0, roughnessFactor: 1, alphaMode: "OPAQUE" } }
```

These factors are caller decisions, not inferred from absent source fields.
Water also requires `waterColorSpace: "linear" | "srgb"`; the common M1
projector converts RGB once, leaving straight alpha linear. Policies with
missing, duplicate or unused addresses fail. The operation does not deduplicate
materials by similar values: a publisher may deliberately share table indices
when that relationship is known. No conversion receipt or native shader
parity is implied by this helper.

For resource-bearing sources, `prepareUvwGltfMigration` requires `sourcePath`,
`targetPath` and one mapping per `(spaceId, layerId, resourceId)`. Every original
`media`/`uvm` record, including unused entries, becomes a `resources` layer row
with stable ID, original family/package path and zero or more output texture
usages. The original source URI and optional digest remain in the migration
inventory. One source can produce several images with distinct samplers and
usages. Legacy unqualified material resource IDs resolve only when unique in
their space; ambiguity refuses migration. Tables and inventory follow canonical
space/layer/resource and usage order, independent of mapping input order.

`verifyUvwGltfMigration(sourceReceipt, targetReceipt, options)` rebuilds the
target from the source document captured by two in-process UVP composition
receipts. It compares the exact target, original artifact family/hash and all
output media. Media originals require byte witnesses in both compositions;
UVM originals currently retain manifest identity only, reflected by receipt
scope `manifest-verified`. `media-verified` means original media and image
outputs passed byte closure; it does not claim native shader parity. The
identity-bound receipt uses `uv/uvw-gltf-migration@1`, distinct from the
UVW-to-native conversion receipt. It carries source/target artifact and
composition hashes, addressed policies, complete resource mappings and retained
source fields with JSON Pointers. Publisher I/O must stage outputs before
requesting these receipts and publish only after success.

For authored water with surface textures or effects, the material policy may
select `waterSurfaceProfile:"uv.water.surface@1"` and must select
`waterSurfaceBlend` when a base image exists. The shared material projector then
requires addressed texture usages, including `wave-normal-rg-ba-xy` and ordered
`caustics-linear-rgb` frames. With no secondary image, the `layer1` sample uses
the base texture again. Source `color` is still converted with the explicit
`waterColorSpace`; nonlinear source values remain in the receipt. The water
profile remains `preview` until the common renderer executes and validates it.

Whole-world migration MUST account for the projector's retained source fields.
The simple helper refuses non-ID/label retained fields (`uvw-gltf-material-retained`),
including the original color retained by an sRGB conversion. The explicit
preparer preserves such fields in an identity-bound receipt. Water effects
without executable glTF semantics become listed losses and force `preview`
scope even while their source values remain intact.
Linear water conversion without remaining fields keeps the existing behavior.

Unsupported source fields/layers fail without changing the source, even if
the M1 preview projector alone could retain those fields with a warning.
Source labels become glTF names; classification/sourceIndex/shorelineMode stay
on the world references. Omitted colors remain omitted; no defaults are written.

`restoreUvwProfileDocument(document)` rebuilds the legacy envelope only when
there are no material or resource tables. It explicitly refuses these documents because
legacy UVW cannot express all standard PBR/alpha semantics; it never drops them
to simulate a successful reverse conversion. Optional source `$comment` is retained in
`extras.sourceComment`. Round-trip equality is defined over canonical JSON
values for the spatial subset; preservation of source whitespace is not claimed.

`uvwDocumentGraph(document)` returns the original spatial records in either
admitted envelope, without cloning arrays or creating another geometry model.
`assertUvwProfile` and the world-instance linker use this common entry point.
The compositor still captures and freezes the exact document whose digest was
verified. Multiple instances share those immutable records; mutable blockers,
orders and entity state remain separate in Runtime State.

Schema validation and duplicate-key/Unicode parsing remain the format owner's
responsibility before producing the parsed witness. Envelope checks are not a
replacement for that boundary or for a full glTF validator.

## Identity and Runtime

Optional `players` and `startPositions` on `extensions.UV_world_graph.spaces[]`
use the shared spatial definitions and joins in SPEC_UVW_PROFILE.md. Their native
slots, portable player addresses, exact colours/ramps and local starts survive
migration and reconstruction. Captured player tables own Runtime identity setup;
slot numbers are not private handles. World instances qualify spaces while an
explicit repeated player address retains one global simulation identity.

`family` remains `uvw`. The recommended file name is `*.uvw.gltf`; identity and
admission are determined by the document, never guessed from its suffix.

The artifact digest is SHA-256 of UTF-8 JCS:

```text
{schemaVersion:1, domain:"uvp/artifact/uvw-gltf@1", value:gltfDocument}
```

The old `.uvw.json` domain remains `uvp/artifact/uvw@1`. Old fixtures, hashes,
receipts and saves are not repinned. Migration produces a different artifact
and composition identity. Restoring a legacy save into the migrated composition
is refused even when the spatial facts are equivalent; no save migration is
implied by the document migration.

The JSON artifact digest covers the document and its URI strings, not the image
bytes. The complete composition identity includes their UVP media entries and raw
SHA-256 hashes. Changing a resource therefore changes composition identity even
when the world JSON digest is unchanged. A document digest alone MUST NOT be
advertised as verified visual-content identity. External buffers/GLB still require
separate admission with an exact numeric encoding.

## Package-local image closure

Images have `{uri, mimeType, name?}`, with explicit `image/png` or `image/jpeg`.
This is a deliberately bounded subset of the [glTF image schema](https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/schema/image.schema.json).
Textures require an image `source` and may select a sampler; sampler enums/defaults
follow the [standard sampler schema](https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/schema/sampler.schema.json).
Each present resource table has 1..4096 rows. Buffer-view images, data/network/file
URIs, BasisU/WebP and image/texture/sampler extensions are not admitted yet.

The pure `uvwGltfImageReferences(document, documentPath)` resolves **every** image,
including unused rows, through `resolveUvpResourceUri`. URIs are relative to the
glTF document within its declaring UVP package. `worlds/main.gltf` with
`../media/a.png` names `media/a.png` in that same package. There is no implicit
dependency overlay, case folding or filename search. Indices and samplers are
checked even on unused textures.

Paths are exact case-sensitive logical paths. URI segments are percent-decoded
once; encoded spaces/Unicode are supported. Empty segments, controls, backslashes,
schemes, absolute paths, queries/fragments and encoded delimiters are refused.
Decoded dot/parent segments are resolved without ever leaving the package; a final
dot/parent segment cannot name an artifact. Literal percent signs in resolved paths
are excluded in this bounded profile to prevent a second decode. No filesystem or
network operation occurs in this resolver.

Before issuing a receipt, `composeVerifiedReceipt` requires a matching `media`
entry **and its Uint8Array byte witness** for every image. It snapshots those bytes,
independently hashes them and compares both the witness digest and manifest hash.
It also checks PNG/JPEG signatures against the declared MIME and requires every
original resource in a `resources` layer to exist in the declaring package.
Original media needs the same byte witness; UVM currently has manifest-hash
identity only. This bounded check is not image decoding or UVM validation.
Missing resources, digest-only claims, wrong-family entries, duplicate content
paths or conflicting MIME declarations for one media path refuse composition.
Legacy unrelated media entries may still use their existing owner digest; they
cannot satisfy an image reference or be exposed as verified bytes.

Verified media is nonempty, limited to 64 MiB per artifact, 256 MiB and 4096 artifacts
per composition. Shared references charge bytes once per package/path. Limits are
checked before compositor copies; providers retain their own read/decode budgets.
`verifiedCompositionMedia(receipt)` returns independent copies of captured bytes,
using the same in-process provenance boundary as UVB. Cancellation does not issue
a receipt. The trusted source provider still owns actual I/O; image decoding,
MIME/content validity and pixel equivalence remain responsibilities of the image
format owner and renderer. This byte-integrity check is not an image decoder.

Runtime preparers may provide `media: [{path, bytes}]` alongside their projected
definitions/world/scripts. The existing selected-subject composition and source
snapshot route carries them to this same verifier. No game-specific resource
loader or second media schema is introduced. Core's portable package writer now
emits PNG (Core `4a0bcdfc`, relay §12). Original TGA bytes still cannot be relabelled
PNG/JPEG; any required transcoding belongs to the existing texture owner.

The existing binder takes the verified spatial graph, applies its existing
decimal-to-Q32.32 lowering and emits the existing private binding. There is no
new Rust geometry structure, WASM ABI or second pathfinder. Tests compare
Node and Chrome composition/binding bytes, paths and heights; an elevation
`1 + 2^-32` must survive into Runtime as `(1 << 32) + 1`.

## Checks and next admission

Run `node --test specs/tools/uvw-gltf.test.mjs specs/tools/uvw-gltf-resources.test.mjs` and
`node --test runtime/test/uvw-gltf.test.mjs`. Set
`MULTIVERSE_TEST_REAL_BROWSER=1` and the normal browser executable setting for
the latter to also compose, bind and execute in Chrome. The foundation gate
enables that check. Schema cases and the pinned new digest are in the existing
conformance runner; register all its schema directories locally.

All three fixtures were independently checked with Khronos `gltf-validator`
`2.0.0-dev.3.10`: zero errors, zero warnings. The spatial fixture has one informational
`UNSUPPORTED_EXTENSION` for `UV_world_graph`; the material fixture also has three
`UNUSED_OBJECT` infos because the validator cannot inspect references in that
unknown extension. Our schema and cross-field checks
validate that extension; the Khronos result does not validate its semantics.
The textured fixture was validated with its actual synthetic 2x2 PNG (created
with the platform PNG encoder), also with zero errors/warnings and four infos.
Its fixed world digest is in the existing artifact vectors; the byte digest is
cross-checked against Node crypto in resource tests. The validator was used as
an external test oracle, not added as a Runtime dependency.

Remaining M2 work: complete resource-bearing legacy world migration, full water effects and
terrain weight rasters, preserving all other current layers;
provide a declared visual fallback and nodes/meshes with their resource closure; admit exact
binary pages and GLB separately. Core and game writers switch only after their
full-world preservation and product checks, not after this spatial fixture.

Object instances preserve `presentationTint`, `presentationAnimation` and
`presentationRotation` from the one shared spatial schema; see
[initial presentation](SPEC_UVW_PROFILE.md#initial-object-presentation-core-relay-0210).
The optional rotation is an absolute local visual override, not a multiplier of authored
`rotation`; both quaternions retain their exact values through migration and reconstruction.
These fields are not glTF node animation channels or new gameplay state.

Lattice annotations use the same referenced `objectInstance.latticeCoverage`
and `heightfield.cliffFaces` definitions as the spatial profile. See the
[14.10 lattice addendum](SPEC_UVW_PROFILE.md#publisher-proven-lattice-annotations-addendum-14102026).
They stay inside the parent's `UV_world_graph` space, retaining exact cell
indices, absolute horizontal polygons and declared source-game scope through
spatial-to-glTF-to-spatial conversion. Do not move them into glTF mesh geometry
or use model bounds to reconstruct them.
