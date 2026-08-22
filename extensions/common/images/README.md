# `common/images`

Image-family reference extension. PNG validates its signature/chunk graph; JPEG validates marker
segments and SOF dimensions. Each has an isolated entrypoint and exposes exact raster metadata
without pretending that the current MK3 ABI already owns decoded RGBA surfaces. A future pixel
contract can be added without changing this package boundary.

Editing (ADR-HOST-002). PNG `edit.field` sets a `tEXt` keyword; JPEG `edit.field` sets the COM
comment and `edit.structure` drops one metadata segment (COM/APPn only — a structural marker is
refused). Each returns an edit plan with a single byte-range replace: the codec never writes, the
host commits, and every byte the edit does not name stays identical. `writer-png.json` adds the
Path B side: a `common.edit/writer@1` provider (`png/rgba8`) that encodes an RGBA8 raster as a
PNG — `semantic` fidelity, because the pixels survive and ancillary chunks do not.

There is deliberately no `jpeg/rgba8` writer. JPEG pixel re-encoding is `lossy`, never
`semantic`; this repository currently has no bounded deterministic JPEG encoder or corpus-backed
fidelity evidence that could state its quality and chroma-subsampling trade-offs before save.
Consumers therefore get an unresolved writer request instead of a misleading pixel editor. The
existing JPEG comment/segment operations remain byte-identical because they never re-encode image
data. See ADR-HOST-002 decision 7.
