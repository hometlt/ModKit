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

The map-preview preparation provider discovers every exact `multiplay/maps/<id>/game.map` in a
complete bounded, extractable `warzone-wz` namespace. One map prepares directly, multiple maps
require an explicit opaque selection id, and incomplete or over-budget namespaces fail closed. The
prepared workspace mounts the selected map above `mp.wz` and `base.wz`; those two external roots
remain an opaque JSON resource request for the publisher-qualified host resolver. Its locator
records the same ordered settings, `MODKITX_WARZONE_ROOT` and automatic installation-discovery
policy without passing filesystem or archive capabilities through the extension ABI. The installed
4.7 `mp.wz` ratchet contains 619 effective entries and 39 map candidates, within the product limits
of 4,096 namespace entries and 64 candidates.

The semantic data provider reads the official JSON tables for droid templates, structures,
features, bodies, constructors, ECM, propulsion, sensors and weapons from ordered workspace roots.
It preserves every field observed in those Warzone 2100 4.7 tables, resolves map object ids through
the admitted component chains, and exposes bounded schema, definition and relation views. Other
stats tables, localization and JSON writing remain explicit remainder.

`./data-bindings` is an extension-owned JSON-safe bridge for resource binding that the current
common data ABI cannot yet express. Given ordered stats, map-object documents, an observed archive
index and optional observed PIE text, it links each placed object to typed component owners,
existing PIE paths and texture directives with explicit resolved, missing or ambiguous states. It
does no I/O, executes no JavaScript, does not infer runtime elevation, footprint or model-stage
selection, does not synthesize full runtime material semantics, and does not claim a portable UVD
artifact. The pinned installed 4.7
`2c-highground` fixture proves 177/177 objects, 637/637 PIE paths and 715/715 texture paths with no
missing or ambiguous bindings.

The minimum common-ABI follow-up is a bounded second planning pass after stats parsing (or an
equivalent host-supplied namespace index), followed by revision-pinned reads of only the selected
PIE documents and a standard JSON-safe resource-binding facet. Until that exists, the common
catalog keeps model ids as explicit logical missing targets and this bridge remains extension-owned.

The reader publishes decoded geometry, logical texture references and `ANIMOBJECT` tracks. It does
not infer animation from polygon texture animation flags or directive counts. PIE writing and 3DO
models are named remainders.

Preparation is not resource resolution: until a trusted desktop host adapter implements
`org.modkitx.opensource.warzone2100/map-preview-resources`, the prepared `base.wz` and `mp.wz`
locators remain unresolved. Web hosts intentionally have no installation resolver. The provider
does not claim that map preview rendering, runtime elevation, footprints, scripts, full material
semantics or portable UVD are complete.

Game-specific code remains inside this GPL-2.0-or-later extension for its planned extraction to the
independent `WZ2100Project/Warzone2100` extension repository; see `REFERENCES.md`.
