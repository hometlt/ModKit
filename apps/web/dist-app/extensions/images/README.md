# `common/images`

Image-family reference extension. PNG validates its signature/chunk graph; JPEG validates marker
segments and SOF dimensions. Each has an isolated entrypoint and exposes exact raster metadata
without pretending that the current MK3 ABI already owns decoded RGBA surfaces. A future pixel
contract can be added without changing this package boundary.
