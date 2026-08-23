# Blizzard CASC codec

Product-owned read-only CASC namespace codec. It opens installed StarCraft II storage, exposes
bounded namespace paging and extracts entries without changing game files. Live acceptance uses
`MODKITX_SC2_ROOT` and reports a visible skip when no installation is available.

Historical conversion decisions remain in inert `MIGRATION-NOTES.json`.
