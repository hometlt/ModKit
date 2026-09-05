# M4 archive family copy divergence

M4 decision 8 admits the archive compatibility surface only through the isolated
StarCraft II MK2 test tree. The acceptance suite is exactly these six pinned files:

- `packages/archives-processing/test/cache.spec.ts`
- `packages/archives-processing/test/index.spec.ts`
- `packages/archives-processing/test/optional-extension-loaders.spec.ts`
- `packages/archives-processing/test/source.spec.ts`
- `packages/archives-processing/test/vfs-browser-boundary.spec.ts`
- `packages/archives-processing/test/vfs-mount.spec.ts`

Together they execute 51 leaf tests. The isolated Vitest workspace resolves the
original `@modkitx/assets` and `@modkitx/vfs` package identities to pinned copies
inside `starcraft2/src/lib/mk2`; compression and crypto likewise remain local to
that copied archive package. Five overlapping archive sources therefore retain
their original MK2 imports and exports instead of the Core support-library
rewrites used by earlier scopes.

The family copy record still starts at the pinned MK2 blob and records every
automatic import rewrite. The bounded divergences reverse only those exact
rewrites and bind the final bytes to a separate destination SHA-256. This keeps
both stages reconstructible without activating the copied archive registry or
archive codecs in the production host.
