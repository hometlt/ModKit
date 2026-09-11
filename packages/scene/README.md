# `@modkit/scene`

Built-in, format-neutral scene facilities shared by the Modkit applications.

`@modkit/scene/model` owns portable scene assembly and sampled playback. It consumes a complete
model projection (including a reopened UVM document), joins explicit bone poses, applies the shared
MK2 CPU skinning kernel and returns geometry for the existing browser/headless renderer contract.
The UI uses this same path for complete models, primitive isolation, animation seek/play and bone
overlays. In-flight render calls are bounded to one and drained before releasing the renderer.

Scene processing has no runtime dependency on UI, host, GPU or a native model codec. Small math
and buffer kernels remain in codec-kit. Graph renderer types now belong to scene; UI re-exports
their previous public names for compatibility, avoiding a scene/UI dependency cycle.

Current limits: playback covers explicit whole-bone TRS, static instances and rigid descendants.
Transformed non-bone ancestors needing rebasing, non-bone animation targets, morph/cubic/effect
channels and incomplete skin bindings have diagnostics; this is not full material/effects parity.
CPU zero-weight vertices retain source positions, which differs from the frozen MK2 GPU shader.
Native `restMatrix` has no guessed matrix role. The full UVM document/operations and BlizzardM3
metadata import/export route is required by `DECISION_UVM_SCENE_OWNER_2026-09-07.md` and remains
in progress; the current projection API is the migration boundary, not a second native model owner.

The package owns the portable scene-renderer providers, deterministic headless rasterizer, PNG
output and the Three.js relation-graph backend. Game and format extensions remain responsible for
decoding their data into the neutral scene contract from `@modkit/sdk/renderer`.

Applications opt in by importing `sceneModule`; Extension Manager does not install or remove this
product module. The provider and contribution identifiers intentionally remain compatible with the
former `rendering-3d` extension.

Subpath exports keep optional runtime dependencies explicit:

- `@modkit/scene/render/browser`
- `@modkit/scene/model`
- `@modkit/scene/uvm`
- `@modkit/scene/uvm/model`
- `@modkit/scene/uvm/facets`
- `@modkit/scene/uvm/inspection`
- `@modkit/scene/uvm/normals`
- `@modkit/scene/relations/contracts`
- `@modkit/scene/render/headless`
- `@modkit/scene/output/png`
- `@modkit/scene/relations`

`@modkit/scene/uvm` exports `openUvmDocument(bytes, options?)`. The session retains the entire
glTF JSON, BIN and opaque GLB chunks. `apply({ expectedRevision, json, binary })` installs one
atomic batch of JSON Pointer add/replace/remove operations and fixed-size binary replacements.
Each candidate is bounded before installation; optional semantic validation can reject it.
The built-in checks validate the container and glTF version, not every UVM extension or mesh rule.

`snapshot()` returns immutable JSON and owned binary copies. `status()` reports revision,
undo/redo availability and retained bytes. `undo(revision)`, `redo(revision)` and
`serialize(revision)` reject stale revisions; revision numbers never rewind on undo. Unedited
input and undo to the initial state preserve exact source bytes, including JSON formatting.
History has entry and memory limits; eviction is explicit through `canUndo`. `dispose()` releases
the history. Serialization prepares bytes only: the host coordinator still owns durable writes.

With `resettable: true`, `reset(expectedRevision)` restores the exact initial bytes and clears both
history stacks. The initial state remains within `maxHistoryBytes`, counted once even when shared
with an undo entry. Reset keeps revisions monotonic; an unchanged reset does not advance them.
Reset is opt-in so ordinary editing retains its existing memory capacity.

`prepareUvmFieldWrite(bytes, request, options?)` accepts the common tree field contract
(`groupId: 'tree'`, full semantic `path`, matching `key`, and `value`).
`prepareUvmEditRequest(bytes, { json: edits, binary: [{ byteOffset, bytesHex }] }, options?)`
accepts one atomic JSON/BIN batch; either array may be omitted. Hexadecimal replacements are
nonempty, fixed-size, bounded and nonoverlapping. JSON accessor bounds and associated binary
positions can therefore change in the same validated candidate. `prepareUvmJsonEdits` is the
typed JSON-only convenience. All three prepare a bounded draft with this document
API and serialize through `@modkit/uv`. They perform no storage writes.

The common UVM codec exposes these as `edit.field` and `model.edit` edit-plan operations. The host
captures the source revision before draft preparation and uses its existing coordinator to commit.
These stateless operation adapters do not connect document undo/redo to persistent host history.
Typed geometry/UV commands, the common writer's mutation offer and native change mapping remain open.

`@modkit/scene/uvm/model` exports `readUvmModel(document, binary, { maxScalarBytes }, signal?)`.
After container/profile validation it projects embedded geometry, consecutive UV sets, colors,
tangents, skin bindings and STEP/LINEAR TRS clips into `{ scene, rig }`. Geometry and rig share the
scalar budget. `scene` can be passed to `createModelSceneSampler` with `skeleton: rig.bindings` and
an optional `rig.clips` entry. No intermediate file or extension runtime is needed.

The common UVM codec now calls this API; its previous geometry/rig reader has moved here as strict
TypeScript. Binary accessor reading belongs to `@modkit/uv/model/accessor`, and supported profile
and extension checks belong to `@modkit/uv/model/validation`. This extraction does not change the
limits on zero-weight glTF skin, cubic/morph/effect playback or differing per-instance skin bindings.
Static non-joint ancestors are supported when all roots of a skin share the same external frame.
Transformed groups between bones, animated external frames and differently framed skin roots
remain explicit limitations.

`@modkit/scene/uvm/facets` exports `readUvmFacets(document, binary, { maxScalarBytes }, signal?)`.
It reads validated UVM metadata into material references, socket identities/orientation and
collision descriptions, plus material/team-color/effects coverage summaries. Shader parameters
and stored material fields are retained; reserved identity fields cannot be shadowed by metadata.
The common codec uses this API too. It does not resolve textures or simulate/render effects;
unknown metadata remains in the full document rather than being interpreted as a model facet.

`@modkit/scene/uvm/inspection` exports `createUvmInspection(container, options)`. It performs the
shared profile/model/facet checks, creates owned model sources and the complete JSON tree, and
returns common inspection metadata, traits and a projection receipt. Options supply the publisher
adapter, subject revision, observed `bytesRead`, JSON/scalar budgets, optional cancellation and
optional `treeWrite`. Editing is opt-in; operation handlers and durable writes remain with the caller.

The common UVM codec now uses this facade. It has no runtime dependency on host, UI or a native
parser: the source factories and receipt builder use portable codec-kit entrypoints. The receipt
describes the provided UVM projection and retains declared provenance losses. A native importer
must also report the preceding native-to-UVM conversion; this facade does not prove native parity.
Product M3 opening continues to use transitional native facets until its UVM route has equivalent
evidence. It can now adopt this shared inspection path without importing another codec.

`@modkit/scene/uvm/frame` exports `rebaseUvmScene(container, matrix, budget?, signal?)`.

`@modkit/scene/uvm/normals` exports `generateUvmVertexNormals(positions, indices, signal?)` for
deterministic area-weighted normals on common indexed triangle geometry. Format writers use it when
their target requires normals and the source UVM legitimately omits them.
It applies an invertible affine matrix through one standard glTF node above the default scene.
The document is bounded and owned; original BIN, local vertices, inverse binds and animation
keys remain unchanged. The sampler applies the common external frame once to skinned output,
bone overlays and rigid descendants. A native importer supplies its declared axis/scale policy
and records that policy in UVM provenance; this generic operation infers no native conventions.

`@modkit/scene/model` also exports `preserveUnweightedVertices(projection, { maxBytes, maxNodes,
signal? })` for import preparation. A caller whose source CPU policy preserves exactly unweighted
vertices can represent that behavior with one generated identity joint per affected hierarchy.
The result contains the prepared projection and explicit generated-binding/vertex-count mappings.
Only replacement skin buffers are copied; unchanged fields are borrowed for synchronous
materialization. Budgets account for source buffers, replacement buffers and added nodes/bones.
The caller must retain the native data and record its chosen policy and generated mappings.

The default UVM materializer continues to reject zero weights. This opt-in preparation never
repairs invalid joint indices, normalizes nonzero weights, or substitutes missing native inverse
bind matrices. The common writer still validates the complete skeleton/scene. Directions follow
its existing unit-vector policy. M3 uses this preparation to preserve its MK2 CPU positions;
the different legacy GPU behavior (collapsing zero-weight vertices) is explicitly recorded.

`@modkit/scene/uvm/sockets` exports `addUvmSockets(container, inputs, budget?, signal?)`.
Each input supplies a stable socket `id`, an existing UVM `parent` node index and a `role`,
with optional `sourceName`, authored `orientation` axes and a local affine `transform`.
Absent transform means identity relative to the parent. Each socket gets its own empty node,
so multiple named attachments on one bone remain distinct. The result contains the owned
container and exact `{ id, node, parent }` bindings; an empty input borrows the unchanged source.
Serialization/profile validation remains in UV, and no native metadata is interpreted here.

Socket facets target the actual reopened `node-N`. Old publisher node ids are preserved in
extension extras but cannot replace that live join. `createModelSceneSampler().sample(time)`
now exposes `nodeTransforms`, an owned map of complete world matrices for all nodes. Geometry,
bones, sockets and other node-based features use the same evaluation. Changing a returned matrix
does not mutate later samples. The scene budget accounts for static and sampled node matrices.
Native attachment forward/up axes remain absent unless authored; UVM defaults do not prove a
native convention. Typed host/MCP/UI wiring and persistent history remain separate work.

`@modkit/scene/uvm/collisions` exports `addUvmCollisions(container, inputs, budget?, signal?)`.
Inputs contain `{ id, parent, role, shape }`; shape is the existing UV_game_collision JSON schema,
including accessor references into the same document. Each volume gets a distinct child node.
The operation returns owned data and `{ id, node, parent }` bindings. Durable writes use the host.

`@modkit/scene/uvm/collision-overlay` exports `createUvmCollisionOverlay(document,
binary, { maxScalarBytes, maxShapes?, maxHullVertices?, planeExtent? }, signal?)`. Its `sample(nodeTransforms)` returns
owned renderer primitives for all seven UV_game_collision kinds, following full scene worlds
and local shape matrices. Curves use fixed display tessellation; exact analytic parameters stay
in UVM. Budgets cover temporary geometry and owned output. Indexed meshes use their authored accessors. Convex hulls use bounded Three.js convex tessellation
(default at most 4096 input points). Infinite planes display a finite local square (default extent 2),
with an information diagnostic identifying that preview. The infinite plane definition remains intact. This is visualization, not a
physics simulation, and does not infer a source format from metadata or names.

`@modkit/scene/uvm/render` provides `renderUvm(bytes, request, {contracts, budget, textures?, rasterResources?, modelResources?, signal?})`
and `renderUvmPng` over `common.render/scene-3d`. The JSON request is
`{schemaVersion:1, viewport:{width,height}, camera:{viewProjection:[16 column-major numbers], viewMatrix?},
sceneIndex?, modelState?, clipId?, time?, materialContext?:{teamColor?,ambient?}, collisions?, shadows?, clearColor?, rendererId?}`. Scene selection follows the
document's default scene unless explicitly selected. Geometry outside that scene is excluded;
joint worlds still use the complete hierarchy. Collision overlays use the same visible nodes.
The helper reads UVM, samples pose, prepares owned renderer inputs and releases the selected
provider after each frame. PNG output uses the existing portable encoder.

The camera may instead be selected with `{node:<glTF camera node index>}`. Explicit matrix and
node selection are mutually exclusive. `poseSamples:[{clipId,time,weight,additive?}]` blends TRS
through shared pose math; the primary clip still owns material, effect and visibility tracks.
Ordinary animated nodes do not require a skin, and matrix intermediary nodes retain their frames.
`UV_node_billboard` constraints and `UV_scene_lights` are common scene data, not native extras.
Billboard schema 1 retains the inverse-camera bone rule with ordered basis rotations. Schema 2
defines a rigid position-facing node: local `+Y` faces `camera.eyePosition`, `rotationAxes`
selects cylindrical `z` or spherical `xz` motion, and `pivot` is a local three-vector.
The sampler applies the same adjusted world transform to the node's mesh and descendants.

`modelResources.acquire` leases an owned child UVM and scoped raster/model access. Scene prepares
each particle instance at its age, composes its world transform and color, and renders the combined
scene once. Acquisitions are deduplicated per path per frame, bounded in bytes/count/depth and
released on success, cancellation or failure. No native parser is selected inside scene. The host
checks the published read-only `model.export-uvm` operation and detects resource cycles; a missing
child produces a diagnostic while retaining the pinned ordinary quad. Materials can carry an
instance `context`; primitive `tint` multiplies the shaded color while retaining authored blend/depth policy.

`UV_game_model_states` schema 1 stores portable `{state, model}` references. Passing `modelState`
loads that variant through the same scoped `modelResources` port and replaces the base geometry;
`base` is the default and performs no acquisition. Unknown, refused or unavailable variants retain
the base scene and report `common.uvm/model-state-unrendered`. State resources are bounded and
released on success, cancellation and failure. Scene never dispatches a native codec directly.

`@modkit/scene/uvm/shadow-meshes` stores alternate shadow geometry as ordinary glTF triangle
meshes plus `UV_model_shadow_meshes` node bindings. `shadows:true` displays the selected scene's
proxy meshes with a translucent overlay for inspection and editing. This mode visualizes the exact
authored geometry; it does not claim to reproduce a game's stencil extrusion or shadow-map pass.

`@modkit/scene/uvm/ordered-euler-chains` declares a portable `UV_ordered_euler_chains` relation
between an ordinary translation node and its ordered X/Y/Z quaternion-node chain. Geometry and
scale remain on the final node. The relation carries no native angles or codec identity; target
writers use it only when their format needs ordered Euler reconstruction from common animation
channels. Each chain is hierarchy-checked, bounded and unique by its translation root.

Decoded textures may be supplied by the resource host as a map from UVM texture index to RGBA8.
Wrap modes come from the UVM sampler, overriding modes on supplied texels: absent modes repeat,
33071 clamps. Mirrored repeat refuses explicitly until the renderer contract supports it.
Explicit filtering produces a diagnostic: the current contract leaves filtering to the provider
(headless uses nearest neighbour; the browser provider uses linear filtering).
The base-color texture can select any supported TEXCOORD_0..4. Input UVM bytes, camera and texels
are captured before awaiting provider activation. Source lookup and image decoding do not live
in the renderer. Codec-kit inspection forwards `ContributionContext.contracts` and the optional
subject-bound `rasterResources` port.
`renderUvmPng` forwards frame diagnostics through the operation's `reportDiagnostic` callback.

With `rasterResources`, active base-color textures are acquired through the host's existing image
codecs. External image URIs become logical references in the opened subject's confined resource
origin; no URI is fetched by scene. Data URIs and BIN bufferViews are copied before the first await.
Images shared by several textures decode once per render, with sampler state applied per texture.
By default, the host returns a bounded copy of the first 2D surface (frame/mip/layer/face/slice zero), preserving
resource diagnostics and revision provenance. `RasterResourceRequest.selection` can select another
frame, mip, layer, face or depth slice. `face: 'all'` returns `decoded-surfaces` in canonical face
order from one codec lease, with one aggregate decoded-byte budget; omitted selection keeps the
existing `decoded` result. Out-of-range selections and incomplete reads never publish partial surfaces.
Scene normalizes row padding, bottom-left orientation
and premultiplied alpha. Unknown conventions refuse that image with a diagnostic.
The host holds and releases the source/codec/raster leases, checks read authority and shares the
concurrent decoded-byte reservation across the subject. Nested image codecs receive no recursive
raster-acquisition port. This capability crosses the ordinary worker ABI; Node worker tests compare
external DDS and embedded PNG output with independently supplied RGBA texels.

The base-color route draws glTF base color without PBR lighting. The separate game-material route is
described below. Further glTF material channels and effect simulation remain named
limitations with diagnostics. Image acquisition does not establish native shader
equivalence, mip/filter selection or support for image-source extensions. Camera fitting and complete UI/MCP/browser workflows remain separate
work; the public operation accepts an explicit camera matrix. M3 uses this route after native import
and passes its scale only to the converter; scene never reads BlizzardM3.

Both first-party renderers implement `SceneRendererMaterial.alphaMode`: `opaque` (default),
`mask` and `blend`, with optional nonnegative `alphaCutoff` (default 0.5). UVM maps the corresponding
glTF material fields directly. Opaque ignores factor/texture alpha; mask multiplies them and keeps
values equal to the threshold, discarding failed fragments before any depth write. Thresholds above
one discard the entire material, including values that would otherwise round down to one in a GPU
uniform. Blend draws after solid geometry, uses source-over and leaves solid depth unchanged.
Transparent primitives are sorted stably by the projected centers of their bounds, including model
transforms. Intersecting translucent surfaces require splitting or an order-independent renderer;
this sorting policy is not a guarantee of exact ordering for arbitrary intersections.

Frames use top-left straight RGBA8; both providers accumulate premultiplied color and normalize it
at readback, with zero RGB at zero alpha. CPU viewport coordinates and half-open triangle coverage
now match the WebGL convention, preventing double opacity on shared edges. Real WebGL tests cover
fourteen fixtures against independent pixel expectations and the CPU provider (RGBA8 tolerance 1).
Native game layer operations/team color, additive blend modes and full shader equivalence remain
separate from these base-color alpha rules. See the [glTF material schema](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/material.schema.json)
for the source semantics of OPAQUE/MASK/BLEND and alphaCutoff.

`@modkit/scene/materials` executes the `modkit.render-material.v1` vocabulary already stored in
`UV_game_material.params.renderModel`. `createRenderMaterialSampler(parameters, budget, signal?)`
owns and validates those parameters, lists logical texture resource ids, and samples every authored
standard/composite pass. `createStandardMaterialPrograms(parameters, {budget, signal?})` additionally
provides generated GLSL ES 3 vertex/fragment sources, immutable uniforms, texture bindings, draw-state
requirements, diagnostics and a CPU `shade(pixel)` function over the same codec-kit kernels.
It imports neither a native codec nor a host. `renderUvm` passes the shader vocabulary, sampled
material context and acquired texture bindings to the shared scene renderer. Unknown shader ids
and unresolved resources retain an explicit base-color fallback with diagnostics.

Call `sample({time, sequenceTime?, sequenceIndex?}, {teamColor?, ambient?, normalMapFormats?, textureDimensions?, environment?}, signal?)`
for a frame. `normalMapFormats` is an optional map from logical resource id to its bound normal
convention; it is captured per frame, and an authored `standard.normalMapFormat` takes precedence.
`textureDimensions` maps logical resource ids to `2d` or `cube`; it selects the sampler type and
participates in the shader cache key. Omitted entries keep the existing 2D image/atlas behavior.
`time` is elapsed playback time for independently looping concurrent tracks; `sequenceTime` is
clip-local time and defaults to `time`. Missing entries in a sparse sequence table retain the static
value. Step and linear tracks are supported; cubic and unresolved global-sequence timelines refuse
explicitly. Layer properties, all UV transform components, flipbook frames, parallax height and eight
normal-mask weights use the same playback path. Composite pass order and priority are retained;
the first pass has opacity one, following this shader vocabulary's existing render-model convention.
The source snapshot is deeply immutable, while each frame has fresh sampled values and uniforms.
Generated shader sources are cached by their canonical define key within that material sampler.

Programs cover nineteen standard layer slots, six channel modes, seven color operations, raw-alpha
team color, normal formats, environment/emissive masks, vertex color/alpha and alpha testing.
`shade` receives pre-sampled layer texels plus tangent/view-space lighting vectors. It does not
sample geometry, generate UV coordinates, filter images or blend passes into a framebuffer.
The scene geometry adapters supply explicit model/world/view positions and normals, inverse-transpose
normal matrices, tangent-space lighting, perspective interpolation and generated UV/parallax samples.
Missing normals and tangents are generated within a byte budget. CPU clips in homogeneous space;
WebGL uses the actual vertex/fragment pipeline. Both providers schedule composite passes, depth
prepasses, culling, source-over, additive, add-alpha and modulate modes using shared draw rules.

`standard.tangentGeneration: {texCoord: 0}` explicitly selects TEXCOORD_0 through TEXCOORD_4
when tangents are missing. Each composite pass can choose its own set. Authored tangents always
take precedence, including when only normals need generation or the requested set is absent.
Without the property, preparation retains the existing UV0/geometric fallback. With an explicit
choice and missing tangents, an absent selected UV set refuses; no other set is substituted.
UV determinants with absolute value at most 1e-9 use the geometric tangent fallback and emit
`common.scene/tangent-generation-degenerate-uv`, naming the primitive, set and affected triangle
count. Generation does not change the UV set sampled by a normal texture or infer a native
material hint. These renderer attributes are temporary and leave the UVM document unchanged.

Prepared geometry is shared by source primitive and generation choice within a frame; equal
composite/depth passes reuse it. Distinct choices are charged to the same preparation byte budget,
including temporary triangle indices while preparing each result. The internal scheduler accepts
an explicit byte limit and defaults to 256 MiB. Generation choices do not compile different GLSL.
Nearest 2D sampling uses explicit integer texel lookup on the GPU to avoid hardware subtexel rounding
at repeat boundaries; linear filtering remains native. Material programs default to linear on both
providers. Game resources are acquired once per logical id through the ordinary subject raster port,
including across workers; scene has no native texture loader or filesystem authority.

`renderModel.worldToMaterial` is an optional finite, invertible, affine column-major matrix.
It projects world positions and inverse-transpose world normals into the material's source frame
for generated world UVs. It does not move geometry or change lighting/camera coordinates.
`rebaseUvmScene` composes it as `oldWorldToMaterial * inverse(sceneRebase)` for world-projected
materials, preserving source texture placement when changing coordinate systems. Local UVs and
unknown shader vocabularies remain untouched. This is coordinate rebasing, not an object movement
operation; repeated rebases compose in the same order as the scene roots.

Raster image codecs report optional storage facts `channelLayout` and `compression`, with no
normal-map usage assigned. This material vocabulary applies the inherited binding convention:
RG/BC5 uses XY, BC3 uses alpha/green, luminance-alpha uses red/alpha, and other declared storage uses
RGB. Missing facts retain the legacy DXT5nm default. Each normal/detail layer can use a different
encoding. Reconstruction happens after nearest/linear texture sampling; RGB vectors keep their
authored length. Game material acquisition preserves raw RGBA data channels, including alpha used
by normals, masks or team colour. Ordinary glTF colour images still unpremultiply their colour.
These policies belong to scene and its material vocabulary, never to the M3 or image codecs.

Image acquisition requests `workspace-dependency-layer` as well as local container/directory
scopes. The host supplies the active context; scene never guesses game or mod roots. A material
image uses all six faces when its raster source declares a cube. `SceneRendererTexture.dimension`
is `cube` for six square RGBA8 faces packed in DDS/OpenGL order: +X, -X, +Y, -Y, +Z, -Z.
The default remains `2d`. Reflection (UV source 2) and normal-direction (source 7) sample the actual
cube in CPU and WebGL, with nearest or seamless linear filtering. Nearest chooses the canonical
face and integer texel in the shader, then samples its center to avoid hardware coordinate
quantization selecting a neighbouring texel. CPU corner filtering averages
the three incident corner texels; GPU implementations may differ at corners under the
[Khronos seamless cube specification](https://registry.khronos.org/OpenGL/extensions/ARB/ARB_seamless_cube_map.txt).
UV sources 2/7 with a 2D image retain the previous cube-atlas mapping. A cube bound to ordinary
2D base-color UVs is diagnosed rather than treated as its first face.

`materialContext.environment: {worldToEnvironment: [16 numbers]}` supplies an explicit finite affine
column-major scene-world-to-environment matrix. The direct material sampler accepts the same
`environment` frame. Each frame owns its input snapshot; matrix values change uniforms, not the
shader cache key. This path applies only to true-cube `envi`/`enviMask` bindings with source 2 or 7.
It uses the filtered base/detail normal transformed by the interpolated actual world tangent frame,
then normalized. `worldToMaterial` affects UV projection independently. Reflection source 2 requires
`camera.eyePosition` in scene-world coordinates; normal source 7 does not. The incident vector is
normalized per fragment. Both normal and incident vectors are transformed with `w = 1`, retaining
affine offsets and transformed lengths before reflection. Matrices that could overflow float32
reflection arithmetic are refused using a conservative affine row bound. A zero cube direction selects
+Z. The explicit observer does not change projection or lighting.

In this explicit path, emitter UV transforms, flipbook and parallax do not move the environment
cube direction. Normal-map UVs, including their parallax offset, still affect the sampled normal.
`sampleNormal(pixel, basis?)` exposes the vocabulary's base/detail normal stage before environment
texels are sampled. An omitted policy retains the existing sequential blend. Optional
`standard.normalBlendPolicy: {mode: 'signed-two-detail', secondMask: boolean}` selects a different
scene operation and requires both detail layers. It transforms the decoded base and detail normals
through the complete interpolated world tangent basis and normalizes each before blending. The
factor is the first RGBA mask/factor dot product, plus the second only when `secondMask` is true,
clamped to [-1, 1]. A negative factor selects detail 1, otherwise detail 2; its squared magnitude is
the blend weight. Base/detail normalization uses +Z for length at most 1e-8; the final blend uses
1e-6 so almost antipodal vectors do not amplify float32 rounding into an arbitrary direction.
Scaled dot products and vector lengths avoid overflow of intermediate squares/sums. An absent mask
uses [1, 0, 0, 0]. Disabling the second mask excludes it from active resources and sampling, while
retaining its authored payload. It does not disable the second detail normal.

This evaluated world normal drives both lighting and explicit cube environment lookup. Lighting
uses the inverse view matrix for the camera origin and orthographic direction, and evaluates the
perspective half vector per fragment. This policy requires an invertible float32 view transform.
`camera.eyePosition` remains the separate environment observer. Without a basis, `sampleNormal`
returns a tangent-space result. Direct `shade` callers can supply an already evaluated
`shadingNormal` in their lighting frame; this bypasses decoding and blending the normal layers.
Policy changes select shader variants; animated mask factors only update uniforms.

These are explicit UVM semantics. The M3 converter preserves the native layers and factors, but
does not infer the native normal-blending gates from layer presence or unknown flag bits. Their
mapping, as well as native environment matrix construction/defaults, still requires evidence.

Without an explicit environment frame, cube UV transforms, flipbook and parallax still produce
`common.scene/material-feature-unrendered` with the base-color fallback. Other cube slots retain
that conservative behavior even when a frame is supplied. Material images
with multiple layers, slices or frames still select zero and emit
`common.uvm/material-image-first-surface`. Material acquisition selects mip zero; source mip access
does not yet establish render-time mip selection. Successful DDS decoding does not establish full
native material fidelity.

Material frame tests cover spatial textures and both filters, plus clipping, perspective, composite,
depth and blend-state fixtures. They do not establish native M3 equivalence for arbitrary models.
Fresnel matrix transforms and particle UV still produce explicit diagnostics. Native M3 corpus
evidence for world-generated UVs, effects and full PBR remain open. The coordinate and channel
policies above do not establish native shader parity for every material or normal-map tangent basis.
Additive/modulate passes preserve destination alpha: emission over zero alpha cannot survive the
straight RGBA export convention. Such a transparent background produces a diagnostic; an opaque
background preserves the native blend result. Imported clip selection uses the explicit
`animations[].extras.uv.sourceSequenceIndex`, never a guessed native index from a clip name.

`@modkit/scene/materials/webgl` provides
`createWebGlMaterialProgram(gl, program, texturesByResourceId, {filter?,filters?})`. It compiles a leased
program, binds material uniforms and independent per-layer samplers, and keeps texture ownership
with the caller. Missing resources or a device sampler limit refuse before shader allocation; layers
are never silently dropped. `release()` is idempotent; binding a released program refuses. Geometry
attributes and camera uniforms belong to the caller. The generated fragment writes straight RGBA;
the scene framebuffer adapter must apply its declared coverage/blending convention.

UVM rendering carries `UV_provenance.warnings` and `UV_provenance.lost` into frame diagnostics
and the PNG operation result. Both textual entries and structured loss records remain visible;
structured records retain their information/error severity and complete JSON content. Native
vendor extras are not read. Invalid records or an import-note count above the caller's
`maxDiagnostics` budget refuse before renderer acquisition, so missing model features cannot
be hidden by returning an apparently complete image.

`@modkit/scene/uvm` exposes `composeUvmAnimationBundle` and `attachUvmAnimationBundle` for explicit
animation composition between embedded UVM containers. Clip ids, sequence indices, node targets,
material targets, primitive visibility targets and arbitrary pointer remaps are explicit inputs.
Composition copies mapped animation data into the destination and records its mapping and playback
limitations in `UV_game_animation_clips.attachments`; it does not retain the source container.
The document form captures its revision before asynchronous work and makes one validated
`document.replace`; undo/redo use the same
bounded history as JSON and binary edits. `prepareUvmAnimationAttachmentRequest` prepares serialized
bytes for a host edit plan. None of these APIs read paths or publisher-native metadata.
