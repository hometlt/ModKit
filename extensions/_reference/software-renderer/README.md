# Software renderer

Reference implementation of `common.render/scene-3d@1`, consumed only by
`packages/host/test/renderer.test.ts` and `packages/sdk/test/renderer-contract-types.ts`.

Reference provider for `common.render/scene-3d@1`. It consumes decoded triangle primitives as
typed arrays, applies model and view-projection matrices, and returns an owned RGBA8 frame.

The implementation is intentionally small and deterministic. It proves the provider contract and
the decoded-geometry path; production WebGL/WebGPU backends, textures, skinning and animation are
separate providers or later contract revisions.
