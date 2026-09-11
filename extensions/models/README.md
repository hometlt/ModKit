# `common/models`

Model-family reference extension. OBJ reuses the proven MK2 rules for vertices, groups, materials
and polygon triangulation. glTF validates the 2.x JSON document and indexes scenes, nodes, meshes,
materials, textures and animations. UVM validates the Universal Verse core profile, decodes its
GLB accessors, publishes format-neutral scene primitives, and exposes `UV_game_socket` node
extensions through the generic `model-socket-source@1` facet with stable identity retained in the
extension's open `extras` object.

The UVM material facet restores shader parameters from `UV_game_material` and native layer metadata
from `extras.modkit.material` version 1. The common codec-kit constructor validates and snapshots
the complete facet under the codec budget. The metadata envelope cannot replace authoritative
material identity, name, shader or contract coverage; malformed envelopes are refused.

UVM scene nodes retain explicit matrices and compose local translation/rotation/scale through the
shared codec-kit pose math. Missing TRS components use glTF defaults. Invalid transforms and a matrix
combined with TRS are refused; they are never replaced with an identity transform. Local hierarchy
and transforms survive ordinary materialization and reopening. Standard skins expose explicit joint
slots, inverse bind matrices and scene-node joins through `model-skeleton-source@1`; primitives carry
the matching weights and hierarchy id. STEP/LINEAR TRS channels, sequence duration/looping and
independent clocks are available through `model-animation-source@1`. The neutral clip catalog also
exposes material-only and empty sequences; declared primitive visibility pointers execute through
the shared sampler. Cubic, morph and other pointer channels retain explicit playback limitations.
Non-joint ancestors with transforms or animation leave the skeletal parent
join unknown; static identity grouping nodes can be traversed without changing the pose.

Skin and animation accessor reads share the remaining scalar budget after geometry. Duplicate or
cyclic parents, invalid joint slots, matrix counts, key times and rotations are refused. Mesh instances
that require different skins cannot be collapsed into this mesh-level facet and are refused explicitly.
The corpus tests compare native M3 poses against materialized/reopened UVM poses; they do not yet
prove viewer pixels, full effect playback or complete native metadata preservation.

UVM container reading and serialization use `@modkit/uv/model/container`. The tree facet exposes
the complete document, including `extras.BlizzardM3`, with stable JSON Pointer identities and paged
children. Scalar fields carry the common `edit.field` route; `model.edit` accepts
`{ json: [{ op: 'add' | 'replace' | 'remove', path, value? }] }` for an atomic document batch.
Both operations prepare through `@modkit/scene/uvm`, validate the candidate with the codec's current
profile and scene validators, and return a revision-pinned edit plan. The host's existing coordinator
owns permission checks, fidelity evidence and durable writes. Untouched JSON, BIN bytes and opaque
GLB chunks are retained; JSON formatting may change. Files larger than a host's inline payload limit
are refused at commit until a staged-payload route is available.

The fidelity citation is limited to this UVM JSON edit route. It does not prove edited M3 export,
complete glTF extension validation, geometry/UV editing commands or native renderer parity.

Every format remains a separate contribution entrypoint. Loading UVM imports shared scene, UV and
codec-kit APIs; it does not load OBJ, glTF, or either format's parser. All three project
only current MK3 contracts, including `model-scene-source@1`, hierarchy and bounded bytes.

The convergence smoke opens the exact pinned UVM artifact produced from the synthetic StarCraft II
M3 corpus fixture. Its partial provenance is visible through the A-3 inspection operation, so the
A-2/A-3 route proves both renderable geometry and honest skeleton/animation/texture loss reporting.

The former `common-models` staging family is now merged here. DAE, PLY and STL keep their bounded
decoded-geometry implementations; its older GLB/glTF, OBJ and UVM routes were removed because the
native MK3 contributions in this package are richer and cover those formats without ambiguous
duplicate candidates. The inert `MIGRATION-NOTES-common-models.json` records that convergence.

UVM `model.render` (`render-uvm-scene`) delegates to `@modkit/scene/uvm/render` through the
host-provided capability resolver. It returns PNG bytes and bounded operation diagnostics. Its
request is `{schemaVersion:1, viewport:{width,height}, camera:{viewProjection:[16 numbers]},
sceneIndex?, clipId?, time?, collisions?, clearColor?, rendererId?}`. Scene/pose preparation and
provider lifecycle belong to scene. Complete PBR/game shaders, texture resource acquisition and
effect simulation remain open; their limitations accompany the image rather than being hidden.

`model.attach-animation` (`attach-uvm-animation`) prepares a revision-pinned edit plan from
`{source:{logicalId,expectedRevision,size?},binding:{id,clips,nodes?,materials?,primitives?,pointers?}}`.
`size`, when supplied, is a decimal byte-count string. The source is a complete embedded UVM GLB
resolved through the host logical-resource port. A clip mapping is
`{sourceId,id,sequenceIndex}`; node/material mappings identify explicit source and target indices,
and primitive mappings identify both mesh and primitive. No name matching is inferred here.
Scene owns composition and validation; the codec supplies a source-free format residual containing
only reconstruction data that common glTF/UVM fields cannot represent, plus the ordinary
operation route and the host owns commit authorization, evidence and storage. Material tracks and
empty sequences use the neutral clip catalog. Unsupported active channel playback remains visible
in the attachment receipt. This route does not establish an edited native M3 writer.
