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

The skeleton facet carries only the v1 contract's index/name bindings. Parent links and named flag
bits are validated as decode evidence, but the projection receipt still marks hierarchy, flags and
rest pose as lost because the live contract has no fields for them. Animation receipts keep SD
keyframes and unresolved STC ids visibly lost; the sequence list is not presented as a full
keyframe decode.

The synthetic triangle fixture and live SC2 installation corpus exercise this package. Historical
conversion decisions and the still-unimplemented writer/export planes are recorded in
`MIGRATION-NOTES.json`; they are not runtime manifests.
