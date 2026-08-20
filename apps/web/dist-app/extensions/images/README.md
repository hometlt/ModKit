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
