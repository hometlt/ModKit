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

The skeleton facet carries only the v1 contract's index/name bindings. Parent links and named flag
bits are validated as decode evidence, but the projection receipt still marks hierarchy, flags and
rest pose as lost because the live contract has no fields for them. Animation receipts keep SD
keyframes and unresolved STC ids visibly lost; the sequence list is not presented as a full
keyframe decode.

The material facet's v1 ABI carries identity, name and optional contract tags, but no layer fields.
Layer-to-resource foreign keys and standard shader semantics therefore remain explicit receipt
evidence and a named `material-layer-facet-fields` remainder rather than a fabricated public shape.
Exotic M3 material types are counted and named but their renderer-specific parameters remain lost.

The synthetic triangle fixture and live SC2 installation corpus exercise this package. Historical
conversion decisions and the still-unimplemented writer/export planes are recorded in
`MIGRATION-NOTES.json`; they are not runtime manifests.
