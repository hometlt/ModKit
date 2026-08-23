# 3D rendering providers

Optional implementations of `common.render/scene-3d@1`:

- `modkitx.headless` is a deterministic CPU rasterizer for Node and worker hosts;
- `modkitx.browser-webgl` uses an `OffscreenCanvas` WebGL2 context in a browser worker.

The contract remains owned by `@modkitx-x3/sdk`; model codecs only publish decoded geometry.
The independent conformance oracle remains `extensions/_reference/software-renderer`.
