# UVT — Universal Verse Texture

**Status:** conversion-grade profile with a first materializer, 2026-08-26 — schema, fixtures and
executable vectors exist, and Modkit block 12 slice 12-1 declares a UVT/core materializer for the
uncompressed 8-bit RGBA path (`common.uv/texture-materializer@1`)
**Extension:** `.uvt.ktx2` (+ `.uvt.json`) · **Physical base:** KTX 2.0 profile
**Media type:** standard `image/ktx2`; UVT conformance is metadata and validation, not a new MIME type
**Schema:** [`schema/uvt.profile.v1.schema.json`](schema/uvt.profile.v1.schema.json) ·
**Vectors:** [`../conformance/uvt/vectors.json`](../conformance/uvt/vectors.json)

**Role.** Normalized rendering/runtime texture projection: 2D and 3D images, arrays, cubemaps, mip
chains, GPU block formats, supercompression, colour/transfer/alpha/orientation semantics, atlas and
sprite metadata.

**Not a promise.** UVT is not a generic authoring-image format and not a lossless replacement for
PSD, TIFF, DDS or a game's own texture format. Authoring images stay native subjects; conversion
produces `native representation + normalized UVT projection + explicit loss report`.

**What "conversion-grade" means here, and what it does not.** This document plus its schema and
vectors are enough for two independent implementations to agree on what a conforming UVT projection
*is*. Plan item 17 required the schema before the operation, in that order, and this is the schema;
the operation followed it in block 12 slice 12-1.

**What the first materializer covers, and what it does not.** It writes an uncompressed 8-bit RGBA
container from one decoded raster region: `vkFormat` is `VK_FORMAT_R8G8B8A8_SRGB` or `_UNORM`, one
level, one face, no array, no supercompression. Mip chains, arrays, cubemaps, block-compressed
passthrough and frame sequences are outside it, and a source that carries them records the
difference in its `MaterializationReceipt` rather than losing it quietly. Which Vulkan format a
converter picks for a given source is a converter's decision: this profile leaves `vkFormat`
unrestricted on purpose, because pinning a table here would make one runtime's decode path part of
the format.

## 1. The mapping is mandatory, not advisory

A UVT projection is **a KTX 2.0 container plus a sidecar** that states, in machine-checkable form,
what that container holds. The sidecar never contradicts the container: every field in its `ktx2`
block is a copy of a value that exists in the file, and a consumer that finds them disagreeing has
found a defect rather than a preference.

That rule is what makes the sidecar worth having. Without it the sidecar would be a second, weaker
description of the same bytes; with it the sidecar is an index a runtime can read without decoding
the container, and any drift between the two is detectable.

| Sidecar field                     | KTX 2.0 source                                              |
| --------------------------------- | ------------------------------------------------------------ |
| `ktx2.vkFormat`                   | header `vkFormat`                                              |
| `ktx2.pixelWidth/Height/Depth`    | header `pixelWidth`, `pixelHeight`, `pixelDepth`               |
| `ktx2.layerCount`                 | header `layerCount` (0 in the file means "not an array")       |
| `ktx2.faceCount`                  | header `faceCount` (1, or 6 for a cubemap)                     |
| `ktx2.levelCount`                 | header `levelCount`                                            |
| `ktx2.supercompressionScheme`     | header `supercompressionScheme`                                |
| `color.transferFunction`          | Data Format Descriptor transfer function                       |
| `color.premultipliedAlpha`        | Data Format Descriptor alpha-premultiplied flag                |
| `orientation`                     | `KTXorientation` key/value entry                               |
| `swizzle`                         | `KTXswizzle` key/value entry, when present                     |

Anything not in that table is UV-level semantics the container has no place for — atlas regions, the
sampler a runtime should bind, the alpha *mode* as opposed to the premultiplied flag — and lives in
the sidecar alone.

## 2. Colour, transfer and alpha

- `color.transferFunction` is `linear` or `srgb`. Those are the two a runtime texture profile needs,
  and admitting the rest of the Khronos Data Format transfer set before anything reads them would be
  reserving vocabulary rather than specifying it (see [NOTES](../NOTES.md)).
- `color.primaries` is `bt709` or `unspecified`. A projection that does not know its primaries says
  so instead of asserting the common case.
- `alphaMode` is `opaque`, `straight` or `premultiplied`, and it is **not** a restatement of the
  container flag:
  - `opaque` — the format carries no alpha channel, or carries one that must be ignored;
  - `straight` — alpha is present and colour is not premultiplied;
  - `premultiplied` — alpha is present and colour is premultiplied, which **requires**
    `color.premultipliedAlpha` to be `true`.
  A `premultiplied` mode over a container whose flag is clear is a contradiction, and the vectors
  refuse it.

## 3. Orientation

`orientation` is `rd` or `ru` — `KTXorientation`'s S-then-T form, right-then-down or right-then-up.
A UVT projection **must** state it: "whichever way up the source happened to be" is the single most
common way a converted texture ends up mirrored, and a runtime cannot recover the answer from the
pixels.

3D images additionally carry the R axis; this profile admits 2D and array/cube topologies only, so
the two-character form is the whole vocabulary here.

## 4. Topology: mips, arrays, cubes

- `ktx2.levelCount` **must** be at least 1. KTX2 encodes "generate mips at load time" as 0, which is
  a loader instruction rather than a description of the file; a normalized runtime projection states
  what it contains.
- `ktx2.layerCount` is 0 for a plain image and ≥ 1 for an array. The sidecar copies the container
  value verbatim rather than normalizing 0 to 1, so the two never disagree.
- `ktx2.faceCount` is 1 or 6. A cubemap (`6`) **must** be square: `pixelWidth === pixelHeight`.
- `ktx2.pixelDepth` is 0 for 2D. This profile does not admit 3D volumes yet — the boundary is
  reserved, not specified.

## 5. Atlas and sprite metadata

An atlas is a UV-level fact: the container holds one image and the sidecar says what regions of it
mean something.

```json
{
  "atlas": {
    "regions": [
      { "id": "hull", "x": 0, "y": 0, "width": 128, "height": 128, "pivot": [0.5, 0.5] }
    ]
  }
}
```

Every region **must** lie inside `pixelWidth`/`pixelHeight`; a region that runs off the edge is
refused rather than clamped, because clamping silently produces a different sprite. Region ids are
unique within the projection. `pivot` is optional and in normalized region coordinates.

## 6. Sampler

`sampler` states how a runtime should bind the texture: `minFilter` and `magFilter`
(`nearest` | `linear`), `mipFilter` (`none` | `nearest` | `linear`) and `wrapS`/`wrapT`
(`repeat` | `clamp-to-edge` | `mirrored-repeat`). It is advice a projection carries, not a property
of the pixels: a consumer that binds something else is not non-conforming, but a projection that
omits the sampler forces every consumer to guess, so the profile requires it.

`mipFilter` other than `none` requires `ktx2.levelCount > 1`. Asking for mip filtering on a texture
with one level is a request the file cannot satisfy.

## 7. Supercompression

`ktx2.supercompressionScheme` is the container's own enumeration: `0` none, `1` BasisLZ, `2`
Zstandard, `3` ZLIB. UVT does not add a scheme and does not restrict the set — the transcoding
targets a product profile chooses are a deployment decision, and pinning them in the interchange
profile would make one runtime's GPU support part of the format.

## 8. Provenance and loss

Conversion to UVT follows the family rule: native representation, normalized projection, and an
explicit loss report. A texture converted from a palette-indexed source, a source with a colour
profile this profile cannot express, or a source whose mip chain was regenerated rather than carried
records that in its receipt. `lossless` is not a word this profile uses about a pair of formats.

## 9. What is deliberately still open

Palette-indexed source profiles, animated frame sequences on the shared timeline contract, the
per-product transcoding target sets, 3D volume topology and the wider Data Format transfer set. Each
is named in [NOTES](../NOTES.md) with the reason it is not here: none of them has a reader, a writer
or a fixture yet, and a profile that specifies what nothing implements is a reservation wearing a
specification's clothes.
