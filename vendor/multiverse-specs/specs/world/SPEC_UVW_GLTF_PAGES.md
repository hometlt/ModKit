# UVW glTF exact scalar pages v1

Status: executable JSON glTF profile with external package-local buffers. The
inline `space-graph` profile remains unchanged and rejects buffers. This profile
uses `asset.extras.uv.profile = "space-graph-paged"`, the
[`uvw.gltf.pages.v1` schema](schema/uvw.gltf.pages.v1.schema.json), and logical
artifact domain `uvp/artifact/uvw-gltf-pages@1`. A strict `.uvw.glb` reader is
also executable through the shared GLB container owner; a Core product writer
is still outstanding.

The only paged fields in v1 are `heightfield.samples` (`f64-le`),
`navigation.samples` (`u32-le`), and `traversal.walkable` (`bool-lsb0`) and
`traversal.exits` (`u8`). Each field is either its existing inline grid or
`{count,pages:[{start,bufferView,descriptor}]}`. Pages are ordered, contiguous,
nonoverlapping and cover exactly `rows * columns` values. All but the final
page contain 1,048,576 scalars. Each descriptor is the complete
[`exact-page v1`](SPEC_UVW_EXACT_PAGES.md) descriptor. Other layers retain the
inline glTF subset. A document must use at least one paged field.

Every buffer is a package-local UVP media artifact. The compositor captures and
hashes its bytes under the existing 64 MiB/artifact, 256 MiB/composition and
4096 artifact limits. The page admission adds a 16 million decoded-scalar
budget. Every declared buffer, including unused buffers, contributes to the
logical artifact identity. Views start on an eight-byte boundary, use exact
descriptor lengths, belong to one page, and do not overlap. Gaps in used
buffers contain zero bytes. Scalar pages have no GPU target, stride, normalized
or sparse accessor semantics. Unavailable bytes refuse composition; they never
become zero, noData or blocked cells.

The logical digest is SHA-256 of UTF-8 JCS bytes for
`{schemaVersion:1,domain:"uvp/artifact/uvw-gltf-pages@1",value:parsedDocument,
buffers:[{index,byteLength,hash:rawSha256(bufferBytes)}...]}`. The compositor
computes it independently from the media witnesses, after loading all content
in a package, and compares it with the manifest hash. It then reconstructs a
private ordinary `space-graph` document and invokes the existing geometry and
material validator. Runtime receives that checked geometry with the paged
manifest identity; a save from the inline identity is rejected by restore.

For `.uvw.glb`, buffer 0 is embedded and omits `uri`; external JSON glTF
requires package-local URI for every buffer. The shared
`../tools/gltf-container.mjs` retains UVM's historical pack bytes and provides
canonical JCS packing and a strict UVW reader. The reader permits exactly one
JSON chunk followed by one BIN chunk, checks header length, UTF-8, canonical
JSON, zero BIN padding and declared buffer length, and refuses unknown or
duplicate chunks. The raw container checksum is recorded separately from the
logical artifact digest. GLB and external-buffer JSON with the same decoded
geometry can have distinct logical identities because their parsed documents
differ; neither can restore the other's save implicitly.

The reference page implementation is `../tools/uvw-gltf-pages.mjs`; its codec
is `../tools/uvw-exact-page.ts`. Node and real Chrome tests exercise both
containers through UVP composition and Rust/WASM, with equal routes/heights and
distinct save identities. Derived display meshes and a Core product writer
remain separate stages.
