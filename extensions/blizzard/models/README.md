# Blizzard model codecs

Product-owned Blizzard model formats for MK3. The `m3` codec decodes StarCraft II MD33/MD34
containers into bounded `common.view/model-scene-source@1` geometry, including positions, indices,
normals and texture coordinates when present.

The synthetic triangle fixture and live SC2 installation corpus exercise this package. Historical
conversion decisions and the still-unimplemented writer/export planes are recorded in
`MIGRATION-NOTES.json`; they are not runtime manifests.
