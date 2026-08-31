# `@modkitx-x3/scene`

Built-in, format-neutral scene facilities shared by the Modkit applications.

The package owns the portable scene-renderer providers, deterministic headless rasterizer, PNG
output and the Three.js relation-graph backend. Game and format extensions remain responsible for
decoding their data into the neutral scene contract from `@modkitx-x3/sdk/renderer`.

Applications opt in by importing `sceneModule`; Extension Manager does not install or remove this
product module. The provider and contribution identifiers intentionally remain compatible with the
former `rendering-3d` extension.

Subpath exports keep optional runtime dependencies explicit:

- `@modkitx-x3/scene/render/browser`
- `@modkitx-x3/scene/render/headless`
- `@modkitx-x3/scene/output/png`
- `@modkitx-x3/scene/relations`
