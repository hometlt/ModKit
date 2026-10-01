# UVW exact scalar pages v1

Status: implemented storage primitive, 2026-09-29. Owner: Multiverse.
This specification does **not** admit buffers, pages or GLB into the original
`space-graph` document profile. The distinct
[`space-graph-paged` profile](SPEC_UVW_GLTF_PAGES.md) now admits exact pages in
JSON glTF with verified external buffers and strict GLB with embedded BIN under
[the architecture decision](../../design/ADR_RUNTIME_WORLD_CONTRACTS_2026-09-29.md).

The [descriptor schema](schema/uvw.exact-page.v1.schema.json) and
[strict TypeScript reference codec](../tools/uvw-exact-page.ts) define one
uncompressed, bounded, dense scalar page. They perform no I/O or hashing.
Consumers use the existing resource owner, compositor and geometry verifier.

## Numeric domain and ownership

The source is the existing parsed UVW JSON-number domain. Binary64 storage
preserves each finite value exactly; it does not introduce floating-point
arithmetic into the deterministic Rust State. The existing binder remains
the sole owner of decimal-to-Q32.32 lowering, rounding and range refusal.
An exactly preserved storage value can still be outside Runtime admission.
This profile does not recover precision already lost by a native publisher or
claim to retain a source decimal spelling, JSON whitespace or arbitrary real numbers.

The descriptor is exactly `{schemaVersion:1, encoding, count, byteLength}`.
`count` is 1..1048576. There is no stride, scale, compression, padding or
implicit default inside a page. Its encoding fixes the length:

| Encoding | Bytes | Meaning |
| --- | --- | --- |
| `f64-le` | `count * 8` | IEEE 754 binary64, little-endian, finite values only |
| `u32-le` | `count * 4` | Unsigned integer, little-endian, 0..4294967295 |
| `u8` | `count` | Unsigned integer, 0..255 |
| `bool-lsb0` | `ceil(count / 8)` | Value i is bit `(i % 8)` of byte `floor(i / 8)` |

The maximum encoded page is 8 MiB. Consumers must also bound aggregate pages,
decoded counts and working memory before reconstruction. A boolean page can
expand considerably into a JSON array; encoded length is not its memory budget.

Binary64 `NaN` and infinities are invalid. The writer canonicalizes signed zero
to positive zero, as the existing JCS identity does. A reader rejects negative
zero bytes instead of normalizing an alternative encoding during verification.
Unused high bits of the last boolean byte must be zero. Integer encoders reject
fractional/out-of-range values before writing; they never truncate or wrap them.

The reference decoder requires an exact Uint8Array view over an ordinary fixed
ArrayBuffer; it respects `byteOffset`, rejects shared/resizable buffers and returns
private scalar values. The compositor's existing immutable byte-witness capture
is still required before trusted consumption. A valid descriptor alone proves no bytes.

## Relation to geometry

Pages serialize existing fields; they do not define a second geometry model.
For a grid, flatten rows in order, then columns, with index `row * columns + column`.
The reconstruction owner verifies positive safe dimensions, exact total element
count, complete coverage and page ordering before allocation. It then invokes
the same spatial verifier that checks the corresponding inline JSON layer.

Height samples and authored scalar weights use `f64-le`; native uint32 flags
use `u32-le`; four-direction traversal masks use `u8`; passability uses `bool-lsb0`.
Encoding does not assign semantics to native flags. Directed masks remain directed.
Terrain `noDataValue` remains the declared finite sentinel, not NaN or missing bytes.
The sentinel is preserved in the samples. Unsupported `noData` in a particular
Runtime movement profile must continue to refuse there.

An unavailable page is not zero, air, blocked terrain or noData. Missing, nonresident,
unknown and out-of-world pages are distinct states in the enclosing world contract.
Coordinate basis, origin, dimensions and units remain in the layer, never inferred
from a page. Empty fields use the owning layer's explicit empty representation;
there is no zero-length page.

## glTF boundary and identity

This is a UVW extension payload, **not** a new standard accessor component type.
Standard glTF accessor types are defined by
[Khronos](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#accessor-data-types);
they do not provide binary64 components. The paged UVW profile references
exact payload bufferViews directly. Standard FLOAT accessors remain suitable for
the separately derived display mesh.

Page bytes will be verified through the existing package byte-witness mechanism;
do not add a competing checksum or trust a caller's digest. The enclosing descriptor
is covered by the document identity and the referenced bytes by verified closure.
Reconstructing a page into identical old JSON yields the old JSON hash in the storage
test. Replacing inline JSON with a new paged document is a migration and creates a
new artifact/composition identity; it does not authorize loading old saves.

## Executable checks

`node --test specs/tools/uvw-exact-page.test.mjs` checks independent byte vectors,
finite binary64 extremes/subnormals, signed zero, count/length limits, bad tail bits,
offset views, input isolation and a world reconstruction retaining noData and directed
traversal. The schema assertions run through the existing conformance runner.

`runtime/test/uvw-gltf.test.mjs`, with `MULTIVERSE_TEST_REAL_BROWSER=1`, independently
packs/decodes the heightfield in Chrome before the ordinary verified composition
and Rust/WASM path. Node and Chrome must produce equal page bytes, binding bytes,
heights, routes and State hash, including the height `1 + 2^-32`.
