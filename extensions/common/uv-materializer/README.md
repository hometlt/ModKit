# `uv-materializer` — the one UVM writer, and now the one UVT writer

The single common UV materializers in the tree, plus the export-only writers that commit their
bytes. Native codecs and their live projectors do not import them: a codec that could also write
the portable format would make one format have two owners.

## UVM/core (block 11, slice 11C1)

- `src/materializer.js` — a drained faceted model projection to UVM/core 1.0 bytes, deterministic
  and byte-stable, with a `MaterializationReceipt` enumerating everything the profile could not
  carry. Independent socket facets bind generically to their projected nodes as standards-defined
  `UV_game_socket` extensions; there is no game- or codec-specific branch. Dependency-free.
- `src/provider.js` — `common.uv/model-materializer@1`, the service that produces bytes and receipt.
- `src/writer.js` — `common.edit/writer@1` at `mutationMode: export-only`, the one durable-write
  route, which validates a `create` of a new artifact and refuses a `replace`.

## UVT/core (block 12, slice 12-1)

ADR-UV-001 named UVT as the next member of the same family, and this is it: the same split of a
typed service for the content and the one writer seam for the durable write.

- `src/texture-materializer.js` — a decoded raster region to a KTX 2.0 container plus the
  `.uvt.json` sidecar the profile requires beside it, deterministic and byte-stable, with a
  `MaterializationReceipt`. Dependency-free.
- `src/texture-provider.js` — `common.uv/texture-materializer@1`.
- `src/texture-writer.js` — `common.edit/writer@1` at `mutationMode: export-only` and
  `roundTrip: lossy`, which also checks the two extensions the profile names.

**What the texture path covers, and what it does not.** One decoded rgba8 region becomes an
uncompressed 8-bit RGBA container: one level, one face, no array, no supercompression. That is the
path this repository can execute today — PNG (with an sRGB chunk), BMP and TGA all publish
`common.view/raster-image-source@1` with `decodedAccess: true`. A block-compressed passthrough is
not written, because no reader here publishes GPU blocks _as blocks_: the DDS codec decodes to
RGBA, so a passthrough would need a new live surface before it could need a materializer.

**What it refuses.** A source whose colour space, alpha mode or orientation is `unknown`. Each of
the three changes the meaning of every pixel, the profile admits no unknown sentinel, and
defaulting one silently produces a different picture. Everything the projection _could_ carry but
this materialization did not — mip levels, array layers, cube faces, frames — is a named loss and a
receipt entry rather than a quiet omission.

**Why `roundTrip: lossy` and not `semantic`.** A UVM artifact carries the model semantics of its
scope and a reopened document reproduces them. A UVT container carries the base level of an image
whose remaining levels were not written and whose pixels arrived already requantised to eight bits.
Declaring `semantic` would promise a round trip the path cannot make.

## Where the rules live

The canonicalization, the scopes (`model-interchange-v1` registered, `texture-interchange-v1`
candidate) and the conformance vectors live in `multiverse/specs`, pinned into
`vendor/multiverse-specs/`. This extension implements them; it does not restate them.
