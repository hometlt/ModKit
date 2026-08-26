# Blizzard model codecs

Product-owned Blizzard model formats for MK3. The `m3` codec decodes StarCraft II MD33/MD34
containers into bounded `common.view/model-scene-source@1` geometry, including positions, indices,
normals and texture coordinates when present. On Node it also follows `MODL.bones` into the BONE
table and resolves each name through that record's exact CHAR reference, publishing the result as
`common.view/model-skeleton-source@1`.

The skeleton facet carries only the v1 contract's index/name bindings. Parent links and named flag
bits are validated as decode evidence, but the projection receipt still marks hierarchy, flags and
rest pose as lost because the live contract has no fields for them and IREF/STC are not decoded.

The synthetic triangle fixture and live SC2 installation corpus exercise this package. Historical
conversion decisions and the still-unimplemented writer/export planes are recorded in
`MIGRATION-NOTES.json`; they are not runtime manifests.
