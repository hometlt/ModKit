# Warzone 2100

Final MK3 owner for Warzone 2100 formats. The installation provider accepts ordered application
settings and `MODKITX_WARZONE_ROOT`, then checks bounded Windows Store AppModel records, uninstall
records, Steam manifests and conventional Windows, macOS and Linux locations. A candidate is
accepted only when `base.wz` exists in a supported content layout and starts with the ZIP `PK0304`
signature; `mp.wz` and `sequences.wz` are optional evidence. It never enumerates `WindowsApps` or
recursively scans a disk.

This slice also implements the PIE model reader. Maps, WZ containers and the other Warzone staging
routes remain outside this package until their own migration slices.

The reader publishes decoded geometry, logical texture references and `ANIMOBJECT` tracks. It does
not infer animation from polygon texture animation flags or directive counts. PIE writing and 3DO
models are named remainders.

Game-specific code remains inside this GPL-2.0-or-later extension for its planned extraction to the
independent `WZ2100Project/Warzone2100` extension repository; see `REFERENCES.md`.
