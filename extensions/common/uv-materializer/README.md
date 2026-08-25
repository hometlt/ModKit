# `uv-materializer` — the one UVM writer

The single common UVM/core materializer in the tree, plus the export-only writer that commits its
bytes. Native model codecs and their live projectors do not import it: a codec that could also
write UVM would make one format have two owners.

- `src/materializer.js` — a drained faceted model projection to UVM/core 1.0 bytes, deterministic
  and byte-stable, with a `MaterializationReceipt` enumerating everything the profile could not
  carry. Dependency-free.
- `src/provider.js` — `common.uv/model-materializer@1`, the service that produces bytes and receipt.
- `src/writer.js` — `common.edit/writer@1` at `mutationMode: export-only`, the one durable-write
  route, which validates a `create` of a new artifact and refuses a `replace`.

The canonicalization, the scope and the conformance vectors live in `multiverse/specs`, pinned into
`vendor/multiverse-specs/`. This extension implements them; it does not restate them.
