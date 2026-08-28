# Blizzard MPQ codec

Product-owned MPQ namespace codec with bounded listing and entry extraction. The live StarCraft II
acceptance opens an `.s2ma` extracted from CASC, lists its archive namespace and decodes an embedded
DDS image without modifying the installation.

The export-only writer can Save As one complete bounded loose namespace into a fresh, deterministic
MPQ v0. Every enumerated entry payload is stored byte-for-byte as an uncompressed, unencrypted
single unit and the writer generates a listfile plus classic encrypted hash/block tables. A second
bounded path accepts an existing MPQ v0/v1 and replaces uniquely named entries in their original
fixed slots while preserving the archive layout and every untouched byte. Stored and supported
zlib layouts are handled; insufficient slot space and changed encrypted, implode, patch,
sector-CRC or high-offset data fail before a destination write. Opaque attributes and signatures
are copied but explicitly reported as invalidated when content changes, and signing and in-place
mutation are not claimed. Both paths reopen their output through the product codec, use the host's
atomic Save As workflow, and support undo.

The named Blizzard signature policy is deliberately narrow: internal and external signature bytes
are preserved as opaque data byte-for-byte, while every modified archive receipt reports
`invalidated-by-modification`. Modkit never creates, repairs, or recomputes a Blizzard signature;
only an official Blizzard tool may produce a signature the product may describe as valid.

The snapshot helper accepts only portable ASCII relative paths (1,024 characters maximum), reserves
its generated `(listfile)`, enforces explicit entry and byte budgets, and requires the loose source
to expose a pinned revision plus `currentRevision`. The revision is checked before listing, after
every page, after listing, after every entry read, and again after all reads; a missing or changing
source fails closed with `org.modkitx.blizzard/mpq-source-snapshot-unstable` before any destination
change is planned.

Historical conversion decisions remain in inert `MIGRATION-NOTES.json`.
