# Pinned MK2 Node oracle (M1 / 0.3)

The versioned implementation is `modkit-core/scripts/migration/lib/legacy-oracle.mjs`.
`load-mk2.mjs` supplies workspace defaults. Nothing writes to `references/modkitmk2`.

```js
const { module, evidence } = await loadMk2('packages/example/src/index.ts', {
  operation: 'example.decode',
  operationOptions: { level: 0 },
  corpusManifest,                  // ordered real input bytes + hashes; generator/options for synthetic inputs
  additionalFiles: ['data/example.json'], // pinned runtime data/fixtures not reached by static imports
  runtimeDependencies: [{ name: 'decoder-package', files: ['decoder.wasm'] }],
  loaderFiles: [harnessPath],       // hash harness/canonicalization/generator code as part of the loader
})
```

`createPinnedSource({ repoRoot, commit })` returns `commit`, `repoRoot`, `listFiles()`, `has(path)`
and async `read(path)`. A read returns pinned `bytes`, `path`, `sha256`, `gitBlob`,
`workingTreeSha256`, `workingTreeMatchesPin`. It always reads the git blob, even when working bytes
match. Paths outside the repository and git symlinks are rejected. This API is shared with copy tooling.

Esbuild resolves `@modkitx/*` through pinned package exports to source, compiles TypeScript with
the pinned compiler profile and legacy decorators, and bundles a Node ESM entry. Only a justified,
explicit `host-registry` path can be substituted. DDS uses one registry isolation module whose
entrypoints throw if called. The actual size guard, error class, PNG/TGA helpers, algorithms and WASM
remain intact. SDK/host stubs are never inferred from a missing import.

The source manifest includes source files esbuild reads, resolver manifests, root compiler/package/
lock configuration, and declared runtime data/fixtures. Runtime data accessed through nonliteral
paths must be declared in `additionalFiles`. Nonliteral package imports must be declared in
`runtimeDependencies`, including required data/WASM files. Unavailable declared files fail the load.
This loader does not infer arbitrary I/O performed inside a codec operation: the harness owns that
declaration. `import.meta.url` is resolved to a read-only pinned source snapshot so declared adjacent
data uses the pinned bytes. External packages, their complete file inventories (including WASM),
transitive runtime dependencies and the actual esbuild platform executable are hashed and copied
to immutable cache snapshots. No oracle import depends on mutable installed package bytes.

The cache key includes oracle commit and observed source closure, loader/harness files, dependencies,
runtime/build configuration, operation/options, additional files, stubs and corpus manifest. Cached
bundles and manifests are revalidated; corrupt entries fail rather than silently rebuilding. The
cache stores compiled modules and evidence, not successful comparison verdicts. A loaded module
alone does not constitute parity evidence.

## DDS transition reproduction

Original M0 harness/loader bytes are archived in
`artifacts/legacy-parity-sc2/m1-2026-09-04/oracle/old-snapshot/` with SHA-256 hashes.
`prepare-dds-transition.mjs` makes old runner copies; their changes are corpus read tracking,
pointing to the archived old loader, and using the common pinned MK3 reference when requested.
`migrate-dds-harnesses.mjs` replaces loaders while retaining
comparison operations, caps, synthetic generators and refusal accounting.

```powershell
node --test modkit-core/scripts/migration/test/legacy-oracle.test.mjs
node artifacts/legacy-oracle/prepare-mk3-reference.mjs
node artifacts/legacy-oracle/wire-mk3-reference.mjs
node artifacts/legacy-oracle/run-dds-transition.mjs old
node artifacts/legacy-oracle/run-dds-transition.mjs new
```

Both sides use isolated accepted M0 MK3 commit 878f9cd7; a current M1-tree rerun is a separate gate.
The old pass records each actual DDS read in order with its bytes' hash; the new pass requires the
same reads and hashes. Both pass counts are compared with accepted M0 and new stdout is compared
with old stdout. DDS 1284 files; BPTC 6400 surfaces; compressed 417 files; encode 770 cases; raster
operations 1895 cases. Legacy-only refusals remain legacy-only; they are never promoted to
both-refused. Equal-refusal cases in the original counts remain explicitly documented in M0.

Direct new harness commands with `--corpus` remain supported. Without a recorded old manifest,
they hash the complete DDS candidate corpus before loading; the harness digest and arguments
identify its unchanged sampling and synthetic generation. Paired transition runs use exact old
read manifests instead, avoiding a second full-corpus hash pass.
