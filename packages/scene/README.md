# `@modkit/scene`

Built-in, format-neutral scene facilities shared by the Modkit applications.

The package owns the portable scene-renderer providers, deterministic headless rasterizer, PNG
output and the Three.js relation-graph backend. Game and format extensions remain responsible for
decoding their data into the neutral scene contract from `@modkit/sdk/renderer`.

Applications opt in by importing `sceneModule`; Extension Manager does not install or remove this
product module. The provider and contribution identifiers intentionally remain compatible with the
former `rendering-3d` extension.

Subpath exports keep optional runtime dependencies explicit:

- `@modkit/scene/render/browser`
- `@modkit/scene/render/headless`
- `@modkit/scene/output/png`
- `@modkit/scene/relations`
