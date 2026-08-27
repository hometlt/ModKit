# Warzone 2100

Final MK3 owner for Warzone 2100 formats. The installation provider accepts ordered application
settings and `MODKITX_WARZONE_ROOT`, then checks bounded Windows Store AppModel records, uninstall
records, Steam manifests and conventional Windows, macOS and Linux locations. A candidate is
accepted only when `base.wz` exists in a supported content layout and starts with the ZIP `PK0304`
signature; `mp.wz` and `sequences.wz` are optional evidence. It never enumerates `WindowsApps` or
recursively scans a disk.

This package also implements the PIE model reader, an exact `game.map` terrain provider with a
measured map-native to UVW candidate transform, and the final `.wz` container reader. The WZ reader
reuses the bounded common ZIP parser, extracts stored and Deflate entries, reads root
`ruleset.json`, and exposes the last physical entry for every repeated path. WZ container writing
and the other Warzone staging routes remain outside this package until their own migration slices.

The semantic data provider reads the official JSON tables for droid templates, structures and
features from ordered workspace roots. It preserves every field observed in Warzone 2100 4.7,
resolves map object ids to effective definitions, and exposes bounded schema, definition and
relation views. Other stats tables, localization and JSON writing remain explicit remainder.

The reader publishes decoded geometry, logical texture references and `ANIMOBJECT` tracks. It does
not infer animation from polygon texture animation flags or directive counts. PIE writing and 3DO
models are named remainders.

Game-specific code remains inside this GPL-2.0-or-later extension for its planned extraction to the
independent `WZ2100Project/Warzone2100` extension repository; see `REFERENCES.md`.
