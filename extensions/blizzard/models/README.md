# Blizzard model codecs

Product-owned Blizzard model formats for MK3. The `m3` codec decodes StarCraft II MD33/MD34
containers into bounded `common.view/model-scene-source@1` geometry, including positions, indices,
normals and texture coordinates when present. On Node it also follows `MODL.bones` into the BONE
table and resolves each name through that record's exact CHAR reference, publishing the result as
`common.view/model-skeleton-source@1`. The same Node path follows SEQS → STG → STC → STS and
publishes sequence names and counts of distinct SD timestamp samples through
`common.view/model-animation-source@1`. SEQS millisecond bounds validate those samples; they are
not reported as frame counts, and no frame rate is inferred. A channel gets a `bone/<index>` target
only when its STC animation id matches exactly one BONE translation, rotation or scale reference.

The Node decoder also follows `MODL.material_references` into MATM, resolves standard entries through
`MODL.materials_standard`, and publishes their stable identity and names through
`common.view/model-material-source@1`. Standard blend modes and flags are decoded as closed names;
each MAT_ layer slot follows its exact LAYR reference. A non-empty LAYR texture string is joined to
the already-published `model-resource-refs-source@1` id, so material decoding never creates a second
authority for asset paths. DIV_ → BAT_ binds an M3 region primitive to a material only when the
region and MATM reference are valid and unambiguous.

`MODL.attachment_points` now follows exact ATT_ v1 references and publishes stable attachment
identity, a portable `attach` role, the exact native source name and exact `bone/<index>` target
through `common.view/model-socket-source@1`; no role is guessed from that name. ATVL v0 records publish
stable volume identity and native kind through `model-collision-source@1`. Native attachment bone
targets remain decode evidence, while missing orientation axes, rest transforms and the ATVL
matrix/size/vertex payload stay named receipt losses.

Texture closure for the real installed `artifact1.m3` is resolved only through a host-owned
`ResourceSessionPort` over the dependency-composed SC2 workspace. The production UVM materializer
then reproduces the frozen `model-interchange-v1` projection exactly. The M3 scene facet does not
yet publish its bone hierarchy as scene nodes, so its exact `bone/<index>` socket targets are
excluded from that UVM artifact rather than overwritten with invented root children. The generic
materializer and reader support standards-defined `UV_game_socket` for projections that do carry
an exact scene-node join; there is no StarCraft II branch in either common component.

The skeleton facet carries only the v1 contract's index/name bindings. Parent links and named flag
bits are validated as decode evidence, but the projection receipt still marks hierarchy, flags and
rest pose as lost because the live contract has no fields for them. Animation receipts keep SD
keyframes and unresolved STC ids visibly lost; the sequence list is not presented as a full
keyframe decode.

The material facet's v1 ABI carries identity, name and optional contract tags, but no layer fields.
Layer-to-resource foreign keys and standard shader semantics therefore remain explicit receipt
evidence and a named `material-layer-facet-fields` remainder rather than a fabricated public shape.
Exotic M3 material types are counted and named but their renderer-specific parameters remain lost.

M3A remains caller-driven rather than automatically discovered by ordinary codec open. A bounded
host adapter now enumerates exact `.m3a` entries only inside caller-owned logical roots and explicit
subtrees. It completes the namespace search before publishing candidates, pins their revisions and
opens them only through `ResourceSessionPort`; truncated or over-budget discovery publishes no
partial candidate set. The codec releases every lease and still requires explicit hash intersection,
full skeleton compatibility and executable channels. The installed SC2 corpus pins the genuine
`sm_zeratul.m3` + `sm_zeratul_dialogue03.m3a` pair through the product CASC namespace. Searching the
explicit Protoss story-model subtree finds two M3As: `sm_zeratul_dialogue03.m3a` is admitted, while
`sm_zeratul_requiredanims.m3a` is rejected by the mandatory skeleton gate. The admitted sidecar is
1,382,592 bytes with SHA-256
`3549347c81c70f63c72d84ea441b21e6405c6b748001c33f84b8e04c6dba16ad`; it attaches as the
`Dialogue 03` companion clip with 1,684 timestamp samples and 402 executable channels. Opening that
M3A directly publishes its animation, 134-bone skeleton and 16 texture references without claiming
any companion or texture binding, while an unrelated shipped base is rejected by exact hash
compatibility. Selecting trustworthy logical search roots automatically during ordinary M3 open
remains a named remainder; neither the host nor codec derives ambient sibling paths from a base name.

The synthetic triangle fixture and live SC2 installation corpus exercise this package. Historical
conversion decisions and the still-unimplemented writer/export planes are recorded in
`MIGRATION-NOTES.json`; they are not runtime manifests.
