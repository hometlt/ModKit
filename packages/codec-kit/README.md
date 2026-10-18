# `@modkit/codec-kit`

`model/granny` reads bounded Granny v6 LE32 self-describing files (stored/Oodle1 sections,
CRC, relocation/type/graph validation). Other pointer widths, Oodle0, mixed marshalling and
unknown members refuse. `compression/oodle1` is the old Granny codec, bounded for output
and accounted adaptive-model buffers; it is unrelated to modern Oodle services.
`sampleGrannyCurve` qualifies degree 0/1; degree 2/3 evaluation remains an explicitly sampled
approximation until native-engine curve agreement is established. See `NOTICE.granny.md`.
`audio` also exports `decodeMsAdpcmBlock` for WAVE tag 2, using declared coefficient pairs.

M1 adds explicit `legacy`, `crypto`, `compression`, and `texture` subpaths. The compatibility
boundaries and pending surfaces are documented in `adr/ADR-CODEC-001-legacy-kit.md` in the repository.
Build with `pnpm --filter @modkit/codec-kit build` before `pnpm --filter @modkit/codec-kit test`;
the permanent test command executes the compiled public modules and real compression/WASM fixtures.

## Pinned raw voxel kernel

`@modkit/codec-kit/model/voxel-kernel` exports `createPinnedVoxelKernel(trustedLimits?)`.
Construction captures limits without loading WASM. The frozen handle's `run(input, signal?)`
consumes one attempt, including a refused/failed attempt, and snapshots input before its first await.
Admitted input is triangle RGB or one already-baked REPEAT atlas; alpha refuses by default, with
explicit discard recorded as a loss. Output owns canonical opaque cells, the A1 grid-to-source
transform, counts, losses and cumulative explicit typed-buffer accounting. This is not a UVM/UVW
serializer, material baker, Minecraft exporter, native encoder or Host operation.

The pinned obj2voxel source, patches, compiler flags and licenses are recorded in
`native/obj2voxel/PROVENANCE.json`; runtime packs retain its primary LICENSE and fourteen notices.
Owned embedded bytes are checked with the existing SHA-256 owner before compilation. The trusted
adapter replaces only the private proof-notification import with a fixed no-op, leaving the official
runtime/stubs intact; no job callback, factory, path or URL is accepted. WASM linear memory has a
separate 128 MiB maximum: neither this nor the explicit-buffer budget bounds total heap/RSS.
Signals are cooperative at JS/boundary checks, not hard cancellation during synchronous WASM.
Worker termination, session capacity and public operations remain with the Host owner.

Both package build and root typecheck run `native/obj2voxel/copy-runtime.mjs` after TypeScript.
The helper byte-copies official `.mjs` and `.d.mts` into `dist/lib/obj2voxel`, verifying their hashes.
An explicitly invoked private `tsc -b` reference build does **not** run package hooks: invoke this
same helper from the private package before import or pack. TypeScript-only output is not a complete
runtime closure. Do not use `allowJs` to reprint the pinned glue or fetch/rebuild native code at runtime.
Source rebuilding uses a separately installed pinned SDK; network isolation and full independent
hash-pinning of that SDK/sysroot have not been established by the asset qualification.

Optional runtime helper for small, portable inspection codecs. It owns only format-neutral
probe/open/session plumbing and generic tree/transport adapters. Format parsing stays inside the
extension that owns that format.

Importing one codec loads this helper and that codec's files; it never imports a catalog, another
codec, or a format-specific library. Built-in materialization uses the isolated material-data
subpath below, whose bundle contains no codec/session plumbing or platform adapters.

## Minimal codec

```js
import { createInspectionCodec, createTreeDataSource } from '@modkit/codec-kit'

const definition = {
  id: 'org.example/codec-foo',
  format: { id: 'foo', label: 'Foo', mediaType: 'application/x-foo' },
  async detect(prefix) {
    const match = prefix[0] === 0x46 && prefix[1] === 0x4f && prefix[2] === 0x4f
    return { confidence: match ? 0.99 : 0.01, note: match ? 'foo-magic' : 'magic-mismatch' }
  },
  async inspect(bytes) {
    return {
      summary: { format: 'foo', bytes: bytes.byteLength },
      metadata: [{ id: 'foo', label: 'Foo', entries: [{ key: 'bytes', value: bytes.byteLength }] }],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'file',
          label: 'Foo',
          children: [],
        }),
      },
    }
  },
}

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
```

The manifest remains the public claim and is validated independently. The definition above owns
only executable detection/inspection. Adding a sibling format means adding one entrypoint and one
manifest; neither the family package index nor an existing codec changes.

## Inspection with related resources

Set `deferInspection: true` when inspection needs the host's post-open logical resources.
The kit returns a revision-pinned session first; its first descriptor, data-source, operation or
event request starts one shared inspection. The host binds resources before requesting that
descriptor. Concurrent consumers share initialization; disposal cancels it and releases a late
result, and cancelling one waiting consumer does not cancel the others.

`inspect(bytes, context)` then receives `context.logicalResources`, when supplied by the host:

```js
const discovered = await context.logicalResources?.discover(
  { role: 'sidecar', extension: '.anim' },
  context.signal,
)
```

Discovery accepts only a role and literal extension. The host registers the allowed pairs and
owns their roots, search prefixes and budgets. A missing context or policy produces a refusal;
the codec decides whether a base-only view remains meaningful and reports that decision.
Only a complete result supplies candidates. Resolve each candidate by its exact `logicalId`
through the same port, carrying its host-selected `scopes` when present; omitted scopes retain
the workspace dependency convention. Compare its revision with `expectedRevision`, and release
every successful lease in `finally`. The scopes select lookup locations inside the existing origin;
they cannot grant access to an unsupported location. `provenance(signal)` is asynchronous and
requires a live resource context.
The port conveys readable resources, not write targets or input binding identities.

For nested subjects, `openNestedSubject({ logicalRoots, resourceDiscovery, ... })` binds discovery
and resolution to the same retained container namespace. Each policy supplies `role`, `extension`,
explicit `{ rootId, logicalPrefix }` searches and bounded listing limits. Root order determines
precedence; the primary entry is excluded. A codec cannot expand these roots or choose filesystem
paths. Format-specific compatibility and mapping remain in the codec; operations on converted
UVM documents remain in scene.

## Material data

`createModelMaterialSource({ materials, budget })` validates and owns a deeply immutable
copy of the complete material facet. The optional budget limits depth, JSON value count and UTF-8
serialized bytes across all materials, including native layer metadata and shader parameters.
The format-neutral `snapshotModelMaterials` helper is also available from
`@modkit/codec-kit/model/materials` without importing codec/session plumbing. JSON object keys
are ordered deterministically; authored array order is preserved. Shader parameters remain data,
and logical resource identifiers confer no filesystem access.

`modelPrimitiveByteLength(primitive)` counts every owned vertex/index buffer and UV set, including
the separate compatibility UV0 field. The scene source and native batch projections share this
calculation so expansion budgets match the buffers the source subsequently owns.

## Animation data

`createModelAnimationSource({ clips, budget })` validates and owns a deeply immutable copy of the
complete animation facet. `snapshotModelAnimations` and `createModelAnimationSampler` are also
available from `@modkit/codec-kit/model/animation`. The budget bounds aggregate JSON depth, value
count and UTF-8 bytes, including every key value. Old descriptive channels remain valid data;
sampling requires explicit interpolation and finite, ordered `timeSeconds` keys of consistent width.

`createModelAnimationSampler(clip).sample(timeSeconds, signal)` returns owned channel values through
the existing shared step, linear and quaternion interpolation. Time is sequence-local; the caller
controls sequence looping. Concurrent channels retain their own optional positive wrap period.
The sampler does not invent missing target bindings, frame rates or interpolation modes.

## Skeleton and pose data

`createModelSkeletonSource({ bindings, budget })` owns the full skeleton projection, including
optional `nodeId`, authored `localPose` TRS and column-major `inverseBindMatrix`. The older native
`restMatrix` field remains descriptive; consumers must not interpret it as either of these fields.
`ModelPrimitive.hierarchyId` explicitly selects the hierarchy used by its four bone indices and weights.

`@modkit/codec-kit/model/skeleton` exports `snapshotModelSkeleton`, `createModelSkeletonNodes` and
`createModelPoseSampler({ bindings, hierarchyId, clip? })`. Nodes and pose evaluation require exact
node ids, complete acyclic parents and explicit local poses. Sparse indices and arbitrary storage
order are supported. `sample(timeSeconds)` computes local TRS, parent-chain world matrices and
world × inverse bind matrices with the existing shared math. Missing inverse bind matrices remain
absent. Returned values are owned immutable snapshots; the sampler retains compiled topology.

`@modkit/codec-kit/crypto/digest` exports the pinned portable `sha256Hex(Uint8Array)` helper.
It owns the bytes passed to WebCrypto and reports a structured error when `crypto.subtle` is
unavailable. `MK2-DIGEST-KERNELS.json` records the unchanged declaration and its frozen source.
Native blob storage and envelope semantics belong to UV; document history belongs to scene.

`@modkit/codec-kit/tree/json` exports `createJsonTreeSource(document, { budget, label?, write?, signal? })`.
It owns immutable JSON, describes children lazily and pages every object and array without dropping
fields. Node identities use escaped JSON Pointers after `json:`; facts include complete semantic paths,
scalar values and an optional common write route. Search is literal, case insensitive and sees full
scalar text; previews are bounded. The adapter does not mutate the document or decide where to save it.

`@modkit/codec-kit/model/sources` exposes the model scene, resource-reference, skeleton, animation,
collision, material and socket source factories as a portable entrypoint. Root imports re-export
the same functions for existing codecs. Snapshot validation, owned primitive copies, pagination
and cancellation retain their existing behavior. The entrypoint does not import the host.

`@modkit/codec-kit/projection` similarly exposes `createProjectionReceipt` and
`PROJECTION_RECEIPT_METADATA_ID` without host/session assembly. Descriptor conversion to a portable
receipt remains in the root adapter, where the codec source identity is available.

`editPlanFromBinding(input, bindingId, options)` prepares a plan for one explicitly selected
owned binding of a single/bundle subject. Capture it before asynchronous conversion or computing
replacement bytes. All bundle bindings become revision targets; companion/external bindings
remain read dependencies, and the helper refuses writes to them or ambiguous source aliases.
The host checks every target at prepare/commit/undo. Only actual writes contribute to the write
set and its achievable guarantee. These checks do not claim a serializable transaction with
external writers of the dependencies. `editPlanFromInput` retains its single-source contract.

`@modkit/codec-kit/editing` exports these plan helpers, `assetRevisionFromInput`, `replaceBytes`
and `EditPlanFromInputOptions` without host/session assembly. Existing root imports re-export
the same implementation. Format converters and portable operation preparation should use
this entrypoint; source ownership, grants and durable commit remain host responsibilities.

Inspection contexts expose the optional host-supplied `contracts` resolver from the contribution
context. This lets operations acquire common services without constructing an inventory or host.
They also forward `rasterResources`, when supplied by the host: operations can request a bounded
decoded image by logical resource requirement or owned embedded bytes. The host selects the image
codec under read-only authority and returns pixels, diagnostics and logical-resource provenance.
The port is available after the owning subject opens and expires with it; it grants no path access.
Operation handlers can call `reportDiagnostic` on their call context; the host returns owned,
bounded per-call diagnostics in `OperationResult`, including for PNG/other byte outputs. Inspection
sessions use `ResourceBudget.maxDiagnostics`; diagnostics after the handler has finished are ignored.
