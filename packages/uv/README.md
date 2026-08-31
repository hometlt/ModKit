# `@modkitx-x3/uv`

The built-in universal-visual package owns Modkit's game-neutral materialization boundary. Game
and file-format extensions publish typed model and raster projections; this package turns the
supported projections into portable UVM and UVT artifacts and exposes the export-only writers that
commit those artifacts through the common writer seam.

## Supported today

- `src/model/` contains the deterministic UVM/core materializer, its service provider and writer.
- `src/texture/` contains the deterministic UVT/core materializer, its service provider and writer.
- `src/module.js` links both services and both writers as the built-in `org.modkitx/uv` module.

The contribution and service identifiers intentionally remain unchanged so callers select the
same contracts as before the implementation moved out of `extensions/common/uv-materializer`.

## UVW boundary

`src/world/` reserves the package boundary for UVW. It deliberately exports no materializer,
writer, contribution or guessed data model yet. UVW becomes supported only when its canonical
profile, implementation and conformance vectors move together.

The canonicalization rules and conformance vectors remain in `multiverse/specs`, pinned under
`vendor/multiverse-specs/`; this package implements the confirmed profiles rather than restating
them.
