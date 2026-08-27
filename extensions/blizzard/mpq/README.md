# Blizzard MPQ codec

Product-owned MPQ namespace codec with bounded listing and entry extraction. The live StarCraft II
acceptance opens an `.s2ma` extracted from CASC, lists its archive namespace and decodes an embedded
DDS image without modifying the installation.

The separate export-only writer can Save As one complete bounded loose namespace into a fresh,
deterministic MPQ v0. Every enumerated entry payload is stored byte-for-byte as an uncompressed,
unencrypted single unit and the writer generates a listfile plus classic encrypted hash/block
tables. The new archive is reopened through the product codec before acceptance and the host's
standard editing backend can roll the destination create back. This is semantic container fidelity,
not a claim to preserve an existing MPQ's layout, compression, encryption, patch/high-offset
features, signature, or game-launch state. Native-MPQ input is refused before planning.

The snapshot helper accepts only portable ASCII relative paths (1,024 characters maximum), reserves
its generated `(listfile)`, enforces explicit entry and byte budgets, and requires the loose source
to expose a pinned revision plus `currentRevision`. The revision is checked before listing, after
every page, after listing, after every entry read, and again after all reads; a missing or changing
source fails closed with `org.modkitx.blizzard/mpq-source-snapshot-unstable` before any destination
change is planned.

Historical conversion decisions remain in inert `MIGRATION-NOTES.json`.
